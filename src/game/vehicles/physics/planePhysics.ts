import { VehicleFlightSpec, VehicleHandlingSpec } from '../../types';

export interface PlanePhysicsState {
  x: number;
  y: number;
  z: number;
  vy: number;
  heading: number;
  speed: number;
  pitch: number;
  roll: number;
  propSpeed: number;
  airborne: boolean;
}

export interface PlanePhysicsInput {
  throttle: number;  // -1..1
  rollInput: number; // -1..1
  pitchInput: number; // -1..1
}

function damp(current: number, target: number, lambda: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-lambda * dt));
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/**
 * Integra um substep puro de dinâmica básica de avião (empuxo de hélice, sustentação
 * acima da velocidade de decolagem, estol e rolagem coordenada), sem Three.js.
 */
export function stepPlanePhysics(
  state: PlanePhysicsState,
  handling: VehicleHandlingSpec,
  flight: VehicleFlightSpec,
  input: PlanePhysicsInput,
  groundY: number,
  hasDriver: boolean,
  dt: number
): void {
  const maxProp = flight.propRpmMax ?? 42;
  const targetProp = hasDriver ? maxProp * (0.3 + Math.max(0, input.throttle) * 0.7) : 0;
  state.propSpeed = damp(state.propSpeed, targetProp, hasDriver ? 3.0 : 1.0, dt);

  if (hasDriver) {
    if (input.throttle > 0.05) {
      state.speed += handling.accel * input.throttle * dt;
    } else if (input.throttle < -0.05) {
      const brake = state.airborne ? handling.accel * 0.45 : handling.brakeAccel;
      state.speed += brake * input.throttle * dt;
    } else {
      state.speed = damp(state.speed, 0, handling.coastDamp, dt);
    }
  } else {
    state.speed = damp(state.speed, 0, handling.coastDamp * 1.8, dt);
  }

  state.speed = clamp(state.speed, -handling.reverseSpeed, handling.maxSpeed);

  const airborneSpeed = Math.max(0, state.speed);
  const liftFactor = clamp(airborneSpeed / Math.max(1, flight.takeoffSpeed), 0, 1.35);

  if (hasDriver && airborneSpeed >= flight.takeoffSpeed * 0.75) {
    const maxRoll = handling.maxLeanAngle ?? 0.68;
    const targetRoll = -input.rollInput * maxRoll;
    state.roll = damp(state.roll, targetRoll, 4.5, dt);
    state.heading += -state.roll * flight.yawRate * dt;

    const targetPitch = input.pitchInput * 0.42;
    state.pitch = damp(state.pitch, targetPitch, 4.2, dt);

    const climbForce = Math.sin(state.pitch) * airborneSpeed * 0.65 + (liftFactor - 1.0) * 6.5;
    state.vy = damp(state.vy, clamp(climbForce, -flight.maxClimbSpeed, flight.maxClimbSpeed), 3.0, dt);
  } else {
    state.roll = damp(state.roll, 0, 5.0, dt);
    state.pitch = damp(state.pitch, 0, 5.0, dt);
    state.heading += input.rollInput * handling.turnRate * clamp(Math.abs(state.speed) / 6, 0, 1) * dt;
    state.vy -= 14.0 * dt;
  }

  state.y += state.vy * dt;
  if (state.y <= groundY) {
    state.y = groundY;
    if (state.vy < 0) state.vy = 0;
  } else if (state.y > groundY + flight.maxAltitude) {
    state.y = groundY + flight.maxAltitude;
    if (state.vy > 0) state.vy = 0;
  }

  state.airborne = state.y > groundY + 0.25;
  state.x += Math.sin(state.heading) * state.speed * dt;
  state.z += Math.cos(state.heading) * state.speed * dt;
}
