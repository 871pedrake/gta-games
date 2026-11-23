import { VehicleHandlingSpec } from '../../types';

export interface CarPhysicsState {
  x: number;
  z: number;
  heading: number;
  speed: number;
  steerAngle: number;
  lateralSpeed: number;
  damageRatio: number;
  /** Estado interno do modelo bicicleta planar */
  vx?: number;
  vy?: number;
  yawRate?: number;
  longAccel?: number;
  latAccel?: number;
  gear?: number;
  rpmNormalized?: number;
}

export interface CarPhysicsInput {
  throttle: number;
  steerInput: number;
  handbrake: boolean;
}

export interface CarPhysicsEnv {
  grip: number;
  accelMult: number;
  brakeMult: number;
  lateralDriftMult: number;
}

export interface GearTorqueResult {
  gear: number;
  rpmNormalized: number;
  driveForce: number;
}

const GRAVITY = 9.81;
const GEAR_MAX_SPEED_RATIOS = [0.24, 0.44, 0.65, 0.85, 1.05] as const;
const GEAR_TORQUE_RATIOS = [1.05, 0.8, 0.6, 0.46, 0.36] as const;

function dampValue(current: number, target: number, lambda: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-lambda * dt));
}

function clampValue(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/**
 * Calcula marcha ativa (1..5), RPM normalizado e força tratora do motor pela curva de torque.
 * Função pura sem dependências do Three.js.
 */
export function computeEngineDriveForce(
  vx: number,
  throttle: number,
  spec: VehicleHandlingSpec,
  massKg: number,
  perfFactor: number,
  accelMult: number
): GearTorqueResult {
  const effectiveMaxSpeed = Math.max(8, spec.maxSpeed * perfFactor);
  const forwardSpeed = Math.max(0, vx);
  const speedRatio = clampValue(forwardSpeed / effectiveMaxSpeed, 0, 1.1);

  let gear = 1;
  for (let i = 0; i < GEAR_MAX_SPEED_RATIOS.length; i++) {
    gear = i + 1;
    if (speedRatio <= GEAR_MAX_SPEED_RATIOS[i]) break;
  }

  const prevRatio = gear === 1 ? 0 : GEAR_MAX_SPEED_RATIOS[gear - 2] * 0.72;
  const topRatio = GEAR_MAX_SPEED_RATIOS[gear - 1];
  const rpmNormalized = clampValue(
    0.22 + ((speedRatio - prevRatio) / Math.max(0.12, topRatio - prevRatio)) * 0.78,
    0.2,
    1.0
  );

  if (throttle <= 0.05) {
    return { gear, rpmNormalized, driveForce: 0 };
  }

  // Curva de torque realista com pico em médias rotações e redução por relação de marcha
  const torqueBell = 1.15 - 0.78 * Math.pow(rpmNormalized - 0.6, 2);
  const gearMultiplier = GEAR_TORQUE_RATIOS[gear - 1];
  const powerScale = spec.powerKw ? clampValue(spec.powerKw / (massKg * 0.115), 0.84, 1.25) : 1.0;

  // Limite suave próximo à velocidade máxima efetiva
  const topEndTaper =
    forwardSpeed > effectiveMaxSpeed * 0.96
      ? clampValue(
          1 - (forwardSpeed - effectiveMaxSpeed * 0.96) / Math.max(1.2, effectiveMaxSpeed * 0.08),
          0,
          1
        )
      : 1;

  const baseForce = massKg * spec.accel * perfFactor * accelMult;
  const driveForce =
    baseForce *
    throttle *
    torqueBell *
    gearMultiplier *
    (0.76 + 0.24 * powerScale) *
    topEndTaper;

  return { gear, rpmNormalized, driveForce };
}

/**
 * Integra um substep puro de dinâmica veicular usando modelo de bicicleta planar dinâmico:
 * estado local (vx, vy, yawRate), curva de torque/marchas, arrasto quadrático, rolagem,
 * distribuição de freio, freio de mão no eixo traseiro, transferência longitudinal de carga,
 * força lateral saturante por ângulo de deriva e elipse de atrito nos eixos dianteiro e traseiro.
 */
export function stepCarPhysics(
  state: CarPhysicsState,
  spec: VehicleHandlingSpec,
  input: CarPhysicsInput,
  env: CarPhysicsEnv,
  dt: number,
  massKg = 1480
): void {
  const safeDt = Math.max(0.0001, Math.min(dt, 0.05));
  const mass = Math.max(450, massKg);
  const wheelbase = Math.max(1.6, spec.wheelbase ?? 2.65);
  const frontRatio = clampValue(spec.frontAxleRatio ?? 0.52, 0.36, 0.68);
  const lf = wheelbase * (1 - frontRatio);
  const lr = wheelbase * frontRatio;
  const cgHeight = clampValue(spec.cgHeight ?? 0.48, 0.28, 1.25);
  const iz = Math.max(400, 0.27 * mass * wheelbase * wheelbase);

  const drivetrain = spec.drivetrain ?? 'RWD';
  const perfFactor = clampValue(1 - state.damageRatio * 0.45, 0.35, 1);
  const effectiveMaxSpeed = Math.max(8, spec.maxSpeed * perfFactor);
  const grip = Math.max(0.25, env.grip);

  let vx = state.vx ?? state.speed;
  let vy = state.vy ?? state.lateralSpeed;
  let yawRate = state.yawRate ?? 0;

  // Esterço sensível à velocidade: reduz o ângulo máximo em alta velocidade para estabilidade
  const steerFade = Math.max(12, spec.steerSpeedFade ?? 22);
  const speedSteerScale = 1 / (1 + Math.pow(Math.abs(vx) / steerFade, 1.35));
  const targetSteer = input.steerInput * spec.maxSteerAngle * speedSteerScale;
  state.steerAngle = dampValue(state.steerAngle, targetSteer, spec.steerRate + 3.5 * grip, safeDt);
  const delta = state.steerAngle;

  // Transferência de carga longitudinal (usando aceleração longitudinal do substep anterior)
  const prevAx = clampValue(state.longAccel ?? 0, -14, 14);
  const weightTransfer = (mass * prevAx * cgHeight) / wheelbase;
  const staticFrontN = mass * GRAVITY * (lr / wheelbase);
  const staticRearN = mass * GRAVITY * (lf / wheelbase);
  const nf = clampValue(staticFrontN - weightTransfer, 0.16 * mass * GRAVITY, 0.84 * mass * GRAVITY);
  const nr = clampValue(staticRearN + weightTransfer, 0.16 * mass * GRAVITY, 0.84 * mass * GRAVITY);

  // Motor, marchas e distribuição de tração FWD / RWD / AWD
  const throttle = clampValue(input.throttle, -1, 1);
  const engine = computeEngineDriveForce(vx, throttle, spec, mass, perfFactor, env.accelMult);

  let fxFrontDrive = 0;
  let fxRearDrive = 0;
  if (engine.driveForce > 0) {
    if (drivetrain === 'FWD') {
      fxFrontDrive = engine.driveForce;
    } else if (drivetrain === 'RWD') {
      fxRearDrive = engine.driveForce;
    } else {
      fxFrontDrive = engine.driveForce * 0.45;
      fxRearDrive = engine.driveForce * 0.55;
    }
  } else if (throttle < -0.05) {
    if (vx > 0.65) {
      // Frenagem de serviço distribuída (65% dianteira / 35% traseira)
      const brakeForce = mass * spec.brakeAccel * env.brakeMult * Math.abs(throttle);
      fxFrontDrive = -brakeForce * 0.65;
      fxRearDrive = -brakeForce * 0.35;
    } else if (vx > -spec.reverseSpeed) {
      // Marcha à ré
      const revForce = mass * spec.accel * 0.68 * perfFactor * env.accelMult * Math.abs(throttle);
      if (drivetrain === 'FWD') fxFrontDrive = -revForce;
      else if (drivetrain === 'RWD') fxRearDrive = -revForce;
      else {
        fxFrontDrive = -revForce * 0.45;
        fxRearDrive = -revForce * 0.55;
      }
    }
  } else if (!input.handbrake && Math.abs(vx) > 0.05) {
    // Freio-motor suave quando solta o acelerador
    const engineBrake = -Math.sign(vx) * mass * spec.coastDamp * 0.48 * Math.min(1, Math.abs(vx) / 6);
    fxRearDrive += engineBrake;
  }

  // Freio de mão trava o eixo traseiro (permite iniciar drift em curvas)
  if (input.handbrake && Math.abs(vx) > 0.08) {
    const hbForce = -Math.sign(vx) * mass * spec.handbrakeDamp * env.brakeMult * 1.35;
    fxRearDrive += hbForce;
  }

  // Arrasto aerodinâmico quadrático calibrado à força de 5ª marcha + resistência de rolagem
  const rollingRes = mass * GRAVITY * 0.015 * Math.tanh(vx / 0.25);
  const fifthGearCruiseForce =
    mass * spec.accel * perfFactor * env.accelMult * GEAR_TORQUE_RATIOS[4] * 0.88 -
    mass * GRAVITY * 0.015;
  const aeroCoeff = Math.max(120, fifthGearCruiseForce) / (effectiveMaxSpeed * effectiveMaxSpeed);
  const aeroDrag = aeroCoeff * vx * Math.abs(vx);

  // Ângulos de deriva dianteiro e traseiro + saturação de pneu
  const vReg = Math.max(2.6, Math.abs(vx));
  const weatherDriftPenalty = 1 - clampValue(env.lateralDriftMult, 0, 0.7) * 0.36;
  const muLatBase = 1.18 * grip * weatherDriftPenalty;
  const muLongBase = Math.max(1.55 * grip, (spec.accel / GRAVITY) * 1.15 * grip);

  const muFrontLat = muLatBase * (spec.frontGrip ?? 1.0);
  const muRearLat = muLatBase * (spec.rearGrip ?? 1.0) * (input.handbrake ? 0.16 : 1.0);
  const muFrontLong = muLongBase * (spec.frontGrip ?? 1.0);
  const muRearLong = muLongBase * (spec.rearGrip ?? 1.0);

  const driftBias = clampValue(spec.driftFactor, 0.5, 1.5);
  const cornerStiffness = clampValue(5.0 / Math.sqrt(driftBias), 3.6, 6.2);

  const alphaFront = Math.atan2(vx * Math.sin(delta) - (vy + lf * yawRate) * Math.cos(delta), vReg);
  const alphaRear = Math.atan2(-(vy - lr * yawRate), vReg);

  const fxFrontCap = muFrontLong * nf;
  const fyFrontCap = muFrontLat * nf;
  const fxRearCap = muRearLong * nr;
  const fyRearCap = muRearLat * nr;

  const fyFrontRaw = fyFrontCap * Math.tanh(cornerStiffness * alphaFront);
  const fyRearRaw = fyRearCap * Math.tanh(cornerStiffness * alphaRear);

  // Elipse/círculo de atrito em cada eixo (tração/frenagem e curva dividem a aderência do pneu)
  let fxf = fxFrontDrive;
  let fyf = fyFrontRaw;
  const frontUtil = Math.hypot(fxf / Math.max(1, fxFrontCap), fyf / Math.max(1, fyFrontCap));
  if (frontUtil > 1) {
    fxf /= frontUtil;
    fyf /= frontUtil;
  }

  let fxr = fxRearDrive;
  let fyr = fyRearRaw;
  const rearUtil = Math.hypot(fxr / Math.max(1, fxRearCap), fyr / Math.max(1, fyRearCap));
  if (rearUtil > 1) {
    fxr /= rearUtil;
    fyr /= rearUtil;
  }

  // Somatório de forças e momento de guinada no referencial do veículo
  const fxTotal = fxf * Math.cos(delta) - fyf * Math.sin(delta) + fxr - aeroDrag - rollingRes;
  const fyTotal = fyf * Math.cos(delta) + fxf * Math.sin(delta) + fyr;
  const yawTorque = lf * (fyf * Math.cos(delta) + fxf * Math.sin(delta)) - lr * fyr;

  const axBody = fxTotal / mass;
  const ayBody = fyTotal / mass;

  const dvx = axBody + yawRate * vy;
  const dvy = ayBody - yawRate * vx;
  const dyaw = yawTorque / iz;

  vx += dvx * safeDt;
  vy += dvy * safeDt;
  yawRate += dyaw * safeDt;

  // Evita micro-deslizamento residual quando o carro está praticamente parado sem comando
  if (Math.abs(vx) < 0.28 && Math.abs(throttle) < 0.05) {
    vx = dampValue(vx, 0, 10, safeDt);
    vy = dampValue(vy, 0, 12, safeDt);
    yawRate = dampValue(yawRate, 0, 12, safeDt);
  } else if (Math.abs(vx) < 1.5) {
    vy = dampValue(vy, 0, 5.5, safeDt);
  }

  vx = clampValue(vx, -spec.reverseSpeed, effectiveMaxSpeed * 1.02);
  vy = clampValue(vy, -12.5, 12.5);
  yawRate = clampValue(yawRate, -3.6, 3.6);

  state.vx = vx;
  state.vy = vy;
  state.yawRate = yawRate;
  state.longAccel = axBody;
  state.latAccel = ayBody;
  state.gear = engine.gear;
  state.rpmNormalized = engine.rpmNormalized;

  state.speed = vx;
  state.lateralSpeed = vy;

  state.heading += yawRate * safeDt;
  const rightX = Math.cos(state.heading);
  const rightZ = -Math.sin(state.heading);
  state.x += (Math.sin(state.heading) * vx + rightX * vy) * safeDt;
  state.z += (Math.cos(state.heading) * vx - rightZ * vy) * safeDt;
}
