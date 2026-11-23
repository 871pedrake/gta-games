import { VehicleEntity } from '../../types';
import { getVehicleSpec } from '../VehicleSpecs';
import { runFixedSubsteps } from '../physics/fixedStep';
import { HeliPhysicsState, stepHeliPhysics } from '../physics/heliPhysics';
import {
  VehicleControlInput,
  VehicleController,
  VehicleControllerContext,
} from './VehicleController';

/**
 * Controlador de helicópteros usando física pura de voo em passo fixo de 1/120 s.
 */
export class HeliController implements VehicleController {
  public readonly vehicleClass = 'heli' as const;

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
    const collective = (input.sprint ? 1 : 0) - (input.handbrake ? 1 : 0);

    const physState: HeliPhysicsState = {
      x: vehicle.x,
      y: vehicle.y ?? vehicle.mesh.position.y,
      z: vehicle.z,
      vy: flightState.vy,
      heading: vehicle.heading,
      speed: vehicle.speed,
      pitch: vehicle.pitch ?? 0,
      roll: vehicle.roll ?? 0,
      rotorSpeed: flightState.rotorSpeed,
      airborne: flightState.airborne,
    };

    const stepResult = runFixedSubsteps(dt, vehicle.physicsAccum ?? 0, (subDt) => {
      stepHeliPhysics(
        physState,
        handling,
        flightSpec,
        {
          collective,
          pitchInput: input.throttle,
          yawInput: -input.strafe,
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
    flightState.rotorSpeed = physState.rotorSpeed;
    flightState.airborne = physState.airborne;

    vehicle.mesh.position.set(vehicle.x, vehicle.y, vehicle.z);
    vehicle.mesh.rotation.order = 'YXZ';
    vehicle.mesh.rotation.set(vehicle.pitch, vehicle.heading, vehicle.roll);

    if (vehicle.rotors && stepResult.clampedDt > 0) {
      if (vehicle.rotors[0]) vehicle.rotors[0].rotation.y += flightState.rotorSpeed * stepResult.clampedDt;
      if (vehicle.rotors[1]) vehicle.rotors[1].rotation.x += flightState.rotorSpeed * 1.4 * stepResult.clampedDt;
    }
  }
}
