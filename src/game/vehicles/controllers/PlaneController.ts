import { VehicleEntity } from '../../types';
import { getVehicleSpec } from '../VehicleSpecs';
import { runFixedSubsteps } from '../physics/fixedStep';
import { PlanePhysicsState, stepPlanePhysics } from '../physics/planePhysics';
import {
  resolveGroundVehicleCollisions,
  VehicleControlInput,
  VehicleController,
  VehicleControllerContext,
} from './VehicleController';

/**
 * Controlador de aviões usando física pura de voo/pista em passo fixo de 1/120 s.
 */
export class PlaneController implements VehicleController {
  public readonly vehicleClass = 'plane' as const;

  public update(
    vehicle: VehicleEntity,
    input: VehicleControlInput,
    dt: number,
    ctx: VehicleControllerContext
  ): void {
    const spec = getVehicleSpec(vehicle.type);
    const handling = vehicle.handling ?? spec.handling;
    const flightSpec = spec.flight!;
    const flightState = (vehicle.flight ??= { vy: 0, rotorSpeed: 0, throttle: 0, airborne: false });

    const groundY = ctx.groundHeightAt(vehicle.x, vehicle.z, vehicle.y ?? vehicle.mesh.position.y);
    const pitchInput = (input.sprint ? 1 : 0) - (input.handbrake ? 1 : 0);

    const physState: PlanePhysicsState = {
      x: vehicle.x,
      y: vehicle.y ?? vehicle.mesh.position.y,
      z: vehicle.z,
      vy: flightState.vy,
      heading: vehicle.heading,
      speed: vehicle.speed,
      pitch: vehicle.pitch ?? 0,
      roll: vehicle.roll ?? 0,
      propSpeed: flightState.rotorSpeed,
      airborne: flightState.airborne,
    };

    const stepResult = runFixedSubsteps(dt, vehicle.physicsAccum ?? 0, (subDt) => {
      stepPlanePhysics(
        physState,
        handling,
        flightSpec,
        {
          throttle: input.throttle,
          rollInput: input.strafe,
          pitchInput,
        },
        groundY,
        vehicle.driver === 'player',
        subDt
      );
    });

    vehicle.physicsAccum = stepResult.accumulator;
    vehicle.x = physState.x;
    vehicle.y = physState.y;
    vehicle.z = physState.z;
    vehicle.heading = physState.heading;
    vehicle.speed = physState.speed;
    vehicle.pitch = physState.pitch;
    vehicle.roll = physState.roll;
    flightState.vy = physState.vy;
    flightState.rotorSpeed = physState.propSpeed;
    flightState.airborne = physState.airborne;

    if (!vehicle.flight.airborne) {
      resolveGroundVehicleCollisions(vehicle, vehicle.y, ctx, 2.5);
    }

    vehicle.mesh.position.set(vehicle.x, vehicle.y, vehicle.z);
    vehicle.mesh.rotation.order = 'YXZ';
    vehicle.mesh.rotation.set(vehicle.pitch, vehicle.heading, vehicle.roll);

    if (vehicle.rotors && vehicle.rotors[0] && stepResult.clampedDt > 0) {
      vehicle.rotors[0].rotation.z += flightState.rotorSpeed * stepResult.clampedDt;
    }
  }
}
