import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import {
  INITIAL_GAME_TIME,
  PLAYER_MAX_HEALTH,
  PLAYER_SPAWN_X,
  PLAYER_SPAWN_YAW,
  PLAYER_SPAWN_Z,
  QUALITY_SETTINGS,
  STARTING_MONEY,
} from '../config';
import { ImpactSystem } from '../ImpactSystem';
import { WorldThreatContext } from '../PedestrianAI';
import { BuildingCollider } from '../types';
import { WORLD_BOUNDS } from '../world';
import { WorldRegistry } from '../world/WorldRegistry';
import { DEFAULT_RADIO_STATION_ID, getRadioStation } from '../RadioStations';
import { DEFAULT_OUTFIT_STATE, DEFAULT_WEAPONS_STATE } from './SaveSystem';
import { EngineContext, RadioRuntimeState, SimulationState } from './SystemLifecycle';

export function createInitialRadioState(): RadioRuntimeState {
  const station = getRadioStation(DEFAULT_RADIO_STATION_ID);
  const track = station.tracks[0];
  return {
    stationId: station.id,
    stationName: station.name,
    frequency: station.frequency,
    genre: station.genre,
    colorHex: station.colorHex,
    trackTitle: track.title,
    trackArtist: track.artist,
    trackIndex: 0,
    trackCount: station.tracks.length,
    isOff: station.id === 'off',
    notificationTimer: 0,
    wheelOpen: false,
    trackIndexByStation: {
      solara_fm: 0,
      baia_beats: 0,
      litoral_rock: 0,
      costa_chill: 0,
      noticias_bs: 0,
      off: 0,
    },
    trackElapsedByStation: {
      solara_fm: 0,
      baia_beats: 0,
      litoral_rock: 0,
      costa_chill: 0,
      noticias_bs: 0,
      off: 0,
    },
  };
}

export function createInitialSimulationState(startPaused: boolean): SimulationState {
  const startLoc = WorldRegistry.getLocationLabelAt(PLAYER_SPAWN_X, PLAYER_SPAWN_Z);
  return {
    playerPos: new THREE.Vector3(PLAYER_SPAWN_X, 0, PLAYER_SPAWN_Z),
    playerYaw: PLAYER_SPAWN_YAW,
    playerVelX: 0,
    playerVelY: 0,
    playerVelZ: 0,
    isGrounded: true,
    health: PLAYER_MAX_HEALTH,
    armor: 0,
    currentVehicle: null,
    missionCar: null,
    money: STARTING_MONEY,
    gameTime: INITIAL_GAME_TIME,
    dayNumber: 1,
    timeScale: 1,
    timeNormalized: 0,
    elapsedSec: 0,
    paused: startPaused,
    hitStopTimer: 0,
    cameraShake: 0,
    currentFps: 60,
    currentDistrictId: startLoc.district.id,
    currentDistrictName: startLoc.district.name,
    currentStreetName: startLoc.streetName,
    weapons: DEFAULT_WEAPONS_STATE.map((w) => ({ ...w })),
    activeWeaponId: 'fists',
    outfit: { ...DEFAULT_OUTFIT_STATE },
    completedEvents: [],
    discoveredAreas: [startLoc.district.id],
    renderTelemetry: {
      calls: 0,
      triangles: 0,
      geometries: 0,
      textures: 0,
      programs: 0,
      pixelRatio: 1,
      dynamicScalePct: 100,
      drawDistance: QUALITY_SETTINGS.medium.drawDistance,
      chunksTotal: 0,
      chunksFull: 0,
      chunksImpostor: 0,
      chunksUnloaded: 0,
    },
    lastSavedAtIso: null,
    showWaypoints: false,
    showColliders: false,
    showRoutineLabels: false,
    showDebugPanel: false,
    bannerText: 'Bem-vindo a Baía Solara! Explore ou inicie uma missão.',
    bannerTimer: 5.5,
    combat: {
      weaponState: 'idle',
      aiming: false,
      reloading: false,
      reloadProgress: 0,
      switchProgress: 1,
      recoilKickTimer: 0,
      meleeSwingTimer: 0,
      shoulderSide: 1,
      spreadAngle: 0,
      hitMarkerTimer: 0,
      lastHitHeadshot: false,
      lastHitKill: false,
      gunShopOpen: false,
      weaponWheelOpen: false,
      nearGunShop: false,
    },
    radio: createInitialRadioState(),
    vehicleAccess: {
      active: false,
      vehicleId: null,
      x: PLAYER_SPAWN_X,
      y: 0,
      z: PLAYER_SPAWN_Z,
      yaw: PLAYER_SPAWN_YAW,
      walkPhase: 0,
      sitBlend: 0,
      visible: false,
    },
  };
}

export function createDefaultThreatContext(): WorldThreatContext {
  return {
    playerX: PLAYER_SPAWN_X,
    playerZ: PLAYER_SPAWN_Z,
    fastVehicles: [],
    chasingPolice: [],
    isNight: false,
    gameTime: INITIAL_GAME_TIME,
    isWeekend: false,
    weather: 'clear',
  };
}

export function detectSoftwareWebGL(): boolean {
  const probe = document.createElement('canvas').getContext('webgl2');
  if (!probe) return true;
  const ext = probe.getExtension('WEBGL_debug_renderer_info');
  const gpu = String(probe.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : probe.RENDERER));
  probe.getExtension('WEBGL_lose_context')?.loseContext();
  return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
}

export function createRendererSceneCamera(container: HTMLElement, isSoftwareGl: boolean) {
  const w = container.clientWidth || window.innerWidth;
  const h = container.clientHeight || window.innerHeight;
  const renderer = new THREE.WebGLRenderer({
    antialias: !isSoftwareGl,
    powerPreference: 'high-performance',
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = !isSoftwareGl;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setSize(w, h);
  renderer.domElement.style.cssText = 'display:block;width:100%;height:100%';
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x28133d);
  scene.fog = new THREE.FogExp2(0x28133d, 0.0056);
  const camera = new THREE.PerspectiveCamera(60, w / h, 0.2, 680);

  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();

  return { renderer, scene, camera };
}

export function groundHeightAt(x: number, z: number, currentY = 0): number {
  return WorldRegistry.getTerrainHeightAt(x, z, currentY);
}

export function resolveWorldCollisions(
  pos: THREE.Vector3,
  radius: number,
  buildings: BuildingCollider[]
): boolean {
  let hit = false;
  const coastX = WorldRegistry.getCoastlineX(pos.z);
  const maxX = Math.abs(pos.z - 130) < 4.5 ? coastX + 41 : Math.min(WORLD_BOUNDS.maxX, coastX + 24);
  if (pos.x < WORLD_BOUNDS.minX + 2) {
    pos.x = WORLD_BOUNDS.minX + 2;
    hit = true;
  }
  if (pos.x > maxX) {
    pos.x = maxX;
    hit = true;
  }
  if (pos.z < WORLD_BOUNDS.minZ + 2) {
    pos.z = WORLD_BOUNDS.minZ + 2;
    hit = true;
  }
  if (pos.z > WORLD_BOUNDS.maxZ - 2) {
    pos.z = WORLD_BOUNDS.maxZ - 2;
    hit = true;
  }

  if (WorldRegistry.resolveInfrastructureCollisions(pos, radius)) {
    hit = true;
  }

  for (const b of buildings) {
    const minX = b.x - b.halfW - radius;
    const maxBX = b.x + b.halfW + radius;
    const minZ = b.z - b.halfD - radius;
    const maxBZ = b.z + b.halfD + radius;

    if (pos.x > minX && pos.x < maxBX && pos.z > minZ && pos.z < maxBZ) {
      const dxLeft = pos.x - minX;
      const dxRight = maxBX - pos.x;
      const dzTop = pos.z - minZ;
      const dzBottom = maxBZ - pos.z;
      const minPen = Math.min(dxLeft, dxRight, dzTop, dzBottom);
      if (minPen === dxLeft) pos.x = minX;
      else if (minPen === dxRight) pos.x = maxBX;
      else if (minPen === dzTop) pos.z = minZ;
      else pos.z = maxBZ;
      hit = true;
    }
  }
  return hit;
}

export function updateOceanWaves(ctx: EngineContext): void {
  const pos = ctx.world.oceanMesh.geometry.attributes.position;
  const baseY = ctx.world.oceanBaseY;
  const t = ctx.state.elapsedSec * 1.8;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    pos.setY(i, baseY[i] + Math.sin(x * 0.09 + t) * 0.16 + Math.cos(z * 0.11 + t * 0.8) * 0.12);
  }
  pos.needsUpdate = true;
}

export function stepCrowdAndImpacts(
  ctx: EngineContext,
  dt: number,
  threatCtx: WorldThreatContext,
  impact: ImpactSystem,
  wantedStars: number,
  isNight: boolean,
  isWeekend: boolean
): void {
  const { state, vehicles, crowd, ragdolls, world, events } = ctx;
  threatCtx.playerX = state.playerPos.x;
  threatCtx.playerZ = state.playerPos.z;
  threatCtx.gameTime = state.gameTime;
  threatCtx.isWeekend = isWeekend;
  threatCtx.isNight = isNight;
  threatCtx.weather = ctx.weatherEffects.current;
  threatCtx.fastVehicles.length = 0;
  threatCtx.chasingPolice.length = 0;

  let cops = 0;
  for (const v of vehicles) {
    const absSpd = Math.abs(v.speed);
    if (absSpd >= 13.5) {
      threatCtx.fastVehicles.push({
        x: v.x,
        z: v.z,
        vx: Math.sin(v.heading) * v.speed,
        vz: Math.cos(v.heading) * v.speed,
        speed: absSpd,
      });
    }
    if (v.driver === 'police' && cops < wantedStars) {
      cops++;
      threatCtx.chasingPolice.push({ x: v.x, z: v.z });
    }
  }

  crowd.update(
    dt,
    threatCtx,
    ctx.camera,
    groundHeightAt,
    world.trafficLightNsMats,
    world.trafficLightEwMats
  );

  impact.update(dt, vehicles, state.currentVehicle, state.playerPos, crowd, ragdolls, events);

  ragdolls.update(
    dt,
    world.buildings,
    groundHeightAt,
    (idx, rx, rz) => {
      const a = crowd.agents[idx];
      if (!a) return;
      a.ragdollActive = false;
      const clampedZ = Math.max(WORLD_BOUNDS.minZ + 4, Math.min(WORLD_BOUNDS.maxZ - 4, rz));
      const maxCoast = WorldRegistry.getCoastlineX(clampedZ) + 18;
      a.x = Math.max(WORLD_BOUNDS.minX + 4, Math.min(maxCoast, rx));
      a.z = clampedZ;
      a.y = groundHeightAt(a.x, a.z, a.y);
      a.injuryStatus = 'injured';
      a.injuredTimer = 0;
      a.visuallyActive = true;
      a.triggerFlee(state.playerPos.x, state.playerPos.z, 1.0);
    },
    (idx) => {
      const a = crowd.agents[idx];
      if (!a) return;
      a.ragdollActive = false;
      a.injuryStatus = 'out';
      a.visuallyActive = false;
    },
    (ragdoll) => {
      impact.handleRagdollHitsNpc(ragdoll, crowd, ragdolls);
    }
  );

  if (state.showColliders) {
    ctx.registry.updateDynamicColliders(vehicles, crowd.colliderNpcBuffer);
  }
}

function disposeMaterialAndTextures(mat: THREE.Material, disposedTex: Set<THREE.Texture>): void {
  const rec = mat as unknown as Record<string, unknown>;
  const texKeys = [
    'map',
    'normalMap',
    'roughnessMap',
    'metalnessMap',
    'emissiveMap',
    'alphaMap',
    'aoMap',
    'bumpMap',
    'envMap',
    'lightMap',
  ];
  for (const key of texKeys) {
    const val = rec[key];
    if (val instanceof THREE.Texture && !disposedTex.has(val)) {
      disposedTex.add(val);
      val.dispose();
    }
  }
  mat.dispose();
}

export function disposeSceneResources(scene: THREE.Scene): void {
  const disposedGeos = new Set<THREE.BufferGeometry>();
  const disposedMats = new Set<THREE.Material>();
  const disposedTex = new Set<THREE.Texture>();

  if (scene.environment instanceof THREE.Texture) {
    disposedTex.add(scene.environment);
    scene.environment.dispose();
    scene.environment = null;
  }

  scene.traverse((obj) => {
    if (obj instanceof THREE.InstancedMesh) {
      obj.dispose();
    }
    if (
      obj instanceof THREE.Mesh ||
      obj instanceof THREE.Line ||
      obj instanceof THREE.Points
    ) {
      if (obj.geometry && !disposedGeos.has(obj.geometry)) {
        disposedGeos.add(obj.geometry);
        obj.geometry.dispose();
      }
      const mat = obj.material;
      if (Array.isArray(mat)) {
        for (const m of mat) {
          if (m && !disposedMats.has(m)) {
            disposedMats.add(m);
            disposeMaterialAndTextures(m, disposedTex);
          }
        }
      } else if (mat && !disposedMats.has(mat)) {
        disposedMats.add(mat);
        disposeMaterialAndTextures(mat, disposedTex);
      }
    }
  });
  scene.clear();
}
