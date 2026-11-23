import { VehicleDoorEventState, VehicleDoorMechanism, VehicleDoorSide } from '../../types';

export const DOOR_SPRING_K = 60;
export const DOOR_DAMP_C = 9;
export const DOOR_OPEN_VIS_ANGLE_RAD = (2 * Math.PI) / 180;

/**
 * Estrutura numérica pura de estado de porta, sem dependência de Three.js.
 */
export interface PureDoorState {
  id: string;
  side: VehicleDoorSide;
  mechanism?: VehicleDoorMechanism;
  openSign: 1 | -1;
  angle: number;
  angularVel: number;
  targetAngle: number | null;
  maxAngle: number;
  maxSlide?: number;
  slideDistance?: number;
  latched: boolean;
  ajarAngle?: number;
  recoilTimer?: number;
  recoilStrength?: number;
  eventState?: VehicleDoorEventState;
  openTimer?: number;
  detached?: boolean;
}

export interface PureDoorVehicleState<TDoor extends PureDoorState = PureDoorState> {
  speed: number;
  heading: number;
  prevSpeed?: number;
  prevHeading?: number;
  doors?: TDoor[];
}

export function shortestAngleDiff(current: number, previous: number): number {
  let diff = current - previous;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return diff;
}

function classifyDoorEventState(door: PureDoorState): VehicleDoorEventState {
  if (door.latched && door.angle <= 0.005) return 'closed';
  if (
    !door.latched &&
    door.ajarAngle &&
    door.ajarAngle > 0.03 &&
    Math.abs(door.angle - door.ajarAngle) < 0.08 &&
    Math.abs(door.angularVel) < 0.45 &&
    door.targetAngle === null
  ) {
    return 'ajar';
  }
  if ((door.targetAngle !== null && door.targetAngle <= 0.01) || door.angularVel < -0.3) {
    return 'closing';
  }
  if (door.angle >= door.maxAngle * 0.72 && Math.abs(door.angularVel) < 0.6) {
    return 'open';
  }
  if (door.angularVel > 0.2 || (door.targetAngle !== null && door.targetAngle > door.angle + 0.04)) {
    return 'opening';
  }
  if (door.angle <= 0.02) return 'closed';
  return door.ajarAngle && door.ajarAngle > 0.03 ? 'ajar' : 'open';
}

function syncDoorSlideDistance(door: PureDoorState): void {
  if (door.mechanism === 'sliding') {
    const maxSlide = door.maxSlide ?? 0.9;
    const ratio = door.maxAngle > 0.001 ? Math.max(0, Math.min(1, door.angle / door.maxAngle)) : 0;
    door.slideDistance = ratio * maxSlide;
  } else {
    door.slideDistance = 0;
  }
}

/**
 * Simula física pura de dobradiça/corrediça (mola-amortecedor k≈60 c≈9, batente em 0° com tranco,
 * inércia de aceleração longitudinal, frenagem, força centrífuga e porta entreaberta após batida lateral)
 * sem nenhuma dependência de Three.js.
 */
export function stepDoorsPhysics<TDoor extends PureDoorState>(
  vehicle: PureDoorVehicleState<TDoor>,
  dt: number,
  onSlam?: (door: TDoor, impactSpeed: number) => void,
  onStateChanged?: (door: TDoor, doorIndex: number, state: VehicleDoorEventState) => void
): void {
  const doors = vehicle.doors;
  if (!doors || doors.length === 0) {
    vehicle.prevSpeed = vehicle.speed;
    vehicle.prevHeading = vehicle.heading;
    return;
  }

  const safeDt = Math.max(0.001, Math.min(dt, 0.05));
  const prevSpeed = vehicle.prevSpeed ?? vehicle.speed;
  const prevHeading = vehicle.prevHeading ?? vehicle.heading;

  // Aceleração longitudinal e taxa de guinada para gerar torques inerciais nas portas
  const longAccel = (vehicle.speed - prevSpeed) / safeDt;
  const yawRate = shortestAngleDiff(vehicle.heading, prevHeading) / safeDt;
  const centrifugal = vehicle.speed * yawRate;

  vehicle.prevSpeed = vehicle.speed;
  vehicle.prevHeading = vehicle.heading;

  for (let i = 0; i < doors.length; i++) {
    const door = doors[i];
    if (door.detached) continue;

    if (door.recoilTimer !== undefined && door.recoilTimer > 0) {
      door.recoilTimer = Math.max(0, door.recoilTimer - safeDt);
    }

    // Temporizador usado ao entrar no veículo para fechar a porta após o embarque
    if (door.openTimer !== undefined && door.openTimer > 0) {
      door.openTimer = Math.max(0, door.openTimer - safeDt);
      if (door.openTimer === 0) {
        door.targetAngle = 0;
      }
    }

    if (door.targetAngle !== null) {
      // Mola-amortecedor angular (k=60, c=9) puxando a porta até o alvo
      const accel = (door.targetAngle - door.angle) * DOOR_SPRING_K - door.angularVel * DOOR_DAMP_C;
      door.angularVel += accel * safeDt;
      door.angle += door.angularVel * safeDt;

      if (door.targetAngle <= 0.001 && door.angle <= 0.028) {
        const closingImpact = Math.max(0.9, Math.abs(door.angularVel));
        door.angle = 0;
        door.angularVel = 0;
        door.targetAngle = null;
        door.latched = true;
        door.ajarAngle = 0;
        door.recoilTimer = 0.14;
        door.recoilStrength = Math.min(1, closingImpact / 4.2);
        onSlam?.(door, closingImpact);
      } else if (
        door.targetAngle > 0.05 &&
        Math.abs(door.angle - door.targetAngle) < 0.012 &&
        Math.abs(door.angularVel) < 0.25 &&
        (door.openTimer ?? 0) <= 0
      ) {
        door.angle = door.targetAngle;
        door.angularVel = 0;
        door.targetAngle = null;
      }
    } else if (door.latched) {
      door.angle = 0;
      door.angularVel = 0;
    } else {
      const sideSign = door.side === 'left' ? -1 : 1;
      const sinA = Math.sin(door.angle);
      const cosA = Math.cos(door.angle);
      const minStop = Math.max(0, door.ajarAngle ?? 0);

      if (door.mechanism === 'sliding') {
        // Porta de correr da van desliza no trilho lateral (~0,9 m) com amortecimento de rolamento
        const torqueLongSlide = longAccel * 0.14;
        const torqueDampSlide = -door.angularVel * 3.4;
        const detentPull =
          minStop > 0.02 && door.angle < minStop + 0.08
            ? (minStop - door.angle) * (DOOR_SPRING_K * 0.35) - door.angularVel * 3.2
            : 0;
        door.angularVel += (torqueLongSlide + torqueDampSlide + detentPull) * safeDt;
      } else {
        // Acelerar para frente fecha portas dianteiras; frear forte empurra para abrir
        const longFactor = longAccel < 0 ? Math.max(0.24, sinA) : sinA;
        const torqueLong = -longAccel * 0.44 * longFactor;

        // Força centrífuga nas curvas: virar à esquerda abre a porta direita e fecha a esquerda
        const torqueCentrifugal = centrifugal * sideSign * 0.28 * cosA;

        // Arrasto aerodinâmico em movimento para frente empurra a porta fechando
        const torqueWind =
          vehicle.speed > 2.5 ? -vehicle.speed * Math.abs(vehicle.speed) * 0.015 * sinA : 0;

        // Batente elástico próximo à abertura máxima (~65°) + atrito da dobradiça
        const strapStart = door.maxAngle * 0.86;
        const torqueStrap = door.angle > strapStart ? -(door.angle - strapStart) * 18 : 0;
        const torqueDamping = -door.angularVel * 2.2;

        // Se a porta foi danificada lateralmente, mola suave mantém entreaberta em torno de ajarAngle
        const torqueAjar =
          minStop > 0.02 && door.angle < minStop + 0.14
            ? (minStop - door.angle) * (DOOR_SPRING_K * 0.4) - door.angularVel * 3.0
            : 0;

        door.angularVel +=
          (torqueLong + torqueCentrifugal + torqueWind + torqueStrap + torqueDamping + torqueAjar) * safeDt;
      }

      door.angle += door.angularVel * safeDt;

      if (door.angle >= door.maxAngle) {
        door.angle = door.maxAngle;
        if (door.angularVel > 0) {
          door.angularVel = -door.angularVel * 0.34;
        }
      } else if (minStop > 0.02 && door.angle <= minStop) {
        door.angle = minStop;
        if (door.angularVel < 0) {
          door.angularVel = -door.angularVel * 0.26;
        }
      } else if (door.angle <= 0) {
        const closingSpeed = -door.angularVel;
        door.angle = 0;
        if (closingSpeed >= 0.85) {
          door.angularVel = 0;
          door.latched = true;
          door.recoilTimer = 0.14;
          door.recoilStrength = Math.min(1, closingSpeed / 4.2);
          onSlam?.(door, closingSpeed);
        } else {
          door.angularVel = closingSpeed * 0.22;
          door.recoilTimer = 0.07;
          door.recoilStrength = 0.35;
        }
      }
    }

    syncDoorSlideDistance(door);

    const nextState = classifyDoorEventState(door);
    if (nextState !== door.eventState) {
      door.eventState = nextState;
      onStateChanged?.(door, i, nextState);
    }
  }
}

export function triggerDoorEntryPhysics(vehicle: PureDoorVehicleState, side: VehicleDoorSide = 'left'): void {
  const targetDoor =
    vehicle.doors?.find((d) => d.side === side && !d.detached) ??
    vehicle.doors?.find((d) => d.side === 'left' && !d.detached);
  if (!targetDoor) return;
  targetDoor.latched = false;
  targetDoor.ajarAngle = 0;
  targetDoor.angle = Math.max(targetDoor.angle, 0.16);
  targetDoor.angularVel = 3.8;
  targetDoor.targetAngle = Math.min(targetDoor.maxAngle * 0.85, 0.94);
  targetDoor.openTimer = 0.28;
  syncDoorSlideDistance(targetDoor);
}

export function triggerDoorExitPhysics(vehicle: PureDoorVehicleState, side: VehicleDoorSide = 'left'): void {
  const targetDoor =
    vehicle.doors?.find((d) => d.side === side && !d.detached) ??
    vehicle.doors?.find((d) => d.side === 'left' && !d.detached);
  if (!targetDoor) return;
  targetDoor.latched = false;
  targetDoor.ajarAngle = 0;
  targetDoor.targetAngle = null;
  targetDoor.openTimer = 0;
  targetDoor.angle = Math.max(targetDoor.angle, 0.18);
  targetDoor.angularVel = Math.max(targetDoor.angularVel, 5.2);
  syncDoorSlideDistance(targetDoor);
}

export function toggleDoorsPhysics(vehicle: PureDoorVehicleState): 'opened' | 'closed' | null {
  const doors = vehicle.doors?.filter((d) => !d.detached);
  if (!doors || doors.length === 0) return null;

  const anyUnlatchedOrOpen = doors.some((d) => !d.latched || d.angle > 0.08);
  if (anyUnlatchedOrOpen) {
    for (const door of doors) {
      door.openTimer = 0;
      door.ajarAngle = 0;
      if (door.latched && door.angle <= 0.01) continue;
      door.targetAngle = 0;
    }
    return 'closed';
  }

  doors.forEach((door, idx) => {
    door.latched = false;
    door.ajarAngle = 0;
    door.targetAngle = null;
    door.openTimer = 0;
    door.angle = 0.12;
    door.angularVel = 4.6 + idx * 0.55;
    syncDoorSlideDistance(door);
  });
  return 'opened';
}

export function applyDoorCrashPhysics(
  vehicle: PureDoorVehicleState,
  intensity: number,
  lateralBias = 0
): void {
  const doors = vehicle.doors?.filter((d) => !d.detached);
  if (!doors || doors.length === 0 || intensity < 0.25) return;

  const clamped = Math.max(0.25, Math.min(1.5, intensity));
  const heavyLateral = clamped >= 0.65 && Math.abs(lateralBias) >= 0.25;

  for (const door of doors) {
    const isHitSide =
      clamped >= 0.52 ||
      (lateralBias === 0 && door.side === 'left') ||
      (lateralBias < 0 && door.side === 'left') ||
      (lateralBias > 0 && door.side === 'right');

    if (door.latched && !isHitSide) continue;

    door.latched = false;
    door.targetAngle = null;
    door.openTimer = 0;
    if (heavyLateral && isHitSide) {
      door.ajarAngle = Math.max(door.ajarAngle ?? 0, Math.min(0.28, 0.14 + (clamped - 0.65) * 0.18));
    }
    if (door.angle < 0.05) {
      door.angle = 0.07;
    }
    door.angularVel += 2.2 + clamped * 4.2;
    syncDoorSlideDistance(door);
  }
}
