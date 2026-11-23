import * as THREE from 'three';
import { VehicleEntity } from '../../types';
import { getVehicleSpec } from '../VehicleSpecs';
import { BikePhysicsState, stepBikePhysics } from '../physics/bikePhysics';
import { runFixedSubsteps } from '../physics/fixedStep';
import {
  resolveGroundVehicleCollisions,
  VehicleControlInput,
  VehicleController,
  VehicleControllerContext,
} from './VehicleController';

/**
 * Controlador de motocicletas usando física pura em passo fixo de 1/120 s.
 */
export class BikeController implements VehicleController {
  public readonly vehicleClass = 'bike' as const;

  public update(
    vehicle: VehicleEntity,
    input: VehicleControlInput,
    dt: number,
    ctx: VehicleControllerContext
  ): void {
    const spec = getVehicleSpec(vehicle.type);
    const handling = vehicle.handling ?? spec.handling;

    const physState: BikePhysicsState = {
      x: vehicle.x,
      z: vehicle.z,
      heading: vehicle.heading,
      speed: vehicle.speed,
      steerAngle: vehicle.steerAngle,
      roll: vehicle.roll ?? 0,
      pitch: vehicle.pitch ?? 0,
      damageRatio: vehicle.damageRatio ?? 0,
    };

    const prevX = vehicle.x;
    const prevZ = vehicle.z;

    const stepResult = runFixedSubsteps(dt, vehicle.physicsAccum ?? 0, (subDt) => {
      stepBikePhysics(
        physState,
        handling,
        {
          throttle: input.throttle,
          steerInput: -input.strafe,
          handbrake: input.handbrake,
          wheelie: input.sprint,
        },
        ctx.grip,
        subDt
      );
    });

    vehicle.physicsAccum = stepResult.accumulator;
    vehicle.x = physState.x;
    vehicle.z = physState.z;
    vehicle.heading = physState.heading;
    vehicle.speed = physState.speed;
    vehicle.steerAngle = physState.steerAngle;
    vehicle.roll = physState.roll;
    vehicle.pitch = physState.pitch;

    const curY = vehicle.y ?? vehicle.mesh.position.y;
    resolveGroundVehicleCollisions(vehicle, curY, ctx, 1.35);

    const groundY = ctx.groundHeightAt(vehicle.x, vehicle.z, curY);
    vehicle.y = groundY;
    vehicle.mesh.position.set(vehicle.x, groundY, vehicle.z);
    vehicle.mesh.rotation.order = 'YXZ';
    vehicle.mesh.rotation.set(vehicle.pitch, vehicle.heading, vehicle.roll);

    const wheelRadius = spec.dimensions.wheelRadius || 0.32;
    const distMoved = Math.hypot(vehicle.x - prevX, vehicle.z - prevZ) * (vehicle.speed >= 0 ? 1 : -1);
    for (const p of vehicle.frontWheelPivots) {
      p.rotation.y = vehicle.steerAngle * 0.9;
    }
    for (const wheel of vehicle.wheels) {
      wheel.rotation.x += distMoved / wheelRadius;
    }
    for (const tl of vehicle.taillights) {
      (tl.material as THREE.MeshStandardMaterial).emissiveIntensity =
        input.throttle < -0.05 || input.handbrake ? 2.8 : 1.1;
    }
  }
}
