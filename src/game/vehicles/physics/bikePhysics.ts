import { VehicleHandlingSpec } from '../../types';

export interface BikePhysicsState {
  x: number;
  z: number;
  heading: number;
  speed: number;
  steerAngle: number;
  roll: number;
  pitch: number;
  damageRatio: number;
}

export interface BikePhysicsInput {
  throttle: number;
  steerInput: number;
  handbrake: boolean;
  wheelie?: boolean;
}

function damp(current: number, target: number, lambda: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-lambda * dt));
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/**
 * Integra um substep puro de dinâmica de motocicleta (aceleração rápida, inclinação
 * lateral nas curvas e leve empinada/mergulho de suspensão), sem Three.js.
 */
export function stepBikePhysics(
  state: BikePhysicsState,
  spec: VehicleHandlingSpec,
  input: BikePhysicsInput,
  grip: number,
  dt: number
): void {
  const perfFactor = 1 - state.damageRatio * 0.35;
  const maxSpd = spec.maxSpeed * perfFactor;
  const accel = spec.accel * perfFactor;

  if (input.throttle > 0.05) {
    state.speed += accel * input.throttle * dt;
  } else if (input.throttle < -0.05) {
    const decel = state.speed > 1 ? spec.brakeAccel : accel * 0.45;
    state.speed += decel * input.throttle * dt;
  } else {
    state.speed = damp(state.speed, 0, spec.coastDamp, dt);
  }

  if (input.handbrake) {
    state.speed = damp(state.speed, 0, spec.handbrakeDamp, dt);
  }

  state.speed = clamp(state.speed, -spec.reverseSpeed, maxSpd);

  const targetSteer = input.steerInput * spec.maxSteerAngle;
  state.steerAngle = damp(state.steerAngle, targetSteer, spec.steerRate, dt);

  const speedFactor = clamp(Math.abs(state.speed) / 6.0, 0, 1);
  const reverseSign = state.speed >= 0 ? 1 : -1;
  state.heading += state.steerAngle * spec.turnRate * speedFactor * (0.78 + 0.22 * grip) * reverseSign * dt;

  // Inclinação lateral proporcional ao esterço e à velocidade
  const maxLean = spec.maxLeanAngle ?? 0.54;
  const leanTarget = -state.steerAngle * (maxLean / Math.max(0.1, spec.maxSteerAngle)) * speedFactor;
  state.roll = damp(state.roll, leanTarget, 9.5, dt);

  // Arfagem sutil ao acelerar (empina) ou frear (mergulha)
  const targetPitch =
    input.wheelie && state.speed > 6
      ? -0.22
      : input.throttle > 0.2 && state.speed > 2
      ? -0.05
      : input.throttle < -0.2 && state.speed > 2
      ? 0.07
      : 0;
  state.pitch = damp(state.pitch, targetPitch, 8.0, dt);

  state.x += Math.sin(state.heading) * state.speed * dt;
  state.z += Math.cos(state.heading) * state.speed * dt;
}
