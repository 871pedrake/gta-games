import * as THREE from 'three';
import {
  HORN_PANIC_RADIUS,
  PLAYER_RADIUS,
  VEHICLE_ENTER_RADIUS,
} from '../config';
import { EngineContext, GameSystem } from '../core/SystemLifecycle';
import { syncVehicleCabinVisuals } from '../vehicles/builders/sharedBuilderUtils';
import { createVehicleEntity } from '../vehicles/createVehicleEntity';
import { getVehicleController } from '../vehicles/controllers/ControllerRegistry';
import { getVehicleSpec } from '../vehicles/VehicleSpecs';
import { VehicleDoorEventState, VehicleDoorSide, VehicleDoorState, VehicleEntity } from '../types';
import { MISSION_POINTS } from '../world/WorldRegistry';
import { InputManager } from './InputManager';
import {
  applyDoorCrashImpulse,
  applyDoorPivotTransform,
  stepVehicleDoors,
  toggleAllVehicleDoors,
  triggerDoorEntryAnimation,
  triggerDoorExitSwing,
} from './VehicleDoorPhysics';

export type VehicleAccessPhase =
  | 'idle'
  | 'approaching'
  | 'doorOpening'
  | 'boarding'
  | 'doorClosing'
  | 'driving'
  | 'alighting';

interface PendingAutoCloseDoor {
  vehicle: VehicleEntity;
  doorIndex: number;
  side: VehicleDoorSide;
  elapsed: number;
}

const EXIT_MAX_SPEED = 4.5;
const DOOR_AUTO_CLOSE_DIST = 2.0;

function localToWorldXZ(
  v: VehicleEntity,
  localX: number,
  localZ: number
): { x: number; z: number } {
  const cosH = Math.cos(v.heading);
  const sinH = Math.sin(v.heading);
  return {
    x: v.x + cosH * localX + sinH * localZ,
    z: v.z - sinH * localX + cosH * localZ,
  };
}

function normalizeAngle(rad: number): number {
  let a = rad;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function lerpAngle(a: number, b: number, t: number): number {
  return a + normalizeAngle(b - a) * t;
}

function smoothstep01(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
}

export class VehicleSystem implements GameSystem {
  public readonly name = 'VehicleSystem';

  private ctx: EngineContext | null = null;
  private readonly input: InputManager;
  private readonly shadowTex: THREE.CanvasTexture;
  private unsubs: Array<() => void> = [];

  // Máquina de estados de entrada/saída animada
  private accessPhase: VehicleAccessPhase = 'idle';
  private accessDirection: 'enter' | 'exit' = 'enter';
  private accessVehicle: VehicleEntity | null = null;
  private accessSide: VehicleDoorSide = 'left';
  private accessDoorIndex = 0;
  private accessWasOccupiedByNpc = false;
  private accessProgress = 0;
  private accessDuration = 0.6;
  private accessTimer = 0;
  private accessWalkPhase = 0;
  private readonly accessStartPos = new THREE.Vector3();
  private accessStartYaw = 0;
  private pendingAutoClose: PendingAutoCloseDoor | null = null;
  private readonly tmpCollisionPos = new THREE.Vector3();

  constructor(input: InputManager, shadowTex: THREE.CanvasTexture) {
    this.input = input;
    this.shadowTex = shadowTex;
  }

  public getAccessPhase(): VehicleAccessPhase {
    return this.accessPhase;
  }

  public init(ctx: EngineContext): void {
    this.ctx = ctx;

    const starterCar = createVehicleEntity(
      'starter_coupe',
      'coupe',
      0x16f2d4,
      -52,
      -16,
      0,
      this.shadowTex,
      ctx.isSoftwareGl
    );
    starterCar.driver = 'none';
    syncVehicleCabinVisuals(starterCar, ctx.isSoftwareGl, ctx.qualityPreset ?? 'medium');
    ctx.scene.add(starterCar.mesh);
    ctx.vehicles.push(starterCar);

    const m1Car = createVehicleEntity(
      'mission1_gt',
      'sports',
      0xff2e93,
      MISSION_POINTS.m1CarSpawn.x,
      MISSION_POINTS.m1CarSpawn.z,
      MISSION_POINTS.m1CarSpawn.heading,
      this.shadowTex,
      ctx.isSoftwareGl
    );
    m1Car.driver = 'none';
    m1Car.isMissionTarget = true;
    syncVehicleCabinVisuals(m1Car, ctx.isSoftwareGl, ctx.qualityPreset ?? 'medium');
    ctx.state.missionCar = m1Car;
    ctx.scene.add(m1Car.mesh);
    ctx.vehicles.push(m1Car);

    const showcaseFleet: Array<{
      id: string;
      type: 'hatch' | 'sedan' | 'suv' | 'pickup' | 'van' | 'convertible';
      color: number;
      x: number;
      z: number;
      heading: number;
    }> = [
      { id: 'parked_hatch', type: 'hatch', color: 0x22c55e, x: -37.5, z: -24.5, heading: Math.PI * 0.5 },
      { id: 'parked_sedan', type: 'sedan', color: 0x38bdf8, x: -44.0, z: -24.5, heading: Math.PI * 0.5 },
      { id: 'parked_suv', type: 'suv', color: 0xf97316, x: -50.5, z: -24.5, heading: Math.PI * 0.5 },
      { id: 'parked_pickup', type: 'pickup', color: 0xef4444, x: -57.5, z: -24.5, heading: Math.PI * 0.5 },
      { id: 'parked_van', type: 'van', color: 0xe2e8f0, x: -64.5, z: -24.5, heading: Math.PI * 0.5 },
      { id: 'parked_convertible', type: 'convertible', color: 0xfacc15, x: -60.5, z: -16.0, heading: 0 },
    ];

    for (const sc of showcaseFleet) {
      const car = createVehicleEntity(
        sc.id,
        sc.type,
        sc.color,
        sc.x,
        sc.z,
        sc.heading,
        this.shadowTex,
        ctx.isSoftwareGl
      );
      car.driver = 'none';
      syncVehicleCabinVisuals(car, ctx.isSoftwareGl, ctx.qualityPreset ?? 'medium');
      ctx.scene.add(car.mesh);
      ctx.vehicles.push(car);
    }

    // Interrompe transição em caso de dano, nocaute ou prisão sem travar controles
    this.unsubs.push(
      ctx.events.on('playerDamaged', () => {
        if (
          this.accessPhase === 'approaching' ||
          this.accessPhase === 'doorOpening' ||
          this.accessPhase === 'boarding' ||
          this.accessPhase === 'alighting'
        ) {
          this.abortAccessToIdle(false);
        }
      })
    );
    this.unsubs.push(
      ctx.events.on('playerDied', () => {
        this.abortAccessToIdle(true);
      })
    );
    this.unsubs.push(
      ctx.events.on('busted', () => {
        this.abortAccessToIdle(true);
      })
    );
  }

  private ensureVehicleAccessState(): NonNullable<EngineContext['state']['vehicleAccess']> {
    const { state } = this.ctx!;
    if (!state.vehicleAccess) {
      state.vehicleAccess = {
        active: false,
        vehicleId: null,
        x: state.playerPos.x,
        y: state.playerPos.y,
        z: state.playerPos.z,
        yaw: state.playerYaw,
        walkPhase: 0,
        sitBlend: 0,
        visible: false,
      };
    }
    return state.vehicleAccess;
  }

  private clearVehicleAccessAnim(): void {
    if (!this.ctx) return;
    const va = this.ensureVehicleAccessState();
    va.active = false;
    va.vehicleId = null;
    va.visible = false;
    va.sitBlend = 0;
  }

  private abortAccessToIdle(forceExitVehicle: boolean): void {
    if (!this.ctx) return;
    const { state } = this.ctx;
    const veh = this.accessVehicle;

    if (veh && veh.doors) {
      for (const d of veh.doors) {
        if (d.targetAngle !== null && d.targetAngle > 0.05) {
          d.targetAngle = 0;
        }
      }
    }

    if (forceExitVehicle) {
      if (state.currentVehicle && state.currentVehicle.driver === 'player') {
        state.currentVehicle.driver = 'none';
      }
      if (veh && veh.driver === 'player') {
        veh.driver = 'none';
      }
      state.currentVehicle = null;
      this.pendingAutoClose = null;
    } else if (state.currentVehicle && this.accessPhase === 'alighting') {
      // Se abortou no meio da saída, devolve para a rua ao lado sem prender no veículo
      const exitedVeh = state.currentVehicle;
      exitedVeh.driver = 'none';
      state.currentVehicle = null;
      this.ctx.events.emit('vehicleExited', { vehicle: exitedVeh });
    }

    this.clearVehicleAccessAnim();
    this.accessVehicle = null;
    this.accessPhase = state.currentVehicle ? 'driving' : 'idle';
    this.accessProgress = 0;
    this.accessTimer = 0;
  }

  public findNearestVehicle(maxDist = VEHICLE_ENTER_RADIUS): VehicleEntity | null {
    if (!this.ctx) return null;
    const { vehicles, state } = this.ctx;
    let best: VehicleEntity | null = null;
    let bestD2 = maxDist * maxDist;
    for (const v of vehicles) {
      if (v === state.currentVehicle) continue;
      const dx = v.x - state.playerPos.x;
      const dz = v.z - state.playerPos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = v;
      }
    }
    return best;
  }

  private getDoorLocalAnchor(v: VehicleEntity, side: VehicleDoorSide): { lx: number; lz: number } {
    const spec = getVehicleSpec(v.type);
    const seat = v.seat ?? spec.seat;
    const sign = side === 'left' ? -1 : 1;
    const offsetX = Math.max(v.halfWidth + 0.72, Math.abs(seat.exitOffsetX) * 0.72);
    // Porta lateral de correr da van fica logo atrás da cabine do motorista
    const localZ =
      v.type === 'ambulance' && side === 'right'
        ? -0.3
        : spec.doors.hasHingedDoors
        ? (spec.doors.frontZ + spec.doors.rearZ) * 0.5
        : seat.driverZ;
    return { lx: sign * offsetX, lz: localZ };
  }

  private pickClosestDoorSide(v: VehicleEntity): { side: VehicleDoorSide; doorIndex: number } {
    const { state } = this.ctx!;
    const leftAnchor = this.getDoorLocalAnchor(v, 'left');
    const rightAnchor = this.getDoorLocalAnchor(v, 'right');
    const leftW = localToWorldXZ(v, leftAnchor.lx, leftAnchor.lz);
    const rightW = localToWorldXZ(v, rightAnchor.lx, rightAnchor.lz);
    const dLeft =
      (leftW.x - state.playerPos.x) * (leftW.x - state.playerPos.x) +
      (leftW.z - state.playerPos.z) * (leftW.z - state.playerPos.z);
    const dRight =
      (rightW.x - state.playerPos.x) * (rightW.x - state.playerPos.x) +
      (rightW.z - state.playerPos.z) * (rightW.z - state.playerPos.z);

    const side: VehicleDoorSide = dRight < dLeft ? 'right' : 'left';
    const doorIndex = this.findDoorIndexForSide(v, side);
    return { side, doorIndex };
  }

  private findDoorIndexForSide(v: VehicleEntity, side: VehicleDoorSide): number {
    if (!v.doors || v.doors.length === 0) return -1;
    const exactIdx = v.doors.findIndex((d) => d.side === side && !d.detached);
    if (exactIdx >= 0) return exactIdx;
    return v.doors.findIndex((d) => !d.detached);
  }

  private chooseValidatedExitSide(v: VehicleEntity): { side: VehicleDoorSide; doorIndex: number } {
    const { groundHeightAt, resolveWorldCollisions } = this.ctx!;
    const refY = v.y ?? v.mesh.position.y;

    const trySide = (side: VehicleDoorSide): boolean => {
      const anchor = this.getDoorLocalAnchor(v, side);
      const worldPt = localToWorldXZ(v, anchor.lx, anchor.lz);
      const gy = groundHeightAt(worldPt.x, worldPt.z, refY);
      this.tmpCollisionPos.set(worldPt.x, gy, worldPt.z);
      const hit = resolveWorldCollisions(this.tmpCollisionPos, PLAYER_RADIUS);
      const disp = Math.hypot(this.tmpCollisionPos.x - worldPt.x, this.tmpCollisionPos.z - worldPt.z);
      return !hit && disp < 0.25;
    };

    const preferredSide: VehicleDoorSide = 'left';
    const fallbackSide: VehicleDoorSide = 'right';
    const chosenSide = trySide(preferredSide)
      ? preferredSide
      : trySide(fallbackSide)
      ? fallbackSide
      : preferredSide;
    return {
      side: chosenSide,
      doorIndex: this.findDoorIndexForSide(v, chosenSide),
    };
  }

  private emitDoorChanged(v: VehicleEntity, doorIndex: number, state: VehicleDoorEventState): void {
    if (!this.ctx || doorIndex < 0) return;
    const door = v.doors?.[doorIndex];
    if (door) {
      door.eventState = state;
    }
    this.ctx.events.emit('vehicleDoorChanged', {
      vehicleId: v.id,
      doorIndex,
      state,
    });
  }

  private playOpenSound(): void {
    if (!this.ctx) return;
    const { audio } = this.ctx;
    audio.unlock();
    audio.playDoorToggle();
  }

  private playCloseSound(intensity = 1): void {
    if (!this.ctx) return;
    const { audio } = this.ctx;
    audio.unlock();
    if (typeof audio.playDoorClose === 'function') {
      audio.playDoorClose(intensity);
    } else if (typeof audio.playDoorSlam === 'function') {
      audio.playDoorSlam(intensity);
    } else {
      audio.playDoorToggle();
    }
  }

  private performNpcHijackEjection(v: VehicleEntity): void {
    if (!this.ctx) return;
    const { ragdolls, transit, crowd, events, groundHeightAt } = this.ctx;
    const driverBefore = v.driver;
    if (
      driverBefore !== 'npc' &&
      driverBefore !== 'police' &&
      driverBefore !== 'bus' &&
      driverBefore !== 'ambulance'
    ) {
      return;
    }

    // Abre a porta do motorista para arrancar o NPC para fora
    const driverDoorIdx = this.findDoorIndexForSide(v, 'left');
    const driverDoor = driverDoorIdx >= 0 ? v.doors?.[driverDoorIdx] : undefined;
    if (driverDoor && !driverDoor.detached) {
      driverDoor.latched = false;
      driverDoor.ajarAngle = 0;
      driverDoor.openTimer = 0;
      driverDoor.angle = Math.max(driverDoor.angle, 0.2);
      driverDoor.angularVel = Math.max(driverDoor.angularVel, 5.6);
      driverDoor.targetAngle = Math.min(driverDoor.maxAngle * 0.92, 1.02);
      applyDoorPivotTransform(driverDoor);
      this.emitDoorChanged(v, driverDoorIdx, 'opening');
    }

    if (driverBefore === 'bus') {
      transit.releaseBusPassengersOnHijack(v, crowd, groundHeightAt);
    }

    v.driver = 'none';
    v.speed = Math.min(Math.abs(v.speed), 1.4) * (v.speed >= 0 ? 1 : -1);

    // Puxa o motorista NPC para fora reutilizando o pool de ragdoll/fuga
    const ejectAnchor = this.getDoorLocalAnchor(v, 'left');
    const ejectPos = localToWorldXZ(v, ejectAnchor.lx, ejectAnchor.lz);
    const refY = v.y ?? v.mesh.position.y;
    const groundY = groundHeightAt(ejectPos.x, ejectPos.z, refY);
    const cosH = Math.cos(v.heading);
    const sinH = Math.sin(v.heading);
    const shirtColor =
      driverBefore === 'police'
        ? 0x1e3a8a
        : driverBefore === 'ambulance'
        ? 0xe11d48
        : driverBefore === 'bus'
        ? 0x0369a1
        : 0x475569;

    ragdolls?.spawn?.({
      npcIndex: -1,
      x: ejectPos.x,
      y: groundY + 0.35,
      z: ejectPos.z,
      yaw: v.heading + Math.PI * 0.5,
      impulseX: -cosH * 4.4,
      impulseY: 2.4,
      impulseZ: sinH * 4.4,
      outcome: 'injured_recover',
      heightScale: 1,
      widthScale: 1,
      skinColor: 0xe6b89c,
      shirtColor,
      pantsColor: 0x1e293b,
    });

    crowd.triggerPanicRadius(v.x, v.z, 18);

    events.emit('crimeCommitted', {
      minStars: v.type === 'ambulance' || v.type === 'police' ? 2 : 1,
      reason: 'Veículo tomado! Polícia acionada.',
      source: 'carjack',
    });
  }

  /**
   * Alternância direta/síncrona mantida por compatibilidade com chamadas programáticas e testes legados.
   */
  public toggleVehicle(): void {
    if (!this.ctx) return;
    const { state, audio, transit, crowd, events, groundHeightAt, resolveWorldCollisions } = this.ctx;

    if (state.currentVehicle) {
      const car = state.currentVehicle;
      const seat = car.seat ?? getVehicleSpec(car.type).seat;
      const cosH = Math.cos(car.heading);
      const sinH = Math.sin(car.heading);
      const exitX = car.x + cosH * seat.exitOffsetX + sinH * seat.exitOffsetZ;
      const exitZ = car.z - sinH * seat.exitOffsetX + cosH * seat.exitOffsetZ;

      car.driver = 'none';
      state.currentVehicle = null;
      const refY = car.y ?? car.mesh.position.y;
      state.playerPos.set(exitX, groundHeightAt(exitX, exitZ, refY), exitZ);
      resolveWorldCollisions(state.playerPos, PLAYER_RADIUS);
      triggerDoorExitSwing(car);
      this.clearVehicleAccessAnim();
      this.accessPhase = 'idle';
      this.accessVehicle = null;
      audio.unlock();
      if (typeof audio.playDoorOpen === 'function') {
        audio.playDoorOpen();
      } else {
        audio.playDoorToggle();
      }
      events.emit('vehicleExited', { vehicle: car });
      return;
    }

    const nearest = this.findNearestVehicle(VEHICLE_ENTER_RADIUS);
    if (!nearest) return;

    const wasOccupiedByNpc =
      nearest.driver === 'npc' ||
      nearest.driver === 'police' ||
      nearest.driver === 'bus' ||
      nearest.driver === 'ambulance';

    if (nearest.driver === 'bus') {
      transit.releaseBusPassengersOnHijack(nearest, crowd, groundHeightAt);
    }

    nearest.driver = 'player';
    state.currentVehicle = nearest;
    triggerDoorEntryAnimation(nearest);
    this.clearVehicleAccessAnim();
    this.accessPhase = 'driving';
    this.accessVehicle = nearest;
    audio.unlock();
    if (typeof audio.playDoorOpen === 'function') {
      audio.playDoorOpen();
    } else {
      audio.playDoorToggle();
    }

    events.emit('vehicleEntered', { vehicle: nearest, wasOccupiedByNpc });

    if (wasOccupiedByNpc) {
      events.emit('crimeCommitted', {
        minStars: nearest.type === 'ambulance' || nearest.type === 'police' ? 2 : 1,
        reason: 'Veículo tomado! Polícia acionada.',
        source: 'carjack',
      });
    }
  }

  private handleInteractPressed(): void {
    if (!this.ctx) return;
    const { state, events } = this.ctx;

    // 1. Reversão ao apertar F no meio da animação de entrada ou saída
    if (this.accessPhase === 'approaching') {
      this.abortAccessToIdle(false);
      return;
    }

    if (this.accessPhase === 'doorOpening' && this.accessDirection === 'enter') {
      const veh = this.accessVehicle;
      const door = veh?.doors?.[this.accessDoorIndex];
      if (door && !door.detached) {
        door.targetAngle = 0;
        door.openTimer = 0;
        this.emitDoorChanged(veh!, this.accessDoorIndex, 'closing');
      }
      this.abortAccessToIdle(false);
      return;
    }

    if (this.accessPhase === 'boarding') {
      // Reverte no meio do embarque deslizando de volta para fora até idle
      this.accessDirection = 'exit';
      this.accessPhase = 'alighting';
      this.accessProgress = Math.max(0, Math.min(1, 1 - this.accessProgress));
      this.accessDuration = 0.36;
      return;
    }

    if (this.accessPhase === 'alighting' || (this.accessPhase === 'doorOpening' && this.accessDirection === 'exit')) {
      // Reverte saída voltando para o banco do motorista
      const wasAlighting = this.accessPhase === 'alighting';
      this.accessDirection = 'enter';
      this.accessPhase = 'boarding';
      this.accessProgress = wasAlighting ? Math.max(0, Math.min(1, 1 - this.accessProgress)) : 0.85;
      this.accessDuration = 0.36;
      return;
    }

    // 2. Pedido de saída quando já está dirigindo
    if (state.currentVehicle) {
      const car = state.currentVehicle;
      if (Math.abs(car.speed) > EXIT_MAX_SPEED) {
        events.emit('bannerRequested', {
          text: 'Pare o veículo para sair!',
          duration: 2.0,
        });
        return;
      }

      car.speed *= 0.25;
      const { side, doorIndex } = this.chooseValidatedExitSide(car);
      this.accessVehicle = car;
      this.accessSide = side;
      this.accessDoorIndex = doorIndex;
      this.accessDirection = 'exit';
      this.accessPhase = 'doorOpening';
      this.accessTimer = 0;
      this.accessProgress = 0;
      this.pendingAutoClose = null;

      const door = doorIndex >= 0 ? car.doors?.[doorIndex] : undefined;
      if (door && !door.detached) {
        door.latched = false;
        door.ajarAngle = 0;
        door.openTimer = 0;
        door.angle = Math.max(door.angle, 0.14);
        door.angularVel = Math.max(door.angularVel, 5.2);
        door.targetAngle = Math.min(door.maxAngle * 0.92, 1.02);
        applyDoorPivotTransform(door);
        this.playOpenSound();
        this.emitDoorChanged(car, doorIndex, 'opening');
      } else {
        this.playOpenSound();
      }
      return;
    }

    // 3. Pedido de entrada no veículo mais próximo
    const nearest = this.findNearestVehicle(VEHICLE_ENTER_RADIUS);
    if (!nearest) return;

    const { side, doorIndex } = this.pickClosestDoorSide(nearest);
    const anchor = this.getDoorLocalAnchor(nearest, side);
    const anchorW = localToWorldXZ(nearest, anchor.lx, anchor.lz);
    const distToAnchor = Math.hypot(anchorW.x - state.playerPos.x, anchorW.z - state.playerPos.z);

    this.accessVehicle = nearest;
    this.accessSide = side;
    this.accessDoorIndex = doorIndex;
    this.accessDirection = 'enter';
    this.accessPhase = 'approaching';
    this.accessWasOccupiedByNpc =
      nearest.driver === 'npc' ||
      nearest.driver === 'police' ||
      nearest.driver === 'bus' ||
      nearest.driver === 'ambulance';
    this.accessStartPos.copy(state.playerPos);
    this.accessStartYaw = state.playerYaw;
    this.accessProgress = 0;
    this.accessTimer = 0;
    this.accessWalkPhase = 0;
    this.accessDuration = Math.max(0.24, Math.min(0.62, 0.24 + distToAnchor * 0.18));
    this.pendingAutoClose = null;

    const va = this.ensureVehicleAccessState();
    va.active = true;
    va.vehicleId = nearest.id;
    va.x = state.playerPos.x;
    va.y = state.playerPos.y;
    va.z = state.playerPos.z;
    va.yaw = state.playerYaw;
    va.walkPhase = 0;
    va.sitBlend = 0;
    va.visible = true;
  }

  private stepAccessStateMachine(dt: number): void {
    if (!this.ctx || this.accessPhase === 'idle' || this.accessPhase === 'driving') return;
    const { state, events, groundHeightAt, resolveWorldCollisions } = this.ctx;
    const v = this.accessVehicle;
    if (!v) {
      this.abortAccessToIdle(false);
      return;
    }

    const spec = getVehicleSpec(v.type);
    const seat = v.seat ?? spec.seat;
    const refY = v.y ?? v.mesh.position.y;
    const anchor = this.getDoorLocalAnchor(v, this.accessSide);
    const anchorW = localToWorldXZ(v, anchor.lx, anchor.lz);
    const anchorGroundY = groundHeightAt(anchorW.x, anchorW.z, refY);
    const facingDoorYaw = v.heading + (this.accessSide === 'left' ? Math.PI * 0.5 : -Math.PI * 0.5);
    const door = this.accessDoorIndex >= 0 ? v.doors?.[this.accessDoorIndex] : undefined;

    if (this.accessPhase === 'approaching') {
      // Se o veículo em movimento fugir muito longe, cancela sem travar
      const distCar = Math.hypot(v.x - state.playerPos.x, v.z - state.playerPos.z);
      if (distCar > VEHICLE_ENTER_RADIUS * 2.5) {
        this.abortAccessToIdle(false);
        return;
      }

      if (this.accessWasOccupiedByNpc && Math.abs(v.speed) > 1.5) {
        v.speed = THREE.MathUtils.damp(v.speed, 0, 5.5, dt);
      }

      this.accessProgress = Math.min(1, this.accessProgress + dt / Math.max(0.05, this.accessDuration));
      const s = smoothstep01(this.accessProgress);
      const curX = THREE.MathUtils.lerp(this.accessStartPos.x, anchorW.x, s);
      const curZ = THREE.MathUtils.lerp(this.accessStartPos.z, anchorW.z, s);
      const curY = groundHeightAt(curX, curZ, refY);
      const walkYaw = Math.atan2(anchorW.x - this.accessStartPos.x, anchorW.z - this.accessStartPos.z);
      const targetYaw = this.accessProgress > 0.72 ? facingDoorYaw : walkYaw;
      this.accessWalkPhase += dt * 11;

      const va = this.ensureVehicleAccessState();
      va.active = true;
      va.vehicleId = v.id;
      va.x = curX;
      va.y = curY;
      va.z = curZ;
      va.yaw = lerpAngle(this.accessStartYaw, targetYaw, Math.min(1, s * 1.35));
      va.walkPhase = this.accessWalkPhase;
      va.sitBlend = 0;
      va.visible = true;

      if (this.accessProgress >= 1) {
        this.accessPhase = 'doorOpening';
        this.accessTimer = 0;

        if (this.accessWasOccupiedByNpc) {
          this.performNpcHijackEjection(v);
        }

        if (door && !door.detached) {
          door.latched = false;
          door.ajarAngle = 0;
          door.openTimer = 0;
          door.angle = Math.max(door.angle, 0.14);
          door.angularVel = Math.max(door.angularVel, 4.8);
          door.targetAngle = Math.min(door.maxAngle * 0.9, 0.96);
          applyDoorPivotTransform(door);
          this.playOpenSound();
          this.emitDoorChanged(v, this.accessDoorIndex, 'opening');
        } else {
          this.playOpenSound();
        }
      }
      return;
    }

    if (this.accessPhase === 'doorOpening') {
      this.accessTimer += dt;
      const noDoor = !door || door.detached;
      const doorOpenEnough = noDoor || door.angle >= 0.52 || this.accessTimer >= 0.34;

      if (this.accessDirection === 'enter') {
        const va = this.ensureVehicleAccessState();
        va.active = true;
        va.vehicleId = v.id;
        va.x = anchorW.x;
        va.y = anchorGroundY;
        va.z = anchorW.z;
        va.yaw = facingDoorYaw;
        va.sitBlend = 0;
        va.visible = true;

        if (doorOpenEnough) {
          if (door && !door.detached) {
            this.emitDoorChanged(v, this.accessDoorIndex, 'open');
          }
          this.accessPhase = 'boarding';
          this.accessProgress = 0;
          this.accessDuration = this.accessSide === 'right' ? 0.62 : 0.42;
        }
      } else {
        if (doorOpenEnough) {
          if (door && !door.detached) {
            this.emitDoorChanged(v, this.accessDoorIndex, 'open');
          }
          this.accessPhase = 'alighting';
          this.accessProgress = 0;
          this.accessDuration = 0.42;
          const driverSeatW = localToWorldXZ(v, seat.driverX, seat.driverZ);
          const va = this.ensureVehicleAccessState();
          va.active = true;
          va.vehicleId = v.id;
          va.x = driverSeatW.x;
          va.y = refY + seat.driverY - 0.55;
          va.z = driverSeatW.z;
          va.yaw = v.heading;
          va.sitBlend = 1;
          va.visible = true;
        }
      }
      return;
    }

    if (this.accessPhase === 'boarding') {
      this.accessProgress = Math.min(1, this.accessProgress + dt / Math.max(0.05, this.accessDuration));
      const p = this.accessProgress;
      const va = this.ensureVehicleAccessState();
      va.active = true;
      va.vehicleId = v.id;
      va.visible = true;

      const driverSeatW = localToWorldXZ(v, seat.driverX, seat.driverZ);
      const seatY = refY + seat.driverY - 0.55;

      if (this.accessSide === 'right') {
        // Entra pela porta do passageiro e desliza até o banco do motorista numa animação curta
        const passengerSeatW = localToWorldXZ(v, Math.abs(seat.driverX) || 0.42, seat.driverZ);
        if (p < 0.52) {
          const u = smoothstep01(p / 0.52);
          va.x = THREE.MathUtils.lerp(anchorW.x, passengerSeatW.x, u);
          va.z = THREE.MathUtils.lerp(anchorW.z, passengerSeatW.z, u);
          va.y = THREE.MathUtils.lerp(anchorGroundY, seatY, u);
          va.yaw = lerpAngle(facingDoorYaw, v.heading, u);
          va.sitBlend = u;
        } else {
          const u = smoothstep01((p - 0.52) / 0.48);
          va.x = THREE.MathUtils.lerp(passengerSeatW.x, driverSeatW.x, u);
          va.z = THREE.MathUtils.lerp(passengerSeatW.z, driverSeatW.z, u);
          va.y = seatY;
          va.yaw = v.heading;
          va.sitBlend = 1;
        }
      } else {
        const u = smoothstep01(p);
        va.x = THREE.MathUtils.lerp(anchorW.x, driverSeatW.x, u);
        va.z = THREE.MathUtils.lerp(anchorW.z, driverSeatW.z, u);
        va.y = THREE.MathUtils.lerp(anchorGroundY, seatY, u);
        va.yaw = lerpAngle(facingDoorYaw, v.heading, u);
        va.sitBlend = u;
      }

      if (this.accessProgress >= 1) {
        // Emite vehicleEntered somente ao sentar no banco do motorista
        v.driver = 'player';
        state.currentVehicle = v;
        this.clearVehicleAccessAnim();
        events.emit('vehicleEntered', {
          vehicle: v,
          wasOccupiedByNpc: this.accessWasOccupiedByNpc,
        });

        if (door && !door.detached) {
          door.openTimer = 0;
          door.targetAngle = 0;
          this.emitDoorChanged(v, this.accessDoorIndex, 'closing');
          this.accessPhase = 'doorClosing';
          this.accessTimer = 0;
        } else {
          this.accessPhase = 'driving';
        }
      }
      return;
    }

    if (this.accessPhase === 'doorClosing') {
      this.accessTimer += dt;
      if (!door || door.detached || door.latched || this.accessTimer >= 0.9) {
        if (door && !door.detached && !door.latched) {
          door.angle = 0;
          door.angularVel = 0;
          door.targetAngle = null;
          door.latched = true;
          door.recoilTimer = 0.14;
          door.recoilStrength = 0.65;
          applyDoorPivotTransform(door);
          this.playCloseSound(0.8);
        }
        if (door && !door.detached) {
          this.emitDoorChanged(v, this.accessDoorIndex, 'closed');
        }
        this.accessPhase = state.currentVehicle ? 'driving' : 'idle';
      }
      return;
    }

    if (this.accessPhase === 'alighting') {
      this.accessProgress = Math.min(1, this.accessProgress + dt / Math.max(0.05, this.accessDuration));
      const u = smoothstep01(this.accessProgress);
      const driverSeatW = localToWorldXZ(v, seat.driverX, seat.driverZ);
      const seatY = refY + seat.driverY - 0.55;
      const va = this.ensureVehicleAccessState();
      va.active = true;
      va.vehicleId = v.id;
      va.visible = true;
      va.x = THREE.MathUtils.lerp(driverSeatW.x, anchorW.x, u);
      va.z = THREE.MathUtils.lerp(driverSeatW.z, anchorW.z, u);
      va.y = THREE.MathUtils.lerp(seatY, anchorGroundY, u);
      va.yaw = lerpAngle(v.heading, facingDoorYaw, u);
      va.sitBlend = 1 - u;

      if (this.accessProgress >= 1) {
        const wasPlayerDriving = state.currentVehicle === v || v.driver === 'player';
        if (v.driver === 'player') {
          v.driver = 'none';
        }
        if (state.currentVehicle === v) {
          state.currentVehicle = null;
        }

        state.playerPos.set(anchorW.x, anchorGroundY, anchorW.z);
        resolveWorldCollisions(state.playerPos, PLAYER_RADIUS);
        state.playerYaw = facingDoorYaw;
        this.clearVehicleAccessAnim();
        this.accessPhase = 'idle';
        this.accessVehicle = null;

        if (wasPlayerDriving) {
          events.emit('vehicleExited', { vehicle: v });
        }

        if (door && !door.detached) {
          this.pendingAutoClose = {
            vehicle: v,
            doorIndex: this.accessDoorIndex,
            side: this.accessSide,
            elapsed: 0,
          };
        }
      }
    }
  }

  private stepPendingExitAutoClose(dt: number): void {
    if (!this.ctx || !this.pendingAutoClose) return;
    const { state } = this.ctx;
    const pending = this.pendingAutoClose;
    const v = pending.vehicle;
    const door = v.doors?.[pending.doorIndex];
    if (!door || door.detached || door.latched || state.currentVehicle === v) {
      this.pendingAutoClose = null;
      return;
    }

    pending.elapsed += dt;
    const anchor = this.getDoorLocalAnchor(v, pending.side);
    const anchorW = localToWorldXZ(v, anchor.lx, anchor.lz);
    const dist = Math.hypot(state.playerPos.x - anchorW.x, state.playerPos.z - anchorW.z);

    if (dist > DOOR_AUTO_CLOSE_DIST || pending.elapsed > 5.0) {
      door.openTimer = 0;
      door.targetAngle = 0;
      this.emitDoorChanged(v, pending.doorIndex, 'closing');
      this.pendingAutoClose = null;
    }
  }

  private handleDoorSlamAudio = (
    veh: VehicleEntity,
    _door: VehicleDoorState,
    impactSpeed: number
  ): void => {
    if (!this.ctx) return;
    const { state } = this.ctx;
    const dx = veh.x - state.playerPos.x;
    const dz = veh.z - state.playerPos.z;
    if (dx * dx + dz * dz < 42 * 42) {
      this.playCloseSound(Math.min(1.25, impactSpeed / 4.2));
    }
  };

  private handleDoorStateChanged = (
    veh: VehicleEntity,
    _door: VehicleDoorState,
    doorIndex: number,
    doorState: VehicleDoorEventState
  ): void => {
    this.ctx?.events.emit('vehicleDoorChanged', {
      vehicleId: veh.id,
      doorIndex,
      state: doorState,
    });
  };

  public update(dt: number): void {
    if (!this.ctx) return;
    const { state, audio, crowd, events, vehicles, weatherEffects } = this.ctx;

    const nearVehicle = state.currentVehicle ? null : this.findNearestVehicle();
    const canProcessInteract =
      state.currentVehicle !== null ||
      nearVehicle !== null ||
      this.accessPhase !== 'idle';

    if (canProcessInteract && this.input.consumeAction('interact')) {
      this.handleInteractPressed();
    }

    // Avança máquina de estados animada de embarque/desembarque
    this.stepAccessStateMachine(dt);
    this.stepPendingExitAutoClose(dt);

    // Tecla J (toggleDoors): abre/destrava ou fecha todas as portas do veículo atual ou próximo
    const doorTarget = state.currentVehicle ?? nearVehicle;
    if (doorTarget && this.input.consumeAction('toggleDoors')) {
      const result = toggleAllVehicleDoors(doorTarget);
      if (result) {
        audio.unlock();
        if (result === 'opened') {
          this.playOpenSound();
          events.emit('bannerRequested', {
            text: 'Portas destravadas! Acelere, freie ou faça curvas para sentir a física.',
            duration: 2.4,
          });
        } else {
          this.playCloseSound(0.9);
          events.emit('bannerRequested', {
            text: 'Fechando portas do veículo.',
            duration: 1.4,
          });
        }
        events.emit('vehicleDoorsToggled', { vehicle: doorTarget, action: result });
      }
    }

    const activeVehicle = state.currentVehicle;
    const isDrivingPlayer = Boolean(
      activeVehicle &&
        this.accessPhase !== 'alighting' &&
        !(this.accessPhase === 'doorOpening' && this.accessDirection === 'exit')
    );

    if (activeVehicle && isDrivingPlayer) {
      if (this.input.consumeAction('horn')) {
        audio.playHorn();
        crowd.triggerPanicRadius(activeVehicle.x, activeVehicle.z, HORN_PANIC_RADIUS);
        events.emit('hornHonked', { x: activeVehicle.x, z: activeVehicle.z });
        events.emit('bannerRequested', { text: 'Buzina! Pedestres assustados!', duration: 1.8 });
      }

      const { forward: throttle, strafe } = this.input.getMoveAxes();
      const handbrake = this.input.isHandbrakeHeld();
      const sprint = this.input.isSprinting();
      const vehicleClass = activeVehicle.class ?? getVehicleSpec(activeVehicle.type).class;
      const controller = getVehicleController(vehicleClass);

      controller.update(
        activeVehicle,
        { throttle, strafe, handbrake, sprint },
        dt,
        {
          grip: weatherEffects.grip,
          accelMult: weatherEffects.accelMult,
          brakeMult: weatherEffects.brakeMult,
          lateralDriftMult: weatherEffects.lateralDriftMult,
          groundHeightAt: this.ctx.groundHeightAt,
          resolveWorldCollisions: this.ctx.resolveWorldCollisions,
          otherVehicles: vehicles,
          onBuildingHit: (veh, impactIntensity) => {
            audio.playCollision(0.7);
            applyDoorCrashImpulse(veh, impactIntensity + 0.15, 0);
          },
          onVehicleCollision: (veh, other, intensity, nx, nz) => {
            const hitSpeed = Math.abs(veh.speed);
            const lateralDot = -(nx * Math.cos(veh.heading) - nz * Math.sin(veh.heading));
            applyDoorCrashImpulse(veh, intensity, lateralDot);
            applyDoorCrashImpulse(other, intensity, -lateralDot);
            audio.playCollision(intensity);
            crowd.triggerPanicRadius(veh.x, veh.z, 24);
            const hitPolice = other.driver === 'police';
            events.emit('vehicleCollision', {
              intensity,
              x: veh.x,
              z: veh.z,
              hitPolice,
              speed: hitSpeed,
            });
            if (hitPolice || hitSpeed > 9) {
              events.emit('crimeCommitted', {
                minStars: hitPolice ? 2 : 1,
                reason: 'Batida de trânsito! Polícia em alerta.',
                source: 'crash',
              });
            }
          },
          onDoorSlam: this.handleDoorSlamAudio,
          onDoorStateChanged: this.handleDoorStateChanged,
        }
      );

      state.playerPos.set(
        activeVehicle.x,
        activeVehicle.y ?? activeVehicle.mesh.position.y,
        activeVehicle.z
      );
    }

    // Atualiza física das dobradiças dos demais veículos e sincroniza visuais da cabine/vidros/piloto
    const qualityPreset = this.ctx.qualityPreset ?? 'medium';
    for (const v of vehicles) {
      if (!(v === activeVehicle && isDrivingPlayer)) {
        stepVehicleDoors(v, dt, this.handleDoorSlamAudio, this.handleDoorStateChanged);
      }
      const hideDriverForAnim =
        Boolean(state.vehicleAccess?.active) && state.vehicleAccess?.vehicleId === v.id;
      syncVehicleCabinVisuals(v, this.ctx.isSoftwareGl, qualityPreset, hideDriverForAnim);
    }
  }

  public dispose(): void {
    this.unsubs.forEach((u) => u());
    this.unsubs = [];
    this.clearVehicleAccessAnim();
    this.accessVehicle = null;
    this.pendingAutoClose = null;
    this.ctx = null;
  }
}
