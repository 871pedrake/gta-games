import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ErrorBoundary } from './components/ErrorBoundary';
import { GameHUD } from './components/GameHUD';
import { LoadingScreen } from './components/LoadingScreen';
import { MainMenu } from './components/MainMenu';
import { TouchControls } from './components/TouchControls';
import {
  MAX_NPC_VISIBLE,
  MAX_SIMULATED_INJURED,
  PLAYER_MAX_HEALTH,
  QUALITY_SETTINGS,
  QualityPreset,
} from './game/config';
import { DEFAULT_RADIO_STATION_ID, getRadioStation } from './game/RadioStations';
import { SaveSystem } from './game/core/SaveSystem';
import { CoastalCrimeEngine } from './game/engine';
import { TouchInputState } from './game/systems/InputManager';
import {
  AppScreenState,
  GameOptions,
  HudSnapshot,
  LoadingProgress,
  MissionId,
  SaveGameData,
} from './game/types';

const OptionsModal = lazy(() =>
  import('./components/OptionsModal').then((m) => ({ default: m.OptionsModal }))
);
const PauseMenu = lazy(() =>
  import('./components/PauseMenu').then((m) => ({ default: m.PauseMenu }))
);

const INITIAL_HUD: HudSnapshot = {
  money: 500,
  health: PLAYER_MAX_HEALTH,
  armor: 0,
  wantedStars: 0,
  evadingProgress: 0,
  bustProgress: 0,
  inVehicle: false,
  vehicleName: '',
  vehicleHealthPct: 100,
  speedKmh: 0,
  nearVehiclePrompt: false,
  nearGunShopPrompt: false,
  gunShopOpen: false,
  weaponWheelOpen: false,
  radio: (() => {
    const st = getRadioStation(DEFAULT_RADIO_STATION_ID);
    return {
      stationId: st.id,
      stationName: st.name,
      frequency: st.frequency,
      genre: st.genre,
      colorHex: st.colorHex,
      trackTitle: st.tracks[0].title,
      trackArtist: st.tracks[0].artist,
      trackIndex: 0,
      trackCount: st.tracks.length,
      isOff: st.id === 'off',
      notificationTimer: 0,
      wheelOpen: false,
    };
  })(),
  isPointerLocked: false,
  activeWeaponId: 'fists',
  weaponName: 'Punhos',
  ammoClip: 0,
  ammoReserve: 0,
  isAiming: false,
  isReloading: false,
  reloadProgress: 0,
  weapon: {
    activeWeaponId: 'fists',
    weaponName: 'Punhos',
    slot: 1,
    isFirearm: false,
    weaponState: 'idle',
    clip: 0,
    clipSize: 0,
    reserve: 0,
    reloading: false,
    reloadProgress: 0,
    aiming: false,
    shoulderSide: 1,
    crosshairSpreadPx: 8,
    hitMarkerAge: 0,
    lastHitHeadshot: false,
    lastHitKill: false,
    ownedWeapons: [{ id: 'fists', clip: 0, reserve: 0 }],
  },
  weaponDebug: {
    activeProjectiles: 0,
    activeParticles: 0,
    activeDecals: 0,
    activeTracers: 0,
    activeCasings: 0,
  },
  timeOfDayLabel: 'Pôr do Sol',
  gameTimeFormatted: '17:30',
  isWeekend: false,
  dayNumber: 1,
  timeScale: 1,
  timeNormalized: 0.0,
  weather: 'clear',
  weatherLabel: 'Céu Limpo',
  weatherGripPct: 100,
  currentDistrictName: 'Centro Neon',
  currentStreetName: 'Garagem Central',
  mission: {
    id: 'none',
    step: 0,
    title: 'Modo Livre',
    objective: 'Explore a orla, colete dinheiro ou entre no marcador rosa/ciano.',
    targetPos: null,
    completedMissions: [],
  },
  bannerText: 'Bem-vindo a Baía Solara! Explore ou inicie uma missão.',
  bustedFlash: false,
  muted: false,
  fps: 60,
  activeNpcs: 0,
  backgroundNpcs: 0,
  insideBuildingsNpcs: 0,
  nearbyNpcs: 0,
  lodCounts: { full: 0, mid: 0, low: 0 },
  maxNpcs: MAX_NPC_VISIBLE,
  ragdollsInUse: 0,
  ragdollsPoolSize: MAX_SIMULATED_INJURED,
  injuredCount: 0,
  activeInjuredCount: 0,
  maxInjuredCap: MAX_SIMULATED_INJURED,
  zoneStats: [],
  zoneAlerts: [],
  qualityPreset: 'medium',
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
  showDebugPanel: false,
  busPassengersTotal: 0,
  activeBuses: 2,
  ambulanceStatus: 'Pronta',
  trafficSignalPhase: 'N-S Verde',
  showWaypoints: false,
  showColliders: false,
  showRoutineLabels: false,
  paused: true,
  gamepadConnected: false,
  lastSavedAtIso: null,
};

function detectTouchCapability(): boolean {
  if (typeof window === 'undefined') return false;
  return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
}

function GameShell() {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const minimapCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const debugOverlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const reticleElRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<CoastalCrimeEngine | null>(null);

  const [hud, setHud] = useState<HudSnapshot>(INITIAL_HUD);
  const [dockCollapsed, setDockCollapsed] = useState(false);
  const [loading, setLoading] = useState<LoadingProgress>({
    progress: 0,
    stage: 'Preparando motor 3D...',
  });
  const [screen, setScreen] = useState<AppScreenState>('loading');
  const [showOptions, setShowOptions] = useState(false);
  const [options, setOptions] = useState<GameOptions>(() => SaveSystem.loadOptions());
  const [savedGame, setSavedGame] = useState<SaveGameData | null>(() => SaveSystem.loadGame());
  const screenRef = useRef<AppScreenState>('loading');

  useEffect(() => {
    screenRef.current = screen;
  }, [screen]);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    let cancelled = false;
    let localEngine: CoastalCrimeEngine | null = null;
    const initialOpts = SaveSystem.loadOptions();

    const handleKeyU = (e: KeyboardEvent) => {
      if (e.code === 'KeyU' && !e.repeat && screenRef.current === 'playing') {
        setDockCollapsed((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyU);

    void CoastalCrimeEngine.create(
      container,
      (snapshot) => {
        setHud(snapshot);
        if (screenRef.current === 'playing' && snapshot.paused) {
          setScreen('paused');
        } else if (screenRef.current === 'paused' && !snapshot.paused) {
          setScreen('playing');
        }
        const mapCanvas = minimapCanvasRef.current;
        if (mapCanvas && engineRef.current) {
          const ctx = mapCanvas.getContext('2d');
          if (ctx) {
            engineRef.current.drawMinimap(ctx, mapCanvas.width, mapCanvas.height);
          }
        }
      },
      {
        initialOptions: initialOpts,
        startPaused: true,
        onLoadProgress: (p) => {
          if (!cancelled) setLoading(p);
        },
      }
    ).then((engine) => {
      if (cancelled) {
        engine.dispose();
        return;
      }
      localEngine = engine;
      engineRef.current = engine;
      engine.setDebugOverlayCanvas(debugOverlayCanvasRef.current);
      engine.setMinimapCanvas(minimapCanvasRef.current);
      engine.setReticleElement(reticleElRef.current);
      setScreen('menu');
    });

    return () => {
      cancelled = true;
      window.removeEventListener('keydown', handleKeyU);
      localEngine?.dispose();
      engineRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (screen === 'playing' && minimapCanvasRef.current && engineRef.current) {
      engineRef.current.setMinimapCanvas(minimapCanvasRef.current);
    }
  }, [screen]);

  const handleOptionsChange = useCallback((next: GameOptions) => {
    setOptions(next);
    SaveSystem.saveOptions(next);
    engineRef.current?.applyOptions(next);
  }, []);

  const handleKeyCaptureChange = useCallback((capturing: boolean) => {
    engineRef.current?.setKeyCaptureActive(capturing);
  }, []);

  const handleNewGame = () => {
    engineRef.current?.startNewGame();
    setSavedGame(null);
    setScreen('playing');
  };

  const handleContinue = () => {
    const ok = engineRef.current?.continueSavedGame();
    if (ok) {
      setScreen('playing');
    } else {
      handleNewGame();
    }
  };

  const handlePause = () => {
    engineRef.current?.setPaused(true);
    setScreen('paused');
  };

  const handleResume = () => {
    engineRef.current?.setPaused(false);
    setScreen('playing');
  };

  const handleSaveNow = () => {
    const saved = engineRef.current?.saveNow('manual') ?? null;
    if (saved) setSavedGame(saved);
  };

  const handleReturnToMenu = () => {
    const saved = engineRef.current?.saveNow('manual') ?? null;
    if (saved) setSavedGame(saved);
    engineRef.current?.setPaused(true);
    setShowOptions(false);
    setScreen('menu');
  };

  const handleSetQualityPreset = (preset: QualityPreset) => {
    handleOptionsChange({ ...options, qualityPreset: preset });
  };

  const handleToggleMute = () => {
    const muted = engineRef.current?.toggleMute() ?? !options.muted;
    const next = { ...options, muted };
    setOptions(next);
    SaveSystem.saveOptions(next);
  };

  const handleTouchInput = useCallback((partial: Partial<TouchInputState>) => {
    engineRef.current?.setTouchInput(partial);
  }, []);

  const handleReticleRef = useCallback((el: HTMLDivElement | null) => {
    reticleElRef.current = el;
    engineRef.current?.setReticleElement(el);
  }, []);

  const handleSampleRadioSpectrum = useCallback((out: number[]): boolean => {
    return engineRef.current?.sampleRadioSpectrum(out) ?? false;
  }, []);

  const handleDownloadHtml = () => {
    const link = document.createElement('a');
    link.href = '/baia-solara-3d.html';
    link.download = 'baia-solara-3d.html';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const showTouch = useMemo(() => {
    if (screen !== 'playing' || hud.gunShopOpen || hud.weaponWheelOpen || hud.radio.wheelOpen) return false;
    if (options.touchMode === 'on') return true;
    if (options.touchMode === 'off') return false;
    return detectTouchCapability();
  }, [screen, hud.gunShopOpen, hud.weaponWheelOpen, hud.radio.wheelOpen, options.touchMode]);

  const interactKeyLabel = options.keyBindings.interact.replace(/^Key/, '');
  const doorsKeyLabel = options.keyBindings.toggleDoors.replace(/^Key/, '');
  const radioPrevKeyLabel = options.keyBindings.radioPrev.replace(/^Key/, '');
  const radioNextKeyLabel = options.keyBindings.radioNext.replace(/^Key/, '');

  return (
    <main className="relative h-screen w-screen overflow-hidden bg-[#0d081d]">
      <div ref={mountRef} className="absolute inset-0 h-full w-full" />

      <canvas
        ref={debugOverlayCanvasRef}
        className="pointer-events-none fixed inset-0 z-[5] h-full w-full"
      />

      {screen === 'playing' && (
        <GameHUD
          hud={hud}
          minimapCanvasRef={minimapCanvasRef}
          reticleRef={handleReticleRef}
          dockCollapsed={dockCollapsed}
          interactKeyLabel={interactKeyLabel}
          doorsKeyLabel={doorsKeyLabel}
          radioPrevKeyLabel={radioPrevKeyLabel}
          radioNextKeyLabel={radioNextKeyLabel}
          onPause={handlePause}
          onToggleDock={() => setDockCollapsed((prev) => !prev)}
          onStartMission={(id: MissionId) => engineRef.current?.startMission(id)}
          onAdvanceTime={() => engineRef.current?.advanceTimePhase()}
          onCycleTimeScale={() => engineRef.current?.cycleTimeScale()}
          onCycleWeather={() => engineRef.current?.cycleWeather()}
          onToggleMute={handleToggleMute}
          onToggleWaypoints={() => engineRef.current?.toggleWaypoints()}
          onToggleColliders={() => engineRef.current?.toggleColliders()}
          onToggleRoutineLabels={() => engineRef.current?.toggleRoutineLabels()}
          onSpawnTestGroup={() => engineRef.current?.spawnTestGroup()}
          onToggleDebugPanel={() => engineRef.current?.toggleDebugPanel()}
          onSetQualityPreset={handleSetQualityPreset}
          onDownloadHtml={handleDownloadHtml}
          onSelectWeapon={(weaponId) => engineRef.current?.selectWeapon(weaponId)}
          onCloseWeaponWheel={() => engineRef.current?.setWeaponWheelOpen(false)}
          onOpenGunShop={() => engineRef.current?.setGunShopOpen(true)}
          onCloseGunShop={() => engineRef.current?.setGunShopOpen(false)}
          onBuyGunShopItem={(itemId) => {
            engineRef.current?.buyGunShopItem(itemId);
          }}
          onGiveAllWeapons={() => engineRef.current?.giveAllWeapons()}
          onCycleRadio={(dir) => engineRef.current?.cycleRadioStation(dir)}
          onSkipRadioTrack={() => engineRef.current?.skipRadioTrack()}
          onSelectRadioStation={(stationId) => engineRef.current?.selectRadioStation(stationId)}
          onSetRadioWheelOpen={(open) => engineRef.current?.setRadioWheelOpen(open)}
          onSampleRadioSpectrum={handleSampleRadioSpectrum}
        />
      )}

      {showTouch && (
        <TouchControls
          inVehicle={hud.inVehicle}
          hasFirearm={hud.weapon.isFirearm}
          aiming={hud.weapon.aiming}
          onChangeTouch={handleTouchInput}
          onLookDelta={(dx, dy) => engineRef.current?.feedTouchLookDelta(dx, dy)}
        />
      )}

      {screen === 'loading' && <LoadingScreen loading={loading} />}

      {screen === 'menu' && (
        <MainMenu
          savedGame={savedGame}
          onNewGame={handleNewGame}
          onContinue={handleContinue}
          onOpenOptions={() => setShowOptions(true)}
        />
      )}

      <Suspense fallback={null}>
        {screen === 'paused' && !showOptions && (
          <PauseMenu
            lastSavedAtIso={hud.lastSavedAtIso ?? savedGame?.savedAtIso ?? null}
            onResume={handleResume}
            onSaveNow={handleSaveNow}
            onOpenOptions={() => setShowOptions(true)}
            onReturnToMenu={handleReturnToMenu}
          />
        )}

        {showOptions && (
          <OptionsModal
            options={options}
            onChange={handleOptionsChange}
            onClose={() => setShowOptions(false)}
            onKeyCaptureChange={handleKeyCaptureChange}
          />
        )}
      </Suspense>
    </main>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <GameShell />
    </ErrorBoundary>
  );
}
