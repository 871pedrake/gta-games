import * as THREE from 'three';
import {
  BUILDING_LOD_LOW_DIST,
  BUILDING_LOD_MID_DIST,
  PLAYER_SPAWN_X,
  PLAYER_SPAWN_Z,
  QUALITY_SETTINGS,
  WORLD_CHUNK_SIZE,
} from './config';
import {
  ColoredGeometryPart,
  createInstancedBatch,
  InstanceTransform,
  makeBakedBox,
  makeBakedPlaneXZ,
  mergeAndDisposeGeometries,
  mergeColoredGeometries,
  splitGeometryIntoChunks,
} from './core/WorldBatching';
import {
  createAsphaltTexture,
  createBuildingFacadeTexture,
  createCashPickupMesh,
  createSandTexture,
} from './models';
import { BuildingCollider, CashPickup } from './types';
import {
  ChunkTrafficSpawn,
  getChunkKey,
  WorldChunkManager,
  worldToChunkCoord,
} from './world/WorldChunkSystem';
import {
  BuildingSpec,
  CANAL_BRIDGES,
  CANAL_SPEC,
  CORE_POIS,
  getBridgeElevationAt,
  getCoastlineX,
  getCoastalRoadX,
  getMorroElevation,
  getSoftHillElevationAt,
  getTerrainHeightAt,
  getTunnelHillElevationAt,
  getViaductDeckElevationAt,
  INTERSECTIONS,
  MISSION_POINTS,
  OFFSHORE_ISLANDS,
  SOFT_HILLS,
  STREETS,
  StreetPoint,
  TUNEL_SPEC,
  VIADUTO_SPEC,
  WORLD_BOUNDS,
  WORLD_POIS,
  WorldRegistry,
} from './world/WorldRegistry';

export {
  MISSION_POINTS,
  WORLD_BOUNDS,
  WORLD_POIS,
};

export interface WorldRefs {
  buildings: BuildingCollider[];
  pickups: CashPickup[];
  oceanMesh: THREE.Mesh;
  oceanBaseY: Float32Array;
  neonTrimMats: THREE.MeshStandardMaterial[];
  lampBulbMats: THREE.MeshStandardMaterial[];
  facadeMats: THREE.MeshStandardMaterial[];
  managedTextures: THREE.Texture[];
  mission1StartBeacon: THREE.Group;
  mission2StartBeacon: THREE.Group;
  objectiveBeacon: THREE.Group;
  briefcaseMesh: THREE.Group;
  trafficLightNsMats: THREE.MeshBasicMaterial[];
  trafficLightEwMats: THREE.MeshBasicMaterial[];
  asphaltMat: THREE.MeshStandardMaterial;
  promenadeMat: THREE.MeshStandardMaterial;
  chunkManager: WorldChunkManager;
}

function makeBakedOrientedPlane(
  w: number,
  len: number,
  x: number,
  y: number,
  z: number,
  yaw: number
): THREE.BufferGeometry {
  const geo = new THREE.PlaneGeometry(w, len);
  geo.rotateX(-Math.PI / 2);
  if (yaw !== 0) geo.rotateY(yaw);
  geo.translate(x, y, z);
  return geo;
}

function makeCurvedRibbonXZ(
  points: StreetPoint[],
  leftOffset: number,
  rightOffset: number,
  yLeft: number,
  yRight: number,
  uvTileScale = 0.08
): THREE.BufferGeometry {
  const count = points.length;
  const positions = new Float32Array(count * 2 * 3);
  const uvs = new Float32Array(count * 2 * 2);
  const indices: number[] = [];

  let accumDist = 0;
  for (let i = 0; i < count; i++) {
    const prev = points[Math.max(0, i - 1)];
    const cur = points[i];
    const next = points[Math.min(count - 1, i + 1)];
    if (i > 0) {
      accumDist += Math.hypot(cur.x - prev.x, cur.z - prev.z);
    }

    const tx = next.x - prev.x;
    const tz = next.z - prev.z;
    const tLen = Math.hypot(tx, tz) || 1;
    const nx = tz / tLen;
    const nz = -tx / tLen;

    const vBase = i * 2;
    positions[vBase * 3] = cur.x + nx * leftOffset;
    positions[vBase * 3 + 1] = yLeft;
    positions[vBase * 3 + 2] = cur.z + nz * leftOffset;

    positions[(vBase + 1) * 3] = cur.x + nx * rightOffset;
    positions[(vBase + 1) * 3 + 1] = yRight;
    positions[(vBase + 1) * 3 + 2] = cur.z + nz * rightOffset;

    uvs[vBase * 2] = 0;
    uvs[vBase * 2 + 1] = accumDist * uvTileScale;
    uvs[(vBase + 1) * 2] = 1;
    uvs[(vBase + 1) * 2 + 1] = accumDist * uvTileScale;

    if (i < count - 1) {
      const a = vBase;
      const b = vBase + 1;
      const c = vBase + 2;
      const d = vBase + 3;
      indices.push(a, b, c, b, d, c);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function makeCurvedSeawallGeometry(zMin: number, zMax: number, step: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let z = zMin; z < zMax; z += step) {
    const zNext = Math.min(zMax, z + step);
    const x1 = getCoastlineX(z);
    const x2 = getCoastlineX(zNext);
    const dx = x2 - x1;
    const dz = zNext - z;
    const len = Math.hypot(dx, dz) + 0.12;
    const yaw = Math.atan2(dx, dz);
    parts.push(makeBakedBox(0.85, 0.45, len, (x1 + x2) * 0.5, 0.22, (z + zNext) * 0.5, yaw));
  }
  return mergeAndDisposeGeometries(parts);
}

function makeLandRibbonToCoast(
  zStart: number,
  zEnd: number,
  step: number,
  minX: number,
  y = 0
): THREE.BufferGeometry {
  const zs: number[] = [];
  for (let z = zStart; z < zEnd - 0.01; z += step) zs.push(z);
  zs.push(zEnd);

  const count = zs.length;
  const positions = new Float32Array(count * 2 * 3);
  const uvs = new Float32Array(count * 2 * 2);
  const indices: number[] = [];

  for (let i = 0; i < count; i++) {
    const z = zs[i];
    const coastX = getCoastlineX(z) - 0.15;
    const vBase = i * 2;
    positions[vBase * 3] = minX;
    positions[vBase * 3 + 1] = y;
    positions[vBase * 3 + 2] = z;

    positions[(vBase + 1) * 3] = coastX;
    positions[(vBase + 1) * 3 + 1] = y;
    positions[(vBase + 1) * 3 + 2] = z;

    uvs[vBase * 2] = 0;
    uvs[vBase * 2 + 1] = (z - zStart) * 0.02;
    uvs[(vBase + 1) * 2] = 1;
    uvs[(vBase + 1) * 2 + 1] = (z - zStart) * 0.02;

    if (i < count - 1) {
      const a = vBase;
      const b = vBase + 1;
      const c = vBase + 2;
      const d = vBase + 3;
      indices.push(a, b, c, b, d, c);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function subtractAxisIntervals(
  start: number,
  end: number,
  holes: Array<[number, number]>
): Array<[number, number]> {
  const minVal = Math.min(start, end);
  const maxVal = Math.max(start, end);
  let spans: Array<[number, number]> = [[minVal, maxVal]];
  for (const [hMin, hMax] of holes) {
    const next: Array<[number, number]> = [];
    for (const [s0, s1] of spans) {
      if (hMax <= s0 || hMin >= s1) {
        next.push([s0, s1]);
      } else {
        if (hMin > s0 + 0.5) next.push([s0, hMin]);
        if (hMax < s1 - 0.5) next.push([hMax, s1]);
      }
    }
    spans = next;
  }
  return spans;
}

function markSubtreeSharedGeometries(root: THREE.Object3D): void {
  root.traverse((obj) => {
    if (obj instanceof THREE.Mesh && obj.geometry) {
      obj.geometry.userData.chunkBlueprintShared = true;
    }
  });
}

export function buildCoastalWorld(
  scene: THREE.Scene,
  maxAnisotropy: number,
  mipmaps = true
): WorldRefs {
  const buildings: BuildingCollider[] = [];
  const pickups: CashPickup[] = [];
  const neonTrimMats: THREE.MeshStandardMaterial[] = [];
  const lampBulbMats: THREE.MeshStandardMaterial[] = [];
  const facadeMats: THREE.MeshStandardMaterial[] = [];
  const managedTextures: THREE.Texture[] = [];
  const trafficLightNsMats: THREE.MeshBasicMaterial[] = [];
  const trafficLightEwMats: THREE.MeshBasicMaterial[] = [];

  const chunkManager = new WorldChunkManager(scene, WORLD_CHUNK_SIZE);
  const sharedGeosToDispose: THREE.BufferGeometry[] = [];
  const sharedMatsToDispose: THREE.Material[] = [];

  // Coletores de geometria estática (mergeGeometries + splitGeometryIntoChunks) e transformações de mobiliário (InstancedMesh)
  const terrainColoredParts: ColoredGeometryPart[] = [];
  const propsColoredParts: ColoredGeometryPart[] = [];
  const markingsColoredParts: ColoredGeometryPart[] = [];
  const roadGeos: THREE.BufferGeometry[] = [];
  const sandGeos: THREE.BufferGeometry[] = [];
  const promenadeGeos: THREE.BufferGeometry[] = [];
  const canalWaterGeos: THREE.BufferGeometry[] = [];

  const propsCountByChunk = new Map<string, number>();
  const addPropCount = (x: number, z: number, count = 1) => {
    const ck = getChunkKey(worldToChunkCoord(x, WORLD_CHUNK_SIZE), worldToChunkCoord(z, WORLD_CHUNK_SIZE));
    propsCountByChunk.set(ck, (propsCountByChunk.get(ck) ?? 0) + count);
  };

  const pushInstance = (
    bucket: Map<string, InstanceTransform[]>,
    t: InstanceTransform,
    countAsProp = true
  ) => {
    const ck = getChunkKey(worldToChunkCoord(t.x, WORLD_CHUNK_SIZE), worldToChunkCoord(t.z, WORLD_CHUNK_SIZE));
    const arr = bucket.get(ck) ?? [];
    arr.push(t);
    bucket.set(ck, arr);
    if (countAsProp) addPropCount(t.x, t.z, 1);
  };

  const benchesByChunk = new Map<string, InstanceTransform[]>();
  const stallsByChunk = new Map<string, InstanceTransform[]>();
  const busStopsByChunk = new Map<string, InstanceTransform[]>();
  const busGlassByChunk = new Map<string, InstanceTransform[]>();
  const busSignsByChunk = new Map<string, InstanceTransform[]>();
  const bollardsByChunk = new Map<string, InstanceTransform[]>();
  const lampPolesByChunk = new Map<string, InstanceTransform[]>();
  const lampBulbsByChunk = new Map<string, InstanceTransform[]>();
  const tunnelLightsByChunk = new Map<string, InstanceTransform[]>();
  const signalPolesByChunk = new Map<string, InstanceTransform[]>();
  const sigNsByChunk = new Map<string, InstanceTransform[]>();
  const sigEwByChunk = new Map<string, InstanceTransform[]>();
  const nightBarPostsByChunk = new Map<string, InstanceTransform[]>();
  const urbanTreesByChunk = new Map<string, InstanceTransform[]>();
  const palmsByChunk = new Map<string, InstanceTransform[]>();

  // 1. Terreno base da cidade recortado exatamente no Canal de Solara e limitado à grade [-320..320]
  const groundParts: THREE.BufferGeometry[] = [
    makeLandRibbonToCoast(-320, CANAL_SPEC.zMin, 16, -320, 0),
    makeLandRibbonToCoast(CANAL_SPEC.zMax, 320, 16, -320, 0),
    makeBakedPlaneXZ(
      CANAL_SPEC.xMin - -320,
      CANAL_SPEC.zMax - CANAL_SPEC.zMin,
      (-320 + CANAL_SPEC.xMin) * 0.5,
      0,
      CANAL_SPEC.zCenter
    ),
  ];
  terrainColoredParts.push({ geo: mergeAndDisposeGeometries(groundParts), colorHex: 0x262538 });

  // Curva suave da orla dividida em trecho Norte e Sul da embocadura do Canal
  const coastPointsNorth: StreetPoint[] = [];
  for (let z = -320; z < CANAL_SPEC.zMin; z += 10) {
    coastPointsNorth.push({ x: getCoastlineX(z), z });
  }
  coastPointsNorth.push({ x: getCoastlineX(CANAL_SPEC.zMin), z: CANAL_SPEC.zMin });

  const coastPointsSouth: StreetPoint[] = [{ x: getCoastlineX(CANAL_SPEC.zMax), z: CANAL_SPEC.zMax }];
  for (let z = Math.ceil(CANAL_SPEC.zMax / 10) * 10; z <= 320; z += 10) {
    coastPointsSouth.push({ x: getCoastlineX(z), z });
  }

  // Calçadão litorâneo contínuo seguindo a curva da orla
  const promenadeMat = new THREE.MeshStandardMaterial({
    color: 0xd8c6b8,
    roughness: 0.84,
    metalness: 0.05,
  });
  promenadeGeos.push(
    makeCurvedRibbonXZ(coastPointsNorth, -14.3, 0.2, 0.09, 0.09, 0.05),
    makeCurvedRibbonXZ(coastPointsSouth, -14.3, 0.2, 0.09, 0.09, 0.05)
  );

  // Mureta curva da orla
  propsColoredParts.push({
    geo: mergeAndDisposeGeometries([
      makeCurvedSeawallGeometry(-320, CANAL_SPEC.zMin, 14),
      makeCurvedSeawallGeometry(CANAL_SPEC.zMax, 320, 14),
    ]),
    colorHex: 0x3b3552,
  });

  // 2. Praia de areia curva inclinada suavemente até o mar
  const sandTex = createSandTexture(maxAnisotropy, mipmaps);
  managedTextures.push(sandTex);
  const sandMat = new THREE.MeshStandardMaterial({
    map: sandTex,
    roughness: 0.95,
    metalness: 0.02,
  });
  sandGeos.push(
    makeCurvedRibbonXZ(coastPointsNorth, 0.0, 52.0, 0.05, -1.18, 0.04),
    makeCurvedRibbonXZ(coastPointsSouth, 0.0, 52.0, 0.05, -1.18, 0.04)
  );

  // 3. Oceano low-poly animado global até o horizonte distante (1 draw call)
  const oceanGeo = new THREE.PlaneGeometry(780, 1200, 42, 54);
  oceanGeo.rotateX(-Math.PI / 2);
  const oceanPos = oceanGeo.attributes.position;
  const oceanBaseY = new Float32Array(oceanPos.count);
  for (let i = 0; i < oceanPos.count; i++) {
    oceanBaseY[i] = oceanPos.getY(i);
  }
  const oceanMat = new THREE.MeshStandardMaterial({
    color: 0x0e6b9e,
    roughness: 0.18,
    metalness: 0.55,
    flatShading: true,
    transparent: true,
    opacity: 0.9,
  });
  const oceanMesh = new THREE.Mesh(oceanGeo, oceanMat);
  oceanMesh.position.set(455, -0.45, 0);
  oceanMesh.receiveShadow = true;
  scene.add(oceanMesh);

  // 3a. Canal de Solara (leito submerso, água, muros do cais, eclusa oeste e cais da marina)
  const canalCoastX = getCoastlineX(CANAL_SPEC.zCenter);
  const canalLen = canalCoastX + 34 - CANAL_SPEC.xMin;
  const canalMidX = (CANAL_SPEC.xMin + canalCoastX + 34) * 0.5;
  terrainColoredParts.push({
    geo: makeBakedPlaneXZ(canalLen, CANAL_SPEC.zMax - CANAL_SPEC.zMin + 0.6, canalMidX, CANAL_SPEC.bedY, CANAL_SPEC.zCenter),
    colorHex: 0x162233,
  });

  canalWaterGeos.push(
    makeBakedPlaneXZ(
      canalCoastX + 18 - CANAL_SPEC.xMin,
      CANAL_SPEC.zMax - CANAL_SPEC.zMin + 0.2,
      (CANAL_SPEC.xMin + canalCoastX + 18) * 0.5,
      CANAL_SPEC.waterY,
      CANAL_SPEC.zCenter
    )
  );

  const quayStoneGeos: THREE.BufferGeometry[] = [];
  const quayLen = canalCoastX - CANAL_SPEC.xMin;
  const quayMidX = (CANAL_SPEC.xMin + canalCoastX) * 0.5;
  quayStoneGeos.push(
    makeBakedBox(quayLen, 1.8, 1.0, quayMidX, -0.65, CANAL_SPEC.zMin - 0.35),
    makeBakedBox(quayLen, 1.8, 1.0, quayMidX, -0.65, CANAL_SPEC.zMax + 0.35),
    makeBakedBox(1.2, 2.0, CANAL_SPEC.zMax - CANAL_SPEC.zMin + 2.0, CANAL_SPEC.xMin - 0.4, -0.55, CANAL_SPEC.zCenter),
    makeBakedBox(quayLen, 0.16, 2.2, quayMidX, 0.08, CANAL_SPEC.zMin - 1.5),
    makeBakedBox(quayLen, 0.16, 2.2, quayMidX, 0.08, CANAL_SPEC.zMax + 1.5)
  );
  const marinaQuayPts: StreetPoint[] = [];
  for (let z = 108; z <= 152; z += 6) {
    marinaQuayPts.push({ x: getCoastlineX(z), z });
  }
  quayStoneGeos.push(makeCurvedRibbonXZ(marinaQuayPts, -2.6, 2.2, 0.38, 0.38, 0.08));
  for (let z = 110; z <= 150; z += 8) {
    const mx = getCoastlineX(z);
    quayStoneGeos.push(makeBakedBox(1.2, 1.4, 7.8, mx + 2.0, -0.25, z));
  }
  propsColoredParts.push({ geo: mergeAndDisposeGeometries(quayStoneGeos), colorHex: 0x525b6e });

  // Cabeços de amarração amarelos (InstancedMesh por chunk)
  for (let bx = CANAL_SPEC.xMin + 6; bx <= canalCoastX - 6; bx += 14) {
    if (getBridgeElevationAt(bx, CANAL_SPEC.zCenter)) continue;
    for (const bz of [CANAL_SPEC.zMin - 0.55, CANAL_SPEC.zMax + 0.55]) {
      pushInstance(bollardsByChunk, { x: bx, y: 0.48, z: bz });
    }
  }
  for (let bz = 110; bz <= 150; bz += 8) {
    pushInstance(bollardsByChunk, { x: getCoastlineX(bz) + 1.6, y: 0.7, z: bz });
  }

  // Píer de madeira da Marina Sul
  const pierStartCoast = getCoastlineX(130);
  const pierParts: THREE.BufferGeometry[] = [
    makeBakedBox(46, 0.35, 9.5, pierStartCoast + 21, 0.4, 130),
  ];
  for (let px = pierStartCoast + 4; px <= pierStartCoast + 42; px += 9) {
    [-3.9, 3.9].forEach((pz) => {
      const post = new THREE.CylinderGeometry(0.28, 0.3, 2.2, 7);
      post.translate(px, -0.4, 130 + pz);
      pierParts.push(post);
    });
  }
  propsColoredParts.push({ geo: mergeAndDisposeGeometries(pierParts), colorHex: 0x6b4730 });

  // 3b. Bases visuais por distrito + Terreno 3D do Morro da Brisa
  const addDistrictPad = (rects: Array<[number, number, number, number]>, colorHex: number) => {
    const geos = rects.map(([x, z, w, d]) => makeBakedPlaneXZ(w, d, x, 0.015, z));
    terrainColoredParts.push({ geo: mergeAndDisposeGeometries(geos), colorHex });
  };
  addDistrictPad(
    [
      [-52, -245, 56, 56],
      [-110, -165, 54, 68],
      [-50, -165, 54, 68],
      [-110, -245, 54, 56],
    ],
    0x27593d
  );
  addDistrictPad(
    [
      [14, -245, 58, 56],
      [14, -168, 56, 66],
    ],
    0x385947
  );
  addDistrictPad(
    [
      [-246, 98, 48, 44],
      [-178, 98, 52, 44],
      [-246, 168, 48, 54],
      [-178, 168, 52, 54],
    ],
    0x2f4f38
  );
  addDistrictPad(
    [
      [-50, 96, 46, 48],
      [2, 96, 36, 48],
      [46, 96, 30, 48],
    ],
    0x4d4039
  );
  addDistrictPad([[-110, -32, 48, 44]], 0x3b3559);
  addDistrictPad([[-150, 245, 250, 62]], 0x1d222e);

  // Morro da Brisa
  const morroGeo = new THREE.PlaneGeometry(134, 66, 36, 22);
  morroGeo.rotateX(-Math.PI / 2);
  const morroOriginX = -213;
  const morroOriginZ = -247;
  const mPos = morroGeo.attributes.position;
  const mColors = new Float32Array(mPos.count * 3);
  const cGrass = new THREE.Color(0x524034);
  const cTerrace = new THREE.Color(0x474a57);
  for (let i = 0; i < mPos.count; i++) {
    const wx = mPos.getX(i) + morroOriginX;
    const wz = mPos.getZ(i) + morroOriginZ;
    const h = getMorroElevation(wx, wz);
    mPos.setY(i, h);
    const onPlateau = (wz < -229 && wz > -247) || wz < -258;
    const c = onPlateau && h > 2.5 ? cTerrace : cGrass;
    mColors[i * 3] = c.r;
    mColors[i * 3 + 1] = c.g;
    mColors[i * 3 + 2] = c.b;
  }
  morroGeo.setAttribute('color', new THREE.BufferAttribute(mColors, 3));
  morroGeo.translate(morroOriginX, 0.01, morroOriginZ);
  morroGeo.computeVertexNormals();
  terrainColoredParts.push({ geo: morroGeo });

  // Ladeiras e escadaria do Morro da Brisa
  const morroStoneGeos: THREE.BufferGeometry[] = [];
  const morroRailGeos: THREE.BufferGeometry[] = [];
  for (const lx of [-250, -160]) {
    for (let z = -216; z > -266; z -= 3) {
      const z2 = z - 3;
      const y1 = getMorroElevation(lx, z);
      const y2 = getMorroElevation(lx, z2);
      const dy = y2 - y1;
      const segLen = Math.hypot(3, dy) + 0.15;
      const pitch = Math.atan2(dy, 3);
      const slab = new THREE.BoxGeometry(5.4, 0.28, segLen);
      slab.rotateX(pitch);
      slab.translate(lx, (y1 + y2) * 0.5 + 0.04, (z + z2) * 0.5);
      morroStoneGeos.push(slab);
    }
  }
  const stairSteps = 30;
  for (let s = 0; s < stairSteps; s++) {
    const t = (s + 0.5) / stairSteps;
    const sz = -217 - t * 42;
    const sy = getMorroElevation(-202, sz);
    morroStoneGeos.push(makeBakedBox(4.2, 0.34, 1.5, -202, sy + 0.08, sz));
    if (s % 4 === 0) {
      morroRailGeos.push(makeBakedBox(0.1, 0.95, 0.1, -202, sy + 0.55, sz));
    }
  }
  for (let z = -218; z > -258; z -= 4) {
    const y1 = getMorroElevation(-202, z);
    const y2 = getMorroElevation(-202, z - 4);
    const len = Math.hypot(4, y2 - y1);
    const rail = new THREE.BoxGeometry(0.12, 0.08, len);
    rail.rotateX(Math.atan2(y2 - y1, 4));
    rail.translate(-202, (y1 + y2) * 0.5 + 1.0, z - 2);
    morroRailGeos.push(rail);
  }
  propsColoredParts.push(
    { geo: mergeAndDisposeGeometries(morroStoneGeos), colorHex: 0x5d6272 },
    { geo: mergeAndDisposeGeometries(morroRailGeos), colorHex: 0xfacc15 }
  );

  // 4. Malha viária orientada a dados (WorldRegistry.streets)
  const asphaltTex = createAsphaltTexture(maxAnisotropy, mipmaps);
  managedTextures.push(asphaltTex);
  const asphaltMat = new THREE.MeshStandardMaterial({
    map: asphaltTex,
    roughness: 0.82,
    metalness: 0.08,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });

  const dashGeos: THREE.BufferGeometry[] = [];
  const laneWhiteGeos: THREE.BufferGeometry[] = [];
  const medianGeos: THREE.BufferGeometry[] = [];
  const zebraGeos: THREE.BufferGeometry[] = [];

  for (const street of STREETS) {
    if (street.kind === 'roundabout' && street.roundabout) {
      const rb = street.roundabout;
      const ringGeo = new THREE.RingGeometry(rb.innerRadius, rb.outerRadius, 40);
      ringGeo.rotateX(-Math.PI / 2);
      ringGeo.translate(rb.centerX, 0.038, rb.centerZ);
      roadGeos.push(ringGeo);

      const midR = (rb.innerRadius + rb.outerRadius) * 0.5;
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * Math.PI * 2;
        dashGeos.push(
          makeBakedOrientedPlane(
            0.24,
            1.9,
            rb.centerX + Math.cos(a) * midR,
            0.052,
            rb.centerZ + Math.sin(a) * midR,
            -a
          )
        );
      }

      const islandGeo = new THREE.CylinderGeometry(rb.innerRadius - 0.3, rb.innerRadius, 0.34, 32);
      islandGeo.translate(rb.centerX, 0.17, rb.centerZ);
      medianGeos.push(islandGeo);

      const totemGeo = new THREE.CylinderGeometry(1.1, 1.5, 2.2, 12);
      totemGeo.translate(rb.centerX, 1.35, rb.centerZ);
      medianGeos.push(totemGeo);
      continue;
    }

    if (street.kind === 'coastal') {
      const nBridge = CANAL_SPEC.zMin - CANAL_SPEC.rampLength;
      const sBridge = CANAL_SPEC.zMax + CANAL_SPEC.rampLength;
      const ptsN = street.points.filter((p) => p.z <= nBridge);
      ptsN.push({ x: getCoastalRoadX(nBridge), z: nBridge });
      const ptsS: StreetPoint[] = [{ x: getCoastalRoadX(sBridge), z: sBridge }];
      street.points.filter((p) => p.z >= sBridge).forEach((p) => ptsS.push(p));

      if (ptsN.length >= 2) {
        roadGeos.push(makeCurvedRibbonXZ(ptsN, -street.width * 0.5, street.width * 0.5, 0.036, 0.036, 0.08));
      }
      if (ptsS.length >= 2) {
        roadGeos.push(makeCurvedRibbonXZ(ptsS, -street.width * 0.5, street.width * 0.5, 0.036, 0.036, 0.08));
      }
      for (const seg of street.segments) {
        const yaw = Math.atan2(seg.dirX, seg.dirZ);
        const steps = Math.max(1, Math.floor(seg.length / 9));
        for (let s = 0; s < steps; s++) {
          const t = (s + 0.5) / steps;
          const px = seg.x1 + (seg.x2 - seg.x1) * t;
          const pz = seg.z1 + (seg.z2 - seg.z1) * t;
          if (pz >= nBridge - 0.5 && pz <= sBridge + 0.5) continue;
          dashGeos.push(makeBakedOrientedPlane(0.28, 3.8, px, 0.051, pz, yaw));
        }
      }
      continue;
    }

    const nBridgeCut = CANAL_SPEC.zMin - CANAL_SPEC.rampLength;
    const sBridgeCut = CANAL_SPEC.zMax + CANAL_SPEC.rampLength;
    const isNsAxis = (seg: (typeof street.segments)[number]) => Math.abs(seg.dirZ) > 0.85 && Math.abs(seg.dirX) < 0.2;

    for (const seg of street.segments) {
      const yaw = Math.atan2(seg.dirX, seg.dirZ);
      const yBase = street.kind === 'avenue' ? 0.034 : street.kind === 'secondary' ? 0.032 : 0.028;

      const holes: Array<[number, number]> = [];
      if (isNsAxis(seg)) {
        if (street.id === 'st_av_palmeiras') {
          holes.push([VIADUTO_SPEC.zRampStartN, VIADUTO_SPEC.zRampEndS]);
        } else if (seg.x1 >= CANAL_SPEC.xMin) {
          holes.push([nBridgeCut, sBridgeCut]);
        }
      }

      if (holes.length > 0 && isNsAxis(seg)) {
        const spans = subtractAxisIntervals(seg.z1, seg.z2, holes);
        for (const [z0, z1] of spans) {
          const len = z1 - z0;
          roadGeos.push(makeBakedOrientedPlane(street.width, len + 0.6, seg.x1, yBase, (z0 + z1) * 0.5, 0));
        }
      } else {
        const cx = (seg.x1 + seg.x2) * 0.5;
        const cz = (seg.z1 + seg.z2) * 0.5;
        roadGeos.push(makeBakedOrientedPlane(street.width, seg.length + 1.5, cx, yBase, cz, yaw));
      }

      const inHole = (pz: number) => holes.some(([h0, h1]) => pz >= h0 - 0.5 && pz <= h1 + 0.5);

      if (street.kind === 'avenue' && street.medianWidth > 0) {
        const perpX = seg.dirZ;
        const perpZ = -seg.dirX;
        const laneOffset = street.medianWidth * 0.5 + (street.width - street.medianWidth) * 0.25;

        for (let d = 6; d <= seg.length - 6; d += 10) {
          const px = seg.x1 + seg.dirX * d;
          const pz = seg.z1 + seg.dirZ * d;
          if (inHole(pz)) continue;
          const nearIntersection = INTERSECTIONS.some(
            (it) => Math.hypot(it.x - px, it.z - pz) < it.radius + 4
          );
          if (nearIntersection) continue;
          laneWhiteGeos.push(
            makeBakedOrientedPlane(0.22, 4.0, px + perpX * laneOffset, 0.05, pz + perpZ * laneOffset, yaw),
            makeBakedOrientedPlane(0.22, 4.0, px - perpX * laneOffset, 0.05, pz - perpZ * laneOffset, yaw)
          );
        }

        const sortedSplits: number[] = [0, seg.length];
        for (const it of INTERSECTIONS) {
          const along = (it.x - seg.x1) * seg.dirX + (it.z - seg.z1) * seg.dirZ;
          const perpDist = Math.abs((it.x - seg.x1) * perpX + (it.z - seg.z1) * perpZ);
          if (along >= -2 && along <= seg.length + 2 && perpDist < street.width * 0.65) {
            const gap = it.radius + 3.2;
            sortedSplits.push(Math.max(0, along - gap), Math.min(seg.length, along + gap));
          }
        }
        for (const [h0, h1] of holes) {
          const a0 = (h0 - seg.z1) * seg.dirZ;
          const a1 = (h1 - seg.z1) * seg.dirZ;
          const mn = Math.max(0, Math.min(a0, a1) - 1);
          const mx = Math.min(seg.length, Math.max(a0, a1) + 1);
          if (mx > mn) sortedSplits.push(mn, mx);
        }
        const cuts = Array.from(new Set(sortedSplits)).sort((a, b) => a - b);
        for (let k = 0; k < cuts.length - 1; k++) {
          const a = cuts[k];
          const b = cuts[k + 1];
          const span = b - a;
          if (span < 10) continue;
          const mid = (a + b) * 0.5;
          const mx = seg.x1 + seg.dirX * mid;
          const mz = seg.z1 + seg.dirZ * mid;
          if (inHole(mz)) continue;
          const blockedByInt = INTERSECTIONS.some(
            (it) => Math.hypot(it.x - mx, it.z - mz) < it.radius + 2.5
          );
          if (blockedByInt) continue;
          medianGeos.push(makeBakedBox(street.medianWidth, 0.24, span - 1.2, mx, 0.12, mz, yaw));
        }
      } else if (street.kind === 'secondary') {
        for (let d = 6; d <= seg.length - 6; d += 10) {
          const px = seg.x1 + seg.dirX * d;
          const pz = seg.z1 + seg.dirZ * d;
          if (inHole(pz)) continue;
          const nearIntersection = INTERSECTIONS.some(
            (it) => Math.hypot(it.x - px, it.z - pz) < it.radius + 2
          );
          if (nearIntersection) continue;
          dashGeos.push(makeBakedOrientedPlane(0.26, 4.2, px, 0.049, pz, yaw));
        }
      }
    }
  }
  propsColoredParts.push({ geo: mergeAndDisposeGeometries(medianGeos), colorHex: 0x3b495e });

  // 4b. Pontes, Passarela, Viaduto, Túnel Curto e Colinas Suaves
  const infraStructureGeos: THREE.BufferGeometry[] = [];
  const infraRailGeos: THREE.BufferGeometry[] = [];
  const infraWoodGeos: THREE.BufferGeometry[] = [];

  const nRampZ = CANAL_SPEC.zMin - CANAL_SPEC.rampLength;
  const sRampZ = CANAL_SPEC.zMax + CANAL_SPEC.rampLength;
  const canalWidthSpan = CANAL_SPEC.zMax - CANAL_SPEC.zMin;
  for (const br of CANAL_BRIDGES) {
    const w = br.halfW * 2;
    const rampPitch = Math.atan2(br.deckY, CANAL_SPEC.rampLength);
    const rampHyp = Math.hypot(CANAL_SPEC.rampLength, br.deckY) + 0.12;
    const targetAsphalt = br.isPedestrianOnly ? infraWoodGeos : roadGeos;

    const makeSlopedSlab = (x: number, yMid: number, zMid: number, bw: number, bh: number, bl: number, pitchX: number) => {
      const g = new THREE.BoxGeometry(bw, bh, bl);
      g.rotateX(pitchX);
      g.translate(x, yMid, zMid);
      return g;
    };

    infraStructureGeos.push(
      makeSlopedSlab(br.xCenter, br.deckY * 0.5 - 0.14, (nRampZ + CANAL_SPEC.zMin) * 0.5, w + 0.6, 0.34, rampHyp, -rampPitch),
      makeSlopedSlab(br.xCenter, br.deckY * 0.5 - 0.14, (CANAL_SPEC.zMax + sRampZ) * 0.5, w + 0.6, 0.34, rampHyp, rampPitch),
      makeBakedBox(w + 0.6, 0.42, canalWidthSpan + 0.4, br.xCenter, br.deckY - 0.21, CANAL_SPEC.zCenter),
      makeBakedBox(1.1, br.deckY + 1.6, 1.1, br.xCenter - br.halfW + 0.9, (br.deckY - 1.6) * 0.5, CANAL_SPEC.zMin + 0.4),
      makeBakedBox(1.1, br.deckY + 1.6, 1.1, br.xCenter + br.halfW - 0.9, (br.deckY - 1.6) * 0.5, CANAL_SPEC.zMin + 0.4),
      makeBakedBox(1.1, br.deckY + 1.6, 1.1, br.xCenter - br.halfW + 0.9, (br.deckY - 1.6) * 0.5, CANAL_SPEC.zMax - 0.4),
      makeBakedBox(1.1, br.deckY + 1.6, 1.1, br.xCenter + br.halfW - 0.9, (br.deckY - 1.6) * 0.5, CANAL_SPEC.zMax - 0.4)
    );

    targetAsphalt.push(
      makeSlopedSlab(br.xCenter, br.deckY * 0.5 + 0.01, (nRampZ + CANAL_SPEC.zMin) * 0.5, w - 0.8, 0.06, rampHyp, -rampPitch),
      makeSlopedSlab(br.xCenter, br.deckY * 0.5 + 0.01, (CANAL_SPEC.zMax + sRampZ) * 0.5, w - 0.8, 0.06, rampHyp, rampPitch),
      makeBakedBox(w - 0.8, 0.06, canalWidthSpan + 0.4, br.xCenter, br.deckY + 0.01, CANAL_SPEC.zCenter)
    );

    for (const side of [-1, 1]) {
      const rx = br.xCenter + side * (br.halfW - 0.25);
      infraRailGeos.push(
        makeBakedBox(0.32, 0.78, canalWidthSpan + 0.6, rx, br.deckY + 0.39, CANAL_SPEC.zCenter),
        makeSlopedSlab(rx, br.deckY * 0.5 + 0.38, (nRampZ + CANAL_SPEC.zMin) * 0.5, 0.28, 0.65, rampHyp, -rampPitch),
        makeSlopedSlab(rx, br.deckY * 0.5 + 0.38, (CANAL_SPEC.zMax + sRampZ) * 0.5, 0.28, 0.65, rampHyp, rampPitch)
      );
    }
    if (!br.isPedestrianOnly) {
      dashGeos.push(makeBakedOrientedPlane(0.24, canalWidthSpan * 0.72, br.xCenter, br.deckY + 0.055, CANAL_SPEC.zCenter, 0));
    }
  }

  // Viaduto das Palmeiras
  {
    const vw = VIADUTO_SPEC.halfW * 2;
    const rampNLen = VIADUTO_SPEC.zDeckStart - VIADUTO_SPEC.zRampStartN;
    const rampSLen = VIADUTO_SPEC.zRampEndS - VIADUTO_SPEC.zDeckEnd;
    const deckLen = VIADUTO_SPEC.zDeckEnd - VIADUTO_SPEC.zDeckStart;
    const pitchN = Math.atan2(VIADUTO_SPEC.deckY, rampNLen);
    const pitchS = Math.atan2(VIADUTO_SPEC.deckY, rampSLen);
    const hypN = Math.hypot(rampNLen, VIADUTO_SPEC.deckY) + 0.25;
    const hypS = Math.hypot(rampSLen, VIADUTO_SPEC.deckY) + 0.25;
    const zMidN = (VIADUTO_SPEC.zRampStartN + VIADUTO_SPEC.zDeckStart) * 0.5;
    const zMidDeck = (VIADUTO_SPEC.zDeckStart + VIADUTO_SPEC.zDeckEnd) * 0.5;
    const zMidS = (VIADUTO_SPEC.zDeckEnd + VIADUTO_SPEC.zRampEndS) * 0.5;

    const makeSlopedBox = (x: number, y: number, z: number, bw: number, bh: number, bl: number, rx: number) => {
      const g = new THREE.BoxGeometry(bw, bh, bl);
      g.rotateX(rx);
      g.translate(x, y, z);
      return g;
    };

    infraStructureGeos.push(
      makeSlopedBox(VIADUTO_SPEC.xCenter, VIADUTO_SPEC.deckY * 0.5 - 0.28, zMidN, vw + 0.6, 0.56, hypN, -pitchN),
      makeSlopedBox(VIADUTO_SPEC.xCenter, VIADUTO_SPEC.deckY * 0.5 - 0.28, zMidS, vw + 0.6, 0.56, hypS, pitchS),
      makeBakedBox(vw + 0.6, 0.72, deckLen + 0.6, VIADUTO_SPEC.xCenter, VIADUTO_SPEC.deckY - 0.36, zMidDeck)
    );
    for (const pier of VIADUTO_SPEC.piers) {
      infraStructureGeos.push(
        makeBakedBox(pier.halfW * 2, VIADUTO_SPEC.deckY - 0.3, pier.halfD * 2, pier.x, (VIADUTO_SPEC.deckY - 0.3) * 0.5, pier.z)
      );
    }
    roadGeos.push(
      makeSlopedBox(VIADUTO_SPEC.xCenter, VIADUTO_SPEC.deckY * 0.5 + 0.01, zMidN, vw - 0.9, 0.06, hypN, -pitchN),
      makeSlopedBox(VIADUTO_SPEC.xCenter, VIADUTO_SPEC.deckY * 0.5 + 0.01, zMidS, vw - 0.9, 0.06, hypS, pitchS),
      makeBakedBox(vw - 0.9, 0.06, deckLen + 0.5, VIADUTO_SPEC.xCenter, VIADUTO_SPEC.deckY + 0.01, zMidDeck)
    );
    for (const side of [-1, 1]) {
      const rx = VIADUTO_SPEC.xCenter + side * (VIADUTO_SPEC.halfW - 0.28);
      infraRailGeos.push(
        makeSlopedBox(rx, VIADUTO_SPEC.deckY * 0.5 + 0.42, zMidN, 0.45, 0.85, hypN, -pitchN),
        makeSlopedBox(rx, VIADUTO_SPEC.deckY * 0.5 + 0.42, zMidS, 0.45, 0.85, hypS, pitchS),
        makeBakedBox(0.45, 0.88, deckLen + 0.5, rx, VIADUTO_SPEC.deckY + 0.44, zMidDeck)
      );
    }
    for (let vz = VIADUTO_SPEC.zDeckStart + 3; vz <= VIADUTO_SPEC.zDeckEnd - 3; vz += 7) {
      dashGeos.push(makeBakedOrientedPlane(0.28, 3.8, VIADUTO_SPEC.xCenter, VIADUTO_SPEC.deckY + 0.055, vz, 0));
    }
  }

  // Túnel Curto do Parque + Colina Verde
  {
    const tLen = TUNEL_SPEC.zEnd - TUNEL_SPEC.zStart;
    const tMidZ = (TUNEL_SPEC.zStart + TUNEL_SPEC.zEnd) * 0.5;
    const wallH = TUNEL_SPEC.clearanceY + 0.2;
    infraStructureGeos.push(
      makeBakedBox(0.9, wallH, tLen, TUNEL_SPEC.xCenter - TUNEL_SPEC.boreHalfW - 0.4, wallH * 0.5, tMidZ),
      makeBakedBox(0.9, wallH, tLen, TUNEL_SPEC.xCenter + TUNEL_SPEC.boreHalfW + 0.4, wallH * 0.5, tMidZ),
      makeBakedBox(TUNEL_SPEC.boreHalfW * 2 + 1.8, 1.35, tLen, TUNEL_SPEC.xCenter, TUNEL_SPEC.clearanceY + 0.68, tMidZ),
      makeBakedBox(TUNEL_SPEC.boreHalfW * 2 + 10.4, 1.4, 1.4, TUNEL_SPEC.xCenter, TUNEL_SPEC.clearanceY + 0.7, TUNEL_SPEC.zStart + 0.3),
      makeBakedBox(TUNEL_SPEC.boreHalfW * 2 + 10.4, 1.4, 1.4, TUNEL_SPEC.xCenter, TUNEL_SPEC.clearanceY + 0.7, TUNEL_SPEC.zEnd - 0.3),
      makeBakedBox(4.8, wallH, 1.4, TUNEL_SPEC.xCenter - TUNEL_SPEC.boreHalfW - 2.6, wallH * 0.5, TUNEL_SPEC.zStart + 0.3),
      makeBakedBox(4.8, wallH, 1.4, TUNEL_SPEC.xCenter + TUNEL_SPEC.boreHalfW + 2.6, wallH * 0.5, TUNEL_SPEC.zStart + 0.3),
      makeBakedBox(4.8, wallH, 1.4, TUNEL_SPEC.xCenter - TUNEL_SPEC.boreHalfW - 2.6, wallH * 0.5, TUNEL_SPEC.zEnd - 0.3),
      makeBakedBox(4.8, wallH, 1.4, TUNEL_SPEC.xCenter + TUNEL_SPEC.boreHalfW + 2.6, wallH * 0.5, TUNEL_SPEC.zEnd - 0.3)
    );

    for (let lz = TUNEL_SPEC.zStart + 4; lz <= TUNEL_SPEC.zEnd - 4; lz += 6) {
      pushInstance(tunnelLightsByChunk, {
        x: TUNEL_SPEC.xCenter,
        y: TUNEL_SPEC.clearanceY - 0.05,
        z: lz,
      });
    }

    const hillGeo = new THREE.PlaneGeometry(TUNEL_SPEC.hillHalfW * 2, tLen, 28, 12);
    hillGeo.rotateX(-Math.PI / 2);
    const hPos = hillGeo.attributes.position;
    for (let i = 0; i < hPos.count; i++) {
      const wx = hPos.getX(i) + TUNEL_SPEC.xCenter;
      const wz = hPos.getZ(i) + tMidZ;
      hPos.setY(i, getTunnelHillElevationAt(wx, wz));
    }
    hillGeo.translate(TUNEL_SPEC.xCenter, 0.01, tMidZ);
    hillGeo.computeVertexNormals();
    terrainColoredParts.push({ geo: hillGeo, colorHex: 0x2c6644 });
  }

  // Elevações suaves
  const softHillGeos: THREE.BufferGeometry[] = [];
  for (const h of SOFT_HILLS) {
    const g = new THREE.PlaneGeometry(h.radius * 2, h.radius * 2, 18, 18);
    g.rotateX(-Math.PI / 2);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const wx = p.getX(i) + h.x;
      const wz = p.getZ(i) + h.z;
      p.setY(i, getSoftHillElevationAt(wx, wz));
    }
    g.translate(h.x, 0.008, h.z);
    g.computeVertexNormals();
    softHillGeos.push(g);
  }
  terrainColoredParts.push({ geo: mergeAndDisposeGeometries(softHillGeos), colorHex: 0x2a6142 });

  if (infraStructureGeos.length > 0) {
    propsColoredParts.push({ geo: mergeAndDisposeGeometries(infraStructureGeos), colorHex: 0x525b6e });
  }
  if (infraRailGeos.length > 0) {
    propsColoredParts.push({ geo: mergeAndDisposeGeometries(infraRailGeos), colorHex: 0x94a3b8 });
  }
  if (infraWoodGeos.length > 0) {
    propsColoredParts.push({ geo: mergeAndDisposeGeometries(infraWoodGeos), colorHex: 0x6b4730 });
  }

  // Faixas de pedestres (zebra) e semáforos gerados por cruzamento
  for (const inter of INTERSECTIONS) {
    for (const cw of inter.crosswalks) {
      const halfSpan = cw.width * 0.5;
      const yaw = Math.atan2(cw.dirX, cw.dirZ);
      const baseY = getTerrainHeightAt(cw.centerX, cw.centerZ, 0) + 0.056;
      for (let s = -halfSpan + 0.5; s <= halfSpan - 0.49; s += 1.4) {
        const px = cw.centerX + cw.tangentX * s;
        const pz = cw.centerZ + cw.tangentZ * s;
        zebraGeos.push(makeBakedOrientedPlane(0.65, 2.5, px, baseY, pz, yaw));
      }
    }

    for (const sig of inter.signals) {
      const sy = getTerrainHeightAt(sig.x, sig.z, 0);
      pushInstance(signalPolesByChunk, { x: sig.x, y: sy, z: sig.z, rotY: sig.yaw });
      if (sig.hasNsHead) {
        pushInstance(sigNsByChunk, { x: sig.x, y: sy + 3.5, z: sig.z }, false);
      }
      if (sig.hasEwHead) {
        pushInstance(sigEwByChunk, { x: sig.x, y: sy + 3.2, z: sig.z }, false);
      }
    }
  }

  // 5. Materiais e indexação dos 33 prédios por chunk (LOD criado sob demanda e reutilizável)
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x201d35, roughness: 0.85 });
  const terracottaRoofMat = new THREE.MeshStandardMaterial({ color: 0x9b4632, roughness: 0.82 });
  const glassDomeMat = new THREE.MeshStandardMaterial({
    color: 0x67e8f9,
    emissive: 0x0e7490,
    emissiveIntensity: 0.45,
    roughness: 0.18,
    metalness: 0.75,
  });
  const waterTankMat = new THREE.MeshStandardMaterial({ color: 0x0284c7, roughness: 0.45 });
  const classicStoneMat = new THREE.MeshStandardMaterial({ color: 0xd6d3d1, roughness: 0.72 });

  interface CachedBuildingMaterials {
    facadeMat: THREE.MeshStandardMaterial;
    neonMat: THREE.MeshStandardMaterial;
    lowMat: THREE.MeshStandardMaterial;
  }
  const buildingMaterials = new Map<string, CachedBuildingMaterials>();
  const buildingsByChunk = new Map<string, BuildingSpec[]>();

  for (const b of WorldRegistry.buildings) {
    const tex = createBuildingFacadeTexture(b.wallHex, b.winHex, maxAnisotropy, mipmaps);
    managedTextures.push(tex);
    const facadeMat = new THREE.MeshStandardMaterial({
      map: tex,
      roughness: 0.72,
      metalness: 0.14,
      emissive: new THREE.Color(b.winHex),
      emissiveMap: tex,
      emissiveIntensity: 0.35,
    });
    facadeMats.push(facadeMat);

    const neonMat = new THREE.MeshStandardMaterial({
      color: b.neonHex,
      emissive: b.neonHex,
      emissiveIntensity: b.districtId === 'historico' || b.districtId === 'suburbio' ? 0.55 : 1.5,
      roughness: 0.25,
    });
    neonTrimMats.push(neonMat);

    const lowMat = new THREE.MeshStandardMaterial({
      color: b.wallHex,
      roughness: 0.9,
      metalness: 0.05,
    });

    sharedMatsToDispose.push(facadeMat, neonMat, lowMat);
    buildingMaterials.set(b.id, { facadeMat, neonMat, lowMat });

    buildings.push({
      x: b.x,
      z: b.z,
      halfW: b.w / 2,
      halfD: b.d / 2,
      height: b.h,
      colorHex: b.wallHex,
      label: b.label,
      baseY: b.baseY ?? 0,
    });

    const ck = getChunkKey(worldToChunkCoord(b.x, WORLD_CHUNK_SIZE), worldToChunkCoord(b.z, WORLD_CHUNK_SIZE));
    const arr = buildingsByChunk.get(ck) ?? [];
    arr.push(b);
    buildingsByChunk.set(ck, arr);
  }

  const buildBuildingLod = (b: BuildingSpec): THREE.LOD => {
    const mats = buildingMaterials.get(b.id)!;
    const baseY = b.baseY ?? 0;
    const roofStyle = b.roofStyle ?? WorldRegistry.getDistrictById(b.districtId).roofStyle;
    const lod = new THREE.LOD();
    lod.position.set(b.x, baseY, b.z);

    const bodyGeo = new THREE.BoxGeometry(b.w, b.h, b.d);
    const neonGeo = new THREE.BoxGeometry(b.w + 0.35, 0.36, b.d + 0.35);

    const lod0 = new THREE.Group();
    const body0 = new THREE.Mesh(bodyGeo, mats.facadeMat);
    body0.position.y = b.h / 2;
    body0.castShadow = true;
    body0.receiveShadow = true;
    lod0.add(body0);

    const neonTrim0 = new THREE.Mesh(neonGeo, mats.neonMat);
    neonTrim0.position.y = b.h - 0.5;
    lod0.add(neonTrim0);

    if (roofStyle === 'gable') {
      const pitch = new THREE.Mesh(new THREE.ConeGeometry(Math.max(b.w, b.d) * 0.72, 3.6, 4), terracottaRoofMat);
      pitch.position.y = b.h + 1.8;
      pitch.rotation.y = Math.PI / 4;
      pitch.scale.set(b.w / Math.max(b.w, b.d), 1, b.d / Math.max(b.w, b.d));
      pitch.castShadow = true;
      lod0.add(pitch);
      if (b.id === 'bld_27') {
        const belfry = new THREE.Mesh(new THREE.BoxGeometry(4.2, 6.2, 4.2), classicStoneMat);
        belfry.position.set(0, b.h + 3.1, b.d * 0.25);
        lod0.add(belfry);
        const steeple = new THREE.Mesh(new THREE.ConeGeometry(3.2, 3.8, 4), terracottaRoofMat);
        steeple.position.set(0, b.h + 8.1, b.d * 0.25);
        steeple.rotation.y = Math.PI / 4;
        lod0.add(steeple);
      }
    } else if (roofStyle === 'dome') {
      const dome = new THREE.Mesh(
        new THREE.SphereGeometry(Math.min(b.w, b.d) * 0.36, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.5),
        glassDomeMat
      );
      dome.position.y = b.h;
      lod0.add(dome);
    } else if (roofStyle === 'sawtooth') {
      const bays = 3;
      const bayW = b.w / bays;
      for (let i = 0; i < bays; i++) {
        const ridge = new THREE.Mesh(new THREE.CylinderGeometry(0.1, bayW * 0.65, b.d * 0.94, 3), roofMat);
        ridge.rotation.x = Math.PI / 2;
        ridge.position.set(-b.w * 0.5 + (i + 0.5) * bayW, b.h + 1.0, 0);
        lod0.add(ridge);
      }
    } else if (roofStyle === 'terrace') {
      const parapet = new THREE.Mesh(new THREE.BoxGeometry(b.w + 0.3, 0.55, b.d + 0.3), roofMat);
      parapet.position.y = b.h + 0.28;
      lod0.add(parapet);
      const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.72, 1.35, 10), waterTankMat);
      tank.position.set(b.w * 0.24, b.h + 1.15, -b.d * 0.2);
      lod0.add(tank);
    } else if (roofStyle === 'classic') {
      const pediment = new THREE.Mesh(new THREE.BoxGeometry(b.w * 0.92, 1.2, b.d * 0.92), classicStoneMat);
      pediment.position.y = b.h + 0.6;
      lod0.add(pediment);
      for (const cx of [-b.w * 0.35, -b.w * 0.12, b.w * 0.12, b.w * 0.35]) {
        const col = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.48, b.h * 0.75, 8), classicStoneMat);
        col.position.set(cx, b.h * 0.375, b.d * 0.5 + 0.55);
        lod0.add(col);
      }
      if (b.id === 'bld_25') {
        const cupola = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 3.0, 3.2, 12), classicStoneMat);
        cupola.position.y = b.h + 2.8;
        lod0.add(cupola);
      }
    } else {
      const crown = new THREE.Mesh(new THREE.BoxGeometry(b.w * 0.86, 1.4, b.d * 0.86), roofMat);
      crown.position.y = b.h + 0.7;
      crown.castShadow = true;
      lod0.add(crown);
      if (b.h >= 20) {
        const spire = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.25, 4.2, 6), roofMat);
        spire.position.y = b.h + 3.2;
        lod0.add(spire);
        const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.28, 8, 8), mats.neonMat);
        beacon.position.y = b.h + 5.3;
        lod0.add(beacon);
      }
    }

    const lod1 = new THREE.Group();
    const body1 = new THREE.Mesh(bodyGeo, mats.facadeMat);
    body1.position.y = b.h / 2;
    body1.receiveShadow = true;
    const neonTrim1 = new THREE.Mesh(neonGeo, mats.neonMat);
    neonTrim1.position.y = b.h - 0.5;
    lod1.add(body1, neonTrim1);

    const lod2 = new THREE.Mesh(bodyGeo, mats.lowMat);
    lod2.position.y = b.h / 2;

    lod.addLevel(lod0, 0);
    lod.addLevel(lod1, BUILDING_LOD_MID_DIST);
    lod.addLevel(lod2, BUILDING_LOD_LOW_DIST);
    return lod;
  };

  // 5b. Marcos icônicos e props por chunk
  const heliMarkGeos: THREE.BufferGeometry[] = [];
  for (const [hx, hz] of [
    [-188, 246],
    [-64, 246],
  ]) {
    const padRing = new THREE.RingGeometry(8.2, 9.4, 28);
    padRing.rotateX(-Math.PI / 2);
    padRing.translate(hx, 0.045, hz);
    heliMarkGeos.push(padRing);
    heliMarkGeos.push(makeBakedPlaneXZ(1.2, 8.2, hx - 2.6, 0.048, hz));
    heliMarkGeos.push(makeBakedPlaneXZ(1.2, 8.2, hx + 2.6, 0.048, hz));
    heliMarkGeos.push(makeBakedPlaneXZ(5.6, 1.2, hx, 0.048, hz));
  }
  for (let rx = -262; rx <= -166; rx += 12) {
    heliMarkGeos.push(makeBakedPlaneXZ(6.5, 0.9, rx, 0.045, 266));
  }

  // Objetos compostos anexados aos seus respectivos chunks
  const customNodesByChunk = new Map<string, THREE.Object3D[]>();
  const addCustomNode = (x: number, z: number, node: THREE.Object3D) => {
    markSubtreeSharedGeometries(node);
    const ck = getChunkKey(worldToChunkCoord(x, WORLD_CHUNK_SIZE), worldToChunkCoord(z, WORLD_CHUNK_SIZE));
    const arr = customNodesByChunk.get(ck) ?? [];
    arr.push(node);
    customNodesByChunk.set(ck, arr);
    addPropCount(x, z, 1);
  };

  // Helicóptero no Heliponto principal
  const heliGrp = new THREE.Group();
  heliGrp.position.set(-188, 0.05, 246);
  heliGrp.rotation.y = Math.PI * 0.25;
  const heliBodyMat = new THREE.MeshStandardMaterial({ color: 0x0ea5e9, roughness: 0.35, metalness: 0.45 });
  const heliMetalMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.3, metalness: 0.75 });
  const heliFuse = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.6, 4.8), heliBodyMat);
  heliFuse.position.y = 1.45;
  const heliCockpit = new THREE.Mesh(new THREE.BoxGeometry(2.0, 1.1, 1.6), glassDomeMat);
  heliCockpit.position.set(0, 1.45, 2.5);
  const heliTail = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.55, 4.4), heliBodyMat);
  heliTail.position.set(0, 1.65, -4.1);
  const heliSkids = new THREE.Mesh(
    mergeAndDisposeGeometries([
      makeBakedBox(0.16, 0.14, 4.8, -1.0, 0.18, 0),
      makeBakedBox(0.16, 0.14, 4.8, 1.0, 0.18, 0),
      makeBakedBox(2.1, 0.12, 0.14, 0, 0.48, 1.2),
      makeBakedBox(2.1, 0.12, 0.14, 0, 0.48, -1.2),
    ]),
    heliMetalMat
  );
  const heliRotor = new THREE.Mesh(
    mergeAndDisposeGeometries([
      makeBakedBox(8.6, 0.08, 0.28, 0, 2.55, 0),
      makeBakedBox(0.28, 0.08, 8.6, 0, 2.55, 0),
      makeBakedBox(0.18, 1.35, 0.18, 0.36, 1.85, -6.1),
    ]),
    heliMetalMat
  );
  heliGrp.add(heliFuse, heliCockpit, heliTail, heliSkids, heliRotor);
  addCustomNode(-188, 246, heliGrp);
  sharedMatsToDispose.push(heliBodyMat, heliMetalMat);

  // Lago ornamental no Parque Atlântico
  const pondMat = new THREE.MeshStandardMaterial({ color: 0x0ea5e9, roughness: 0.15, metalness: 0.5 });
  const pondMesh = new THREE.Mesh(new THREE.CircleGeometry(11.5, 24), pondMat);
  pondMesh.rotation.x = -Math.PI / 2;
  pondMesh.position.set(-50, 0.04, -242);
  addCustomNode(-50, -242, pondMesh);
  sharedMatsToDispose.push(pondMat);

  // Guindaste, silos e contêineres
  const metalPropsGeos: THREE.BufferGeometry[] = [
    makeBakedBox(1.8, 16, 1.8, 48, 8, 146),
    makeBakedBox(16, 1.4, 1.4, 54, 15.2, 146),
    (() => {
      const s = new THREE.CylinderGeometry(3.4, 3.4, 14, 12);
      s.translate(-226, 7, -165);
      return s;
    })(),
    (() => {
      const s = new THREE.CylinderGeometry(3.4, 3.4, 12, 12);
      s.translate(-226, 6, -155);
      return s;
    })(),
    (() => {
      const s = new THREE.CylinderGeometry(0.9, 1.2, 19, 8);
      s.translate(-258, 9.5, -176);
      return s;
    })(),
  ];
  propsColoredParts.push({ geo: mergeAndDisposeGeometries(metalPropsGeos), colorHex: 0xd97706 });

  const cargoGeos = [
    makeBakedBox(6.2, 2.8, 2.6, 38, 1.4, 146),
    makeBakedBox(6.2, 2.8, 2.6, 38, 4.2, 146),
    makeBakedBox(6.2, 2.8, 2.6, 28, 1.4, 146),
  ];
  propsColoredParts.push({ geo: mergeAndDisposeGeometries(cargoGeos), colorHex: 0x0284c7 });

  addPropCount(48, 146, 2);
  addPropCount(-226, -165, 2);
  addPropCount(-258, -176, 1);
  addPropCount(38, 146, 3);

  // Árvores urbanas (InstancedMesh por chunk)
  (
    [
      [-66, -228, 1.1],
      [-34, -228, 0.95],
      [-66, -258, 1.05],
      [-34, -258, 1.15],
      [-110, -188, 1.0],
      [-124, -158, 0.92],
      [2, -224, 1.05],
      [28, -224, 1.05],
      [-194, 98, 0.9],
      [-232, 98, 0.9],
      [-194, 168, 0.95],
      [-232, 168, 0.95],
    ] as Array<[number, number, number]>
  ).forEach(([tx, tz, sy], idx) => {
    const gy = Math.max(0, getTerrainHeightAt(tx, tz, 4));
    pushInstance(urbanTreesByChunk, {
      x: tx,
      y: gy,
      z: tz,
      rotY: (idx * 1.1) % (Math.PI * 2),
      scaleX: 1,
      scaleY: sy,
      scaleZ: 1,
    });
  });

  // 6. Quiosque na praia curva (Missão 2)
  const pierMat = new THREE.MeshStandardMaterial({ color: 0x6b4730, roughness: 0.88 });
  const kioskGroup = new THREE.Group();
  kioskGroup.position.set(MISSION_POINTS.m2Briefcase.x, -0.3, MISSION_POINTS.m2Briefcase.z);
  const kioskDeckParts: THREE.BufferGeometry[] = [makeBakedBox(7, 0.4, 7, 0, 0.2, 0)];
  [
    [-2.5, -2.5],
    [2.5, -2.5],
    [-2.5, 2.5],
    [2.5, 2.5],
  ].forEach(([px, pz]) => {
    const pole = new THREE.CylinderGeometry(0.14, 0.14, 3.2, 6);
    pole.translate(px, 1.7, pz);
    kioskDeckParts.push(pole);
  });
  kioskGroup.add(new THREE.Mesh(mergeAndDisposeGeometries(kioskDeckParts), pierMat));
  const kioskRoofMat = new THREE.MeshStandardMaterial({ color: 0xff7b29, roughness: 0.7 });
  const kioskRoof = new THREE.Mesh(new THREE.ConeGeometry(5.2, 2.2, 4), kioskRoofMat);
  kioskRoof.position.y = 4.1;
  kioskRoof.rotation.y = Math.PI / 4;
  kioskGroup.add(kioskRoof);
  addCustomNode(MISSION_POINTS.m2Briefcase.x, MISSION_POINTS.m2Briefcase.z, kioskGroup);
  sharedMatsToDispose.push(pierMat, kioskRoofMat);

  // 7. Postes de iluminação (InstancedMesh por chunk)
  for (let z = -220; z <= 220; z += 36) {
    const lx = getCoastalRoadX(z) + 7.6;
    pushInstance(lampPolesByChunk, { x: lx, y: 0, z, rotY: 0 });
    pushInstance(lampBulbsByChunk, { x: lx - 0.9, y: 5.15, z }, false);
  }
  for (let x = -220; x <= 40; x += 44) {
    if (Math.hypot(x + 20, 0) < 28 || Math.abs(x + 140) < 15) continue;
    pushInstance(lampPolesByChunk, { x, y: 0, z: 0, rotY: Math.PI / 2 });
    pushInstance(lampBulbsByChunk, { x, y: 5.15, z: 0.9 }, false);
  }

  // 8. Palmeiras litorâneas e das ilhas + Ilhas Offshore + Farol + Penhascos Perimetrais
  const palmPositions: Array<[number, number, number, number?]> = [];
  for (let z = -220; z <= 220; z += 44) {
    palmPositions.push([getCoastlineX(z) - 11.2, z, 1.0 + (Math.abs(z) % 3) * 0.05]);
    palmPositions.push([getCoastlineX(z + 18) + 6.5, z + 18, 1.04]);
  }
  palmPositions.push(
    [-20, 0, 1.15],
    [-140, -120, 1.12],
    [-20, 130, 1.1],
    [-64, -18, 0.96],
    [-110, 150, 1.02],
    [16, -54, 1.0]
  );

  const cliffRockGeos: THREE.BufferGeometry[] = [];
  const islandGreenGeos: THREE.BufferGeometry[] = [];

  for (let i = 0; i < OFFSHORE_ISLANDS.length; i++) {
    const isl = OFFSHORE_ISLANDS[i];
    const sandRing = new THREE.CylinderGeometry(isl.radius * 0.85, isl.radius * 1.18, 1.6, 12);
    sandRing.translate(isl.x, -0.1, isl.z);
    sandGeos.push(sandRing);

    const rockBase = new THREE.CylinderGeometry(isl.radius * 0.56, isl.radius * 0.84, isl.height * 0.65, 9);
    rockBase.translate(isl.x, isl.height * 0.3, isl.z);
    cliffRockGeos.push(rockBase);

    const cap = new THREE.DodecahedronGeometry(isl.radius * 0.54, 1);
    cap.scale(1.0, (isl.height * 0.55) / (isl.radius * 0.54), 1.0);
    cap.translate(isl.x, isl.height * 0.68, isl.z);
    islandGreenGeos.push(cap);

    const islSurfaceY = isl.height * 0.68 + 1.2;
    palmPositions.push(
      [isl.x - isl.radius * 0.28, isl.z + isl.radius * 0.2, 1.08, islSurfaceY * 0.42],
      [isl.x + isl.radius * 0.25, isl.z - isl.radius * 0.22, 0.98, islSurfaceY * 0.42]
    );

    if (isl.hasLighthouse) {
      const lhBaseY = isl.height * 0.92;
      const towerMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.65 });
      const stripeMat = new THREE.MeshStandardMaterial({ color: 0xef4444, roughness: 0.6 });
      const beaconMat = new THREE.MeshStandardMaterial({
        color: 0xfef08a,
        emissive: 0xfacc15,
        emissiveIntensity: 2.6,
      });
      neonTrimMats.push(beaconMat);
      sharedMatsToDispose.push(towerMat, stripeMat, beaconMat);

      const lhGrp = new THREE.Group();
      lhGrp.position.set(isl.x, lhBaseY, isl.z);
      const tLow = new THREE.Mesh(new THREE.CylinderGeometry(2.1, 2.8, 7.5, 12), towerMat);
      tLow.position.y = 3.75;
      const tBand = new THREE.Mesh(new THREE.CylinderGeometry(1.75, 2.1, 4.5, 12), stripeMat);
      tBand.position.y = 9.75;
      const tTop = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.75, 3.2, 12), towerMat);
      tTop.position.y = 13.6;
      const lantern = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.3, 2.0, 10), beaconMat);
      lantern.position.y = 16.2;
      const capRoof = new THREE.Mesh(new THREE.ConeGeometry(1.75, 1.6, 10), stripeMat);
      capRoof.position.y = 18.0;
      lhGrp.add(tLow, tBand, tTop, lantern, capRoof);
      addCustomNode(isl.x, isl.z, lhGrp);
    }
  }

  for (let z = -304; z <= 304; z += 44) {
    const h = 18 + (Math.abs(z * 17) % 14);
    const cliff = new THREE.DodecahedronGeometry(26, 1);
    cliff.scale(1.1, h / 22, 1.35);
    cliff.translate(-300 - ((Math.abs(z) % 3) * 4), h * 0.36, z);
    cliffRockGeos.push(cliff);
  }
  for (let x = -280; x <= 68; x += 42) {
    const hN = 16 + (Math.abs(x * 13) % 12);
    const cN = new THREE.DodecahedronGeometry(25, 1);
    cN.scale(1.25, hN / 20, 1.15);
    cN.translate(x, hN * 0.34, -300);
    cliffRockGeos.push(cN);

    const hS = 15 + (Math.abs(x * 19) % 11);
    const cS = new THREE.DodecahedronGeometry(25, 1);
    cS.scale(1.25, hS / 20, 1.15);
    cS.translate(x, hS * 0.34, 300);
    cliffRockGeos.push(cS);
  }
  for (const [hz, hxOff] of [
    [-294, 22],
    [294, 22],
  ]) {
    const prom = new THREE.DodecahedronGeometry(24, 1);
    prom.scale(1.4, 0.72, 1.15);
    prom.translate(getCoastlineX(hz) + hxOff, 5.5, hz);
    cliffRockGeos.push(prom);
  }
  propsColoredParts.push({ geo: mergeAndDisposeGeometries(cliffRockGeos), colorHex: 0x454959 });
  terrainColoredParts.push({ geo: mergeAndDisposeGeometries(islandGreenGeos), colorHex: 0x265c42 });

  // Arquétipo único de palmeira (mesclado uma vez e instanciado por chunk via InstancedMesh)
  const _localMat = new THREE.Matrix4();
  const _pos = new THREE.Vector3();
  const _quat = new THREE.Quaternion();
  const _euler = new THREE.Euler();
  const _scale = new THREE.Vector3();
  const palmTrunkParts: THREE.BufferGeometry[] = [];
  const palmCocoParts: THREE.BufferGeometry[] = [];
  const palmFrondParts: THREE.BufferGeometry[] = [];
  {
    let curY = 0;
    let curX = 0;
    const leanDir = 0.26;
    const segH = 1.65;

    for (let i = 0; i < 4; i++) {
      const segScale = 1 - i * 0.1;
      _pos.set(curX + leanDir * i * 0.35, curY + segH / 2, 0);
      _euler.set(0, 0, -leanDir * (i * 0.14));
      _quat.setFromEuler(_euler);
      _scale.set(segScale, 1, segScale);
      _localMat.compose(_pos, _quat, _scale);
      const segGeo = new THREE.CylinderGeometry(0.2, 0.24, 1.65, 6);
      segGeo.applyMatrix4(_localMat);
      palmTrunkParts.push(segGeo);
      curY += segH - 0.12;
      curX += leanDir * i * 0.25;
    }

    const crownX = curX + leanDir * 0.5;
    const crownY = curY;

    for (let c = 0; c < 3; c++) {
      const a = (c * Math.PI * 2) / 3;
      _pos.set(crownX + Math.cos(a) * 0.24, crownY - 0.12, Math.sin(a) * 0.24);
      _quat.identity();
      _scale.set(1, 1, 1);
      _localMat.compose(_pos, _quat, _scale);
      const cocoGeo = new THREE.DodecahedronGeometry(0.18, 0);
      cocoGeo.applyMatrix4(_localMat);
      palmCocoParts.push(cocoGeo);
    }

    for (let f = 0; f < 6; f++) {
      _pos.set(crownX, crownY, 0);
      _euler.set(0.12, (f * Math.PI * 2) / 6, 0, 'YXZ');
      _quat.setFromEuler(_euler);
      _scale.set(1, 1, 1);
      _localMat.compose(_pos, _quat, _scale);
      const frondGeo = new THREE.ConeGeometry(0.48, 2.8, 4);
      frondGeo.scale(1.1, 1, 0.18);
      frondGeo.translate(0, 1.4, 0);
      frondGeo.rotateX(Math.PI * 0.38);
      frondGeo.applyMatrix4(_localMat);
      palmFrondParts.push(frondGeo);
    }
  }
  const palmArchetypeGeo = mergeColoredGeometries([
    { geo: mergeAndDisposeGeometries(palmTrunkParts), colorHex: 0x7b5438 },
    { geo: mergeAndDisposeGeometries(palmCocoParts), colorHex: 0x4b2e1b },
    { geo: mergeAndDisposeGeometries(palmFrondParts), colorHex: 0x22b573 },
  ]);
  sharedGeosToDispose.push(palmArchetypeGeo);

  palmPositions.forEach(([px, pz, sc, overrideY], seed) => {
    const cx = getCoastlineX(pz);
    const groundY = overrideY !== undefined ? overrideY : px > cx ? -((px - cx) / 52) * 1.1 : 0.08;
    const yaw = ((seed * 1.3) % (Math.PI * 2)) + (seed % 2 === 1 ? Math.PI : 0);
    pushInstance(palmsByChunk, {
      x: px,
      y: groundY,
      z: pz,
      rotY: yaw,
      scaleX: sc,
      scaleY: sc,
      scaleZ: sc,
    });
  });

  // 9. Pacotes de dinheiro colecionáveis (globais para lógica imediata)
  const pickupCoords: Array<[number, number, number]> = [
    [-46, 12, 200],
    [12, -52, 250],
    [getCoastlineX(-24) - 6, -24, 150],
    [getCoastlineX(24) + 10, 24, 300],
    [getCoastlineX(130) + 34, 130, 350],
    [-110, -148, 250],
    [-195, 58, 200],
    [-48, 136, 250],
    [-202, -264, 400],
    [-188, 246, 350],
    [14, -226, 250],
  ];
  pickupCoords.forEach(([px, pz, val], idx) => {
    const mesh = createCashPickupMesh();
    const gy = getTerrainHeightAt(px, pz);
    mesh.position.set(px, gy, pz);
    scene.add(mesh);
    pickups.push({
      id: `cash_${idx}`,
      x: px,
      z: pz,
      value: val,
      mesh,
      collected: false,
      respawnTimer: 0,
    });
  });

  // 10. Marcadores luminosos de Missão (sempre visíveis de longa distância)
  const makeBeacon = (colorHex: number) => {
    const grp = new THREE.Group();
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(1.5, 2.0, 28),
      new THREE.MeshBasicMaterial({ color: colorHex, side: THREE.DoubleSide, transparent: true, opacity: 0.85 })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.08;
    grp.add(ring);

    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.45, 0.85, 7, 16, 1, true),
      new THREE.MeshBasicMaterial({ color: colorHex, transparent: true, opacity: 0.25, side: THREE.DoubleSide, depthWrite: false })
    );
    beam.position.y = 3.5;
    grp.add(beam);
    scene.add(grp);
    return grp;
  };

  const mission1StartBeacon = makeBeacon(0xff2e93);
  mission1StartBeacon.position.set(MISSION_POINTS.m1Trigger.x, 0, MISSION_POINTS.m1Trigger.z);

  const mission2StartBeacon = makeBeacon(0x16f2d4);
  mission2StartBeacon.position.set(MISSION_POINTS.m2Trigger.x, 0, MISSION_POINTS.m2Trigger.z);

  const gunShopPoi = CORE_POIS.find((p) => p.category === 'shop_gun');
  if (gunShopPoi) {
    const gunShopBeacon = makeBeacon(0xf59e0b);
    gunShopBeacon.position.set(
      gunShopPoi.entryX,
      getTerrainHeightAt(gunShopPoi.entryX, gunShopPoi.entryZ),
      gunShopPoi.entryZ
    );
  }

  const objectiveBeacon = makeBeacon(0xfacc15);
  objectiveBeacon.visible = false;

  const briefcaseMesh = new THREE.Group();
  const caseBody = new THREE.Mesh(
    new THREE.BoxGeometry(0.85, 0.56, 0.28),
    new THREE.MeshStandardMaterial({ color: 0x16f2d4, emissive: 0x0aa896, emissiveIntensity: 0.9, roughness: 0.25, metalness: 0.6 })
  );
  caseBody.position.y = 1.05;
  briefcaseMesh.add(caseBody);
  const caseHandle = new THREE.Mesh(
    new THREE.BoxGeometry(0.32, 0.14, 0.12),
    new THREE.MeshStandardMaterial({ color: 0xfacc15, metalness: 0.8, roughness: 0.2 })
  );
  caseHandle.position.y = 1.38;
  briefcaseMesh.add(caseHandle);
  briefcaseMesh.position.set(MISSION_POINTS.m2Briefcase.x, 0.1, MISSION_POINTS.m2Briefcase.z);
  briefcaseMesh.visible = false;
  scene.add(briefcaseMesh);

  // 11. Mobiliário urbano com arquétipos mesclados e instanciados em InstancedMesh por chunk (WorldBatching)
  const frameGeos: THREE.BufferGeometry[] = [];

  WORLD_POIS.benches.forEach((b) => {
    pushInstance(benchesByChunk, { x: b.x, y: 0.1, z: b.z, rotY: b.yaw });
  });

  WORLD_POIS.stalls.forEach((s) => {
    const gy = s.x > getCoastlineX(s.z) ? -0.15 : 0.08;
    pushInstance(stallsByChunk, { x: s.x, y: gy, z: s.z, rotY: s.yaw });
    const canopyMat = new THREE.MeshStandardMaterial({
      color: s.color,
      emissive: s.color,
      emissiveIntensity: 0.25,
      roughness: 0.5,
    });
    const canopy = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.18, 1.9), canopyMat);
    canopy.position.set(s.x, gy + 2.55, s.z);
    canopy.rotation.y = s.yaw;
    addCustomNode(s.x, s.z, canopy);
    sharedMatsToDispose.push(canopyMat);
  });

  WORLD_POIS.busStops.forEach((bs) => {
    pushInstance(busStopsByChunk, { x: bs.x, y: 0.05, z: bs.z, rotY: bs.yaw });
    pushInstance(busGlassByChunk, { x: bs.x, y: 0.05, z: bs.z, rotY: bs.yaw }, false);
    pushInstance(busSignsByChunk, { x: bs.x, y: 0.05, z: bs.z, rotY: bs.yaw }, false);
  });

  // Rede de vôlei de praia
  const vCenter = WORLD_POIS.volleyballCenter;
  [-4.4, 4.4].forEach((pz) => {
    const post = new THREE.CylinderGeometry(0.08, 0.08, 2.8, 6);
    post.translate(vCenter.x, -0.18 + 1.4, vCenter.z + pz);
    frameGeos.push(post);
    addPropCount(vCenter.x, vCenter.z + pz, 1);
  });
  const netMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, transparent: true, opacity: 0.65, roughness: 0.7 });
  const net = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.1, 8.8), netMat);
  net.position.set(vCenter.x, -0.18 + 2.05, vCenter.z);
  addCustomNode(vCenter.x, vCenter.z, net);
  sharedMatsToDispose.push(netMat);

  WORLD_POIS.nightBars.forEach((bar) => {
    const signMat = new THREE.MeshStandardMaterial({
      color: bar.color,
      emissive: bar.color,
      emissiveIntensity: 1.8,
      roughness: 0.25,
    });
    neonTrimMats.push(signMat);
    const canopy = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.25, 2.4), signMat);
    canopy.position.set(bar.x, 3.1, bar.z);
    addCustomNode(bar.x, bar.z, canopy);
    [-1.9, 1.9].forEach((px) => {
      pushInstance(nightBarPostsByChunk, { x: bar.x + px, y: 0, z: bar.z + 0.9 });
    });
  });

  if (frameGeos.length > 0) {
    propsColoredParts.push({ geo: mergeAndDisposeGeometries(frameGeos), colorHex: 0x25283d });
  }

  // Arquétipos de mobiliário urbano mesclados via WorldBatching.mergeColoredGeometries
  const benchArchetypeGeo = mergeColoredGeometries([
    { geo: makeBakedBox(2.2, 0.14, 0.72, 0, 0.48, 0), colorHex: 0x8b5a3c },
    { geo: makeBakedBox(2.2, 0.55, 0.12, 0, 0.82, -0.3), colorHex: 0x8b5a3c },
    { geo: makeBakedBox(0.14, 0.48, 0.62, -0.85, 0.24, 0), colorHex: 0x25283d },
    { geo: makeBakedBox(0.14, 0.48, 0.62, 0.85, 0.24, 0), colorHex: 0x25283d },
  ]);
  const stallArchetypeGeo = mergeColoredGeometries([
    { geo: makeBakedBox(2.6, 1.0, 1.1, 0, 0.5, 0), colorHex: 0x8b5a3c },
    {
      geo: (() => {
        const g = new THREE.CylinderGeometry(0.06, 0.06, 2.5, 6);
        g.translate(-1.2, 1.25, -0.4);
        return g;
      })(),
      colorHex: 0x25283d,
    },
    {
      geo: (() => {
        const g = new THREE.CylinderGeometry(0.06, 0.06, 2.5, 6);
        g.translate(1.2, 1.25, -0.4);
        return g;
      })(),
      colorHex: 0x25283d,
    },
  ]);
  const busStopArchetypeGeo = mergeColoredGeometries([
    { geo: makeBakedBox(3.4, 0.14, 1.5, 0, 2.75, 0), colorHex: 0x25283d },
    {
      geo: (() => {
        const g = new THREE.CylinderGeometry(0.06, 0.06, 3.1, 6);
        g.translate(1.9, 1.55, 0);
        return g;
      })(),
      colorHex: 0x25283d,
    },
    {
      geo: (() => {
        const g = new THREE.CylinderGeometry(0.05, 0.05, 2.75, 6);
        g.translate(-1.55, 1.375, -0.62);
        return g;
      })(),
      colorHex: 0x25283d,
    },
    {
      geo: (() => {
        const g = new THREE.CylinderGeometry(0.05, 0.05, 2.75, 6);
        g.translate(1.55, 1.375, -0.62);
        return g;
      })(),
      colorHex: 0x25283d,
    },
  ]);
  const busGlassArchetypeGeo = makeBakedBox(3.2, 2.4, 0.1, 0, 1.4, -0.65);
  const busSignArchetypeGeo = makeBakedBox(0.65, 0.65, 0.1, 1.9, 2.85, 0);
  const bollardArchetypeGeo = mergeColoredGeometries([
    { geo: new THREE.CylinderGeometry(0.18, 0.22, 0.65, 8), colorHex: 0xf59e0b },
  ]);
  const lampPoleArchetypeGeo = mergeColoredGeometries([
    {
      geo: (() => {
        const g = new THREE.CylinderGeometry(0.12, 0.18, 5.4, 6);
        g.translate(0, 2.7, 0);
        return g;
      })(),
      colorHex: 0x2b2d42,
    },
    { geo: makeBakedBox(1.1, 0.12, 0.12, -0.45, 5.3, 0), colorHex: 0x2b2d42 },
  ]);
  const lampBulbArchetypeGeo = new THREE.SphereGeometry(0.24, 6, 6);
  const tunnelLightArchetypeGeo = new THREE.BoxGeometry(4.6, 0.14, 0.45);
  const signalPoleArchetypeGeo = mergeColoredGeometries([
    {
      geo: (() => {
        const g = new THREE.CylinderGeometry(0.1, 0.12, 3.6, 6);
        g.translate(0, 1.8, 0);
        return g;
      })(),
      colorHex: 0x1f2235,
    },
    { geo: makeBakedBox(0.42, 0.75, 0.42, 0, 3.35, 0), colorHex: 0x1f2235 },
  ]);
  const sigNsArchetypeGeo = new THREE.BoxGeometry(0.28, 0.22, 0.48);
  const sigEwArchetypeGeo = new THREE.BoxGeometry(0.48, 0.22, 0.28);
  const nightBarPostArchetypeGeo = mergeColoredGeometries([
    {
      geo: (() => {
        const g = new THREE.CylinderGeometry(0.08, 0.08, 3.1, 6);
        g.translate(0, 1.55, 0);
        return g;
      })(),
      colorHex: 0x25283d,
    },
  ]);
  const urbanTreeArchetypeGeo = mergeColoredGeometries([
    {
      geo: (() => {
        const g = new THREE.CylinderGeometry(0.28, 0.38, 3.2, 7);
        g.translate(0, 1.6, 0);
        return g;
      })(),
      colorHex: 0x6b4730,
    },
    {
      geo: (() => {
        const g = new THREE.DodecahedronGeometry(2.3, 1);
        g.translate(0, 4.1, 0);
        return g;
      })(),
      colorHex: 0x229954,
    },
  ]);

  sharedGeosToDispose.push(
    benchArchetypeGeo,
    stallArchetypeGeo,
    busStopArchetypeGeo,
    busGlassArchetypeGeo,
    busSignArchetypeGeo,
    bollardArchetypeGeo,
    lampPoleArchetypeGeo,
    lampBulbArchetypeGeo,
    tunnelLightArchetypeGeo,
    signalPoleArchetypeGeo,
    sigNsArchetypeGeo,
    sigEwArchetypeGeo,
    nightBarPostArchetypeGeo,
    urbanTreeArchetypeGeo
  );

  // Marcações viárias combinadas com vertex colors
  markingsColoredParts.push(
    { geo: mergeAndDisposeGeometries(dashGeos), colorHex: 0xffc864 },
    { geo: mergeAndDisposeGeometries(heliMarkGeos), colorHex: 0xfacc15 },
    { geo: mergeAndDisposeGeometries(laneWhiteGeos), colorHex: 0xe2e8f0 },
    { geo: mergeAndDisposeGeometries(zebraGeos), colorHex: 0xf1f5f9 }
  );

  // 12. Particionamento exato em chunks 64×64 m + materiais compartilhados + spawns de tráfego por chunk
  const opaqueVertexMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.9,
    metalness: 0.05,
  });
  const furnitureVertexMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.78,
    metalness: 0.12,
  });
  const markingsMat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const sharedBulbMat = new THREE.MeshStandardMaterial({
    color: 0xffd180,
    emissive: 0xff9e44,
    emissiveIntensity: 1.3,
  });
  lampBulbMats.push(sharedBulbMat);

  const signalNsMat = new THREE.MeshBasicMaterial({ color: 0x22c55e });
  const signalEwMat = new THREE.MeshBasicMaterial({ color: 0xef4444 });
  trafficLightNsMats.push(signalNsMat);
  trafficLightEwMats.push(signalEwMat);

  const busGlassMat = new THREE.MeshStandardMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.35, roughness: 0.1 });
  const busSignMat = new THREE.MeshStandardMaterial({ color: 0xfacc15, emissive: 0xca8a04, emissiveIntensity: 0.6 });
  const impostorMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.92,
    metalness: 0.04,
  });

  sharedMatsToDispose.push(
    opaqueVertexMat,
    furnitureVertexMat,
    markingsMat,
    sharedBulbMat,
    signalNsMat,
    signalEwMat,
    busGlassMat,
    busSignMat,
    impostorMat,
    roofMat,
    terracottaRoofMat,
    glassDomeMat,
    waterTankMat,
    classicStoneMat
  );

  const terrainChunks = splitGeometryIntoChunks(mergeColoredGeometries(terrainColoredParts), WORLD_CHUNK_SIZE);
  const propsChunks = splitGeometryIntoChunks(mergeColoredGeometries(propsColoredParts), WORLD_CHUNK_SIZE);
  const markingsChunks = splitGeometryIntoChunks(mergeColoredGeometries(markingsColoredParts), WORLD_CHUNK_SIZE);
  const asphaltChunks = splitGeometryIntoChunks(mergeAndDisposeGeometries(roadGeos), WORLD_CHUNK_SIZE);
  const sandChunks = splitGeometryIntoChunks(mergeAndDisposeGeometries(sandGeos), WORLD_CHUNK_SIZE);
  const promenadeChunks = splitGeometryIntoChunks(mergeAndDisposeGeometries(promenadeGeos), WORLD_CHUNK_SIZE);
  const canalWaterChunks = splitGeometryIntoChunks(mergeAndDisposeGeometries(canalWaterGeos), WORLD_CHUNK_SIZE);

  // Registra todas as geometrias fatiadas como blueprint compartilhado para descarte limpo
  const allSplitMaps = [
    terrainChunks,
    propsChunks,
    markingsChunks,
    asphaltChunks,
    sandChunks,
    promenadeChunks,
    canalWaterChunks,
  ];
  for (const m of allSplitMaps) {
    for (const g of m.values()) {
      sharedGeosToDispose.push(g);
    }
  }
  chunkManager.registerSharedResources(sharedGeosToDispose, sharedMatsToDispose);

  // Amostragem dos spawns de tráfego por chunk a partir de STREETS
  const trafficSpawnsByChunk = new Map<string, ChunkTrafficSpawn[]>();
  const addTrafficSpawn = (sp: ChunkTrafficSpawn) => {
    const ck = getChunkKey(worldToChunkCoord(sp.x, WORLD_CHUNK_SIZE), worldToChunkCoord(sp.z, WORLD_CHUNK_SIZE));
    const arr = trafficSpawnsByChunk.get(ck) ?? [];
    arr.push(sp);
    trafficSpawnsByChunk.set(ck, arr);
  };

  for (const street of STREETS) {
    if (street.kind === 'alley') continue;
    if (street.kind === 'roundabout' && street.roundabout) {
      const rb = street.roundabout;
      const midR = (rb.innerRadius + rb.outerRadius) * 0.5;
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const x = rb.centerX + Math.cos(a) * midR;
        const z = rb.centerZ + Math.sin(a) * midR;
        addTrafficSpawn({
          streetId: street.id,
          x,
          z,
          heading: Math.atan2(-Math.sin(a), Math.cos(a)),
          laneOffset: 0,
        });
      }
      continue;
    }

    const baseLane =
      street.medianWidth > 0
        ? street.medianWidth * 0.5 + (street.width - street.medianWidth) * 0.25
        : street.width * 0.24;

    for (const seg of street.segments) {
      const perpX = seg.dirZ;
      const perpZ = -seg.dirX;
      const steps = Math.max(1, Math.floor(seg.length / 36));
      for (let i = 0; i < steps; i++) {
        const d = ((i + 0.5) / steps) * seg.length;
        for (const dir of [1, -1] as const) {
          const laneOffset = baseLane * dir;
          const x = seg.x1 + seg.dirX * d + perpX * laneOffset;
          const z = seg.z1 + seg.dirZ * d + perpZ * laneOffset;
          if (
            z >= CANAL_SPEC.zMin - 2 &&
            z <= CANAL_SPEC.zMax + 2 &&
            x >= CANAL_SPEC.xMin &&
            getBridgeElevationAt(x, z) === null
          ) {
            continue;
          }
          addTrafficSpawn({
            streetId: street.id,
            x,
            z,
            heading: Math.atan2(seg.dirX * dir, seg.dirZ * dir),
            laneOffset,
          });
        }
      }
    }
  }

  const allKeys = new Set<string>();
  for (const m of allSplitMaps) {
    for (const k of m.keys()) allKeys.add(k);
  }
  const allInstanceBuckets = [
    benchesByChunk,
    stallsByChunk,
    busStopsByChunk,
    busGlassByChunk,
    busSignsByChunk,
    bollardsByChunk,
    lampPolesByChunk,
    lampBulbsByChunk,
    tunnelLightsByChunk,
    signalPolesByChunk,
    sigNsByChunk,
    sigEwByChunk,
    nightBarPostsByChunk,
    urbanTreesByChunk,
    palmsByChunk,
  ];
  for (const b of allInstanceBuckets) {
    for (const k of b.keys()) allKeys.add(k);
  }
  for (const k of buildingsByChunk.keys()) allKeys.add(k);
  for (const k of customNodesByChunk.keys()) allKeys.add(k);
  for (const k of trafficSpawnsByChunk.keys()) allKeys.add(k);

  // Helper para gerar o impostor low-poly (1 draw call) de cada chunk distante
  const buildChunkImpostor = (cx: number, cz: number, key: string): THREE.Mesh | null => {
    const minX = cx * WORLD_CHUNK_SIZE;
    const minZ = cz * WORLD_CHUNK_SIZE;
    const parts: ColoredGeometryPart[] = [];

    // Silhueta simplificada de terreno (grade 2×2 por chunk, ignorando células totalmente submersas)
    const step = WORLD_CHUNK_SIZE * 0.5;
    for (let ix = 0; ix < 2; ix++) {
      for (let iz = 0; iz < 2; iz++) {
        const qx = minX + (ix + 0.5) * step;
        const qz = minZ + (iz + 0.5) * step;
        const h = getTerrainHeightAt(qx, qz, 6);
        if (h <= -0.65) continue;
        const d = WorldRegistry.getDistrictAt(qx, qz);
        const col = qx >= getCoastlineX(qz) ? 0xc89e69 : h > 2.2 ? 0x3b5944 : d.groundHex;
        parts.push({ geo: makeBakedPlaneXZ(step + 0.2, step + 0.2, qx, Math.max(0.01, h), qz), colorHex: col });
      }
    }

    // Silhuetas simplificadas dos prédios do chunk
    const bList = buildingsByChunk.get(key) ?? [];
    for (const b of bList) {
      const baseY = b.baseY ?? 0;
      parts.push({
        geo: makeBakedBox(b.w, b.h, b.d, b.x, baseY + b.h * 0.5, b.z),
        colorHex: new THREE.Color(b.wallHex).getHex(),
      });
    }

    // Silhueta de ilhas offshore ou faixas de viaduto/pontes
    for (const isl of OFFSHORE_ISLANDS) {
      if (isl.x >= minX && isl.x < minX + WORLD_CHUNK_SIZE && isl.z >= minZ && isl.z < minZ + WORLD_CHUNK_SIZE) {
        const cone = new THREE.CylinderGeometry(isl.radius * 0.5, isl.radius * 1.1, isl.height, 8);
        cone.translate(isl.x, isl.height * 0.45, isl.z);
        parts.push({ geo: cone, colorHex: 0x3f6b4e });
        if (isl.hasLighthouse) {
          parts.push({
            geo: makeBakedBox(3.5, 18, 3.5, isl.x, isl.height * 0.9 + 9, isl.z),
            colorHex: 0xf8fafc,
          });
        }
      }
    }

    if (parts.length === 0) return null;
    const impGeo = mergeColoredGeometries(parts);
    const impMesh = new THREE.Mesh(impGeo, impostorMat);
    impMesh.receiveShadow = true;
    return impMesh;
  };

  for (const key of allKeys) {
    const [cxStr, czStr] = key.split(',');
    const cx = Number(cxStr);
    const cz = Number(czStr);

    const tGeo = terrainChunks.get(key);
    const pGeo = propsChunks.get(key);
    const mGeo = markingsChunks.get(key);
    const aGeo = asphaltChunks.get(key);
    const sGeo = sandChunks.get(key);
    const prGeo = promenadeChunks.get(key);
    const cwGeo = canalWaterChunks.get(key);

    const cBenches = benchesByChunk.get(key);
    const cStalls = stallsByChunk.get(key);
    const cBusStops = busStopsByChunk.get(key);
    const cBusGlass = busGlassByChunk.get(key);
    const cBusSigns = busSignsByChunk.get(key);
    const cBollards = bollardsByChunk.get(key);
    const cLampPoles = lampPolesByChunk.get(key);
    const cLampBulbs = lampBulbsByChunk.get(key);
    const cTunnelLights = tunnelLightsByChunk.get(key);
    const cSignalPoles = signalPolesByChunk.get(key);
    const cSigNs = sigNsByChunk.get(key);
    const cSigEw = sigEwByChunk.get(key);
    const cNightBarPosts = nightBarPostsByChunk.get(key);
    const cUrbanTrees = urbanTreesByChunk.get(key);
    const cPalms = palmsByChunk.get(key);

    const cBuildings = buildingsByChunk.get(key) ?? [];
    const cCustom = customNodesByChunk.get(key);
    const cTrafficSpawns = trafficSpawnsByChunk.get(key) ?? [];
    const cPropsCount = propsCountByChunk.get(key) ?? 0;

    const furnitureInstances =
      (cBenches?.length ?? 0) +
      (cStalls?.length ?? 0) +
      (cBusStops?.length ?? 0) +
      (cBusGlass?.length ?? 0) +
      (cBusSigns?.length ?? 0) +
      (cBollards?.length ?? 0) +
      (cLampPoles?.length ?? 0) +
      (cLampBulbs?.length ?? 0) +
      (cTunnelLights?.length ?? 0) +
      (cSignalPoles?.length ?? 0) +
      (cSigNs?.length ?? 0) +
      (cSigEw?.length ?? 0) +
      (cNightBarPosts?.length ?? 0) +
      (cUrbanTrees?.length ?? 0) +
      (cPalms?.length ?? 0);

    chunkManager.registerChunk(
      cx,
      cz,
      () => {
        const grp = new THREE.Group();
        if (tGeo) {
          const m = new THREE.Mesh(tGeo, opaqueVertexMat);
          m.receiveShadow = true;
          grp.add(m);
        }
        if (pGeo) {
          const m = new THREE.Mesh(pGeo, opaqueVertexMat);
          m.castShadow = true;
          m.receiveShadow = true;
          grp.add(m);
        }
        if (aGeo) {
          const m = new THREE.Mesh(aGeo, asphaltMat);
          m.receiveShadow = true;
          grp.add(m);
        }
        if (mGeo) {
          grp.add(new THREE.Mesh(mGeo, markingsMat));
        }
        if (sGeo) {
          const m = new THREE.Mesh(sGeo, sandMat);
          m.receiveShadow = true;
          grp.add(m);
        }
        if (prGeo) {
          const m = new THREE.Mesh(prGeo, promenadeMat);
          m.receiveShadow = true;
          grp.add(m);
        }
        if (cwGeo) {
          const m = new THREE.Mesh(cwGeo, oceanMat);
          m.receiveShadow = true;
          grp.add(m);
        }

        // Mobiliário urbano e vegetação instanciados em InstancedMesh por chunk (WorldBatching)
        if (cBenches) grp.add(createInstancedBatch(benchArchetypeGeo, furnitureVertexMat, cBenches, true, true));
        if (cStalls) grp.add(createInstancedBatch(stallArchetypeGeo, furnitureVertexMat, cStalls, true, true));
        if (cBusStops) grp.add(createInstancedBatch(busStopArchetypeGeo, furnitureVertexMat, cBusStops, true, true));
        if (cBusGlass) grp.add(createInstancedBatch(busGlassArchetypeGeo, busGlassMat, cBusGlass));
        if (cBusSigns) grp.add(createInstancedBatch(busSignArchetypeGeo, busSignMat, cBusSigns));
        if (cBollards) grp.add(createInstancedBatch(bollardArchetypeGeo, furnitureVertexMat, cBollards, true, true));
        if (cLampPoles) grp.add(createInstancedBatch(lampPoleArchetypeGeo, furnitureVertexMat, cLampPoles, true, false));
        if (cLampBulbs) grp.add(createInstancedBatch(lampBulbArchetypeGeo, sharedBulbMat, cLampBulbs));
        if (cTunnelLights) grp.add(createInstancedBatch(tunnelLightArchetypeGeo, sharedBulbMat, cTunnelLights));
        if (cSignalPoles) grp.add(createInstancedBatch(signalPoleArchetypeGeo, furnitureVertexMat, cSignalPoles, true, false));
        if (cSigNs) grp.add(createInstancedBatch(sigNsArchetypeGeo, signalNsMat, cSigNs));
        if (cSigEw) grp.add(createInstancedBatch(sigEwArchetypeGeo, signalEwMat, cSigEw));
        if (cNightBarPosts) grp.add(createInstancedBatch(nightBarPostArchetypeGeo, furnitureVertexMat, cNightBarPosts, true, false));
        if (cUrbanTrees) grp.add(createInstancedBatch(urbanTreeArchetypeGeo, furnitureVertexMat, cUrbanTrees, true, true));
        if (cPalms) grp.add(createInstancedBatch(palmArchetypeGeo, furnitureVertexMat, cPalms, true, true));

        for (let i = 0; i < cBuildings.length; i++) {
          grp.add(buildBuildingLod(cBuildings[i]));
        }
        if (cCustom) {
          for (let i = 0; i < cCustom.length; i++) {
            grp.add(cCustom[i]);
          }
        }
        return grp;
      },
      () => buildChunkImpostor(cx, cz, key),
      {
        buildings: cBuildings,
        propsCount: cPropsCount,
        furnitureInstances,
        trafficSpawns: cTrafficSpawns,
      }
    );
  }

  // Monta os chunks iniciais em torno do spawn para compilação de shaders e frame inicial
  chunkManager.syncAround(PLAYER_SPAWN_X, PLAYER_SPAWN_Z, QUALITY_SETTINGS.medium.drawDistance, true);

  return {
    buildings,
    pickups,
    oceanMesh,
    oceanBaseY,
    neonTrimMats,
    lampBulbMats,
    facadeMats,
    managedTextures,
    mission1StartBeacon,
    mission2StartBeacon,
    objectiveBeacon,
    briefcaseMesh,
    trafficLightNsMats,
    trafficLightEwMats,
    asphaltMat,
    promenadeMat,
    chunkManager,
  };
}
