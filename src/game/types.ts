import * as THREE from 'three';
import { QualityPreset } from './config';
import { LodCounts } from './LODSystem';
import { WeaponState } from './WeaponDefs';
import { UrbanZoneId, ZoneStats } from './ZoneDensityManager';

export type VehicleClass = 'car' | 'bike' | 'heli' | 'plane';

export type VehicleType =
  | 'hatch'
  | 'sports'
  | 'sedan'
  | 'coupe'
  | 'suv'
  | 'pickup'
  | 'van'
  | 'convertible'
  | 'police'
  | 'bus'
  | 'ambulance'
  | 'sportbike'
  | 'streetbike'
  | 'helicopter'
  | 'plane';

export type VehicleDrivetrain = 'FWD' | 'RWD' | 'AWD';

export type VehiclePaintFinish = 'gloss' | 'matte' | 'metallic' | 'pearlescent';

export type VehicleDoorSide = 'left' | 'right';

export type VehicleDoorMechanism = 'hinged' | 'scissor' | 'sliding';

export type VehicleDoorEventState = 'opening' | 'open' | 'closing' | 'closed' | 'ajar';

export interface VehicleCabinVisuals {
  glassMats: THREE.MeshStandardMaterial[];
  doorWellGroups: THREE.Group[];
  interiorGroup?: THREE.Group;
  seatedDriverGroup?: THREE.Group;
}

export interface VehicleSeatConfig {
  driverX: number;
  driverY: number;
  driverZ: number;
  exitOffsetX: number;
  exitOffsetZ: number;
  visibleRider: boolean;
}

export interface VehicleHandlingSpec {
  maxSpeed: number;
  reverseSpeed: number;
  accel: number;
  brakeAccel: number;
  coastDamp: number;
  handbrakeDamp: number;
  maxSteerAngle: number;
  steerRate: number;
  turnRate: number;
  driftFactor: number;
  maxLeanAngle?: number;
  /** Distância entre eixos (m) usada no modelo bicicleta */
  wheelbase?: number;
  /** Altura do centro de gravidade (m) para transferência de carga */
  cgHeight?: number;
  /** Fração de carga estática no eixo dianteiro (0..1) */
  frontAxleRatio?: number;
  /** Tração: dianteira, traseira ou integral */
  drivetrain?: VehicleDrivetrain;
  /** Potência do motor em kW para curva de torque/marchas */
  powerKw?: number;
  /** Aderência base do pneu dianteiro */
  frontGrip?: number;
  /** Aderência base do pneu traseiro */
  rearGrip?: number;
  /** Multiplicador de rolagem visual da carroceria */
  bodyRollFactor?: number;
  /** Multiplicador de mergulho/agachamento visual da carroceria */
  bodyPitchFactor?: number;
  /** Velocidade (m/s) de redução de esterço em alta velocidade */
  steerSpeedFade?: number;
}

export interface VehicleFlightSpec {
  liftAccel: number;
  maxClimbSpeed: number;
  hoverDamp: number;
  pitchRate: number;
  rollRate: number;
  yawRate: number;
  stallSpeed: number;
  takeoffSpeed: number;
  cruiseSpeed: number;
  maxAltitude: number;
  rotorRpmMax?: number;
  propRpmMax?: number;
}

export interface VehicleFlightState {
  vy: number;
  rotorSpeed: number;
  throttle: number;
  airborne: boolean;
}

export interface VehicleDoorState {
  id: string;
  side: VehicleDoorSide;
  pivot: THREE.Group;
  /** Mecanismo mecânico da porta (convencional, tesoura ou corrediça) */
  mechanism?: VehicleDoorMechanism;
  /** Sinal de rotação no eixo Y para abrir para fora (+1 esquerda, -1 direita) */
  openSign: 1 | -1;
  /** Ângulo atual de abertura em radianos (0 = fechada, maxAngle = batente aberto) */
  angle: number;
  /** Velocidade angular da dobradiça em rad/s */
  angularVel: number;
  /** Ângulo alvo quando há atuador (ex.: fechamento ao entrar no veículo) */
  targetAngle: number | null;
  /** Limite máximo de abertura da dobradiça em radianos */
  maxAngle: number;
  /** Curso máximo em metros para portas de correr (ex.: 0,9 m na van/ambulância) */
  maxSlide?: number;
  /** Deslocamento atual em metros para portas de correr */
  slideDistance?: number;
  /** Posição Z original do pivô para portas de correr */
  restPosZ?: number;
  /** Posição X original do pivô para portas de correr */
  restPosX?: number;
  /** Indica se a fechadura está travada */
  latched: boolean;
  /** Ângulo mínimo de batente entreaberto após batida lateral forte (rad) */
  ajarAngle?: number;
  /** Temporizador de pequeno tranco visual no batente de 0° (s) */
  recoilTimer?: number;
  /** Intensidade do tranco ao fechar */
  recoilStrength?: number;
  /** Último estado emitido no barramento para evitar eventos duplicados */
  eventState?: VehicleDoorEventState;
  /** Temporizador opcional antes de puxar a porta para fechar após entrar */
  openTimer?: number;
  /** Indica se a porta foi arrancada após colisão extrema */
  detached?: boolean;
}

export type RadioStationId =
  | 'solara_fm'
  | 'baia_beats'
  | 'litoral_rock'
  | 'costa_chill'
  | 'noticias_bs'
  | 'off';

export interface HudRadioState {
  stationId: RadioStationId;
  stationName: string;
  frequency: string;
  genre: string;
  colorHex: string;
  trackTitle: string;
  trackArtist: string;
  trackIndex: number;
  trackCount: number;
  isOff: boolean;
  notificationTimer: number;
  wheelOpen: boolean;
}

export type DriverKind = 'none' | 'npc' | 'player' | 'police' | 'bus' | 'ambulance';

export interface VehicleEntity {
  id: string;
  name: string;
  type: VehicleType;
  mesh: THREE.Group;
  frontWheelPivots: THREE.Group[];
  wheels: THREE.Mesh[];
  headlights: THREE.Mesh[];
  taillights: THREE.Mesh[];
  lightBarRed?: THREE.Mesh;
  lightBarBlue?: THREE.Mesh;
  x: number;
  z: number;
  heading: number;
  speed: number;
  steerAngle: number;
  halfWidth: number;
  halfLength: number;
  maxSpeed: number;
  accel: number;
  driver: DriverKind;
  npcAxis?: 'x' | 'z';
  npcDir?: 1 | -1;
  npcTargetSpeed?: number;
  isMissionTarget?: boolean;
  stuckTimer?: number;
  health?: number;
  maxHealth?: number;
  damageRatio?: number;
  paintHex?: number;
  finish?: VehiclePaintFinish;
  lateralSpeed?: number;
  busPassengerCount?: number;
  /** Classe física do veículo (car, bike, heli, plane) */
  class?: VehicleClass;
  /** Altitude/posição vertical em metros */
  y?: number;
  /** Arfagem (rad) */
  pitch?: number;
  /** Inclinação lateral / rolagem (rad) */
  roll?: number;
  /** Velocidade longitudinal local no modelo bicicleta (m/s) */
  vx?: number;
  /** Velocidade lateral local no modelo bicicleta (m/s) */
  vy?: number;
  /** Taxa de guinada no modelo bicicleta (rad/s) */
  yawRate?: number;
  /** Aceleração longitudinal recente (m/s²) */
  longAccel?: number;
  /** Aceleração lateral recente (m/s²) */
  latAccel?: number;
  /** Marcha atual do câmbio (1..5) */
  gear?: number;
  /** Rotação normalizada do motor (0..1) */
  rpmNormalized?: number;
  /** Estado da suspensão visual da carroceria (pitch, roll e quique vertical) */
  bodyPitchOffset?: number;
  bodyPitchVel?: number;
  bodyRollOffset?: number;
  bodyRollVel?: number;
  bodyBounceY?: number;
  bodyBounceVelY?: number;
  verticalVel?: number;
  /** Grupo da carroceria suspensa para mergulho/rolagem/quique independentes das rodas */
  sprungGroup?: THREE.Group;
  /** Tampa traseira articulada opcional (picape) */
  tailgatePivot?: THREE.Group;
  /** Material principal de pintura para preservar paintHex/finish */
  paintMaterial?: THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial;
  /** Configuração do assento do piloto/motorista */
  seat?: VehicleSeatConfig;
  /** Parâmetros de dirigibilidade copiados da tabela VehicleSpecs */
  handling?: VehicleHandlingSpec;
  /** Estado de voo para helicópteros e aviões */
  flight?: VehicleFlightState;
  /** Acumulador de tempo para passo fixo de 1/120 s */
  physicsAccum?: number;
  /** Rotores / hélices animadas (heli/plane) */
  rotors?: THREE.Object3D[];
  /** Portas articuladas com simulação de dobradiça */
  doors?: VehicleDoorState[];
  /** Referências visuais para vidro semitransparente, vão escuro e motorista sentado */
  cabinVisuals?: VehicleCabinVisuals;
  /** Velocidade anterior usada no cálculo de aceleração inercial das portas */
  prevSpeed?: number;
  /** Direção anterior usada no cálculo de força centrífuga nas curvas */
  prevHeading?: number;
}

export type WeatherType = 'clear' | 'rain' | 'fog' | 'heat';

export interface BuildingCollider {
  x: number;
  z: number;
  halfW: number;
  halfD: number;
  height: number;
  colorHex: string;
  label?: string;
  baseY?: number;
}

export interface CashPickup {
  id: string;
  x: number;
  z: number;
  value: number;
  mesh: THREE.Group;
  collected: boolean;
  respawnTimer: number;
}

export type MissionId = 'none' | 'mission1' | 'mission2';

export interface MissionStatus {
  id: MissionId;
  step: number;
  title: string;
  objective: string;
  targetPos: { x: number; z: number } | null;
  completedMissions: string[];
}

export interface NpcDebugScreenLabel {
  id: number;
  screenX: number;
  screenY: number;
  text: string;
  subtext: string;
  hpRatio: number;
}

export type GameAction =
  | 'moveForward'
  | 'moveBackward'
  | 'moveLeft'
  | 'moveRight'
  | 'sprint'
  | 'jump'
  | 'interact'
  | 'toggleDoors'
  | 'horn'
  | 'radioNext'
  | 'radioPrev'
  | 'aim'
  | 'fire'
  | 'reload'
  | 'weaponWheel'
  | 'melee'
  | 'map'
  | 'weaponSlot1'
  | 'weaponSlot2'
  | 'weaponSlot3'
  | 'weaponSlot4'
  | 'weaponSlot5'
  | 'camLeft'
  | 'camRight'
  | 'cycleWeather'
  | 'cycleTimeScale'
  | 'toggleDebug'
  | 'toggleWaypoints'
  | 'toggleColliders'
  | 'toggleRoutineLabels'
  | 'spawnTestGroup'
  | 'pause';

export type KeyBindings = Record<GameAction, string>;

export type TouchMode = 'auto' | 'on' | 'off';

export type AimMode = 'hold' | 'toggle';

export interface GameOptions {
  qualityPreset: QualityPreset;
  volume: number; // 0..1
  muted: boolean;
  cameraSensitivity: number; // 0.4..2.2
  aimMode: AimMode;
  aimSensitivityMul: number; // 0.2..1.2
  invertY: boolean;
  touchMode: TouchMode;
  keyBindings: KeyBindings;
}

export interface SavedVehicleState {
  id: string;
  x: number;
  z: number;
  heading: number;
  health: number;
  damageRatio: number;
  paintHex?: number;
  finish?: 'gloss' | 'matte' | 'metallic' | 'pearlescent';
}

export interface SavedWeaponAmmo {
  id: string;
  clip: number;
  reserve: number;
}

export interface SavedOutfitState {
  head: string;
  torso: string;
  legs: string;
  shoes: string;
  accessory: string;
  hairStyle: string;
  skinTone: string;
}

export interface SaveGameData {
  version: number;
  savedAtIso: string;
  money: number;
  health: number;
  armor: number;
  playerX: number;
  playerZ: number;
  playerYaw: number;
  currentVehicleId: string | null;
  gameTime: number;
  dayNumber: number;
  weather: WeatherType;
  completedMissions: string[];
  weapons: SavedWeaponAmmo[];
  activeWeaponId: string;
  outfit: SavedOutfitState;
  vehicles: SavedVehicleState[];
  completedEvents: string[];
  discoveredAreas: string[];
}

export interface RenderTelemetry {
  calls: number;
  triangles: number;
  geometries: number;
  textures: number;
  programs: number;
  pixelRatio: number;
  dynamicScalePct: number;
  drawDistance: number;
  chunksTotal: number;
  chunksFull: number;
  chunksImpostor: number;
  chunksUnloaded: number;
}

export interface LoadingProgress {
  progress: number; // 0..100
  stage: string;
}

export type AppScreenState = 'loading' | 'menu' | 'playing' | 'paused';

export interface HudWeaponState {
  activeWeaponId: string;
  weaponName: string;
  slot: number;
  isFirearm: boolean;
  weaponState: WeaponState;
  clip: number;
  clipSize: number;
  reserve: number;
  reloading: boolean;
  reloadProgress: number;
  aiming: boolean;
  shoulderSide: 1 | -1;
  crosshairSpreadPx: number;
  hitMarkerAge: number;
  lastHitHeadshot: boolean;
  lastHitKill: boolean;
  ownedWeapons: SavedWeaponAmmo[];
}

export interface WeaponDebugStats {
  activeProjectiles: number;
  activeParticles: number;
  activeDecals: number;
  activeTracers: number;
  activeCasings: number;
}

export interface HudSnapshot {
  money: number;
  health: number;
  armor: number;
  wantedStars: number;
  evadingProgress: number; // 0..1 when out of sight
  bustProgress: number; // 0..1 when police pinned player
  inVehicle: boolean;
  vehicleName: string;
  vehicleHealthPct: number;
  speedKmh: number;
  nearVehiclePrompt: boolean;
  nearGunShopPrompt: boolean;
  gunShopOpen: boolean;
  weaponWheelOpen: boolean;
  radio: HudRadioState;
  isPointerLocked: boolean;
  activeWeaponId: string;
  weaponName: string;
  ammoClip: number;
  ammoReserve: number;
  isAiming: boolean;
  isReloading: boolean;
  reloadProgress: number;
  weapon: HudWeaponState;
  weaponDebug: WeaponDebugStats;
  timeOfDayLabel: string;
  gameTimeFormatted: string; // HH:MM
  isWeekend: boolean;
  dayNumber: number;
  timeScale: number; // 1, 10, 60
  timeNormalized: number; // 0..1
  weather: WeatherType;
  weatherLabel: string;
  weatherGripPct: number;
  currentDistrictName: string;
  currentStreetName: string;
  mission: MissionStatus;
  bannerText: string | null;
  bustedFlash: boolean;
  muted: boolean;
  fps: number;
  activeNpcs: number;
  backgroundNpcs: number;
  insideBuildingsNpcs: number;
  nearbyNpcs: number;
  lodCounts: LodCounts;
  maxNpcs: number;
  ragdollsInUse: number;
  ragdollsPoolSize: number;
  injuredCount: number;
  activeInjuredCount: number;
  maxInjuredCap: number;
  zoneStats: ZoneStats[];
  zoneAlerts: UrbanZoneId[];
  qualityPreset: QualityPreset;
  renderTelemetry: RenderTelemetry;
  showDebugPanel: boolean;
  busPassengersTotal: number;
  activeBuses: number;
  ambulanceStatus: string;
  trafficSignalPhase: string;
  showWaypoints: boolean;
  showColliders: boolean;
  showRoutineLabels: boolean;
  paused: boolean;
  gamepadConnected: boolean;
  lastSavedAtIso: string | null;
}
