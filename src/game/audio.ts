import { getRadioTrackComposition, midiToHz, RadioTrackComposition } from './RadioMusicEngine';
import { RadioStationId } from './types';

// Motor de áudio procedural 100% Web Audio API (sem arquivos MP3 externos)

export class ProceduralAudio {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private engineOsc: OscillatorNode | null = null;
  private engineGain: GainNode | null = null;
  private sirenOsc: OscillatorNode | null = null;
  private sirenGain: GainNode | null = null;
  private rainGain: GainNode | null = null;
  private radioGain: GainNode | null = null;
  private radioMixGain: GainNode | null = null;
  private radioFxGain: GainNode | null = null;
  private radioMasterOut: AudioNode | null = null;
  private radioOverdriveCurve: Float32Array<ArrayBuffer> | null = null;
  private radioAnalyser: AnalyserNode | null = null;
  private radioFreqData: Uint8Array<ArrayBuffer> | null = null;
  private radioHatBuffer: AudioBuffer | null = null;
  private muted = false;
  private volume = 1.0;
  private initialized = false;
  private sirenPhase = 0;
  private nextRadioNoteTime = 0;
  private radioStep = 0;
  private activeRadioStation: RadioStationId = 'off';
  private activeRadioTrackIndex = 0;
  private radioPlaying = false;

  public isMuted(): boolean {
    return this.muted;
  }

  public getVolume(): number {
    return this.volume;
  }

  public setVolume(vol: number): void {
    this.volume = Math.max(0, Math.min(1, vol));
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(
        this.muted ? 0 : 0.36 * this.volume,
        this.ctx.currentTime,
        0.05
      );
    }
  }

  public setMuted(mute: boolean): void {
    this.muted = mute;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(
        mute ? 0 : 0.36 * this.volume,
        this.ctx.currentTime,
        0.05
      );
    }
  }

  public unlock(): void {
    if (this.initialized) {
      if (this.ctx && this.ctx.state !== 'running' && this.ctx.state !== 'closed') {
        void this.ctx.resume();
      }
      return;
    }

    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;

    this.ctx = new AudioCtx();
    if (this.ctx.state !== 'running' && this.ctx.state !== 'closed') {
      void this.ctx.resume();
    }
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = this.muted ? 0 : 0.36 * this.volume;
    this.masterGain.connect(this.ctx.destination);

    // Oscilador contínuo do motor do veículo
    this.engineOsc = this.ctx.createOscillator();
    this.engineOsc.type = 'sawtooth';
    this.engineOsc.frequency.value = 52;
    const engineFilter = this.ctx.createBiquadFilter();
    engineFilter.type = 'lowpass';
    engineFilter.frequency.value = 240;
    this.engineGain = this.ctx.createGain();
    this.engineGain.gain.value = 0;

    this.engineOsc.connect(engineFilter);
    engineFilter.connect(this.engineGain);
    this.engineGain.connect(this.masterGain);
    this.engineOsc.start();

    // Oscilador da sirene policial
    this.sirenOsc = this.ctx.createOscillator();
    this.sirenOsc.type = 'triangle';
    this.sirenOsc.frequency.value = 620;
    this.sirenGain = this.ctx.createGain();
    this.sirenGain.gain.value = 0;
    this.sirenOsc.connect(this.sirenGain);
    this.sirenGain.connect(this.masterGain);
    this.sirenOsc.start();

    // Ruído procedural de chuva (buffer de 2s filtrado em passa-baixa/banda)
    const rainLen = this.ctx.sampleRate * 2;
    const rainBuf = this.ctx.createBuffer(1, rainLen, this.ctx.sampleRate);
    const data = rainBuf.getChannelData(0);
    for (let i = 0; i < rainLen; i++) {
      data[i] = (Math.random() * 2 - 1) * 0.55;
    }
    const rainSource = this.ctx.createBufferSource();
    rainSource.buffer = rainBuf;
    rainSource.loop = true;
    const rainFilter = this.ctx.createBiquadFilter();
    rainFilter.type = 'bandpass';
    rainFilter.frequency.value = 1150;
    rainFilter.Q.value = 0.7;
    this.rainGain = this.ctx.createGain();
    this.rainGain.gain.value = 0;
    rainSource.connect(rainFilter);
    rainFilter.connect(this.rainGain);
    this.rainGain.connect(this.masterGain);
    rainSource.start();

    // Cadeia de masterização dedicada do rádio (EQ musical + compressor de transmissão FM + ambiência)
    // Ligada direto ao masterGain; AnalyserNode fica em paralelo para o visualizador.
    this.radioMixGain = this.ctx.createGain();
    this.radioMixGain.gain.value = 1.0;

    let radioPostNode: AudioNode = this.radioMixGain;
    if (typeof this.ctx.createBiquadFilter === 'function') {
      const lowWarmth = this.ctx.createBiquadFilter();
      lowWarmth.type = 'lowshelf';
      lowWarmth.frequency.value = 105;
      lowWarmth.gain.value = 3.2;

      const highAir = this.ctx.createBiquadFilter();
      highAir.type = 'highshelf';
      highAir.frequency.value = 5600;
      highAir.gain.value = 2.0;

      radioPostNode.connect(lowWarmth);
      lowWarmth.connect(highAir);
      radioPostNode = highAir;
    }

    if (typeof this.ctx.createDynamicsCompressor === 'function') {
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -16;
      comp.knee.value = 16;
      comp.ratio.value = 4;
      comp.attack.value = 0.008;
      comp.release.value = 0.18;
      radioPostNode.connect(comp);
      radioPostNode = comp;
    }

    radioPostNode.connect(this.masterGain);
    this.radioMasterOut = radioPostNode;

    // Barramento paralelo de ambiência / eco estéreo curto para vocais/melodias/teclados
    if (typeof this.ctx.createDelay === 'function') {
      this.radioFxGain = this.ctx.createGain();
      this.radioFxGain.gain.value = 0.24;
      const delay = this.ctx.createDelay(0.6);
      delay.delayTime.value = 0.21;
      const fxTone = this.ctx.createBiquadFilter();
      fxTone.type = 'lowpass';
      fxTone.frequency.value = 2400;
      const fxFeedback = this.ctx.createGain();
      fxFeedback.gain.value = 0.26;

      this.radioFxGain.connect(delay);
      delay.connect(fxTone);
      fxTone.connect(this.radioMixGain);
      fxTone.connect(fxFeedback);
      fxFeedback.connect(delay);
    }

    if (typeof this.ctx.createAnalyser === 'function') {
      this.radioAnalyser = this.ctx.createAnalyser();
      this.radioAnalyser.fftSize = 64;
      this.radioAnalyser.smoothingTimeConstant = 0.72;
      this.radioAnalyser.minDecibels = -85;
      this.radioAnalyser.maxDecibels = -16;
      this.radioFreqData = new Uint8Array(this.radioAnalyser.frequencyBinCount);
      radioPostNode.connect(this.radioAnalyser);
    }

    // Curva de saturação quente para guitarra rock / synth analógico
    const curveLen = 256;
    const curve = new Float32Array(curveLen);
    for (let i = 0; i < curveLen; i++) {
      const x = (i * 2) / curveLen - 1;
      curve[i] = ((3 + 12) * x * 20 * (Math.PI / 180)) / (Math.PI + 12 * Math.abs(x));
    }
    this.radioOverdriveCurve = curve;

    // Barramento dedicado para o rádio veicular procedural
    this.radioGain = this.ctx.createGain();
    this.radioGain.gain.value = 0;
    this.radioGain.connect(this.radioMixGain);

    // Buffer curto de ruído branco para percussão do rádio (chimbal / caixa / shaker)
    const hatLen = Math.max(128, Math.floor(this.ctx.sampleRate * 0.14));
    this.radioHatBuffer = this.ctx.createBuffer(1, hatLen, this.ctx.sampleRate);
    const hatCh = this.radioHatBuffer.getChannelData(0);
    for (let i = 0; i < hatLen; i++) {
      hatCh[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / hatLen, 1.85);
    }

    this.initialized = true;
  }

  public updateContinuous(
    dt: number,
    inVehicle: boolean,
    speedRatio: number,
    sirenActive: boolean,
    rainIntensity = 0
  ): void {
    if (!this.initialized || !this.ctx || !this.engineOsc || !this.engineGain || !this.sirenOsc || !this.sirenGain) {
      return;
    }
    const now = this.ctx.currentTime;

    if (inVehicle && !this.muted) {
      const targetFreq = 48 + Math.abs(speedRatio) * 115;
      this.engineOsc.frequency.setTargetAtTime(targetFreq, now, 0.06);
      this.engineGain.gain.setTargetAtTime(0.05 + Math.abs(speedRatio) * 0.05, now, 0.08);
    } else {
      this.engineGain.gain.setTargetAtTime(0, now, 0.08);
    }

    if (sirenActive && !this.muted) {
      this.sirenPhase += dt * 4.2;
      const freq = 640 + Math.sin(this.sirenPhase) * 230;
      this.sirenOsc.frequency.setTargetAtTime(freq, now, 0.03);
      this.sirenGain.gain.setTargetAtTime(0.065, now, 0.08);
    } else {
      this.sirenGain.gain.setTargetAtTime(0, now, 0.08);
    }

    if (this.rainGain) {
      const targetRain = !this.muted && rainIntensity > 0.01 ? 0.14 * rainIntensity : 0;
      this.rainGain.gain.setTargetAtTime(targetRain, now, 0.25);
    }
  }

  public updateRadio(_dt: number, active: boolean, stationId: RadioStationId, trackIndex = 0): void {
    if (!this.initialized || !this.ctx || !this.radioGain) return;
    const now = this.ctx.currentTime;

    if (!active || this.muted || this.volume <= 0.001 || stationId === 'off') {
      this.radioGain.gain.setTargetAtTime(0, now, 0.04);
      this.nextRadioNoteTime = 0;
      this.radioStep = 0;
      this.activeRadioStation = stationId;
      this.activeRadioTrackIndex = trackIndex;
      this.radioPlaying = false;
      return;
    }

    if (this.ctx.state !== 'running') {
      this.radioPlaying = false;
      return;
    }

    const comp = getRadioTrackComposition(stationId, trackIndex);
    if (!comp) {
      this.radioPlaying = false;
      return;
    }

    this.radioPlaying = true;

    if (this.activeRadioStation !== stationId || this.activeRadioTrackIndex !== trackIndex) {
      this.activeRadioStation = stationId;
      this.activeRadioTrackIndex = trackIndex;
      this.radioStep = 0;
      this.nextRadioNoteTime = now + 0.04;
      this.rotateRadioBus(now);
    }

    this.radioGain.gain.setTargetAtTime(0.9, now, 0.05);

    // Passo em semicolcheia (1/16 de compasso) baseado no BPM exato da faixa atual
    const stepDur = 60 / comp.bpm / 4;

    // Lookahead scheduler ancorado ao relógio do AudioContext (sem jitter de FPS)
    if (this.nextRadioNoteTime === 0 || this.nextRadioNoteTime < now - 0.05 || this.nextRadioNoteTime > now + 0.5) {
      this.nextRadioNoteTime = now + 0.03;
    }

    const lookaheadEnd = now + 0.14;
    let guard = 0;
    while (this.nextRadioNoteTime < lookaheadEnd && guard < 6) {
      const swingOffset = this.radioStep % 2 === 1 ? comp.swing * stepDur : 0;
      this.scheduleRadioStep(this.nextRadioNoteTime + swingOffset, this.radioStep, comp, stepDur);
      this.radioStep = (this.radioStep + 1) % 64;
      this.nextRadioNoteTime += stepDur;
      guard++;
    }
  }

  public getRadioAudioDebugState() {
    return {
      initialized: this.initialized,
      playing: this.radioPlaying,
      activeStation: this.activeRadioStation,
      activeTrackIndex: this.activeRadioTrackIndex,
      contextState: this.ctx?.state ?? 'uninitialized',
      muted: this.muted,
      volume: this.volume,
      hasMasteringChain: Boolean(this.radioMasterOut),
      hasFxBus: Boolean(this.radioFxGain),
    };
  }

  public sampleRadioSpectrum(out: number[]): boolean {
    const count = out.length;
    if (
      !this.initialized ||
      !this.ctx ||
      !this.radioAnalyser ||
      !this.radioFreqData ||
      !this.radioPlaying ||
      this.muted ||
      this.volume <= 0.001 ||
      this.ctx.state !== 'running'
    ) {
      for (let i = 0; i < count; i++) out[i] = 0;
      return false;
    }

    this.radioAnalyser.getByteFrequencyData(this.radioFreqData);
    const binCount = this.radioFreqData.length;
    // Mapeia os primeiros ~20 bins (graves até agudos musicais) para as barras do visualizador
    const usableBins = Math.min(binCount, Math.max(count, 20));
    let hasEnergy = false;
    for (let i = 0; i < count; i++) {
      const startBin = Math.floor((i / count) * usableBins);
      const endBin = Math.max(startBin + 1, Math.floor(((i + 1) / count) * usableBins));
      let sum = 0;
      for (let b = startBin; b < endBin && b < binCount; b++) {
        sum += this.radioFreqData[b];
      }
      const norm = Math.min(1, sum / ((endBin - startBin) * 255));
      if (norm > 0.02) hasEnergy = true;
      out[i] = norm;
    }
    return hasEnergy || this.radioPlaying;
  }

  private rotateRadioBus(now: number): void {
    if (!this.ctx || !this.masterGain) return;
    const prev = this.radioGain;
    if (prev) {
      try {
        prev.gain.cancelScheduledValues(now);
        prev.gain.setValueAtTime(prev.gain.value, now);
        prev.gain.linearRampToValueAtTime(0, now + 0.035);
        setTimeout(() => {
          try {
            prev.disconnect();
          } catch {
            // Ignora desconexão redundante
          }
        }, 60);
      } catch {
        // Ignora erro ao encerrar barramento antigo
      }
    }
    const nextBus = this.ctx.createGain();
    nextBus.gain.setValueAtTime(0, now);
    nextBus.connect(this.radioMixGain ?? this.masterGain);
    this.radioGain = nextBus;
  }

  private scheduleRadioStep(
    time: number,
    step: number,
    comp: RadioTrackComposition,
    stepDur: number
  ): void {
    const bar = Math.floor(step / 16) % 4;
    const stepInBar = step % 16;
    const chord = comp.chords[bar];
    const rootMidi = chord[0];

    // 1) Base harmônica / Acordes no início de cada compasso (ou levada rítmica)
    if (stepInBar === 0) {
      if (comp.style === 'synthwave') {
        this.playRadioPadChordAt(time, chord, stepDur * 14.5, 0.14, 1550, true);
      } else if (comp.style === 'electro_funk') {
        this.playRadioPadChordAt(time, chord, stepDur * 6.5, 0.14, 1750, true);
      } else if (comp.style === 'rock') {
        this.playRadioGuitarChordAt(time, chord, stepDur * 7.5, 0.18);
      } else if (comp.style === 'bossa_lofi') {
        for (const midi of chord) {
          this.playRadioFmKeysAt(time, midiToHz(midi), stepDur * 11, 0.13, 2.0, 2.2, true);
        }
      } else {
        this.playRadioPadChordAt(time, chord.slice(0, 3), stepDur * 13, 0.11, 1200, true);
      }
    } else if (comp.style === 'rock' && (stepInBar === 6 || stepInBar === 12)) {
      this.playRadioGuitarChordAt(time, chord, stepDur * 3.2, 0.14);
    } else if (comp.style === 'electro_funk' && stepInBar === 10) {
      this.playRadioPadChordAt(time, chord, stepDur * 3.0, 0.12, 2100, true);
    }

    // 2) Baixo com sub + corpo harmônico
    const bassOffset = comp.bassPattern[stepInBar];
    if (bassOffset !== null && bassOffset !== undefined) {
      const bassMidi = Math.max(28, rootMidi - 12 + bassOffset);
      const bassFreq = midiToHz(bassMidi);
      const bassDur =
        comp.style === 'bossa_lofi'
          ? stepDur * 2.4
          : comp.style === 'news'
          ? stepDur * 2.0
          : stepDur * 1.45;
      const bassVol = comp.style === 'news' ? 0.24 : comp.style === 'bossa_lofi' ? 0.3 : 0.36;
      this.playRadioBassAt(time, bassFreq, bassDur, bassVol, comp.style);
    }

    // 3) Arpejo / Piano FM rítmico
    const arpIdx = comp.arpPattern[stepInBar];
    if (arpIdx !== null && arpIdx !== undefined) {
      const arpMidi = chord[arpIdx % chord.length] + (comp.style === 'synthwave' ? 12 : 0);
      const arpFreq = midiToHz(arpMidi);
      if (comp.style === 'bossa_lofi') {
        this.playRadioFmKeysAt(time, arpFreq, stepDur * 2.8, 0.14, 2.0, 1.8, true);
      } else if (comp.style === 'news') {
        this.playRadioFmKeysAt(time, arpFreq, stepDur * 1.5, 0.13, 3.0, 1.5, true);
      } else if (comp.style === 'rock') {
        this.playRadioGuitarLeadAt(time, arpFreq, stepDur * 1.2, 0.15);
      } else {
        this.playRadioLeadAt(time, arpFreq, stepDur * 1.15, 'triangle', 0.17, 2400, true);
      }
    }

    // 4) Melodia principal (hook de 4 compassos)
    const leadMidi = comp.leadMelody[step % comp.leadMelody.length];
    if (leadMidi !== null && leadMidi !== undefined) {
      const leadFreq = midiToHz(leadMidi);
      if (comp.style === 'synthwave') {
        this.playRadioLeadAt(time, leadFreq, stepDur * 2.5, 'sawtooth', 0.23, 2850, true);
      } else if (comp.style === 'electro_funk') {
        this.playRadioLeadAt(time, leadFreq, stepDur * 2.1, 'square', 0.2, 2600, true);
      } else if (comp.style === 'rock') {
        this.playRadioGuitarLeadAt(time, leadFreq, stepDur * 1.75, 0.24);
      } else if (comp.style === 'bossa_lofi') {
        this.playRadioFmKeysAt(time, leadFreq, stepDur * 2.9, 0.21, 2.0, 2.4, true);
      } else {
        this.playRadioFmKeysAt(time, leadFreq, stepDur * 2.2, 0.18, 2.0, 2.0, true);
      }
    }

    // 5) Bateria & Percussão com viradas no final do 4º compasso
    const isTurnaroundFill = bar === 3 && stepInBar >= 12;
    if (comp.drums.kick[stepInBar]) {
      this.playRadioPercAt(time, 'kick', comp.style === 'news' ? 0.26 : 0.44);
    }
    if (comp.drums.snare[stepInBar] && !isTurnaroundFill) {
      this.playRadioPercAt(time, 'snare', comp.style === 'bossa_lofi' ? 0.2 : 0.3);
    }
    if (comp.drums.openHat[stepInBar]) {
      this.playRadioPercAt(time, 'openHat', 0.17);
    } else if (comp.drums.hat[stepInBar]) {
      const hatAcc = stepInBar % 4 === 0 ? 0.15 : 0.1;
      this.playRadioPercAt(time, 'hat', hatAcc);
    }
    if (comp.drums.perc[stepInBar]) {
      this.playRadioPercAt(time, comp.style === 'bossa_lofi' || comp.style === 'news' ? 'clave' : 'rim', 0.16);
    }
    if (isTurnaroundFill && (stepInBar === 12 || stepInBar === 14 || stepInBar === 15)) {
      if (comp.style === 'rock' || comp.style === 'synthwave' || comp.style === 'electro_funk') {
        this.playRadioPercAt(time, 'tom', 0.26, stepInBar === 12 ? 195 : stepInBar === 14 ? 150 : 118);
      }
    }
  }

  private playRadioPadChordAt(
    startTime: number,
    chord: readonly number[],
    duration: number,
    volume: number,
    filterHz: number,
    withFx = false
  ): void {
    if (!this.ctx || !this.radioGain || this.muted) return;
    const perNoteVol = volume / Math.max(1, Math.sqrt(chord.length));
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(Math.max(400, filterHz * 0.45), startTime);
    filter.frequency.linearRampToValueAtTime(filterHz, startTime + Math.min(0.28, duration * 0.35));
    filter.frequency.exponentialRampToValueAtTime(Math.max(360, filterHz * 0.55), startTime + duration);

    const gain = this.ctx.createGain();
    const attack = Math.min(0.09, duration * 0.25);
    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.linearRampToValueAtTime(perNoteVol, startTime + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

    filter.connect(gain);
    gain.connect(this.radioGain);
    if (withFx && this.radioFxGain) {
      gain.connect(this.radioFxGain);
    }

    const oscs: OscillatorNode[] = [];
    for (const midi of chord) {
      const f = midiToHz(midi);
      for (const detuneMul of [0.9965, 1.0035]) {
        const osc = this.ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(f * detuneMul, startTime);
        osc.connect(filter);
        osc.start(startTime);
        osc.stop(startTime + duration + 0.02);
        oscs.push(osc);
      }
    }
    const lastOsc = oscs[oscs.length - 1];
    if (lastOsc) {
      lastOsc.onended = () => {
        for (const o of oscs) o.disconnect();
        filter.disconnect();
        gain.disconnect();
      };
    }
  }

  private playRadioBassAt(
    startTime: number,
    freq: number,
    duration: number,
    volume: number,
    style: RadioTrackComposition['style']
  ): void {
    if (!this.ctx || !this.radioGain || this.muted) return;
    const subOsc = this.ctx.createOscillator();
    const bodyOsc = this.ctx.createOscillator();
    const filter = this.ctx.createBiquadFilter();
    const gain = this.ctx.createGain();

    subOsc.type = 'sine';
    subOsc.frequency.setValueAtTime(freq, startTime);
    bodyOsc.type = style === 'bossa_lofi' || style === 'news' ? 'triangle' : 'sawtooth';
    bodyOsc.frequency.setValueAtTime(freq, startTime);

    filter.type = 'lowpass';
    const peakCutoff = style === 'bossa_lofi' ? 680 : style === 'news' ? 760 : 1480;
    filter.frequency.setValueAtTime(peakCutoff, startTime);
    filter.frequency.exponentialRampToValueAtTime(240, startTime + Math.min(0.16, duration));

    const attack = Math.min(0.014, duration * 0.15);
    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.linearRampToValueAtTime(volume, startTime + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

    subOsc.connect(filter);
    bodyOsc.connect(filter);
    filter.connect(gain);
    gain.connect(this.radioGain);

    subOsc.onended = () => {
      subOsc.disconnect();
      bodyOsc.disconnect();
      filter.disconnect();
      gain.disconnect();
    };
    subOsc.start(startTime);
    bodyOsc.start(startTime);
    subOsc.stop(startTime + duration + 0.015);
    bodyOsc.stop(startTime + duration + 0.015);
  }

  private playRadioFmKeysAt(
    startTime: number,
    freq: number,
    duration: number,
    volume: number,
    modRatio: number,
    modIndex: number,
    withFx = false
  ): void {
    if (!this.ctx || !this.radioGain || this.muted) return;
    const carrier = this.ctx.createOscillator();
    const mod = this.ctx.createOscillator();
    const modGain = this.ctx.createGain();
    const gain = this.ctx.createGain();

    carrier.type = 'sine';
    carrier.frequency.setValueAtTime(freq, startTime);
    mod.type = 'sine';
    mod.frequency.setValueAtTime(freq * modRatio, startTime);

    const modDepth = freq * modIndex;
    modGain.gain.setValueAtTime(Math.max(1, modDepth), startTime);
    modGain.gain.exponentialRampToValueAtTime(Math.max(1, modDepth * 0.08), startTime + Math.min(0.32, duration));

    const attack = Math.min(0.012, duration * 0.15);
    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.linearRampToValueAtTime(volume, startTime + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

    mod.connect(modGain);
    modGain.connect(carrier.frequency);
    carrier.connect(gain);
    gain.connect(this.radioGain);
    if (withFx && this.radioFxGain) {
      gain.connect(this.radioFxGain);
    }

    carrier.onended = () => {
      mod.disconnect();
      modGain.disconnect();
      carrier.disconnect();
      gain.disconnect();
    };
    mod.start(startTime);
    carrier.start(startTime);
    mod.stop(startTime + duration + 0.015);
    carrier.stop(startTime + duration + 0.015);
  }

  private playRadioLeadAt(
    startTime: number,
    freq: number,
    duration: number,
    type: OscillatorType,
    volume: number,
    filterHz: number,
    withFx = false
  ): void {
    if (!this.ctx || !this.radioGain || this.muted) return;
    const oscA = this.ctx.createOscillator();
    const oscB = this.ctx.createOscillator();
    const filter = this.ctx.createBiquadFilter();
    const gain = this.ctx.createGain();

    oscA.type = type;
    oscB.type = type === 'square' ? 'sawtooth' : 'triangle';
    oscA.frequency.setValueAtTime(freq * 0.9965, startTime);
    oscB.frequency.setValueAtTime(freq * 1.0035, startTime);

    filter.type = 'lowpass';
    filter.Q.value = 1.6;
    filter.frequency.setValueAtTime(filterHz, startTime);
    filter.frequency.exponentialRampToValueAtTime(Math.max(420, filterHz * 0.42), startTime + duration);

    const attack = Math.min(0.018, duration * 0.2);
    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.linearRampToValueAtTime(volume, startTime + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

    oscA.connect(filter);
    oscB.connect(filter);
    filter.connect(gain);
    gain.connect(this.radioGain);
    if (withFx && this.radioFxGain) {
      gain.connect(this.radioFxGain);
    }

    oscA.onended = () => {
      oscA.disconnect();
      oscB.disconnect();
      filter.disconnect();
      gain.disconnect();
    };
    oscA.start(startTime);
    oscB.start(startTime);
    oscA.stop(startTime + duration + 0.015);
    oscB.stop(startTime + duration + 0.015);
  }

  private playRadioGuitarChordAt(
    startTime: number,
    chord: readonly number[],
    duration: number,
    volume: number
  ): void {
    if (!this.ctx || !this.radioGain || this.muted) return;
    const cabFilter = this.ctx.createBiquadFilter();
    cabFilter.type = 'lowpass';
    cabFilter.frequency.setValueAtTime(2200, startTime);
    cabFilter.frequency.exponentialRampToValueAtTime(850, startTime + duration);

    const gain = this.ctx.createGain();
    const perNoteVol = volume / Math.max(1, chord.length * 0.7);
    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.linearRampToValueAtTime(perNoteVol, startTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

    if (this.radioOverdriveCurve && typeof this.ctx.createWaveShaper === 'function') {
      const shaper = this.ctx.createWaveShaper();
      shaper.curve = this.radioOverdriveCurve;
      shaper.connect(cabFilter);
      cabFilter.connect(gain);
      gain.connect(this.radioGain);
      if (this.radioFxGain) gain.connect(this.radioFxGain);
      this.spawnGuitarChordOscs(chord, startTime, duration, shaper, [cabFilter, gain]);
    } else {
      cabFilter.connect(gain);
      gain.connect(this.radioGain);
      this.spawnGuitarChordOscs(chord, startTime, duration, cabFilter, [gain]);
    }
  }

  private spawnGuitarChordOscs(
    chord: readonly number[],
    startTime: number,
    duration: number,
    target: AudioNode,
    cleanupNodes: AudioNode[]
  ): void {
    if (!this.ctx) return;
    const oscs: OscillatorNode[] = [];
    for (const midi of chord) {
      const osc = this.ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(midiToHz(midi), startTime);
      osc.connect(target);
      osc.start(startTime);
      osc.stop(startTime + duration + 0.015);
      oscs.push(osc);
    }
    const last = oscs[oscs.length - 1];
    if (last) {
      last.onended = () => {
        for (const o of oscs) o.disconnect();
        target.disconnect();
        for (const n of cleanupNodes) n.disconnect();
      };
    }
  }

  private playRadioGuitarLeadAt(
    startTime: number,
    freq: number,
    duration: number,
    volume: number
  ): void {
    if (!this.ctx || !this.radioGain || this.muted) return;
    const oscA = this.ctx.createOscillator();
    const oscB = this.ctx.createOscillator();
    const cabFilter = this.ctx.createBiquadFilter();
    const gain = this.ctx.createGain();

    oscA.type = 'sawtooth';
    oscB.type = 'square';
    oscA.frequency.setValueAtTime(freq, startTime);
    oscB.frequency.setValueAtTime(freq * 1.004, startTime);

    cabFilter.type = 'lowpass';
    cabFilter.Q.value = 1.4;
    cabFilter.frequency.setValueAtTime(2550, startTime);
    cabFilter.frequency.exponentialRampToValueAtTime(1100, startTime + duration);

    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.linearRampToValueAtTime(volume, startTime + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

    if (this.radioOverdriveCurve && typeof this.ctx.createWaveShaper === 'function') {
      const shaper = this.ctx.createWaveShaper();
      shaper.curve = this.radioOverdriveCurve;
      oscA.connect(shaper);
      oscB.connect(shaper);
      shaper.connect(cabFilter);
      cabFilter.connect(gain);
      gain.connect(this.radioGain);
      if (this.radioFxGain) gain.connect(this.radioFxGain);
      oscA.onended = () => {
        oscA.disconnect();
        oscB.disconnect();
        shaper.disconnect();
        cabFilter.disconnect();
        gain.disconnect();
      };
    } else {
      oscA.connect(cabFilter);
      oscB.connect(cabFilter);
      cabFilter.connect(gain);
      gain.connect(this.radioGain);
      oscA.onended = () => {
        oscA.disconnect();
        oscB.disconnect();
        cabFilter.disconnect();
        gain.disconnect();
      };
    }

    oscA.start(startTime);
    oscB.start(startTime);
    oscA.stop(startTime + duration + 0.015);
    oscB.stop(startTime + duration + 0.015);
  }

  private playRadioPercAt(
    startTime: number,
    kind: 'kick' | 'snare' | 'hat' | 'openHat' | 'rim' | 'clave' | 'tom',
    volume: number,
    tomFreq = 165
  ): void {
    if (!this.ctx || !this.radioGain || this.muted) return;
    if (kind === 'kick') {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(142, startTime);
      osc.frequency.exponentialRampToValueAtTime(43, startTime + 0.11);
      gain.gain.setValueAtTime(0.0001, startTime);
      gain.gain.linearRampToValueAtTime(volume, startTime + 0.004);
      gain.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.15);
      osc.connect(gain);
      gain.connect(this.radioGain);
      osc.onended = () => {
        osc.disconnect();
        gain.disconnect();
      };
      osc.start(startTime);
      osc.stop(startTime + 0.16);
      return;
    }

    if (kind === 'tom') {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(tomFreq, startTime);
      osc.frequency.exponentialRampToValueAtTime(Math.max(55, tomFreq * 0.52), startTime + 0.14);
      gain.gain.setValueAtTime(0.0001, startTime);
      gain.gain.linearRampToValueAtTime(volume, startTime + 0.004);
      gain.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.15);
      osc.connect(gain);
      gain.connect(this.radioGain);
      osc.onended = () => {
        osc.disconnect();
        gain.disconnect();
      };
      osc.start(startTime);
      osc.stop(startTime + 0.16);
      return;
    }

    if (kind === 'clave' || kind === 'rim') {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = kind === 'clave' ? 'sine' : 'triangle';
      osc.frequency.setValueAtTime(kind === 'clave' ? 1480 : 880, startTime);
      gain.gain.setValueAtTime(0.0001, startTime);
      gain.gain.linearRampToValueAtTime(volume, startTime + 0.003);
      gain.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.045);
      osc.connect(gain);
      gain.connect(this.radioGain);
      if (this.radioFxGain) gain.connect(this.radioFxGain);
      osc.onended = () => {
        osc.disconnect();
        gain.disconnect();
      };
      osc.start(startTime);
      osc.stop(startTime + 0.05);
      return;
    }

    if (kind === 'snare') {
      const body = this.ctx.createOscillator();
      const bodyGain = this.ctx.createGain();
      body.type = 'triangle';
      body.frequency.setValueAtTime(192, startTime);
      body.frequency.exponentialRampToValueAtTime(108, startTime + 0.07);
      bodyGain.gain.setValueAtTime(0.0001, startTime);
      bodyGain.gain.linearRampToValueAtTime(volume * 0.72, startTime + 0.004);
      bodyGain.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.085);
      body.connect(bodyGain);
      bodyGain.connect(this.radioGain);
      body.onended = () => {
        body.disconnect();
        bodyGain.disconnect();
      };
      body.start(startTime);
      body.stop(startTime + 0.09);
    }

    if (!this.radioHatBuffer) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.radioHatBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = kind === 'snare' ? 'bandpass' : 'highpass';
    filter.frequency.setValueAtTime(kind === 'snare' ? 1950 : 6200, startTime);
    const tail = kind === 'snare' ? 0.11 : kind === 'openHat' ? 0.13 : 0.032;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(volume, startTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + tail);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.radioGain);
    if (kind === 'snare' && this.radioFxGain) gain.connect(this.radioFxGain);
    src.onended = () => {
      src.disconnect();
      filter.disconnect();
      gain.disconnect();
    };
    src.start(startTime);
    src.stop(startTime + tail + 0.01);
  }

  public playRadioTune(): void {
    if (this.muted || !this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    this.radioStep = 0;
    this.nextRadioNoteTime = now + 0.1;

    const duration = 0.11;
    const len = Math.max(128, Math.floor(this.ctx.sampleRate * duration));
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      const env = Math.sin((i / len) * Math.PI);
      ch[i] = (Math.random() * 2 - 1) * env;
    }
    const noise = this.ctx.createBufferSource();
    noise.buffer = buf;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1750;
    filter.Q.value = 1.1;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.14, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    noise.onended = () => {
      noise.disconnect();
      filter.disconnect();
      gain.disconnect();
    };
    noise.start(now);
  }

  public playTone(freq: number, duration: number, type: OscillatorType = 'sine', volume = 0.16, slideTo?: number): void {
    if (this.muted || !this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    if (slideTo !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), now + duration);
    }
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + duration);
  }

  public playCashPickup(): void {
    this.playTone(587.33, 0.1, 'triangle', 0.18);
    setTimeout(() => this.playTone(880, 0.16, 'triangle', 0.18), 65);
  }

  public playJump(): void {
    this.playTone(170, 0.14, 'sine', 0.12, 340);
  }

  public playDoorToggle(): void {
    this.playTone(130, 0.09, 'square', 0.09, 75);
  }

  public playDoorClose(intensity = 1): void {
    const clamped = Math.max(0.4, Math.min(1.3, intensity));
    this.playTone(108, 0.085, 'sawtooth', 0.1 * clamped, 46);
    setTimeout(() => this.playTone(230, 0.04, 'square', 0.05 * clamped, 115), 24);
  }

  public playDoorOpen(): void {
    this.playTone(210, 0.06, 'triangle', 0.08, 320);
    setTimeout(() => this.playTone(145, 0.07, 'sine', 0.06, 95), 35);
  }

  public playDoorSlam(intensity = 1): void {
    const clamped = Math.max(0.35, Math.min(1.35, intensity));
    this.playTone(118, 0.095, 'sawtooth', 0.11 * clamped, 42);
    this.playTone(260, 0.045, 'square', 0.055 * clamped, 130);
  }

  public playCollision(intensity = 1): void {
    const vol = Math.min(0.24, 0.08 + intensity * 0.12);
    this.playTone(95, 0.18, 'sawtooth', vol, 36);
  }

  public playMissionComplete(): void {
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((n, idx) => {
      setTimeout(() => this.playTone(n, 0.24, 'triangle', 0.18), idx * 90);
    });
  }

  public playBusted(): void {
    this.playTone(340, 0.28, 'sawtooth', 0.18, 120);
  }

  public playHorn(): void {
    this.playTone(392, 0.22, 'sawtooth', 0.11);
    this.playTone(493.88, 0.22, 'sawtooth', 0.09);
  }

  public playImpact(strength = 1): void {
    const vol = Math.min(0.28, 0.12 + strength * 0.12);
    this.playTone(130, 0.16, 'sawtooth', vol, 42);
    this.playTone(320, 0.1, 'triangle', vol * 0.7, 110);
  }

  public playCartoonStars(): void {
    this.playTone(980, 0.09, 'sine', 0.08, 1320);
    setTimeout(() => this.playTone(1240, 0.11, 'sine', 0.08, 860), 70);
  }

  public playGunshot(weaponId: string): void {
    if (this.muted || !this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;

    // Estalo percussivo com ruído curto filtrado + corpo grave específico por arma
    const duration = weaponId === 'shotgun' ? 0.19 : weaponId === 'rifle' ? 0.145 : weaponId === 'smg' ? 0.085 : 0.11;
    const len = Math.max(128, Math.floor(this.ctx.sampleRate * duration));
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      const env = Math.pow(1 - i / len, weaponId === 'shotgun' ? 1.7 : 2.5);
      ch[i] = (Math.random() * 2 - 1) * env;
    }

    const noise = this.ctx.createBufferSource();
    noise.buffer = buf;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value =
      weaponId === 'shotgun' ? 720 : weaponId === 'rifle' ? 1420 : weaponId === 'smg' ? 1880 : 1550;
    filter.Q.value = weaponId === 'rifle' ? 0.7 : 0.85;

    const noiseGain = this.ctx.createGain();
    const vol = weaponId === 'shotgun' ? 0.34 : weaponId === 'rifle' ? 0.28 : weaponId === 'smg' ? 0.2 : 0.24;
    noiseGain.gain.setValueAtTime(vol, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    noise.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(this.masterGain);
    noise.start(now);

    const punchFreq = weaponId === 'shotgun' ? 128 : weaponId === 'rifle' ? 205 : weaponId === 'smg' ? 245 : 210;
    this.playTone(punchFreq, duration * 0.75, 'triangle', vol * 0.65, 46);

    if (weaponId === 'rifle') {
      // Estalo supersônico agudo de fuzil
      this.playTone(2200, 0.045, 'sawtooth', 0.07, 780);
    } else if (weaponId === 'shotgun') {
      // Cauda mecânica leve de ferrolho/pump após o disparo
      setTimeout(() => this.playTone(320, 0.045, 'square', 0.04, 190), 175);
    }
  }

  public playMeleeSwing(): void {
    this.playTone(230, 0.1, 'sine', 0.11, 95);
  }

  public playReload(stage: 'mag' | 'shell' = 'mag'): void {
    if (stage === 'shell') {
      this.playTone(520, 0.045, 'triangle', 0.075, 760);
      return;
    }
    this.playTone(340, 0.06, 'square', 0.08, 460);
    setTimeout(() => this.playTone(540, 0.08, 'triangle', 0.09, 680), 110);
  }

  public playDryFire(): void {
    this.playTone(860, 0.032, 'square', 0.065, 420);
  }

  public playHitMarker(headshot = false): void {
    if (headshot) {
      this.playTone(1320, 0.07, 'sine', 0.13, 1760);
    } else {
      this.playTone(880, 0.05, 'triangle', 0.09, 660);
    }
  }

  public playBulletImpact(material: 'concrete' | 'metal' | 'terrain' | 'npc', distRatio = 0): void {
    if (this.muted || !this.ctx || !this.masterGain) return;
    const att = Math.max(0.18, 1 - Math.max(0, Math.min(1, distRatio)) * 0.8);
    if (material === 'metal') {
      this.playTone(1240, 0.09, 'triangle', 0.1 * att, 480);
      this.playTone(2180, 0.05, 'sine', 0.065 * att, 1320);
    } else if (material === 'concrete') {
      this.playTone(520, 0.055, 'sawtooth', 0.075 * att, 175);
    } else if (material === 'terrain') {
      this.playTone(165, 0.065, 'sine', 0.08 * att, 68);
    } else {
      this.playTone(290, 0.05, 'triangle', 0.085 * att, 140);
    }
  }

  public playBulletFlyby(pan = 0): void {
    if (this.muted || !this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1680, now);
    osc.frequency.exponentialRampToValueAtTime(410, now + 0.095);
    gain.gain.setValueAtTime(0.085, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.095);

    if (typeof this.ctx.createStereoPanner === 'function') {
      const panner = this.ctx.createStereoPanner();
      panner.pan.value = Math.max(-1, Math.min(1, pan));
      osc.connect(gain);
      gain.connect(panner);
      panner.connect(this.masterGain);
    } else {
      osc.connect(gain);
      gain.connect(this.masterGain);
    }

    osc.start(now);
    osc.stop(now + 0.098);
  }

  public dispose(): void {
    if (this.ctx) {
      void this.ctx.close();
      this.ctx = null;
    }
    this.initialized = false;
  }
}
