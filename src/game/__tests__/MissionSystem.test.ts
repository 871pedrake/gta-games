import { describe, expect, it, vi } from 'vitest';
import { MISSION_1_REWARD, MISSION_2_REWARD } from '../config';
import { GameEventMap, TypedEventBus } from '../core/EventBus';
import { MissionSystem } from '../systems/MissionSystem';
import { MISSION_POINTS } from '../world';

describe('MissionSystem', () => {
  it('inicia e conclui a Missão 1 concedendo recompensa e emitindo saveRequested', () => {
    const bus = new TypedEventBus<GameEventMap>();
    let money = 500;
    const onSave = vi.fn();
    const onCrime = vi.fn();
    bus.on('saveRequested', onSave);
    bus.on('crimeCommitted', onCrime);

    const mission = new MissionSystem(
      bus,
      {
        objectiveBeaconVisible: vi.fn(),
        setObjectiveBeaconPos: vi.fn(),
        briefcaseVisible: vi.fn(),
      },
      (amount) => {
        money += amount;
      }
    );

    const fakeMissionCar = { isMissionTarget: true };

    // Entra no gatilho da Missão 1
    mission.stepMission(MISSION_POINTS.m1Trigger, null, null);
    expect(mission.status.id).toBe('mission1');
    expect(mission.status.step).toBe(1);

    // Entra no Solara GT rosa -> avança para step 2 e dispara crime
    mission.onPlayerEnteredVehicle(fakeMissionCar, null);
    expect(mission.status.step).toBe(2);
    expect(onCrime).toHaveBeenCalled();

    // Chega ao ponto de entrega dirigindo o carro da missão
    mission.stepMission(MISSION_POINTS.m1Dropoff, fakeMissionCar, null);
    expect(mission.status.id).toBe('none');
    expect(mission.status.completedMissions).toContain('mission1');
    expect(money).toBe(500 + MISSION_1_REWARD);
    expect(onSave).toHaveBeenCalledWith({ reason: 'mission' });
  });

  it('inicia e conclui a Missão 2 em duas etapas (maleta -> hotel)', () => {
    const bus = new TypedEventBus<GameEventMap>();
    let money = 0;
    const onCrime = vi.fn();
    bus.on('crimeCommitted', onCrime);

    const mission = new MissionSystem(
      bus,
      {
        objectiveBeaconVisible: vi.fn(),
        setObjectiveBeaconPos: vi.fn(),
        briefcaseVisible: vi.fn(),
      },
      (amount) => {
        money += amount;
      }
    );

    mission.startMission('mission2');
    expect(mission.status.id).toBe('mission2');
    expect(mission.status.step).toBe(1);

    // Pega a maleta na praia
    mission.stepMission(MISSION_POINTS.m2Briefcase, null, null);
    expect(mission.status.step).toBe(2);
    expect(onCrime).toHaveBeenCalledWith(expect.objectContaining({ minStars: 2 }));

    // Entrega no Hotel Neon
    mission.stepMission(MISSION_POINTS.m2Dropoff, null, null);
    expect(mission.status.id).toBe('none');
    expect(mission.status.completedMissions).toContain('mission2');
    expect(money).toBe(MISSION_2_REWARD);
  });

  it('cancela missão ativa quando jogador é preso', () => {
    const bus = new TypedEventBus<GameEventMap>();
    const mission = new MissionSystem(bus, {
      objectiveBeaconVisible: vi.fn(),
      setObjectiveBeaconPos: vi.fn(),
      briefcaseVisible: vi.fn(),
    });

    mission.startMission('mission2');
    expect(mission.status.id).toBe('mission2');
    bus.emit('busted', { fine: 150 });
    expect(mission.status.id).toBe('none');
  });
});
