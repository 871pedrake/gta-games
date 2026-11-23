import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  LEGACY_SAVE_STORAGE_KEY,
  PLAYER_MAX_HEALTH,
  QUALITY_SETTINGS,
  SAVE_SCHEMA_VERSION,
  SAVE_STORAGE_KEY,
} from '../config';
import { GameEventMap, TypedEventBus } from '../core/EventBus';
import { SaveSystem } from '../core/SaveSystem';
import { EngineContext } from '../core/SystemLifecycle';
import { createInitialSimulationState } from '../core/WorldHelpers';
import { PerformanceSystem } from '../systems/PerformanceSystem';

function installMemoryLocalStorage() {
  const store = new Map<string, string>();
  const mockStorage: Storage = {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (k: string) => store.get(k) ?? null,
    key: (idx: number) => Array.from(store.keys())[idx] ?? null,
    removeItem: (k: string) => {
      store.delete(k);
    },
    setItem: (k: string, v: string) => {
      store.set(k, v);
    },
  };
  vi.stubGlobal('window', { localStorage: mockStorage, devicePixelRatio: 2 });
  return store;
}

describe('SaveSystem v2 e migração v1 -> v2', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('migra payload legado v1 para o esquema v2 preservando progresso e preenchendo novos campos', () => {
    const v1Payload = {
      version: 1,
      savedAtIso: '2026-01-01T12:00:00.000Z',
      money: 2450,
      playerX: 12.5,
      playerZ: -18.2,
      playerYaw: 1.2,
      currentVehicleId: 'car_1',
      gameTime: 21.5,
      dayNumber: 3,
      weather: 'rain',
      completedMissions: ['mission1'],
      vehicles: [
        { id: 'car_1', x: 12.5, z: -18.2, heading: 1.2, health: 88, damageRatio: 0.12 },
      ],
    };

    const migrated = SaveSystem.migrateV1ToV2(v1Payload);
    expect(migrated).not.toBeNull();
    expect(migrated!.version).toBe(SAVE_SCHEMA_VERSION);
    expect(migrated!.money).toBe(2450);
    expect(migrated!.health).toBe(PLAYER_MAX_HEALTH);
    expect(migrated!.armor).toBe(0);
    expect(migrated!.weapons).toEqual([{ id: 'fists', clip: 0, reserve: 0 }]);
    expect(migrated!.activeWeaponId).toBe('fists');
    expect(migrated!.outfit.torso).toBe('torso_jacket_neon');
    expect(migrated!.completedMissions).toEqual(['mission1']);
    expect(migrated!.completedEvents).toEqual([]);
    expect(migrated!.discoveredAreas).toEqual([]);
    expect(migrated!.vehicles).toHaveLength(1);
    expect(migrated!.vehicles[0].health).toBe(88);
  });

  it('carrega automaticamente save legado da chave v1 e persiste na chave v2', () => {
    const store = installMemoryLocalStorage();
    store.set(
      LEGACY_SAVE_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        savedAtIso: '2026-01-01T12:00:00.000Z',
        money: 990,
        playerX: -40,
        playerZ: 10,
        playerYaw: 0,
        currentVehicleId: null,
        gameTime: 10,
        dayNumber: 2,
        weather: 'clear',
        completedMissions: [],
        vehicles: [],
      })
    );

    const loaded = SaveSystem.loadGame();
    expect(loaded).not.toBeNull();
    expect(loaded!.version).toBe(2);
    expect(loaded!.money).toBe(990);
    expect(store.get(SAVE_STORAGE_KEY)).toBeDefined();
  });
});

describe('PerformanceSystem', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reduz pixelRatio abaixo de 50 FPS e recupera acima de 56 FPS com telemetria de renderização', () => {
    vi.stubGlobal('window', { devicePixelRatio: 2 });
    let currentDpr = 1.5;
    const bus = new TypedEventBus<GameEventMap>();
    const onScaled = vi.fn();
    bus.on('performanceScaled', onScaled);

    const fakeRenderer = {
      setPixelRatio: vi.fn((val: number) => {
        currentDpr = val;
      }),
      info: {
        render: { calls: 120, triangles: 84500 },
        memory: { geometries: 42, textures: 18 },
        programs: [{}, {}, {}],
      },
    } as unknown as THREE.WebGLRenderer;

    const state = createInitialSimulationState(false);
    const fakeCtx = {
      renderer: fakeRenderer,
      isSoftwareGl: false,
      events: bus,
      state,
    } as unknown as EngineContext;

    const perf = new PerformanceSystem();
    perf.init(fakeCtx);
    perf.setQualityPreset('medium');
    expect(currentDpr).toBe(QUALITY_SETTINGS.medium.maxPixelRatio);

    // Simula queda sustentada para 30 FPS -> deve reduzir DPR dentro dos limites do preset médio
    for (let i = 0; i < 40; i++) {
      perf.update(1 / 30);
    }
    expect(currentDpr).toBeLessThan(QUALITY_SETTINGS.medium.maxPixelRatio);
    expect(currentDpr).toBeGreaterThanOrEqual(QUALITY_SETTINGS.medium.minPixelRatio);
    expect(onScaled).toHaveBeenCalled();
    expect(state.renderTelemetry.calls).toBe(120);
    expect(state.renderTelemetry.triangles).toBe(84500);
    expect(state.renderTelemetry.programs).toBe(3);

    // Simula recuperação sustentada para 60 FPS além do cooldown de 2s -> deve subir DPR de volta
    const loweredDpr = currentDpr;
    for (let i = 0; i < 160; i++) {
      perf.update(1 / 60);
    }
    expect(currentDpr).toBeGreaterThan(loweredDpr);
    perf.dispose();
  });
});
