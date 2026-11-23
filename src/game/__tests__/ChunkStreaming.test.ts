import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  CHUNK_FULL_DISTANCE_RATIO,
  CHUNK_HYSTERESIS,
  QUALITY_SETTINGS,
  WORLD_CHUNK_SIZE,
} from '../config';
import {
  createInstancedBatch,
  makeBakedBox,
  makeBakedPlaneXZ,
  mergeColoredGeometries,
  splitGeometryIntoChunks,
} from '../core/WorldBatching';
import { NavGraph } from '../NavGraph';
import {
  ChunkNpcSpawn,
  ChunkTrafficSpawn,
  computeDistanceToChunkBoundsSq,
  evaluateTargetChunkState,
  getChunkKey,
  WorldChunkManager,
  worldToChunkCoord,
} from '../world/WorldChunkSystem';
import { STREETS, WorldRegistry } from '../world/WorldRegistry';

describe('WorldChunkSystem (Streaming 64x64m)', () => {
  it('mapeia coordenadas do mundo para grade fixa de chunks 64x64 m', () => {
    expect(WORLD_CHUNK_SIZE).toBe(64);
    expect(worldToChunkCoord(0)).toBe(0);
    expect(worldToChunkCoord(63.9)).toBe(0);
    expect(worldToChunkCoord(64)).toBe(1);
    expect(worldToChunkCoord(-0.1)).toBe(-1);
    expect(worldToChunkCoord(-64)).toBe(-1);
    expect(worldToChunkCoord(-64.1)).toBe(-2);
    expect(getChunkKey(-1, 2)).toBe('-1,2');
  });

  it('calcula distância ao AABB do chunk e aplica histerese nas transições full/impostor/unloaded', () => {
    const drawDist = QUALITY_SETTINGS.low.drawDistance; // 280 m
    const fullDist = drawDist * CHUNK_FULL_DISTANCE_RATIO;

    expect(computeDistanceToChunkBoundsSq(10, 10, 0, 64, 0, 64)).toBe(0);
    expect(computeDistanceToChunkBoundsSq(-10, 32, 0, 64, 0, 64)).toBe(100);

    expect(evaluateTargetChunkState('unloaded', 0, fullDist, drawDist)).toBe('full');
    expect(evaluateTargetChunkState('unloaded', (fullDist + 5) ** 2, fullDist, drawDist)).toBe('impostor');
    expect(evaluateTargetChunkState('unloaded', (drawDist + 5) ** 2, fullDist, drawDist)).toBe('unloaded');

    // Histerese mantém full/impostor até ultrapassar a margem de saída
    expect(
      evaluateTargetChunkState('full', (fullDist + CHUNK_HYSTERESIS * 0.5) ** 2, fullDist, drawDist)
    ).toBe('full');
    expect(
      evaluateTargetChunkState('full', (fullDist + CHUNK_HYSTERESIS + 1) ** 2, fullDist, drawDist)
    ).toBe('impostor');
    expect(
      evaluateTargetChunkState('impostor', (drawDist + CHUNK_HYSTERESIS * 0.5) ** 2, fullDist, drawDist)
    ).toBe('impostor');
    expect(
      evaluateTargetChunkState('impostor', (drawDist + CHUNK_HYSTERESIS + 1) ** 2, fullDist, drawDist)
    ).toBe('unloaded');
  });

  it('carrega chunks dentro de drawDistance, usa impostor à distância e descarrega os mais distantes', () => {
    const scene = new THREE.Scene();
    const mgr = new WorldChunkManager(scene, 64);

    let fullBuilds = 0;
    let impBuilds = 0;
    for (let cx = -5; cx <= 5; cx++) {
      mgr.registerChunk(
        cx,
        0,
        () => {
          fullBuilds++;
          const grp = new THREE.Group();
          grp.add(new THREE.Mesh(new THREE.BoxGeometry(8, 4, 8), new THREE.MeshBasicMaterial()));
          return grp;
        },
        () => {
          impBuilds++;
          return new THREE.Mesh(new THREE.BoxGeometry(8, 4, 8), new THREE.MeshBasicMaterial());
        }
      );
    }

    // Qualidade Baixo (drawDistance = 280 m) a partir de x = 0:
    // Chunks dentro de ~157 m -> full; entre ~157 e 280 m -> impostor; > 280 m -> unloaded
    mgr.syncAround(32, 32, QUALITY_SETTINGS.low.drawDistance, true);

    expect(mgr.stats.total).toBe(11);
    expect(mgr.stats.full).toBeGreaterThan(0);
    expect(mgr.stats.impostor).toBeGreaterThan(0);
    expect(mgr.stats.unloaded).toBeGreaterThan(0);
    expect(mgr.getChunk(0, 0)?.state).toBe('full');
    expect(mgr.getChunk(3, 0)?.state).toBe('impostor');
    expect(mgr.getChunk(5, 0)?.state).toBe('unloaded');
    expect(fullBuilds).toBe(mgr.stats.full);
    expect(impBuilds).toBe(mgr.stats.impostor);

    // Qualidade Médio (drawDistance = 420 m, full ~ 235 m) promove chunk (5,0) a 288 m para impostor
    mgr.syncAround(32, 32, QUALITY_SETTINGS.medium.drawDistance, true);
    expect(mgr.stats.unloaded).toBe(0);
    expect(mgr.getChunk(5, 0)?.state).toBe('impostor');

    // Qualidade Alto (drawDistance = 550 m, full ~ 308 m) promove chunk (5,0) para detalhe completo
    mgr.syncAround(32, 32, QUALITY_SETTINGS.high.drawDistance, true);
    expect(mgr.stats.unloaded).toBe(0);
    expect(mgr.getChunk(5, 0)?.state).toBe('full');

    mgr.dispose();
    expect(scene.children.length).toBe(0);
    expect(mgr.stats.total).toBe(0);
  });

  it('respeita o orçamento máximo de construções por frame e mantém impostor temporário até montar o chunk', () => {
    const scene = new THREE.Scene();
    const mgr = new WorldChunkManager(scene, 64);

    for (let cx = 0; cx < 6; cx++) {
      mgr.registerChunk(
        cx,
        0,
        () => new THREE.Group(),
        () => new THREE.Mesh(new THREE.BoxGeometry(4, 2, 4), new THREE.MeshBasicMaterial())
      );
    }

    // Com orçamento = 2/frame, apenas 2 chunks mais próximos sobem para full no 1º frame
    mgr.syncAround(0, 32, 500, false, 2);
    expect(mgr.stats.full).toBe(2);
    expect(mgr.stats.impostor).toBe(4);

    // No 2º frame, mais 2 chunks próximos sobem para full
    mgr.syncAround(0, 32, 500, false, 2);
    expect(mgr.stats.full).toBe(4);

    mgr.dispose();
  });

  it('recorta geometria exatamente nas bordas dos chunks 64x64 m sem ultrapassar os limites', () => {
    const plane = makeBakedPlaneXZ(160, 40, 64, 0, 32); // x de -16 a 144, z de 12 a 52
    const chunks = splitGeometryIntoChunks(plane, 64, true);

    expect(chunks.has('-1,0')).toBe(true); // [-64..0] contém x=[-16..0]
    expect(chunks.has('0,0')).toBe(true);  // [0..64]
    expect(chunks.has('1,0')).toBe(true);  // [64..128]
    expect(chunks.has('2,0')).toBe(true);  // [128..192] contém x=[128..144]

    for (const [key, geo] of chunks.entries()) {
      const [cx] = key.split(',').map(Number);
      const minX = cx * 64;
      const maxX = minX + 64;
      const pos = geo.getAttribute('position');
      for (let i = 0; i < pos.count; i++) {
        expect(pos.getX(i)).toBeGreaterThanOrEqual(minX - 1e-4);
        expect(pos.getX(i)).toBeLessThanOrEqual(maxX + 1e-4);
      }
      geo.dispose();
    }
  });

  it('armazena prédios, props, NPC spawns e spawns de tráfego por chunk e filtra consultas por chunks carregados', () => {
    const scene = new THREE.Scene();
    const mgr = new WorldChunkManager(scene, 64);

    for (let cx = -5; cx <= 3; cx++) {
      for (let cz = -5; cz <= 4; cz++) {
        const minX = cx * 64;
        const maxX = minX + 64;
        const minZ = cz * 64;
        const maxZ = minZ + 64;
        const chunkBuildings = WorldRegistry.buildings.filter(
          (b) => b.x >= minX && b.x < maxX && b.z >= minZ && b.z < maxZ
        );
        mgr.registerChunk(
          cx,
          cz,
          () => new THREE.Group(),
          () => null,
          {
            buildings: chunkBuildings,
            propsCount: chunkBuildings.length + 2,
            furnitureInstances: 3,
          }
        );
      }
    }

    const graph = new NavGraph();
    mgr.populateNpcSpawnsFromGraph(graph.nodes);

    const trafficSpawns: ChunkTrafficSpawn[] = [];
    for (const street of STREETS) {
      if (street.kind === 'alley') continue;
      for (const seg of street.segments) {
        trafficSpawns.push({
          streetId: street.id,
          x: (seg.x1 + seg.x2) * 0.5,
          z: (seg.z1 + seg.z2) * 0.5,
          heading: Math.atan2(seg.dirX, seg.dirZ),
          laneOffset: 3.0,
        });
      }
    }
    mgr.registerTrafficSpawns(trafficSpawns);

    // Sincroniza no centro com drawDistance baixa (280 m) para manter parte dos chunks em unloaded
    mgr.syncAround(0, 0, QUALITY_SETTINGS.low.drawDistance, true);

    const totalBlds = mgr.getAllChunks().reduce((acc, ch) => acc + ch.metadata.buildings.length, 0);
    expect(totalBlds).toBe(WorldRegistry.buildings.length);

    const npcOut: ChunkNpcSpawn[] = [];
    const trafficOut: ChunkTrafficSpawn[] = [];
    const sameRefNpc = mgr.getLoadedNpcSpawns(npcOut, false);
    const sameRefTraffic = mgr.getLoadedTrafficSpawns(trafficOut, true);
    expect(sameRefNpc).toBe(npcOut);
    expect(sameRefTraffic).toBe(trafficOut);
    expect(npcOut.length).toBeGreaterThan(0);
    expect(trafficOut.length).toBeGreaterThan(0);

    // Nenhum spawn retornado deve pertencer a chunk unloaded
    for (const sp of npcOut) {
      expect(mgr.getChunkAtWorld(sp.x, sp.z)?.state).toBe('full');
    }
    for (const tsp of trafficOut) {
      const state = mgr.getChunkAtWorld(tsp.x, tsp.z)?.state;
      expect(state === 'full' || state === 'impostor').toBe(true);
    }

    mgr.dispose();
  });

  it('instancia mobiliário urbano por chunk com createInstancedBatch e preserva geometria-arquétipo compartilhada ao descarregar', () => {
    const scene = new THREE.Scene();
    const mgr = new WorldChunkManager(scene, 64);

    const benchGeo = mergeColoredGeometries([
      { geo: makeBakedBox(2.2, 0.14, 0.72, 0, 0.48, 0), colorHex: 0x8b5a3c },
      { geo: makeBakedBox(0.14, 0.48, 0.62, -0.85, 0.24, 0), colorHex: 0x25283d },
    ]);
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
    mgr.registerSharedResources([benchGeo], [mat]);

    mgr.registerChunk(
      0,
      0,
      () => {
        const grp = new THREE.Group();
        grp.add(
          createInstancedBatch(
            benchGeo,
            mat,
            [
              { x: 10, y: 0.1, z: 10, rotY: 0 },
              { x: 24, y: 0.1, z: 18, rotY: Math.PI / 2 },
            ],
            true,
            true
          )
        );
        return grp;
      },
      () => null,
      { propsCount: 2, furnitureInstances: 2 }
    );

    // Carrega chunk (0,0)
    mgr.syncAround(16, 16, 200, true);
    const ch = mgr.getChunk(0, 0)!;
    expect(ch.state).toBe('full');
    expect(ch.metadata.furnitureInstances).toBe(2);
    expect(ch.fullGroup?.children[0]).toBeInstanceOf(THREE.InstancedMesh);
    expect((ch.fullGroup?.children[0] as THREE.InstancedMesh).count).toBe(2);

    // Afasta o suficiente para descarregar e liberar InstancedMesh mantendo archetype intacto
    mgr.syncAround(500, 500, 120, true);
    expect(ch.state).toBe('unloaded');
    expect(ch.fullGroup).toBeNull();
    expect(benchGeo.getAttribute('position').count).toBeGreaterThan(0);

    // Retorna para recriar o chunk sem erro
    mgr.syncAround(16, 16, 200, true);
    expect(ch.state).toBe('full');
    expect(ch.fullGroup?.children[0]).toBeInstanceOf(THREE.InstancedMesh);

    mgr.dispose();
  });
});
