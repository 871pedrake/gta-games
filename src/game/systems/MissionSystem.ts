import {
  CASH_PICKUP_RADIUS,
  CASH_PICKUP_RESPAWN_SEC,
  MISSION_1_DROPOFF_RADIUS,
  MISSION_1_REWARD,
  MISSION_2_BRIEFCASE_RADIUS,
  MISSION_2_DROPOFF_RADIUS,
  MISSION_2_REWARD,
  MISSION_TRIGGER_RADIUS,
} from '../config';
import { GameEventMap, TypedEventBus } from '../core/EventBus';
import { EngineContext, GameSystem } from '../core/SystemLifecycle';
import { CashPickup, MissionId, MissionStatus, VehicleEntity } from '../types';
import { WorldRegistry } from '../world/WorldRegistry';

const MISSION_POINTS = WorldRegistry.missionPoints;

export interface MissionWorldVisuals {
  objectiveBeaconVisible: (visible: boolean) => void;
  setObjectiveBeaconPos: (x: number, y: number, z: number) => void;
  briefcaseVisible: (visible: boolean) => void;
  rotateBeacons?: (dt: number) => void;
}

/**
 * Gerencia gatilhos, etapas e conclusão das Missões 1 e 2, além da coleta de dinheiro no mapa.
 * Suporta execução integrada ao EngineContext ou headless em testes Vitest.
 */
export class MissionSystem implements GameSystem {
  public readonly name = 'MissionSystem';

  public status: MissionStatus = {
    id: 'none',
    step: 0,
    title: 'Modo Livre',
    objective: 'Explore a orla, colete dinheiro ou entre no marcador rosa/ciano.',
    targetPos: null,
    completedMissions: [],
  };

  private ctx: EngineContext | null = null;
  private bus: TypedEventBus<GameEventMap> | null = null;
  private visuals: MissionWorldVisuals | null = null;
  private unsubs: Array<() => void> = [];
  private addMoneyFn: ((amount: number) => void) | null = null;

  constructor(
    bus?: TypedEventBus<GameEventMap>,
    visuals?: MissionWorldVisuals,
    addMoneyFn?: (amount: number) => void
  ) {
    this.bus = bus ?? null;
    this.visuals = visuals ?? null;
    this.addMoneyFn = addMoneyFn ?? null;
    if (this.bus) {
      this.bindBus(this.bus);
    }
  }

  public init(ctx: EngineContext): void {
    this.ctx = ctx;
    this.bus = ctx.events;
    this.addMoneyFn = (amount) => {
      ctx.state.money += amount;
    };
    this.visuals = {
      objectiveBeaconVisible: (v) => {
        ctx.world.objectiveBeacon.visible = v;
      },
      setObjectiveBeaconPos: (x, y, z) => {
        ctx.world.objectiveBeacon.position.set(x, y, z);
      },
      briefcaseVisible: (v) => {
        ctx.world.briefcaseMesh.visible = v;
      },
      rotateBeacons: (dt) => {
        ctx.world.mission1StartBeacon.rotation.y += dt * 1.2;
        ctx.world.mission2StartBeacon.rotation.y += dt * 1.2;
        ctx.world.objectiveBeacon.rotation.y += dt * 2.2;
        ctx.world.briefcaseMesh.rotation.y += dt * 2.4;
      },
    };
    this.bindBus(ctx.events);
  }

  private bindBus(bus: TypedEventBus<GameEventMap>): void {
    this.unsubs.forEach((u) => u());
    this.unsubs = [];

    this.unsubs.push(
      bus.on('vehicleEntered', ({ vehicle }) => {
        this.onPlayerEnteredVehicle(vehicle, this.ctx?.state.missionCar ?? null);
      })
    );

    this.unsubs.push(
      bus.on('busted', () => {
        if (this.status.id !== 'none') {
          this.startMission('none');
        }
      })
    );
  }

  public setCompletedMissions(completed: string[]): void {
    this.status = {
      ...this.status,
      completedMissions: [...completed],
    };
  }

  public startMission(id: MissionId, missionCar?: VehicleEntity | null, currentVehicle?: VehicleEntity | null): void {
    this.ctx?.audio.unlock();
    const mCar = missionCar ?? this.ctx?.state.missionCar ?? null;
    const curCar = currentVehicle ?? this.ctx?.state.currentVehicle ?? null;

    if (id === 'none') {
      this.status = {
        id: 'none',
        step: 0,
        title: 'Modo Livre',
        objective: 'Explore a orla, colete dinheiro ou entre no marcador rosa/ciano.',
        targetPos: null,
        completedMissions: this.status.completedMissions,
      };
      this.visuals?.objectiveBeaconVisible(false);
      this.visuals?.briefcaseVisible(false);
      this.bus?.emit('missionStarted', { missionId: 'none' });
      return;
    }

    if (id === 'mission1') {
      if (mCar && curCar !== mCar) {
        mCar.x = MISSION_POINTS.m1CarSpawn.x;
        mCar.z = MISSION_POINTS.m1CarSpawn.z;
        mCar.heading = MISSION_POINTS.m1CarSpawn.heading;
        mCar.speed = 0;
        mCar.driver = 'none';
        mCar.mesh.position.set(mCar.x, 0, mCar.z);
        mCar.mesh.rotation.y = mCar.heading;
      }
      const targetPos = {
        x: mCar?.x ?? MISSION_POINTS.m1CarSpawn.x,
        z: mCar?.z ?? MISSION_POINTS.m1CarSpawn.z,
      };
      this.status = {
        id: 'mission1',
        step: 1,
        title: 'Missão 1: Carga Quente',
        objective: 'Entre no Solara GT rosa (tecla F) próximo à Garagem Central.',
        targetPos,
        completedMissions: this.status.completedMissions,
      };
      this.visuals?.setObjectiveBeaconPos(targetPos.x, 0, targetPos.z);
      this.visuals?.objectiveBeaconVisible(true);
      this.visuals?.briefcaseVisible(false);
      this.bus?.emit('missionStarted', { missionId: 'mission1' });
      this.bus?.emit('bannerRequested', {
        text: 'Missão 1 iniciada: Pegue o Solara GT rosa!',
        duration: 4.0,
      });
    } else if (id === 'mission2') {
      this.status = {
        id: 'mission2',
        step: 1,
        title: 'Missão 2: Maleta da Orla',
        objective: 'Vá até o Quiosque na praia leste e pegue a maleta ciano.',
        targetPos: { ...MISSION_POINTS.m2Briefcase },
        completedMissions: this.status.completedMissions,
      };
      this.visuals?.setObjectiveBeaconPos(MISSION_POINTS.m2Briefcase.x, -0.2, MISSION_POINTS.m2Briefcase.z);
      this.visuals?.objectiveBeaconVisible(true);
      this.visuals?.briefcaseVisible(true);
      this.bus?.emit('missionStarted', { missionId: 'mission2' });
      this.bus?.emit('bannerRequested', {
        text: 'Missão 2 iniciada: Recolha a maleta no quiosque da praia!',
        duration: 4.0,
      });
    }
  }

  public onPlayerEnteredVehicle(vehicle: VehicleEntity | { isMissionTarget?: boolean }, missionCar?: VehicleEntity | null): void {
    const isTarget = vehicle === missionCar || Boolean(vehicle.isMissionTarget);
    if (this.status.id === 'mission1' && this.status.step === 1 && isTarget) {
      this.status.step = 2;
      this.status.objective = 'Leve o Solara GT até a Marina do Píer (marcador amarelo).';
      this.status.targetPos = { ...MISSION_POINTS.m1Dropoff };
      this.visuals?.setObjectiveBeaconPos(MISSION_POINTS.m1Dropoff.x, 0, MISSION_POINTS.m1Dropoff.z);
      this.visuals?.objectiveBeaconVisible(true);
      this.bus?.emit('missionStepUpdated', { missionId: 'mission1', step: 2 });
      this.bus?.emit('crimeCommitted', {
        minStars: 1,
        reason: 'Carga Quente! Polícia na cola até a Marina.',
        source: 'mission',
      });
    }
  }

  public update(dt: number): void {
    if (!this.ctx) return;
    this.visuals?.rotateBeacons?.(dt);
    this.updatePickups(dt, this.ctx.world.pickups, this.ctx.state.playerPos);
    this.stepMission(
      this.ctx.state.playerPos,
      this.ctx.state.currentVehicle,
      this.ctx.state.missionCar
    );
  }

  public updatePickups(
    dt: number,
    pickups: CashPickup[],
    playerPos: { x: number; z: number }
  ): void {
    for (const p of pickups) {
      if (p.collected) {
        p.respawnTimer -= dt;
        if (p.respawnTimer <= 0) {
          p.collected = false;
          p.mesh.visible = true;
        }
        continue;
      }

      p.mesh.rotation.y += dt * 1.8;
      const dist = Math.hypot(p.x - playerPos.x, p.z - playerPos.z);
      if (dist < CASH_PICKUP_RADIUS) {
        p.collected = true;
        p.mesh.visible = false;
        p.respawnTimer = CASH_PICKUP_RESPAWN_SEC;
        this.addMoneyFn?.(p.value);
        this.ctx?.audio.playCashPickup();
        this.bus?.emit('cashCollected', { pickupId: p.id, amount: p.value });
        this.bus?.emit('bannerRequested', { text: `+$${p.value} coletados!`, duration: 2.2 });
      }
    }
  }

  public stepMission(
    playerPos: { x: number; z: number },
    currentVehicle: VehicleEntity | { isMissionTarget?: boolean } | null,
    missionCar: VehicleEntity | null
  ): void {
    if (this.status.id === 'none') {
      const d1 = Math.hypot(
        playerPos.x - MISSION_POINTS.m1Trigger.x,
        playerPos.z - MISSION_POINTS.m1Trigger.z
      );
      const d2 = Math.hypot(
        playerPos.x - MISSION_POINTS.m2Trigger.x,
        playerPos.z - MISSION_POINTS.m2Trigger.z
      );
      if (d1 < MISSION_TRIGGER_RADIUS) this.startMission('mission1', missionCar, currentVehicle as VehicleEntity | null);
      else if (d2 < MISSION_TRIGGER_RADIUS) this.startMission('mission2', missionCar, currentVehicle as VehicleEntity | null);
      return;
    }

    if (this.status.id === 'mission1' && this.status.step === 2) {
      const dDrop = Math.hypot(
        playerPos.x - MISSION_POINTS.m1Dropoff.x,
        playerPos.z - MISSION_POINTS.m1Dropoff.z
      );
      const drivingTarget =
        currentVehicle !== null &&
        (currentVehicle === missionCar || Boolean(currentVehicle.isMissionTarget));
      if (dDrop < MISSION_1_DROPOFF_RADIUS && drivingTarget) {
        this.completeMission('mission1', MISSION_1_REWARD, 'MISSÃO 1 CONCLUÍDA! +$1.500');
      }
    } else if (this.status.id === 'mission2') {
      if (this.status.step === 1) {
        const dCase = Math.hypot(
          playerPos.x - MISSION_POINTS.m2Briefcase.x,
          playerPos.z - MISSION_POINTS.m2Briefcase.z
        );
        if (dCase < MISSION_2_BRIEFCASE_RADIUS) {
          this.status.step = 2;
          this.visuals?.briefcaseVisible(false);
          this.status.objective = 'Fuja da polícia e entregue a maleta no Hotel Neon (marcador amarelo).';
          this.status.targetPos = { ...MISSION_POINTS.m2Dropoff };
          this.visuals?.setObjectiveBeaconPos(MISSION_POINTS.m2Dropoff.x, 0, MISSION_POINTS.m2Dropoff.z);
          this.ctx?.audio.playCashPickup();
          this.bus?.emit('missionStepUpdated', { missionId: 'mission2', step: 2 });
          this.bus?.emit('crimeCommitted', {
            minStars: 2,
            reason: 'Maleta recuperada! Nível de procurado: 2 estrelas!',
            source: 'mission',
          });
        }
      } else if (this.status.step === 2) {
        const dDrop = Math.hypot(
          playerPos.x - MISSION_POINTS.m2Dropoff.x,
          playerPos.z - MISSION_POINTS.m2Dropoff.z
        );
        if (dDrop < MISSION_2_DROPOFF_RADIUS) {
          this.completeMission('mission2', MISSION_2_REWARD, 'MISSÃO 2 CONCLUÍDA! +$2.500');
        }
      }
    }
  }

  private completeMission(id: Exclude<MissionId, 'none'>, reward: number, bannerText: string): void {
    this.addMoneyFn?.(reward);
    this.ctx?.audio.playMissionComplete();
    if (!this.status.completedMissions.includes(id)) {
      this.status.completedMissions = [...this.status.completedMissions, id];
    }
    this.bus?.emit('missionCompleted', { missionId: id, reward });
    this.bus?.emit('bannerRequested', { text: bannerText, duration: 4.5 });
    this.bus?.emit('saveRequested', { reason: 'mission' });
    this.startMission('none');
  }

  public getSnapshot(): MissionStatus {
    return {
      ...this.status,
      completedMissions: [...this.status.completedMissions],
    };
  }

  public dispose(): void {
    this.unsubs.forEach((u) => u());
    this.unsubs = [];
    this.ctx = null;
  }
}
