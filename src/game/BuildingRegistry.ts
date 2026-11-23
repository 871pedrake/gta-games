import * as THREE from 'three';
import { BuildingCollider, VehicleEntity } from './types';
import { WORLD_POIS, WorldRegistry } from './world/WorldRegistry';

export type BuildingCategory =
  | 'home'
  | 'workplace'
  | 'market_gym'
  | 'bar'
  | 'beach'
  | 'plaza';

export interface RegisteredPlace {
  id: string;
  name: string;
  category: BuildingCategory;
  x: number;
  z: number;
  entryX: number;
  entryZ: number;
  hasInterior: boolean;
  insideCount: number;
  collider?: BuildingCollider;
}

export interface StaticObstacle {
  x: number;
  z: number;
  radius: number;
  height: number;
  label: string;
}

/**
 * Registro central de prédios, pontos de entrada nas calçadas, locais de lazer
 * e obstáculos estáticos (bancos, postes, barracas) alimentado pelo WorldRegistry.
 */
export class BuildingRegistry {
  public readonly places: RegisteredPlace[] = [];
  public readonly homes: RegisteredPlace[] = [];
  public readonly workplaces: RegisteredPlace[] = [];
  public readonly markets: RegisteredPlace[] = [];
  public readonly bars: RegisteredPlace[] = [];
  public readonly beaches: RegisteredPlace[] = [];
  public readonly plazas: RegisteredPlace[] = [];
  public readonly shelters: RegisteredPlace[] = [];
  public readonly staticObstacles: StaticObstacle[] = [];

  private staticColliderGroup: THREE.Group | null = null;
  private dynamicColliderGroup: THREE.Group | null = null;
  private carBoxMeshes: Array<{ mesh: THREE.LineSegments; height: number }> = [];
  private npcCapsuleMesh: THREE.InstancedMesh | null = null;
  private npcHeadMesh: THREE.InstancedMesh | null = null;
  private readonly dbgPos = new THREE.Vector3();
  private readonly dbgQuat = new THREE.Quaternion();
  private readonly dbgScale = new THREE.Vector3(1, 1, 1);
  private readonly dbgMat = new THREE.Matrix4();

  constructor(buildings: BuildingCollider[]) {
    this.registerBuildings(buildings);
    this.registerLeisureSpots();
    this.registerStaticObstacles();
  }

  private registerBuildings(buildings: BuildingCollider[]): void {
    const byLabel = new Map(WorldRegistry.buildings.map((spec) => [spec.label, spec.category]));

    buildings.forEach((b, idx) => {
      const name = b.label ?? `Edifício ${idx + 1}`;
      const category: BuildingCategory = byLabel.get(name) ?? (idx % 2 === 0 ? 'home' : 'workplace');

      const doorOnSouth = b.z < 0;
      const entryX = b.x;
      const entryZ = doorOnSouth ? b.z + b.halfD + 1.4 : b.z - b.halfD - 1.4;

      const place: RegisteredPlace = {
        id: `bld_${idx}`,
        name,
        category,
        x: b.x,
        z: b.z,
        entryX,
        entryZ,
        hasInterior: true,
        insideCount: 0,
        collider: b,
      };
      this.addPlace(place);

      if (name === 'Garagem Central' || name === 'Residencial Brisa') {
        this.addPlace({
          id: `mkt_${idx}`,
          name: name === 'Garagem Central' ? 'Mercado Solara' : 'Academia Brisa',
          category: 'market_gym',
          x: b.x + b.halfW + 1.5,
          z: b.z,
          entryX: b.x + b.halfW + 2.2,
          entryZ: b.z,
          hasInterior: true,
          insideCount: 0,
        });
      }
    });
  }

  private registerLeisureSpots(): void {
    WorldRegistry.getPoisByCategory('bar').forEach((bar) => {
      const p: RegisteredPlace = {
        id: bar.id,
        name: bar.name,
        category: 'bar',
        x: bar.x,
        z: bar.z,
        entryX: bar.entryX,
        entryZ: bar.entryZ,
        hasInterior: false,
        insideCount: 0,
      };
      this.addPlace(p);
      this.shelters.push(p);
    });

    WorldRegistry.getPoisByCategory('stall').forEach((st) => {
      const p: RegisteredPlace = {
        id: st.id,
        name: st.name,
        category: st.x >= WorldRegistry.getCoastlineX(st.z) - 2 ? 'beach' : 'plaza',
        x: st.x,
        z: st.z,
        entryX: st.entryX,
        entryZ: st.entryZ,
        hasInterior: false,
        insideCount: 0,
      };
      this.addPlace(p);
      this.shelters.push(p);
    });

    WorldRegistry.getPoisByCategory('bus_stop').forEach((bs, i) => {
      this.shelters.push({
        id: bs.id,
        name: `Abrigo ${bs.name || `Parada ${i + 1}`}`,
        category: 'plaza',
        x: bs.x,
        z: bs.z,
        entryX: bs.entryX,
        entryZ: bs.entryZ,
        hasInterior: false,
        insideCount: 0,
      });
    });

    for (const volley of WorldRegistry.getPoisByCategory('volleyball')) {
      this.addPlace({
        id: volley.id,
        name: volley.name,
        category: 'beach',
        x: volley.x,
        z: volley.z,
        entryX: volley.entryX,
        entryZ: volley.entryZ,
        hasInterior: false,
        insideCount: 0,
      });
    }

    this.addPlace({
      id: 'beach_north',
      name: 'Praia Norte',
      category: 'beach',
      x: WorldRegistry.getCoastlineX(-48) + 8,
      z: -48,
      entryX: WorldRegistry.getCoastlineX(-48) + 7.2,
      entryZ: -48,
      hasInterior: false,
      insideCount: 0,
    });

    this.addPlace({
      id: 'plaza_prom',
      name: 'Calçadão Central',
      category: 'plaza',
      x: WorldRegistry.getCoastlineX(-4) - 5.2,
      z: -4,
      entryX: WorldRegistry.getCoastlineX(-4) - 5.2,
      entryZ: -4,
      hasInterior: false,
      insideCount: 0,
    });
  }

  private addPlace(place: RegisteredPlace): void {
    this.places.push(place);
    if (place.category === 'home') this.homes.push(place);
    else if (place.category === 'workplace') this.workplaces.push(place);
    else if (place.category === 'market_gym') this.markets.push(place);
    else if (place.category === 'bar') this.bars.push(place);
    else if (place.category === 'beach') this.beaches.push(place);
    else this.plazas.push(place);
    if (place.hasInterior) this.shelters.push(place);
  }

  public findNearestShelter(x: number, z: number, preferInterior: boolean): RegisteredPlace {
    let best = this.shelters[0] ?? this.places[0];
    let bestScore = Infinity;
    for (const s of this.shelters) {
      if (preferInterior && !s.hasInterior) continue;
      const d2 = (s.entryX - x) ** 2 + (s.entryZ - z) ** 2;
      if (d2 < bestScore) {
        bestScore = d2;
        best = s;
      }
    }
    return best;
  }

  private registerStaticObstacles(): void {
    for (const b of WORLD_POIS.benches) {
      this.staticObstacles.push({ x: b.x, z: b.z, radius: 1.15, height: 1.0, label: 'Banco' });
    }
    for (const s of WORLD_POIS.stalls) {
      this.staticObstacles.push({ x: s.x, z: s.z, radius: 1.5, height: 2.6, label: 'Barraca' });
    }
    for (const bs of WORLD_POIS.busStops) {
      this.staticObstacles.push({ x: bs.x, z: bs.z, radius: 1.4, height: 2.8, label: 'Parada' });
    }
    for (let z = -220; z <= 220; z += 36) {
      this.staticObstacles.push({
        x: WorldRegistry.getCoastalRoadX(z) + 7.6,
        z,
        radius: 0.45,
        height: 5.4,
        label: 'Poste',
      });
    }
    for (let x = -220; x <= 40; x += 44) {
      if (Math.hypot(x + 20, 0) < 28 || Math.abs(x + 140) < 15) continue;
      this.staticObstacles.push({ x, z: 0, radius: 0.45, height: 5.4, label: 'Poste' });
    }
  }

  public getTotalInsideCount(): number {
    let total = 0;
    for (const p of this.places) {
      total += p.insideCount;
    }
    return total;
  }

  /**
   * Cria grupos de debug (prédios, obstáculos, caixas dos carros e cápsulas de NPCs).
   */
  public getDebugColliderGroups(
    buildings: BuildingCollider[],
    vehicles: VehicleEntity[],
    maxNpcs: number
  ): { staticGroup: THREE.Group; dynamicGroup: THREE.Group } {
    if (!this.staticColliderGroup) {
      const grp = new THREE.Group();
      const bMat = new THREE.LineBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.7 });
      for (const b of buildings) {
        const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(b.halfW * 2, b.height, b.halfD * 2));
        const wire = new THREE.LineSegments(edges, bMat);
        wire.position.set(b.x, (b.baseY ?? 0) + b.height / 2, b.z);
        grp.add(wire);
      }

      // Pontos de entrada (portas) em verde
      const doorMat = new THREE.MeshBasicMaterial({ color: 0x22f59a, wireframe: true });
      const doorGeo = new THREE.BoxGeometry(1.4, 2.2, 1.4);
      for (const p of this.places) {
        if (!p.hasInterior) continue;
        const dm = new THREE.Mesh(doorGeo, doorMat);
        dm.position.set(p.entryX, WorldRegistry.getTerrainHeightAt(p.entryX, p.entryZ) + 1.1, p.entryZ);
        grp.add(dm);
      }

      // Obstáculos estáticos em laranja
      const obsMat = new THREE.MeshBasicMaterial({ color: 0xff8c38, wireframe: true });
      for (const o of this.staticObstacles) {
        const cyl = new THREE.Mesh(new THREE.CylinderGeometry(o.radius, o.radius, o.height, 8), obsMat);
        cyl.position.set(o.x, o.height / 2, o.z);
        grp.add(cyl);
      }
      this.staticColliderGroup = grp;
    }

    if (!this.dynamicColliderGroup) {
      const dyn = new THREE.Group();
      const carMat = new THREE.LineBasicMaterial({ color: 0xff2e93 });
      this.carBoxMeshes = vehicles.map((v) => {
        const vHeight = v.type === 'bus' ? 2.85 : v.type === 'ambulance' ? 2.45 : 1.5;
        const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(v.halfWidth * 2, vHeight - 0.12, v.halfLength * 2));
        const wire = new THREE.LineSegments(edges, carMat);
        dyn.add(wire);
        return { mesh: wire, height: vHeight };
      });

      const capGeo = new THREE.CapsuleGeometry(0.28, 1.75 - 2 * 0.28, 4, 8);
      capGeo.translate(0, 1.75 * 0.5, 0);
      const capMat = new THREE.MeshBasicMaterial({ color: 0xfacc15, wireframe: true });
      this.npcCapsuleMesh = new THREE.InstancedMesh(capGeo, capMat, maxNpcs);
      this.npcCapsuleMesh.frustumCulled = false;
      this.npcCapsuleMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      dyn.add(this.npcCapsuleMesh);

      const headGeo = new THREE.SphereGeometry(0.22, 8, 6);
      const headMat = new THREE.MeshBasicMaterial({ color: 0x22d3ee, wireframe: true });
      this.npcHeadMesh = new THREE.InstancedMesh(headGeo, headMat, maxNpcs);
      this.npcHeadMesh.frustumCulled = false;
      this.npcHeadMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      dyn.add(this.npcHeadMesh);

      this.dynamicColliderGroup = dyn;
    }

    return {
      staticGroup: this.staticColliderGroup,
      dynamicGroup: this.dynamicColliderGroup,
    };
  }

  public updateDynamicColliders(
    vehicles: VehicleEntity[],
    npcCoords: Array<{
      active: boolean;
      inside: boolean;
      x: number;
      y: number;
      z: number;
      widthScale?: number;
      heightScale?: number;
    }>
  ): void {
    for (let i = 0; i < vehicles.length && i < this.carBoxMeshes.length; i++) {
      const v = vehicles[i];
      const entry = this.carBoxMeshes[i];
      entry.mesh.position.set(v.x, v.mesh.position.y + (entry.height + 0.12) * 0.5, v.z);
      entry.mesh.rotation.y = v.heading;
    }

    if (this.npcCapsuleMesh) {
      for (let i = 0; i < npcCoords.length; i++) {
        const a = npcCoords[i];
        if (!a.active || a.inside) {
          this.dbgMat.makeScale(0, 0, 0);
          this.npcCapsuleMesh.setMatrixAt(i, this.dbgMat);
          this.npcHeadMesh?.setMatrixAt(i, this.dbgMat);
        } else {
          const ws = a.widthScale ?? 1;
          const hs = a.heightScale ?? 1;
          this.dbgPos.set(a.x, a.y, a.z);
          this.dbgScale.set(ws, hs, ws);
          this.dbgMat.compose(this.dbgPos, this.dbgQuat, this.dbgScale);
          this.npcCapsuleMesh.setMatrixAt(i, this.dbgMat);

          if (this.npcHeadMesh) {
            this.dbgPos.set(a.x, a.y + (1.75 - 0.16) * hs, a.z);
            this.dbgScale.set(ws, ws, ws);
            this.dbgMat.compose(this.dbgPos, this.dbgQuat, this.dbgScale);
            this.npcHeadMesh.setMatrixAt(i, this.dbgMat);
          }
        }
      }
      this.npcCapsuleMesh.instanceMatrix.needsUpdate = true;
      if (this.npcHeadMesh) {
        this.npcHeadMesh.instanceMatrix.needsUpdate = true;
      }
    }
  }
}
