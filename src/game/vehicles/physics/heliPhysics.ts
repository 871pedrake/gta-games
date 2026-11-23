import { VehicleFlightSpec, VehicleHandlingSpec } from '../../types';

export interface HeliPhysicsState {
  x: number;
  y: number;
  z: number;
  vy: number;
  heading: number;
  speed: number;
  pitch: number;
  roll: number;
  rotorSpeed: number;
  airborne: boolean;
}

export interface HeliPhysicsInput {
  collective: number; // -1..1 (descer / subir)
  pitchInput: number; // -1..1 (frente / trás)
  yawInput: number;   // -1..1 (guinada)
}

function damp(current: number, target: number, lambda: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-lambda * dt));
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/**
 * Integra um substep puro de dinâmica básica de helicóptero (rotação de rotor,
 * sustentação vertical, inclinação cíclica e guinada), sem Three.js.
 */
export function stepHeliPhysics(
  state: HeliPhysicsState,
  handling: VehicleHandlingSpec,
  flight: VehicleFlightSpec,
  input: HeliPhysicsInput,
  groundY: number,
  hasDriver: boolean,
  dt: number
): void {
  const maxRpm = flight.rotorRpmMax ?? 28;
  const targetRpm = hasDriver ? maxRpm * (0.72 + Math.max(0, input.collective) * 0.28) : 0;
  state.rotorSpeed = damp(state.rotorSpeed, targetRpm, hasDriver ? 2.8 : 0.85, dt);

  const rotorAuthority = clamp(state.rotorSpeed / (maxRpm * 0.55), 0, 1);

  if (hasDriver && rotorAuthority > 0.6) {
    if (Math.abs(input.collective) > 0.05) {
      state.vy += input.collective * flight.liftAccel * rotorAuthority * dt;
    } else {
      state.vy = damp(state.vy, 0, flight.hoverDamp, dt);
    }
  } else {
    state.vy -= 14.5 * dt;
  }

  state.vy = clamp(state.vy, -flight.maxClimbSpeed, flight.maxClimbSpeed);
  state.y += state.vy * dt;

  if (state.y <= groundY) {
    state.y = groundY;
    if (state.vy < 0) state.vy = 0;
  } else if (state.y > groundY + flight.maxAltitude) {
    state.y = groundY + flight.maxAltitude;
    if (state.vy > 0) state.vy = 0;
  }

  state.airborne = state.y > groundY + 0.2;

  if (hasDriver && state.airborne) {
    state.heading += input.yawInput * flight.yawRate * dt;
    const maxTilt = handling.maxLeanAngle ?? 0.36;
    const targetPitch = input.pitchInput * maxTilt;
    const targetRoll = -input.yawInput * maxTilt * 0.65;
    state.pitch = damp(state.pitch, targetPitch, 5.2, dt);
    state.roll = damp(state.roll, targetRoll, 5.2, dt);

    const targetHorizSpeed = input.pitchInput * handling.maxSpeed;
    state.speed = damp(state.speed, targetHorizSpeed, 2.4, dt);
  } else {
    state.pitch = damp(state.pitch, 0, 6.0, dt);
    state.roll = damp(state.roll, 0, 6.0, dt);
    state.speed = damp(state.speed, 0, 3.0, dt);
  }

  state.x += Math.sin(state.heading) * state.speed * dt;
  state.z += Math.cos(state.heading) * state.speed * dt;
}
