import { describe, expect, it, vi } from 'vitest';
import {
  MAX_WANTED_STARS,
  WANTED_BUST_DURATION,
  WANTED_BUST_MAX_FINE,
  WANTED_EVADE_BONUS,
  WANTED_EVADE_DURATION,
} from '../config';
import { TypedEventBus, GameEventMap } from '../core/EventBus';
import { WantedSystem } from '../systems/WantedSystem';

describe('WantedSystem', () => {
  it('escala estrelas até o máximo de 3 ao receber eventos de crime', () => {
    const bus = new TypedEventBus<GameEventMap>();
    const wanted = new WantedSystem(bus);

    bus.emit('crimeCommitted', { minStars: 1, reason: 'Furto', source: 'carjack' });
    expect(wanted.stars).toBe(1);

    bus.emit('crimeCommitted', { minStars: 5, reason: 'Perseguição', source: 'hit' });
    expect(wanted.stars).toBe(MAX_WANTED_STARS);
  });

  it('conclui fuga e concede bônus quando viaturas ficam distantes pelo tempo limite', () => {
    const bus = new TypedEventBus<GameEventMap>();
    let money = 500;
    const onEvaded = vi.fn();
    bus.on('evaded', onEvaded);

    const wanted = new WantedSystem(bus, {
      get: () => money,
      add: (d) => {
        money += d;
      },
    });

    wanted.addStars(2, 'Alerta');
    wanted.step(WANTED_EVADE_DURATION + 0.1, {
      playerX: 0,
      playerZ: 0,
      playerSpeed: 10,
      policePositions: [{ x: 100, z: 100 }],
    });

    expect(wanted.stars).toBe(0);
    expect(money).toBe(500 + WANTED_EVADE_BONUS);
    expect(onEvaded).toHaveBeenCalledWith({ bonus: WANTED_EVADE_BONUS });
  });

  it('prende o jogador e aplica fiança quando encurralado em baixa velocidade', () => {
    const bus = new TypedEventBus<GameEventMap>();
    let money = 400;
    const onBusted = vi.fn();
    bus.on('busted', onBusted);

    const wanted = new WantedSystem(bus, {
      get: () => money,
      add: (d) => {
        money += d;
      },
    });

    wanted.addStars(1, 'Alerta');
    wanted.step(WANTED_BUST_DURATION + 0.1, {
      playerX: 10,
      playerZ: 10,
      playerSpeed: 1.5,
      policePositions: [{ x: 12, z: 10 }],
    });

    expect(wanted.stars).toBe(0);
    expect(money).toBe(400 - WANTED_BUST_MAX_FINE);
    expect(wanted.bustedFlashTimer).toBeGreaterThan(0);
    expect(onBusted).toHaveBeenCalledWith({ fine: WANTED_BUST_MAX_FINE });
  });

  it('zera estrelas ao receber missionCompleted', () => {
    const bus = new TypedEventBus<GameEventMap>();
    const wanted = new WantedSystem(bus);
    wanted.addStars(3, 'Perseguição');
    bus.emit('missionCompleted', { missionId: 'mission1', reward: 1500 });
    expect(wanted.stars).toBe(0);
  });
});
