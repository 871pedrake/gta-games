import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  advanceProjectileStep,
  BallisticProjectile,
  BuildingSpatialGrid,
  castBallisticSegment,
  computeDistanceDamageFalloff,
  computeSpreadDirection,
  createEmptyBallisticHit,
  intersectSegmentAABB,
  intersectSegmentNpcCapsule,
  intersectSegmentSphere,
  tryApplyRicochet,
} from '../Ballistics';
import { BuildingRegistry } from '../BuildingRegistry';
import {
  BALLISTICS_FIXED_STEP,
  BALLISTICS_GRAVITY,
  BALLISTICS_RICOCHET_ENERGY_RETENTION,
  CAM_DEFAULT_FOV,
  CAM_TPS_AIM_DIST,
  CAM_TPS_AIM_FOV,
  CAM_TPS_AIM_SHOULDER_X,
  CAM_TPS_RIFLE_AIM_FOV,
  PLAYER_AIM_SPEED_MUL,
  PLAYER_WALK_SPEED,
  SAVE_STORAGE_KEY,
  SETTINGS_STORAGE_KEY,
  WEAPON_PROJECTILE_POOL_SIZE,
} from '../config';
import { GameEventMap, TypedEventBus } from '../core/EventBus';
import { restoreSaveIntoContext } from '../core/SaveBridge';
import { SaveSystem } from '../core/SaveSystem';
import { EngineContext } from '../core/SystemLifecycle';
import { createInitialSimulationState } from '../core/WorldHelpers';
import { PedestrianAI } from '../PedestrianAI';
import { CameraRig } from '../systems/CameraRig';
import { HudBridge } from '../systems/HudBridge';
import { InputManager } from '../systems/InputManager';
import { PlayerController } from '../systems/PlayerController';
import { WeaponSystem } from '../systems/WeaponSystem';
import { BuildingCollider, HudSnapshot, VehicleEntity } from '../types';
import { getWeaponDef, WEAPON_BY_SLOT, WEAPON_LIST, WEAPONS } from '../WeaponDefs';

function createMockShadowTex(): THREE.CanvasTexture {
  return new THREE.CanvasTexture({ width: 8, height: 8 } as unknown as HTMLCanvasElement);
}

function createMockCtx(overrides?: Partial<EngineContext>): EngineContext {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(CAM_DEFAULT_FOV, 16 / 9, 0.2, 500);
  const events = new TypedEventBus<GameEventMap>();
  const state = createInitialSimulationState(false);
  state.weapons = [
    { id: 'fists', clip: 0, reserve: 0 },
    { id: 'pistol', clip: 12, reserve: 48 },
    { id: 'smg', clip: 30, reserve: 90 },
    { id: 'rifle', clip: 30, reserve: 120 },
  ];
  state.activeWeaponId = 'pistol';

  const dom = {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    requestPointerLock: vi.fn(),
  } as unknown as HTMLCanvasElement;

  const renderer = { domElement: dom } as unknown as THREE.WebGLRenderer;

  const audio = {
    unlock: vi.fn(),
    playJump: vi.fn(),
    playGunshot: vi.fn(),
    playMeleeSwing: vi.fn(),
    playReload: vi.fn(),
    playDryFire: vi.fn(),
    playHitMarker: vi.fn(),
    playCashPickup: vi.fn(),
    playImpact: vi.fn(),
    playBusted: vi.fn(),
    playBulletImpact: vi.fn(),
    playBulletFlyby: vi.fn(),
    isMuted: vi.fn(() => false),
  };

  const crowd = {
    agents: [] as PedestrianAI[],
    activeInjuredCount: 0,
    queryRadiusIndices: vi.fn((_x: number, _z: number, _r: number, out: number[]) => {
      out.length = 0;
      for (let i = 0; i < crowd.agents.length; i++) {
        if (crowd.agents[i]?.active) out.push(i);
      }
      return out;
    }),
    triggerPanicRadius: vi.fn(),
    enforceInjuredCap: vi.fn(),
  };

  const ragdolls = {
    inUseCount: 0,
    spawn: vi.fn(),
    accelerateOldestFade: vi.fn(),
  };

  return {
    container: {} as HTMLElement,
    renderer,
    scene,
    camera,
    isSoftwareGl: false,
    events,
    audio: audio as unknown as EngineContext['audio'],
    world: { buildings: [] } as unknown as EngineContext['world'],
    registry: {} as EngineContext['registry'],
    crowd: crowd as unknown as EngineContext['crowd'],
    ragdolls: ragdolls as unknown as EngineContext['ragdolls'],
    weatherSystem: {} as EngineContext['weatherSystem'],
    weatherEffects: {} as EngineContext['weatherEffects'],
    transit: {} as EngineContext['transit'],
    vehicles: [],
    state,
    groundHeightAt: () => 0,
    resolveWorldCollisions: () => false,
    ...overrides,
  };
}

describe('WeaponDefs', () => {
  it('define todas as 5 armas em WEAPON_DEFS com slots 1..5 e estatísticas balanceadas', () => {
    expect(WEAPON_LIST).toHaveLength(5);
    expect(WEAPON_BY_SLOT[1]).toBe('fists');
    expect(WEAPON_BY_SLOT[2]).toBe('pistol');
    expect(WEAPON_BY_SLOT[3]).toBe('smg');
    expect(WEAPON_BY_SLOT[4]).toBe('shotgun');
    expect(WEAPON_BY_SLOT[5]).toBe('rifle');

    expect(WEAPONS.fists.damage).toBe(12);
    expect(WEAPONS.fists.range).toBe(1.6);

    expect(WEAPONS.pistol.damage).toBe(24);
    expect(WEAPONS.pistol.rpm).toBe(360);
    expect(WEAPONS.pistol.clipSize).toBe(12);
    expect(WEAPONS.pistol.maxReserve).toBe(96);
    expect(WEAPONS.pistol.range).toBe(80);
    expect(WEAPONS.pistol.headshotMul).toBe(2.5);
    expect(WEAPONS.pistol.falloffStart).toBeCloseTo(80 * 0.4, 5);
    expect(WEAPONS.pistol.falloffMinMul).toBe(0.5);

    expect(WEAPONS.smg.damage).toBe(14);
    expect(WEAPONS.smg.rpm).toBe(780);
    expect(WEAPONS.smg.clipSize).toBe(30);
    expect(WEAPONS.smg.maxReserve).toBe(240);
    expect(WEAPONS.smg.range).toBe(70);
    expect(WEAPONS.smg.headshotMul).toBe(2.0);

    expect(WEAPONS.shotgun.pellets).toBe(8);
    expect(WEAPONS.shotgun.damage).toBe(11);
    expect(WEAPONS.shotgun.rpm).toBe(70);
    expect(WEAPONS.shotgun.clipSize).toBe(6);
    expect(WEAPONS.shotgun.maxReserve).toBe(36);
    expect(WEAPONS.shotgun.reloadMode).toBe('shell');
    expect(WEAPONS.shotgun.reloadSec).toBe(0.55);
    expect(WEAPONS.shotgun.range).toBe(35);

    expect(WEAPONS.rifle.damage).toBe(38);
    expect(WEAPONS.rifle.rpm).toBe(600);
    expect(WEAPONS.rifle.clipSize).toBe(30);
    expect(WEAPONS.rifle.maxReserve).toBe(180);
    expect(WEAPONS.rifle.muzzleSpeed).toBe(820);
    expect(WEAPONS.rifle.range).toBe(160);
    expect(WEAPONS.rifle.headshotMul).toBe(3.0);

    expect(getWeaponDef('pistol').aimFov).toBe(CAM_TPS_AIM_FOV);
    expect(getWeaponDef('rifle').aimFov).toBe(CAM_TPS_RIFLE_AIM_FOV);
    expect(getWeaponDef('unknown_id').id).toBe('fists');
  });
});

describe('Ballistics', () => {
  it('aplica gravidade, arrasto e queda de dano por distância corretamente', () => {
    const proj: BallisticProjectile = {
      active: true,
      ownerKind: 'player',
      weaponId: 'pistol',
      x: 0,
      y: 2,
      z: 0,
      vx: 0,
      vy: 0,
      vz: -200,
      gravity: 9.8,
      drag: 0.2,
      damage: 34,
      headshotMul: 2.4,
      limbMul: 0.75,
      falloffStart: 40,
      falloffMinMul: 0.5,
      impulseStrength: 7,
      traveled: 0,
      maxRange: 100,
      age: 0,
      maxLife: 1.5,
      ricocheted: false,
      tracerColorHex: 0xffffff,
    };

    const next = { x: 0, y: 0, z: 0 };
    const dist = advanceProjectileStep(proj, 0.1, next);
    expect(dist).toBeGreaterThan(18);
    expect(next.y).toBeLessThan(2);
    expect(Math.abs(proj.vz)).toBeLessThan(200);
    expect(proj.age).toBeCloseTo(0.1, 5);

    expect(computeDistanceDamageFalloff(20, 40, 100, 0.5)).toBe(1);
    expect(computeDistanceDamageFalloff(70, 40, 100, 0.5)).toBeCloseTo(0.75, 5);
    expect(computeDistanceDamageFalloff(120, 40, 100, 0.5)).toBe(0.5);

    const outDir = { x: 0, y: 0, z: 0 };
    computeSpreadDirection(0, 0, -1, 0.05, Math.PI * 0.5, 1, outDir);
    expect(Math.hypot(outDir.x, outDir.y, outDir.z)).toBeCloseTo(1, 5);
    expect(outDir.z).toBeLessThan(0);
  });

  it('detecta impacto em prédio, terreno, veículo e regiões corporais do NPC (head/torso/limb)', () => {
    const npc = new PedestrianAI(0);
    npc.active = true;
    npc.x = 0;
    npc.y = 0;
    npc.z = -15;
    npc.heightScale = 1.0;
    npc.widthScale = 1.0;

    const building: BuildingCollider = {
      x: 0,
      z: -35,
      halfW: 4,
      halfD: 4,
      height: 12,
      colorHex: '#ffffff',
      label: 'PredioTeste',
    };

    const hit = createEmptyBallisticHit();

    // Tiro na cabeça do NPC (~1.55m de altura)
    castBallisticSegment(
      0,
      1.55,
      0,
      0,
      1.55,
      -30,
      {
        buildings: [building],
        vehicles: [],
        ignoreVehicleId: null,
        agents: [npc],
        candidateNpcIndices: [0],
        groundHeightAt: () => 0,
      },
      hit
    );
    expect(hit.hit).toBe(true);
    expect(hit.kind).toBe('npc');
    expect(hit.region).toBe('head');

    // Tiro no membro inferior (~0.35m de altura)
    castBallisticSegment(
      0,
      0.35,
      0,
      0,
      0.35,
      -30,
      {
        buildings: [building],
        vehicles: [],
        ignoreVehicleId: null,
        agents: [npc],
        candidateNpcIndices: [0],
        groundHeightAt: () => 0,
      },
      hit
    );
    expect(hit.hit).toBe(true);
    expect(hit.kind).toBe('npc');
    expect(hit.region).toBe('limb');

    // Tiro passando ao lado do NPC acerta o prédio atrás
    castBallisticSegment(
      2.5,
      2.0,
      0,
      2.5,
      2.0,
      -40,
      {
        buildings: [building],
        vehicles: [],
        ignoreVehicleId: null,
        agents: [npc],
        candidateNpcIndices: [0],
        groundHeightAt: () => 0,
      },
      hit
    );
    expect(hit.hit).toBe(true);
    expect(hit.kind).toBe('world');
    expect(hit.targetId).toBe('PredioTeste');

    // Tiro em direção ao veículo
    const car = {
      id: 'car_teste',
      type: 'sedan',
      mesh: new THREE.Group(),
      x: 10,
      z: -20,
      heading: 0,
      halfWidth: 1.0,
      halfLength: 2.2,
    } as unknown as VehicleEntity;
    castBallisticSegment(
      10,
      0.8,
      -10,
      10,
      0.8,
      -30,
      {
        buildings: [],
        vehicles: [car],
        ignoreVehicleId: null,
        agents: [],
        candidateNpcIndices: [],
        groundHeightAt: () => 0,
      },
      hit
    );
    expect(hit.hit).toBe(true);
    expect(hit.kind).toBe('vehicle');
    expect(hit.targetId).toBe('car_teste');
  });
});

describe('SaveSystem opções de mira', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('preenche aimMode="hold" e aimSensitivityMul=0.6 quando ausentes em opções salvas antigas', () => {
    const store = new Map<string, string>();
    store.set(
      SETTINGS_STORAGE_KEY,
      JSON.stringify({
        qualityPreset: 'high',
        volume: 0.8,
        muted: false,
        cameraSensitivity: 1.4,
        invertY: true,
        touchMode: 'off',
      })
    );
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => store.set(k, v),
      },
    });

    const opts = SaveSystem.loadOptions();
    expect(opts.aimMode).toBe('hold');
    expect(opts.aimSensitivityMul).toBe(0.6);
    expect(opts.qualityPreset).toBe('high');
    expect(opts.invertY).toBe(true);
  });
});

describe('WeaponSystem, CameraRig, PlayerController e InputManager', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('dispara automático via acumulador de RPM em lateUpdate, recarrega e aplica sensibilidade de mira pelo FOV', () => {
    const ctx = createMockCtx();
    const input = new InputManager();
    const cameraRig = new CameraRig(input);
    const weaponSys = new WeaponSystem(input, cameraRig, 'medium');

    input.init(ctx);
    cameraRig.init(ctx);
    weaponSys.init(ctx);

    cameraRig.setOptions(1.0, false, 'hold', 0.6);
    ctx.state.combat.aiming = true;
    ctx.camera.fov = CAM_TPS_AIM_FOV;
    expect(cameraRig.getAimLookMultiplier()).toBeCloseTo(0.6 * (CAM_TPS_AIM_FOV / CAM_DEFAULT_FOV), 4);

    // Troca para SMG entra em switching (0,35s) antes de poder atirar
    expect(weaponSys.selectWeapon('smg')).toBe(true);
    expect(ctx.state.activeWeaponId).toBe('smg');
    expect(ctx.state.combat.weaponState).toBe('switching');

    // Aguarda concluir os 0,35s de troca
    weaponSys.update(0.36);
    cameraRig.update(0.016);
    weaponSys.lateUpdate(0.016);
    expect(ctx.state.combat.weaponState).toBe('idle');

    // Simula segurar atirar: disparo efetivo ocorre em lateUpdate após cameraRig.update
    input.setTouchInput({ fire: true });
    input.update(0.016);
    weaponSys.update(0.016);
    cameraRig.update(0.016);
    weaponSys.lateUpdate(0.016);
    const clipAfterStart = ctx.state.weapons.find((w) => w.id === 'smg')!.clip;
    expect(clipAfterStart).toBe(29);

    weaponSys.update(0.2); // quadro longo deve disparar múltiplos tiros pelo acumulador
    cameraRig.update(0.2);
    weaponSys.lateUpdate(0.2);
    const clipAfterBurst = ctx.state.weapons.find((w) => w.id === 'smg')!.clip;
    expect(clipAfterBurst).toBeLessThanOrEqual(27);

    input.setTouchInput({ fire: false });
    // Recarrega até completar
    input.setTouchInput({ reload: true });
    input.update(0.016);
    weaponSys.update(0.016);
    cameraRig.update(0.016);
    weaponSys.lateUpdate(0.016);
    expect(ctx.state.combat.reloading).toBe(true);
    expect(ctx.state.combat.weaponState).toBe('reloading');
    weaponSys.update(WEAPONS.smg.reloadSec + 0.1);
    cameraRig.update(0.016);
    weaponSys.lateUpdate(0.016);
    expect(ctx.state.combat.reloading).toBe(false);
    expect(ctx.state.combat.weaponState).toBe('idle');
    expect(ctx.state.weapons.find((w) => w.id === 'smg')!.clip).toBe(WEAPONS.smg.clipSize);

    weaponSys.dispose();
    cameraRig.dispose();
    input.dispose();
  });

  it('valida estados (switching 0,35s cancela recarga), clique seco + recarga automática e recarga interrompível da escopeta', () => {
    const ctx = createMockCtx();
    ctx.state.weapons = [
      { id: 'fists', clip: 0, reserve: 0 },
      { id: 'pistol', clip: 0, reserve: 12 },
      { id: 'shotgun', clip: 2, reserve: 10 },
    ];
    ctx.state.activeWeaponId = 'pistol';

    const input = new InputManager();
    const cameraRig = new CameraRig(input);
    const weaponSys = new WeaponSystem(input, cameraRig, 'medium');
    input.init(ctx);
    cameraRig.init(ctx);
    weaponSys.init(ctx);

    // 1. Pente vazio na pistola = clique seco + recarga automática
    input.setTouchInput({ fire: true });
    input.update(0.016);
    weaponSys.update(0.016);
    cameraRig.update(0.016);
    weaponSys.lateUpdate(0.016);
    expect(ctx.audio.playDryFire).toHaveBeenCalledTimes(1);
    expect(ctx.state.combat.reloading).toBe(true);
    expect(ctx.state.combat.weaponState).toBe('reloading');
    input.setTouchInput({ fire: false });

    // 2. Trocar para escopeta cancela a recarga e bloqueia tiro durante 0,35s
    expect(weaponSys.selectWeapon('shotgun')).toBe(true);
    expect(ctx.state.combat.reloading).toBe(false);
    expect(ctx.state.combat.weaponState).toBe('switching');

    input.setTouchInput({ fire: true });
    input.update(0.016);
    weaponSys.update(0.1);
    cameraRig.update(0.016);
    weaponSys.lateUpdate(0.016);
    expect(ctx.state.weapons.find((w) => w.id === 'shotgun')!.clip).toBe(2); // não disparou ainda

    input.setTouchInput({ fire: false });
    weaponSys.update(0.3);
    cameraRig.update(0.016);
    weaponSys.lateUpdate(0.016);
    expect(ctx.state.combat.weaponState).toBe('idle');

    // 3. Escopeta recarrega cartucho a cartucho (0,55s/cartucho) e pode ser interrompida atirando
    input.setTouchInput({ reload: true });
    input.update(0.016);
    weaponSys.update(0.016);
    expect(ctx.state.combat.reloading).toBe(true);
    input.setTouchInput({ reload: false });

    // Após 0,56s: carregou +1 cartucho (2 -> 3) e continua recarregando o próximo
    weaponSys.update(0.56);
    const shotgunEntry = ctx.state.weapons.find((w) => w.id === 'shotgun')!;
    expect(shotgunEntry.clip).toBe(3);
    expect(shotgunEntry.reserve).toBe(9);
    expect(ctx.state.combat.reloading).toBe(true);

    // Atirar interrompe a recarga da escopeta imediatamente e dispara (3 -> 2)
    input.setTouchInput({ fire: true });
    input.update(0.016);
    weaponSys.update(0.016);
    cameraRig.update(0.016);
    weaponSys.lateUpdate(0.016);
    expect(ctx.state.combat.reloading).toBe(false);
    expect(shotgunEntry.clip).toBe(2);

    // 4. Botão DEV giveAllWeapons adiciona todas as 5 armas com munição cheia
    weaponSys.giveAllWeapons();
    expect(ctx.state.weapons).toHaveLength(5);
    expect(ctx.state.weapons.find((w) => w.id === 'rifle')!.clip).toBe(WEAPONS.rifle.clipSize);
    expect(ctx.state.weapons.find((w) => w.id === 'rifle')!.reserve).toBe(WEAPONS.rifle.maxReserve);

    weaponSys.dispose();
    cameraRig.dispose();
    input.dispose();
  });

  it('sanitiza saves descartando IDs de armas desconhecidos e validando activeWeaponId', () => {
    const migrated = SaveSystem.migrateV1ToV2({
      version: 2,
      money: 500,
      playerX: 0,
      playerZ: 0,
      gameTime: 12,
      dayNumber: 1,
      weapons: [
        { id: 'arma_inexistente', clip: 99, reserve: 999 },
        { id: 'pistol', clip: 999, reserve: 500 },
      ],
      activeWeaponId: 'arma_inexistente',
    });
    expect(migrated).not.toBeNull();
    expect(migrated!.weapons.map((w) => w.id)).toEqual(['fists', 'pistol']);
    expect(migrated!.weapons.find((w) => w.id === 'pistol')!.clip).toBe(WEAPONS.pistol.clipSize);
    expect(migrated!.weapons.find((w) => w.id === 'pistol')!.reserve).toBe(WEAPONS.pistol.maxReserve);
    expect(migrated!.activeWeaponId).toBe('fists');
  });

  it('transiciona FOV por arma (48 pistola / 40 fuzil), desloca ombro direito e aproxima câmera ao colidir parede da cabeça', () => {
    const wallBehind: BuildingCollider = {
      x: 0,
      z: 1.5,
      halfW: 5,
      halfD: 0.4,
      height: 8,
      colorHex: '#cccccc',
      label: 'ParedeTras',
    };
    const ctx = createMockCtx({
      world: { buildings: [wallBehind] } as unknown as EngineContext['world'],
    });
    ctx.state.playerPos.set(0, 0, 0);
    const input = new InputManager();
    const cameraRig = new CameraRig(input);
    cameraRig.init(ctx);
    cameraRig.camYaw = 0; // olhando para -Z, câmera atrás em +Z
    cameraRig.camPitch = 0.05;

    // 1. Sem parede atrás e mirando de pistola -> FOV tende a 48 e deslocamento lateral ~0.7m, dist ~2.6m
    ctx.world.buildings = [];
    ctx.state.activeWeaponId = 'pistol';
    ctx.state.combat.aiming = true;
    for (let i = 0; i < 40; i++) cameraRig.update(0.016);
    expect(ctx.camera.fov).toBeCloseTo(CAM_TPS_AIM_FOV, 0);
    expect(ctx.camera.position.x).toBeCloseTo(CAM_TPS_AIM_SHOULDER_X, 1);
    expect(ctx.camera.position.z).toBeCloseTo(CAM_TPS_AIM_DIST, 1);

    // 2. Com fuzil -> FOV cai para 40
    ctx.state.activeWeaponId = 'rifle';
    for (let i = 0; i < 40; i++) cameraRig.update(0.016);
    expect(ctx.camera.fov).toBeCloseTo(CAM_TPS_RIFLE_AIM_FOV, 0);

    // 3. Com parede entre a cabeça (z=0) e a posição desejada (z=2.6) -> câmera aproxima antes da parede (z <= 1.1)
    ctx.world.buildings = [wallBehind];
    for (let i = 0; i < 30; i++) cameraRig.update(0.016);
    expect(ctx.camera.position.z).toBeLessThan(wallBehind.z - wallBehind.halfD + 0.05);
    expect(ctx.camera.position.z).toBeGreaterThan(0);

    cameraRig.dispose();
  });

  it('alinha corpo ao yaw da câmera ao mirar (strafe real), reduz velocidade para 0.55x, acompanha pitch e sprint cancela mira', () => {
    const ctx = createMockCtx();
    ctx.state.playerPos.set(0, 0, 0);
    ctx.state.playerYaw = 0;
    const input = new InputManager();
    const cameraRig = new CameraRig(input);
    const playerCtrl = new PlayerController(input, cameraRig, createMockShadowTex());
    const weaponSys = new WeaponSystem(input, cameraRig, 'medium');

    input.init(ctx);
    cameraRig.init(ctx);
    playerCtrl.init(ctx);
    weaponSys.init(ctx);

    cameraRig.setOptions(1.0, false, 'toggle', 0.6);
    cameraRig.camYaw = Math.PI * 0.5;
    cameraRig.camPitch = 0.45;

    // Ativa mira em toggle e anda lateralmente (strafe)
    input.setTouchInput({ aim: true, moveX: 1, moveY: 0 });
    input.update(0.016);
    weaponSys.update(0.016);
    expect(ctx.state.combat.aiming).toBe(true);

    // Anda 0.5s mirando -> velocidade deve ser PLAYER_WALK_SPEED * 0.55 e yaw alinhado a camYaw + Math.PI
    for (let i = 0; i < 10; i++) {
      playerCtrl.update(0.05);
    }
    const movedDist = Math.hypot(ctx.state.playerPos.x, ctx.state.playerPos.z);
    expect(movedDist).toBeCloseTo(PLAYER_WALK_SPEED * PLAYER_AIM_SPEED_MUL * 0.5, 2);

    const expectedYaw = cameraRig.camYaw + Math.PI;
    let yawDiff = expectedYaw - ctx.state.playerYaw;
    while (yawDiff > Math.PI) yawDiff -= Math.PI * 2;
    while (yawDiff < -Math.PI) yawDiff += Math.PI * 2;
    expect(Math.abs(yawDiff)).toBeLessThan(0.08);
    expect(playerCtrl.playerRig.torsoGroup.rotation.x).toBeGreaterThan(0.02);

    // Sprint cancela a mira (inclusive modo toggle)
    input.setTouchInput({ aim: false, moveX: 0, moveY: 1, sprint: true });
    input.update(0.016);
    weaponSys.update(0.016);
    expect(ctx.state.combat.aiming).toBe(false);

    weaponSys.dispose();
    playerCtrl.dispose();
    cameraRig.dispose();
    input.dispose();
  });

  it('corrige paralaxe cano -> ponto-alvo pelo raio central (até 150m) e usa direção da câmera se alvo atrás do cano', () => {
    const targetWall: BuildingCollider = {
      x: 0,
      z: -20,
      halfW: 10,
      halfD: 1,
      height: 10,
      colorHex: '#ffffff',
      label: 'AlvoParalaxe',
    };
    const ctx = createMockCtx({
      world: { buildings: [targetWall] } as unknown as EngineContext['world'],
    });
    const input = new InputManager();
    const cameraRig = new CameraRig(input);
    const weaponSys = new WeaponSystem(input, cameraRig, 'medium');

    const firedEvents: Array<{ originX: number; originZ: number; dirX: number; dirY: number; dirZ: number }> = [];
    ctx.events.on('weaponFired', (ev) => firedEvents.push(ev));

    input.init(ctx);
    cameraRig.init(ctx);
    weaponSys.init(ctx);
    ctx.state.activeWeaponId = 'pistol';
    ctx.state.combat.aiming = true;

    // Câmera olhando exatamente em -Z a partir de (0.7, 1.62, 2.6)
    ctx.camera.position.set(0.7, 1.62, 2.6);
    ctx.camera.lookAt(0.7, 1.62, -20);
    ctx.camera.updateMatrixWorld();

    // Cano à esquerda da linha da câmera, em (0.2, 1.4, -0.5)
    weaponSys.setMuzzlePositionProvider((out) => {
      out.set(0.2, 1.4, -0.5);
      return true;
    });

    // Tiro 1: alvo na frente do cano em x=0.7, y=1.62, z=-19 (face frontal do prédio)
    vi.spyOn(cameraRig, 'update').mockImplementation(() => {
      // mantém posição/direção de teste sem sobrescrever
    });
    input.setTouchInput({ fire: true });
    input.update(0.016);
    weaponSys.update(0.016);
    cameraRig.update(0.016);
    weaponSys.lateUpdate(0.016);

    expect(firedEvents).toHaveLength(1);
    const ev1 = firedEvents[0];
    // Vetor esperado: de (0.2, 1.4, -0.5) até (0.7, 1.62, -19) -> dx positivo (convergindo ao retículo central)
    expect(ev1.originX).toBeCloseTo(0.2, 3);
    expect(ev1.dirX).toBeGreaterThan(0.01);
    expect(ev1.dirY).toBeGreaterThan(0.005);
    expect(ev1.dirZ).toBeLessThan(-0.99);

    // Tiro 2: cano adiantado além do ponto de impacto (alvo atrás do cano, ex.: parede colada atrás do cano)
    // Novo alvo em z=-19, mas cano em z=-22 (atrás do alvo!) -> deve usar direção da câmera (0, 0, -1)
    weaponSys.setMuzzlePositionProvider((out) => {
      out.set(0.2, 1.4, -22);
      return true;
    });
    input.setTouchInput({ fire: false });
    input.update(0.016);
    weaponSys.update(0.4);
    cameraRig.update(0.016);
    weaponSys.lateUpdate(0.016);

    input.setTouchInput({ fire: true });
    input.update(0.016);
    weaponSys.update(0.016);
    cameraRig.update(0.016);
    weaponSys.lateUpdate(0.016);

    expect(firedEvents).toHaveLength(2);
    const ev2 = firedEvents[1];
    expect(ev2.dirX).toBeCloseTo(0, 4);
    expect(ev2.dirY).toBeCloseTo(0, 4);
    expect(ev2.dirZ).toBeCloseTo(-1, 4);

    weaponSys.dispose();
    cameraRig.dispose();
    input.dispose();
  });

  it('compra arma, munição e colete na Armaria Maré Forte emitindo purchaseMade', () => {
    const ctx = createMockCtx();
    ctx.state.money = 1500;
    const input = new InputManager();
    const cameraRig = new CameraRig(input);
    const weaponSys = new WeaponSystem(input, cameraRig, 'medium');

    const purchases: string[] = [];
    ctx.events.on('purchaseMade', (p) => purchases.push(p.itemId));

    weaponSys.init(ctx);

    const buyShotgun = weaponSys.buyGunShopItem('shotgun');
    expect(buyShotgun.ok).toBe(true);
    expect(ctx.state.activeWeaponId).toBe('shotgun');
    expect(ctx.state.money).toBe(1500 - WEAPONS.shotgun.price);

    const buyAmmo = weaponSys.buyGunShopItem('shotgun');
    expect(buyAmmo.ok).toBe(true);
    expect(ctx.state.money).toBe(1500 - WEAPONS.shotgun.price - WEAPONS.shotgun.ammoPackPrice);

    const buyArmor = weaponSys.buyGunShopItem('armor');
    expect(buyArmor.ok).toBe(true);
    expect(ctx.state.armor).toBe(100);
    expect(purchases).toEqual(['shotgun', 'shotgun_ammo', 'armor']);

    weaponSys.dispose();
  });

  it('separa contexto a pé vs veículo nos gatilhos RT/LT e botões do gamepad', () => {
    const ctx = createMockCtx();
    const input = new InputManager();
    input.init(ctx);

    const makePad = (ltVal: number, rtVal: number, rbPressed = false, bPressed = false) =>
      ({
        connected: true,
        axes: [0, 0, 0, 0],
        buttons: Array.from({ length: 16 }, (_, idx) => {
          if (idx === 6) return { pressed: ltVal > 0.5, value: ltVal };
          if (idx === 7) return { pressed: rtVal > 0.5, value: rtVal };
          if (idx === 5) return { pressed: rbPressed, value: rbPressed ? 1 : 0 };
          if (idx === 1) return { pressed: bPressed, value: bPressed ? 1 : 0 };
          return { pressed: false, value: 0 };
        }),
      }) as unknown as Gamepad;

    let currentPad = makePad(1.0, 1.0, true, true);
    vi.stubGlobal('navigator', {
      getGamepads: () => [currentPad],
    });

    // A pé: LT mira, RT atira, RB cicla arma, B recarrega — moveY não acelera para frente!
    ctx.state.currentVehicle = null;
    input.update(0.016);
    expect(input.isAimHeld()).toBe(true);
    expect(input.isFireHeld()).toBe(true);
    expect(input.getMoveAxes().forward).toBe(0);
    expect(input.consumeAction('reload')).toBe(true);
    expect(input.consumeWeaponCycleDelta()).toBe(1);

    // No veículo: RT acelera (+1), LT freia/ré, aim/fire ficam desativados
    ctx.state.currentVehicle = { id: 'car' } as VehicleEntity;
    currentPad = makePad(0, 1.0, false, false);
    input.update(0.016);
    expect(input.isAimHeld()).toBe(false);
    expect(input.isFireHeld()).toBe(false);
    expect(input.getMoveAxes().forward).toBe(1.0);

    input.dispose();
  });

  it('usa BuildingSpatialGrid por segmento sem duplicatas e detecta cápsula/normal de NPC', () => {
    const nearBuilding: BuildingCollider = {
      x: 0,
      z: -35,
      halfW: 20,
      halfD: 4,
      height: 10,
      colorHex: '#ffffff',
      label: 'BlocoProximo',
    };
    const farBuilding: BuildingCollider = {
      x: 300,
      z: 300,
      halfW: 10,
      halfD: 10,
      height: 15,
      colorHex: '#ffffff',
      label: 'BlocoDistante',
    };

    const grid = new BuildingSpatialGrid([farBuilding, nearBuilding], 32);
    const buf: number[] = [];
    grid.querySegment(0, 0, 0, -45, buf);
    expect(buf).toEqual([1]); // apenas nearBuilding, sem duplicar mesmo cruzando múltiplas células

    const hit = createEmptyBallisticHit();
    castBallisticSegment(
      0,
      3,
      0,
      0,
      3,
      -45,
      {
        buildings: [farBuilding, nearBuilding],
        buildingGrid: grid,
        vehicles: [],
        ignoreVehicleId: null,
        agents: [],
        candidateNpcIndices: [],
        groundHeightAt: () => 0,
      },
      hit
    );
    expect(hit.hit).toBe(true);
    expect(hit.kind).toBe('world');
    expect(hit.targetId).toBe('BlocoProximo');
    expect(hit.nz).toBeCloseTo(1, 4);

    // Cápsula de NPC: raio 0.28 * widthScale, altura 1.75 * heightScale, normal unitária
    const capOut: { region: 'head' | 'torso' | 'limb'; nx: number; ny: number; nz: number } = {
      region: 'torso',
      nx: 0,
      ny: 1,
      nz: 0,
    };
    const tMiss = intersectSegmentNpcCapsule(0.35, 1.0, 0, 0.35, 1.0, -20, 0, 0, -10, 1.0, 1.0, capOut);
    expect(tMiss).toBeNull();

    const tBody = intersectSegmentNpcCapsule(0, 1.1, 0, 0, 1.1, -20, 0, 0, -10, 1.0, 1.0, capOut);
    expect(tBody).not.toBeNull();
    expect(capOut.region).toBe('torso');
    expect(Math.hypot(capOut.nx, capOut.ny, capOut.nz)).toBeCloseTo(1, 4);
    expect(capOut.nz).toBeGreaterThan(0.9);
  });

  it('aplica ricochete apenas em ângulo rasante (< 12°) com perda de 60% de energia e sem penetração', () => {
    const grazingProj: BallisticProjectile = {
      active: true,
      ownerKind: 'player',
      weaponId: 'rifle',
      x: 0,
      y: 2,
      z: 0,
      vx: 200,
      vy: -20, // ~5.7° em relação ao plano horizontal (normal 0,1,0)
      vz: 0,
      gravity: 9.81,
      drag: 0.05,
      damage: 40,
      headshotMul: 3,
      limbMul: 1,
      falloffStart: 64,
      falloffMinMul: 0.5,
      impulseStrength: 10,
      traveled: 10,
      maxRange: 160,
      age: 0.05,
      maxLife: 1.5,
      ricocheted: false,
      tracerColorHex: 0xffffff,
    };
    const hit = createEmptyBallisticHit();
    hit.hit = true;
    hit.kind = 'world';
    hit.x = 5;
    hit.y = 1.5;
    hit.z = 0;
    hit.nx = 0;
    hit.ny = 1;
    hit.nz = 0;

    const speedBefore = Math.hypot(grazingProj.vx, grazingProj.vy, grazingProj.vz);
    expect(tryApplyRicochet(grazingProj, hit)).toBe(true);
    expect(grazingProj.ricocheted).toBe(true);
    expect(grazingProj.vy).toBeGreaterThan(0);
    expect(grazingProj.damage).toBeCloseTo(40 * BALLISTICS_RICOCHET_ENERGY_RETENTION, 4);
    const speedAfter = Math.hypot(grazingProj.vx, grazingProj.vy, grazingProj.vz);
    expect(speedAfter).toBeCloseTo(speedBefore * Math.sqrt(BALLISTICS_RICOCHET_ENERGY_RETENTION), 2);

    // Segundo impacto no mesmo projétil não ricocheteia novamente
    expect(tryApplyRicochet(grazingProj, hit)).toBe(false);

    // Ângulo íngreme (>= 12°) não ricocheteia
    grazingProj.ricocheted = false;
    grazingProj.vx = 100;
    grazingProj.vy = -100; // 45°
    expect(tryApplyRicochet(grazingProj, hit)).toBe(false);
  });

  it('simula fuzil a 820 m/s em passos fixos de 1/120 s sem tunneling, herda 30% da vel. do jogador e emite 1 weaponFired por tiro de escopeta', () => {
    expect(WEAPON_PROJECTILE_POOL_SIZE).toBe(128);

    const thinWall: BuildingCollider = {
      x: 0,
      z: -25,
      halfW: 12,
      halfD: 0.2, // parede fina de 40 cm
      height: 8,
      colorHex: '#cccccc',
      label: 'ParedeFina',
    };
    const ctx = createMockCtx({
      world: { buildings: [thinWall] } as unknown as EngineContext['world'],
    });
    ctx.state.weapons = [
      { id: 'fists', clip: 0, reserve: 0 },
      { id: 'rifle', clip: 30, reserve: 120 },
      { id: 'shotgun', clip: 6, reserve: 36 },
    ];
    ctx.state.activeWeaponId = 'rifle';
    ctx.state.playerVelX = 10; // jogador movendo lateralmente a 10 m/s

    const input = new InputManager();
    const cameraRig = new CameraRig(input);
    const weaponSys = new WeaponSystem(input, cameraRig, 'medium');

    const firedEvents: number[] = [];
    const worldHits: string[] = [];
    ctx.events.on('weaponFired', () => firedEvents.push(1));
    ctx.events.on('weaponHit', (ev) => {
      if (ev.targetKind === 'world') worldHits.push(ev.targetId);
    });

    input.init(ctx);
    cameraRig.init(ctx);
    weaponSys.init(ctx);

    ctx.camera.position.set(0, 1.6, 2.5);
    ctx.camera.lookAt(0, 1.6, -25);
    ctx.camera.updateMatrixWorld();
    vi.spyOn(cameraRig, 'update').mockImplementation(() => {});
    weaponSys.setMuzzlePositionProvider((out) => {
      out.set(0, 1.5, -1);
      return true;
    });

    // Atira de fuzil e avança 0.05 s (1 frame longo -> 6 subpassos de 1/120 s)
    input.setTouchInput({ fire: true });
    input.update(0.016);
    weaponSys.update(0.016);
    cameraRig.update(0.016);
    weaponSys.lateUpdate(0.05);

    expect(worldHits).toContain('ParedeFina');

    // Herança de 30% da velocidade X do jogador em parede distante a 80m
    const farWall: BuildingCollider = {
      x: 0,
      z: -80,
      halfW: 30,
      halfD: 1,
      height: 12,
      colorHex: '#cccccc',
      label: 'ParedeDistanteVel',
    };
    ctx.world.buildings = [farWall];
    ctx.state.playerVelX = 60; // 30% = +18 m/s em X
    input.setTouchInput({ fire: false, aim: true });
    input.update(0.016);
    weaponSys.update(0.35);
    weaponSys.lateUpdate(0.016);

    const farHitX: number[] = [];
    const offHit = ctx.events.on('weaponHit', (ev) => {
      if (ev.targetId === 'ParedeDistanteVel') farHitX.push(ev.x);
    });
    input.setTouchInput({ fire: true, aim: true });
    input.update(0.016);
    weaponSys.update(0.016);
    cameraRig.update(0.016);
    // Avança 0.14 s em passos de 0.04 s para cobrir ~80 m a 820 m/s
    for (let s = 0; s < 4; s++) {
      weaponSys.lateUpdate(0.04);
      input.setTouchInput({ fire: false, aim: true });
      input.update(0.016);
    }
    offHit();
    input.setTouchInput({ aim: false });
    expect(farHitX).toHaveLength(1);
    expect(farHitX[0]).toBeGreaterThan(1.0); // 18 m/s * ~0.095s ≈ +1.71 m (> máximo spread mirando 0.47 m)

    // Troca para escopeta (8 balins): deve emitir exatamente 1 weaponFired por disparo
    firedEvents.length = 0;
    weaponSys.selectWeapon('shotgun');
    weaponSys.update(0.4); // conclui troca
    input.setTouchInput({ fire: true });
    input.update(0.016);
    weaponSys.update(0.016);
    weaponSys.lateUpdate(0.016);
    expect(firedEvents).toHaveLength(1);

    weaponSys.dispose();
    cameraRig.dispose();
    input.dispose();
  });

  it('aumenta bloom pulando/correndo e aplica recuo por mola amortecida sem travar camPitch', () => {
    const ctx = createMockCtx();
    const input = new InputManager();
    const cameraRig = new CameraRig(input);
    const weaponSys = new WeaponSystem(input, cameraRig, 'medium');

    input.init(ctx);
    cameraRig.init(ctx);
    weaponSys.init(ctx);

    ctx.state.activeWeaponId = 'rifle';
    ctx.state.isGrounded = true;
    input.setTouchInput({ moveX: 0, moveY: 0, aim: false });
    input.update(0.016);
    weaponSys.update(0.016);
    const hipStillSpread = ctx.state.combat.spreadAngle;

    // Pulando (no ar) aumenta spread
    ctx.state.isGrounded = false;
    weaponSys.update(0.016);
    const airSpread = ctx.state.combat.spreadAngle;
    expect(airSpread).toBeGreaterThan(hipStillSpread);

    // Recuo por mola amortecida: impulsiona recoilPitch para cima (<0), recupera perto de 0 e não trava camPitch
    const basePitch = cameraRig.camPitch;
    cameraRig.applyRecoil(0.04, 0.01);
    cameraRig.update(0.03);
    const peakKick = cameraRig.getRecoilPitch();
    expect(peakKick).toBeLessThan(-0.005);
    expect(cameraRig.camPitch).toBe(basePitch);

    for (let i = 0; i < 40; i++) {
      cameraRig.update(0.025);
    }
    expect(Math.abs(cameraRig.getRecoilPitch())).toBeLessThan(0.002);

    weaponSys.dispose();
    cameraRig.dispose();
    input.dispose();
  });

  it('aplica dano em NPC com critérios out/unconscious/injured_recover, impulso de ragdoll (teto 10 m/s), teto de feridos e fuga não letal', () => {
    const ctx = createMockCtx();
    const input = new InputManager();
    const cameraRig = new CameraRig(input);
    const weaponSys = new WeaponSystem(input, cameraRig, 'medium');

    const npcLow = new PedestrianAI(0);
    npcLow.active = true;
    npcLow.health = 100;
    npcLow.x = 0;
    npcLow.y = 0;
    npcLow.z = -15;
    const fleeSpy = vi.spyOn(npcLow, 'triggerFlee');

    const npcRag = new PedestrianAI(1);
    npcRag.active = true;
    npcRag.health = 45;
    npcRag.x = 0;
    npcRag.y = 0;
    npcRag.z = -20;

    const npcDead = new PedestrianAI(2);
    npcDead.active = true;
    npcDead.health = 20;
    npcDead.x = 0;
    npcDead.y = 0;
    npcDead.z = -25;

    ctx.crowd.agents.push(npcLow, npcRag, npcDead);
    (ctx.crowd as unknown as { activeInjuredCount: number }).activeInjuredCount = 30; // = MAX_SIMULATED_INJURED

    input.init(ctx);
    cameraRig.init(ctx);
    weaponSys.init(ctx);

    ctx.camera.position.set(0, 1.1, 2.5);
    ctx.camera.lookAt(0, 1.1, -30);
    ctx.camera.updateMatrixWorld();
    vi.spyOn(cameraRig, 'update').mockImplementation(() => {});
    weaponSys.setMuzzlePositionProvider((out) => {
      out.set(0, 1.1, -1);
      return true;
    });

    // 1. Tiro de pistola no torso de npcLow (24 de dano -> 76 HP): não ragdolla, foge e aplica cap de feridos
    ctx.state.activeWeaponId = 'pistol';
    input.setTouchInput({ fire: true, aim: true });
    input.update(0.016);
    weaponSys.update(0.016);
    cameraRig.update(0.016);
    weaponSys.lateUpdate(0.08);
    expect(npcLow.health).toBe(76);
    expect(npcLow.ragdollActive).toBe(false);
    expect(npcLow.injuryStatus).toBe('injured');
    expect(fleeSpy).toHaveBeenCalledTimes(1);
    expect(ctx.ragdolls.accelerateOldestFade).toHaveBeenCalled();
    expect(ctx.crowd.enforceInjuredCap).toHaveBeenCalledWith(29);

    // 2. Tiro de fuzil em npcRag (health 45 -> 7 <= 28 -> outcome 'unconscious', impulso capped <= 10 m/s)
    npcLow.active = false;
    input.setTouchInput({ fire: false, aim: true });
    input.update(0.016);
    weaponSys.selectWeapon('rifle');
    weaponSys.update(0.4);
    input.setTouchInput({ fire: true, aim: true });
    input.update(0.016);
    weaponSys.update(0.016);
    cameraRig.update(0.016);
    weaponSys.lateUpdate(0.05);

    expect(npcRag.health).toBeLessThanOrEqual(28);
    expect(npcRag.ragdollActive).toBe(true);
    expect(ctx.ragdolls.spawn).toHaveBeenCalledTimes(1);
    const spawnCall1 = (ctx.ragdolls.spawn as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(spawnCall1.outcome).toBe('unconscious');
    expect(spawnCall1.impulseY).toBeGreaterThanOrEqual(1.5);
    expect(spawnCall1.impulseY).toBeLessThanOrEqual(3.5);
    expect(Math.hypot(spawnCall1.impulseX, spawnCall1.impulseY, spawnCall1.impulseZ)).toBeLessThanOrEqual(10.05);

    // 3. Headshot em npcDead (health 20 -> 0 -> outcome 'out', impulso vertical mais forte)
    npcRag.active = false;
    ctx.camera.position.set(0, 1.56, 2.5);
    ctx.camera.lookAt(0, 1.56, -30);
    ctx.camera.updateMatrixWorld();
    weaponSys.setMuzzlePositionProvider((out) => {
      out.set(0, 1.56, -1);
      return true;
    });
    input.setTouchInput({ fire: false, aim: true });
    input.update(0.016);
    weaponSys.update(0.2);
    input.setTouchInput({ fire: true, aim: true });
    input.update(0.016);
    weaponSys.update(0.016);
    cameraRig.update(0.016);
    weaponSys.lateUpdate(0.06);

    expect(npcDead.health).toBe(0);
    expect(npcDead.injuryStatus).toBe('out');
    const spawnCall2 = (ctx.ragdolls.spawn as ReturnType<typeof vi.fn>).mock.calls[1][0];
    expect(spawnCall2.outcome).toBe('out');
    expect(spawnCall2.impulseY).toBeGreaterThan(spawnCall1.impulseY);

    weaponSys.dispose();
    cameraRig.dispose();
    input.dispose();
  });

  it('emite pânico com throttle, crimes de disparo escalonados (1★ -> 2★ -> 3★), dano em veículo e damagePlayer com colete', () => {
    const ctx = createMockCtx();
    const copCar = {
      id: 'police_1',
      type: 'police',
      driver: 'police',
      mesh: new THREE.Group(),
      x: 0,
      z: -22,
      heading: 0,
      halfWidth: 1.0,
      halfLength: 2.2,
      health: 100,
      maxHealth: 100,
      damageRatio: 0,
      maxSpeed: 30,
      npcTargetSpeed: 0,
    } as unknown as VehicleEntity;

    const witness = new PedestrianAI(0);
    witness.active = true;
    witness.x = 6;
    witness.y = 0;
    witness.z = 0;

    ctx.crowd.agents.push(witness);
    ctx.vehicles = [copCar];

    const input = new InputManager();
    const cameraRig = new CameraRig(input);
    const weaponSys = new WeaponSystem(input, cameraRig, 'medium');

    const crimes: Array<{ minStars: number; source: string }> = [];
    const damaged: Array<{ amount: number; armorAbsorbed: number; source: string }> = [];
    const died: Array<{ hospitalFee: number }> = [];
    ctx.events.on('crimeCommitted', (c) => crimes.push({ minStars: c.minStars, source: c.source }));
    ctx.events.on('playerDamaged', (d) => damaged.push(d));
    ctx.events.on('playerDied', (d) => died.push({ hospitalFee: d.hospitalFee }));

    input.init(ctx);
    cameraRig.init(ctx);
    weaponSys.init(ctx);

    ctx.state.activeWeaponId = 'rifle';
    ctx.camera.position.set(0, 0.9, 2.5);
    ctx.camera.lookAt(0, 0.9, -30);
    ctx.camera.updateMatrixWorld();
    vi.spyOn(cameraRig, 'update').mockImplementation(() => {});
    weaponSys.setMuzzlePositionProvider((out) => {
      out.set(0, 0.9, -1);
      return true;
    });

    // Tiro em direção à viatura policial: dispara 1★ pelo tiro em público e escala imediatamente para 3★ ao acertar viatura
    input.setTouchInput({ fire: true, aim: true });
    input.update(0.016);
    weaponSys.update(0.016);
    cameraRig.update(0.016);
    weaponSys.lateUpdate(0.06);

    expect(ctx.crowd.triggerPanicRadius).toHaveBeenCalled();
    expect(copCar.health!).toBeLessThan(100);
    expect(copCar.damageRatio!).toBeGreaterThan(0);
    expect(crimes.some((c) => c.source === 'shooting' && c.minStars === 1)).toBe(true);
    expect(crimes.some((c) => c.source === 'shooting' && c.minStars === 3)).toBe(true);

    // Dano ao jogador com colete absorve até 65% e emite playerDamaged
    ctx.state.health = 100;
    ctx.state.armor = 50;
    ctx.state.money = 300;
    const hit1 = weaponSys.damagePlayer(40, 'gunshot');
    expect(hit1.armorAbsorbed).toBeCloseTo(26, 4);
    expect(hit1.healthLost).toBeCloseTo(14, 4);
    expect(hit1.died).toBe(false);
    expect(ctx.state.armor).toBeCloseTo(24, 4);
    expect(ctx.state.health).toBeCloseTo(86, 4);
    expect(damaged).toHaveLength(1);

    // Dano letal emite playerDied, cobra taxa hospitalar e respawna no Hospital Santa Maré (-96, 32)
    const hit2 = weaponSys.damagePlayer(200, 'gunshot');
    expect(hit2.died).toBe(true);
    expect(died).toEqual([{ hospitalFee: 150 }]);
    expect(ctx.state.money).toBe(150);
    expect(ctx.state.health).toBe(100);
    expect(ctx.state.playerPos.x).toBe(-96);
    expect(ctx.state.playerPos.z).toBe(32);

    // Loja emite banner informativo quando falta dinheiro
    ctx.state.money = 50;
    const banners: string[] = [];
    ctx.events.on('bannerRequested', (b) => banners.push(b.text));
    const failBuy = weaponSys.buyGunShopItem('rifle');
    expect(failBuy.ok).toBe(false);
    expect(banners.some((b) => b.includes('Dinheiro insuficiente'))).toBe(true);

    weaponSys.dispose();
    cameraRig.dispose();
    input.dispose();
  });

  it('constrói modelos low-poly de armas com nó muzzle por arma e anima mira, recarga, troca e soco no PlayerRig', () => {
    const ctx = createMockCtx();
    const input = new InputManager();
    const cameraRig = new CameraRig(input);
    const playerCtrl = new PlayerController(input, cameraRig, createMockShadowTex());

    input.init(ctx);
    cameraRig.init(ctx);
    playerCtrl.init(ctx);

    const rig = playerCtrl.playerRig;
    expect(rig.weaponMount).toBeDefined();
    expect(rig.weaponMeshes).toBeDefined();
    expect(rig.weaponMuzzles).toBeDefined();

    // Cada arma tem várias partes low-poly e um nó 'muzzle' distinto
    for (const id of ['pistol', 'smg', 'shotgun', 'rifle'] as const) {
      const grp = rig.weaponMeshes![id];
      const muzzle = rig.weaponMuzzles![id];
      expect(grp).toBeDefined();
      expect(grp.children.length).toBeGreaterThanOrEqual(4);
      expect(muzzle).toBeDefined();
      expect(muzzle.name).toBe('muzzle');
    }

    // Posição do nó muzzle muda entre pistola e fuzil
    ctx.state.activeWeaponId = 'pistol';
    playerCtrl.syncTransform();
    const pistolMuzzleWorld = new THREE.Vector3();
    playerCtrl.getMuzzleWorldPosition(pistolMuzzleWorld);

    ctx.state.activeWeaponId = 'rifle';
    playerCtrl.syncTransform();
    const rifleMuzzleWorld = new THREE.Vector3();
    playerCtrl.getMuzzleWorldPosition(rifleMuzzleWorld);
    expect(pistolMuzzleWorld.distanceTo(rifleMuzzleWorld)).toBeGreaterThan(0.2);

    // Animação de recarga: a arma desce e gira (mount rotZ / rotY > 0)
    ctx.state.combat.weaponState = 'reloading';
    ctx.state.combat.reloading = true;
    ctx.state.combat.reloadProgress = 0.5;
    for (let i = 0; i < 8; i++) playerCtrl.update(0.03);
    expect(rig.weaponMount!.rotation.z).toBeGreaterThan(0.25);
    expect(rig.weaponMount!.rotation.y).toBeGreaterThan(0.15);

    // Animação de troca (guarda antes de 0.45, saca depois)
    ctx.state.combat.reloading = false;
    ctx.state.combat.weaponState = 'switching';
    ctx.state.combat.switchProgress = 0.25;
    ctx.state.activeWeaponId = 'shotgun';
    for (let i = 0; i < 4; i++) playerCtrl.update(0.025);
    expect(rig.weaponMeshes!.rifle.visible).toBe(true); // ainda guardando a anterior
    ctx.state.combat.switchProgress = 0.7;
    playerCtrl.update(0.025);
    expect(rig.weaponMeshes!.shotgun.visible).toBe(true); // sacou a nova

    // Animação de soco
    ctx.state.combat.weaponState = 'idle';
    ctx.state.activeWeaponId = 'fists';
    ctx.state.combat.meleeSwingTimer = 0.14;
    for (let i = 0; i < 5; i++) playerCtrl.update(0.02);
    expect(rig.rightArmPivot.rotation.x).toBeLessThan(-0.7);
    expect(rig.torsoGroup.rotation.y).toBeLessThan(-0.15);

    playerCtrl.dispose();
    cameraRig.dispose();
    input.dispose();
  });

  it('usa UMA PointLight + sprite de flash, rastro a cada N balas, impacto por material e hit-stop só em abate/headshot', () => {
    const wall: BuildingCollider = {
      x: 0,
      z: -35,
      halfW: 12,
      halfD: 1,
      height: 10,
      colorHex: '#cccccc',
      label: 'ParedeAudio',
    };
    const ctx = createMockCtx({
      world: { buildings: [wall] } as unknown as EngineContext['world'],
    });
    const npcNormal = new PedestrianAI(0);
    npcNormal.active = true;
    npcNormal.health = 100;
    npcNormal.x = 0;
    npcNormal.y = 0;
    npcNormal.z = -15;

    const npcKill = new PedestrianAI(1);
    npcKill.active = true;
    npcKill.health = 20;
    npcKill.x = 0;
    npcKill.y = 0;
    npcKill.z = -22;

    ctx.crowd.agents.push(npcNormal, npcKill);

    const input = new InputManager();
    const cameraRig = new CameraRig(input);
    const weaponSys = new WeaponSystem(input, cameraRig, 'medium');

    input.init(ctx);
    cameraRig.init(ctx);
    weaponSys.init(ctx);

    // Exatamente UMA PointLight e UM Sprite de muzzle flash na cena
    let pointLights = 0;
    let sprites = 0;
    ctx.scene.traverse((obj) => {
      if (obj instanceof THREE.PointLight) pointLights++;
      if (obj instanceof THREE.Sprite) sprites++;
    });
    expect(pointLights).toBe(1);
    expect(sprites).toBe(1);

    ctx.camera.position.set(0, 1.1, 2.5);
    ctx.camera.lookAt(0, 1.1, -40);
    ctx.camera.updateMatrixWorld();
    vi.spyOn(cameraRig, 'update').mockImplementation(() => {});
    weaponSys.setMuzzlePositionProvider((out) => {
      out.set(0, 1.1, -1);
      return true;
    });

    // Tiro 1 (torso normal, 24 dano -> 76 HP): flash + tremor leve, SEM hit-stop, áudio de impacto 'npc'
    ctx.state.activeWeaponId = 'pistol';
    ctx.state.hitStopTimer = 0;
    input.setTouchInput({ fire: true, aim: true });
    input.update(0.016);
    weaponSys.update(0.016);
    cameraRig.update(0.016);
    weaponSys.lateUpdate(0.08);
    expect(npcNormal.health).toBe(76);
    expect(ctx.state.hitStopTimer).toBe(0);
    expect(ctx.state.cameraShake).toBeGreaterThan(0);
    expect(ctx.audio.playBulletImpact).toHaveBeenCalledWith('npc', expect.any(Number));

    // Flash visível logo após tiro e apaga após ~0.06 s
    let lightObj: THREE.PointLight | null = null;
    ctx.scene.traverse((obj) => {
      if (obj instanceof THREE.PointLight) lightObj = obj;
    });
    expect(lightObj).not.toBeNull();
    weaponSys.lateUpdate(0.08);
    expect(lightObj!.visible).toBe(false);

    // Tiro 2 na parede de concreto: áudio 'concrete' e sem hit-stop
    npcNormal.active = false;
    npcKill.active = false;
    input.setTouchInput({ fire: false, aim: true });
    input.update(0.016);
    weaponSys.update(0.25);
    weaponSys.lateUpdate(0.016);

    input.setTouchInput({ fire: true, aim: true });
    input.update(0.016);
    weaponSys.update(0.016);
    cameraRig.update(0.016);
    weaponSys.lateUpdate(0.045);
    input.setTouchInput({ fire: false, aim: true });
    input.update(0.016);
    weaponSys.lateUpdate(0.045);
    weaponSys.lateUpdate(0.045);
    expect(ctx.audio.playBulletImpact).toHaveBeenCalledWith('concrete', expect.any(Number));
    expect(ctx.state.hitStopTimer).toBe(0);

    // Tiro 3 abate npcKill (20 HP -> 0 'out'): ativa hit-stop bem curto (> 0 e <= 0.04 s)
    npcKill.active = true;
    input.setTouchInput({ fire: false, aim: true });
    input.update(0.016);
    weaponSys.update(0.25);
    weaponSys.lateUpdate(0.016);

    input.setTouchInput({ fire: true, aim: true });
    input.update(0.016);
    weaponSys.update(0.016);
    cameraRig.update(0.016);
    weaponSys.lateUpdate(0.12);
    expect(npcKill.health).toBe(0);
    expect(ctx.state.hitStopTimer).toBeGreaterThan(0);
    expect(ctx.state.hitStopTimer).toBeLessThanOrEqual(0.04);

    weaponSys.dispose();
    cameraRig.dispose();
    input.dispose();
  });

  it('estende HudSnapshot/HudBridge com campos de arma/recarga, marca lastHitKill em abate e abre roda de armas segurando Tab', () => {
    const keyListeners = new Map<string, Array<(e: KeyboardEvent) => void>>();
    vi.stubGlobal('window', {
      addEventListener: (type: string, cb: (e: KeyboardEvent) => void) => {
        const arr = keyListeners.get(type) ?? [];
        arr.push(cb);
        keyListeners.set(type, arr);
      },
      removeEventListener: vi.fn(),
    });
    vi.stubGlobal('document', {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });

    const ctx = createMockCtx();
    ctx.transit = {
      getTotalBusPassengers: () => 0,
      getActiveBusesCount: () => 0,
      getAmbulanceStatusLabel: () => 'Pronta',
    } as unknown as EngineContext['transit'];
    ctx.weatherEffects = {
      current: 'clear',
      label: 'Céu Limpo',
      grip: 1,
      rainIntensity: 0,
    } as unknown as EngineContext['weatherEffects'];
    ctx.crowd = {
      ...ctx.crowd,
      activeCount: 0,
      backgroundCount: 0,
      insideCount: 0,
      nearbyCount: 0,
      lodSystem: { counts: { full: 0, mid: 0, low: 0 } },
      maxVisibleNpcs: 32,
      zoneDensity: { getStatsSnapshot: () => [], alerts: [] },
      graph: { getSignalLabel: () => 'N-S Verde' },
    } as unknown as EngineContext['crowd'];

    const npcTarget = new PedestrianAI(0);
    npcTarget.active = true;
    npcTarget.health = 20;
    npcTarget.x = 0;
    npcTarget.y = 0;
    npcTarget.z = -14;
    ctx.crowd.agents.push(npcTarget);

    let lastSnapshot: HudSnapshot | null = null;
    const bridge = new HudBridge(
      (snap) => {
        lastSnapshot = snap;
      },
      {
        getWantedSnapshot: () => ({ stars: 0, evadingProgress: 0, bustProgress: 0, bustedFlash: false }),
        getMissionSnapshot: () => ({ id: 'none', step: 0, title: '', objective: '', targetPos: null, completedMissions: [] }),
        hasNearbyVehicle: () => false,
        getTimeLabel: () => 'Dia',
        getFormattedClock: () => '12:00',
        isWeekend: () => false,
        getQualityPreset: () => 'medium',
        getInjuredTotalCount: () => 0,
        isGamepadConnected: () => false,
        isPointerLocked: () => false,
      }
    );

    const input = new InputManager();
    const cameraRig = new CameraRig(input);
    const weaponSys = new WeaponSystem(input, cameraRig, 'medium');

    input.init(ctx);
    cameraRig.init(ctx);
    weaponSys.init(ctx);
    bridge.init(ctx);

    ctx.state.activeWeaponId = 'pistol';
    ctx.camera.position.set(0, 1.0, 2.5);
    ctx.camera.lookAt(0, 1.0, -30);
    ctx.camera.updateMatrixWorld();
    vi.spyOn(cameraRig, 'update').mockImplementation(() => {});
    weaponSys.setMuzzlePositionProvider((out) => {
      out.set(0, 1.0, -1);
      return true;
    });

    // 1. Segurar Tab abre a roda de armas; soltar Tab fecha
    const emitKey = (type: 'keydown' | 'keyup', code: string) => {
      const ev = { code, repeat: false, preventDefault: vi.fn() } as unknown as KeyboardEvent;
      for (const fn of keyListeners.get(type) ?? []) fn(ev);
    };

    emitKey('keydown', 'Tab');
    input.update(0.016);
    weaponSys.update(0.016);
    expect(ctx.state.combat.weaponWheelOpen).toBe(true);

    // Fechar manualmente (ex.: clique em arma) mantém fechada enquanto Tab ainda estiver pressionado
    weaponSys.setWeaponWheelOpen(false);
    input.update(0.016);
    weaponSys.update(0.016);
    expect(ctx.state.combat.weaponWheelOpen).toBe(false);

    emitKey('keyup', 'Tab');
    input.update(0.016);
    weaponSys.update(0.016);
    expect(ctx.state.combat.weaponWheelOpen).toBe(false);

    // Segurar Tab novamente reabre e soltar fecha
    emitKey('keydown', 'Tab');
    input.update(0.016);
    weaponSys.update(0.016);
    expect(ctx.state.combat.weaponWheelOpen).toBe(true);

    emitKey('keyup', 'Tab');
    input.update(0.016);
    weaponSys.update(0.016);
    expect(ctx.state.combat.weaponWheelOpen).toBe(false);

    // 2. Mira + recarga + abate propagam todos os novos campos no HudSnapshot
    input.setTouchInput({ aim: true, reload: true });
    input.update(0.016);
    weaponSys.update(0.016);
    bridge.emitNow();
    expect(lastSnapshot!.activeWeaponId).toBe('pistol');
    expect(lastSnapshot!.weaponName).toBe(WEAPONS.pistol.name);
    expect(lastSnapshot!.ammoClip).toBe(12);
    expect(lastSnapshot!.ammoReserve).toBe(48);
    expect(lastSnapshot!.isAiming).toBe(true);
    expect(lastSnapshot!.isReloading).toBe(false);
    expect(lastSnapshot!.reloadProgress).toBe(0);

    // Atira para abater NPC e recarregar parcialmente
    input.setTouchInput({ aim: true, reload: false, fire: true });
    input.update(0.016);
    weaponSys.update(0.016);
    cameraRig.update(0.016);
    weaponSys.lateUpdate(0.09);
    expect(npcTarget.health).toBe(0);
    expect(ctx.state.combat.lastHitKill).toBe(true);

    input.setTouchInput({ aim: true, reload: true, fire: false });
    input.update(0.016);
    weaponSys.update(0.5);
    bridge.emitNow();

    expect(lastSnapshot!.ammoClip).toBe(11);
    expect(lastSnapshot!.isReloading).toBe(true);
    expect(lastSnapshot!.reloadProgress).toBeGreaterThan(0);
    expect(lastSnapshot!.weapon.lastHitKill).toBe(true);

    weaponSys.dispose();
    cameraRig.dispose();
    input.dispose();
    bridge.dispose();
  });

  it('testa interseção raio x AABB, esfera, cápsula e OBB rotacionada, fórmula de queda e spread uniforme dentro do cone', () => {
    const nOut = { nx: 0, ny: 0, nz: 0 };

    // 1. Raio x AABB
    const tBoxHit = intersectSegmentAABB(0, 1, 5, 0, 1, -5, -1, 0, -1, 1, 2, 1, nOut);
    expect(tBoxHit).toBeCloseTo(0.4, 5);
    expect(nOut).toEqual({ nx: 0, ny: 0, nz: 1 });
    expect(intersectSegmentAABB(2.5, 1, 5, 2.5, 1, -5, -1, 0, -1, 1, 2, 1, nOut)).toBeNull();

    // 2. Raio x Esfera
    const tSphHit = intersectSegmentSphere(0, 0, 5, 0, 0, -5, 0, 0, 0, 1, nOut);
    expect(tSphHit).toBeCloseTo(0.4, 5);
    expect(nOut.nz).toBeCloseTo(1, 5);
    expect(intersectSegmentSphere(1.5, 0, 5, 1.5, 0, -5, 0, 0, 0, 1, nOut)).toBeNull();

    // 3. Raio x Cápsula
    const capOut = { region: 'torso' as 'head' | 'torso' | 'limb', nx: 0, ny: 0, nz: 0 };
    expect(intersectSegmentNpcCapsule(0, 1.58, 4, 0, 1.58, -4, 0, 0, 0, 1, 1, capOut)).not.toBeNull();
    expect(capOut.region).toBe('head');
    expect(intersectSegmentNpcCapsule(0, 0.2, 4, 0, 0.2, -4, 0, 0, 0, 1, 1, capOut)).not.toBeNull();
    expect(capOut.region).toBe('limb');

    // 4. Raio x OBB rotacionada a 45° (heading = Math.PI/4)
    const rotatedCar = {
      id: 'car_rot',
      type: 'sedan',
      mesh: new THREE.Group(),
      x: 0,
      z: -20,
      heading: Math.PI / 4,
      halfWidth: 1.0,
      halfLength: 2.5,
    } as unknown as VehicleEntity;
    const hit = createEmptyBallisticHit();
    // Ponto (1.9, 0.8, -18.1) está fora se não rotacionado (halfWidth=1), mas dentro do OBB de 2.5m rotacionado a 45°!
    castBallisticSegment(
      1.9,
      0.8,
      -10,
      1.9,
      0.8,
      -26,
      {
        buildings: [],
        vehicles: [rotatedCar],
        ignoreVehicleId: null,
        agents: [],
        candidateNpcIndices: [],
        groundHeightAt: () => 0,
      },
      hit
    );
    expect(hit.hit).toBe(true);
    expect(hit.kind).toBe('vehicle');
    expect(Math.hypot(hit.nx, hit.ny, hit.nz)).toBeCloseTo(1, 4);

    // 5. Queda do projétil conferida contra fórmula cinemática y0 - 0.5 * g * t^2
    const proj: BallisticProjectile = {
      active: true,
      ownerKind: 'player',
      weaponId: 'rifle',
      x: 0,
      y: 10,
      z: 0,
      vx: 0,
      vy: 0,
      vz: -820,
      gravity: BALLISTICS_GRAVITY,
      drag: 0,
      damage: 38,
      headshotMul: 3,
      limbMul: 1,
      falloffStart: 64,
      falloffMinMul: 0.5,
      impulseStrength: 10,
      traveled: 0,
      maxRange: 1000,
      age: 0,
      maxLife: 5,
      ricocheted: false,
      tracerColorHex: 0xffffff,
    };
    const next = { x: 0, y: 0, z: 0 };
    const steps = 60; // t = 0.5 s
    for (let s = 0; s < steps; s++) {
      advanceProjectileStep(proj, BALLISTICS_FIXED_STEP, next);
      proj.x = next.x;
      proj.y = next.y;
      proj.z = next.z;
    }
    const tTotal = steps * BALLISTICS_FIXED_STEP;
    const expectedDiscreteDrop = BALLISTICS_GRAVITY * BALLISTICS_FIXED_STEP * BALLISTICS_FIXED_STEP * (steps * (steps + 1)) * 0.5;
    const analyticalDrop = 0.5 * BALLISTICS_GRAVITY * tTotal * tTotal;
    expect(10 - proj.y).toBeCloseTo(expectedDiscreteDrop, 6);
    expect(Math.abs(10 - proj.y - analyticalDrop)).toBeLessThan(0.03);

    // 6. Spread uniforme dentro do cone
    const spreadRad = 0.08;
    const outDir = { x: 0, y: 0, z: 0 };
    for (let i = 0; i < 64; i++) {
      const a = (i / 64) * Math.PI * 2;
      const m = (i % 8) / 7;
      computeSpreadDirection(0, 0, -1, spreadRad, a, m, outDir);
      expect(Math.hypot(outDir.x, outDir.y, outDir.z)).toBeCloseTo(1, 5);
      const angle = Math.acos(Math.max(-1, Math.min(1, -outDir.z)));
      expect(angle).toBeLessThanOrEqual(spreadRad + 1e-5);
    }
    computeSpreadDirection(0, 0, -1, spreadRad, 0, 0.25, outDir);
    const halfConeAngle = Math.acos(Math.max(-1, Math.min(1, -outDir.z)));
    expect(halfConeAngle).toBeCloseTo(Math.atan(spreadRad * 0.5), 5);
  });

  it('ignora recarga com pente cheio ou sem reserva, restaura save com activeWeaponId inválido e expõe debug F3/P', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => store.set(k, v),
      },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    vi.stubGlobal('document', {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });

    // Save v2 com activeWeaponId inválido deve restaurar para 'fists' preservando armas válidas
    store.set(
      SAVE_STORAGE_KEY,
      JSON.stringify({
        version: 2,
        savedAtIso: '2026-11-23T12:00:00.000Z',
        money: 1200,
        health: 95,
        armor: 40,
        playerX: 10,
        playerZ: 15,
        playerYaw: 0.5,
        currentVehicleId: null,
        gameTime: 14,
        dayNumber: 2,
        weather: 'clear',
        weapons: [
          { id: 'bazooka_falsa', clip: 1, reserve: 10 },
          { id: 'pistol', clip: 8, reserve: 36 },
        ],
        activeWeaponId: 'bazooka_falsa',
        outfit: { hat: 'none', glasses: 'none', torso: 'torso_jacket_neon', legs: 'legs_denim' },
        completedMissions: [],
        completedEvents: [],
        discoveredAreas: [],
        vehicles: [],
      })
    );

    const wall: BuildingCollider = {
      x: 0,
      z: -16,
      halfW: 10,
      halfD: 1,
      height: 8,
      colorHex: '#cccccc',
      label: 'AlvoDebug',
    };
    const ctx = createMockCtx({
      world: { buildings: [wall] } as unknown as EngineContext['world'],
      weatherSystem: { setWeather: vi.fn() } as unknown as EngineContext['weatherSystem'],
    });
    const loaded = restoreSaveIntoContext(ctx);
    expect(loaded).not.toBeNull();
    expect(ctx.state.activeWeaponId).toBe('fists');
    expect(ctx.state.weapons.map((w) => w.id)).toEqual(['fists', 'pistol']);

    const input = new InputManager();
    const cameraRig = new CameraRig(input);
    const weaponSys = new WeaponSystem(input, cameraRig, 'medium');
    input.init(ctx);
    cameraRig.init(ctx);
    weaponSys.init(ctx);

    // Máquina de estados de munição: pente cheio não recarrega; sem reserva não recarrega
    ctx.state.weapons = [
      { id: 'fists', clip: 0, reserve: 0 },
      { id: 'pistol', clip: WEAPONS.pistol.clipSize, reserve: 24 },
    ];
    ctx.state.activeWeaponId = 'pistol';
    input.setTouchInput({ reload: true });
    input.update(0.016);
    weaponSys.update(0.016);
    expect(ctx.state.combat.reloading).toBe(false);
    expect(ctx.audio.playReload).not.toHaveBeenCalled();

    const pistol = ctx.state.weapons.find((w) => w.id === 'pistol')!;
    pistol.clip = 4;
    pistol.reserve = 0;
    input.setTouchInput({ reload: false });
    input.update(0.016);
    input.setTouchInput({ reload: true });
    input.update(0.016);
    weaponSys.update(0.016);
    expect(ctx.state.combat.reloading).toBe(false);

    // Pente vazio e reserva 0 -> clique seco sem iniciar recarga
    pistol.clip = 0;
    input.setTouchInput({ reload: false, fire: true });
    input.update(0.016);
    weaponSys.update(0.016);
    cameraRig.update(0.016);
    weaponSys.lateUpdate(0.016);
    expect(ctx.audio.playDryFire).toHaveBeenCalled();
    expect(ctx.state.combat.reloading).toBe(false);

    // Debug F3/P: contadores ativos + trajetórias + hitboxes de NPC/veículo
    pistol.clip = 12;
    pistol.reserve = 24;
    ctx.state.showDebugPanel = true;
    input.setTouchInput({ fire: false, aim: true });
    input.update(0.1);
    weaponSys.update(0.1);
    weaponSys.lateUpdate(0.1);

    ctx.camera.position.set(0, 1.2, 2.5);
    ctx.camera.lookAt(0, 1.2, -30);
    ctx.camera.updateMatrixWorld();
    vi.spyOn(cameraRig, 'update').mockImplementation(() => {});
    weaponSys.setMuzzlePositionProvider((out) => {
      out.set(0, 1.2, -1);
      return true;
    });

    input.setTouchInput({ fire: true, aim: true });
    input.update(0.016);
    weaponSys.update(0.016);
    cameraRig.update(0.016);
    weaponSys.lateUpdate(0.016); // projétil ainda em voo (330 m/s * 0.016 ≈ 5.2 m, parede em z=-16)
    const midStats = weaponSys.getDebugStats();
    expect(midStats.activeProjectiles).toBeGreaterThanOrEqual(1);

    input.setTouchInput({ fire: false, aim: true });
    input.update(0.016);
    weaponSys.lateUpdate(0.05);
    weaponSys.lateUpdate(0.05);
    const hitStats = weaponSys.getDebugStats();
    expect(hitStats.activeDecals).toBeGreaterThanOrEqual(1);
    expect(hitStats.activeParticles).toBeGreaterThan(0);

    // Hitboxes do BuildingRegistry (P): cria grupos e atualiza cápsulas + cabeças + OBBs sem erros
    const reg = new BuildingRegistry([wall]);
    const car = {
      id: 'car_dbg',
      type: 'sedan',
      mesh: new THREE.Group(),
      x: 4,
      z: -6,
      heading: 0.3,
      halfWidth: 1,
      halfLength: 2.2,
    } as unknown as VehicleEntity;
    const groups = reg.getDebugColliderGroups([wall], [car], 4);
    expect(groups.dynamicGroup.children.length).toBeGreaterThanOrEqual(3); // car OBB + npcCapsule + npcHead
    reg.updateDynamicColliders([car], [
      { active: true, inside: false, x: 1, y: 0, z: -4, widthScale: 1.1, heightScale: 0.95 },
      { active: false, inside: false, x: 0, y: 0, z: 0, widthScale: 1, heightScale: 1 },
    ]);

    weaponSys.dispose();
    cameraRig.dispose();
    input.dispose();
  });
});




