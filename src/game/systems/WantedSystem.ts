import {
  MAX_WANTED_STARS,
  PLAYER_SPAWN_X,
  PLAYER_SPAWN_Z,
  WANTED_BUST_DIST,
  WANTED_BUST_DURATION,
  WANTED_BUST_FLASH_DURATION,
  WANTED_BUST_MAX_FINE,
  WANTED_BUST_PLAYER_MAX_SPEED,
  WANTED_EVADE_BONUS,
  WANTED_EVADE_DIST,
  WANTED_EVADE_DURATION,
} from '../config';
import { GameEventMap, TypedEventBus } from '../core/EventBus';
import { EngineContext, GameSystem } from '../core/SystemLifecycle';

export interface WantedSnapshot {
  stars: number;
  evadingProgress: number;
  bustProgress: number;
  bustedFlash: boolean;
}

export interface WantedTickContext {
  playerX: number;
  playerZ: number;
  playerSpeed: number;
  policePositions: ReadonlyArray<{ x: number; z: number }>;
  onBustedReset?: () => void;
}

/**
 * Gerencia estrelas de procurado (0..3), temporizador de fuga, cerco policial e fiança.
 * Projetado para funcionar tanto integrado ao EngineContext quanto isolado em testes Vitest.
 */
export class WantedSystem implements GameSystem {
  public readonly name = 'WantedSystem';

  public stars = 0;
  public evadeTimer = 0;
  public bustTimer = 0;
  public bustedFlashTimer = 0;

  private ctx: EngineContext | null = null;
  private unsubs: Array<() => void> = [];
  private bus: TypedEventBus<GameEventMap> | null = null;
  private moneyBridge: { get: () => number; add: (delta: number) => void } | null = null;

  constructor(bus?: TypedEventBus<GameEventMap>, moneyBridge?: { get: () => number; add: (delta: number) => void }) {
    this.bus = bus ?? null;
    this.moneyBridge = moneyBridge ?? null;
    if (this.bus) {
      this.bindBus(this.bus);
    }
  }

  public init(ctx: EngineContext): void {
    this.ctx = ctx;
    this.bus = ctx.events;
    this.moneyBridge = {
      get: () => ctx.state.money,
      add: (delta) => {
        ctx.state.money += delta;
      },
    };
    this.bindBus(ctx.events);
  }

  private bindBus(bus: TypedEventBus<GameEventMap>): void {
    this.unsubs.forEach((u) => u());
    this.unsubs = [];

    this.unsubs.push(
      bus.on('crimeCommitted', ({ minStars, reason }) => {
        this.addStars(minStars, reason);
      })
    );

    this.unsubs.push(
      bus.on('vehicleHitPedestrian', (ev) => {
        if (ev.wantedIncrease > 0) {
          this.addStars(ev.wantedIncrease, ev.bannerMessage ?? 'Polícia acionada!');
        }
      })
    );

    this.unsubs.push(
      bus.on('missionCompleted', () => {
        this.clearWanted();
      })
    );
  }

  public addStars(targetMinStars: number, reason: string): void {
    const prev = this.stars;
    const next = Math.min(MAX_WANTED_STARS, Math.max(this.stars, targetMinStars));
    this.evadeTimer = 0;

    if (next > prev) {
      this.stars = next;
      this.bus?.emit('wantedChanged', { stars: next, prevStars: prev, reason });
      this.bus?.emit('bannerRequested', { text: reason, duration: 3.6 });
    }
  }

  public clearWanted(): void {
    const prev = this.stars;
    this.stars = 0;
    this.evadeTimer = 0;
    this.bustTimer = 0;
    if (prev !== 0) {
      this.bus?.emit('wantedChanged', { stars: 0, prevStars: prev });
    }
  }

  public update(dt: number): void {
    if (!this.ctx) return;

    const policePositions: Array<{ x: number; z: number }> = [];
    for (const v of this.ctx.vehicles) {
      if (v.driver === 'police' && policePositions.length < this.stars) {
        policePositions.push({ x: v.x, z: v.z });
      }
    }

    const playerSpeed = this.ctx.state.currentVehicle
      ? Math.abs(this.ctx.state.currentVehicle.speed)
      : 0;

    this.step(dt, {
      playerX: this.ctx.state.playerPos.x,
      playerZ: this.ctx.state.playerPos.z,
      playerSpeed,
      policePositions,
      onBustedReset: () => this.applyEngineBustedReset(),
    });
  }

  public step(dt: number, tick: WantedTickContext): void {
    if (this.bustedFlashTimer > 0) {
      this.bustedFlashTimer = Math.max(0, this.bustedFlashTimer - dt);
    }

    if (this.stars === 0) {
      this.evadeTimer = 0;
      this.bustTimer = 0;
      return;
    }

    let minCopDist = Infinity;
    const maxCount = Math.min(this.stars, tick.policePositions.length);
    for (let i = 0; i < maxCount; i++) {
      const p = tick.policePositions[i];
      const d = Math.hypot(p.x - tick.playerX, p.z - tick.playerZ);
      if (d < minCopDist) minCopDist = d;
    }

    if (minCopDist > WANTED_EVADE_DIST) {
      this.evadeTimer += dt;
      this.bustTimer = Math.max(0, this.bustTimer - dt * 1.5);
      if (this.evadeTimer >= WANTED_EVADE_DURATION) {
        const prev = this.stars;
        this.stars = 0;
        this.evadeTimer = 0;
        this.moneyBridge?.add(WANTED_EVADE_BONUS);
        this.ctx?.audio.playCashPickup();
        this.bus?.emit('wantedChanged', { stars: 0, prevStars: prev });
        this.bus?.emit('evaded', { bonus: WANTED_EVADE_BONUS });
        this.bus?.emit('bannerRequested', {
          text: `Polícia despistada! Bônus +$${WANTED_EVADE_BONUS}`,
          duration: 3.5,
        });
      }
    } else {
      this.evadeTimer = Math.max(0, this.evadeTimer - dt * 0.6);

      if (minCopDist < WANTED_BUST_DIST && tick.playerSpeed < WANTED_BUST_PLAYER_MAX_SPEED) {
        this.bustTimer += dt;
        if (this.bustTimer >= WANTED_BUST_DURATION) {
          this.handleBusted(tick.onBustedReset);
        }
      } else {
        this.bustTimer = Math.max(0, this.bustTimer - dt * 1.2);
      }
    }
  }

  private handleBusted(onBustedReset?: () => void): void {
    const prev = this.stars;
    const currentMoney = this.moneyBridge?.get() ?? 0;
    const fine = Math.min(currentMoney, WANTED_BUST_MAX_FINE);

    this.ctx?.audio.playBusted();
    this.stars = 0;
    this.bustTimer = 0;
    this.evadeTimer = 0;
    this.bustedFlashTimer = WANTED_BUST_FLASH_DURATION;
    this.moneyBridge?.add(-fine);

    onBustedReset?.();

    this.bus?.emit('wantedChanged', { stars: 0, prevStars: prev });
    this.bus?.emit('busted', { fine });
    this.bus?.emit('bannerRequested', {
      text: `PRESO! Fiança paga: -$${fine}`,
      duration: 4.0,
    });
  }

  private applyEngineBustedReset(): void {
    if (!this.ctx) return;
    const { state } = this.ctx;
    if (state.currentVehicle) {
      state.currentVehicle.driver = 'none';
      state.currentVehicle = null;
    }
    state.playerPos.set(PLAYER_SPAWN_X, this.ctx.groundHeightAt(PLAYER_SPAWN_X, PLAYER_SPAWN_Z), PLAYER_SPAWN_Z);
    this.bus?.emit('missionStarted', { missionId: 'none' });
  }

  public getSnapshot(): WantedSnapshot {
    return {
      stars: this.stars,
      evadingProgress: this.stars > 0 ? Math.min(1, this.evadeTimer / WANTED_EVADE_DURATION) : 0,
      bustProgress: this.stars > 0 ? Math.min(1, this.bustTimer / WANTED_BUST_DURATION) : 0,
      bustedFlash: this.bustedFlashTimer > 0,
    };
  }

  public dispose(): void {
    this.unsubs.forEach((u) => u());
    this.unsubs = [];
    this.ctx = null;
  }
}
