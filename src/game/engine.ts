import { AUTOSAVE_INTERVAL_SEC, MAX_FRAME_DT, QualityPreset } from './config';
import { DebugTools } from './core/DebugTools';
import {
  applyQualitySettingsToEngine,
  createEngineRuntimeAsync,
  EngineRuntime,
  nextFrame,
} from './core/EngineSetup';
import { captureSaveFromContext, resetContextToNewGame, restoreSaveIntoContext } from './core/SaveBridge';
import { DEFAULT_GAME_OPTIONS } from './core/SaveSystem';
import {
  createDefaultThreatContext,
  disposeSceneResources,
  groundHeightAt,
  stepCrowdAndImpacts,
  updateOceanWaves,
} from './core/WorldHelpers';
import { TouchInputState } from './systems/InputManager';
import { GameOptions, HudSnapshot, LoadingProgress, MissionId, RadioStationId, SaveGameData } from './types';
import { WEATHER_LABELS } from './WeatherSystem';
import { WorldRegistry } from './world/WorldRegistry';

export interface EngineInitOptions {
  initialOptions?: GameOptions;
  startPaused?: boolean;
  onLoadProgress?: (progress: LoadingProgress) => void;
}

export class CoastalCrimeEngine {
  private readonly rt: EngineRuntime;
  private readonly debugTools = new DebugTools();
  private readonly threatCtx = createDefaultThreatContext();
  private qualityPreset: QualityPreset = 'medium';
  private frameId = 0;
  private disposed = false;
  private lastTimeMs = performance.now();
  private fpsFrames = 0;
  private fpsAccumTime = 0;
  private autosaveTimer = 0;
  private reticleEl: HTMLElement | null = null;

  private constructor(rt: EngineRuntime, opts: GameOptions) {
    this.rt = rt;
    this.qualityPreset = opts.qualityPreset;
    this.bindCoreEvents();
    this.applyOptions(opts);
  }

  public static async create(
    container: HTMLElement,
    onHudUpdate: (snapshot: HudSnapshot) => void,
    initOpts?: EngineInitOptions
  ): Promise<CoastalCrimeEngine> {
    const opts = initOpts?.initialOptions ?? DEFAULT_GAME_OPTIONS;
    const progress = initOpts?.onLoadProgress;
    let engineRef: CoastalCrimeEngine | null = null;
    const rt = await createEngineRuntimeAsync(
      container,
      onHudUpdate,
      opts,
      Boolean(initOpts?.startPaused),
      () => engineRef?.qualityPreset ?? opts.qualityPreset,
      progress
    );
    engineRef = new CoastalCrimeEngine(rt, opts);
    if (!rt.ctx.isSoftwareGl) {
      progress?.({ progress: 94, stage: 'Compilando shaders PBR...' });
      await nextFrame();
      rt.ctx.renderer.compile(rt.ctx.scene, rt.ctx.camera);
    }
    progress?.({ progress: 100, stage: 'Pronto!' });
    engineRef.tick();
    return engineRef;
  }

  private bindCoreEvents(): void {
    window.addEventListener('resize', this.handleResize);
    this.rt.ctx.renderer.domElement.addEventListener('webglcontextlost', this.handleContextLost);
    this.rt.ctx.events.on('bannerRequested', ({ text, duration = 3.5 }) => {
      this.rt.ctx.state.bannerText = text;
      this.rt.ctx.state.bannerTimer = duration;
    });
    this.rt.ctx.events.on('vehicleHitPedestrian', (ev) => {
      if (ev.hitStopSec > 0) this.rt.ctx.state.hitStopTimer = Math.max(this.rt.ctx.state.hitStopTimer, ev.hitStopSec);
      this.rt.ctx.audio.playImpact(ev.impactStrength);
      this.rt.ctx.audio.playCartoonStars();
    });
    this.rt.ctx.events.on('saveRequested', () => { this.saveNow('mission'); });
    this.rt.input.setPointerLockLostHandler(() => {
      if (!this.rt.ctx.state.paused) {
        this.setPaused(true);
      }
    });
  }

  private handleContextLost = (e: Event): void => { e.preventDefault(); };

  private handleResize = (): void => {
    if (this.disposed) return;
    const { container, camera, renderer } = this.rt.ctx;
    const w = container.clientWidth || window.innerWidth;
    const h = container.clientHeight || window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  };

  private updatePlayerLocation(): void {
    const { state, events } = this.rt.ctx;
    const loc = WorldRegistry.getLocationLabelAt(state.playerPos.x, state.playerPos.z);
    state.currentStreetName = loc.streetName;
    if (loc.district.id !== state.currentDistrictId) {
      state.currentDistrictId = loc.district.id;
      state.currentDistrictName = loc.district.name;
      if (!state.discoveredAreas.includes(loc.district.id)) state.discoveredAreas.push(loc.district.id);
      events.emit('districtChanged', { districtId: loc.district.id, districtName: loc.district.name, streetName: loc.streetName });
    }
  }

  private tick = (): void => {
    if (this.disposed) return;
    const now = performance.now();
    const dt = Math.min(MAX_FRAME_DT, Math.max(0.001, (now - this.lastTimeMs) / 1000));
    this.lastTimeMs = now;
    this.rt.input.update(dt);
    this.processGlobalHotkeys();

    const { ctx, dayNight, cameraRig, weaponSys, wantedSys, hudBridge, minimap, impact, performanceSys } = this.rt;
    const { state } = ctx;
    if (state.paused) {
      ctx.audio.updateContinuous(dt, false, 0, false, 0);
      ctx.audio.updateRadio(
        dt,
        false,
        state.radio.stationId,
        state.radio.trackIndexByStation[state.radio.stationId] ?? 0
      );
      ctx.renderer.render(ctx.scene, ctx.camera);
      performanceSys.captureRendererInfo();
      hudBridge.update(dt);
      this.scheduleNextFrame();
      return;
    }

    state.elapsedSec += dt;
    if (state.bannerTimer > 0) state.bannerTimer = Math.max(0, state.bannerTimer - dt);
    if (state.hitStopTimer > 0) {
      state.hitStopTimer = Math.max(0, state.hitStopTimer - dt);
      cameraRig.update(dt);
      ctx.renderer.render(ctx.scene, ctx.camera);
      performanceSys.captureRendererInfo();
      this.scheduleNextFrame();
      return;
    }

    ctx.weatherEffects = ctx.weatherSystem.update(dt, state.playerPos.x, state.playerPos.z, dayNight.isNight(), state.timeScale);
    updateOceanWaves(ctx);
    for (const sys of this.rt.systems) {
      if (
        sys !== this.rt.input &&
        sys !== cameraRig &&
        sys !== minimap &&
        sys !== hudBridge &&
        sys !== performanceSys
      ) {
        sys.update(dt);
      }
    }
    this.updatePlayerLocation();
    stepCrowdAndImpacts(ctx, dt, this.threatCtx, impact, wantedSys.stars, dayNight.isNight(), dayNight.isWeekendDay());
    cameraRig.update(dt);
    weaponSys.lateUpdate(dt);
    this.updateReticleCssVars();

    const speedRatio = state.currentVehicle ? state.currentVehicle.speed / state.currentVehicle.maxSpeed : 0;
    ctx.audio.updateContinuous(dt, state.currentVehicle !== null, speedRatio, wantedSys.stars > 0, ctx.weatherEffects.rainIntensity);
    ctx.audio.updateRadio(
      dt,
      state.currentVehicle !== null,
      state.radio.stationId,
      state.radio.trackIndexByStation[state.radio.stationId] ?? 0
    );
    ctx.renderer.render(ctx.scene, ctx.camera);
    performanceSys.update(dt);
    this.debugTools.updateOverlay(ctx);

    this.fpsFrames++;
    this.fpsAccumTime += dt;
    if (this.fpsAccumTime >= 0.5) {
      state.currentFps = Math.round(this.fpsFrames / this.fpsAccumTime);
      this.fpsFrames = 0;
      this.fpsAccumTime = 0;
    }
    minimap.update(dt);
    hudBridge.update(dt);
    this.autosaveTimer += dt;
    if (this.autosaveTimer >= AUTOSAVE_INTERVAL_SEC) { this.autosaveTimer = 0; this.saveNow('autosave'); }
    this.scheduleNextFrame();
  };

  private scheduleNextFrame(): void {
    this.frameId = this.rt.ctx.isSoftwareGl ? window.setTimeout(this.tick, 60) : requestAnimationFrame(this.tick);
  }

  private processGlobalHotkeys(): void {
    if (this.rt.input.consumeAction('pause')) this.setPaused(!this.rt.ctx.state.paused);
    if (this.rt.ctx.state.paused) return;
    if (this.rt.input.consumeAction('toggleDebug')) this.toggleDebugPanel();
    if (this.rt.input.consumeAction('toggleWaypoints')) this.toggleWaypoints();
    if (this.rt.input.consumeAction('cycleTimeScale')) this.cycleTimeScale();
    if (this.rt.input.consumeAction('toggleRoutineLabels')) this.toggleRoutineLabels();
    if (this.rt.input.consumeAction('toggleColliders')) this.toggleColliders();
    if (this.rt.input.consumeAction('spawnTestGroup')) this.spawnTestGroup();
    if (this.rt.input.consumeAction('cycleWeather')) this.cycleWeather();
  }

  public setDebugOverlayCanvas(canvas: HTMLCanvasElement | null): void { this.debugTools.setOverlayCanvas(canvas); }
  public setMinimapCanvas(canvas: HTMLCanvasElement | null): void { this.rt.minimap.setCanvas(canvas); this.rt.minimap.update(0); }
  public setReticleElement(el: HTMLElement | null): void {
    this.reticleEl = el;
    this.updateReticleCssVars();
  }

  private updateReticleCssVars(): void {
    const el = this.reticleEl;
    if (!el) return;
    const { state } = this.rt.ctx;
    const spreadPx = Math.max(4, Math.min(54, 3.5 + state.combat.spreadAngle * 360));
    const hitOpacity = state.combat.hitMarkerTimer > 0 ? Math.min(1, state.combat.hitMarkerTimer / 0.14) : 0;
    const critical = state.combat.lastHitHeadshot || state.combat.lastHitKill;
    el.style.setProperty('--crosshair-spread', `${spreadPx.toFixed(1)}px`);
    el.style.setProperty('--hit-opacity', hitOpacity.toFixed(3));
    el.style.setProperty('--hit-scale', critical ? '1.45' : '1');
    el.style.setProperty('--hit-color', critical ? '#ef4444' : '#ffffff');
    el.dataset.critical = critical ? 'true' : 'false';
  }
  public drawMinimap(ctx: CanvasRenderingContext2D, w: number, h: number): void { this.rt.minimap.draw(ctx, w, h); }
  public setTouchInput(partial: Partial<TouchInputState>): void {
    this.rt.ctx.audio.unlock();
    this.rt.input.setTouchInput(partial);
  }
  public feedTouchLookDelta(dx: number, dy: number): void { this.rt.input.feedTouchLookDelta(dx, dy); }
  public setKeyCaptureActive(active: boolean): void { this.rt.input.setCapturingKey(active); }

  public selectWeapon(weaponId: string): void {
    this.rt.weaponSys.selectWeapon(weaponId);
    this.rt.weaponSys.setWeaponWheelOpen(false);
    this.rt.hudBridge.emitNow();
  }

  public setWeaponWheelOpen(open: boolean): void {
    this.rt.weaponSys.setWeaponWheelOpen(open);
    this.rt.hudBridge.emitNow();
  }

  public setGunShopOpen(open: boolean): void {
    this.rt.weaponSys.setGunShopOpen(open);
    this.rt.hudBridge.emitNow();
  }

  public buyGunShopItem(itemId: string): { ok: boolean; message: string } {
    const res = this.rt.weaponSys.buyGunShopItem(itemId);
    this.rt.hudBridge.emitNow();
    return res;
  }

  public giveAllWeapons(): void {
    this.rt.weaponSys.giveAllWeapons();
    this.rt.playerCtrl.syncTransform();
    this.rt.hudBridge.emitNow();
  }

  public damagePlayer(amount: number, source: string): { healthLost: number; armorAbsorbed: number; died: boolean } {
    const res = this.rt.weaponSys.damagePlayer(amount, source);
    this.rt.hudBridge.emitNow();
    return res;
  }

  public cycleRadioStation(dir: 1 | -1 = 1): void {
    this.rt.ctx.audio.unlock();
    this.rt.radioSys.cycleStation(dir);
    this.rt.hudBridge.emitNow();
  }

  public selectRadioStation(stationId: RadioStationId): void {
    this.rt.ctx.audio.unlock();
    this.rt.radioSys.selectStation(stationId);
    this.rt.hudBridge.emitNow();
  }

  public setRadioWheelOpen(open: boolean): void {
    this.rt.ctx.audio.unlock();
    this.rt.radioSys.setWheelOpen(open);
    this.rt.hudBridge.emitNow();
  }

  public skipRadioTrack(): void {
    this.rt.ctx.audio.unlock();
    this.rt.radioSys.nextTrack();
    this.rt.hudBridge.emitNow();
  }

  public sampleRadioSpectrum(out: number[]): boolean {
    return this.rt.ctx.audio.sampleRadioSpectrum(out);
  }

  public setPaused(paused: boolean): void {
    this.rt.ctx.state.paused = paused;
    if (paused) {
      this.rt.input.releasePointerLock();
      this.rt.weaponSys.setGunShopOpen(false);
      this.rt.weaponSys.setWeaponWheelOpen(false);
      this.rt.radioSys.setWheelOpen(false);
    } else {
      this.rt.ctx.audio.unlock();
    }
    this.lastTimeMs = performance.now();
    this.rt.input.clearTransient();
    this.rt.ctx.events.emit('pauseChanged', { paused });
    this.rt.hudBridge.emitNow();
  }

  public startNewGame(): void {
    this.rt.ctx.audio.unlock();
    resetContextToNewGame(this.rt.ctx);
    this.rt.wantedSys.clearWanted();
    this.rt.missionSys.setCompletedMissions([]);
    this.rt.missionSys.startMission('none');
    this.rt.playerCtrl.syncTransform();
    this.rt.chunkSys.forceSyncAroundPlayer();
    this.rt.dayNight.update(0);
    this.setPaused(false);
    this.rt.ctx.events.emit('bannerRequested', { text: 'Novo jogo iniciado em Baía Solara!', duration: 3.5 });
  }

  public continueSavedGame(): boolean {
    this.rt.ctx.audio.unlock();
    const save = restoreSaveIntoContext(this.rt.ctx);
    if (!save) return false;
    this.rt.wantedSys.clearWanted();
    this.rt.missionSys.setCompletedMissions(save.completedMissions);
    this.rt.missionSys.startMission('none');
    this.rt.playerCtrl.syncTransform();
    this.rt.chunkSys.forceSyncAroundPlayer();
    this.rt.dayNight.update(0);
    this.setPaused(false);
    this.rt.ctx.events.emit('bannerRequested', { text: 'Progresso restaurado com sucesso!', duration: 3.0 });
    return true;
  }

  public saveNow(_reason: 'autosave' | 'mission' | 'manual' = 'manual'): SaveGameData | null {
    const saved = captureSaveFromContext(this.rt.ctx, this.rt.missionSys.getSnapshot().completedMissions);
    if (saved) this.rt.hudBridge.emitNow();
    return saved;
  }

  public applyOptions(opts: GameOptions): void {
    this.setQualityPreset(opts.qualityPreset);
    this.rt.ctx.audio.setVolume(opts.volume);
    this.rt.ctx.audio.setMuted(opts.muted);
    this.rt.cameraRig.setOptions(opts.cameraSensitivity, opts.invertY, opts.aimMode, opts.aimSensitivityMul);
    this.rt.input.setKeyBindings(opts.keyBindings);
    this.rt.hudBridge.emitNow();
  }

  public startMission(id: MissionId): void { this.rt.missionSys.startMission(id); this.rt.hudBridge.emitNow(); }
  public advanceTimePhase(): void { this.rt.dayNight.advanceTimePhase(); this.rt.hudBridge.emitNow(); }
  public cycleTimeScale(): number { const n = this.rt.dayNight.cycleTimeScale(); this.rt.hudBridge.emitNow(); return n; }
  public toggleMute(): boolean { this.rt.ctx.audio.unlock(); const next = !this.rt.ctx.audio.isMuted(); this.rt.ctx.audio.setMuted(next); this.rt.hudBridge.emitNow(); return next; }
  public toggleWaypoints(): boolean { const v = this.debugTools.toggleWaypoints(this.rt.ctx); this.rt.hudBridge.emitNow(); return v; }
  public toggleColliders(): boolean { const v = this.debugTools.toggleColliders(this.rt.ctx); this.rt.hudBridge.emitNow(); return v; }
  public toggleRoutineLabels(): boolean { const v = this.debugTools.toggleRoutineLabels(this.rt.ctx); this.rt.hudBridge.emitNow(); return v; }
  public toggleDebugPanel(): boolean { const v = this.debugTools.toggleDebugPanel(this.rt.ctx); this.rt.hudBridge.emitNow(); return v; }

  public setQualityPreset(preset: QualityPreset): void {
    this.qualityPreset = preset;
    this.rt.weaponSys?.setQualityPreset(preset);
    applyQualitySettingsToEngine(this.rt.ctx, this.rt.dayNight, this.rt.performanceSys, this.rt.chunkSys, preset);
    this.rt.hudBridge.emitNow();
  }

  public spawnTestGroup(): void {
    const { state, crowd, events } = this.rt.ctx;
    const yaw = state.currentVehicle ? state.currentVehicle.heading : state.playerYaw;
    crowd.spawnTestGroupInFront(state.playerPos.x, state.playerPos.z, yaw, groundHeightAt, 10);
    events.emit('bannerRequested', { text: '10 NPCs spawnados à frente (K)!', duration: 1.8 });
  }

  public cycleWeather(): void {
    const next = this.rt.ctx.weatherSystem.cycleWeather();
    this.rt.ctx.events.emit('weatherChanged', { weather: next, label: WEATHER_LABELS[next], manual: true });
    this.rt.ctx.events.emit('bannerRequested', { text: `Clima: ${WEATHER_LABELS[next]}`, duration: 3.0 });
    this.rt.hudBridge.emitNow();
  }

  public dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frameId);
    clearTimeout(this.frameId);
    window.removeEventListener('resize', this.handleResize);
    this.rt.ctx.renderer.domElement.removeEventListener('webglcontextlost', this.handleContextLost);
    for (let i = this.rt.systems.length - 1; i >= 0; i--) this.rt.systems[i].dispose();
    this.rt.ctx.vehicles.length = 0;
    this.debugTools.dispose();
    this.rt.ctx.events.clear();
    this.rt.ctx.audio.dispose();
    this.rt.shadowTex.dispose();
    this.rt.ctx.world.chunkManager.dispose();
    disposeSceneResources(this.rt.ctx.scene);
    this.rt.ctx.renderer.dispose();
    if (this.rt.ctx.renderer.domElement.parentNode === this.rt.ctx.container) {
      this.rt.ctx.container.removeChild(this.rt.ctx.renderer.domElement);
    }
  }
}
