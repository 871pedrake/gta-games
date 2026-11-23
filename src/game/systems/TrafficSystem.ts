import * as THREE from 'three';
import { VEHICLE_WHEEL_RADIUS } from '../config';
import { EngineContext, GameSystem } from '../core/SystemLifecycle';
import { createVehicleEntity } from '../models';
import { VehicleEntity } from '../types';
import { ChunkTrafficSpawn } from '../world/WorldChunkSystem';
import { STREETS, StreetPoint, StreetSpec } from '../world/WorldRegistry';

interface StreetLaneTrack {
  streetId: string;
  points: StreetPoint[];
  closed: boolean;
  pointIndex: number;
  dir: 1 | -1;
}

interface CachedStreetLane {
  points: StreetPoint[];
  closed: boolean;
}

function buildTrackFromStreet(street: StreetSpec, laneOffset: number): StreetPoint[] {
  const raw: StreetPoint[] = [];
  if (street.kind === 'roundabout' && street.roundabout) {
    const rb = street.roundabout;
    const r = (rb.innerRadius + rb.outerRadius) * 0.5 + laneOffset * 0.35;
    for (let i = 0; i < 20; i++) {
      const a = (i / 20) * Math.PI * 2;
      raw.push({ x: rb.centerX + Math.cos(a) * r, z: rb.centerZ + Math.sin(a) * r });
    }
    return raw;
  }

  for (let sIdx = 0; sIdx < street.segments.length; sIdx++) {
    const seg = street.segments[sIdx];
    const perpX = seg.dirZ;
    const perpZ = -seg.dirX;
    if (sIdx === 0) {
      raw.push({ x: seg.x1 + perpX * laneOffset, z: seg.z1 + perpZ * laneOffset });
    } else {
      // Se houver rotatória entre dois trechos da avenida, contorna suavemente o anel externo
      const prev = street.segments[sIdx - 1];
      const gap = Math.hypot(seg.x1 - prev.x2, seg.z1 - prev.z2);
      if (gap > 8) {
        const cx = (prev.x2 + seg.x1) * 0.5;
        const cz = (prev.z2 + seg.z1) * 0.5;
        const radius = gap * 0.5 - 4.5;
        const aStart = Math.atan2(prev.z2 - cz, prev.x2 - cx);
        const aEnd = Math.atan2(seg.z1 - cz, seg.x1 - cx);
        let delta = aEnd - aStart;
        if (delta <= 0) delta += Math.PI * 2;
        const arcSteps = 7;
        for (let k = 1; k < arcSteps; k++) {
          const a = aStart + (delta * k) / arcSteps;
          raw.push({ x: cx + Math.cos(a) * radius, z: cz + Math.sin(a) * radius });
        }
      }
      raw.push({ x: seg.x1 + perpX * laneOffset, z: seg.z1 + perpZ * laneOffset });
    }
    raw.push({ x: seg.x2 + perpX * laneOffset, z: seg.z2 + perpZ * laneOffset });
  }
  return raw;
}

function getStreetLaneCacheKey(streetId: string, laneOffset: number): string {
  return `${streetId}|${Math.round(laneOffset * 10)}`;
}

function findNextIndexOnTrack(
  points: StreetPoint[],
  closed: boolean,
  x: number,
  z: number,
  heading: number
): { pointIndex: number; dir: 1 | -1 } {
  let bestIdx = 0;
  let bestDistSq = Infinity;
  for (let i = 0; i < points.length; i++) {
    const dx = points[i].x - x;
    const dz = points[i].z - z;
    const dSq = dx * dx + dz * dz;
    if (dSq < bestDistSq) {
      bestDistSq = dSq;
      bestIdx = i;
    }
  }

  const hx = Math.sin(heading);
  const hz = Math.cos(heading);
  const fwdIdx = closed ? (bestIdx + 1) % points.length : Math.min(points.length - 1, bestIdx + 1);
  const bwdIdx = closed ? (bestIdx - 1 + points.length) % points.length : Math.max(0, bestIdx - 1);

  const fx = points[fwdIdx].x - points[bestIdx].x;
  const fz = points[fwdIdx].z - points[bestIdx].z;
  const fDot = fx * hx + fz * hz;

  const bx = points[bwdIdx].x - points[bestIdx].x;
  const bz = points[bwdIdx].z - points[bestIdx].z;
  const bDot = bx * hx + bz * hz;

  if (bDot > fDot && (closed || bestIdx > 0)) {
    return { pointIndex: bwdIdx, dir: -1 };
  }
  return { pointIndex: fwdIdx, dir: 1 };
}

export class TrafficSystem implements GameSystem {
  public readonly name = 'TrafficSystem';

  private ctx: EngineContext | null = null;
  private readonly shadowTex: THREE.CanvasTexture;
  private readonly tracks = new Map<VehicleEntity, StreetLaneTrack>();
  private readonly cachedStreetLanes = new Map<string, CachedStreetLane>();
  private readonly activeChunkTrafficSpawns: ChunkTrafficSpawn[] = [];
  private trafficSpawnCursor = 0;

  constructor(shadowTex: THREE.CanvasTexture) {
    this.shadowTex = shadowTex;
  }

  public init(ctx: EngineContext): void {
    this.ctx = ctx;

    // Pré-computa malhas de pista para todos os spawns de tráfego registrados nos chunks (zero alocação por frame)
    for (const ch of ctx.world.chunkManager.getAllChunks()) {
      const spawns = ch.metadata.trafficSpawns;
      for (let i = 0; i < spawns.length; i++) {
        const sp = spawns[i];
        const cacheKey = getStreetLaneCacheKey(sp.streetId, sp.laneOffset);
        if (!this.cachedStreetLanes.has(cacheKey)) {
          const street = STREETS.find((s) => s.id === sp.streetId);
          if (street) {
            const pts = buildTrackFromStreet(street, sp.laneOffset);
            if (pts.length >= 2) {
              this.cachedStreetLanes.set(cacheKey, {
                points: pts,
                closed: Boolean(street.closed),
              });
            }
          }
        }
      }
    }

    const findStreet = (id: string) => STREETS.find((s) => s.id === id)!;

    const npcConfigs: Array<{
      type: 'hatch' | 'sedan' | 'coupe' | 'sports' | 'suv' | 'pickup' | 'van' | 'convertible';
      color: number;
      streetId: string;
      laneOffset: number;
      startRatio: number;
      dir: 1 | -1;
    }> = [
      { type: 'sedan', color: 0xff8c38, streetId: 'st_beira_mar', laneOffset: 3.1, startRatio: 0.2, dir: 1 },
      { type: 'coupe', color: 0xa855f7, streetId: 'st_beira_mar', laneOffset: -3.1, startRatio: 0.72, dir: -1 },
      { type: 'hatch', color: 0x22c55e, streetId: 'st_central_solara', laneOffset: 3.8, startRatio: 0.15, dir: 1 },
      { type: 'sports', color: 0xfacc15, streetId: 'st_central_solara', laneOffset: -6.8, startRatio: 0.82, dir: -1 },
      { type: 'suv', color: 0xf97316, streetId: 'st_atlantica_norte', laneOffset: 3.8, startRatio: 0.35, dir: 1 },
      { type: 'convertible', color: 0x22d3ee, streetId: 'st_av_palmeiras', laneOffset: 3.8, startRatio: 0.25, dir: 1 },
      { type: 'pickup', color: 0xef4444, streetId: 'st_alameda_sol', laneOffset: -3.8, startRatio: 0.65, dir: -1 },
      { type: 'van', color: 0xe2e8f0, streetId: 'st_flamingo', laneOffset: 2.8, startRatio: 0.45, dir: 1 },
      { type: 'sports', color: 0x60a5fa, streetId: 'st_rot_sol', laneOffset: 0, startRatio: 0.3, dir: 1 },
      { type: 'hatch', color: 0xfbbf24, streetId: 'st_cassino', laneOffset: -2.8, startRatio: 0.55, dir: -1 },
    ];

    npcConfigs.forEach((cfg, idx) => {
      const street = findStreet(cfg.streetId);
      const pts = buildTrackFromStreet(street, cfg.laneOffset);
      if (pts.length < 2) return;

      const cacheKey = getStreetLaneCacheKey(cfg.streetId, cfg.laneOffset);
      if (!this.cachedStreetLanes.has(cacheKey)) {
        this.cachedStreetLanes.set(cacheKey, {
          points: pts,
          closed: Boolean(street.closed),
        });
      }

      const startIdx = Math.max(0, Math.min(pts.length - 2, Math.floor(cfg.startRatio * (pts.length - 1))));
      const p0 = pts[startIdx];
      const nextIdx = cfg.dir === 1 ? Math.min(pts.length - 1, startIdx + 1) : Math.max(0, startIdx - 1);
      const p1 = pts[nextIdx];
      const heading = Math.atan2(p1.x - p0.x, p1.z - p0.z);

      const npc = createVehicleEntity(
        `npc_${idx}`,
        cfg.type,
        cfg.color,
        p0.x,
        p0.z,
        heading,
        this.shadowTex,
        ctx.isSoftwareGl
      );
      npc.driver = 'npc';
      npc.npcTargetSpeed = 11 + (idx % 3) * 2.1;
      ctx.scene.add(npc.mesh);
      ctx.vehicles.push(npc);

      this.tracks.set(npc, {
        streetId: cfg.streetId,
        points: pts,
        closed: Boolean(street.closed),
        pointIndex: nextIdx,
        dir: cfg.dir,
      });
    });

    const stop0 = ctx.registry.places.find((p) => p.id === 'bus_stop_0');
    const busConfigs: Array<{ id: string; color: number; x: number; z: number; h: number; leg: number }> = [
      { id: 'bus_0', color: 0x0284c7, x: -92, z: -114.2, h: Math.PI / 2, leg: 0 },
      {
        id: 'bus_1',
        color: 0x0d9488,
        x: stop0 ? stop0.x - 5.6 : 69,
        z: -24,
        h: 0,
        leg: 3,
      },
    ];
    for (const bc of busConfigs) {
      const bus = createVehicleEntity(
        bc.id,
        'bus',
        bc.color,
        bc.x,
        bc.z,
        bc.h,
        this.shadowTex,
        ctx.isSoftwareGl
      );
      bus.driver = 'bus';
      bus.npcTargetSpeed = 12.5;
      ctx.scene.add(bus.mesh);
      ctx.vehicles.push(bus);
      ctx.transit.registerBus(bus, bc.leg);
    }

    const ambulance = createVehicleEntity(
      'ambulance_0',
      'ambulance',
      0xf8fafc,
      -14.2,
      -62,
      0,
      this.shadowTex,
      ctx.isSoftwareGl
    );
    ambulance.driver = 'ambulance';
    ambulance.npcTargetSpeed = 12;
    ctx.scene.add(ambulance.mesh);
    ctx.vehicles.push(ambulance);
    ctx.transit.registerAmbulance(ambulance);

    ctx.world.chunkManager.getLoadedTrafficSpawns(this.activeChunkTrafficSpawns, true);
  }

  public getActiveChunkTrafficSpawns(): readonly ChunkTrafficSpawn[] {
    if (this.ctx) {
      this.ctx.world.chunkManager.getLoadedTrafficSpawns(this.activeChunkTrafficSpawns, true);
    }
    return this.activeChunkTrafficSpawns;
  }

  private tryRespawnOnActiveChunk(
    v: VehicleEntity,
    track: StreetLaneTrack,
    playerX: number,
    playerZ: number,
    vehicles: VehicleEntity[]
  ): boolean {
    const spawns = this.activeChunkTrafficSpawns;
    if (spawns.length === 0) return false;

    for (let attempt = 0; attempt < Math.min(20, spawns.length); attempt++) {
      const idx = (this.trafficSpawnCursor + attempt * 5) % spawns.length;
      this.trafficSpawnCursor = (this.trafficSpawnCursor + 1) % spawns.length;
      const sp = spawns[idx];
      const dxp = sp.x - playerX;
      const dzp = sp.z - playerZ;
      const distPlayerSq = dxp * dxp + dzp * dzp;
      if (distPlayerSq < 42 * 42) continue;

      let crowded = false;
      for (let j = 0; j < vehicles.length; j++) {
        const other = vehicles[j];
        if (other === v) continue;
        const dxo = other.x - sp.x;
        const dzo = other.z - sp.z;
        if (dxo * dxo + dzo * dzo < 14 * 14) {
          crowded = true;
          break;
        }
      }
      if (crowded) continue;

      const cached = this.cachedStreetLanes.get(getStreetLaneCacheKey(sp.streetId, sp.laneOffset));
      if (!cached || cached.points.length < 2) continue;

      v.x = sp.x;
      v.z = sp.z;
      v.heading = sp.heading;
      const nextTrack = findNextIndexOnTrack(cached.points, cached.closed, sp.x, sp.z, sp.heading);
      track.streetId = sp.streetId;
      track.points = cached.points;
      track.closed = cached.closed;
      track.pointIndex = nextTrack.pointIndex;
      track.dir = nextTrack.dir;
      return true;
    }
    return false;
  }

  public update(dt: number): void {
    if (!this.ctx) return;
    const { vehicles, state, weatherEffects, transit, crowd, groundHeightAt, events, world } = this.ctx;

    const loadedSpawns = world.chunkManager.getLoadedTrafficSpawns(this.activeChunkTrafficSpawns, false);
    if (loadedSpawns.length === 0) {
      world.chunkManager.getLoadedTrafficSpawns(this.activeChunkTrafficSpawns, true);
    }

    for (const v of vehicles) {
      if (v === state.currentVehicle || v.driver !== 'npc') continue;
      const track = this.tracks.get(v);
      if (!track || track.points.length < 2) continue;

      // Se um veículo saiu totalmente dos chunks carregados, recicla-o para um spawn de tráfego ativo
      const curChunk = world.chunkManager.getChunkAtWorld(v.x, v.z);
      const playerDistSq =
        (v.x - state.playerPos.x) * (v.x - state.playerPos.x) +
        (v.z - state.playerPos.z) * (v.z - state.playerPos.z);
      if (curChunk && curChunk.state === 'unloaded' && playerDistSq > 95 * 95) {
        this.tryRespawnOnActiveChunk(v, track, state.playerPos.x, state.playerPos.z, vehicles);
      }

      const targetPt = track.points[track.pointIndex];
      const dx = targetPt.x - v.x;
      const dz = targetPt.z - v.z;
      const dist = Math.hypot(dx, dz);

      if (dist < 3.4) {
        if (track.closed) {
          track.pointIndex = (track.pointIndex + track.dir + track.points.length) % track.points.length;
        } else {
          const next = track.pointIndex + track.dir;
          if (next >= track.points.length || next < 0) {
            if (!this.tryRespawnOnActiveChunk(v, track, state.playerPos.x, state.playerPos.z, vehicles)) {
              const resetIdx = track.dir === 1 ? 0 : track.points.length - 1;
              const afterIdx = track.dir === 1 ? 1 : track.points.length - 2;
              v.x = track.points[resetIdx].x;
              v.z = track.points[resetIdx].z;
              v.heading = Math.atan2(
                track.points[afterIdx].x - v.x,
                track.points[afterIdx].z - v.z
              );
              track.pointIndex = afterIdx;
            }
          } else {
            track.pointIndex = next;
          }
        }
      }

      const wp = track.points[track.pointIndex];
      const wdx = wp.x - v.x;
      const wdz = wp.z - v.z;
      const wLen = Math.hypot(wdx, wdz) || 1;
      const dirX = wdx / wLen;
      const dirZ = wdz / wLen;
      const axis: 'x' | 'z' = Math.abs(dirX) >= Math.abs(dirZ) ? 'x' : 'z';
      const dir: 1 | -1 = (axis === 'x' ? dirX : dirZ) >= 0 ? 1 : -1;

      const baseDesired = (v.npcTargetSpeed ?? 11) * weatherEffects.npcTrafficSpeedMult;
      const targetSpd = transit.computeSignalAndQueueSpeed(
        v,
        axis,
        dir,
        baseDesired,
        crowd.graph,
        vehicles
      );
      v.speed = THREE.MathUtils.damp(v.speed, targetSpd, 4.5, dt);

      v.taillights.forEach((tl) => {
        (tl.material as THREE.MeshStandardMaterial).emissiveIntensity =
          targetSpd < 1.2 ? 2.7 : 1.1;
      });

      const desiredHeading = Math.atan2(dirX, dirZ);
      let hDiff = desiredHeading - v.heading;
      while (hDiff > Math.PI) hDiff -= Math.PI * 2;
      while (hDiff < -Math.PI) hDiff += Math.PI * 2;
      v.heading += hDiff * Math.min(1, dt * 7.5);
      v.frontWheelPivots.forEach((p) => (p.rotation.y = THREE.MathUtils.clamp(hDiff * 0.55, -0.35, 0.35)));

      v.x += Math.sin(v.heading) * v.speed * dt;
      v.z += Math.cos(v.heading) * v.speed * dt;

      const gy = groundHeightAt(v.x, v.z, v.mesh.position.y);
      v.mesh.position.set(v.x, gy, v.z);
      v.mesh.rotation.y = v.heading;
      v.wheels.forEach((w) => (w.rotation.x += (v.speed * dt) / VEHICLE_WHEEL_RADIUS));
    }

    transit.update(
      dt,
      state.elapsedSec,
      crowd.graph,
      crowd,
      this.ctx.ragdolls,
      vehicles,
      weatherEffects.npcTrafficSpeedMult,
      groundHeightAt,
      (text, duration) => events.emit('bannerRequested', { text, duration })
    );
  }

  public dispose(): void {
    this.tracks.clear();
    this.cachedStreetLanes.clear();
    this.activeChunkTrafficSpawns.length = 0;
    this.ctx = null;
  }
}
