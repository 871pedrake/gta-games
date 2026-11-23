import * as THREE from 'three';
import { BuildingRegistry } from './BuildingRegistry';
import {
  DESPAWN_OUT_FRUSTUM_DIST,
  MAX_NPC_POOL,
  MAX_NPC_VISIBLE,
  MAX_SIMULATED_INJURED,
  NPC_HEIGHT_VARIATION,
  QUALITY_SETTINGS,
  QualityPreset,
  SIM_MAX_RADIUS,
  SPAWN_MIN_DIST,
} from './config';
import { LODSystem } from './LODSystem';
import { NavGraph } from './NavGraph';
import {
  PedestrianAI,
  PedestrianArchetype,
  PedestrianPose,
  WorldThreatContext,
} from './PedestrianAI';
import { ScheduleSystem } from './ScheduleSystem';
import { ChunkNpcSpawn, WorldChunkManager } from './world/WorldChunkSystem';
import { WORLD_BOUNDS, WorldRegistry } from './world/WorldRegistry';
import { ZoneDensityManager } from './ZoneDensityManager';

export const MAX_NPCS = MAX_NPC_POOL;

const CELL_SIZE = 10;
const AI_BUDGET_PER_FRAME = 72;
const BG_SIM_BUDGET_PER_FRAME = 24;
const SIM_RADIUS_SQ = SIM_MAX_RADIUS * SIM_MAX_RADIUS;
const DESPAWN_OUT_FRUSTUM_SQ = DESPAWN_OUT_FRUSTUM_DIST * DESPAWN_OUT_FRUSTUM_DIST;
const SPAWN_MIN_SQ = SPAWN_MIN_DIST * SPAWN_MIN_DIST;

// Paletas de cores por arquétipo para instanceColor
const SKIN_PALETTE = [0xf5cbb0, 0xe0ac84, 0xc6865c, 0x8d5524, 0xf2d2bd];
const HAIR_PALETTE = [0x14111f, 0x3b2416, 0x7c4a26, 0xd4a348, 0xc93b5b, 0x22d3ee];
const UMBRELLA_PALETTE = [0xff2e93, 0x00e5ff, 0xfacc15, 0x22f59a, 0xff7b29, 0xa855f7, 0xf43f5e];
const CLOTHES_BY_ARCHETYPE: Record<PedestrianArchetype, number[]> = {
  tourist: [0xff477e, 0x16f2d4, 0xfacc15, 0xff8c38, 0x38bdf8],
  volleyball: [0xff2e93, 0x22f59a, 0xfbbf24, 0x06b6d4],
  runner: [0x10b981, 0x00e5ff, 0xf97316, 0xa3e635],
  executive: [0x1e293b, 0x334155, 0x1e1b4b, 0x3f3f46],
  skater: [0x9333ea, 0xf43f5e, 0x14b8a6, 0xf59e0b],
};
const PANTS_BY_ARCHETYPE: Record<PedestrianArchetype, number[]> = {
  tourist: [0xf1f5f9, 0x3b82f6, 0xfde047, 0x64748b],
  volleyball: [0x0f172a, 0xf43f5e, 0x0284c7],
  runner: [0x0f172a, 0x1e293b, 0x312e81],
  executive: [0x0f172a, 0x1e293b, 0x27272a],
  skater: [0x1e293b, 0x3f3f46, 0x4c1d95],
};

// Objetos temporários pré-alocados para zero Garbage Collection no loop principal
const _matWorld = new THREE.Matrix4();
const _matLocal = new THREE.Matrix4();
const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _euler = new THREE.Euler();
const _scale = new THREE.Vector3();
const _color = new THREE.Color();
const _proj = new THREE.Vector3();
const _frustum = new THREE.Frustum();
const _projScreenMatrix = new THREE.Matrix4();
const _camForward = new THREE.Vector3();
const _sphere = new THREE.Sphere(new THREE.Vector3(), 1.35);
const _pose: PedestrianPose = {
  headPitch: 0,
  leftArmX: 0,
  leftArmZ: 0,
  rightArmX: 0,
  rightArmZ: 0,
  leftLegX: 0,
  rightLegX: 0,
  hipDropY: 0,
  jumpY: 0,
  torsoLeanX: 0,
};

/**
 * Gerencia o pool de 600 cidadãos com orçamento visível de 150–250 NPCs na tela (padrão 200),
 * frustum culling com spawn apenas atrás da câmera ou > 80 m, espaçamento de 1 NPC / 6 m por zona,
 * proporções humanas de 1,75 m ± 8%, evitação educada e LOD em 3 níveis.
 */
export class CrowdManager {
  public readonly graph = new NavGraph();
  public readonly registry: BuildingRegistry;
  public readonly schedule: ScheduleSystem;
  public readonly zoneDensity = new ZoneDensityManager();
  public readonly lodSystem = new LODSystem();
  public readonly agents: PedestrianAI[] = [];

  private readonly headMesh: THREE.InstancedMesh;
  private readonly hairMesh: THREE.InstancedMesh;
  private readonly torsoMesh: THREE.InstancedMesh;
  private readonly leftArmMesh: THREE.InstancedMesh;
  private readonly rightArmMesh: THREE.InstancedMesh;
  private readonly leftLegMesh: THREE.InstancedMesh;
  private readonly rightLegMesh: THREE.InstancedMesh;
  private readonly boardMesh: THREE.InstancedMesh;
  private readonly umbrellaShaftMesh: THREE.InstancedMesh;
  private readonly umbrellaCanopyMesh: THREE.InstancedMesh;
  private readonly allMeshes: THREE.InstancedMesh[];

  // Grade espacial: chave inteira -> lista de índices na célula
  private spatialGrid = new Map<number, number[]>();
  private aiCursor = 0;
  private bgCursor = 0;
  private spawnCursor = 0;
  private testSpawnCursor = 0;

  private chunkManager: WorldChunkManager | null = null;
  private readonly activeChunkNpcSpawns: ChunkNpcSpawn[] = [];

  public maxVisibleNpcs = MAX_NPC_VISIBLE;
  public qualityPreset: QualityPreset = 'medium';

  public setChunkManager(chunkManager: WorldChunkManager | null): void {
    this.chunkManager = chunkManager;
  }

  // Buffer reutilizável para atualização de cápsulas de debug (tecla P)
  public readonly colliderNpcBuffer: Array<{
    active: boolean;
    inside: boolean;
    x: number;
    y: number;
    z: number;
    widthScale: number;
    heightScale: number;
  }> = [];

  // Métricas para o painel de debug (F3)
  public activeCount = 0;
  public backgroundCount = 0;
  public nearbyCount = 0;
  public insideCount = 0;
  public activeInjuredCount = 0;

  constructor(
    scene: THREE.Scene,
    isSoftwareGl: boolean,
    registry: BuildingRegistry,
    schedule: ScheduleSystem,
    initialGameTime = 17.5
  ) {
    this.registry = registry;
    this.schedule = schedule;

    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.68,
      metalness: 0.06,
    });

    // Proporções humanas realistas (~1,75 m de altura média, silhueta mais esguia)
    const headGeo = new THREE.BoxGeometry(0.26, 0.26, 0.26);
    headGeo.translate(0, 0.15, 0);

    const hairGeo = new THREE.BoxGeometry(0.28, 0.12, 0.28);
    hairGeo.translate(0, 0.31, -0.01);

    const torsoGeo = new THREE.BoxGeometry(0.38, 0.58, 0.22);
    torsoGeo.translate(0, 0.29, 0);

    const armGeo = new THREE.BoxGeometry(0.12, 0.56, 0.13);
    armGeo.translate(0, -0.26, 0);

    const legGeo = new THREE.BoxGeometry(0.15, 0.78, 0.17);
    legGeo.translate(0, -0.39, 0);

    const boardGeo = new THREE.BoxGeometry(0.28, 0.06, 0.92);
    boardGeo.translate(0, 0.04, 0);

    const umbrellaShaftGeo = new THREE.CylinderGeometry(0.016, 0.016, 0.64, 5);
    umbrellaShaftGeo.translate(0, 0.32, 0);

    const umbrellaCanopyGeo = new THREE.ConeGeometry(0.48, 0.22, 8);
    umbrellaCanopyGeo.translate(0, 0.64, 0);

    const makeInst = (geo: THREE.BufferGeometry) => {
      const m = new THREE.InstancedMesh(geo, mat, MAX_NPC_POOL);
      m.frustumCulled = false;
      m.castShadow = !isSoftwareGl;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_NPC_POOL * 3), 3);
      scene.add(m);
      return m;
    };

    this.headMesh = makeInst(headGeo);
    this.hairMesh = makeInst(hairGeo);
    this.torsoMesh = makeInst(torsoGeo);
    this.leftArmMesh = makeInst(armGeo);
    this.rightArmMesh = makeInst(armGeo);
    this.leftLegMesh = makeInst(legGeo);
    this.rightLegMesh = makeInst(legGeo);
    this.boardMesh = makeInst(boardGeo);
    this.umbrellaShaftMesh = makeInst(umbrellaShaftGeo);
    this.umbrellaCanopyMesh = makeInst(umbrellaCanopyGeo);

    this.allMeshes = [
      this.headMesh,
      this.hairMesh,
      this.torsoMesh,
      this.leftArmMesh,
      this.rightArmMesh,
      this.leftLegMesh,
      this.rightLegMesh,
      this.boardMesh,
      this.umbrellaShaftMesh,
      this.umbrellaCanopyMesh,
    ];

    this.zoneDensity.updateLimits(initialGameTime, false, 'clear', this.maxVisibleNpcs);
    this.zoneDensity.beginFrame();

    // Inicializa o pool de 600 cidadãos; até 200 começam visíveis respeitando células de 6m e limites por zona
    let initialVisible = 0;
    for (let i = 0; i < MAX_NPC_POOL; i++) {
      const agent = new PedestrianAI(i);
      const profile = this.schedule.createProfile(i + 1, this.registry);

      // Escala realista 1,75 m ± 8% (0.92 .. 1.08)
      const hRand = ((i * 37) % 100) / 99;
      const heightScale =
        1.0 - NPC_HEIGHT_VARIATION + hRand * (NPC_HEIGHT_VARIATION * 2.0);
      const widthScale = 0.86 + ((i * 53) % 13) * 0.01;

      const skin = SKIN_PALETTE[i % SKIN_PALETTE.length];
      const hair = HAIR_PALETTE[(i * 3) % HAIR_PALETTE.length];
      const archTemp: PedestrianArchetype =
        profile.profession === 'volleyball'
          ? 'volleyball'
          : profile.profession === 'runner'
          ? 'runner'
          : profile.profession === 'skater'
          ? 'skater'
          : profile.profession === 'executive' || profile.profession === 'guard'
          ? 'executive'
          : 'tourist';
      const shirtPool = CLOTHES_BY_ARCHETYPE[archTemp];
      const pantsPool = PANTS_BY_ARCHETYPE[archTemp];
      const shirt = shirtPool[(i * 7) % shirtPool.length];
      const pants = pantsPool[(i * 11) % pantsPool.length];

      agent.initCitizen(profile, heightScale, widthScale, { skin, hair, shirt, pants });
      agent.syncToSchedule(initialGameTime, false, this.graph, this.schedule, this.zoneDensity);

      if (
        !agent.insideBuilding &&
        initialVisible < this.maxVisibleNpcs &&
        this.zoneDensity.canAcceptNpcAt(agent.x, agent.z)
      ) {
        agent.visuallyActive = true;
        agent.inSimRange = true;
        this.zoneDensity.recordVisibleNpc(agent.x, agent.z);
        initialVisible++;
      } else {
        // Permanece em simulação de baixa fidelidade fora da tela ou redistribuído posteriormente
        agent.visuallyActive = false;
        agent.inSimRange = false;
        if (agent.insideBuilding) {
          // Mantém o interior coerente apenas se visível; pool remoto não infla insideCount local
          agent.insideBuilding.insideCount = Math.max(0, agent.insideBuilding.insideCount - 1);
          agent.insideBuilding = null;
        }
        this.hideInstance(i);
      }

      this.agents.push(agent);
      this.colliderNpcBuffer.push({
        active: false,
        inside: false,
        x: 0,
        y: 0,
        z: 0,
        widthScale: 1,
        heightScale: 1,
      });
      this.assignInstanceColors(agent);
    }

    this.flagColorsDirty();
  }

  public setQualityPreset(preset: QualityPreset): void {
    this.qualityPreset = preset;
    this.maxVisibleNpcs = QUALITY_SETTINGS[preset].maxVisibleNpcs;
  }

  private hideInstance(i: number): void {
    _matWorld.makeScale(0, 0, 0);
    for (const m of this.allMeshes) {
      m.setMatrixAt(i, _matWorld);
    }
  }

  private assignInstanceColors(agent: PedestrianAI): void {
    const i = agent.index;
    this.headMesh.setColorAt(i, _color.setHex(agent.skinColor));
    this.hairMesh.setColorAt(i, _color.setHex(agent.hairColor));
    this.torsoMesh.setColorAt(i, _color.setHex(agent.shirtColor));

    const armHex =
      agent.archetype === 'tourist' || agent.archetype === 'volleyball'
        ? agent.skinColor
        : agent.shirtColor;
    this.leftArmMesh.setColorAt(i, _color.setHex(armHex));
    this.rightArmMesh.setColorAt(i, _color.setHex(armHex));

    this.leftLegMesh.setColorAt(i, _color.setHex(agent.pantsColor));
    this.rightLegMesh.setColorAt(i, _color.setHex(agent.pantsColor));
    this.boardMesh.setColorAt(i, _color.setHex(0xff2e93));
    this.umbrellaShaftMesh.setColorAt(i, _color.setHex(0x1e293b));
    this.umbrellaCanopyMesh.setColorAt(
      i,
      _color.setHex(UMBRELLA_PALETTE[(i * 5) % UMBRELLA_PALETTE.length])
    );
  }

  private flagColorsDirty(): void {
    for (const m of this.allMeshes) {
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }

  private hashCell(cx: number, cz: number): number {
    return ((cx + 64) << 8) | (cz + 64);
  }

  private rebuildSpatialGrid(): void {
    for (const bucket of this.spatialGrid.values()) {
      bucket.length = 0;
    }
    for (const a of this.agents) {
      if (
        !a.active ||
        !a.visuallyActive ||
        a.insideBuilding ||
        a.state === 'ON_BUS' ||
        a.ragdollActive ||
        a.injuryStatus === 'out'
      ) {
        continue;
      }
      const cx = Math.floor(a.x / CELL_SIZE);
      const cz = Math.floor(a.z / CELL_SIZE);
      const key = this.hashCell(cx, cz);
      let bucket = this.spatialGrid.get(key);
      if (!bucket) {
        bucket = [];
        this.spatialGrid.set(key, bucket);
      }
      bucket.push(a.index);
    }
  }

  /**
   * Consulta índices de NPCs visíveis dentro de um raio usando a grade espacial 2D.
   */
  public queryRadiusIndices(x: number, z: number, radius: number, out: number[]): number[] {
    out.length = 0;
    const minCx = Math.floor((x - radius) / CELL_SIZE);
    const maxCx = Math.floor((x + radius) / CELL_SIZE);
    const minCz = Math.floor((z - radius) / CELL_SIZE);
    const maxCz = Math.floor((z + radius) / CELL_SIZE);
    const r2 = radius * radius;

    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cz = minCz; cz <= maxCz; cz++) {
        const bucket = this.spatialGrid.get(this.hashCell(cx, cz));
        if (!bucket) continue;
        for (let i = 0; i < bucket.length; i++) {
          const idx = bucket[i];
          const a = this.agents[idx];
          const dx = a.x - x;
          const dz = a.z - z;
          if (dx * dx + dz * dz <= r2) {
            out.push(idx);
          }
        }
      }
    }
    return out;
  }

  /**
   * Aplica separação suave entre NPCs próximos e desvio educado ("desculpa") ao cruzar em sentido oposto.
   */
  private applyNeighborAvoidance(agent: PedestrianAI): void {
    agent.sepX = 0;
    agent.sepZ = 0;
    agent.nearbyPeerCount = 0;
    if (agent.insideBuilding) return;

    const cx = Math.floor(agent.x / CELL_SIZE);
    const cz = Math.floor(agent.z / CELL_SIZE);
    const myFwdX = Math.sin(agent.yaw);
    const myFwdZ = Math.cos(agent.yaw);

    for (let ox = -1; ox <= 1; ox++) {
      for (let oz = -1; oz <= 1; oz++) {
        const bucket = this.spatialGrid.get(this.hashCell(cx + ox, cz + oz));
        if (!bucket) continue;

        for (let k = 0; k < bucket.length; k++) {
          const otherIdx = bucket[k];
          if (otherIdx === agent.index) continue;
          const other = this.agents[otherIdx];
          const dx = agent.x - other.x;
          const dz = agent.z - other.z;
          const d2 = dx * dx + dz * dz;
          if (d2 < 9.0) {
            agent.nearbyPeerCount++;
            // Repulsão leve para evitar qualquer sobreposição
            if (d2 < 1.85 && d2 > 0.0001) {
              const d = Math.sqrt(d2);
              const push = (1.36 - d) * 2.55;
              agent.sepX += (dx / d) * push;
              agent.sepZ += (dz / d) * push;
            }
            // Encontro frontal ("desculpa"): desvio educado lateral
            if (d2 < 7.84 && d2 > 1.2 && agent.courtesyTimer <= 0) {
              const otherFwdX = Math.sin(other.yaw);
              const otherFwdZ = Math.cos(other.yaw);
              const facingDot = myFwdX * otherFwdX + myFwdZ * otherFwdZ;
              if (facingDot < -0.35) {
                agent.triggerCourtesySidestep(other.x, other.z);
              }
            }
          }
        }
      }
    }
  }

  public triggerPanicRadius(originX: number, originZ: number, radius: number): void {
    const r2 = radius * radius;
    for (const a of this.agents) {
      if (!a.active || !a.visuallyActive || a.insideBuilding || a.ragdollActive) continue;
      const dx = a.x - originX;
      const dz = a.z - originZ;
      if (dx * dx + dz * dz <= r2) {
        a.triggerFlee(originX, originZ, 1.0);
      }
    }
  }

  /**
   * Acelera fade/recuperação caso feridos simultâneos ultrapassem o teto de 30.
   */
  public enforceInjuredCap(cap = MAX_SIMULATED_INJURED): void {
    let count = 0;
    for (const a of this.agents) {
      if (!a.active) continue;
      if (a.injuryStatus !== 'healthy' || a.ragdollActive) {
        count++;
        if (count > cap && !a.ragdollActive) {
          a.triggerFastInjuredFade();
        }
      }
    }
  }

  /**
   * Tecla K: posiciona 10 NPCs saudáveis imediatamente à frente do jogador para testes de colisão.
   */
  public spawnTestGroupInFront(
    px: number,
    pz: number,
    yaw: number,
    groundHeightFn: (x: number, z: number, currentY?: number) => number,
    count = 10
  ): void {
    const fwdX = Math.sin(yaw);
    const fwdZ = Math.cos(yaw);
    const rightX = Math.cos(yaw);
    const rightZ = -Math.sin(yaw);

    let spawned = 0;
    for (let step = 0; step < MAX_NPC_POOL && spawned < count; step++) {
      const idx = (this.testSpawnCursor + step) % MAX_NPC_POOL;
      const a = this.agents[idx];
      if (a.ragdollActive) continue;

      if (a.insideBuilding) {
        a.insideBuilding.insideCount = Math.max(0, a.insideBuilding.insideCount - 1);
        a.insideBuilding = null;
      }

      const row = Math.floor(spawned / 5);
      const col = (spawned % 5) - 2;
      const dist = 9.5 + row * 2.6;
      const lateral = col * 1.9 + (Math.random() - 0.5) * 0.6;

      const clampedZ = Math.max(WORLD_BOUNDS.minZ + 6, Math.min(WORLD_BOUNDS.maxZ - 6, pz + fwdZ * dist + rightZ * lateral));
      const maxCoastX = Math.min(WORLD_BOUNDS.maxX - 4, WorldRegistry.getCoastlineX(clampedZ) + 16);
      a.z = clampedZ;
      a.x = Math.max(WORLD_BOUNDS.minX + 6, Math.min(maxCoastX, px + fwdX * dist + rightX * lateral));
      a.y = groundHeightFn(a.x, a.z);
      a.yaw = yaw + Math.PI;
      a.active = true;
      a.inSimRange = true;
      a.visuallyActive = true;
      a.ragdollActive = false;
      a.resetToHealthy();
      a.state = 'WALK';
      a.stateTimer = 2.0 + Math.random() * 2.5;
      a.routineLabel = 'Grupo de Teste (K)';

      const nearNode = this.graph.findClosestNode(a.x, a.z);
      a.currentNodeId = nearNode.id;
      a.targetNodeId = nearNode.edges[0]?.to ?? nearNode.id;

      spawned++;
    }
    this.testSpawnCursor = (this.testSpawnCursor + count) % MAX_NPC_POOL;
  }

  /**
   * Atualiza densidade por zona, frustum culling, spawn apenas atrás da câmera ou > 80m,
   * grade espacial com espaçamento de 6 m, LOD em 3 níveis e teto de 30 feridos simultâneos.
   */
  public update(
    dt: number,
    ctx: WorldThreatContext,
    camera: THREE.Camera,
    groundHeightFn: (x: number, z: number, currentY?: number) => number,
    trafficNsMats: THREE.MeshBasicMaterial[],
    trafficEwMats: THREE.MeshBasicMaterial[]
  ): void {
    this.graph.updateTrafficSignals(dt, trafficNsMats, trafficEwMats);

    // Atualiza matriz do frustum e direção horizontal da câmera (zero GC)
    camera.updateMatrixWorld();
    _projScreenMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    _frustum.setFromProjectionMatrix(_projScreenMatrix);
    camera.getWorldDirection(_camForward);
    const camFwdLen = Math.hypot(_camForward.x, _camForward.z) || 1;
    const camFwdX = _camForward.x / camFwdLen;
    const camFwdZ = _camForward.z / camFwdLen;

    // Atualiza limites dinâmicos por zona e inicia contadores do frame
    this.zoneDensity.updateLimits(ctx.gameTime, ctx.isWeekend, ctx.weather, this.maxVisibleNpcs);
    this.zoneDensity.beginFrame();
    this.lodSystem.beginFrame();

    // 1. Verifica visibilidade, frustum e despawn imediato fora da câmera + distância > 68m
    let visibleCount = 0;
    let backgroundCount = 0;
    let injuredNow = 0;

    for (let i = 0; i < MAX_NPC_POOL; i++) {
      const a = this.agents[i];
      if (!a.active) continue;

      if (a.injuryStatus !== 'healthy' || a.ragdollActive) {
        injuredNow++;
      }

      if (a.state === 'ON_BUS') {
        this.hideInstance(i);
        continue;
      }

      if (a.ragdollActive) {
        this.hideInstance(i);
        continue;
      }

      const dx = a.x - ctx.playerX;
      const dz = a.z - ctx.playerZ;
      const distSq = dx * dx + dz * dz;

      if (a.visuallyActive) {
        // Fora do alcance máximo (150m): retorna para o pool de baixa fidelidade
        if (distSq > SIM_RADIUS_SQ) {
          this.demoteToBackground(a);
          backgroundCount++;
          continue;
        }

        // Despawn imediato se fora do frustum e distante (> 68m), ou se excedeu teto visível
        _sphere.center.set(a.x, a.y + 0.9, a.z);
        const inFrustum = _frustum.intersectsSphere(_sphere);
        if ((!inFrustum && distSq > DESPAWN_OUT_FRUSTUM_SQ) || visibleCount >= this.maxVisibleNpcs) {
          if (!inFrustum || distSq > DESPAWN_OUT_FRUSTUM_SQ) {
            this.demoteToBackground(a);
            backgroundCount++;
            continue;
          }
        }

        if (!a.insideBuilding) {
          this.zoneDensity.recordVisibleNpc(a.x, a.z);
        }
        visibleCount++;
      } else {
        backgroundCount++;
      }
    }

    // 2. Simulação em baixa fidelidade para o pool fora da câmera (round-robin)
    let bgStepped = 0;
    for (let step = 0; step < MAX_NPC_POOL && bgStepped < BG_SIM_BUDGET_PER_FRAME; step++) {
      const idx = (this.bgCursor + step) % MAX_NPC_POOL;
      const a = this.agents[idx];
      if (!a.active || a.visuallyActive || a.ragdollActive || a.state === 'ON_BUS') continue;
      if (a.injuryStatus === 'out') {
        a.resetToHealthy();
      }
      const dir = this.schedule.evaluate(a.profile, ctx.gameTime, ctx.isWeekend, a.index);
      if (dir.shouldBeInside) {
        a.x = dir.targetPlace.entryX;
        a.z = dir.targetPlace.entryZ;
      } else {
        const node = this.graph.findClosestNode(dir.targetPlace.entryX, dir.targetPlace.entryZ);
        a.x = node.x;
        a.z = node.z;
      }
      bgStepped++;
    }
    this.bgCursor = (this.bgCursor + BG_SIM_BUDGET_PER_FRAME) % MAX_NPC_POOL;

    // 3. Promove/spawna NPCs do pool a partir dos spawns de NPCs dos chunks carregados (ou grafo fallback)
    const spawnBudget = Math.min(10, Math.max(0, this.maxVisibleNpcs - visibleCount));
    let spawnedThisFrame = 0;
    const loadedChunkSpawns = this.chunkManager
      ? this.chunkManager.getLoadedNpcSpawns(this.activeChunkNpcSpawns, false)
      : null;
    const useChunkSpawns = loadedChunkSpawns !== null && loadedChunkSpawns.length > 0;
    const sourceCount = useChunkSpawns ? loadedChunkSpawns.length : this.graph.nodes.length;

    if (sourceCount > 0) {
      for (let attempt = 0; attempt < 48 && spawnedThisFrame < spawnBudget; attempt++) {
        const pickIdx = (this.spawnCursor + attempt * 7) % sourceCount;
        const candidateNode = useChunkSpawns
          ? this.graph.nodes[loadedChunkSpawns[pickIdx].nodeId]
          : this.graph.nodes[pickIdx];
        if (!candidateNode) continue;

        const dx = candidateNode.x - ctx.playerX;
        const dz = candidateNode.z - ctx.playerZ;
        const distSq = dx * dx + dz * dz;
        if (distSq > SIM_RADIUS_SQ - 100 || distSq < 22 * 22) continue;

        // Regra estrita: só spawna/recicla ATRÁS da câmera (dot < -0.1) OU além de 80m
        const dist = Math.sqrt(distSq);
        const forwardDot = (dx / dist) * camFwdX + (dz / dist) * camFwdZ;
        const isBehindCam = forwardDot < -0.1;
        const isBeyondMinDist = distSq >= SPAWN_MIN_SQ;
        if (!isBehindCam && !isBeyondMinDist) continue;

        // Respeita limite dinâmico da zona e orçamento de 1 NPC por célula de 6m
        if (!this.zoneDensity.canAcceptNpcAt(candidateNode.x, candidateNode.z)) continue;

        // Encontra próximo agente no pool fora da tela
        const pooled = this.findNextPooledAgent();
        if (!pooled) break;

        pooled.spawnAt(candidateNode);
        pooled.pickNextWaypointTowardsGoal(this.graph, this.zoneDensity);
        this.zoneDensity.recordVisibleNpc(pooled.x, pooled.z);
        visibleCount++;
        backgroundCount = Math.max(0, backgroundCount - 1);
        spawnedThisFrame++;
      }
      this.spawnCursor = (this.spawnCursor + 11) % sourceCount;
    }

    // 4. Se exceder 30 feridos simultâneos, acelera recuperação/fade
    this.activeInjuredCount = injuredNow;
    if (injuredNow > MAX_SIMULATED_INJURED) {
      this.enforceInjuredCap(MAX_SIMULATED_INJURED);
    }

    // 5. Reconstrói grade espacial apenas com NPCs visíveis
    this.rebuildSpatialGrid();

    // 6. Orçamento de decisões de IA por frame (round-robin nos NPCs visíveis)
    let budgetUsed = 0;
    const aiStepScale = Math.max(1, visibleCount / AI_BUDGET_PER_FRAME);
    for (let step = 0; step < MAX_NPC_POOL && budgetUsed < AI_BUDGET_PER_FRAME; step++) {
      const idx = (this.aiCursor + step) % MAX_NPC_POOL;
      const a = this.agents[idx];
      if (!a.active || !a.visuallyActive || a.state === 'ON_BUS' || a.ragdollActive || a.injuryStatus === 'out') {
        continue;
      }

      this.applyNeighborAvoidance(a);
      a.stepDecision(dt * aiStepScale, this.graph, this.schedule, this.registry, ctx, this.zoneDensity);
      budgetUsed++;
    }
    this.aiCursor = (this.aiCursor + AI_BUDGET_PER_FRAME) % MAX_NPC_POOL;

    // 7. Movimento contínuo, fade em portas, LOD de 3 níveis e matrizes
    let renderedOutsideCount = 0;
    for (let i = 0; i < MAX_NPC_POOL; i++) {
      const a = this.agents[i];
      const dbg = this.colliderNpcBuffer[i];

      if (
        !a.active ||
        !a.visuallyActive ||
        a.state === 'ON_BUS' ||
        a.ragdollActive ||
        a.injuryStatus === 'out'
      ) {
        this.hideInstance(i);
        dbg.active = false;
        dbg.inside = false;
        continue;
      }

      a.stepMotion(dt, this.graph, this.registry, groundHeightFn, this.zoneDensity);

      if (!a.visuallyActive || (a.insideBuilding && !a.fadingOut) || a.fadeAlpha <= 0.01) {
        this.hideInstance(i);
        dbg.active = false;
        dbg.inside = Boolean(a.insideBuilding);
        continue;
      }

      const distSq = (a.x - ctx.playerX) ** 2 + (a.z - ctx.playerZ) ** 2;
      const lod = this.lodSystem.classify(distSq) ?? 'low';

      renderedOutsideCount++;
      this.writeAgentMatrices(a, lod);

      dbg.active = true;
      dbg.inside = false;
      dbg.x = a.x;
      dbg.y = a.y;
      dbg.z = a.z;
      dbg.widthScale = a.widthScale;
      dbg.heightScale = a.heightScale;
    }

    this.zoneDensity.finalizeAlerts();
    this.activeCount = renderedOutsideCount;
    this.backgroundCount = backgroundCount;
    this.nearbyCount = this.lodSystem.counts.full;
    this.insideCount = this.registry.getTotalInsideCount();

    for (const m of this.allMeshes) {
      m.instanceMatrix.needsUpdate = true;
    }
  }

  private demoteToBackground(a: PedestrianAI): void {
    a.visuallyActive = false;
    a.inSimRange = false;
    if (a.insideBuilding) {
      a.insideBuilding.insideCount = Math.max(0, a.insideBuilding.insideCount - 1);
      a.insideBuilding = null;
    }
    if (a.injuryStatus === 'out' && !a.ragdollActive) {
      a.resetToHealthy();
    }
    this.hideInstance(a.index);
  }

  private findNextPooledAgent(): PedestrianAI | null {
    for (let s = 0; s < MAX_NPC_POOL; s++) {
      const idx = (this.aiCursor + s) % MAX_NPC_POOL;
      const a = this.agents[idx];
      if (!a.active || a.visuallyActive || a.ragdollActive || a.state === 'ON_BUS') continue;
      if (a.injuryStatus !== 'healthy') a.resetToHealthy();
      return a;
    }
    return null;
  }

  /**
   * Tecla H: desenha rótulos 2D com a rotina atual, horário-alvo e HP sobre NPCs próximos.
   */
  public drawRoutineDebugLabels(
    ctx: CanvasRenderingContext2D,
    camera: THREE.Camera,
    w: number,
    h: number,
    playerX: number,
    playerZ: number
  ): void {
    ctx.clearRect(0, 0, w, h);

    ctx.font = '600 11px "Plus Jakarta Sans", system-ui, sans-serif';
    ctx.textBaseline = 'middle';

    let drawn = 0;
    for (const a of this.agents) {
      if (
        !a.active ||
        !a.visuallyActive ||
        a.insideBuilding ||
        a.state === 'ON_BUS' ||
        a.ragdollActive ||
        a.injuryStatus === 'out'
      ) {
        continue;
      }
      const distSq = (a.x - playerX) ** 2 + (a.z - playerZ) ** 2;
      if (distSq > 1444) continue;

      _proj.set(a.x, a.y + 2.15 * a.heightScale, a.z);
      _proj.project(camera);
      if (_proj.z < -1 || _proj.z > 1) continue;

      const sx = (_proj.x * 0.5 + 0.5) * w;
      const sy = (-_proj.y * 0.5 + 0.5) * h;
      if (sx < 10 || sx > w - 10 || sy < 10 || sy > h - 10) continue;

      const line = `${a.routineLabel} · ${a.targetHourLabel}`;
      const hpPct = Math.max(0, Math.min(1, a.health / a.maxHealth));
      const textW = Math.max(88, ctx.measureText(line).width + 14);

      ctx.fillStyle = 'rgba(14, 10, 28, 0.84)';
      ctx.fillRect(sx - textW / 2, sy - 16, textW, 24);
      ctx.strokeStyle =
        a.injuryStatus === 'injured'
          ? 'rgba(250, 204, 21, 0.85)'
          : 'rgba(56, 189, 248, 0.55)';
      ctx.lineWidth = 1;
      ctx.strokeRect(sx - textW / 2, sy - 16, textW, 24);

      ctx.fillStyle = '#f8fafc';
      ctx.textAlign = 'center';
      ctx.fillText(line, sx, sy - 6);

      const barW = textW - 12;
      ctx.fillStyle = 'rgba(255,255,255,0.16)';
      ctx.fillRect(sx - barW / 2, sy + 2, barW, 3);
      ctx.fillStyle = hpPct > 0.6 ? '#22c55e' : hpPct > 0.3 ? '#facc15' : '#ef4444';
      ctx.fillRect(sx - barW / 2, sy + 2, barW * hpPct, 3);

      drawn++;
      if (drawn >= 28) break;
    }
  }

  private writeAgentMatrices(a: PedestrianAI, lod: 'full' | 'mid' | 'low'): void {
    const idx = a.index;
    const h = a.heightScale * a.fadeAlpha;
    const w = a.widthScale * a.fadeAlpha;

    a.computePose(_pose, lod);

    const skateLift = a.archetype === 'skater' ? 0.09 : 0;
    const baseY = a.y + _pose.jumpY + _pose.hipDropY + skateLift;

    _euler.set(0, a.yaw, 0, 'YXZ');
    _quat.setFromEuler(_euler);
    _pos.set(a.x, baseY, a.z);
    _scale.set(w, h, w);
    _matWorld.compose(_pos, _quat, _scale);

    // 1. Pernas (comprimento 0.78m, pivô no quadril y = 0.78)
    _euler.set(_pose.leftLegX, 0, 0);
    _quat.setFromEuler(_euler);
    _pos.set(-0.095, 0.78, 0);
    _scale.set(1, 1, 1);
    _matLocal.compose(_pos, _quat, _scale).premultiply(_matWorld);
    this.leftLegMesh.setMatrixAt(idx, _matLocal);

    _euler.set(_pose.rightLegX, 0, 0);
    _quat.setFromEuler(_euler);
    _pos.set(0.095, 0.78, 0);
    _matLocal.compose(_pos, _quat, _scale).premultiply(_matWorld);
    this.rightLegMesh.setMatrixAt(idx, _matLocal);

    // 2. Tronco (altura 0.58m, base no quadril y = 0.78 -> topo 1.36m)
    _euler.set(_pose.torsoLeanX, 0, 0);
    _quat.setFromEuler(_euler);
    _pos.set(0, 0.78, 0);
    _matLocal.compose(_pos, _quat, _scale).premultiply(_matWorld);
    this.torsoMesh.setMatrixAt(idx, _matLocal);

    // 3. Cabeça e cabelo (pescoço y = 1.36 -> topo ~1.75m)
    _euler.set(_pose.headPitch + _pose.torsoLeanX * 0.5, 0, 0);
    _quat.setFromEuler(_euler);
    _pos.set(0, 1.36, 0);
    _matLocal.compose(_pos, _quat, _scale).premultiply(_matWorld);
    this.headMesh.setMatrixAt(idx, _matLocal);
    this.hairMesh.setMatrixAt(idx, _matLocal);

    // 4. Braços (ombros em y = 1.31)
    _euler.set(_pose.leftArmX, 0, _pose.leftArmZ, 'XYZ');
    _quat.setFromEuler(_euler);
    _pos.set(-0.255, 1.31, 0);
    _matLocal.compose(_pos, _quat, _scale).premultiply(_matWorld);
    this.leftArmMesh.setMatrixAt(idx, _matLocal);

    _euler.set(_pose.rightArmX, 0, _pose.rightArmZ, 'XYZ');
    _quat.setFromEuler(_euler);
    _pos.set(0.255, 1.31, 0);
    _matLocal.compose(_pos, _quat, _scale).premultiply(_matWorld);
    this.rightArmMesh.setMatrixAt(idx, _matLocal);

    // 5. Guarda-chuva / sombrinha
    if (
      a.umbrellaOpen &&
      a.state !== 'FLEE' &&
      a.state !== 'DODGE' &&
      a.state !== 'VOLLEY'
    ) {
      _euler.set(0.16, 0, -0.05, 'XYZ');
      _quat.setFromEuler(_euler);
      _pos.set(0.255, 1.24, 0.44);
      _scale.set(1, 1, 1);
      _matLocal.compose(_pos, _quat, _scale).premultiply(_matWorld);
      this.umbrellaShaftMesh.setMatrixAt(idx, _matLocal);
      this.umbrellaCanopyMesh.setMatrixAt(idx, _matLocal);
    } else {
      _matLocal.makeScale(0, 0, 0);
      this.umbrellaShaftMesh.setMatrixAt(idx, _matLocal);
      this.umbrellaCanopyMesh.setMatrixAt(idx, _matLocal);
    }

    // 6. Skate (apenas skatistas)
    if (a.archetype === 'skater') {
      _euler.set(0, a.yaw, 0);
      _quat.setFromEuler(_euler);
      _pos.set(a.x, a.y + 0.02, a.z);
      _scale.set(a.fadeAlpha, a.fadeAlpha, a.fadeAlpha);
      _matLocal.compose(_pos, _quat, _scale);
      this.boardMesh.setMatrixAt(idx, _matLocal);
    } else {
      _matLocal.makeScale(0, 0, 0);
      this.boardMesh.setMatrixAt(idx, _matLocal);
    }
  }
}
