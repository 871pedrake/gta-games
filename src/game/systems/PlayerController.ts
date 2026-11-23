import * as THREE from 'three';
import {
  PLAYER_AIM_SPEED_MUL,
  PLAYER_GRAVITY,
  PLAYER_JUMP_VELOCITY,
  PLAYER_RADIUS,
  PLAYER_SPRINT_SPEED,
  PLAYER_WALK_SPEED,
} from '../config';
import { EngineContext, GameSystem } from '../core/SystemLifecycle';
import { createPlayerModel, PlayerRig, setPlayerRigWeapon } from '../models';
import { getWeaponDef } from '../WeaponDefs';
import { CameraRig } from './CameraRig';
import { InputManager } from './InputManager';

export class PlayerController implements GameSystem {
  public readonly name = 'PlayerController';

  private ctx: EngineContext | null = null;
  private readonly input: InputManager;
  private readonly cameraRig: CameraRig;
  private readonly shadowTex: THREE.CanvasTexture;
  public playerRig!: PlayerRig;
  private walkAnimTime = 0;
  private visualWeaponId = 'fists';
  private holsterWeaponId = 'fists';
  private unsubs: Array<() => void> = [];

  constructor(input: InputManager, cameraRig: CameraRig, shadowTex: THREE.CanvasTexture) {
    this.input = input;
    this.cameraRig = cameraRig;
    this.shadowTex = shadowTex;
  }

  public init(ctx: EngineContext): void {
    this.ctx = ctx;
    this.playerRig = createPlayerModel(this.shadowTex);
    this.playerRig.root.position.copy(ctx.state.playerPos);
    this.playerRig.root.rotation.y = ctx.state.playerYaw;
    this.visualWeaponId = ctx.state.activeWeaponId;
    this.holsterWeaponId = ctx.state.activeWeaponId;
    setPlayerRigWeapon(this.playerRig, ctx.state.activeWeaponId);
    ctx.scene.add(this.playerRig.root);

    this.unsubs.push(
      ctx.events.on('vehicleEntered', () => {
        this.playerRig.root.visible = false;
      })
    );
    this.unsubs.push(
      ctx.events.on('vehicleExited', () => {
        this.playerRig.root.visible = true;
      })
    );
    this.unsubs.push(
      ctx.events.on('busted', () => {
        this.playerRig.root.visible = true;
      })
    );
  }

  public syncTransform(): void {
    if (!this.ctx) return;
    const { state } = this.ctx;
    this.playerRig.root.position.copy(state.playerPos);
    this.playerRig.root.rotation.y = state.playerYaw;
    this.playerRig.root.visible =
      state.currentVehicle === null || Boolean(state.vehicleAccess?.active && state.vehicleAccess.visible);
    this.visualWeaponId = state.activeWeaponId;
    this.holsterWeaponId = state.activeWeaponId;
    setPlayerRigWeapon(this.playerRig, state.activeWeaponId);
  }

  public getMuzzleWorldPosition(out: THREE.Vector3): boolean {
    if (!this.playerRig || !this.playerRig.muzzleTip) return false;
    this.playerRig.root.updateMatrixWorld(true);
    this.playerRig.muzzleTip.getWorldPosition(out);
    return true;
  }

  public update(dt: number): void {
    if (!this.ctx) return;
    const { state, audio, events, groundHeightAt, resolveWorldCollisions } = this.ctx;

    const prevX = state.playerPos.x;
    const prevZ = state.playerPos.z;

    if (state.vehicleAccess?.active) {
      const va = state.vehicleAccess;
      state.playerPos.set(va.x, va.y, va.z);
      state.playerYaw = va.yaw;
      state.playerVelX = 0;
      state.playerVelY = 0;
      state.playerVelZ = 0;
      this.playerRig.root.visible = va.visible;
      this.playerRig.root.position.set(va.x, va.y, va.z);
      this.playerRig.root.rotation.y = va.yaw;

      const walkSwing = Math.sin(va.walkPhase) * 0.48;
      const sit = THREE.MathUtils.clamp(va.sitBlend, 0, 1);
      this.playerRig.leftLegPivot.rotation.x = THREE.MathUtils.lerp(walkSwing, -Math.PI * 0.44, sit);
      this.playerRig.rightLegPivot.rotation.x = THREE.MathUtils.lerp(-walkSwing, -Math.PI * 0.44, sit);
      this.playerRig.leftArmPivot.rotation.x = THREE.MathUtils.lerp(-walkSwing * 0.7, -Math.PI * 0.36, sit);
      this.playerRig.rightArmPivot.rotation.x = THREE.MathUtils.lerp(walkSwing * 0.7, -Math.PI * 0.36, sit);
      this.playerRig.leftArmPivot.rotation.z = THREE.MathUtils.lerp(0, 0.14, sit);
      this.playerRig.rightArmPivot.rotation.z = THREE.MathUtils.lerp(0, -0.14, sit);
      this.playerRig.torsoGroup.position.y = THREE.MathUtils.lerp(
        0.78 + Math.abs(Math.cos(va.walkPhase)) * 0.04,
        0.66,
        sit
      );
      this.playerRig.torsoGroup.rotation.set(0, 0, 0);
      return;
    }

    if (state.currentVehicle) {
      state.playerVelX = 0;
      state.playerVelZ = 0;
      return;
    }

    if (state.activeWeaponId !== this.holsterWeaponId && state.combat.weaponState !== 'switching') {
      this.holsterWeaponId = state.activeWeaponId;
      this.visualWeaponId = state.activeWeaponId;
    }
    if (state.combat.weaponState === 'switching') {
      const shownId = state.combat.switchProgress < 0.45 ? this.visualWeaponId : state.activeWeaponId;
      if (state.combat.switchProgress >= 0.45) {
        this.visualWeaponId = state.activeWeaponId;
        this.holsterWeaponId = state.activeWeaponId;
      }
      setPlayerRigWeapon(this.playerRig, shownId);
    } else {
      this.visualWeaponId = state.activeWeaponId;
      this.holsterWeaponId = state.activeWeaponId;
      setPlayerRigWeapon(this.playerRig, state.activeWeaponId);
    }

    const weaponDef = getWeaponDef(state.activeWeaponId);
    const aimingOrFiring =
      weaponDef.isFirearm &&
      (state.combat.aiming || state.combat.recoilKickTimer > 0);

    if (this.input.consumeAction('jump') && state.isGrounded) {
      state.playerVelY = PLAYER_JUMP_VELOCITY;
      state.isGrounded = false;
      audio.playJump();
      events.emit('playerJumped', { x: state.playerPos.x, z: state.playerPos.z });
    }

    const { forward, strafe } = this.input.getMoveAxes();
    const isSprinting = this.input.isSprinting() && !state.combat.aiming;
    const moveSpeed = state.combat.aiming
      ? PLAYER_WALK_SPEED * PLAYER_AIM_SPEED_MUL
      : isSprinting
      ? PLAYER_SPRINT_SPEED
      : PLAYER_WALK_SPEED;
    const moving = Math.abs(forward) > 0.05 || Math.abs(strafe) > 0.05;

    if (moving) {
      const camForwardX = -Math.sin(this.cameraRig.camYaw);
      const camForwardZ = -Math.cos(this.cameraRig.camYaw);
      const camRightX = Math.cos(this.cameraRig.camYaw);
      const camRightZ = -Math.sin(this.cameraRig.camYaw);

      let dirX = camForwardX * forward + camRightX * strafe;
      let dirZ = camForwardZ * forward + camRightZ * strafe;
      const len = Math.hypot(dirX, dirZ) || 1;
      dirX /= len;
      dirZ /= len;

      const analogMag = Math.min(1, Math.hypot(forward, strafe));
      state.playerPos.x += dirX * moveSpeed * analogMag * dt;
      state.playerPos.z += dirZ * moveSpeed * analogMag * dt;
      resolveWorldCollisions(state.playerPos, PLAYER_RADIUS);

      // Ao mirar/atirar, alinha o corpo ao yaw da câmera (strafe real)
      const targetYaw = aimingOrFiring ? this.cameraRig.camYaw + Math.PI : Math.atan2(dirX, dirZ);
      let diff = targetYaw - state.playerYaw;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      state.playerYaw += diff * Math.min(1, dt * (aimingOrFiring ? 24 : 12));

      this.walkAnimTime += dt * (isSprinting ? 14 : state.combat.aiming ? 7.2 : 9);
      const swing = Math.sin(this.walkAnimTime) * (isSprinting ? 0.78 : state.combat.aiming ? 0.34 : 0.48);
      this.playerRig.leftLegPivot.rotation.x = swing;
      this.playerRig.rightLegPivot.rotation.x = -swing;
      this.playerRig.torsoGroup.position.y = 0.78 + Math.abs(Math.cos(this.walkAnimTime)) * (state.combat.aiming ? 0.02 : 0.05);
    } else {
      if (aimingOrFiring) {
        const targetYaw = this.cameraRig.camYaw + Math.PI;
        let diff = targetYaw - state.playerYaw;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        state.playerYaw += diff * Math.min(1, dt * 24);
      }
      this.playerRig.leftLegPivot.rotation.x = THREE.MathUtils.damp(this.playerRig.leftLegPivot.rotation.x, 0, 12, dt);
      this.playerRig.rightLegPivot.rotation.x = THREE.MathUtils.damp(this.playerRig.rightLegPivot.rotation.x, 0, 12, dt);
      this.playerRig.torsoGroup.position.y = THREE.MathUtils.damp(this.playerRig.torsoGroup.position.y, 0.78, 12, dt);
    }

    // Tronco e braços acompanham o pitch da mira
    this.updateUpperBodyPose(dt, moving, isSprinting, weaponDef.isFirearm, weaponDef.twoHanded);

    state.playerVelY -= PLAYER_GRAVITY * dt;
    state.playerPos.y += state.playerVelY * dt;
    const floorY = groundHeightAt(state.playerPos.x, state.playerPos.z, state.playerPos.y);
    if (state.playerPos.y <= floorY) {
      state.playerPos.y = floorY;
      state.playerVelY = 0;
      state.isGrounded = true;
    }

    const invDt = dt > 1e-4 ? 1 / dt : 0;
    state.playerVelX = (state.playerPos.x - prevX) * invDt;
    state.playerVelZ = (state.playerPos.z - prevZ) * invDt;

    this.playerRig.root.position.copy(state.playerPos);
    this.playerRig.root.rotation.y = state.playerYaw;
  }

  private updateUpperBodyPose(
    dt: number,
    moving: boolean,
    isSprinting: boolean,
    isFirearm: boolean,
    twoHanded: boolean
  ): void {
    const { state } = this.ctx!;
    const { leftArmPivot, rightArmPivot, torsoGroup, weaponMount } = this.playerRig;

    let targetRightX = 0;
    let targetRightZ = 0;
    let targetLeftX = 0;
    let targetLeftZ = 0;
    let targetTorsoY = 0;
    let targetTorsoX = 0;
    let mountPosY = -0.5;
    let mountRotX = 0;
    let mountRotY = 0;
    let mountRotZ = 0;

    if (state.combat.meleeSwingTimer > 0) {
      // Soco: recuo curto -> golpe rápido -> retorno
      const phase = 1 - Math.min(1, state.combat.meleeSwingTimer / 0.28);
      const punch = Math.sin(phase * Math.PI);
      targetRightX = -1.78 * punch;
      targetRightZ = 0.22 * punch;
      targetLeftX = -0.82;
      targetLeftZ = -0.18;
      targetTorsoY = -0.46 * punch;
      targetTorsoX = 0.16 * punch;
    } else if (state.combat.weaponState === 'switching') {
      // Troca de arma: guarda (abaixa/recolhe) e saca a nova
      const dip = Math.sin(Math.min(1, Math.max(0, state.combat.switchProgress)) * Math.PI);
      targetRightX = -0.4 + dip * 0.92;
      targetRightZ = 0.1 - dip * 0.28;
      targetLeftX = twoHanded ? -0.5 + dip * 0.5 : -0.15;
      targetLeftZ = twoHanded ? -0.22 : 0;
      targetTorsoY = -0.12 * dip;
      mountPosY = -0.5 + dip * 0.08;
      mountRotX = dip * 0.65;
      mountRotZ = dip * 0.42;
    } else if (state.combat.reloading && isFirearm) {
      // Recarga: a arma desce e gira enquanto a mão esquerda alimenta o pente/cartucho
      const env = Math.sin(Math.min(1, Math.max(0, state.combat.reloadProgress)) * Math.PI);
      const feedBob = Math.sin(state.combat.reloadProgress * Math.PI * 2) * 0.2;
      targetRightX = -0.48 + env * 0.32;
      targetRightZ = 0.32 * env;
      targetLeftX = -1.12 - feedBob;
      targetLeftZ = -0.44;
      targetTorsoY = 0.16 * env;
      targetTorsoX = 0.08 * env;
      mountPosY = -0.5 + env * 0.07;
      mountRotX = env * 0.34;
      mountRotY = env * 0.52;
      mountRotZ = env * 0.78;
    } else if (isFirearm && (state.combat.aiming || state.combat.recoilKickTimer > 0)) {
      // Pose de mira com pitch do cano + recuo por tiro
      const aimPitch = THREE.MathUtils.clamp(this.cameraRig.camPitch - 0.16, -0.55, 0.72);
      const recoilKick = this.cameraRig.getRecoilPitch(); // negativo = cano sobe com mola amortecida
      const kickNorm = Math.min(1, state.combat.recoilKickTimer / 0.14);
      targetTorsoX = aimPitch * 0.35 + recoilKick * 0.25;
      targetRightX = -Math.PI * 0.5 + aimPitch * 0.65 + recoilKick * 0.95;
      targetRightZ = twoHanded ? 0.14 : 0.04;
      if (twoHanded) {
        targetLeftX = -Math.PI * 0.45 + aimPitch * 0.65 + recoilKick * 0.85;
        targetLeftZ = -0.44;
      } else {
        targetLeftX = -0.48 + aimPitch * 0.25;
        targetLeftZ = -0.14;
      }
      targetTorsoY = (twoHanded ? 0.18 : 0.08) - this.cameraRig.getRecoilYaw() * 0.4;
      mountPosY = -0.5 + kickNorm * 0.045;
      mountRotX = -kickNorm * 0.16;
    } else if (isFirearm) {
      // Porte tático no quadril
      const swing = moving ? Math.sin(this.walkAnimTime) * (isSprinting ? 0.58 : 0.32) : 0;
      targetRightX = -0.44 + swing * 0.32;
      targetRightZ = 0.08;
      targetLeftX = twoHanded ? -0.52 + swing * 0.25 : -swing * 0.65;
      targetLeftZ = twoHanded ? -0.28 : 0;
    } else {
      const swing = moving ? Math.sin(this.walkAnimTime) * (isSprinting ? 0.78 : 0.48) : 0;
      targetRightX = swing * 0.8;
      targetLeftX = -swing * 0.8;
    }

    rightArmPivot.rotation.x = THREE.MathUtils.damp(rightArmPivot.rotation.x, targetRightX, 20, dt);
    rightArmPivot.rotation.z = THREE.MathUtils.damp(rightArmPivot.rotation.z, targetRightZ, 18, dt);
    leftArmPivot.rotation.x = THREE.MathUtils.damp(leftArmPivot.rotation.x, targetLeftX, 20, dt);
    leftArmPivot.rotation.z = THREE.MathUtils.damp(leftArmPivot.rotation.z, targetLeftZ, 18, dt);
    torsoGroup.rotation.y = THREE.MathUtils.damp(torsoGroup.rotation.y, targetTorsoY, 18, dt);
    torsoGroup.rotation.x = THREE.MathUtils.damp(torsoGroup.rotation.x, targetTorsoX, 20, dt);

    if (weaponMount) {
      weaponMount.position.y = THREE.MathUtils.damp(weaponMount.position.y, mountPosY, 24, dt);
      weaponMount.rotation.x = THREE.MathUtils.damp(weaponMount.rotation.x, mountRotX, 24, dt);
      weaponMount.rotation.y = THREE.MathUtils.damp(weaponMount.rotation.y, mountRotY, 20, dt);
      weaponMount.rotation.z = THREE.MathUtils.damp(weaponMount.rotation.z, mountRotZ, 20, dt);
    }
  }

  public dispose(): void {
    this.unsubs.forEach((u) => u());
    this.unsubs = [];
    if (this.ctx && this.playerRig) {
      this.ctx.scene.remove(this.playerRig.root);
    }
    this.ctx = null;
  }
}
