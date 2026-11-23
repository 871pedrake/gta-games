import {
  INITIAL_GAME_TIME,
  PLAYER_MAX_HEALTH,
  PLAYER_SPAWN_X,
  PLAYER_SPAWN_YAW,
  PLAYER_SPAWN_Z,
  STARTING_MONEY,
} from '../config';
import { GameOptions, SaveGameData } from '../types';
import { WorldRegistry } from '../world/WorldRegistry';
import {
  DEFAULT_GAME_OPTIONS,
  DEFAULT_KEY_BINDINGS,
  DEFAULT_OUTFIT_STATE,
  DEFAULT_WEAPONS_STATE,
  SaveSystem,
} from './SaveSystem';
import { EngineContext } from './SystemLifecycle';
import { createInitialRadioState, groundHeightAt } from './WorldHelpers';
import { applyVehiclePaintAndFinish } from '../vehicles/builders/sharedBuilderUtils';

export { DEFAULT_GAME_OPTIONS, DEFAULT_KEY_BINDINGS, SaveSystem };

export function captureSaveFromContext(
  ctx: EngineContext,
  completedMissions: string[]
): SaveGameData | null {
  const { state, vehicles, weatherSystem } = ctx;
  const saved = SaveSystem.saveGame({
    money: state.money,
    health: state.health,
    armor: state.armor,
    playerX: state.playerPos.x,
    playerZ: state.playerPos.z,
    playerYaw: state.playerYaw,
    currentVehicleId: state.currentVehicle?.id ?? null,
    gameTime: state.gameTime,
    dayNumber: state.dayNumber,
    weather: weatherSystem.getWeather(),
    completedMissions: [...completedMissions],
    weapons: state.weapons.map((w) => ({ ...w })),
    activeWeaponId: state.activeWeaponId,
    outfit: { ...state.outfit },
    vehicles: vehicles.map((v) => ({
      id: v.id,
      x: v.x,
      z: v.z,
      heading: v.heading,
      health: v.health ?? 100,
      damageRatio: v.damageRatio ?? 0,
      paintHex: v.paintHex,
      finish: v.finish,
    })),
    completedEvents: [...state.completedEvents],
    discoveredAreas: [...state.discoveredAreas],
  });
  if (saved) {
    state.lastSavedAtIso = saved.savedAtIso;
  }
  return saved;
}

export function resetContextToNewGame(ctx: EngineContext): void {
  SaveSystem.clearSave();
  const { state } = ctx;
  if (state.currentVehicle) {
    state.currentVehicle.driver = 'none';
    state.currentVehicle = null;
  }
  state.playerPos.set(PLAYER_SPAWN_X, groundHeightAt(PLAYER_SPAWN_X, PLAYER_SPAWN_Z), PLAYER_SPAWN_Z);
  state.playerYaw = PLAYER_SPAWN_YAW;
  state.playerVelX = 0;
  state.playerVelY = 0;
  state.playerVelZ = 0;
  state.isGrounded = true;
  state.health = PLAYER_MAX_HEALTH;
  state.armor = 0;
  state.money = STARTING_MONEY;
  state.gameTime = INITIAL_GAME_TIME;
  state.dayNumber = 1;
  state.weapons = [
    ...DEFAULT_WEAPONS_STATE.map((w) => ({ ...w })),
    { id: 'pistol', clip: 12, reserve: 48 },
  ];
  state.activeWeaponId = 'pistol';
  state.outfit = { ...DEFAULT_OUTFIT_STATE };
  state.completedEvents = [];
  const startLoc = WorldRegistry.getLocationLabelAt(PLAYER_SPAWN_X, PLAYER_SPAWN_Z);
  state.currentDistrictId = startLoc.district.id;
  state.currentDistrictName = startLoc.district.name;
  state.currentStreetName = startLoc.streetName;
  state.discoveredAreas = [startLoc.district.id];
  state.lastSavedAtIso = null;
  state.combat.weaponState = 'idle';
  state.combat.aiming = false;
  state.combat.reloading = false;
  state.combat.reloadProgress = 0;
  state.combat.recoilKickTimer = 0;
  state.combat.meleeSwingTimer = 0;
  state.combat.gunShopOpen = false;
  state.combat.weaponWheelOpen = false;
  state.radio = createInitialRadioState();
  ctx.weatherSystem.setWeather('clear');
}

export function restoreSaveIntoContext(ctx: EngineContext): SaveGameData | null {
  const save = SaveSystem.loadGame();
  if (!save) return null;
  const { state } = ctx;

  if (state.currentVehicle) {
    state.currentVehicle.driver = 'none';
    state.currentVehicle = null;
  }

  state.money = save.money;
  state.health = save.health;
  state.armor = save.armor;
  state.gameTime = save.gameTime;
  state.dayNumber = save.dayNumber;
  state.playerPos.set(save.playerX, groundHeightAt(save.playerX, save.playerZ), save.playerZ);
  state.playerYaw = save.playerYaw;
  state.playerVelX = 0;
  state.playerVelY = 0;
  state.playerVelZ = 0;
  state.isGrounded = true;
  state.weapons = save.weapons.map((w) => ({ ...w }));
  state.activeWeaponId = save.activeWeaponId;
  state.outfit = { ...save.outfit };
  state.completedEvents = [...save.completedEvents];
  state.discoveredAreas = [...save.discoveredAreas];
  state.combat.weaponState = 'idle';
  state.combat.aiming = false;
  state.combat.reloading = false;
  state.combat.reloadProgress = 0;
  state.combat.recoilKickTimer = 0;
  state.combat.meleeSwingTimer = 0;
  state.combat.gunShopOpen = false;
  state.combat.weaponWheelOpen = false;
  state.radio = createInitialRadioState();

  const loc = WorldRegistry.getLocationLabelAt(save.playerX, save.playerZ);
  state.currentDistrictId = loc.district.id;
  state.currentDistrictName = loc.district.name;
  state.currentStreetName = loc.streetName;
  if (!state.discoveredAreas.includes(loc.district.id)) {
    state.discoveredAreas.push(loc.district.id);
  }

  for (const sv of save.vehicles) {
    const target = ctx.vehicles.find((v) => v.id === sv.id);
    if (target) {
      target.x = sv.x;
      target.z = sv.z;
      target.heading = sv.heading;
      target.health = sv.health;
      target.damageRatio = sv.damageRatio;
      applyVehiclePaintAndFinish(target, sv.paintHex, sv.finish);
      target.speed = 0;
      target.vx = 0;
      target.vy = 0;
      target.yawRate = 0;
      target.mesh.position.set(sv.x, groundHeightAt(sv.x, sv.z), sv.z);
      target.mesh.rotation.y = sv.heading;
    }
  }

  if (save.currentVehicleId) {
    const car = ctx.vehicles.find((v) => v.id === save.currentVehicleId);
    if (car) {
      car.driver = 'player';
      state.currentVehicle = car;
    }
  }

  ctx.weatherSystem.setWeather(save.weather);
  state.lastSavedAtIso = save.savedAtIso;
  return save;
}

export type { GameOptions };
