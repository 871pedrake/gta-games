import {
  CAM_DEFAULT_AIM_SENSITIVITY_MUL,
  CAM_DEFAULT_SENSITIVITY,
  LEGACY_SAVE_STORAGE_KEY,
  PLAYER_MAX_ARMOR,
  PLAYER_MAX_HEALTH,
  SAVE_SCHEMA_VERSION,
  SAVE_STORAGE_KEY,
  SETTINGS_STORAGE_KEY,
} from '../config';
import {
  GameOptions,
  KeyBindings,
  SavedOutfitState,
  SavedVehicleState,
  SavedWeaponAmmo,
  SaveGameData,
  WeatherType,
} from '../types';
import { isWeaponId, WEAPON_DEFS } from '../WeaponDefs';

export const DEFAULT_KEY_BINDINGS: KeyBindings = {
  moveForward: 'KeyW',
  moveBackward: 'KeyS',
  moveLeft: 'KeyA',
  moveRight: 'KeyD',
  sprint: 'ShiftLeft',
  jump: 'Space',
  interact: 'KeyF',
  toggleDoors: 'KeyJ',
  horn: 'KeyB',
  radioNext: 'KeyX',
  radioPrev: 'KeyZ',
  aim: 'MouseRight',
  fire: 'MouseLeft',
  reload: 'KeyR',
  weaponWheel: 'Tab',
  melee: 'KeyV',
  map: 'KeyM',
  weaponSlot1: 'Digit1',
  weaponSlot2: 'Digit2',
  weaponSlot3: 'Digit3',
  weaponSlot4: 'Digit4',
  weaponSlot5: 'Digit5',
  camLeft: 'KeyQ',
  camRight: 'KeyE',
  cycleWeather: 'KeyC',
  cycleTimeScale: 'KeyT',
  toggleDebug: 'F3',
  toggleWaypoints: 'KeyG',
  toggleColliders: 'KeyP',
  toggleRoutineLabels: 'KeyH',
  spawnTestGroup: 'KeyK',
  pause: 'Escape',
};

export const DEFAULT_OUTFIT_STATE: SavedOutfitState = {
  head: 'head_none',
  torso: 'torso_jacket_neon',
  legs: 'legs_jeans_dark',
  shoes: 'shoes_sneakers_white',
  accessory: 'acc_shades_vice',
  hairStyle: 'hair_fade',
  skinTone: 'skin_tan',
};

export const DEFAULT_WEAPONS_STATE: SavedWeaponAmmo[] = [
  { id: 'fists', clip: 0, reserve: 0 },
];

export const DEFAULT_GAME_OPTIONS: GameOptions = {
  qualityPreset: 'medium',
  volume: 1.0,
  muted: false,
  cameraSensitivity: CAM_DEFAULT_SENSITIVITY,
  aimMode: 'hold',
  aimSensitivityMul: CAM_DEFAULT_AIM_SENSITIVITY_MUL,
  invertY: false,
  touchMode: 'auto',
  keyBindings: { ...DEFAULT_KEY_BINDINGS },
};

function getStorage(): Storage | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage;
    }
  } catch {
    return null;
  }
  return null;
}

function sanitizeWeather(value: unknown): WeatherType {
  if (value === 'clear' || value === 'rain' || value === 'fog' || value === 'heat') {
    return value;
  }
  return 'clear';
}

function sanitizeVehicles(raw: unknown): SavedVehicleState[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((v): v is Record<string, unknown> => Boolean(v && typeof v === 'object'))
    .map((v) => ({
      id: typeof v.id === 'string' ? v.id : 'unknown',
      x: typeof v.x === 'number' ? v.x : 0,
      z: typeof v.z === 'number' ? v.z : 0,
      heading: typeof v.heading === 'number' ? v.heading : 0,
      health: typeof v.health === 'number' ? v.health : 100,
      damageRatio: typeof v.damageRatio === 'number' ? v.damageRatio : 0,
      paintHex: typeof v.paintHex === 'number' ? v.paintHex : undefined,
      finish:
        v.finish === 'gloss' || v.finish === 'matte' || v.finish === 'metallic' || v.finish === 'pearlescent'
          ? v.finish
          : undefined,
    }));
}

function sanitizeWeapons(raw: unknown): SavedWeaponAmmo[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    return DEFAULT_WEAPONS_STATE.map((w) => ({ ...w }));
  }
  const seen = new Set<string>();
  const filtered: SavedWeaponAmmo[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const w = item as Record<string, unknown>;
    if (typeof w.id !== 'string' || !isWeaponId(w.id) || seen.has(w.id)) continue;
    seen.add(w.id);
    const def = WEAPON_DEFS[w.id];
    const clip =
      typeof w.clip === 'number' && Number.isFinite(w.clip)
        ? Math.max(0, Math.min(def.clipSize, Math.floor(w.clip)))
        : 0;
    const reserve =
      typeof w.reserve === 'number' && Number.isFinite(w.reserve)
        ? Math.max(0, Math.min(def.maxReserve, Math.floor(w.reserve)))
        : 0;
    filtered.push({ id: w.id, clip, reserve });
  }
  if (!seen.has('fists')) {
    filtered.unshift({ id: 'fists', clip: 0, reserve: 0 });
  }
  return filtered.length > 0 ? filtered : DEFAULT_WEAPONS_STATE.map((w) => ({ ...w }));
}

function sanitizeOutfit(raw: unknown): SavedOutfitState {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_OUTFIT_STATE };
  }
  const o = raw as Partial<SavedOutfitState>;
  return {
    head: typeof o.head === 'string' ? o.head : DEFAULT_OUTFIT_STATE.head,
    torso: typeof o.torso === 'string' ? o.torso : DEFAULT_OUTFIT_STATE.torso,
    legs: typeof o.legs === 'string' ? o.legs : DEFAULT_OUTFIT_STATE.legs,
    shoes: typeof o.shoes === 'string' ? o.shoes : DEFAULT_OUTFIT_STATE.shoes,
    accessory: typeof o.accessory === 'string' ? o.accessory : DEFAULT_OUTFIT_STATE.accessory,
    hairStyle: typeof o.hairStyle === 'string' ? o.hairStyle : DEFAULT_OUTFIT_STATE.hairStyle,
    skinTone: typeof o.skinTone === 'string' ? o.skinTone : DEFAULT_OUTFIT_STATE.skinTone,
  };
}

export class SaveSystem {
  public static loadOptions(): GameOptions {
    const storage = getStorage();
    if (!storage) {
      return {
        ...DEFAULT_GAME_OPTIONS,
        keyBindings: { ...DEFAULT_KEY_BINDINGS },
      };
    }

    try {
      const raw = storage.getItem(SETTINGS_STORAGE_KEY);
      if (!raw) {
        return {
          ...DEFAULT_GAME_OPTIONS,
          keyBindings: { ...DEFAULT_KEY_BINDINGS },
        };
      }
      const parsed = JSON.parse(raw) as Partial<GameOptions>;
      return {
        qualityPreset:
          parsed.qualityPreset === 'low' || parsed.qualityPreset === 'medium' || parsed.qualityPreset === 'high'
            ? parsed.qualityPreset
            : DEFAULT_GAME_OPTIONS.qualityPreset,
        volume:
          typeof parsed.volume === 'number' && Number.isFinite(parsed.volume)
            ? Math.max(0, Math.min(1, parsed.volume))
            : DEFAULT_GAME_OPTIONS.volume,
        muted: typeof parsed.muted === 'boolean' ? parsed.muted : DEFAULT_GAME_OPTIONS.muted,
        cameraSensitivity:
          typeof parsed.cameraSensitivity === 'number' && Number.isFinite(parsed.cameraSensitivity)
            ? Math.max(0.4, Math.min(2.2, parsed.cameraSensitivity))
            : DEFAULT_GAME_OPTIONS.cameraSensitivity,
        aimMode:
          parsed.aimMode === 'hold' || parsed.aimMode === 'toggle'
            ? parsed.aimMode
            : DEFAULT_GAME_OPTIONS.aimMode,
        aimSensitivityMul:
          typeof parsed.aimSensitivityMul === 'number' && Number.isFinite(parsed.aimSensitivityMul)
            ? Math.max(0.2, Math.min(1.2, parsed.aimSensitivityMul))
            : DEFAULT_GAME_OPTIONS.aimSensitivityMul,
        invertY: typeof parsed.invertY === 'boolean' ? parsed.invertY : DEFAULT_GAME_OPTIONS.invertY,
        touchMode:
          parsed.touchMode === 'auto' || parsed.touchMode === 'on' || parsed.touchMode === 'off'
            ? parsed.touchMode
            : DEFAULT_GAME_OPTIONS.touchMode,
        keyBindings: {
          ...DEFAULT_KEY_BINDINGS,
          ...(parsed.keyBindings ?? {}),
        },
      };
    } catch {
      return {
        ...DEFAULT_GAME_OPTIONS,
        keyBindings: { ...DEFAULT_KEY_BINDINGS },
      };
    }
  }

  public static saveOptions(options: GameOptions): boolean {
    const storage = getStorage();
    if (!storage) return false;
    try {
      storage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(options));
      return true;
    } catch {
      return false;
    }
  }

  public static hasSave(): boolean {
    return SaveSystem.loadGame() !== null;
  }

  /**
   * Converte um payload de save v1 (ou parcial) para o formato completo v2.
   */
  public static migrateV1ToV2(raw: unknown): SaveGameData | null {
    if (!raw || typeof raw !== 'object') return null;
    const parsed = raw as Partial<SaveGameData>;
    if (
      typeof parsed.money !== 'number' ||
      typeof parsed.playerX !== 'number' ||
      typeof parsed.playerZ !== 'number' ||
      typeof parsed.gameTime !== 'number' ||
      typeof parsed.dayNumber !== 'number'
    ) {
      return null;
    }
    if (parsed.version !== undefined && parsed.version !== 1 && parsed.version !== SAVE_SCHEMA_VERSION) {
      return null;
    }

    const weapons = sanitizeWeapons(parsed.weapons);
    const activeWeaponId =
      typeof parsed.activeWeaponId === 'string' &&
      isWeaponId(parsed.activeWeaponId) &&
      weapons.some((w) => w.id === parsed.activeWeaponId)
        ? parsed.activeWeaponId
        : 'fists';

    return {
      version: SAVE_SCHEMA_VERSION,
      savedAtIso: typeof parsed.savedAtIso === 'string' ? parsed.savedAtIso : new Date().toISOString(),
      money: Math.max(0, Math.round(parsed.money)),
      health:
        typeof parsed.health === 'number' && Number.isFinite(parsed.health)
          ? Math.max(1, Math.min(PLAYER_MAX_HEALTH, parsed.health))
          : PLAYER_MAX_HEALTH,
      armor:
        typeof parsed.armor === 'number' && Number.isFinite(parsed.armor)
          ? Math.max(0, Math.min(PLAYER_MAX_ARMOR, parsed.armor))
          : 0,
      playerX: parsed.playerX,
      playerZ: parsed.playerZ,
      playerYaw: typeof parsed.playerYaw === 'number' ? parsed.playerYaw : 0,
      currentVehicleId: typeof parsed.currentVehicleId === 'string' ? parsed.currentVehicleId : null,
      gameTime: ((parsed.gameTime % 24) + 24) % 24,
      dayNumber: Math.max(1, Math.floor(parsed.dayNumber)),
      weather: sanitizeWeather(parsed.weather),
      completedMissions: Array.isArray(parsed.completedMissions)
        ? parsed.completedMissions.filter((m): m is string => typeof m === 'string')
        : [],
      weapons,
      activeWeaponId,
      outfit: sanitizeOutfit(parsed.outfit),
      vehicles: sanitizeVehicles(parsed.vehicles),
      completedEvents: Array.isArray(parsed.completedEvents)
        ? parsed.completedEvents.filter((e): e is string => typeof e === 'string')
        : [],
      discoveredAreas: Array.isArray(parsed.discoveredAreas)
        ? parsed.discoveredAreas.filter((a): a is string => typeof a === 'string')
        : [],
    };
  }

  public static loadGame(): SaveGameData | null {
    const storage = getStorage();
    if (!storage) return null;
    try {
      const rawV2 = storage.getItem(SAVE_STORAGE_KEY);
      if (rawV2) {
        const parsed = JSON.parse(rawV2) as Partial<SaveGameData>;
        if (parsed.version === SAVE_SCHEMA_VERSION) {
          return SaveSystem.migrateV1ToV2(parsed);
        }
        if (parsed.version === 1) {
          const migrated = SaveSystem.migrateV1ToV2(parsed);
          if (migrated) storage.setItem(SAVE_STORAGE_KEY, JSON.stringify(migrated));
          return migrated;
        }
      }

      // Migração automática do armazenamento legado v1 -> v2
      const rawV1 = storage.getItem(LEGACY_SAVE_STORAGE_KEY);
      if (!rawV1) return null;
      const parsedV1 = JSON.parse(rawV1) as Partial<SaveGameData>;
      const migrated = SaveSystem.migrateV1ToV2(parsedV1);
      if (migrated) {
        storage.setItem(SAVE_STORAGE_KEY, JSON.stringify(migrated));
      }
      return migrated;
    } catch {
      return null;
    }
  }

  public static saveGame(data: Omit<SaveGameData, 'version' | 'savedAtIso'>): SaveGameData | null {
    const storage = getStorage();
    const payload: SaveGameData = {
      ...data,
      version: SAVE_SCHEMA_VERSION,
      savedAtIso: new Date().toISOString(),
    };
    if (!storage) return null;
    try {
      storage.setItem(SAVE_STORAGE_KEY, JSON.stringify(payload));
      return payload;
    } catch {
      return null;
    }
  }

  public static clearSave(): void {
    const storage = getStorage();
    if (!storage) return;
    try {
      storage.removeItem(SAVE_STORAGE_KEY);
      storage.removeItem(LEGACY_SAVE_STORAGE_KEY);
    } catch {
      // Ignore storage quota / security errors
    }
  }
}
