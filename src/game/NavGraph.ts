import * as THREE from 'three';
import { WORLD_CHUNK_SIZE } from './config';
import { getChunkKey, worldToChunkCoord } from './world/WorldChunkSystem';
import {
  CANAL_SPEC,
  getCoastlineX,
  getTerrainHeightAt,
  INTERSECTIONS,
  STREETS,
  TUNEL_SPEC,
  WORLD_POIS,
} from './world/WorldRegistry';

export type WaypointRegion = 'city' | 'promenade' | 'beach' | 'night_bar';

export type WaypointPoiKind =
  | 'none'
  | 'bench'
  | 'stall'
  | 'bus_stop'
  | 'volleyball'
  | 'beach_dance'
  | 'night_bar';

export interface NavNode {
  id: number;
  x: number;
  y: number;
  z: number;
  region: WaypointRegion;
  poiKind: WaypointPoiKind;
  poiYaw?: number;
  chunkX: number;
  chunkZ: number;
  chunkKey: string;
  isChunkBorder: boolean;
  edges: NavEdge[];
}

export interface NavEdge {
  to: number;
  distance: number;
  isCrosswalk: boolean;
  /** 'ns' = atravessa rua horizontal (movimento Norte-Sul); 'ew' = atravessa avenida vertical */
  crossAxis?: 'ns' | 'ew';
  isInterChunk: boolean;
  fromChunkKey: string;
  toChunkKey: string;
}

export interface InterChunkLink {
  fromNodeId: number;
  toNodeId: number;
  fromChunkKey: string;
  toChunkKey: string;
  distance: number;
  isCrosswalk: boolean;
  crossAxis?: 'ns' | 'ew';
}

export interface ChunkNavGraph {
  chunkX: number;
  chunkZ: number;
  chunkKey: string;
  nodeIds: number[];
  borderNodeIds: number[];
  connectedNeighborKeys: string[];
  interChunkLinks: InterChunkLink[];
}

/**
 * Grafo de navegação hierárquico (subgrafo por chunk 64×64 m + conexões entre chunks),
 * com esquinas, faixas de pedestres e semáforos gerados por cruzamento a partir do WorldRegistry.
 */
export class NavGraph {
  public readonly nodes: NavNode[] = [];
  private signalTimer = 0;
  private nsGreen = true;
  private ewGreen = false;
  private debugGroup: THREE.Group | null = null;
  private intersectionCornerNodes = new Map<number, number[]>();
  private roundaboutRingNodes: number[][] = [];
  private chunkGraphs = new Map<string, ChunkNavGraph>();
  private interChunkLinks: InterChunkLink[] = [];

  constructor() {
    this.buildSidewalkGrid();
    this.buildDistrictWalkways();
    this.buildPromenadeAndBeach();
    this.buildPoiNodes();
    this.ensureFullConnectivity();
    this.rebuildChunkHierarchy();
  }

  private addNode(
    x: number,
    z: number,
    region: WaypointRegion,
    poiKind: WaypointPoiKind = 'none',
    poiYaw?: number,
    hintY = 6
  ): number {
    const id = this.nodes.length;
    const y = getTerrainHeightAt(x, z, hintY);
    const chunkX = worldToChunkCoord(x, WORLD_CHUNK_SIZE);
    const chunkZ = worldToChunkCoord(z, WORLD_CHUNK_SIZE);
    const chunkKey = getChunkKey(chunkX, chunkZ);
    this.nodes.push({
      id,
      x,
      y,
      z,
      region,
      poiKind,
      poiYaw,
      chunkX,
      chunkZ,
      chunkKey,
      isChunkBorder: false,
      edges: [],
    });
    return id;
  }

  private hasEdge(aId: number, bId: number): boolean {
    return this.nodes[aId].edges.some((e) => e.to === bId);
  }

  private addBidirectionalEdge(
    aId: number,
    bId: number,
    isCrosswalk = false,
    crossAxis?: 'ns' | 'ew'
  ): void {
    if (aId === bId || this.hasEdge(aId, bId)) return;
    const a = this.nodes[aId];
    const b = this.nodes[bId];
    const dist = Math.hypot(b.x - a.x, b.z - a.z);
    const isInterChunk = a.chunkKey !== b.chunkKey;
    a.edges.push({
      to: bId,
      distance: dist,
      isCrosswalk,
      crossAxis,
      isInterChunk,
      fromChunkKey: a.chunkKey,
      toChunkKey: b.chunkKey,
    });
    b.edges.push({
      to: aId,
      distance: dist,
      isCrosswalk,
      crossAxis,
      isInterChunk,
      fromChunkKey: b.chunkKey,
      toChunkKey: a.chunkKey,
    });
  }

  /**
   * Gera esquinas e faixas de pedestres por cruzamento a partir de INTERSECTIONS,
   * anéis externos de rotatórias e cadeias de calçada ao longo das ruas.
   */
  private buildSidewalkGrid(): void {
    // 1. Esquinas e faixas de pedestres geradas por cruzamento (4 mãos, T, L ou curva costeira)
    for (let idx = 0; idx < INTERSECTIONS.length; idx++) {
      const inter = INTERSECTIONS[idx];
      if (inter.isRoundabout) continue;

      const localCorners: Array<{ id: number; angle: number }> = [];
      const getOrCreateCorner = (cx: number, cz: number): number => {
        for (const c of localCorners) {
          const n = this.nodes[c.id];
          if ((n.x - cx) ** 2 + (n.z - cz) ** 2 < 5.2 * 5.2) {
            return c.id;
          }
        }
        const id = this.reuseNearbyNodeOrAdd(cx, cz, 'city', 2.4);
        const n = this.nodes[id];
        localCorners.push({ id, angle: Math.atan2(n.z - inter.z, n.x - inter.x) });
        return id;
      };

      for (const cw of inter.crosswalks) {
        const idA = getOrCreateCorner(cw.cornerAX, cw.cornerAZ);
        const idB = getOrCreateCorner(cw.cornerBX, cw.cornerBZ);
        this.addBidirectionalEdge(idA, idB, cw.hasSignal, cw.hasSignal ? cw.crossAxis : undefined);
      }

      // Cruzamentos sem faixa (ex.: entroncamentos só com viela): cria cantos externos nos bissetores
      if (inter.crosswalks.length === 0 && inter.arms.length >= 2) {
        for (let k = 0; k < inter.arms.length; k++) {
          const armA = inter.arms[k];
          const armB = inter.arms[(k + 1) % inter.arms.length];
          let gap = armB.angle - armA.angle;
          if (gap <= 0) gap += Math.PI * 2;
          if (gap > Math.PI * 0.9) continue;
          const midA = armA.angle + gap * 0.5;
          const off = Math.max(armA.streetWidth, armB.streetWidth) * 0.5 + 1.8;
          getOrCreateCorner(inter.x + Math.cos(midA) * off, inter.z + Math.sin(midA) * off);
        }
      }

      // Fecha calçadas contínuas entre esquinas consecutivas quando não há faixa/rua entre elas (ex.: cruzamento em T)
      if (localCorners.length >= 2) {
        localCorners.sort((a, b) => a.angle - b.angle);
        for (let k = 0; k < localCorners.length; k++) {
          const cA = localCorners[k];
          const cB = localCorners[(k + 1) % localCorners.length];
          let gap = cB.angle - cA.angle;
          if (gap <= 0) gap += Math.PI * 2;
          if (gap > Math.PI * 0.95) continue;

          const hasCrosswalkArmInside = inter.arms.some((arm) => {
            if (!arm.hasCrosswalk) return false;
            let rel = arm.angle - cA.angle;
            while (rel < 0) rel += Math.PI * 2;
            while (rel >= Math.PI * 2) rel -= Math.PI * 2;
            return rel > 0.12 && rel < gap - 0.12;
          });

          if (!hasCrosswalkArmInside) {
            this.addBidirectionalEdge(cA.id, cB.id, false);
          }
        }
      }

      this.intersectionCornerNodes.set(
        idx,
        localCorners.map((c) => c.id)
      );
    }

    // 2. Anéis externos de calçada e travessias de aproximação ao redor das rotatórias
    for (const s of STREETS) {
      if (s.kind !== 'roundabout' || !s.roundabout) continue;
      const rb = s.roundabout;
      const ringR = rb.outerRadius + 2.0;
      const ringNodes: number[] = [];
      const steps = 8;
      for (let i = 0; i < steps; i++) {
        const a = (i / steps) * Math.PI * 2;
        ringNodes.push(
          this.addNode(rb.centerX + Math.cos(a) * ringR, rb.centerZ + Math.sin(a) * ringR, 'city')
        );
      }
      for (let i = 0; i < steps; i++) {
        this.addBidirectionalEdge(ringNodes[i], ringNodes[(i + 1) % steps], false);
      }
      this.roundaboutRingNodes.push(ringNodes);

      const rbInter = INTERSECTIONS.find(
        (it) => it.isRoundabout && Math.hypot(it.x - rb.centerX, it.z - rb.centerZ) < 2.5
      );
      if (rbInter) {
        for (const cw of rbInter.crosswalks) {
          const idA = this.reuseNearbyNodeOrAdd(cw.cornerAX, cw.cornerAZ, 'city', 4.5);
          const idB = this.reuseNearbyNodeOrAdd(cw.cornerBX, cw.cornerBZ, 'city', 4.5);
          this.addBidirectionalEdge(idA, idB, false);
          this.connectNodeToList(idA, ringNodes);
          this.connectNodeToList(idB, ringNodes);
        }
      }
    }

    // 3. Cadeias de calçada ao longo dos trechos de cada rua (avenidas, secundárias, costeira e vielas)
    for (const s of STREETS) {
      if (s.kind === 'roundabout') continue;

      if (s.kind === 'alley') {
        for (const seg of s.segments) {
          const steps = Math.max(2, Math.round(seg.length / 24));
          let prevId = -1;
          for (let k = 0; k <= steps; k++) {
            const t = k / steps;
            const px = seg.x1 + (seg.x2 - seg.x1) * t;
            const pz = seg.z1 + (seg.z2 - seg.z1) * t;
            const id = this.addNode(px, pz, 'city');
            if (prevId !== -1) this.addBidirectionalEdge(prevId, id);
            if (k === 0 || k === steps) this.connectToNearestCitySidewalk(id, 24);
            prevId = id;
          }
        }
        continue;
      }

      const sideOffset = s.width * 0.5 + 1.8;
      for (const seg of s.segments) {
        const perpX = seg.dirZ;
        const perpZ = -seg.dirX;
        const steps = Math.max(1, Math.round(seg.length / 32));
        let prevLeft = -1;
        let prevRight = -1;

        for (let k = 0; k <= steps; k++) {
          const t = k / steps;
          const cx = seg.x1 + (seg.x2 - seg.x1) * t;
          const cz = seg.z1 + (seg.z2 - seg.z1) * t;

          const lx = cx + perpX * sideOffset;
          const lz = cz + perpZ * sideOffset;
          const rx = cx - perpX * sideOffset;
          const rz = cz - perpZ * sideOffset;

          const leftId = this.reuseNearbyNodeOrAdd(lx, lz, 'city', 5.0);
          const rightId = this.reuseNearbyNodeOrAdd(rx, rz, 'city', 5.0);

          if (prevLeft !== -1) this.addBidirectionalEdge(prevLeft, leftId);
          if (prevRight !== -1) this.addBidirectionalEdge(prevRight, rightId);

          if (k === 0 || k === steps || s.kind === 'coastal') {
            this.connectNearIntersections(leftId, 16);
            this.connectNearIntersections(rightId, 16);
          }

          prevLeft = leftId;
          prevRight = rightId;
        }
      }
    }
  }

  private connectNodeToList(nodeId: number, candidates: number[]): void {
    const n = this.nodes[nodeId];
    let bestId = -1;
    let bestD2 = Infinity;
    for (const cid of candidates) {
      if (cid === nodeId) continue;
      const c = this.nodes[cid];
      const d2 = (c.x - n.x) ** 2 + (c.z - n.z) ** 2;
      if (d2 < bestD2) {
        bestD2 = d2;
        bestId = cid;
      }
    }
    if (bestId !== -1) {
      this.addBidirectionalEdge(nodeId, bestId);
    }
  }

  private reuseNearbyNodeOrAdd(
    x: number,
    z: number,
    region: WaypointRegion,
    snapRadius: number
  ): number {
    const r2 = snapRadius * snapRadius;
    let bestId = -1;
    let bestD2 = r2;
    for (let i = 0; i < this.nodes.length; i++) {
      const n = this.nodes[i];
      if (n.region !== region) continue;
      const d2 = (n.x - x) ** 2 + (n.z - z) ** 2;
      if (d2 < bestD2) {
        bestD2 = d2;
        bestId = i;
      }
    }
    return bestId !== -1 ? bestId : this.addNode(x, z, region);
  }

  private connectNearIntersections(nodeId: number, maxDist: number): void {
    const n = this.nodes[nodeId];
    const maxD2 = maxDist * maxDist;
    let bestId = -1;
    let bestD2 = maxD2;
    for (const cornerIds of this.intersectionCornerNodes.values()) {
      for (const cid of cornerIds) {
        if (cid === nodeId) continue;
        const c = this.nodes[cid];
        const d2 = (c.x - n.x) ** 2 + (c.z - n.z) ** 2;
        if (d2 < bestD2) {
          bestD2 = d2;
          bestId = cid;
        }
      }
    }
    for (const ring of this.roundaboutRingNodes) {
      for (const cid of ring) {
        if (cid === nodeId) continue;
        const c = this.nodes[cid];
        const d2 = (c.x - n.x) ** 2 + (c.z - n.z) ** 2;
        if (d2 < bestD2) {
          bestD2 = d2;
          bestId = cid;
        }
      }
    }
    if (bestId !== -1) {
      this.addBidirectionalEdge(nodeId, bestId);
    }
  }

  private connectToNearestCitySidewalk(nodeId: number, maxDist: number): void {
    const n = this.nodes[nodeId];
    const maxD2 = maxDist * maxDist;
    let bestId = -1;
    let bestD2 = maxD2;
    for (let i = 0; i < this.nodes.length; i++) {
      if (i === nodeId) continue;
      const o = this.nodes[i];
      if (o.region !== 'city') continue;
      const d2 = (o.x - n.x) ** 2 + (o.z - n.z) ** 2;
      if (d2 < bestD2) {
        bestD2 = d2;
        bestId = i;
      }
    }
    if (bestId !== -1) this.addBidirectionalEdge(nodeId, bestId);
  }

  /**
   * Adiciona trilhas, escadarias e ladeiras nos novos distritos (Morro da Brisa, Parque, Campus e Heliponto).
   */
  private buildDistrictWalkways(): void {
    // 1. Morro da Brisa: duas ladeiras (x=-250, x=-160), escadaria central (x=-202) e dois terraços
    const buildSlopeChain = (x: number, zPoints: number[]) => {
      let prev = -1;
      for (const z of zPoints) {
        const id = this.addNode(x, z, 'city');
        if (prev !== -1) this.addBidirectionalEdge(prev, id);
        else this.connectToNearestCitySidewalk(id, 18);
        prev = id;
      }
      return prev;
    };

    const morroZ = [-215, -228, -238, -250, -264];
    buildSlopeChain(-250, morroZ);
    buildSlopeChain(-202, morroZ);
    buildSlopeChain(-160, morroZ);

    for (const tz of [-238, -264]) {
      const xs = [-250, -226, -202, -182, -160];
      const ids = xs.map((tx) => this.reuseNearbyNodeOrAdd(tx, tz, 'city', 4.5));
      for (let i = 0; i < ids.length - 1; i++) {
        this.addBidirectionalEdge(ids[i], ids[i + 1]);
      }
    }

    // 2. Parque Atlântico: circuito pelo gramado central e lago
    const parkPts: Array<[number, number]> = [
      [-66, -220],
      [-50, -236],
      [-34, -220],
      [-50, -260],
    ];
    const parkIds = parkPts.map(([px, pz]) => this.addNode(px, pz, 'city'));
    for (let i = 0; i < parkIds.length; i++) {
      this.addBidirectionalEdge(parkIds[i], parkIds[(i + 1) % parkIds.length]);
    }
    this.connectToNearestCitySidewalk(parkIds[0], 24);
    this.connectToNearestCitySidewalk(parkIds[2], 24);

    // 3. Campus Universidade Solara: alameda do pátio entre Reitoria e Instituto
    const campusIds = [
      this.addNode(2, -216, 'city'),
      this.addNode(14, -228, 'city'),
      this.addNode(26, -228, 'city'),
      this.addNode(14, -196, 'city'),
    ];
    this.addBidirectionalEdge(campusIds[0], campusIds[1]);
    this.addBidirectionalEdge(campusIds[1], campusIds[2]);
    this.addBidirectionalEdge(campusIds[1], campusIds[3]);
    this.connectToNearestCitySidewalk(campusIds[0], 22);
    this.connectToNearestCitySidewalk(campusIds[3], 22);

    // 4. Heliponto & Terminal Aéreo: passarela da Rua da Enseada até hangar, pátio H e torre
    const heliIds = [
      this.addNode(-188, 214, 'city'),
      this.addNode(-188, 238, 'city'),
      this.addNode(-228, 242, 'city'),
      this.addNode(-102, 244, 'city'),
      this.addNode(-102, 214, 'city'),
    ];
    this.addBidirectionalEdge(heliIds[0], heliIds[1]);
    this.addBidirectionalEdge(heliIds[1], heliIds[2]);
    this.addBidirectionalEdge(heliIds[3], heliIds[4]);
    this.connectToNearestCitySidewalk(heliIds[0], 20);
    this.connectToNearestCitySidewalk(heliIds[4], 20);

    // 5. Trilha elevada sobre a Colina do Túnel do Parque
    const tunnelTopIds = [
      this.addNode(TUNEL_SPEC.xCenter - 20, -176, 'city'),
      this.addNode(TUNEL_SPEC.xCenter, -176, 'city'),
      this.addNode(TUNEL_SPEC.xCenter + 20, -176, 'city'),
    ];
    this.addBidirectionalEdge(tunnelTopIds[0], tunnelTopIds[1]);
    this.addBidirectionalEdge(tunnelTopIds[1], tunnelTopIds[2]);
    this.connectToNearestCitySidewalk(tunnelTopIds[0], 24);
    this.connectToNearestCitySidewalk(tunnelTopIds[2], 24);
  }

  /**
   * Cria a malha contínua do calçadão curvo (cruzando o Canal pela Passarela da Orla) e da praia de areia.
   */
  private buildPromenadeAndBeach(): void {
    const promIds: number[] = [];
    let insertedFootbridge = false;
    for (let z = -240; z <= 240; z += 24) {
      if (!insertedFootbridge && z > CANAL_SPEC.zCenter) {
        const bridgeX = getCoastlineX(CANAL_SPEC.zCenter) - 6.5;
        const bridgeId = this.addNode(bridgeX, CANAL_SPEC.zCenter, 'promenade');
        promIds.push(bridgeId);
        this.connectToNearestCitySidewalk(bridgeId, 24);
        insertedFootbridge = true;
      }
      const px = getCoastlineX(z) - 6.5;
      const pId = this.addNode(px, z, 'promenade');
      promIds.push(pId);
      this.connectToNearestCitySidewalk(pId, 20);
    }
    for (let i = 0; i < promIds.length - 1; i++) {
      this.addBidirectionalEdge(promIds[i], promIds[i + 1]);
    }

    const beachIds: number[] = [];
    for (let z = -220; z <= 220; z += 28) {
      const bx = getCoastlineX(z) + 8.5;
      const kind: WaypointPoiKind =
        Math.abs(z - 14) < 12
          ? 'volleyball'
          : Math.abs(z + 20) < 12 || Math.abs(z - 70) < 12
          ? 'beach_dance'
          : 'none';
      const bId = this.addNode(bx, z, 'beach', kind);
      beachIds.push(bId);
    }
    for (let i = 0; i < beachIds.length - 1; i++) {
      const nA = this.nodes[beachIds[i]];
      const nB = this.nodes[beachIds[i + 1]];
      if (nA.z < CANAL_SPEC.zMin && nB.z > CANAL_SPEC.zMax) continue;
      this.addBidirectionalEdge(beachIds[i], beachIds[i + 1]);
    }

    for (let i = 0; i < beachIds.length; i++) {
      const bn = this.nodes[beachIds[i]];
      let bestProm = promIds[0];
      let bestD2 = Infinity;
      for (const pid of promIds) {
        const pn = this.nodes[pid];
        if ((bn.z < CANAL_SPEC.zMin && pn.z > CANAL_SPEC.zMax) || (bn.z > CANAL_SPEC.zMax && pn.z < CANAL_SPEC.zMin)) {
          continue;
        }
        const d2 = (pn.x - bn.x) ** 2 + (pn.z - bn.z) ** 2;
        if (d2 < bestD2) {
          bestD2 = d2;
          bestProm = pid;
        }
      }
      this.addBidirectionalEdge(bestProm, beachIds[i]);
    }
  }

  private buildPoiNodes(): void {
    for (const b of WORLD_POIS.benches) {
      const coastX = getCoastlineX(b.z);
      const nId = this.addNode(b.seatX, b.seatZ, b.x > coastX - 20 ? 'promenade' : 'city', 'bench', b.yaw);
      this.connectToNearest(nId, 22);
    }

    for (const s of WORLD_POIS.stalls) {
      const coastX = getCoastlineX(s.z);
      const reg: WaypointRegion = s.x > coastX ? 'beach' : s.x > coastX - 20 ? 'promenade' : 'city';
      const nId = this.addNode(s.customerX, s.customerZ, reg, 'stall', s.yaw);
      this.connectToNearest(nId, 22);
    }

    for (const bs of WORLD_POIS.busStops) {
      const nId = this.addNode(bs.waitX, bs.waitZ, 'city', 'bus_stop', bs.yaw);
      this.connectToNearest(nId, 22);
    }

    const vc = WORLD_POIS.volleyballCenter;
    const volleySpots: Array<[number, number, number]> = [
      [vc.x - 2.6, vc.z - 1.8, Math.PI / 2],
      [vc.x - 2.6, vc.z + 1.8, Math.PI / 2],
      [vc.x + 2.6, vc.z - 1.8, -Math.PI / 2],
      [vc.x + 2.6, vc.z + 1.8, -Math.PI / 2],
    ];
    for (const [vx, vz, vyaw] of volleySpots) {
      const nId = this.addNode(vx, vz, 'beach', 'volleyball', vyaw);
      this.connectToNearest(nId, 16);
    }

    for (const bar of WORLD_POIS.nightBars) {
      const nId = this.addNode(bar.x, bar.z + 2.2, 'night_bar', 'night_bar', 0);
      this.connectToNearest(nId, 26);
    }
  }

  private connectToNearest(nodeId: number, maxDist: number): void {
    const node = this.nodes[nodeId];
    let bestId = -1;
    let bestD = maxDist;
    let fallbackId = -1;
    let fallbackD = Infinity;
    for (let i = 0; i < this.nodes.length; i++) {
      if (i === nodeId) continue;
      const other = this.nodes[i];
      const d = Math.hypot(other.x - node.x, other.z - node.z);
      if (d < fallbackD) {
        fallbackD = d;
        fallbackId = i;
      }
      if (d < bestD) {
        bestD = d;
        bestId = i;
      }
    }
    const targetId = bestId !== -1 ? bestId : fallbackId;
    if (targetId !== -1) {
      this.addBidirectionalEdge(nodeId, targetId);
    }
  }

  /**
   * Garante que todos os componentes conexos do grafo estejam ligados entre si.
   */
  private ensureFullConnectivity(): void {
    const n = this.nodes.length;
    if (n === 0) return;

    const component = new Int32Array(n).fill(-1);
    let compId = 0;
    const compMembers: number[][] = [];

    for (let start = 0; start < n; start++) {
      if (component[start] !== -1) continue;
      const queue = [start];
      const members: number[] = [];
      component[start] = compId;
      while (queue.length > 0) {
        const cur = queue.pop()!;
        members.push(cur);
        for (const e of this.nodes[cur].edges) {
          if (component[e.to] === -1) {
            component[e.to] = compId;
            queue.push(e.to);
          }
        }
      }
      compMembers.push(members);
      compId++;
    }

    if (compMembers.length <= 1) return;

    const connected = new Set<number>(compMembers[0]);
    for (let c = 1; c < compMembers.length; c++) {
      let bestA = compMembers[c][0];
      let bestB = 0;
      let bestD2 = Infinity;
      for (const aId of compMembers[c]) {
        const a = this.nodes[aId];
        for (const bId of connected) {
          const b = this.nodes[bId];
          const d2 = (a.x - b.x) ** 2 + (a.z - b.z) ** 2;
          if (d2 < bestD2) {
            bestD2 = d2;
            bestA = aId;
            bestB = bId;
          }
        }
      }
      this.addBidirectionalEdge(bestA, bestB);
      for (const m of compMembers[c]) connected.add(m);
    }
  }

  /**
   * Constrói os subgrafos por chunk (64×64 m) e indexa as conexões inter-chunk.
   */
  private rebuildChunkHierarchy(): void {
    this.chunkGraphs.clear();
    this.interChunkLinks = [];

    for (const n of this.nodes) {
      let cg = this.chunkGraphs.get(n.chunkKey);
      if (!cg) {
        cg = {
          chunkX: n.chunkX,
          chunkZ: n.chunkZ,
          chunkKey: n.chunkKey,
          nodeIds: [],
          borderNodeIds: [],
          connectedNeighborKeys: [],
          interChunkLinks: [],
        };
        this.chunkGraphs.set(n.chunkKey, cg);
      }
      cg.nodeIds.push(n.id);

      for (const e of n.edges) {
        if (!e.isInterChunk) continue;
        n.isChunkBorder = true;
        if (!cg.borderNodeIds.includes(n.id)) {
          cg.borderNodeIds.push(n.id);
        }
        if (!cg.connectedNeighborKeys.includes(e.toChunkKey)) {
          cg.connectedNeighborKeys.push(e.toChunkKey);
        }
        const link: InterChunkLink = {
          fromNodeId: n.id,
          toNodeId: e.to,
          fromChunkKey: e.fromChunkKey,
          toChunkKey: e.toChunkKey,
          distance: e.distance,
          isCrosswalk: e.isCrosswalk,
          crossAxis: e.crossAxis,
        };
        cg.interChunkLinks.push(link);
        if (n.id < e.to) {
          this.interChunkLinks.push(link);
        }
      }
    }
  }

  public getChunkGraph(chunkX: number, chunkZ: number): ChunkNavGraph | undefined {
    return this.chunkGraphs.get(getChunkKey(chunkX, chunkZ));
  }

  public getChunkGraphAtWorld(x: number, z: number): ChunkNavGraph | undefined {
    return this.getChunkGraph(
      worldToChunkCoord(x, WORLD_CHUNK_SIZE),
      worldToChunkCoord(z, WORLD_CHUNK_SIZE)
    );
  }

  public getChunkGraphs(): Map<string, ChunkNavGraph> {
    return this.chunkGraphs;
  }

  public getInterChunkLinks(): InterChunkLink[] {
    return this.interChunkLinks;
  }

  /**
   * Atualiza o ciclo de semáforos (14s total) e sincroniza as cores nos postes 3D.
   */
  public updateTrafficSignals(
    dt: number,
    nsMats: THREE.MeshBasicMaterial[],
    ewMats: THREE.MeshBasicMaterial[]
  ): void {
    this.signalTimer = (this.signalTimer + dt) % 14;
    this.nsGreen = this.signalTimer < 6.0;
    this.ewGreen = this.signalTimer >= 7.0 && this.signalTimer < 13.0;

    const nsColor = this.nsGreen ? 0x22c55e : 0xef4444;
    const ewColor = this.ewGreen ? 0x22c55e : 0xef4444;
    for (const m of nsMats) m.color.setHex(nsColor);
    for (const m of ewMats) m.color.setHex(ewColor);
  }

  public canCrossEdge(edge: NavEdge): boolean {
    if (!edge.isCrosswalk) return true;
    return edge.crossAxis === 'ns' ? this.nsGreen : this.ewGreen;
  }

  public isVehicleAxisGreen(axis: 'x' | 'z'): boolean {
    return axis === 'z' ? this.nsGreen : this.ewGreen;
  }

  public isNsGreen(): boolean {
    return this.nsGreen;
  }

  public isEwGreen(): boolean {
    return this.ewGreen;
  }

  public getSignalLabel(): string {
    if (this.nsGreen) return 'N-S Verde';
    if (this.ewGreen) return 'L-O Verde';
    return 'Transição';
  }

  /**
   * Busca espacial indexada por chunk (3×3 chunks locais antes de varredura global).
   */
  public findClosestNode(x: number, z: number, regionFilter?: WaypointRegion): NavNode {
    const cx = worldToChunkCoord(x, WORLD_CHUNK_SIZE);
    const cz = worldToChunkCoord(z, WORLD_CHUNK_SIZE);
    let best: NavNode | null = null;
    let bestD2 = Infinity;

    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const cg = this.getChunkGraph(cx + dx, cz + dz);
        if (!cg) continue;
        for (const id of cg.nodeIds) {
          const n = this.nodes[id];
          if (regionFilter && n.region !== regionFilter) continue;
          const d2 = (n.x - x) ** 2 + (n.z - z) ** 2;
          if (d2 < bestD2) {
            bestD2 = d2;
            best = n;
          }
        }
      }
    }

    if (best) {
      const minX = (cx - 1) * WORLD_CHUNK_SIZE;
      const maxX = (cx + 2) * WORLD_CHUNK_SIZE;
      const minZ = (cz - 1) * WORLD_CHUNK_SIZE;
      const maxZ = (cz + 2) * WORLD_CHUNK_SIZE;
      const borderDist = Math.min(x - minX, maxX - x, z - minZ, maxZ - z);
      if (borderDist > 0 && bestD2 <= borderDist * borderDist) {
        return best;
      }
    }

    let globalBest = best ?? this.nodes[0];
    let globalBestD2 = best ? bestD2 : Infinity;
    for (const n of this.nodes) {
      if (regionFilter && n.region !== regionFilter) continue;
      const d2 = (n.x - x) ** 2 + (n.z - z) ** 2;
      if (d2 < globalBestD2) {
        globalBestD2 = d2;
        globalBest = n;
      }
    }
    return globalBest;
  }

  /**
   * Busca de caminho hierárquica em 2 níveis:
   * Nível 1 (grafo de chunks conectados) -> Nível 2 (A* nos nós dentro do corredor de chunks).
   */
  public findHierarchicalPath(startX: number, startZ: number, goalX: number, goalZ: number): number[] {
    if (this.nodes.length === 0) return [];
    const startNode = this.findClosestNode(startX, startZ);
    const goalNode = this.findClosestNode(goalX, goalZ);
    if (startNode.id === goalNode.id) return [startNode.id];

    const chunkCorridor = this.findChunkCorridor(startNode.chunkKey, goalNode.chunkKey);
    if (chunkCorridor.size > 0) {
      const path = this.runNodeAStar(startNode.id, goalNode.id, chunkCorridor);
      if (path.length > 0) return path;

      // Expande em 1 anel de chunks vizinhos caso um bolsão local exija desvio pela borda
      const expanded = new Set(chunkCorridor);
      for (const ck of chunkCorridor) {
        const cg = this.chunkGraphs.get(ck);
        if (!cg) continue;
        for (const nk of cg.connectedNeighborKeys) expanded.add(nk);
      }
      const expandedPath = this.runNodeAStar(startNode.id, goalNode.id, expanded);
      if (expandedPath.length > 0) return expandedPath;
    }

    return this.runNodeAStar(startNode.id, goalNode.id, null);
  }

  private findChunkCorridor(startKey: string, goalKey: string): Set<string> {
    if (startKey === goalKey) return new Set([startKey]);
    if (!this.chunkGraphs.has(startKey) || !this.chunkGraphs.has(goalKey)) return new Set();

    const dist = new Map<string, number>([[startKey, 0]]);
    const prev = new Map<string, string>();
    const visited = new Set<string>();
    const open: string[] = [startKey];

    while (open.length > 0) {
      let bestIdx = 0;
      let bestCost = dist.get(open[0]) ?? Infinity;
      for (let i = 1; i < open.length; i++) {
        const c = dist.get(open[i]) ?? Infinity;
        if (c < bestCost) {
          bestCost = c;
          bestIdx = i;
        }
      }
      const curKey = open.splice(bestIdx, 1)[0];
      if (curKey === goalKey) {
        const corridor = new Set<string>();
        let k: string | undefined = goalKey;
        while (k !== undefined) {
          corridor.add(k);
          k = prev.get(k);
        }
        return corridor;
      }
      if (visited.has(curKey)) continue;
      visited.add(curKey);

      const cg = this.chunkGraphs.get(curKey);
      if (!cg) continue;
      for (const nk of cg.connectedNeighborKeys) {
        if (visited.has(nk)) continue;
        const ncg = this.chunkGraphs.get(nk);
        if (!ncg) continue;
        const stepCost = Math.hypot(ncg.chunkX - cg.chunkX, ncg.chunkZ - cg.chunkZ);
        const alt = bestCost + stepCost;
        if (alt < (dist.get(nk) ?? Infinity)) {
          dist.set(nk, alt);
          prev.set(nk, curKey);
          open.push(nk);
        }
      }
    }

    return new Set();
  }

  private runNodeAStar(startId: number, goalId: number, allowedChunks: Set<string> | null): number[] {
    const goal = this.nodes[goalId];
    const gScore = new Map<number, number>([[startId, 0]]);
    const fScore = new Map<number, number>([
      [startId, Math.hypot(goal.x - this.nodes[startId].x, goal.z - this.nodes[startId].z)],
    ]);
    const cameFrom = new Map<number, number>();
    const closed = new Set<number>();
    const open: number[] = [startId];

    while (open.length > 0) {
      let bestIdx = 0;
      let bestF = fScore.get(open[0]) ?? Infinity;
      for (let i = 1; i < open.length; i++) {
        const f = fScore.get(open[i]) ?? Infinity;
        if (f < bestF) {
          bestF = f;
          bestIdx = i;
        }
      }
      const curId = open.splice(bestIdx, 1)[0];
      if (curId === goalId) {
        const path: number[] = [];
        let c: number | undefined = goalId;
        while (c !== undefined) {
          path.push(c);
          c = cameFrom.get(c);
        }
        path.reverse();
        return path;
      }
      if (closed.has(curId)) continue;
      closed.add(curId);

      const curNode = this.nodes[curId];
      const curG = gScore.get(curId) ?? Infinity;
      for (const e of curNode.edges) {
        if (closed.has(e.to)) continue;
        const nextNode = this.nodes[e.to];
        if (allowedChunks && !allowedChunks.has(nextNode.chunkKey)) continue;

        const tentativeG = curG + e.distance;
        if (tentativeG < (gScore.get(e.to) ?? Infinity)) {
          cameFrom.set(e.to, curId);
          gScore.set(e.to, tentativeG);
          const h = Math.hypot(goal.x - nextNode.x, goal.z - nextNode.z);
          fScore.set(e.to, tentativeG + h);
          if (!open.includes(e.to)) open.push(e.to);
        }
      }
    }

    return [];
  }

  public getNodesByRegion(region: WaypointRegion): NavNode[] {
    return this.nodes.filter((n) => n.region === region);
  }

  public getDebugVisualGroup(): THREE.Group {
    if (this.debugGroup) return this.debugGroup;

    const grp = new THREE.Group();
    const walkPositions: number[] = [];
    const interChunkPositions: number[] = [];
    const crossPositions: number[] = [];

    for (const n of this.nodes) {
      for (const e of n.edges) {
        if (e.to <= n.id) continue;
        const b = this.nodes[e.to];
        const targetArr = e.isCrosswalk
          ? crossPositions
          : e.isInterChunk
          ? interChunkPositions
          : walkPositions;
        targetArr.push(n.x, n.y + 0.35, n.z, b.x, b.y + 0.35, b.z);
      }
    }

    const walkGeo = new THREE.BufferGeometry();
    walkGeo.setAttribute('position', new THREE.Float32BufferAttribute(walkPositions, 3));
    grp.add(
      new THREE.LineSegments(
        walkGeo,
        new THREE.LineBasicMaterial({ color: 0x16f2d4, transparent: true, opacity: 0.85 })
      )
    );

    const interGeo = new THREE.BufferGeometry();
    interGeo.setAttribute('position', new THREE.Float32BufferAttribute(interChunkPositions, 3));
    grp.add(
      new THREE.LineSegments(
        interGeo,
        new THREE.LineBasicMaterial({ color: 0xa855f7, transparent: true, opacity: 0.92 })
      )
    );

    const crossGeo = new THREE.BufferGeometry();
    crossGeo.setAttribute('position', new THREE.Float32BufferAttribute(crossPositions, 3));
    grp.add(
      new THREE.LineSegments(
        crossGeo,
        new THREE.LineBasicMaterial({ color: 0xfacc15, transparent: true, opacity: 0.95 })
      )
    );

    const nodeGeo = new THREE.SphereGeometry(0.32, 6, 6);
    const nodeMat = new THREE.MeshBasicMaterial({ color: 0xff2e93 });
    const nodeInst = new THREE.InstancedMesh(nodeGeo, nodeMat, this.nodes.length);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < this.nodes.length; i++) {
      dummy.position.set(this.nodes[i].x, this.nodes[i].y + 0.42, this.nodes[i].z);
      dummy.updateMatrix();
      nodeInst.setMatrixAt(i, dummy.matrix);
    }
    nodeInst.instanceMatrix.needsUpdate = true;
    grp.add(nodeInst);

    this.debugGroup = grp;
    return grp;
  }
}
