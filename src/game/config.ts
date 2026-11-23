/**
 * Constantes centrais de ajuste da simulação, multidão, LOD, jogador, veículos,
 * procurado, missões, câmera, desempenho, persistência e iluminação.
 */

export type QualityPreset = 'low' | 'medium' | 'high';

export interface QualityProfileConfig {
  label: string;
  maxVisibleNpcs: number;
  minPixelRatio: number;
  maxPixelRatio: number;
  shadows: boolean;
  shadowMapSize: number;
  anisotropy: number;
  mipmaps: boolean;
  postProcessing: 'off' | 'subtle' | 'full';
  drawDistance: number;
  propDensity: number;
  maxDecals: number;
  maxParticles: number;
}

// ==================== MULTIDÃO E ESPAÇAMENTO ====================
export const MAX_NPC_POOL = 600;              // Pool total (visíveis + baixa fidelidade fora da câmera)
export const MAX_NPC_VISIBLE = 200;           // Meta padrão na tela (150–250)
export const SIDEWALK_SPACING = 6.0;          // Máximo de 1 NPC a cada 6 m de calçada
export const CELL_MAX_BUDGET = 1;             // Orçamento por célula de 6m × 6m na calçada
export const SPAWN_MIN_DIST = 80.0;           // Só spawna/recicla atrás da câmera ou além de 80 m
export const DESPAWN_OUT_FRUSTUM_DIST = 68.0; // Despawn imediato fora do frustum além desta distância
export const SIM_MAX_RADIUS = 150.0;          // Alcance máximo de presença antes do pool remoto

// ==================== PROPORÇÃO E FERIDOS ====================
export const NPC_AVG_HEIGHT = 1.75;           // Altura média realista (1,75 m)
export const NPC_HEIGHT_VARIATION = 0.08;     // ±8% de variação (1,61 m .. 1,89 m)
export const MAX_SIMULATED_INJURED = 30;      // Máximo de feridos simultâneos no mapa

// ==================== LOD EM 3 NÍVEIS ====================
export const LOD_FULL_DIST = 25.0;            // Até 25 m: animação completa de membros e rosto/cabeça
export const LOD_MID_DIST = 70.0;             // Até 70 m: pose simples (braços e pernas)
export const LOD_LOW_DIST = 150.0;            // Até 150 m: silhueta parada
export const BUILDING_LOD_MID_DIST = 95.0;    // Prédios: simplifica adornos além de 95 m
export const BUILDING_LOD_LOW_DIST = 175.0;   // Prédios: silhueta leve além de 175 m
export const VEHICLE_LOD_MID_DIST = 48.0;     // Veículos: remove detalhes internos/aros além de 48 m
export const VEHICLE_LOD_LOW_DIST = 115.0;    // Veículos: caixa simplificada além de 115 m

// ==================== STREAMING POR CHUNKS ====================
export const WORLD_CHUNK_SIZE = 64;              // Grade espacial de chunks (64×64 m)
export const CHUNK_FULL_DISTANCE_RATIO = 0.56;   // Fração do drawDistance com detalhe completo
export const CHUNK_HYSTERESIS = 16.0;            // Histerese (m) ao descarregar/rebaixar chunks
export const CHUNK_UNLOAD_DISPOSE_MARGIN = 96.0; // Margem extra para liberar geometrias de chunks distantes
export const CHUNK_MAX_BUILDS_PER_FRAME = 3;     // Orçamento máximo de montagem completa por frame

// ==================== ORÇAMENTO DE DESEMPENHO E RESOLUÇÃO DINÂMICA ====================
export const TARGET_FPS_LOW_THRESHOLD = 50;
export const TARGET_FPS_RECOVER_THRESHOLD = 56;
export const DYNAMIC_RES_DOWN_COOLDOWN = 0.8;
export const DYNAMIC_RES_UP_COOLDOWN = 2.0;
export const DYNAMIC_RES_STEP = 0.15;
export const BUDGET_MAX_DRAW_CALLS = 400;
export const BUDGET_MAX_TRIANGLES = 1_500_000;

// ==================== JOGADOR A PÉ ====================
export const PLAYER_WALK_SPEED = 6.4;
export const PLAYER_AIM_SPEED_MUL = 0.55;
export const PLAYER_SPRINT_SPEED = 11.4;
export const PLAYER_JUMP_VELOCITY = 8.4;
export const PLAYER_GRAVITY = 21.0;
export const PLAYER_RADIUS = 0.55;
export const PLAYER_MAX_HEALTH = 100;
export const PLAYER_MAX_ARMOR = 100;
export const PLAYER_SPAWN_X = -42;
export const PLAYER_SPAWN_Z = -16;
export const PLAYER_SPAWN_YAW = Math.PI * 0.25;

// ==================== VEÍCULOS, VIAS E TRÂNSITO ====================
export const AVENUE_WIDTH = 20.0;             // Avenidas principais: 4 faixas + canteiro central
export const AVENUE_MEDIAN_WIDTH = 2.4;       // Canteiro central arborizado/iluminado
export const SECONDARY_STREET_WIDTH = 12.0;   // Ruas secundárias: 2 faixas
export const COASTAL_AVENUE_WIDTH = 13.5;     // Avenida costeira panorâmica na orla
export const ALLEY_WIDTH = 5.6;               // Vielas e travessas estreitas
export const ROUNDABOUT_LANE_WIDTH = 11.5;    // Anel viário das rotatórias
export const VEHICLE_ENTER_RADIUS = 4.4;
export const VEHICLE_COLLISION_MIN_DIST = 3.1;
export const VEHICLE_COLLISION_RADIUS = 1.65;
export const VEHICLE_HANDBRAKE_DAMP = 6.5;
export const VEHICLE_COAST_DAMP = 1.8;
export const VEHICLE_SPEED_TO_KMH = 4.2;
export const VEHICLE_WHEEL_RADIUS = 0.36;
export const HORN_PANIC_RADIUS = 26.0;

// ==================== CÂMERA EM TERCEIRA PESSOA ====================
export const CAM_DEFAULT_FOV = 60;
export const CAM_VEHICLE_FOV_BOOST = 11;
export const CAM_PLAYER_DIST = 6.2;
export const CAM_VEHICLE_BASE_DIST = 9.2;
export const CAM_MIN_PITCH = -0.35;
export const CAM_MAX_PITCH = 0.95;
export const CAM_DEFAULT_PITCH = 0.24;
export const CAM_ROTATE_SPEED = 1.9;
export const CAM_DEFAULT_SENSITIVITY = 1.0;
export const CAM_DEFAULT_AIM_SENSITIVITY_MUL = 0.6;
export const CAM_TPS_SHOULDER_X = 0.7;
export const CAM_TPS_HIP_DIST = 4.5;
export const CAM_TPS_HIP_HEIGHT = 1.7;
export const CAM_TPS_AIM_FOV = 48;
export const CAM_TPS_RIFLE_AIM_FOV = 40;
export const CAM_TPS_AIM_DIST = 2.6;
export const CAM_TPS_AIM_SHOULDER_X = 0.7;
export const CAM_TPS_AIM_HEIGHT = 1.62;
export const CAM_TPS_TRANSITION_LAMBDA = 22;
export const CAM_TPS_AIM_FOLLOW_STIFFNESS = 60;
export const CAM_TPS_AIM_RAY_DIST = 150.0;
export const CAM_TPS_LOOKAHEAD = 18.0;

// ==================== ARMAS E BALÍSTICA ====================
export const WEAPON_TRACER_POOL_SIZE = 48;
export const WEAPON_CASING_POOL_SIZE = 40;
export const WEAPON_PROJECTILE_POOL_SIZE = 128;
export const BALLISTICS_FIXED_STEP = 1 / 120;
export const BALLISTICS_MAX_STEPS_PER_FRAME = 8;
export const BALLISTICS_GRAVITY = 9.81;
export const BALLISTICS_RICOCHET_MAX_ANGLE_RAD = (12 * Math.PI) / 180;
export const BALLISTICS_RICOCHET_ENERGY_RETENTION = 0.4; // perde 60% da energia
export const GUN_SHOP_INTERACT_RADIUS = 5.5;

// ==================== SISTEMA DE PROCURADO ====================
export const MAX_WANTED_STARS = 3;
export const WANTED_EVADE_DIST = 46.0;
export const WANTED_EVADE_DURATION = 9.0;
export const WANTED_EVADE_BONUS = 200;
export const WANTED_BUST_DIST = 5.6;
export const WANTED_BUST_PLAYER_MAX_SPEED = 4.8;
export const WANTED_BUST_DURATION = 2.6;
export const WANTED_BUST_MAX_FINE = 150;
export const WANTED_BUST_FLASH_DURATION = 2.6;

// ==================== MISSÕES E ECONOMIA ====================
export const STARTING_MONEY = 500;
export const MISSION_1_REWARD = 1500;
export const MISSION_2_REWARD = 2500;
export const MISSION_TRIGGER_RADIUS = 2.5;
export const MISSION_1_DROPOFF_RADIUS = 5.5;
export const MISSION_2_BRIEFCASE_RADIUS = 3.0;
export const MISSION_2_DROPOFF_RADIUS = 4.5;
export const CASH_PICKUP_RADIUS = 2.2;
export const CASH_PICKUP_RESPAWN_SEC = 35.0;

// ==================== TEMPO, LOOP, HUD E SAVE ====================
export const DAY_DURATION_SECONDS = 1200;     // 1 dia de jogo = 20 min reais em 1x
export const INITIAL_GAME_TIME = 17.5;        // Começa às 17:30 (pôr do sol neon)
export const HUD_EMIT_INTERVAL_SEC = 0.08;
export const MINIMAP_SCALE = 0.62;
export const MAX_FRAME_DT = 0.05;
export const AUTOSAVE_INTERVAL_SEC = 60.0;
export const SAVE_SCHEMA_VERSION = 2;
export const SAVE_STORAGE_KEY = 'baia_solara_save_v2';
export const LEGACY_SAVE_STORAGE_KEY = 'baia_solara_save_v1';
export const SETTINGS_STORAGE_KEY = 'baia_solara_settings_v1';

// ==================== ILUMINAÇÃO E QUALIDADE ====================
export const SUN_INTENSITY = 2.0;

export const QUALITY_SETTINGS: Record<QualityPreset, QualityProfileConfig> = {
  low: {
    label: 'Baixo',
    maxVisibleNpcs: 150,
    minPixelRatio: 0.7,
    maxPixelRatio: 1.0,
    shadows: false,
    shadowMapSize: 512,
    anisotropy: 1,
    mipmaps: false,
    postProcessing: 'off',
    drawDistance: 280,
    propDensity: 0.55,
    maxDecals: 16,
    maxParticles: 60,
  },
  medium: {
    label: 'Médio',
    maxVisibleNpcs: 200,
    minPixelRatio: 0.85,
    maxPixelRatio: 1.5,
    shadows: true,
    shadowMapSize: 1024,
    anisotropy: 4,
    mipmaps: true,
    postProcessing: 'subtle',
    drawDistance: 420,
    propDensity: 0.85,
    maxDecals: 32,
    maxParticles: 140,
  },
  high: {
    label: 'Alto',
    maxVisibleNpcs: 250,
    minPixelRatio: 1.0,
    maxPixelRatio: 2.0,
    shadows: true,
    shadowMapSize: 2048,
    anisotropy: 8,
    mipmaps: true,
    postProcessing: 'full',
    drawDistance: 550,
    propDensity: 1.0,
    maxDecals: 64,
    maxParticles: 260,
  },
};
