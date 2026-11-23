import * as THREE from 'three';
import { VEHICLE_COLLISION_MIN_DIST, VEHICLE_COLLISION_RADIUS } from '../../config';
import { VehicleClass, VehicleDoorEventState, VehicleDoorState, VehicleEntity } from '../../types';
import { getVehicleSpec } from '../VehicleSpecs';

export interface VehicleControlInput {
  throttle: number;
  strafe: number;
  handbrake: boolean;
  sprint: boolean;
}

export interface VehicleControllerContext {
  grip: number;
  accelMult: number;
  brakeMult: number;
  lateralDriftMult: number;
  groundHeightAt: (x: number, z: number, refY?: number) => number;
  resolveWorldCollisions: (pos: THREE.Vector3, radius: number) => boolean;
  otherVehicles: VehicleEntity[];
  onBuildingHit: (vehicle: VehicleEntity, impactIntensity: number) => void;
  onVehicleCollision: (
    vehicle: VehicleEntity,
    other: VehicleEntity,
    intensity: number,
    nx: number,
    nz: number
  ) => void;
  onDoorSlam: (vehicle: VehicleEntity, door: VehicleDoorState, impactSpeed: number) => void;
  onDoorStateChanged?: (
    vehicle: VehicleEntity,
    door: VehicleDoorState,
    doorIndex: number,
    state: VehicleDoorEventState
  ) => void;
}

/**
 * Interface comum para todos os controladores por classe de veículo.
 */
export interface VehicleController {
  readonly vehicleClass: VehicleClass;
  update(
    vehicle: VehicleEntity,
    input: VehicleControlInput,
    dt: number,
    ctx: VehicleControllerContext
  ): void;
}

const _tmpColPos = new THREE.Vector3();

function getWorldVelocityXZ(v: VehicleEntity): { vxWorld: number; vzWorld: number } {
  const fwd = v.vx ?? v.speed;
  const lat = v.vy ?? v.lateralSpeed ?? 0;
  const sinH = Math.sin(v.heading);
  const cosH = Math.cos(v.heading);
  return {
    vxWorld: sinH * fwd + cosH * lat,
    vzWorld: cosH * fwd - sinH * lat,
  };
}

function applyWorldDeltaVelocityXZ(v: VehicleEntity, dvxWorld: number, dvzWorld: number): void {
  const sinH = Math.sin(v.heading);
  const cosH = Math.cos(v.heading);
  const dFwd = sinH * dvxWorld + cosH * dvzWorld;
  const dLat = cosH * dvxWorld - sinH * dvzWorld;
  const nextFwd = (v.vx ?? v.speed) + dFwd;
  const nextLat = (v.vy ?? v.lateralSpeed ?? 0) + dLat;
  v.speed = nextFwd;
  v.vx = nextFwd;
  v.lateralSpeed = nextLat;
  v.vy = nextLat;
}

/**
 * Resolve colisões com prédios e outros veículos no plano XZ usando impulso proporcional à massa.
 */
export function resolveGroundVehicleCollisions(
  vehicle: VehicleEntity,
  curY: number,
  ctx: VehicleControllerContext,
  radius = VEHICLE_COLLISION_RADIUS
): void {
  _tmpColPos.set(vehicle.x, curY, vehicle.z);
  const hitBuilding = ctx.resolveWorldCollisions(_tmpColPos, radius);
  vehicle.x = _tmpColPos.x;
  vehicle.z = _tmpColPos.z;
  if (hitBuilding && Math.abs(vehicle.speed) > 4) {
    const impactIntensity = Math.min(1.3, Math.abs(vehicle.speed) / Math.max(12, vehicle.maxSpeed));
    vehicle.speed *= -0.32;
    vehicle.vx = vehicle.speed;
    vehicle.lateralSpeed = 0;
    vehicle.vy = 0;
    ctx.onBuildingHit(vehicle, impactIntensity);
  }

  const m1 = Math.max(150, getVehicleSpec(vehicle.type).massKg);

  for (const other of ctx.otherVehicles) {
    if (other === vehicle) continue;
    if (Math.abs((other.y ?? other.mesh.position.y) - curY) > 2.4) continue;
    const dx = vehicle.x - other.x;
    const dz = vehicle.z - other.z;
    const dist = Math.hypot(dx, dz);
    const minSep = Math.max(VEHICLE_COLLISION_MIN_DIST, (vehicle.halfWidth + other.halfWidth) * 1.15);

    if (dist < minSep && dist > 0.001) {
      const nx = dx / dist;
      const nz = dz / dist;
      const overlap = minSep - dist;
      const m2 = Math.max(150, getVehicleSpec(other.type).massKg);
      const totalMass = m1 + m2;
      const share1 = m2 / totalMass;
      const share2 = m1 / totalMass;

      // Separação proporcional à massa inversa (carro leve cede mais que caminhão/ônibus)
      vehicle.x += nx * overlap * share1;
      vehicle.z += nz * overlap * share1;
      other.x -= nx * overlap * share2;
      other.z -= nz * overlap * share2;

      const v1 = getWorldVelocityXZ(vehicle);
      const v2 = getWorldVelocityXZ(other);
      const vRelN = (v1.vxWorld - v2.vxWorld) * nx + (v1.vzWorld - v2.vzWorld) * nz;

      if (vRelN < -0.2) {
        const restitution = 0.35;
        const impulseMag = (-(1 + restitution) * vRelN) / (1 / m1 + 1 / m2);
        applyWorldDeltaVelocityXZ(vehicle, (impulseMag / m1) * nx, (impulseMag / m1) * nz);
        applyWorldDeltaVelocityXZ(other, (-impulseMag / m2) * nx, (-impulseMag / m2) * nz);
      }

      const relApproachSpeed = Math.max(Math.abs(vRelN), Math.abs(vehicle.speed));
      if (relApproachSpeed > 6) {
        const intensity = Math.min(1.5, relApproachSpeed / Math.max(1, vehicle.maxSpeed));
        ctx.onVehicleCollision(vehicle, other, intensity, nx, nz);
      }
    }
  }
}
