import { MissionId, VehicleDoorEventState, VehicleEntity, WeatherType } from '../types';

export interface GameEventMap {
  vehicleHitPedestrian: {
    npcIndex: number;
    vehicleId: string;
    speed: number;
    isPlayer: boolean;
    outcome: 'out' | 'unconscious' | 'injured_recover';
    wantedIncrease: number;
    hitStopSec: number;
    cameraShake: number;
    impactStrength: number;
    bannerMessage: string | null;
  };
  crimeCommitted: {
    minStars: number;
    reason: string;
    source: 'hit' | 'carjack' | 'crash' | 'mission' | 'shooting' | 'robbery' | 'assault';
  };
  wantedChanged: {
    stars: number;
    prevStars: number;
    reason?: string;
  };
  evaded: {
    bonus: number;
  };
  busted: {
    fine: number;
  };
  missionStarted: {
    missionId: MissionId;
  };
  missionStepUpdated: {
    missionId: MissionId;
    step: number;
  };
  missionCompleted: {
    missionId: MissionId;
    reward: number;
  };
  cashCollected: {
    pickupId: string;
    amount: number;
  };
  vehicleEntered: {
    vehicle: VehicleEntity;
    wasOccupiedByNpc: boolean;
  };
  vehicleExited: {
    vehicle: VehicleEntity;
  };
  vehicleDoorsToggled: {
    vehicle: VehicleEntity;
    action: 'opened' | 'closed';
  };
  vehicleDoorChanged: {
    vehicleId: string;
    doorIndex: number;
    state: VehicleDoorEventState;
  };
  vehicleCollision: {
    intensity: number;
    x: number;
    z: number;
    hitPolice: boolean;
    speed: number;
  };
  hornHonked: {
    x: number;
    z: number;
  };
  playerJumped: {
    x: number;
    z: number;
  };
  weatherChanged: {
    weather: WeatherType;
    label: string;
    manual: boolean;
  };
  timeScaleChanged: {
    timeScale: number;
  };
  pauseChanged: {
    paused: boolean;
  };
  bannerRequested: {
    text: string;
    duration?: number;
  };
  saveRequested: {
    reason: 'autosave' | 'mission' | 'manual';
  };
  weaponFired: {
    weaponId: string;
    originX: number;
    originY: number;
    originZ: number;
    dirX: number;
    dirY: number;
    dirZ: number;
  };
  weaponHit: {
    weaponId: string;
    targetKind: 'npc' | 'vehicle' | 'world';
    targetId: string;
    damage: number;
    headshot: boolean;
    x: number;
    y: number;
    z: number;
  };
  playerDamaged: {
    amount: number;
    armorAbsorbed: number;
    source: string;
  };
  playerDied: {
    hospitalFee: number;
    x: number;
    z: number;
  };
  purchaseMade: {
    shopId: string;
    itemId: string;
    category: string;
    price: number;
  };
  outfitChanged: {
    slot: string;
    itemId: string;
  };
  shopOpened: {
    shopId: string;
    category: string;
  };
  randomEventStarted: {
    eventId: string;
    title: string;
    x: number;
    z: number;
  };
  randomEventCompleted: {
    eventId: string;
    reward: number;
  };
  randomEventFailed: {
    eventId: string;
    reason: string;
  };
  waypointSet: {
    x: number | null;
    z: number | null;
    label?: string;
  };
  districtChanged: {
    districtId: string;
    districtName: string;
    streetName: string;
  };
  performanceScaled: {
    pixelRatio: number;
    fps: number;
  };
  radioChanged: {
    stationId: string;
    stationName: string;
    frequency: string;
    trackTitle: string;
    trackArtist: string;
    isOff: boolean;
  };
  radioTrackChanged: {
    stationId: string;
    trackTitle: string;
    trackArtist: string;
  };
}

export type EventHandler<T> = (payload: T) => void;

/**
 * Barramento de eventos fortemente tipado para desacoplar comunicação entre subsistemas.
 */
export class TypedEventBus<TEvents extends { [K in keyof TEvents]: unknown } = GameEventMap> {
  private listeners = new Map<keyof TEvents, Set<EventHandler<unknown>>>();

  public on<K extends keyof TEvents>(event: K, handler: EventHandler<TEvents[K]>): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(handler as EventHandler<unknown>);
    return () => this.off(event, handler);
  }

  public once<K extends keyof TEvents>(event: K, handler: EventHandler<TEvents[K]>): () => void {
    const unsub = this.on(event, (payload) => {
      unsub();
      handler(payload);
    });
    return unsub;
  }

  public off<K extends keyof TEvents>(event: K, handler: EventHandler<TEvents[K]>): void {
    const set = this.listeners.get(event);
    if (!set) return;
    set.delete(handler as EventHandler<unknown>);
    if (set.size === 0) {
      this.listeners.delete(event);
    }
  }

  public emit<K extends keyof TEvents>(event: K, payload: TEvents[K]): void {
    const set = this.listeners.get(event);
    if (!set || set.size === 0) return;
    const snapshot = Array.from(set);
    for (const fn of snapshot) {
      (fn as EventHandler<TEvents[K]>)(payload);
    }
  }

  public clear(): void {
    this.listeners.clear();
  }
}
