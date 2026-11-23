import { MAX_SIMULATED_INJURED } from './config';
import { GameEventMap, TypedEventBus } from './core/EventBus';
import { CrowdManager } from './CrowdManager';
import { PedestrianAI } from './PedestrianAI';
import { ActiveRagdoll, RagdollOutcome, RagdollPool } from './RagdollPool';
import { VehicleEntity } from './types';

export interface ImpactEventsResult {
  hitStopSec: number;
  cameraShake: number;
  wantedIncrease: number;
  bannerMessage: string | null;
  playImpactSound: boolean;
  impactStrength: number;
}

/**
 * Sistema de colisões carro × NPC:
 * - Apenas impactos reais do jogador (absSpd >= 3.5) contabilizam feridos e disparam ragdoll.
 * - Tráfego NPC (carros, ônibus, polícia, ambulância) freia e faz o pedestre desviar em vez de atropelar em massa.
 * - Teto rígido de 30 feridos simultâneos (MAX_SIMULATED_INJURED), acelerando recuperação/fade do excedente.
 */
export class ImpactSystem {
  public injuredTotalCount = 0;
  private recentHitStreak = 0;
  private streakDecayTimer = 0;

  // Buffers pré-alocados para evitar realocações
  private readonly footQueryBuf: number[] = [];
  private readonly carQueryBuf: number[] = [];
  private readonly witnessQueryBuf: number[] = [];
  private readonly dominoQueryBuf: number[] = [];

  public update(
    dt: number,
    vehicles: VehicleEntity[],
    playerCar: VehicleEntity | null,
    playerPos: { x: number; z: number },
    crowd: CrowdManager,
    ragdolls: RagdollPool,
    events?: TypedEventBus<GameEventMap>
  ): ImpactEventsResult {
    const result: ImpactEventsResult = {
      hitStopSec: 0,
      cameraShake: 0,
      wantedIncrease: 0,
      bannerMessage: null,
      playImpactSound: false,
      impactStrength: 0,
    };

    if (this.streakDecayTimer > 0) {
      this.streakDecayTimer -= dt;
      if (this.streakDecayTimer <= 0) {
        this.recentHitStreak = 0;
      }
    }

    // 1. Colisão leve jogador a pé × NPC (empurrão suave sem ferimentos)
    if (!playerCar) {
      const nearby = crowd.queryRadiusIndices(playerPos.x, playerPos.z, 2.0, this.footQueryBuf);
      for (let k = 0; k < nearby.length; k++) {
        const npc = crowd.agents[nearby[k]];
        if (!npc.active || npc.insideBuilding || npc.ragdollActive || npc.injuryStatus === 'out') continue;
        const dx = npc.x - playerPos.x;
        const dz = npc.z - playerPos.z;
        const d2 = dx * dx + dz * dz;
        if (d2 < 0.85 && d2 > 0.0001) {
          const d = Math.sqrt(d2);
          const push = (0.92 - d) * 1.4;
          npc.x += (dx / d) * push;
          npc.z += (dz / d) * push;
        }
      }
    }

    // 2. Colisão carro × NPC usando a grade espacial
    for (const car of vehicles) {
      const absSpd = Math.abs(car.speed);
      if (absSpd < 2.2) continue;

      const isPlayerDriving = car === playerCar;
      const sinH = Math.sin(car.heading);
      const cosH = Math.cos(car.heading);
      const queryR = isPlayerDriving ? car.halfLength + 1.4 : car.halfLength + 4.4;
      const candidates = crowd.queryRadiusIndices(car.x, car.z, queryR, this.carQueryBuf);

      for (let k = 0; k < candidates.length; k++) {
        const npc = crowd.agents[candidates[k]];
        if (!npc.active || npc.insideBuilding || npc.ragdollActive || npc.injuryStatus === 'out') continue;

        const dx = npc.x - car.x;
        const dz = npc.z - car.z;
        const localZ = dx * sinH + dz * cosH;
        const localX = dx * cosH - dz * sinH;

        if (!isPlayerDriving) {
          // Veículos NPC freiam e acionam esquiva do pedestre em vez de causar atropelamentos falsos
          if (
            Math.abs(localX) <= car.halfWidth + 0.95 &&
            localZ > -0.8 &&
            localZ < car.halfLength + 4.2
          ) {
            npc.triggerDodge(car.x, car.z, sinH * car.speed, cosH * car.speed);
            car.speed *= 0.84;
          }
          continue;
        }

        // Apenas impacto real do jogador (velocidade >= 3.5) conta como ferido
        if (absSpd < 3.5) {
          if (
            Math.abs(localX) <= car.halfWidth + 0.55 &&
            Math.abs(localZ) <= car.halfLength + 0.55
          ) {
            npc.triggerDodge(car.x, car.z, sinH * car.speed, cosH * car.speed);
          }
          continue;
        }

        if (
          Math.abs(localX) <= car.halfWidth + 0.42 &&
          Math.abs(localZ) <= car.halfLength + 0.42
        ) {
          this.handlePlayerCarHitsNpc(car, npc, absSpd, sinH, cosH, crowd, ragdolls, result, events);
        }
      }
    }

    return result;
  }

  /**
   * Trata ragdoll em alta velocidade derrubando outros NPCs (efeito dominó), respeitando o limite de 30 feridos.
   */
  public handleRagdollHitsNpc(
    ragdoll: ActiveRagdoll,
    crowd: CrowdManager,
    ragdolls: RagdollPool
  ): void {
    if (crowd.activeInjuredCount >= MAX_SIMULATED_INJURED) return;

    const candidates = crowd.queryRadiusIndices(ragdoll.x, ragdoll.z, 1.35, this.dominoQueryBuf);
    for (let k = 0; k < candidates.length; k++) {
      const npc = crowd.agents[candidates[k]];
      if (
        !npc.active ||
        npc.index === ragdoll.npcIndex ||
        npc.insideBuilding ||
        npc.ragdollActive ||
        npc.injuryStatus === 'out'
      ) {
        continue;
      }

      const d2 = (npc.x - ragdoll.x) ** 2 + (npc.z - ragdoll.z) ** 2;
      if (d2 < 0.9) {
        if (npc.injuryStatus === 'healthy') {
          this.injuredTotalCount++;
        }
        npc.ragdollActive = true;
        npc.health = Math.max(15, npc.health - 18);
        npc.injuryStatus = 'injured';
        npc.injuredByPlayer = true;
        npc.injuredTimer = 0;
        ragdolls.spawn(
          {
            npcIndex: npc.index,
            x: npc.x,
            y: npc.y,
            z: npc.z,
            yaw: npc.yaw,
            impulseX: ragdoll.vx * 0.55,
            impulseY: 2.8,
            impulseZ: ragdoll.vz * 0.55,
            outcome: 'injured_recover',
            heightScale: npc.heightScale,
            widthScale: npc.widthScale,
            skinColor: npc.skinColor,
            shirtColor: npc.shirtColor,
            pantsColor: npc.pantsColor,
          },
          (oldIdx) => crowd.agents[oldIdx]?.resetToHealthy()
        );
        break;
      }
    }
  }

  private handlePlayerCarHitsNpc(
    car: VehicleEntity,
    npc: PedestrianAI,
    absSpd: number,
    sinH: number,
    cosH: number,
    crowd: CrowdManager,
    ragdolls: RagdollPool,
    result: ImpactEventsResult,
    events?: TypedEventBus<GameEventMap>
  ): void {
    // Mantém teto de 30 feridos simultâneos acelerando fade do excedente
    if (crowd.activeInjuredCount >= MAX_SIMULATED_INJURED) {
      ragdolls.accelerateOldestFade();
      crowd.enforceInjuredCap(MAX_SIMULATED_INJURED - 1);
    }

    const massFactor =
      car.type === 'bus'
        ? 5.0
        : car.type === 'ambulance'
        ? 4.2
        : car.type === 'police'
        ? 4.1
        : car.type === 'sports'
        ? 3.8
        : 3.4;
    const damage = absSpd * massFactor;

    if (npc.injuryStatus === 'healthy') {
      this.injuredTotalCount++;
    }

    npc.health -= damage;
    npc.ragdollActive = true;
    npc.injuredByPlayer = true;
    npc.injuredTimer = 0;

    let outcome: RagdollOutcome = 'injured_recover';
    if (npc.health <= 0) {
      npc.health = 0;
      npc.injuryStatus = 'out';
      outcome = 'out';
    } else if (npc.health <= 28) {
      npc.injuryStatus = 'unconscious';
      outcome = 'unconscious';
    } else {
      npc.injuryStatus = 'injured';
      outcome = 'injured_recover';
    }

    const forwardSign = car.speed >= 0 ? 1 : -1;
    const sideJitter = (Math.random() - 0.5) * 4.5;
    const impX = sinH * absSpd * forwardSign * 0.85 + cosH * sideJitter;
    const impZ = cosH * absSpd * forwardSign * 0.85 - sinH * sideJitter;
    const impY = Math.min(11.5, 2.6 + absSpd * 0.34);

    ragdolls.spawn(
      {
        npcIndex: npc.index,
        x: npc.x,
        y: npc.y,
        z: npc.z,
        yaw: npc.yaw,
        impulseX: impX,
        impulseY: impY,
        impulseZ: impZ,
        outcome,
        heightScale: npc.heightScale,
        widthScale: npc.widthScale,
        skinColor: npc.skinColor,
        shirtColor: npc.shirtColor,
        pantsColor: npc.pantsColor,
      },
      (oldIdx) => crowd.agents[oldIdx]?.resetToHealthy()
    );

    const carDamage = Math.min(26, absSpd * 0.85);
    car.maxHealth = car.maxHealth ?? 100;
    car.health = Math.max(20, (car.health ?? 100) - carDamage);
    car.damageRatio = 1 - car.health / car.maxHealth;
    car.speed *= 0.84;

    const bodyChild = car.mesh.children[2];
    if (bodyChild) {
      bodyChild.rotation.z = (car.damageRatio ?? 0) * 0.06 * (Math.random() < 0.5 ? 1 : -1);
      bodyChild.rotation.x = (car.damageRatio ?? 0) * 0.04;
    }

    const witnesses = crowd.queryRadiusIndices(npc.x, npc.z, 20, this.witnessQueryBuf);
    let policeReported = false;
    for (let w = 0; w < witnesses.length; w++) {
      const wit = crowd.agents[witnesses[w]];
      if (!wit.active || wit.index === npc.index || wit.ragdollActive || wit.insideBuilding) continue;
      wit.triggerFlee(car.x, car.z, 1.0);
      if (!policeReported && (wit.personality === 'fearful' || wit.personality === 'curious')) {
        policeReported = true;
      }
    }

    this.recentHitStreak++;
    this.streakDecayTimer = 10.0;

    const hitStopSec = absSpd > 9 ? 0.05 : 0.03;
    const cameraShake = Math.min(0.65, 0.16 + absSpd * 0.02);
    const impactStrength = Math.min(1, absSpd / 28);
    let wantedIncrease = 1;
    let bannerMessage = 'Atropelamento! Cuidado com a polícia!';

    if (this.recentHitStreak >= 4) {
      wantedIncrease = 3;
      bannerMessage = 'Múltiplos atropelamentos! Procurado nível 3!';
    } else if (this.recentHitStreak >= 2 || policeReported) {
      wantedIncrease = 2;
      bannerMessage = 'Testemunha acionou a polícia!';
    }

    result.hitStopSec = Math.max(result.hitStopSec, hitStopSec);
    result.cameraShake = Math.max(result.cameraShake, cameraShake);
    result.playImpactSound = true;
    result.impactStrength = Math.max(result.impactStrength, impactStrength);
    result.wantedIncrease = Math.max(result.wantedIncrease, wantedIncrease);
    result.bannerMessage = bannerMessage;

    events?.emit('vehicleHitPedestrian', {
      npcIndex: npc.index,
      vehicleId: car.id,
      speed: absSpd,
      isPlayer: true,
      outcome,
      wantedIncrease,
      hitStopSec,
      cameraShake,
      impactStrength,
      bannerMessage,
    });
  }
}
