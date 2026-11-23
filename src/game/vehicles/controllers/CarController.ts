import * as THREE from 'three';
import { VEHICLE_WHEEL_RADIUS } from '../../config';
import { VehicleEntity } from '../../types';
import { getVehicleSpec } from '../VehicleSpecs';
import { applyDoorPivotTransform } from '../../systems/VehicleDoorPhysics';
import { CarPhysicsState, stepCarPhysics } from '../physics/carPhysics';
import { stepDoorsPhysics } from '../physics/doorPhysics';
import { runFixedSubsteps } from '../physics/fixedStep';
import {
  resolveGroundVehicleCollisions,
  VehicleControlInput,
  VehicleController,
  VehicleControllerContext,
} from './VehicleController';

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function dampAngle(current: number, target: number, lambda: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-lambda * dt));
}

/**
 * Controlador de carros, utilitários e variações usando modelo de bicicleta planar (1/120 s),
 * amostragem de terreno nas 4 rodas e suspensão visual com mergulho, agachamento, rolagem e quique.
 */
export class CarController implements VehicleController {
  public readonly vehicleClass = 'car' as const;

  public update(
    vehicle: VehicleEntity,
    input: VehicleControlInput,
    dt: number,
    ctx: VehicleControllerContext
  ): void {
    const spec = getVehicleSpec(vehicle.type);
    const handling = vehicle.handling ?? spec.handling;

    const physState: CarPhysicsState = {
      x: vehicle.x,
      z: vehicle.z,
      heading: vehicle.heading,
      speed: vehicle.speed,
      steerAngle: vehicle.steerAngle,
      lateralSpeed: vehicle.lateralSpeed ?? 0,
      damageRatio: vehicle.damageRatio ?? 0,
      vx: vehicle.vx ?? vehicle.speed,
      vy: vehicle.vy ?? vehicle.lateralSpeed ?? 0,
      yawRate: vehicle.yawRate ?? 0,
      longAccel: vehicle.longAccel ?? 0,
      latAccel: vehicle.latAccel ?? 0,
      gear: vehicle.gear ?? 1,
      rpmNormalized: vehicle.rpmNormalized ?? 0.2,
    };

    const prevX = vehicle.x;
    const prevZ = vehicle.z;

    const stepResult = runFixedSubsteps(dt, vehicle.physicsAccum ?? 0, (subDt) => {
      stepCarPhysics(
        physState,
        handling,
        {
          throttle: input.throttle,
          steerInput: -input.strafe,
          handbrake: input.handbrake,
        },
        {
          grip: ctx.grip,
          accelMult: ctx.accelMult,
          brakeMult: ctx.brakeMult,
          lateralDriftMult: ctx.lateralDriftMult,
        },
        subDt,
        spec.massKg
      );
    });

    vehicle.physicsAccum = stepResult.accumulator;
    vehicle.x = physState.x;
    vehicle.z = physState.z;
    vehicle.heading = physState.heading;
    vehicle.speed = physState.speed;
    vehicle.steerAngle = physState.steerAngle;
    vehicle.lateralSpeed = physState.lateralSpeed;
    vehicle.vx = physState.vx;
    vehicle.vy = physState.vy;
    vehicle.yawRate = physState.yawRate;
    vehicle.longAccel = physState.longAccel;
    vehicle.latAccel = physState.latAccel;
    vehicle.gear = physState.gear;
    vehicle.rpmNormalized = physState.rpmNormalized;

    const curY = vehicle.y ?? vehicle.mesh.position.y;
    const collisionRadius = Math.max(1.4, spec.dimensions.width * 0.72);
    resolveGroundVehicleCollisions(vehicle, curY, ctx, collisionRadius);

    // Amostragem do terreno nas 4 rodas para alinhar pitch/roll em rampas e viadutos
    const sinH = Math.sin(vehicle.heading);
    const cosH = Math.cos(vehicle.heading);
    const halfTrack = Math.max(0.65, spec.dimensions.width * 0.44);
    const axleHalf = Math.max(0.9, spec.dimensions.length / 2 - spec.dimensions.axleInset);

    const flY = ctx.groundHeightAt(
      vehicle.x - cosH * halfTrack + sinH * axleHalf,
      vehicle.z + sinH * halfTrack + cosH * axleHalf,
      curY
    );
    const frY = ctx.groundHeightAt(
      vehicle.x + cosH * halfTrack + sinH * axleHalf,
      vehicle.z - sinH * halfTrack + cosH * axleHalf,
      curY
    );
    const rlY = ctx.groundHeightAt(
      vehicle.x - cosH * halfTrack - sinH * axleHalf,
      vehicle.z + sinH * halfTrack - cosH * axleHalf,
      curY
    );
    const rrY = ctx.groundHeightAt(
      vehicle.x + cosH * halfTrack - sinH * axleHalf,
      vehicle.z - sinH * halfTrack - cosH * axleHalf,
      curY
    );

    const frontAvgY = (flY + frY) * 0.5;
    const rearAvgY = (rlY + rrY) * 0.5;
    const posXAvgY = (frY + rrY) * 0.5;
    const negXAvgY = (flY + rlY) * 0.5;
    const targetGroundY = (frontAvgY + rearAvgY) * 0.5;

    const frameDt = Math.max(0.001, stepResult.clampedDt || dt);
    let nextY = curY;
    let verticalVel = vehicle.verticalVel ?? 0;
    let bounceY = vehicle.bodyBounceY ?? 0;
    let bounceVel = vehicle.bodyBounceVelY ?? 0;

    // Detecta queda após salto de rampa e injeta quique na suspensão ao aterrissar
    if (curY > targetGroundY + 0.08 || verticalVel > 0.25) {
      verticalVel -= 18.5 * frameDt;
      nextY = curY + verticalVel * frameDt;
      if (nextY <= targetGroundY) {
        if (verticalVel < -0.9) {
          bounceVel += clamp(verticalVel * 0.38, -2.4, -0.2);
        }
        nextY = targetGroundY;
        verticalVel = 0;
      }
    } else {
      const deltaGround = targetGroundY - curY;
      if (deltaGround < -0.18) {
        verticalVel = Math.max(-1.2, deltaGround * 4.5);
        nextY = curY + verticalVel * frameDt;
        if (nextY <= targetGroundY) {
          nextY = targetGroundY;
          verticalVel = 0;
        }
      } else {
        nextY = targetGroundY;
        verticalVel = 0;
      }
    }

    const grounded = nextY <= targetGroundY + 0.09;
    const targetTerrainPitch = grounded
      ? clamp(-Math.atan2(frontAvgY - rearAvgY, axleHalf * 2), -0.45, 0.45)
      : clamp((vehicle.pitch ?? 0) * 0.985, -0.45, 0.45);
    const targetTerrainRoll = grounded
      ? clamp(Math.atan2(posXAvgY - negXAvgY, halfTrack * 2), -0.35, 0.35)
      : clamp((vehicle.roll ?? 0) * 0.985, -0.35, 0.35);

    vehicle.y = nextY;
    vehicle.verticalVel = verticalVel;
    vehicle.pitch = dampAngle(vehicle.pitch ?? 0, targetTerrainPitch, 14, frameDt);
    vehicle.roll = dampAngle(vehicle.roll ?? 0, targetTerrainRoll, 14, frameDt);

    vehicle.mesh.position.set(vehicle.x, nextY, vehicle.z);
    vehicle.mesh.rotation.set(vehicle.pitch, vehicle.heading, vehicle.roll);

    // Mola-amortecedor da carroceria (mergulho no freio, agachamento na arrancada, balanço em curva e quique)
    const pitchMult = handling.bodyPitchFactor ?? 1.0;
    const rollMult = handling.bodyRollFactor ?? 1.0;
    const longA = clamp(vehicle.longAccel ?? 0, -14, 14);
    const latA = clamp(vehicle.latAccel ?? 0, -14, 14);

    const targetBodyPitch = clamp(-longA * 0.0085 * pitchMult, -0.095, 0.095);
    const targetBodyRoll = clamp(latA * 0.0115 * rollMult, -0.14, 0.14);

    let bodyPitch = vehicle.bodyPitchOffset ?? 0;
    let bodyPitchVel = vehicle.bodyPitchVel ?? 0;
    bodyPitchVel += ((targetBodyPitch - bodyPitch) * 68 - bodyPitchVel * 11) * frameDt;
    bodyPitch = clamp(bodyPitch + bodyPitchVel * frameDt, -0.14, 0.14);

    let bodyRoll = vehicle.bodyRollOffset ?? 0;
    let bodyRollVel = vehicle.bodyRollVel ?? 0;
    bodyRollVel += ((targetBodyRoll - bodyRoll) * 58 - bodyRollVel * 9.5) * frameDt;
    bodyRoll = clamp(bodyRoll + bodyRollVel * frameDt, -0.18, 0.18);

    bounceVel += (-bounceY * 95 - bounceVel * 12) * frameDt;
    bounceY = clamp(bounceY + bounceVel * frameDt, -0.16, 0.14);

    vehicle.bodyPitchOffset = bodyPitch;
    vehicle.bodyPitchVel = bodyPitchVel;
    vehicle.bodyRollOffset = bodyRoll;
    vehicle.bodyRollVel = bodyRollVel;
    vehicle.bodyBounceY = bounceY;
    vehicle.bodyBounceVelY = bounceVel;

    if (vehicle.sprungGroup) {
      vehicle.sprungGroup.position.y = bounceY;
      vehicle.sprungGroup.rotation.set(bodyPitch, 0, bodyRoll);
    }

    // Atualiza rotação das rodas e lanternas de freio
    const wheelRadius = spec.dimensions.wheelRadius || VEHICLE_WHEEL_RADIUS;
    const distMoved = Math.hypot(vehicle.x - prevX, vehicle.z - prevZ) * (vehicle.speed >= 0 ? 1 : -1);
    for (const p of vehicle.frontWheelPivots) {
      p.rotation.y = vehicle.steerAngle * 0.9;
    }
    for (const wheel of vehicle.wheels) {
      wheel.rotation.x += distMoved / wheelRadius;
    }
    for (const tl of vehicle.taillights) {
      const m = tl.material as THREE.MeshStandardMaterial;
      m.emissiveIntensity = input.throttle < -0.05 || input.handbrake ? 2.8 : 1.1;
    }

    // Atualiza física das dobradiças das portas e sincroniza os pivôs 3D (e tampa traseira da picape)
    if (vehicle.doors && vehicle.doors.length > 0 && stepResult.clampedDt > 0) {
      stepDoorsPhysics(
        vehicle,
        stepResult.clampedDt,
        (door, impactSpeed) => {
          ctx.onDoorSlam(vehicle, door, impactSpeed);
        },
        (door, doorIndex, state) => {
          ctx.onDoorStateChanged?.(vehicle, door, doorIndex, state);
        }
      );
      for (const door of vehicle.doors) {
        applyDoorPivotTransform(door);
      }
    }

    if (vehicle.tailgatePivot) {
      const anyDoorOpen = Boolean(vehicle.doors?.some((d) => !d.latched && d.angle > 0.12));
      const targetTailgate = anyDoorOpen ? -Math.PI * 0.44 : 0;
      vehicle.tailgatePivot.rotation.x = dampAngle(
        vehicle.tailgatePivot.rotation.x,
        targetTailgate,
        10,
        frameDt
      );
    }
  }
}
