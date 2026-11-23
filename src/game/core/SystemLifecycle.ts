import * as THREE from 'three';
import { QualityPreset } from '../config';
import { ProceduralAudio } from '../audio';
import { BuildingRegistry } from '../BuildingRegistry';
import { CrowdManager } from '../CrowdManager';
import { RagdollPool } from '../RagdollPool';
import { TransitAndRescueSystem } from '../TransitAndRescueSystem';
import {
  HudRadioState,
  RadioStationId,
  RenderTelemetry,
  SavedOutfitState,
  SavedWeaponAmmo,
  VehicleEntity,
} from '../types';
import { WeatherEffects, WeatherSystem } from '../WeatherSystem';
import { WorldRefs } from '../world';
import { WeaponState } from '../WeaponDefs';
import { GameEventMap, TypedEventBus } from './EventBus';

export interface CombatRuntimeState {
  weaponState: WeaponState;
  aiming: boolean;
  reloading: boolean;
  reloadProgress: number;
  switchProgress: number;
  recoilKickTimer: number;
  meleeSwingTimer: number;
  shoulderSide: 1 | -1;
  spreadAngle: number;
  hitMarkerTimer: number;
  lastHitHeadshot: boolean;
  lastHitKill: boolean;
  gunShopOpen: boolean;
  weaponWheelOpen: boolean;
  nearGunShop: boolean;
}

export interface RadioRuntimeState extends HudRadioState {
  trackIndexByStation: Record<RadioStationId, number>;
  trackElapsedByStation: Record<RadioStationId, number>;
}

/** Pose temporária do jogador durante animação de entrar/sair do veículo */
export interface VehicleAccessAnimState {
  active: boolean;
  vehicleId: string | null;
  x: number;
  y: number;
  z: number;
  yaw: number;
  walkPhase: number;
  sitBlend: number;
  visible: boolean;
}

/**
 * Estado mutável compartilhado e serviços centrais fornecidos aos subsistemas via EngineContext.
 */
export interface SimulationState {
  playerPos: THREE.Vector3;
  playerYaw: number;
  playerVelX: number;
  playerVelY: number;
  playerVelZ: number;
  isGrounded: boolean;
  health: number;
  armor: number;
  currentVehicle: VehicleEntity | null;
  missionCar: VehicleEntity | null;
  money: number;
  gameTime: number;
  dayNumber: number;
  timeScale: number;
  timeNormalized: number;
  elapsedSec: number;
  paused: boolean;
  hitStopTimer: number;
  cameraShake: number;
  currentFps: number;
  currentDistrictId: string;
  currentDistrictName: string;
  currentStreetName: string;
  weapons: SavedWeaponAmmo[];
  activeWeaponId: string;
  outfit: SavedOutfitState;
  completedEvents: string[];
  discoveredAreas: string[];
  renderTelemetry: RenderTelemetry;
  lastSavedAtIso: string | null;
  showWaypoints: boolean;
  showColliders: boolean;
  showRoutineLabels: boolean;
  showDebugPanel: boolean;
  bannerText: string | null;
  bannerTimer: number;
  combat: CombatRuntimeState;
  radio: RadioRuntimeState;
  vehicleAccess?: VehicleAccessAnimState;
}

export interface EngineContext {
  container: HTMLElement;
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  isSoftwareGl: boolean;
  qualityPreset?: QualityPreset;
  events: TypedEventBus<GameEventMap>;
  audio: ProceduralAudio;
  world: WorldRefs;
  registry: BuildingRegistry;
  crowd: CrowdManager;
  ragdolls: RagdollPool;
  weatherSystem: WeatherSystem;
  weatherEffects: WeatherEffects;
  transit: TransitAndRescueSystem;
  vehicles: VehicleEntity[];
  state: SimulationState;
  groundHeightAt: (x: number, z: number, currentY?: number) => number;
  resolveWorldCollisions: (pos: THREE.Vector3, radius: number) => boolean;
}

/**
 * Interface comum de ciclo de vida para todos os subsistemas modulares do jogo.
 */
export interface GameSystem {
  readonly name: string;
  init(ctx: EngineContext): void;
  update(dt: number): void;
  dispose(): void;
}
