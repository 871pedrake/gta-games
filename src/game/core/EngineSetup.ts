import * as THREE from 'three';
import { ProceduralAudio } from '../audio';
import { BuildingRegistry } from '../BuildingRegistry';
import { INITIAL_GAME_TIME, QUALITY_SETTINGS, QualityPreset } from '../config';
import { CrowdManager } from '../CrowdManager';
import { ImpactSystem } from '../ImpactSystem';
import { applyTextureQuality, createContactShadowTexture } from '../models';
import { syncVehicleCabinVisuals } from '../vehicles/builders/sharedBuilderUtils';
import { RagdollPool } from '../RagdollPool';
import { ScheduleSystem } from '../ScheduleSystem';
import { CameraRig } from '../systems/CameraRig';
import { DayNightSystem } from '../systems/DayNightSystem';
import { HudBridge } from '../systems/HudBridge';
import { InputManager } from '../systems/InputManager';
import { Minimap } from '../systems/Minimap';
import { MissionSystem } from '../systems/MissionSystem';
import { PerformanceSystem } from '../systems/PerformanceSystem';
import { PlayerController } from '../systems/PlayerController';
import { PoliceSystem } from '../systems/PoliceSystem';
import { RadioSystem } from '../systems/RadioSystem';
import { TrafficSystem } from '../systems/TrafficSystem';
import { VehicleSystem } from '../systems/VehicleSystem';
import { WantedSystem } from '../systems/WantedSystem';
import { WeaponSystem } from '../systems/WeaponSystem';
import { TransitAndRescueSystem } from '../TransitAndRescueSystem';
import { GameOptions, HudSnapshot, LoadingProgress } from '../types';
import { WeatherSystem } from '../WeatherSystem';
import { buildCoastalWorld, WorldRefs } from '../world';
import { ChunkStreamingSystem } from '../world/WorldChunkSystem';
import { GameEventMap, TypedEventBus } from './EventBus';
import { EngineContext, GameSystem } from './SystemLifecycle';
import {
  createInitialSimulationState,
  createRendererSceneCamera,
  detectSoftwareWebGL,
  groundHeightAt,
  resolveWorldCollisions,
} from './WorldHelpers';

export interface EngineRuntime {
  ctx: EngineContext;
  systems: GameSystem[];
  shadowTex: THREE.CanvasTexture;
  impact: ImpactSystem;
  input: InputManager;
  cameraRig: CameraRig;
  dayNight: DayNightSystem;
  playerCtrl: PlayerController;
  vehicleSys: VehicleSystem;
  radioSys: RadioSystem;
  weaponSys: WeaponSystem;
  wantedSys: WantedSystem;
  missionSys: MissionSystem;
  minimap: Minimap;
  hudBridge: HudBridge;
  performanceSys: PerformanceSystem;
  chunkSys: ChunkStreamingSystem;
}

export function nextFrame(): Promise<void> {
  if (typeof requestAnimationFrame === 'function') {
    return new Promise((resolve) => requestAnimationFrame(() => resolve()));
  }
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function assembleRuntime(
  container: HTMLElement,
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  isSoftwareGl: boolean,
  shadowTex: THREE.CanvasTexture,
  world: WorldRefs,
  registry: BuildingRegistry,
  onHudUpdate: (snapshot: HudSnapshot) => void,
  opts: GameOptions,
  startPaused: boolean,
  getQualityPreset: () => QualityPreset
): EngineRuntime {
  const ragdolls = new RagdollPool(scene, isSoftwareGl);
  const crowd = new CrowdManager(scene, isSoftwareGl, registry, new ScheduleSystem(), INITIAL_GAME_TIME);
  world.chunkManager.populateNpcSpawnsFromGraph(crowd.graph.nodes);
  crowd.setChunkManager(world.chunkManager);
  const weatherSystem = new WeatherSystem(scene);
  const transit = new TransitAndRescueSystem(scene, shadowTex);
  const audio = new ProceduralAudio();
  const events = new TypedEventBus<GameEventMap>();
  const state = createInitialSimulationState(startPaused);

  const ctx: EngineContext = {
    container,
    renderer,
    scene,
    camera,
    isSoftwareGl,
    qualityPreset: opts.qualityPreset,
    events,
    audio,
    world,
    registry,
    crowd,
    ragdolls,
    weatherSystem,
    weatherEffects: weatherSystem.effects,
    transit,
    vehicles: [],
    state,
    groundHeightAt,
    resolveWorldCollisions: (pos, radius) => resolveWorldCollisions(pos, radius, world.buildings),
  };

  const impact = new ImpactSystem();
  const input = new InputManager(opts.keyBindings);
  const cameraRig = new CameraRig(input);
  const dayNight = new DayNightSystem();
  const playerCtrl = new PlayerController(input, cameraRig, shadowTex);
  const weaponSys = new WeaponSystem(input, cameraRig, opts.qualityPreset);
  weaponSys.setMuzzlePositionProvider((out) => playerCtrl.getMuzzleWorldPosition(out));
  const vehicleSys = new VehicleSystem(input, shadowTex);
  const radioSys = new RadioSystem(input);
  const trafficSys = new TrafficSystem(shadowTex);
  const policeSys = new PoliceSystem(shadowTex);
  const wantedSys = new WantedSystem();
  const missionSys = new MissionSystem();
  const minimap = new Minimap(() => missionSys.getSnapshot());
  const performanceSys = new PerformanceSystem();
  const chunkSys = new ChunkStreamingSystem();
  const hudBridge = new HudBridge(onHudUpdate, {
    getWantedSnapshot: () => wantedSys.getSnapshot(),
    getMissionSnapshot: () => missionSys.getSnapshot(),
    hasNearbyVehicle: () => vehicleSys.findNearestVehicle() !== null,
    getTimeLabel: () => dayNight.getTimeLabel(),
    getFormattedClock: () => dayNight.formatGameClock(),
    isWeekend: () => dayNight.isWeekendDay(),
    getQualityPreset,
    getInjuredTotalCount: () => impact.injuredTotalCount,
    isGamepadConnected: () => input.gamepadConnected,
    isPointerLocked: () => input.isPointerLocked(),
    getWeaponDebugStats: () => weaponSys.getDebugStats(),
  });

  const systems: GameSystem[] = [
    input,
    dayNight,
    weaponSys,
    playerCtrl,
    vehicleSys,
    radioSys,
    trafficSys,
    policeSys,
    wantedSys,
    missionSys,
    chunkSys,
    cameraRig,
    minimap,
    performanceSys,
    hudBridge,
  ];
  systems.forEach((s) => s.init(ctx));

  return {
    ctx,
    systems,
    shadowTex,
    impact,
    input,
    cameraRig,
    dayNight,
    playerCtrl,
    vehicleSys,
    radioSys,
    weaponSys,
    wantedSys,
    missionSys,
    minimap,
    hudBridge,
    performanceSys,
    chunkSys,
  };
}

export async function createEngineRuntimeAsync(
  container: HTMLElement,
  onHudUpdate: (snapshot: HudSnapshot) => void,
  opts: GameOptions,
  startPaused: boolean,
  getQualityPreset: () => QualityPreset,
  progress?: (p: LoadingProgress) => void
): Promise<EngineRuntime> {
  progress?.({ progress: 15, stage: 'Inicializando WebGL e atmosfera...' });
  await nextFrame();
  const isSoftwareGl = detectSoftwareWebGL();
  const { renderer, scene, camera } = createRendererSceneCamera(container, isSoftwareGl);

  progress?.({ progress: 40, stage: 'Construindo cidade litorânea...' });
  await nextFrame();
  const shadowTex = createContactShadowTexture();
  const cfg = QUALITY_SETTINGS[opts.qualityPreset];
  const initialAniso = Math.min(renderer.capabilities.getMaxAnisotropy(), cfg.anisotropy);
  const world = buildCoastalWorld(scene, initialAniso, cfg.mipmaps);
  const registry = new BuildingRegistry(world.buildings);

  progress?.({ progress: 65, stage: 'Populando multidão e tráfego...' });
  await nextFrame();
  const rt = assembleRuntime(
    container,
    renderer,
    scene,
    camera,
    isSoftwareGl,
    shadowTex,
    world,
    registry,
    onHudUpdate,
    opts,
    startPaused,
    getQualityPreset
  );

  progress?.({ progress: 84, stage: 'Conectando sistemas modulares...' });
  await nextFrame();
  return rt;
}

export function applyQualitySettingsToEngine(
  ctx: EngineContext,
  dayNight: DayNightSystem,
  performanceSys: PerformanceSystem,
  chunkSys: ChunkStreamingSystem,
  preset: QualityPreset
): void {
  const cfg = QUALITY_SETTINGS[preset];
  ctx.qualityPreset = preset;
  ctx.crowd.setQualityPreset(preset);
  performanceSys.setQualityPreset(preset);
  chunkSys.setQualityPreset(preset, true);

  ctx.camera.far = cfg.drawDistance;
  ctx.camera.updateProjectionMatrix();

  const maxAniso = ctx.renderer.capabilities.getMaxAnisotropy();
  const targetAniso = Math.min(maxAniso, cfg.anisotropy);
  for (const tex of ctx.world.managedTextures) {
    applyTextureQuality(tex, targetAniso, cfg.mipmaps);
  }

  if (!ctx.isSoftwareGl) {
    ctx.renderer.shadowMap.enabled = cfg.shadows;
    dayNight.setShadowQuality(cfg.shadows, cfg.shadowMapSize);
  } else {
    dayNight.setShadowQuality(false, cfg.shadowMapSize);
  }

  for (const v of ctx.vehicles) {
    syncVehicleCabinVisuals(v, ctx.isSoftwareGl, preset);
  }
}
