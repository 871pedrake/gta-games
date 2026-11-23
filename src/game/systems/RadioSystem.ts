import { EngineContext, GameSystem } from '../core/SystemLifecycle';
import {
  getNextRadioStationId,
  getRadioStation,
  RADIO_STATIONS,
} from '../RadioStations';
import { HudRadioState, RadioStationId } from '../types';
import { InputManager } from './InputManager';

const NOTIFICATION_DURATION_SEC = 4.2;

export class RadioSystem implements GameSystem {
  public readonly name = 'RadioSystem';

  private ctx: EngineContext | null = null;
  private readonly input: InputManager;
  private unsubEnter: (() => void) | null = null;
  private unsubExit: (() => void) | null = null;

  constructor(input: InputManager) {
    this.input = input;
  }

  public init(ctx: EngineContext): void {
    this.ctx = ctx;
    this.syncDerivedRadioState();

    this.unsubEnter = ctx.events.on('vehicleEntered', () => {
      if (!this.ctx) return;
      const { radio } = this.ctx.state;
      this.syncDerivedRadioState();
      if (!radio.isOff) {
        radio.notificationTimer = NOTIFICATION_DURATION_SEC;
      }
      ctx.events.emit('radioChanged', {
        stationId: radio.stationId,
        stationName: radio.stationName,
        frequency: radio.frequency,
        trackTitle: radio.trackTitle,
        trackArtist: radio.trackArtist,
        isOff: radio.isOff,
      });
    });

    this.unsubExit = ctx.events.on('vehicleExited', () => {
      if (!this.ctx) return;
      this.ctx.state.radio.notificationTimer = 0;
      this.ctx.state.radio.wheelOpen = false;
      this.input.setUiModalOpen(false);
    });
  }

  public cycleStation(dir: 1 | -1 = 1): boolean {
    if (!this.ctx) return false;
    const { state } = this.ctx;
    if (!state.currentVehicle) return false;

    const nextId = getNextRadioStationId(state.radio.stationId, dir);
    return this.selectStation(nextId);
  }

  public selectStation(stationId: RadioStationId): boolean {
    if (!this.ctx) return false;
    const { state, audio, events } = this.ctx;
    if (!state.currentVehicle) return false;

    state.radio.stationId = stationId;
    state.radio.wheelOpen = false;
    this.input.setUiModalOpen(false);
    this.syncDerivedRadioState();
    state.radio.notificationTimer = NOTIFICATION_DURATION_SEC;

    audio.playRadioTune();

    events.emit('radioChanged', {
      stationId: state.radio.stationId,
      stationName: state.radio.stationName,
      frequency: state.radio.frequency,
      trackTitle: state.radio.trackTitle,
      trackArtist: state.radio.trackArtist,
      isOff: state.radio.isOff,
    });
    return true;
  }

  public nextTrack(): boolean {
    if (!this.ctx) return false;
    const { state, events } = this.ctx;
    if (!state.currentVehicle || state.radio.isOff) return false;
    const station = getRadioStation(state.radio.stationId);
    if (station.tracks.length <= 1) return false;

    const curIdx = state.radio.trackIndexByStation[station.id] ?? 0;
    const nextIdx = (curIdx + 1) % station.tracks.length;
    state.radio.trackIndexByStation[station.id] = nextIdx;
    state.radio.trackElapsedByStation[station.id] = 0;
    this.syncDerivedRadioState();
    state.radio.notificationTimer = NOTIFICATION_DURATION_SEC;

    events.emit('radioTrackChanged', {
      stationId: station.id,
      trackTitle: state.radio.trackTitle,
      trackArtist: state.radio.trackArtist,
    });
    return true;
  }

  public setWheelOpen(open: boolean): void {
    if (!this.ctx) return;
    const { state } = this.ctx;
    if (!state.currentVehicle && open) return;
    state.radio.wheelOpen = open;
    this.input.setUiModalOpen(open || state.combat.gunShopOpen || state.combat.weaponWheelOpen);
  }

  public getSnapshot(): HudRadioState {
    if (!this.ctx) {
      const def = getRadioStation('solara_fm');
      return {
        stationId: def.id,
        stationName: def.name,
        frequency: def.frequency,
        genre: def.genre,
        colorHex: def.colorHex,
        trackTitle: def.tracks[0].title,
        trackArtist: def.tracks[0].artist,
        trackIndex: 0,
        trackCount: def.tracks.length,
        isOff: false,
        notificationTimer: 0,
        wheelOpen: false,
      };
    }
    const r = this.ctx.state.radio;
    const station = getRadioStation(r.stationId);
    const idx = (r.trackIndexByStation[station.id] ?? 0) % station.tracks.length;
    return {
      stationId: r.stationId,
      stationName: r.stationName,
      frequency: r.frequency,
      genre: r.genre,
      colorHex: r.colorHex,
      trackTitle: r.trackTitle,
      trackArtist: r.trackArtist,
      trackIndex: idx,
      trackCount: station.tracks.length,
      isOff: r.isOff,
      notificationTimer: r.notificationTimer,
      wheelOpen: r.wheelOpen,
    };
  }

  public update(dt: number): void {
    if (!this.ctx) return;
    const { state, events } = this.ctx;
    const { radio } = state;

    // Avança a programação de todas as estações como transmissão contínua ao vivo
    for (const station of RADIO_STATIONS) {
      if (station.id === 'off' || station.tracks.length === 0) continue;
      const curIdx = radio.trackIndexByStation[station.id] ?? 0;
      const curTrack = station.tracks[curIdx % station.tracks.length];
      const nextElapsed = (radio.trackElapsedByStation[station.id] ?? 0) + dt;
      if (nextElapsed >= curTrack.durationSec) {
        const nextIdx = (curIdx + 1) % station.tracks.length;
        radio.trackIndexByStation[station.id] = nextIdx;
        radio.trackElapsedByStation[station.id] = nextElapsed - curTrack.durationSec;

        if (state.currentVehicle && radio.stationId === station.id) {
          this.syncDerivedRadioState();
          radio.notificationTimer = NOTIFICATION_DURATION_SEC;
          events.emit('radioTrackChanged', {
            stationId: station.id,
            trackTitle: radio.trackTitle,
            trackArtist: radio.trackArtist,
          });
        }
      } else {
        radio.trackElapsedByStation[station.id] = nextElapsed;
      }
    }

    if (!state.currentVehicle) {
      // Consome entradas pendentes de rádio fora de veículos para não disparar ao entrar depois
      this.input.consumeAction('radioNext');
      this.input.consumeAction('radioPrev');
      if (radio.notificationTimer > 0) radio.notificationTimer = 0;
      if (radio.wheelOpen) {
        radio.wheelOpen = false;
        this.input.setUiModalOpen(state.combat.gunShopOpen || state.combat.weaponWheelOpen);
      }
      return;
    }

    if (this.input.consumeAction('radioNext')) {
      this.cycleStation(1);
    } else if (this.input.consumeAction('radioPrev')) {
      this.cycleStation(-1);
    }

    if (radio.notificationTimer > 0) {
      radio.notificationTimer = Math.max(0, radio.notificationTimer - dt);
    }
  }

  private syncDerivedRadioState(): void {
    if (!this.ctx) return;
    const { radio } = this.ctx.state;
    const station = getRadioStation(radio.stationId);
    const idx = (radio.trackIndexByStation[station.id] ?? 0) % station.tracks.length;
    const track = station.tracks[idx];
    radio.stationName = station.name;
    radio.frequency = station.frequency;
    radio.genre = station.genre;
    radio.colorHex = station.colorHex;
    radio.trackTitle = track.title;
    radio.trackArtist = track.artist;
    radio.isOff = station.id === 'off';
  }

  public dispose(): void {
    this.unsubEnter?.();
    this.unsubExit?.();
    this.unsubEnter = null;
    this.unsubExit = null;
    this.ctx = null;
  }
}
