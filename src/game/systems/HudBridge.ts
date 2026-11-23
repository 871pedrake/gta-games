import {
  HUD_EMIT_INTERVAL_SEC,
  MAX_NPC_VISIBLE,
  MAX_SIMULATED_INJURED,
  QualityPreset,
  VEHICLE_SPEED_TO_KMH,
} from '../config';
import { EngineContext, GameSystem } from '../core/SystemLifecycle';
import { getRadioStation } from '../RadioStations';
import { RAGDOLL_POOL_SIZE } from '../RagdollPool';
import { HudSnapshot, MissionStatus, WeaponDebugStats } from '../types';
import { getWeaponDef } from '../WeaponDefs';
import { WantedSnapshot } from './WantedSystem';

export interface HudTelemetrySource {
  getWantedSnapshot: () => WantedSnapshot;
  getMissionSnapshot: () => MissionStatus;
  hasNearbyVehicle: () => boolean;
  getTimeLabel: () => string;
  getFormattedClock: () => string;
  isWeekend: () => boolean;
  getQualityPreset: () => QualityPreset;
  getInjuredTotalCount: () => number;
  isGamepadConnected: () => boolean;
  isPointerLocked: () => boolean;
  getWeaponDebugStats?: () => WeaponDebugStats;
}

export class HudBridge implements GameSystem {
  public readonly name = 'HudBridge';

  private ctx: EngineContext | null = null;
  private readonly onHudUpdate: (snapshot: HudSnapshot) => void;
  private readonly telemetry: HudTelemetrySource;
  private emitAccum = 0;

  constructor(onHudUpdate: (snapshot: HudSnapshot) => void, telemetry: HudTelemetrySource) {
    this.onHudUpdate = onHudUpdate;
    this.telemetry = telemetry;
  }

  public init(ctx: EngineContext): void {
    this.ctx = ctx;
    this.emitNow();
  }

  public update(dt: number): void {
    this.emitAccum += dt;
    if (this.emitAccum >= HUD_EMIT_INTERVAL_SEC) {
      this.emitAccum = 0;
      this.emitNow();
    }
  }

  public emitNow(): void {
    if (!this.ctx) return;
    const { state, crowd, ragdolls, transit, weatherEffects, audio } = this.ctx;
    const wanted = this.telemetry.getWantedSnapshot();
    const car = state.currentVehicle;
    const carPct = car ? Math.round((1 - (car.damageRatio ?? 0)) * 100) : 100;
    const weaponDef = getWeaponDef(state.activeWeaponId);
    const weaponEntry = state.weapons.find((w) => w.id === state.activeWeaponId);
    const spreadPx = Math.max(4, Math.min(54, Math.round(3.5 + state.combat.spreadAngle * 360)));

    this.onHudUpdate({
      money: state.money,
      health: Math.round(state.health),
      armor: Math.round(state.armor),
      wantedStars: wanted.stars,
      evadingProgress: wanted.evadingProgress,
      bustProgress: wanted.bustProgress,
      inVehicle: car !== null,
      vehicleName: car?.name ?? '',
      vehicleHealthPct: carPct,
      speedKmh: car ? Math.round(Math.abs(car.speed) * VEHICLE_SPEED_TO_KMH) : 0,
      nearVehiclePrompt: !car && this.telemetry.hasNearbyVehicle(),
      nearGunShopPrompt: !car && state.combat.nearGunShop && !state.combat.gunShopOpen,
      gunShopOpen: !car && state.combat.gunShopOpen,
      weaponWheelOpen: !car && state.combat.weaponWheelOpen,
      radio: (() => {
        const st = getRadioStation(state.radio.stationId);
        const idx = (state.radio.trackIndexByStation[st.id] ?? 0) % st.tracks.length;
        return {
          stationId: state.radio.stationId,
          stationName: state.radio.stationName,
          frequency: state.radio.frequency,
          genre: state.radio.genre,
          colorHex: state.radio.colorHex,
          trackTitle: state.radio.trackTitle,
          trackArtist: state.radio.trackArtist,
          trackIndex: idx,
          trackCount: st.tracks.length,
          isOff: state.radio.isOff,
          notificationTimer: state.radio.notificationTimer,
          wheelOpen: car !== null && state.radio.wheelOpen,
        };
      })(),
      isPointerLocked: this.telemetry.isPointerLocked(),
      activeWeaponId: weaponDef.id,
      weaponName: weaponDef.name,
      ammoClip: weaponEntry?.clip ?? 0,
      ammoReserve: weaponEntry?.reserve ?? 0,
      isAiming: state.combat.aiming,
      isReloading: state.combat.reloading,
      reloadProgress: state.combat.reloadProgress,
      weapon: {
        activeWeaponId: weaponDef.id,
        weaponName: weaponDef.name,
        slot: weaponDef.slot,
        isFirearm: weaponDef.isFirearm,
        weaponState: state.combat.weaponState,
        clip: weaponEntry?.clip ?? 0,
        clipSize: weaponDef.clipSize,
        reserve: weaponEntry?.reserve ?? 0,
        reloading: state.combat.reloading,
        reloadProgress: state.combat.reloadProgress,
        aiming: state.combat.aiming,
        shoulderSide: state.combat.shoulderSide,
        crosshairSpreadPx: spreadPx,
        hitMarkerAge: state.combat.hitMarkerTimer,
        lastHitHeadshot: state.combat.lastHitHeadshot,
        lastHitKill: state.combat.lastHitKill,
        ownedWeapons: state.weapons.map((w) => ({ ...w })),
      },
      weaponDebug: this.telemetry.getWeaponDebugStats
        ? { ...this.telemetry.getWeaponDebugStats() }
        : {
            activeProjectiles: 0,
            activeParticles: 0,
            activeDecals: 0,
            activeTracers: 0,
            activeCasings: 0,
          },
      timeOfDayLabel: this.telemetry.getTimeLabel(),
      gameTimeFormatted: this.telemetry.getFormattedClock(),
      isWeekend: this.telemetry.isWeekend(),
      dayNumber: state.dayNumber,
      timeScale: state.timeScale,
      timeNormalized: state.timeNormalized,
      weather: weatherEffects.current,
      weatherLabel: weatherEffects.label,
      weatherGripPct: Math.round(weatherEffects.grip * 100),
      currentDistrictName: state.currentDistrictName,
      currentStreetName: state.currentStreetName,
      mission: this.telemetry.getMissionSnapshot(),
      bannerText: state.bannerTimer > 0 ? state.bannerText : null,
      bustedFlash: wanted.bustedFlash,
      muted: audio.isMuted(),
      fps: state.currentFps,
      activeNpcs: crowd.activeCount,
      backgroundNpcs: crowd.backgroundCount,
      insideBuildingsNpcs: crowd.insideCount,
      nearbyNpcs: crowd.nearbyCount,
      lodCounts: { ...crowd.lodSystem.counts },
      maxNpcs: crowd.maxVisibleNpcs ?? MAX_NPC_VISIBLE,
      ragdollsInUse: ragdolls.inUseCount,
      ragdollsPoolSize: RAGDOLL_POOL_SIZE,
      injuredCount: this.telemetry.getInjuredTotalCount(),
      activeInjuredCount: crowd.activeInjuredCount,
      maxInjuredCap: MAX_SIMULATED_INJURED,
      zoneStats: crowd.zoneDensity.getStatsSnapshot(),
      zoneAlerts: [...crowd.zoneDensity.alerts],
      qualityPreset: this.telemetry.getQualityPreset(),
      renderTelemetry: { ...state.renderTelemetry },
      showDebugPanel: state.showDebugPanel,
      busPassengersTotal: transit.getTotalBusPassengers(),
      activeBuses: transit.getActiveBusesCount(),
      ambulanceStatus: transit.getAmbulanceStatusLabel(),
      trafficSignalPhase: crowd.graph.getSignalLabel(),
      showWaypoints: state.showWaypoints,
      showColliders: state.showColliders,
      showRoutineLabels: state.showRoutineLabels,
      paused: state.paused,
      gamepadConnected: this.telemetry.isGamepadConnected(),
      lastSavedAtIso: state.lastSavedAtIso,
    });
  }

  public dispose(): void {
    this.ctx = null;
  }
}
