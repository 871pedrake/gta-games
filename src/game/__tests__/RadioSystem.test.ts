import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProceduralAudio } from '../audio';
import { GameEventMap, TypedEventBus } from '../core/EventBus';
import { EngineContext } from '../core/SystemLifecycle';
import { createInitialSimulationState } from '../core/WorldHelpers';
import { getRadioTrackComposition } from '../RadioMusicEngine';
import { RADIO_STATIONS } from '../RadioStations';
import { HudBridge } from '../systems/HudBridge';
import { InputManager } from '../systems/InputManager';
import { RadioSystem } from '../systems/RadioSystem';
import { VehicleSystem } from '../systems/VehicleSystem';
import { HudSnapshot, RadioStationId, VehicleEntity } from '../types';

function makeMockVehicle(): VehicleEntity {
  return {
    id: 'test_coupe',
    name: 'Solara GT',
    type: 'coupe',
    mesh: new THREE.Group(),
    frontWheelPivots: [],
    wheels: [],
    headlights: [],
    taillights: [],
    x: 0,
    z: 0,
    heading: 0,
    speed: 0,
    steerAngle: 0,
    halfWidth: 1,
    halfLength: 2,
    maxSpeed: 30,
    accel: 12,
    driver: 'player',
  };
}

function createRadioTestCtx() {
  const keyListeners = new Map<string, Array<(e: KeyboardEvent) => void>>();
  vi.stubGlobal('window', {
    addEventListener: (type: string, cb: (e: KeyboardEvent) => void) => {
      const arr = keyListeners.get(type) ?? [];
      arr.push(cb);
      keyListeners.set(type, arr);
    },
    removeEventListener: vi.fn(),
  });
  vi.stubGlobal('document', {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });

  const bus = new TypedEventBus<GameEventMap>();
  const state = createInitialSimulationState(false);
  const playRadioTune = vi.fn();
  const audioUnlock = vi.fn();

  const ctx = {
    renderer: { domElement: { addEventListener: vi.fn(), removeEventListener: vi.fn() } },
    events: bus,
    audio: {
      unlock: audioUnlock,
      isMuted: () => false,
      playRadioTune,
      playDoorToggle: vi.fn(),
    },
    crowd: {
      activeCount: 0,
      backgroundCount: 0,
      insideCount: 0,
      nearbyCount: 0,
      lodSystem: { counts: { full: 0, mid: 0, low: 0 } },
      maxVisibleNpcs: 32,
      zoneDensity: { getStatsSnapshot: () => [], alerts: [] },
      graph: { getSignalLabel: () => 'N-S Verde' },
    },
    ragdolls: { inUseCount: 0 },
    transit: {
      getTotalBusPassengers: () => 0,
      getActiveBusesCount: () => 0,
      getAmbulanceStatusLabel: () => 'Pronta',
      releaseBusPassengersOnHijack: vi.fn(),
    },
    weatherEffects: { current: 'clear', label: 'Céu Limpo', grip: 1, rainIntensity: 0 },
    scene: new THREE.Scene(),
    isSoftwareGl: true,
    vehicles: [] as VehicleEntity[],
    groundHeightAt: () => 0,
    resolveWorldCollisions: () => false,
    state,
  } as unknown as EngineContext;

  const emitKey = (code: string) => {
    const ev = { code, repeat: false, preventDefault: vi.fn() } as unknown as KeyboardEvent;
    for (const fn of keyListeners.get('keydown') ?? []) fn(ev);
  };

  return { ctx, bus, state, playRadioTune, audioUnlock, emitKey };
}

function createMockWebAudioHarness(initialState: AudioContextState = 'running') {
  const gainNodes: Array<{
    gain: {
      value: number;
      setValueAtTime: ReturnType<typeof vi.fn>;
      setTargetAtTime: ReturnType<typeof vi.fn>;
      linearRampToValueAtTime: ReturnType<typeof vi.fn>;
      exponentialRampToValueAtTime: ReturnType<typeof vi.fn>;
      cancelScheduledValues: ReturnType<typeof vi.fn>;
    };
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
  }> = [];

  const oscNodes: Array<{
    type: OscillatorType;
    frequency: {
      value: number;
      setValueAtTime: ReturnType<typeof vi.fn>;
      setTargetAtTime: ReturnType<typeof vi.fn>;
      linearRampToValueAtTime: ReturnType<typeof vi.fn>;
      exponentialRampToValueAtTime: ReturnType<typeof vi.fn>;
      cancelScheduledValues: ReturnType<typeof vi.fn>;
    };
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    onended: (() => void) | null;
  }> = [];

  const bufferSources: Array<{
    buffer: unknown;
    loop: boolean;
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    onended: (() => void) | null;
  }> = [];

  const makeParam = () => ({
    value: 0,
    setValueAtTime: vi.fn(),
    setTargetAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
    cancelScheduledValues: vi.fn(),
  });

  const mockAnalyser = {
    fftSize: 64,
    frequencyBinCount: 32,
    smoothingTimeConstant: 0.7,
    minDecibels: -90,
    maxDecibels: -22,
    connect: vi.fn(),
    getByteFrequencyData: vi.fn((arr: Uint8Array) => {
      for (let i = 0; i < arr.length; i++) {
        arr[i] = i < 12 ? 200 - i * 10 : 40;
      }
    }),
  };

  let latestCtx: MockAudioContext | null = null;

  class MockAudioContext {
    public state: AudioContextState = initialState;
    public currentTime = 1.0;
    public sampleRate = 44100;
    public destination = { kind: 'destination' };
    public resume = vi.fn(async () => {
      this.state = 'running';
    });
    public close = vi.fn(async () => {
      this.state = 'closed';
    });

    constructor() {
      latestCtx = this;
    }

    public createGain() {
      const node = {
        gain: makeParam(),
        connect: vi.fn(),
        disconnect: vi.fn(),
      };
      gainNodes.push(node);
      return node;
    }

    public createOscillator() {
      const node = {
        type: 'sine' as OscillatorType,
        frequency: makeParam(),
        connect: vi.fn(),
        disconnect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        onended: null as (() => void) | null,
      };
      oscNodes.push(node);
      return node;
    }

    public compressorNodes: Array<{
      threshold: { value: number };
      knee: { value: number };
      ratio: { value: number };
      attack: { value: number };
      release: { value: number };
      connect: ReturnType<typeof vi.fn>;
      disconnect: ReturnType<typeof vi.fn>;
    }> = [];

    public createBiquadFilter() {
      return {
        type: 'lowpass',
        frequency: makeParam(),
        Q: { value: 0 },
        gain: makeParam(),
        connect: vi.fn(),
        disconnect: vi.fn(),
      };
    }

    public createDynamicsCompressor() {
      const node = {
        threshold: { value: 0 },
        knee: { value: 0 },
        ratio: { value: 0 },
        attack: { value: 0 },
        release: { value: 0 },
        connect: vi.fn(),
        disconnect: vi.fn(),
      };
      this.compressorNodes.push(node);
      return node;
    }

    public createDelay() {
      return {
        delayTime: { value: 0 },
        connect: vi.fn(),
        disconnect: vi.fn(),
      };
    }

    public createWaveShaper() {
      return {
        curve: null as Float32Array | null,
        connect: vi.fn(),
        disconnect: vi.fn(),
      };
    }

    public createBuffer(_ch: number, len: number) {
      return {
        getChannelData: () => new Float32Array(len),
      };
    }

    public createBufferSource() {
      const node = {
        buffer: null,
        loop: false,
        connect: vi.fn(),
        disconnect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        onended: null as (() => void) | null,
      };
      bufferSources.push(node);
      return node;
    }

    public createAnalyser() {
      return mockAnalyser;
    }
  }

  vi.stubGlobal('window', { AudioContext: MockAudioContext });

  return {
    getCtx: () => latestCtx!,
    gainNodes,
    oscNodes,
    bufferSources,
    mockAnalyser,
  };
}

describe('RadioSystem', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('bloqueia troca de estação a pé e alterna estações com notificação ao entrar no veículo', () => {
    const { ctx, bus, state, playRadioTune, emitKey } = createRadioTestCtx();
    const input = new InputManager();
    const radioSys = new RadioSystem(input);

    input.init(ctx);
    radioSys.init(ctx);

    const onRadioChanged = vi.fn();
    bus.on('radioChanged', onRadioChanged);

    // Fora do veículo: tecla X não altera estação nem toca ruído de sintonia
    emitKey('KeyX');
    input.update(0.016);
    radioSys.update(0.016);
    expect(state.radio.stationId).toBe('solara_fm');
    expect(playRadioTune).not.toHaveBeenCalled();

    // Entra no veículo: exibe notificação "Tocando agora"
    const car = makeMockVehicle();
    state.currentVehicle = car;
    bus.emit('vehicleEntered', { vehicle: car, wasOccupiedByNpc: false });
    expect(state.radio.notificationTimer).toBeGreaterThan(0);
    expect(onRadioChanged).toHaveBeenCalledTimes(1);

    // Pressiona X para ir para a próxima estação (Baía Beats)
    emitKey('KeyX');
    input.update(0.016);
    radioSys.update(0.016);
    expect(state.radio.stationId).toBe('baia_beats');
    expect(state.radio.stationName).toBe('Baía Beats');
    expect(playRadioTune).toHaveBeenCalledTimes(1);
    expect(state.radio.notificationTimer).toBeGreaterThan(3);

    // Pressiona Z para voltar para Solara FM
    emitKey('KeyZ');
    input.update(0.016);
    radioSys.update(0.016);
    expect(state.radio.stationId).toBe('solara_fm');
    expect(playRadioTune).toHaveBeenCalledTimes(2);

    // Pressiona Z novamente para dar a volta até 'off' (Rádio Desligada)
    emitKey('KeyZ');
    input.update(0.016);
    radioSys.update(0.016);
    expect(state.radio.stationId).toBe('off');
    expect(state.radio.isOff).toBe(true);

    // Sai do veículo: fecha seletor e limpa notificação
    radioSys.setWheelOpen(true);
    expect(state.radio.wheelOpen).toBe(true);
    state.currentVehicle = null;
    bus.emit('vehicleExited', { vehicle: car });
    expect(state.radio.notificationTimer).toBe(0);
    expect(state.radio.wheelOpen).toBe(false);

    radioSys.dispose();
    input.dispose();
  });

  it('avança automaticamente para a próxima faixa da estação e propaga estado no HudSnapshot', () => {
    const { ctx, bus, state } = createRadioTestCtx();
    const input = new InputManager();
    const radioSys = new RadioSystem(input);

    let snapshot: HudSnapshot | null = null;
    const bridge = new HudBridge(
      (s) => {
        snapshot = s;
      },
      {
        getWantedSnapshot: () => ({ stars: 0, evadingProgress: 0, bustProgress: 0, bustedFlash: false }),
        getMissionSnapshot: () => ({ id: 'none', step: 0, title: '', objective: '', targetPos: null, completedMissions: [] }),
        hasNearbyVehicle: () => false,
        getTimeLabel: () => 'Noite',
        getFormattedClock: () => '21:00',
        isWeekend: () => false,
        getQualityPreset: () => 'medium',
        getInjuredTotalCount: () => 0,
        isGamepadConnected: () => false,
        isPointerLocked: () => false,
      }
    );

    input.init(ctx);
    radioSys.init(ctx);
    bridge.init(ctx);

    const trackChanged = vi.fn();
    bus.on('radioTrackChanged', trackChanged);

    const car = makeMockVehicle();
    state.currentVehicle = car;
    bus.emit('vehicleEntered', { vehicle: car, wasOccupiedByNpc: false });

    const solara = RADIO_STATIONS.find((s) => s.id === 'solara_fm')!;
    const firstDuration = solara.tracks[0].durationSec;
    expect(state.radio.trackTitle).toBe(solara.tracks[0].title);

    // Avança o tempo além da duração da primeira faixa
    radioSys.update(firstDuration + 0.5);
    expect(state.radio.trackTitle).toBe(solara.tracks[1].title);
    expect(state.radio.trackArtist).toBe(solara.tracks[1].artist);
    expect(trackChanged).toHaveBeenCalledTimes(1);

    bridge.emitNow();
    expect(snapshot).not.toBeNull();
    expect(snapshot!.inVehicle).toBe(true);
    expect(snapshot!.radio.stationId).toBe('solara_fm');
    expect(snapshot!.radio.trackTitle).toBe(solara.tracks[1].title);

    bridge.dispose();
    radioSys.dispose();
    input.dispose();
  });

  it('amostra espectro de frequências em tempo real via AnalyserNode somente quando a rádio está tocando', () => {
    createMockWebAudioHarness('running');

    const audio = new ProceduralAudio();
    const bars = new Array<number>(8).fill(0);

    // Antes de desbloquear/iniciar: retorna false e zera barras
    expect(audio.sampleRadioSpectrum(bars)).toBe(false);
    expect(bars.every((v) => v === 0)).toBe(true);

    audio.unlock();
    audio.updateRadio(0.016, true, 'solara_fm');

    // Rádio ativa: lê bins de frequência normalizados entre 0 e 1
    expect(audio.sampleRadioSpectrum(bars)).toBe(true);
    expect(bars.some((v) => v > 0.3)).toBe(true);

    // Mutado ou desligado: zera barras imediatamente
    audio.setMuted(true);
    expect(audio.sampleRadioSpectrum(bars)).toBe(false);
    expect(bars.every((v) => v === 0)).toBe(true);

    audio.setMuted(false);
    audio.updateRadio(0.016, false, 'solara_fm');
    expect(audio.sampleRadioSpectrum(bars)).toBe(false);

    audio.dispose();
  });

  it('desbloqueia AudioContext suspenso imediatamente na criação e inicia áudio do rádio assim que fica running', async () => {
    const harness = createMockWebAudioHarness('suspended');
    const audio = new ProceduralAudio();
    audio.setVolume(0.8);

    // Simula unlock() inicial enquanto o navegador cria AudioContext em estado 'suspended'
    audio.unlock();
    const ctx = harness.getCtx();
    expect(ctx.resume).toHaveBeenCalledTimes(1);

    // Antes da Promise de resume() resolver, updateRadio não deve travar a estação ativa nem marcar playing=true
    ctx.state = 'suspended';
    audio.updateRadio(0.016, true, 'solara_fm');
    expect(audio.getRadioAudioDebugState().playing).toBe(false);
    expect(audio.getRadioAudioDebugState().activeStation).toBe('off');

    // Após resume() resolver ('running'), o próximo frame deve ativar o barramento e agendar notas
    await ctx.resume();
    expect(ctx.state).toBe('running');
    const oscBefore = harness.oscNodes.length;
    audio.updateRadio(0.016, true, 'solara_fm');

    const dbg = audio.getRadioAudioDebugState();
    expect(dbg.initialized).toBe(true);
    expect(dbg.contextState).toBe('running');
    expect(dbg.playing).toBe(true);
    expect(dbg.activeStation).toBe('solara_fm');
    expect(harness.oscNodes.length).toBeGreaterThan(oscBefore);

    audio.dispose();
  });

  it('roteia cadeia de masterização (EQ + Compressor + FX) direto para masterGain com AnalyserNode em paralelo', () => {
    const harness = createMockWebAudioHarness('running');
    const audio = new ProceduralAudio();
    audio.unlock();

    // gainNodes criados no unlock(): [0]=masterGain, [1]=engineGain, [2]=sirenGain, [3]=rainGain, [4]=radioMixGain
    const masterGain = harness.gainNodes[0];
    const engineGain = harness.gainNodes[1];
    const radioMixGain = harness.gainNodes[4];
    const compressor = harness.getCtx().compressorNodes[0];

    expect(masterGain.connect).toHaveBeenCalledWith(harness.getCtx().destination);
    expect(compressor).toBeDefined();
    expect(compressor.connect).toHaveBeenCalledWith(masterGain);
    expect(compressor.connect).toHaveBeenCalledWith(harness.mockAnalyser);
    expect(harness.mockAnalyser.connect).not.toHaveBeenCalled();

    // Motor ligado + rádio tocando: ganho do rádio (0.9) deve ser muito superior ao drone do motor (0.05..0.10)
    const gainCountBeforeRadio = harness.gainNodes.length;
    audio.updateContinuous(0.016, true, 0.2, false, 0);
    audio.updateRadio(0.016, true, 'baia_beats', 0);

    const lastEngineCall = engineGain.gain.setTargetAtTime.mock.calls.at(-1);
    expect(lastEngineCall?.[0]).toBeCloseTo(0.06, 2);

    // O primeiro gainNode criado durante updateRadio é o novo barramento radioGain vindo de rotateRadioBus()
    const activeRadioGain = harness.gainNodes[gainCountBeforeRadio]!;
    expect(activeRadioGain.connect).toHaveBeenCalledWith(radioMixGain);
    expect(activeRadioGain.gain.setTargetAtTime).toHaveBeenCalledWith(0.9, expect.any(Number), 0.05);

    const dbg = audio.getRadioAudioDebugState();
    expect(dbg.hasMasteringChain).toBe(true);
    expect(dbg.hasFxBus).toBe(true);

    audio.dispose();
  });

  it('agenda notas audíveis em todas as 5 estações ativas e limpa corretamente ao trocar de estação ou desligar', () => {
    const harness = createMockWebAudioHarness('running');
    const audio = new ProceduralAudio();
    audio.unlock();

    const playableStations: RadioStationId[] = [
      'solara_fm',
      'baia_beats',
      'litoral_rock',
      'costa_chill',
      'noticias_bs',
    ];

    for (const stationId of playableStations) {
      const oscBefore = harness.oscNodes.length;
      const gainBefore = harness.gainNodes.length;

      audio.playRadioTune();
      audio.updateRadio(0.016, true, stationId);

      // Cada estação deve criar novo barramento (rotateRadioBus uma única vez) e iniciar osciladores reais
      expect(harness.gainNodes.length).toBeGreaterThan(gainBefore);
      const createdOscs = harness.oscNodes.slice(oscBefore);
      expect(createdOscs.length).toBeGreaterThan(0);
      for (const osc of createdOscs) {
        expect(osc.start).toHaveBeenCalledTimes(1);
        expect(osc.stop).toHaveBeenCalledTimes(1);
      }

      // Verifica que os envelopes das vozes do rádio usam ganho audível (>= 0.13)
      const voiceGains = harness.gainNodes.slice(gainBefore + 1);
      const maxPeak = Math.max(
        0,
        ...voiceGains.flatMap((g) =>
          g.gain.linearRampToValueAtTime.mock.calls.map((c) => Number(c[0]) || 0)
        )
      );
      expect(maxPeak).toBeGreaterThanOrEqual(0.13);
      expect(audio.getRadioAudioDebugState().playing).toBe(true);

      harness.getCtx().currentTime += 0.35;
    }

    // Desligar ('off'), zerar volume ou sair do veículo (active=false) deve zerar o rádio sem erros
    audio.updateRadio(0.016, true, 'off');
    expect(audio.getRadioAudioDebugState().playing).toBe(false);

    audio.updateRadio(0.016, true, 'solara_fm');
    expect(audio.getRadioAudioDebugState().playing).toBe(true);

    audio.setVolume(0);
    audio.updateRadio(0.016, true, 'solara_fm');
    expect(audio.getRadioAudioDebugState().playing).toBe(false);

    audio.setVolume(1);
    audio.updateRadio(0.016, true, 'solara_fm');
    expect(audio.getRadioAudioDebugState().playing).toBe(true);

    audio.updateRadio(0.016, false, 'solara_fm');
    expect(audio.getRadioAudioDebugState().playing).toBe(false);

    audio.dispose();
  });

  it('desbloqueia áudio ao entrar e sair de veículos via VehicleSystem', () => {
    const { ctx, state, audioUnlock } = createRadioTestCtx();
    const input = new InputManager();
    const car = makeMockVehicle();
    car.driver = 'none';
    car.x = state.playerPos.x + 1;
    car.z = state.playerPos.z + 1;
    ctx.vehicles.push(car);

    const vehicleSys = new VehicleSystem(input, new THREE.CanvasTexture({} as HTMLCanvasElement));
    vehicleSys.init(ctx);

    // Entra no veículo mais próximo
    vehicleSys.toggleVehicle();
    expect(state.currentVehicle).toBe(car);
    expect(audioUnlock).toHaveBeenCalledTimes(1);

    // Sai do veículo
    vehicleSys.toggleVehicle();
    expect(state.currentVehicle).toBeNull();
    expect(audioUnlock).toHaveBeenCalledTimes(2);

    vehicleSys.dispose();
  });

  it('possui 15 composições distintas (3 músicas por estação) e troca de arranjo ao pular faixa', () => {
    const harness = createMockWebAudioHarness('running');
    const audio = new ProceduralAudio();
    audio.unlock();

    const playableStations: RadioStationId[] = [
      'solara_fm',
      'baia_beats',
      'litoral_rock',
      'costa_chill',
      'noticias_bs',
    ];

    const seenIds = new Set<string>();
    for (const stationId of playableStations) {
      const station = RADIO_STATIONS.find((s) => s.id === stationId)!;
      expect(station.tracks.length).toBe(3);

      const bpms = new Set<number>();
      const chordSignatures = new Set<string>();

      for (let trackIdx = 0; trackIdx < station.tracks.length; trackIdx++) {
        const comp = getRadioTrackComposition(stationId, trackIdx);
        expect(comp).not.toBeNull();
        expect(seenIds.has(comp!.id)).toBe(false);
        seenIds.add(comp!.id);
        bpms.add(comp!.bpm);
        chordSignatures.add(JSON.stringify(comp!.chords));

        const oscBefore = harness.oscNodes.length;
        audio.updateRadio(0.016, true, stationId, trackIdx);
        expect(audio.getRadioAudioDebugState().activeTrackIndex).toBe(trackIdx);
        expect(harness.oscNodes.length).toBeGreaterThan(oscBefore);
        harness.getCtx().currentTime += 0.35;
      }

      // Garante que as 3 músicas dentro de cada estação têm progressões e andamentos distintos
      expect(bpms.size).toBe(3);
      expect(chordSignatures.size).toBe(3);
    }

    expect(seenIds.size).toBe(15);
    audio.dispose();

    // Testa também nextTrack() no RadioSystem atualizando snapshot e eventos
    const { ctx, bus, state } = createRadioTestCtx();
    const input = new InputManager();
    const radioSys = new RadioSystem(input);
    input.init(ctx);
    radioSys.init(ctx);

    const car = makeMockVehicle();
    state.currentVehicle = car;
    bus.emit('vehicleEntered', { vehicle: car, wasOccupiedByNpc: false });

    const trackChanged = vi.fn();
    bus.on('radioTrackChanged', trackChanged);

    expect(radioSys.getSnapshot().trackIndex).toBe(0);
    expect(radioSys.nextTrack()).toBe(true);
    expect(radioSys.getSnapshot().trackIndex).toBe(1);
    expect(radioSys.getSnapshot().trackTitle).toBe('Noite na Av. Atlântica');
    expect(trackChanged).toHaveBeenCalledTimes(1);

    expect(radioSys.nextTrack()).toBe(true);
    expect(radioSys.getSnapshot().trackIndex).toBe(2);
    expect(radioSys.nextTrack()).toBe(true);
    expect(radioSys.getSnapshot().trackIndex).toBe(0);

    radioSys.dispose();
    input.dispose();
  });
});
