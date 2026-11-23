import * as THREE from 'three';
import { BuildingSpatialGrid, intersectSegmentAABB } from '../Ballistics';
import {
  CAM_DEFAULT_AIM_SENSITIVITY_MUL,
  CAM_DEFAULT_FOV,
  CAM_DEFAULT_PITCH,
  CAM_DEFAULT_SENSITIVITY,
  CAM_MAX_PITCH,
  CAM_MIN_PITCH,
  CAM_PLAYER_DIST,
  CAM_ROTATE_SPEED,
  CAM_TPS_AIM_DIST,
  CAM_TPS_AIM_FOLLOW_STIFFNESS,
  CAM_TPS_AIM_HEIGHT,
  CAM_TPS_AIM_SHOULDER_X,
  CAM_TPS_HIP_DIST,
  CAM_TPS_HIP_HEIGHT,
  CAM_TPS_LOOKAHEAD,
  CAM_TPS_SHOULDER_X,
  CAM_TPS_TRANSITION_LAMBDA,
  CAM_VEHICLE_BASE_DIST,
  CAM_VEHICLE_FOV_BOOST,
  PLAYER_SPAWN_YAW,
} from '../config';
import { EngineContext, GameSystem } from '../core/SystemLifecycle';
import { AimMode, BuildingCollider } from '../types';
import { getWeaponDef } from '../WeaponDefs';
import { InputManager } from './InputManager';

const _camDesired = new THREE.Vector3();
const _pivotPos = new THREE.Vector3();
const _headPos = new THREE.Vector3();
const _lookAtPos = new THREE.Vector3();
const _camNormal = { nx: 0, ny: 1, nz: 0 };
const _camBuildingBuf: number[] = [];

const RECOIL_SPRING_STIFFNESS = 145.0;
const RECOIL_SPRING_DAMPING = 22.5;

export class CameraRig implements GameSystem {
  public readonly name = 'CameraRig';

  public camYaw = PLAYER_SPAWN_YAW;
  public camPitch = CAM_DEFAULT_PITCH;
  public sensitivity = CAM_DEFAULT_SENSITIVITY;
  public aimMode: AimMode = 'hold';
  public aimSensitivityMul = CAM_DEFAULT_AIM_SENSITIVITY_MUL;
  public invertY = false;

  private ctx: EngineContext | null = null;
  private readonly input: InputManager;
  private unsubHit: (() => void) | null = null;
  private buildingGrid: BuildingSpatialGrid | null = null;
  private indexedBuildingsRef: ReadonlyArray<BuildingCollider> | null = null;
  private indexedBuildingCount = -1;

  private currentDist = CAM_PLAYER_DIST;
  private currentShoulderX = 0;
  private currentHeight = 1.48;
  private recoilPitch = 0;
  private recoilPitchVel = 0;
  private recoilYaw = 0;
  private recoilYawVel = 0;

  constructor(input: InputManager) {
    this.input = input;
  }

  public init(ctx: EngineContext): void {
    this.ctx = ctx;
    this.buildingGrid = new BuildingSpatialGrid(ctx.world.buildings, 32);
    this.indexedBuildingsRef = ctx.world.buildings;
    this.indexedBuildingCount = ctx.world.buildings.length;

    this.input.setPointerLookHandler((dx, dy) => {
      const ySign = this.invertY ? -1 : 1;
      const aimMul = this.getAimLookMultiplier();
      this.camYaw -= dx * 0.0055 * this.sensitivity * aimMul;
      this.camPitch = THREE.MathUtils.clamp(
        this.camPitch + dy * 0.004 * this.sensitivity * aimMul * ySign,
        CAM_MIN_PITCH,
        CAM_MAX_PITCH
      );
    });

    this.unsubHit = ctx.events.on('vehicleHitPedestrian', (ev) => {
      if (ev.cameraShake > 0) {
        ctx.state.cameraShake = Math.max(ctx.state.cameraShake, ev.cameraShake);
      }
    });

    this.update(0.016);
  }

  public setOptions(
    sensitivity: number,
    invertY: boolean,
    aimMode: AimMode = this.aimMode,
    aimSensitivityMul: number = this.aimSensitivityMul
  ): void {
    this.sensitivity = sensitivity;
    this.invertY = invertY;
    this.aimMode = aimMode;
    this.aimSensitivityMul = aimSensitivityMul;
  }

  public getAimLookMultiplier(): number {
    if (!this.ctx) return 1;
    const { state, camera } = this.ctx;
    if (!state.combat.aiming || state.currentVehicle !== null) return 1;
    const fovRatio = Math.max(0.25, Math.min(1.5, camera.fov / CAM_DEFAULT_FOV));
    return this.aimSensitivityMul * fovRatio;
  }

  /**
   * Impulso de recuo em mola amortecida (spring-damper): eleva o pitch e aplica leve yaw
   * com recuperação gradual automática, sem travar a câmera do jogador.
   */
  public applyRecoil(pitchKick: number, yawKick: number): void {
    this.recoilPitchVel -= pitchKick * 22.0;
    this.recoilYawVel += yawKick * 16.0;
  }

  public getRecoilPitch(): number {
    return this.recoilPitch;
  }

  public getRecoilYaw(): number {
    return this.recoilYaw;
  }

  /**
   * Raio central da câmera pelo centro da tela (deve ser consultado após cameraRig.update).
   */
  public getAimRay(outOrigin: THREE.Vector3, outDir: THREE.Vector3): void {
    if (!this.ctx) return;
    const { camera } = this.ctx;
    outOrigin.copy(camera.position);
    camera.getWorldDirection(outDir).normalize();
  }

  private stepRecoilSpring(dt: number): void {
    const subDt = Math.min(dt, 0.05);
    const accelP = -RECOIL_SPRING_STIFFNESS * this.recoilPitch - RECOIL_SPRING_DAMPING * this.recoilPitchVel;
    this.recoilPitchVel += accelP * subDt;
    this.recoilPitch = THREE.MathUtils.clamp(this.recoilPitch + this.recoilPitchVel * subDt, -0.26, 0.14);

    const accelY = -RECOIL_SPRING_STIFFNESS * this.recoilYaw - RECOIL_SPRING_DAMPING * this.recoilYawVel;
    this.recoilYawVel += accelY * subDt;
    this.recoilYaw = THREE.MathUtils.clamp(this.recoilYaw + this.recoilYawVel * subDt, -0.14, 0.14);
  }

  public update(dt: number): void {
    if (!this.ctx) return;
    const { camera, state, world, groundHeightAt } = this.ctx;

    this.stepRecoilSpring(dt);

    const aimMul = this.getAimLookMultiplier();
    const camAxes = this.input.getCameraRotateAxes();
    if (camAxes.yawDelta !== 0) {
      this.camYaw += camAxes.yawDelta * CAM_ROTATE_SPEED * this.sensitivity * aimMul * dt;
    }
    if (camAxes.pitchDelta !== 0) {
      const ySign = this.invertY ? -1 : 1;
      this.camPitch = THREE.MathUtils.clamp(
        this.camPitch + camAxes.pitchDelta * this.sensitivity * aimMul * ySign * dt,
        CAM_MIN_PITCH,
        CAM_MAX_PITCH
      );
    }

    const car = state.currentVehicle;
    if (car) {
      const desiredYaw = car.heading + Math.PI;
      let diff = desiredYaw - this.camYaw;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      if (!this.input.isDraggingCamera() && !this.input.isPointerLocked()) {
        this.camYaw += diff * (1 - Math.exp(-4.5 * dt));
      }

      const speedRatio = Math.abs(car.speed) / car.maxSpeed;
      const targetFov = CAM_DEFAULT_FOV + speedRatio * CAM_VEHICLE_FOV_BOOST;
      if (Math.abs(camera.fov - targetFov) > 0.05) {
        camera.fov = THREE.MathUtils.damp(camera.fov, targetFov, 6, dt);
        camera.updateProjectionMatrix();
      }

      const clampedPitch = Math.max(0.06, this.camPitch);
      const dist = CAM_VEHICLE_BASE_DIST + speedRatio * 1.4;
      const height = 3.6 + clampedPitch * 2.4;
      _camDesired.set(
        car.x + Math.sin(this.camYaw) * dist,
        car.mesh.position.y + height,
        car.z + Math.cos(this.camYaw) * dist
      );
      _lookAtPos.set(car.x, car.mesh.position.y + 1.35, car.z);
    } else {
      const weaponDef = getWeaponDef(state.activeWeaponId);
      const aiming = state.combat.aiming;
      const armed = weaponDef.isFirearm;

      // FOV por arma (60 -> 48; fuzil -> 40) com transição suave ~0,15 s
      const targetFov = aiming ? weaponDef.aimFov : CAM_DEFAULT_FOV;
      if (Math.abs(camera.fov - targetFov) > 0.03) {
        camera.fov = THREE.MathUtils.damp(camera.fov, targetFov, CAM_TPS_TRANSITION_LAMBDA, dt);
        camera.updateProjectionMatrix();
      }

      const targetDist = aiming ? CAM_TPS_AIM_DIST : armed ? CAM_TPS_HIP_DIST : CAM_PLAYER_DIST;
      const targetShoulderX =
        (aiming ? CAM_TPS_AIM_SHOULDER_X : armed ? CAM_TPS_SHOULDER_X : 0) * state.combat.shoulderSide;
      const targetHeight = aiming ? CAM_TPS_AIM_HEIGHT : armed ? CAM_TPS_HIP_HEIGHT : 1.48;

      this.currentDist = THREE.MathUtils.damp(this.currentDist, targetDist, CAM_TPS_TRANSITION_LAMBDA, dt);
      this.currentShoulderX = THREE.MathUtils.damp(this.currentShoulderX, targetShoulderX, CAM_TPS_TRANSITION_LAMBDA, dt);
      this.currentHeight = THREE.MathUtils.damp(this.currentHeight, targetHeight, CAM_TPS_TRANSITION_LAMBDA, dt);

      const effYaw = this.camYaw + this.recoilYaw;
      const effPitch = THREE.MathUtils.clamp(this.camPitch + this.recoilPitch, CAM_MIN_PITCH, CAM_MAX_PITCH);
      const cosPitch = Math.cos(effPitch);
      const fwdX = -Math.sin(effYaw) * cosPitch;
      const fwdY = -Math.sin(effPitch);
      const fwdZ = -Math.cos(effYaw) * cosPitch;
      const rightX = Math.cos(effYaw);
      const rightZ = -Math.sin(effYaw);

      _headPos.set(state.playerPos.x, state.playerPos.y + 1.62, state.playerPos.z);
      _pivotPos.set(
        state.playerPos.x + rightX * this.currentShoulderX,
        state.playerPos.y + this.currentHeight,
        state.playerPos.z + rightZ * this.currentShoulderX
      );

      _camDesired.set(
        _pivotPos.x - fwdX * this.currentDist,
        _pivotPos.y - fwdY * this.currentDist,
        _pivotPos.z - fwdZ * this.currentDist
      );

      // Raycast da cabeça do jogador até a posição desejada via Spatial Grid
      if (this.indexedBuildingsRef !== world.buildings || this.indexedBuildingCount !== world.buildings.length) {
        if (this.buildingGrid) this.buildingGrid.rebuild(world.buildings);
        else this.buildingGrid = new BuildingSpatialGrid(world.buildings, 32);
        this.indexedBuildingsRef = world.buildings;
        this.indexedBuildingCount = world.buildings.length;
      }

      let minT = 1.0;
      if (this.buildingGrid) {
        this.buildingGrid.querySegment(_headPos.x, _headPos.z, _camDesired.x, _camDesired.z, _camBuildingBuf);
        for (let k = 0; k < _camBuildingBuf.length; k++) {
          const b = world.buildings[_camBuildingBuf[k]];
          if (!b) continue;
          const baseY = b.baseY ?? 0;
          const t = intersectSegmentAABB(
            _headPos.x,
            _headPos.y,
            _headPos.z,
            _camDesired.x,
            _camDesired.y,
            _camDesired.z,
            b.x - b.halfW - 0.18,
            baseY,
            b.z - b.halfD - 0.18,
            b.x + b.halfW + 0.18,
            baseY + b.height,
            b.z + b.halfD + 0.18,
            _camNormal
          );
          if (t !== null && t < minT) {
            minT = t;
          }
        }
      }
      if (minT < 1.0) {
        const safeT = Math.max(0.16, minT * 0.88);
        _camDesired.lerpVectors(_headPos, _camDesired, safeT);
      }

      const groundFloor = groundHeightAt(_camDesired.x, _camDesired.z, _camDesired.y) + 0.35;
      if (_camDesired.y < groundFloor) {
        _camDesired.y = groundFloor;
      }

      _lookAtPos.set(
        _pivotPos.x + fwdX * CAM_TPS_LOOKAHEAD,
        _pivotPos.y + fwdY * CAM_TPS_LOOKAHEAD,
        _pivotPos.z + fwdZ * CAM_TPS_LOOKAHEAD
      );
    }

    // Rigidez alta ao mirar para a câmera/retículo não "flutuar"
    const followSharpness =
      !car && state.combat.aiming
        ? CAM_TPS_AIM_FOLLOW_STIFFNESS
        : !car && getWeaponDef(state.activeWeaponId).isFirearm
        ? 22
        : 11;
    const alpha = 1 - Math.exp(-followSharpness * dt);
    camera.position.lerp(_camDesired, alpha);

    if (state.cameraShake > 0.005) {
      camera.position.x += (Math.random() - 0.5) * state.cameraShake * 1.1;
      camera.position.y += (Math.random() - 0.5) * state.cameraShake * 0.8;
      camera.position.z += (Math.random() - 0.5) * state.cameraShake * 1.1;
      state.cameraShake = Math.max(0, state.cameraShake - dt * 2.4);
    }

    camera.lookAt(_lookAtPos);
    camera.updateMatrixWorld();
  }

  public dispose(): void {
    this.unsubHit?.();
    this.unsubHit = null;
    this.input.setPointerLookHandler(null);
    this.buildingGrid = null;
    this.ctx = null;
  }
}
