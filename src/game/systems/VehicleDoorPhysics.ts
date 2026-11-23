import { VehicleDoorEventState, VehicleDoorSide, VehicleDoorState, VehicleEntity } from '../types';
import {
  applyDoorCrashPhysics,
  stepDoorsPhysics,
  toggleDoorsPhysics,
  triggerDoorEntryPhysics,
  triggerDoorExitPhysics,
} from '../vehicles/physics/doorPhysics';

/**
 * Aplica a transformação 3D adequada ao mecanismo da porta (dobradiça comum, tesoura horizontal ou corrediça 0,9 m).
 */
export function applyDoorPivotTransform(door: VehicleDoorState): void {
  if (door.detached) {
    door.pivot.visible = false;
    return;
  }

  // Pequeno tranco amortecido no batente de 0° ao fechar
  const recoil =
    door.recoilTimer && door.recoilTimer > 0
      ? Math.sin((0.14 - door.recoilTimer) * 92) *
        (door.recoilStrength ?? 0.5) *
        0.032 *
        (door.recoilTimer / 0.14)
      : 0;

  if (door.mechanism === 'sliding') {
    const maxSlide = door.maxSlide ?? 0.9;
    const slide =
      door.slideDistance ??
      (door.maxAngle > 0.001 ? (door.angle / door.maxAngle) * maxSlide : 0);
    if (door.restPosZ !== undefined) {
      door.pivot.position.z = door.restPosZ - slide;
    }
    if (door.restPosX !== undefined) {
      door.pivot.position.x =
        door.restPosX + (door.angle > 0.02 ? (door.side === 'right' ? 0.045 : -0.045) : 0);
    }
    door.pivot.rotation.set(0, 0, recoil);
  } else if (door.mechanism === 'scissor') {
    // Porta tesoura do esportivo gira no eixo horizontal (X) elevando a folha para cima com leve abertura lateral
    door.pivot.rotation.x = door.angle;
    door.pivot.rotation.y = door.openSign * (door.angle * 0.14 + recoil);
  } else {
    door.pivot.rotation.x = 0;
    door.pivot.rotation.y = door.openSign * (door.angle + recoil);
  }
}

/**
 * Sincroniza o ângulo físico da dobradiça/corrediça com os pivôs Three.js do veículo.
 */
export function stepVehicleDoors(
  vehicle: VehicleEntity,
  dt: number,
  onSlam?: (vehicle: VehicleEntity, door: VehicleDoorState, impactSpeed: number) => void,
  onStateChanged?: (
    vehicle: VehicleEntity,
    door: VehicleDoorState,
    doorIndex: number,
    state: VehicleDoorEventState
  ) => void
): void {
  stepDoorsPhysics(
    vehicle,
    dt,
    (door, impactSpeed) => {
      onSlam?.(vehicle, door as VehicleDoorState, impactSpeed);
    },
    (door, doorIndex, state) => {
      onStateChanged?.(vehicle, door as VehicleDoorState, doorIndex, state);
    }
  );

  if (vehicle.tailgatePivot) {
    const anyOpen = Boolean(vehicle.doors?.some((d) => !d.latched && d.angle > 0.12));
    const targetTailgate = anyOpen ? -Math.PI * 0.44 : 0;
    const blend = 1 - Math.exp(-10 * Math.max(0.001, Math.min(dt, 0.05)));
    vehicle.tailgatePivot.rotation.x +=
      (targetTailgate - vehicle.tailgatePivot.rotation.x) * blend;
  }

  if (!vehicle.doors) return;
  for (const door of vehicle.doors) {
    applyDoorPivotTransform(door);
  }
}

export function triggerDoorEntryAnimation(
  vehicle: VehicleEntity,
  side: VehicleDoorSide = 'left'
): void {
  triggerDoorEntryPhysics(vehicle, side);
  vehicle.doors?.forEach(applyDoorPivotTransform);
}

export function triggerDoorExitSwing(
  vehicle: VehicleEntity,
  side: VehicleDoorSide = 'left'
): void {
  triggerDoorExitPhysics(vehicle, side);
  vehicle.doors?.forEach(applyDoorPivotTransform);
}

export function toggleAllVehicleDoors(vehicle: VehicleEntity): 'opened' | 'closed' | null {
  const res = toggleDoorsPhysics(vehicle);
  vehicle.doors?.forEach(applyDoorPivotTransform);
  return res;
}

export function applyDoorCrashImpulse(
  vehicle: VehicleEntity,
  intensity: number,
  lateralBias = 0
): void {
  applyDoorCrashPhysics(vehicle, intensity, lateralBias);
  vehicle.doors?.forEach(applyDoorPivotTransform);
}
