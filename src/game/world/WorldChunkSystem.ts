import * as THREE from 'three';
import {
  CHUNK_FULL_DISTANCE_RATIO,
  CHUNK_HYSTERESIS,
  CHUNK_MAX_BUILDS_PER_FRAME,
  CHUNK_UNLOAD_DISPOSE_MARGIN,
  QUALITY_SETTINGS,
  QualityPreset,
  WORLD_CHUNK_SIZE,
} from '../config';
import { EngineContext, GameSystem } from '../core/SystemLifecycle';

import { BuildingSpec } from './WorldRegistry';

export type ChunkLodState = 'unloaded' | 'impostor' | 'full';

export type ChunkNpcRegion = 'city' | 'promenade' | 'beach' | 'night_bar';

export interface ChunkNpcSpawn {
  x: number;
  z: number;
  region: ChunkNpcRegion;
  nodeId: number;
}

export interface ChunkTrafficSpawn {
  streetId: string;
  x: number;
  z: number;
  heading: number;
  laneOffset: number;
}

export interface ChunkMetadata {
  buildings: BuildingSpec[];
  propsCount: number;
  furnitureInstances: number;
  npcSpawns: ChunkNpcSpawn[];
  trafficSpawns: ChunkTrafficSpawn[];
}

export interface ChunkStreamingStats {
  total: number;
  full: number;
  impostor: number;
  unloaded: number;
}

export interface WorldChunkEntry {
  cx: number;
  cz: number;
  key: string;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  state: ChunkLodState;
  fullBuilt: boolean;
  fullGroup: THREE.Group | null;
  impostorMesh: THREE.Mesh | null;
  buildFullGroup: () => THREE.Group;
  buildImpostorMesh: () => THREE.Mesh | null;
  lastDistSq: number;
  metadata: ChunkMetadata;
}

export function worldToChunkCoord(val: number, chunkSize = WORLD_CHUNK_SIZE): number {
  return Math.floor(val / chunkSize);
}

export function getChunkKey(cx: number, cz: number): string {
  return `${cx},${cz}`;
}

export function computeDistanceToChunkBoundsSq(
  px: number,
  pz: number,
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number
): number {
  const dx = px < minX ? minX - px : px > maxX ? px - maxX : 0;
  const dz = pz < minZ ? minZ - pz : pz > maxZ ? pz - maxZ : 0;
  return dx * dx + dz * dz;
}

/**
 * Resolve o próximo estado de LOD/streaming de um chunk considerando drawDistance e histerese.
 */
export function evaluateTargetChunkState(
  currentState: ChunkLodState,
  distSq: number,
  fullDist: number,
  drawDistance: number,
  hysteresis = CHUNK_HYSTERESIS
): ChunkLodState {
  const fullEnterSq = fullDist * fullDist;
  const fullExitSq = (fullDist + hysteresis) * (fullDist + hysteresis);
  const drawEnterSq = drawDistance * drawDistance;
  const drawExitSq = (drawDistance + hysteresis) * (drawDistance + hysteresis);

  if (currentState === 'full') {
    if (distSq <= fullExitSq) return 'full';
    if (distSq <= drawExitSq) return 'impostor';
    return 'unloaded';
  }

  if (currentState === 'impostor') {
    if (distSq <= fullEnterSq) return 'full';
    if (distSq <= drawExitSq) return 'impostor';
    return 'unloaded';
  }

  // currentState === 'unloaded'
  if (distSq <= fullEnterSq) return 'full';
  if (distSq <= drawEnterSq) return 'impostor';
  return 'unloaded';
}

function disposeChunkOwnedGeometries(root: THREE.Object3D): void {
  const disposed = new Set<THREE.BufferGeometry>();
  root.traverse((obj) => {
    if (obj instanceof THREE.InstancedMesh) {
      obj.dispose();
    }
    if (obj instanceof THREE.Mesh || obj instanceof THREE.Line || obj instanceof THREE.Points) {
      const geo = obj.geometry;
      if (geo && !geo.userData?.chunkBlueprintShared && !disposed.has(geo)) {
        disposed.add(geo);
        geo.dispose();
      }
    }
  });
}

/**
 * Gerenciador espacial de chunks 64×64 m com streaming por drawDistance,
 * impostores low-poly distantes, orçamento de montagem por frame e descarte seguro.
 */
export class WorldChunkManager {
  private readonly scene: THREE.Scene;
  private readonly chunkSize: number;
  private readonly chunks = new Map<string, WorldChunkEntry>();
  private readonly chunkList: WorldChunkEntry[] = [];
  private readonly pendingFullUpgrades: WorldChunkEntry[] = [];
  private readonly sharedGeometriesToDispose: THREE.BufferGeometry[] = [];
  private readonly sharedMaterialsToDispose: THREE.Material[] = [];

  public readonly stats: ChunkStreamingStats = {
    total: 0,
    full: 0,
    impostor: 0,
    unloaded: 0,
  };

  private lastSyncX = Number.NaN;
  private lastSyncZ = Number.NaN;
  private lastSyncDrawDist = -1;

  constructor(scene: THREE.Scene, chunkSize = WORLD_CHUNK_SIZE) {
    this.scene = scene;
    this.chunkSize = chunkSize;
  }

  public registerSharedResources(
    geometries: THREE.BufferGeometry[],
    materials: THREE.Material[]
  ): void {
    for (const g of geometries) {
      g.userData.chunkBlueprintShared = true;
      this.sharedGeometriesToDispose.push(g);
    }
    for (const m of materials) {
      this.sharedMaterialsToDispose.push(m);
    }
  }

  public registerChunk(
    cx: number,
    cz: number,
    buildFullGroup: () => THREE.Group,
    buildImpostorMesh: () => THREE.Mesh | null,
    metadata?: Partial<ChunkMetadata>
  ): WorldChunkEntry {
    const key = getChunkKey(cx, cz);
    const existing = this.chunks.get(key);
    if (existing) {
      if (metadata) {
        if (metadata.buildings) existing.metadata.buildings.push(...metadata.buildings);
        if (metadata.propsCount !== undefined) existing.metadata.propsCount += metadata.propsCount;
        if (metadata.furnitureInstances !== undefined) {
          existing.metadata.furnitureInstances += metadata.furnitureInstances;
        }
        if (metadata.npcSpawns) existing.metadata.npcSpawns.push(...metadata.npcSpawns);
        if (metadata.trafficSpawns) existing.metadata.trafficSpawns.push(...metadata.trafficSpawns);
      }
      return existing;
    }

    const minX = cx * this.chunkSize;
    const minZ = cz * this.chunkSize;
    const entry: WorldChunkEntry = {
      cx,
      cz,
      key,
      minX,
      maxX: minX + this.chunkSize,
      minZ,
      maxZ: minZ + this.chunkSize,
      state: 'unloaded',
      fullBuilt: false,
      fullGroup: null,
      impostorMesh: null,
      buildFullGroup,
      buildImpostorMesh,
      lastDistSq: Infinity,
      metadata: {
        buildings: metadata?.buildings ? [...metadata.buildings] : [],
        propsCount: metadata?.propsCount ?? 0,
        furnitureInstances: metadata?.furnitureInstances ?? 0,
        npcSpawns: metadata?.npcSpawns ? [...metadata.npcSpawns] : [],
        trafficSpawns: metadata?.trafficSpawns ? [...metadata.trafficSpawns] : [],
      },
    };

    this.chunks.set(key, entry);
    this.chunkList.push(entry);
    this.stats.total = this.chunkList.length;
    this.stats.unloaded++;
    return entry;
  }

  public getChunk(cx: number, cz: number): WorldChunkEntry | undefined {
    return this.chunks.get(getChunkKey(cx, cz));
  }

  public getChunkAtWorld(x: number, z: number): WorldChunkEntry | undefined {
    return this.getChunk(
      worldToChunkCoord(x, this.chunkSize),
      worldToChunkCoord(z, this.chunkSize)
    );
  }

  public populateNpcSpawnsFromGraph(
    nodes: ReadonlyArray<{ id: number; x: number; z: number; region: ChunkNpcRegion }>
  ): void {
    for (let i = 0; i < this.chunkList.length; i++) {
      this.chunkList[i].metadata.npcSpawns.length = 0;
    }
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      const chunk = this.getChunkAtWorld(node.x, node.z);
      if (!chunk) continue;
      chunk.metadata.npcSpawns.push({
        x: node.x,
        z: node.z,
        region: node.region,
        nodeId: node.id,
      });
    }
  }

  public registerTrafficSpawns(spawns: ReadonlyArray<ChunkTrafficSpawn>): void {
    for (let i = 0; i < this.chunkList.length; i++) {
      this.chunkList[i].metadata.trafficSpawns.length = 0;
    }
    for (let i = 0; i < spawns.length; i++) {
      const s = spawns[i];
      const chunk = this.getChunkAtWorld(s.x, s.z);
      if (!chunk) continue;
      chunk.metadata.trafficSpawns.push(s);
    }
  }

  public getLoadedNpcSpawns(out: ChunkNpcSpawn[], includeImpostor = false): ChunkNpcSpawn[] {
    out.length = 0;
    for (let i = 0; i < this.chunkList.length; i++) {
      const ch = this.chunkList[i];
      if (ch.state === 'full' || (includeImpostor && ch.state === 'impostor')) {
        const list = ch.metadata.npcSpawns;
        for (let j = 0; j < list.length; j++) {
          out.push(list[j]);
        }
      }
    }
    return out;
  }

  public getLoadedTrafficSpawns(
    out: ChunkTrafficSpawn[],
    includeImpostor = true
  ): ChunkTrafficSpawn[] {
    out.length = 0;
    for (let i = 0; i < this.chunkList.length; i++) {
      const ch = this.chunkList[i];
      if (ch.state === 'full' || (includeImpostor && ch.state === 'impostor')) {
        const list = ch.metadata.trafficSpawns;
        for (let j = 0; j < list.length; j++) {
          out.push(list[j]);
        }
      }
    }
    return out;
  }

  public getAllChunks(): readonly WorldChunkEntry[] {
    return this.chunkList;
  }

  public syncAround(
    refX: number,
    refZ: number,
    drawDistance: number,
    immediate = false,
    maxBuildsPerFrame = CHUNK_MAX_BUILDS_PER_FRAME
  ): void {
    const movedDist = Number.isNaN(this.lastSyncX)
      ? Infinity
      : Math.hypot(refX - this.lastSyncX, refZ - this.lastSyncZ);

    // Só evita reprocessar se nada se moveu, o drawDistance não mudou e não há upgrades pendentes
    if (
      !immediate &&
      movedDist < 2.0 &&
      Math.abs(drawDistance - this.lastSyncDrawDist) < 0.5 &&
      this.pendingFullUpgrades.length === 0
    ) {
      return;
    }

    this.lastSyncX = refX;
    this.lastSyncZ = refZ;
    this.lastSyncDrawDist = drawDistance;

    const fullDist = drawDistance * CHUNK_FULL_DISTANCE_RATIO;
    const disposeDistSq =
      (drawDistance + CHUNK_UNLOAD_DISPOSE_MARGIN) * (drawDistance + CHUNK_UNLOAD_DISPOSE_MARGIN);

    this.pendingFullUpgrades.length = 0;

    let fullCount = 0;
    let impostorCount = 0;
    let unloadedCount = 0;

    for (let i = 0; i < this.chunkList.length; i++) {
      const ch = this.chunkList[i];
      const distSq = computeDistanceToChunkBoundsSq(refX, refZ, ch.minX, ch.maxX, ch.minZ, ch.maxZ);
      ch.lastDistSq = distSq;

      const target = evaluateTargetChunkState(ch.state, distSq, fullDist, drawDistance);

      if (target === 'full') {
        if (ch.fullBuilt && ch.fullGroup) {
          this.mountFull(ch);
          ch.state = 'full';
          fullCount++;
        } else {
          // Agenda construção completa; mantém impostor temporário enquanto aguarda orçamento do frame
          this.pendingFullUpgrades.push(ch);
        }
      } else if (target === 'impostor') {
        this.mountImpostor(ch);
        ch.state = 'impostor';
        impostorCount++;
      } else {
        this.unmountChunk(ch, distSq > disposeDistSq);
        ch.state = 'unloaded';
        unloadedCount++;
      }
    }

    if (this.pendingFullUpgrades.length > 0) {
      if (this.pendingFullUpgrades.length > 1) {
        this.pendingFullUpgrades.sort((a, b) => a.lastDistSq - b.lastDistSq);
      }

      const budget = immediate ? this.pendingFullUpgrades.length : maxBuildsPerFrame;
      let built = 0;

      for (let i = 0; i < this.pendingFullUpgrades.length; i++) {
        const ch = this.pendingFullUpgrades[i];
        if (built < budget) {
          if (!ch.fullBuilt || !ch.fullGroup) {
            ch.fullGroup = ch.buildFullGroup();
            ch.fullBuilt = true;
            built++;
          }
          this.mountFull(ch);
          ch.state = 'full';
          fullCount++;
        } else {
          // Enquanto espera próximo frame, exibe impostor para não haver buraco no terreno
          this.mountImpostor(ch);
          if (ch.impostorMesh) {
            ch.state = 'impostor';
            impostorCount++;
          } else {
            ch.state = 'unloaded';
            unloadedCount++;
          }
        }
      }
    }

    this.stats.total = this.chunkList.length;
    this.stats.full = fullCount;
    this.stats.impostor = impostorCount;
    this.stats.unloaded = unloadedCount;
  }

  private mountFull(ch: WorldChunkEntry): void {
    if (ch.impostorMesh && ch.impostorMesh.parent === this.scene) {
      this.scene.remove(ch.impostorMesh);
    }
    if (ch.fullGroup && ch.fullGroup.parent !== this.scene) {
      this.scene.add(ch.fullGroup);
    }
  }

  private mountImpostor(ch: WorldChunkEntry): void {
    if (ch.fullGroup && ch.fullGroup.parent === this.scene) {
      this.scene.remove(ch.fullGroup);
    }
    if (!ch.impostorMesh) {
      ch.impostorMesh = ch.buildImpostorMesh();
    }
    if (ch.impostorMesh && ch.impostorMesh.parent !== this.scene) {
      this.scene.add(ch.impostorMesh);
    }
  }

  private unmountChunk(ch: WorldChunkEntry, releaseFullGeometries: boolean): void {
    if (ch.fullGroup && ch.fullGroup.parent === this.scene) {
      this.scene.remove(ch.fullGroup);
    }
    if (ch.impostorMesh && ch.impostorMesh.parent === this.scene) {
      this.scene.remove(ch.impostorMesh);
    }
    if (releaseFullGeometries && ch.fullBuilt && ch.fullGroup) {
      disposeChunkOwnedGeometries(ch.fullGroup);
      ch.fullGroup = null;
      ch.fullBuilt = false;
    }
  }

  public dispose(): void {
    for (let i = 0; i < this.chunkList.length; i++) {
      const ch = this.chunkList[i];
      if (ch.fullGroup) {
        if (ch.fullGroup.parent === this.scene) this.scene.remove(ch.fullGroup);
        disposeChunkOwnedGeometries(ch.fullGroup);
        ch.fullGroup = null;
        ch.fullBuilt = false;
      }
      if (ch.impostorMesh) {
        if (ch.impostorMesh.parent === this.scene) this.scene.remove(ch.impostorMesh);
        if (ch.impostorMesh.geometry) ch.impostorMesh.geometry.dispose();
        ch.impostorMesh = null;
      }
      ch.state = 'unloaded';
    }
    for (const g of this.sharedGeometriesToDispose) {
      g.dispose();
    }
    this.sharedGeometriesToDispose.length = 0;
    for (const m of this.sharedMaterialsToDispose) {
      m.dispose();
    }
    this.sharedMaterialsToDispose.length = 0;
    this.pendingFullUpgrades.length = 0;
    this.chunks.clear();
    this.chunkList.length = 0;
    this.stats.total = 0;
    this.stats.full = 0;
    this.stats.impostor = 0;
    this.stats.unloaded = 0;
  }
}

/**
 * Subsistema GameSystem responsável pelo streaming contínuo dos chunks de 64×64 m
 * conforme a posição do jogador e o alcance drawDistance do preset de qualidade ativo.
 */
export class ChunkStreamingSystem implements GameSystem {
  public readonly name = 'ChunkStreamingSystem';

  private ctx: EngineContext | null = null;
  private drawDistance = QUALITY_SETTINGS.medium.drawDistance;

  public init(ctx: EngineContext): void {
    this.ctx = ctx;
    this.syncTelemetry(true);
  }

  public setQualityPreset(preset: QualityPreset, immediate = true): void {
    this.drawDistance = QUALITY_SETTINGS[preset].drawDistance;
    if (this.ctx) {
      this.syncTelemetry(immediate);
    }
  }

  public forceSyncAroundPlayer(): void {
    this.syncTelemetry(true);
  }

  public update(_dt: number): void {
    this.syncTelemetry(false);
  }

  private syncTelemetry(immediate: boolean): void {
    if (!this.ctx) return;
    const { world, state } = this.ctx;
    world.chunkManager.syncAround(state.playerPos.x, state.playerPos.z, this.drawDistance, immediate);
    const s = world.chunkManager.stats;
    state.renderTelemetry.chunksTotal = s.total;
    state.renderTelemetry.chunksFull = s.full;
    state.renderTelemetry.chunksImpostor = s.impostor;
    state.renderTelemetry.chunksUnloaded = s.unloaded;
  }

  public dispose(): void {
    this.ctx = null;
  }
}
