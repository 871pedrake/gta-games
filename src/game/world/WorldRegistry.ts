import {
  ALLEY_WIDTH,
  AVENUE_MEDIAN_WIDTH,
  AVENUE_WIDTH,
  COASTAL_AVENUE_WIDTH,
  ROUNDABOUT_LANE_WIDTH,
  SECONDARY_STREET_WIDTH,
} from '../config';
import type { UrbanZoneId } from '../ZoneDensityManager';

export type DistrictId =
  | 'praia'
  | 'centro'
  | 'residencial'
  | 'parque'
  | 'porto'
  | 'historico'
  | 'comercial'
  | 'suburbio'
  | 'morro'
  | 'industrial'
  | 'heliponto'
  | 'campus';

export type DistrictVisualTheme =
  | 'coastal_beach'
  | 'financial_neon'
  | 'residential_apartments'
  | 'urban_park'
  | 'harbor_marina'
  | 'historic_colonial'
  | 'commercial_mall'
  | 'suburban_houses'
  | 'hillside_favela'
  | 'industrial_warehouse'
  | 'airfield_helipad'
  | 'university_campus';

export type DistrictRoofStyle = 'flat' | 'gable' | 'dome' | 'sawtooth' | 'terrace' | 'classic';

export interface DistrictSpec {
  id: DistrictId;
  zoneId: UrbanZoneId;
  name: string;
  subtitle: string;
  mapColor: string;
  groundHex: number;
  accentHex: number;
  roofStyle: DistrictRoofStyle;
  visualTheme: DistrictVisualTheme;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  baseMaxNpcDensity: number;
  weekendDensityScale: number;
  nightDensityScale: number;
  rainDensityScale: number;
}

export type StreetKind = 'avenue' | 'secondary' | 'alley' | 'coastal' | 'roundabout';

export interface StreetPoint {
  x: number;
  z: number;
}

export interface StreetSegment {
  id: string;
  streetId: string;
  x1: number;
  z1: number;
  x2: number;
  z2: number;
  length: number;
  dirX: number;
  dirZ: number;
  isOneWay?: boolean;
  crosswalkStart?: boolean;
  crosswalkEnd?: boolean;
}

export interface RoundaboutSpec {
  centerX: number;
  centerZ: number;
  outerRadius: number;
  innerRadius: number;
}

export interface StreetSpec {
  id: string;
  name: string;
  kind: StreetKind;
  width: number;
  lanes: number;
  medianWidth: number;
  sidewalkWidth: number;
  hasCrosswalks: boolean;
  points: StreetPoint[];
  segments: StreetSegment[];
  closed?: boolean;
  roundabout?: RoundaboutSpec;
}

export interface IntersectionArmSpec {
  streetId: string;
  streetWidth: number;
  dirX: number;
  dirZ: number;
  angle: number;
  hasCrosswalk: boolean;
}

export interface CrosswalkSpec {
  id: string;
  intersectionId: string;
  streetId: string;
  centerX: number;
  centerZ: number;
  dirX: number;
  dirZ: number;
  tangentX: number;
  tangentZ: number;
  width: number;
  crossAxis: 'ns' | 'ew';
  hasSignal: boolean;
  cornerAX: number;
  cornerAZ: number;
  cornerBX: number;
  cornerBZ: number;
}

export interface TrafficSignalSpec {
  id: string;
  intersectionId: string;
  x: number;
  z: number;
  yaw: number;
  hasNsHead: boolean;
  hasEwHead: boolean;
}

export interface IntersectionSpec {
  id: string;
  x: number;
  z: number;
  radius: number;
  hasSignal: boolean;
  isRoundabout: boolean;
  streetIds: string[];
  neighborIds: number[];
  arms: IntersectionArmSpec[];
  crosswalks: CrosswalkSpec[];
  signals: TrafficSignalSpec[];
}

export type WorldPoiCategory =
  | 'hospital'
  | 'police'
  | 'shop_clothing'
  | 'shop_barber'
  | 'shop_gun'
  | 'shop_workshop'
  | 'shop_market'
  | 'shop_dealership'
  | 'bus_stop'
  | 'bar'
  | 'stall'
  | 'bench'
  | 'volleyball';

export interface WorldPoiSpec {
  id: string;
  name: string;
  category: WorldPoiCategory;
  districtId: DistrictId;
  x: number;
  z: number;
  entryX: number;
  entryZ: number;
  yaw?: number;
  colorHex?: number;
  openHour?: number;
  closeHour?: number;
  roadStopX?: number;
  roadStopZ?: number;
  axis?: 'x' | 'z';
  dir?: 1 | -1;
}

export interface BuildingSpec {
  id: string;
  label: string;
  blockId: string;
  districtId: DistrictId;
  category: 'home' | 'workplace' | 'bar';
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  wallHex: string;
  winHex: string;
  neonHex: number;
  roofStyle?: DistrictRoofStyle;
  baseY?: number;
}

export interface CoverPointSpec {
  id: string;
  districtId: DistrictId;
  x: number;
  z: number;
  normalX: number;
  normalZ: number;
  kind: 'wall' | 'kiosk' | 'seawall' | 'planter';
}

export interface EventSpawnSpec {
  id: string;
  districtId: DistrictId;
  x: number;
  z: number;
  kind: 'sidewalk' | 'road' | 'beach' | 'plaza';
}

export const WORLD_BOUNDS = {
  minX: -280,
  maxX: 148,
  minZ: -280,
  maxZ: 280,
};

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Curva paramétrica suave da orla litorânea (mureta do calçadão -> areia).
 */
export function getCoastlineX(z: number): number {
  return 84 + Math.sin(z * 0.011) * 16 + Math.cos(z * 0.021) * 5;
}

/**
 * Linha central da Avenida Costeira (Av. Beira-Mar Solara) acompanhando a curva da orla.
 */
export function getCoastalRoadX(z: number): number {
  return getCoastlineX(z) - 21;
}

export function getCoastlineTangentAngle(z: number): number {
  const dxDz = 16 * 0.011 * Math.cos(z * 0.011) - 5 * 0.021 * Math.sin(z * 0.021);
  return Math.atan2(dxDz, 1);
}

export interface CanalBridgeSpec {
  id: string;
  name: string;
  xCenter: number;
  halfW: number;
  deckY: number;
  isPedestrianOnly?: boolean;
}

export interface SoftHillSpec {
  id: string;
  x: number;
  z: number;
  radius: number;
  height: number;
}

export const CANAL_SPEC = {
  zCenter: 77.8,
  zMin: 74.0,
  zMax: 81.6,
  rampLength: 3.8,
  xMin: -126,
  waterY: -0.35,
  bedY: -1.45,
};

export const CANAL_BRIDGES: CanalBridgeSpec[] = [
  { id: 'ponte_brisa', name: 'Ponte Brisa Marinha', xCenter: -80, halfW: 9.0, deckY: 1.65 },
  { id: 'ponte_alameda', name: 'Ponte Alameda do Sol', xCenter: -20, halfW: 11.4, deckY: 1.65 },
  { id: 'ponte_cassino', name: 'Ponte do Cassino', xCenter: 24, halfW: 9.0, deckY: 1.65 },
  {
    id: 'ponte_beira_mar',
    name: 'Ponte Beira-Mar',
    xCenter: getCoastalRoadX(CANAL_SPEC.zCenter),
    halfW: 8.4,
    deckY: 1.65,
  },
  {
    id: 'passarela_orla',
    name: 'Passarela da Orla',
    xCenter: getCoastlineX(CANAL_SPEC.zCenter) - 6.5,
    halfW: 2.0,
    deckY: 1.55,
    isPedestrianOnly: true,
  },
];

export const VIADUTO_SPEC = {
  id: 'viaduto_palmeiras',
  name: 'Viaduto das Palmeiras',
  xCenter: -140,
  halfW: 9.2,
  zRampStartN: 39,
  zDeckStart: 57,
  zDeckEnd: 79,
  zRampEndS: 97,
  deckY: 5.0,
  piers: [
    { x: -148.2, z: 57.2, halfW: 0.85, halfD: 0.85 },
    { x: -131.8, z: 57.2, halfW: 0.85, halfD: 0.85 },
    { x: -148.2, z: 72.8, halfW: 0.85, halfD: 0.85 },
    { x: -131.8, z: 72.8, halfW: 0.85, halfD: 0.85 },
  ],
};

export const TUNEL_SPEC = {
  id: 'tunel_parque',
  name: 'Túnel do Parque Atlântico',
  xCenter: -140,
  boreHalfW: 9.2,
  zStart: -192,
  zEnd: -160,
  clearanceY: 4.3,
  hillHalfW: 24,
  hillHeight: 5.6,
};

export const SOFT_HILLS: SoftHillSpec[] = [
  { id: 'hill_parque_ne', x: -58, z: -256, radius: 14, height: 2.4 },
  { id: 'hill_parque_sw', x: -110, z: -174, radius: 13.5, height: 2.1 },
  { id: 'hill_campus_e', x: 40, z: -246, radius: 13, height: 1.9 },
  { id: 'hill_enseada_s', x: 42, z: 235, radius: 13.5, height: 1.85 },
];

export const OFFSHORE_ISLANDS = [
  { id: 'ilha_norte', x: 196, z: -138, radius: 22, height: 11, hasLighthouse: false },
  { id: 'ilha_farol', x: 242, z: -14, radius: 28, height: 15, hasLighthouse: true },
  { id: 'ilha_coral', x: 212, z: 112, radius: 20, height: 9.5, hasLighthouse: false },
  { id: 'ilha_sul', x: 268, z: 196, radius: 24, height: 12, hasLighthouse: false },
];

/**
 * Elevação topográfica do Morro da Brisa (ladeiras, terraços e escadarias ao norte da Rua do Mirante).
 */
export function getMorroElevation(x: number, z: number): number {
  if (z >= -216 || x >= -144 || x <= -280) return 0;

  // Transições contínuas formando dois patamares (3,2 m e 6,6 m) ligados por ladeiras e escadaria
  const terrace1 = smoothstep(-216, -229, z) * 3.2;
  const terrace2 = smoothstep(-247, -258, z) * 3.4;
  const eastFade = smoothstep(-144, -158, x);
  const westFade = smoothstep(-278, -264, x);
  const northFade = smoothstep(-280, -274, z);
  return (terrace1 + terrace2) * eastFade * westFade * northFade;
}

export function getBridgeElevationAt(x: number, z: number): { bridge: CanalBridgeSpec; y: number } | null {
  const nRampStart = CANAL_SPEC.zMin - CANAL_SPEC.rampLength;
  const sRampEnd = CANAL_SPEC.zMax + CANAL_SPEC.rampLength;
  if (z < nRampStart || z > sRampEnd) return null;

  for (const b of CANAL_BRIDGES) {
    if (Math.abs(x - b.xCenter) > b.halfW) continue;
    let factor = 1;
    if (z < CANAL_SPEC.zMin) {
      factor = Math.max(0, Math.min(1, (z - nRampStart) / CANAL_SPEC.rampLength));
    } else if (z > CANAL_SPEC.zMax) {
      factor = Math.max(0, Math.min(1, (sRampEnd - z) / CANAL_SPEC.rampLength));
    }
    return { bridge: b, y: b.deckY * factor };
  }
  return null;
}

export function getViaductDeckElevationAt(x: number, z: number): number {
  if (Math.abs(x - VIADUTO_SPEC.xCenter) > VIADUTO_SPEC.halfW) return 0;
  if (z <= VIADUTO_SPEC.zRampStartN || z >= VIADUTO_SPEC.zRampEndS) return 0;
  if (z < VIADUTO_SPEC.zDeckStart) {
    return (
      VIADUTO_SPEC.deckY *
      ((z - VIADUTO_SPEC.zRampStartN) / (VIADUTO_SPEC.zDeckStart - VIADUTO_SPEC.zRampStartN))
    );
  }
  if (z > VIADUTO_SPEC.zDeckEnd) {
    return (
      VIADUTO_SPEC.deckY *
      ((VIADUTO_SPEC.zRampEndS - z) / (VIADUTO_SPEC.zRampEndS - VIADUTO_SPEC.zDeckEnd))
    );
  }
  return VIADUTO_SPEC.deckY;
}

export function getTunnelHillElevationAt(x: number, z: number): number {
  if (z < TUNEL_SPEC.zStart || z > TUNEL_SPEC.zEnd) return 0;
  const dx = Math.abs(x - TUNEL_SPEC.xCenter);
  if (dx >= TUNEL_SPEC.hillHalfW) return 0;
  if (dx <= TUNEL_SPEC.boreHalfW) return TUNEL_SPEC.hillHeight;
  const t = 1 - smoothstep(TUNEL_SPEC.boreHalfW, TUNEL_SPEC.hillHalfW, dx);
  return TUNEL_SPEC.hillHeight * t;
}

export function getSoftHillElevationAt(x: number, z: number): number {
  let maxY = 0;
  for (const h of SOFT_HILLS) {
    const d = Math.hypot(x - h.x, z - h.z);
    if (d < h.radius) {
      const t = 1 - smoothstep(0, h.radius, d);
      const val = h.height * t;
      if (val > maxY) maxY = val;
    }
  }
  return maxY;
}

/**
 * Altura unificada do terreno para física, pedestres, veículos e colocação de construções.
 * Suporta múltiplos níveis (sobre vs sob o Viaduto, dentro vs em cima do Túnel Curto) via currentY.
 */
export function getTerrainHeightAt(x: number, z: number, currentY = 0): number {
  // 1. Pontes e passarela sobre o Canal de Solara
  const bridgeHit = getBridgeElevationAt(x, z);
  if (bridgeHit) {
    const coastX = getCoastlineX(z);
    const baseRoadY = x >= coastX - 14.3 && x < coastX ? 0.09 : 0;
    return Math.max(baseRoadY, bridgeHit.y);
  }

  // 2. Leito submerso do Canal de Solara (zMin..zMax a leste de xMin)
  if (x >= CANAL_SPEC.xMin && z >= CANAL_SPEC.zMin && z <= CANAL_SPEC.zMax) {
    return CANAL_SPEC.bedY;
  }

  // 3. Viaduto das Palmeiras (rampa contínua ou tabuleiro elevado quando currentY >= deck - 2.3)
  const viaductY = getViaductDeckElevationAt(x, z);
  if (viaductY > 0.01 && currentY >= viaductY - 2.3) {
    return viaductY;
  }

  // 4. Túnel Curto do Parque & Colina Verde acima
  if (z >= TUNEL_SPEC.zStart && z <= TUNEL_SPEC.zEnd) {
    const dx = Math.abs(x - TUNEL_SPEC.xCenter);
    if (dx <= TUNEL_SPEC.boreHalfW) {
      if (currentY >= 3.2) return TUNEL_SPEC.hillHeight;
      return 0;
    }
    if (dx < TUNEL_SPEC.hillHalfW) {
      return getTunnelHillElevationAt(x, z);
    }
  }

  // 5. Píer da Marina, Calçadão curvo e Praia inclinada
  const coastX = getCoastlineX(z);
  if (x >= coastX - 0.5 && x <= coastX + 44 && Math.abs(z - 130) <= 4.8) return 0.58;
  if (x >= coastX - 14.3 && x < coastX) return 0.09;
  if (x >= coastX) return -((x - coastX) / 52) * 1.18 + 0.05;

  // 6. Morro da Brisa + Elevações suaves dos parques e áreas abertas
  const morroY = getMorroElevation(x, z);
  if (morroY > 0) return morroY;
  return getSoftHillElevationAt(x, z);
}

/**
 * Colisões de infraestrutura: guard-rails do viaduto/pontes, pilares do viaduto,
 * paredes do túnel curto, contenção do cais/canal e paredões perimetrais.
 */
export function resolveInfrastructureCollisions(pos: { x: number; y: number; z: number }, radius: number): boolean {
  let hit = false;

  // A. Viaduto das Palmeiras: muretas no deck superior OU pilares no nível do solo
  const viaductY = getViaductDeckElevationAt(pos.x, pos.z);
  if (pos.z >= VIADUTO_SPEC.zRampStartN + 2 && pos.z <= VIADUTO_SPEC.zRampEndS - 2) {
    if (pos.y >= Math.max(1.8, viaductY - 2.0) && Math.abs(pos.x - VIADUTO_SPEC.xCenter) <= VIADUTO_SPEC.halfW + 1.5) {
      const minVx = VIADUTO_SPEC.xCenter - VIADUTO_SPEC.halfW + 0.55 + radius;
      const maxVx = VIADUTO_SPEC.xCenter + VIADUTO_SPEC.halfW - 0.55 - radius;
      if (pos.x < minVx) {
        pos.x = minVx;
        hit = true;
      } else if (pos.x > maxVx) {
        pos.x = maxVx;
        hit = true;
      }
    } else if (pos.y < 2.6) {
      for (const pier of VIADUTO_SPEC.piers) {
        const minX = pier.x - pier.halfW - radius;
        const maxX = pier.x + pier.halfW + radius;
        const minZ = pier.z - pier.halfD - radius;
        const maxZ = pier.z + pier.halfD + radius;
        if (pos.x > minX && pos.x < maxX && pos.z > minZ && pos.z < maxZ) {
          const dL = pos.x - minX;
          const dR = maxX - pos.x;
          const dT = pos.z - minZ;
          const dB = maxZ - pos.z;
          const m = Math.min(dL, dR, dT, dB);
          if (m === dL) pos.x = minX;
          else if (m === dR) pos.x = maxX;
          else if (m === dT) pos.z = minZ;
          else pos.z = maxZ;
          hit = true;
        }
      }
    }
  }

  // B. Túnel Curto do Parque: paredes internas quando dentro da galeria; ombreiras externas nos portais
  if (pos.z >= TUNEL_SPEC.zStart - 0.3 && pos.z <= TUNEL_SPEC.zEnd + 0.3 && pos.y < 3.2) {
    const dx = Math.abs(pos.x - TUNEL_SPEC.xCenter);
    if (dx <= TUNEL_SPEC.boreHalfW + 0.8) {
      const minTx = TUNEL_SPEC.xCenter - TUNEL_SPEC.boreHalfW + 0.4 + radius;
      const maxTx = TUNEL_SPEC.xCenter + TUNEL_SPEC.boreHalfW - 0.4 - radius;
      if (pos.x < minTx) {
        pos.x = minTx;
        hit = true;
      } else if (pos.x > maxTx) {
        pos.x = maxTx;
        hit = true;
      }
    } else if (dx <= TUNEL_SPEC.boreHalfW + 5.2 && pos.y < 2.6) {
      // Muros de contenção laterais logo ao lado da boca do túnel; além disso a colina é escalável a pé
      const dN = Math.abs(pos.z - (TUNEL_SPEC.zStart - 0.3));
      const dS = Math.abs(pos.z - (TUNEL_SPEC.zEnd + 0.3));
      if (dN < dS) pos.z = TUNEL_SPEC.zStart - 0.3 - radius;
      else pos.z = TUNEL_SPEC.zEnd + 0.3 + radius;
      hit = true;
    }
  }

  // C. Canal de Solara e Pontes
  if (pos.x >= CANAL_SPEC.xMin - radius && pos.z >= CANAL_SPEC.zMin - radius && pos.z <= CANAL_SPEC.zMax + radius) {
    const bridgeHit = getBridgeElevationAt(pos.x, pos.z);
    if (bridgeHit && pos.y >= 0.45) {
      const minBx = bridgeHit.bridge.xCenter - bridgeHit.bridge.halfW + 0.45 + radius;
      const maxBx = bridgeHit.bridge.xCenter + bridgeHit.bridge.halfW - 0.45 - radius;
      if (pos.x < minBx) {
        pos.x = minBx;
        hit = true;
      } else if (pos.x > maxBx) {
        pos.x = maxBx;
        hit = true;
      }
    } else {
      // Impede cair na água profunda do canal fora das pontes
      const dN = pos.z - (CANAL_SPEC.zMin - radius);
      const dS = CANAL_SPEC.zMax + radius - pos.z;
      const dW = pos.x - (CANAL_SPEC.xMin - radius);
      const m = Math.min(dN, dS, dW);
      if (m === dW) pos.x = CANAL_SPEC.xMin - radius;
      else if (m === dN) pos.z = CANAL_SPEC.zMin - radius;
      else pos.z = CANAL_SPEC.zMax + radius;
      hit = true;
    }
  }

  return hit;
}

function buildSegmentsFromPolylines(
  streetId: string,
  polylines: StreetPoint[][],
  hasCrosswalks: boolean,
  closed = false
): StreetSegment[] {
  const segments: StreetSegment[] = [];
  let idx = 0;
  for (const pts of polylines) {
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const len = Math.hypot(dx, dz);
      if (len < 0.01) continue;
      segments.push({
        id: `${streetId}_seg_${idx++}`,
        streetId,
        x1: a.x,
        z1: a.z,
        x2: b.x,
        z2: b.z,
        length: len,
        dirX: dx / len,
        dirZ: dz / len,
        isOneWay: closed,
        crosswalkStart: hasCrosswalks && i === 0,
        crosswalkEnd: hasCrosswalks && i === pts.length - 2,
      });
    }
  }
  return segments;
}

function makeStraightStreet(
  id: string,
  name: string,
  kind: Exclude<StreetKind, 'coastal' | 'roundabout'>,
  runs: StreetPoint[][],
  width: number,
  lanes: number,
  medianWidth: number,
  sidewalkWidth: number,
  hasCrosswalks: boolean
): StreetSpec {
  const points = runs.flat();
  return {
    id,
    name,
    kind,
    width,
    lanes,
    medianWidth,
    sidewalkWidth,
    hasCrosswalks,
    points,
    segments: buildSegmentsFromPolylines(id, runs, hasCrosswalks, false),
  };
}

function makeCoastalAvenue(): StreetSpec {
  const points: StreetPoint[] = [];
  for (let z = -252; z <= 252; z += 24) {
    points.push({ x: getCoastalRoadX(z), z });
  }
  return {
    id: 'st_beira_mar',
    name: 'Av. Beira-Mar Solara',
    kind: 'coastal',
    width: COASTAL_AVENUE_WIDTH,
    lanes: 2,
    medianWidth: 0,
    sidewalkWidth: 3.5,
    hasCrosswalks: true,
    points,
    segments: buildSegmentsFromPolylines('st_beira_mar', [points], true, false),
  };
}

function makeRoundaboutStreet(
  id: string,
  name: string,
  centerX: number,
  centerZ: number,
  outerRadius: number,
  innerRadius: number
): StreetSpec {
  const steps = 16;
  const midRadius = (outerRadius + innerRadius) * 0.5;
  const points: StreetPoint[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    points.push({
      x: centerX + Math.cos(a) * midRadius,
      z: centerZ + Math.sin(a) * midRadius,
    });
  }
  return {
    id,
    name,
    kind: 'roundabout',
    width: outerRadius - innerRadius,
    lanes: 2,
    medianWidth: 0,
    sidewalkWidth: 3.0,
    hasCrosswalks: true,
    closed: true,
    roundabout: { centerX, centerZ, outerRadius, innerRadius },
    points,
    segments: buildSegmentsFromPolylines(id, [points], true, true),
  };
}

// Rotatórias principais onde o canteiro central das avenidas se abre para o anel circular
const ROT_PALMEIRAS = { x: -140, z: -120, outer: 8 + ROUNDABOUT_LANE_WIDTH, inner: 8 };
const ROT_PRACA_SOL = { x: -20, z: 0, outer: 10 + ROUNDABOUT_LANE_WIDTH, inner: 10 };
const ROT_MARINA = { x: -20, z: 130, outer: 8 + ROUNDABOUT_LANE_WIDTH, inner: 8 };

export const STREETS: StreetSpec[] = [
  // Avenidas principais (4 faixas + canteiro central; trechos divididos nas rotatórias)
  makeStraightStreet(
    'st_atlantica_norte',
    'Av. Atlântica Norte',
    'avenue',
    [
      [{ x: -252, z: -120 }, { x: ROT_PALMEIRAS.x - ROT_PALMEIRAS.outer, z: -120 }],
      [{ x: ROT_PALMEIRAS.x + ROT_PALMEIRAS.outer, z: -120 }, { x: getCoastalRoadX(-120), z: -120 }],
    ],
    AVENUE_WIDTH,
    4,
    AVENUE_MEDIAN_WIDTH,
    3.4,
    true
  ),
  makeStraightStreet(
    'st_central_solara',
    'Av. Central Solara',
    'avenue',
    [
      [{ x: -252, z: 0 }, { x: ROT_PRACA_SOL.x - ROT_PRACA_SOL.outer, z: 0 }],
      [{ x: ROT_PRACA_SOL.x + ROT_PRACA_SOL.outer, z: 0 }, { x: getCoastalRoadX(0), z: 0 }],
    ],
    AVENUE_WIDTH,
    4,
    AVENUE_MEDIAN_WIDTH,
    3.6,
    true
  ),
  makeStraightStreet(
    'st_av_palmeiras',
    'Av. das Palmeiras',
    'avenue',
    [
      [{ x: -140, z: -248 }, { x: -140, z: ROT_PALMEIRAS.z - ROT_PALMEIRAS.outer }],
      [{ x: -140, z: ROT_PALMEIRAS.z + ROT_PALMEIRAS.outer }, { x: -140, z: 248 }],
    ],
    AVENUE_WIDTH,
    4,
    AVENUE_MEDIAN_WIDTH,
    3.4,
    true
  ),
  makeStraightStreet(
    'st_alameda_sol',
    'Alameda do Sol',
    'avenue',
    [
      [{ x: -20, z: -248 }, { x: -20, z: ROT_PRACA_SOL.z - ROT_PRACA_SOL.outer }],
      [{ x: -20, z: ROT_PRACA_SOL.z + ROT_PRACA_SOL.outer }, { x: -20, z: ROT_MARINA.z - ROT_MARINA.outer }],
      [{ x: -20, z: ROT_MARINA.z + ROT_MARINA.outer }, { x: -20, z: 248 }],
    ],
    AVENUE_WIDTH,
    4,
    AVENUE_MEDIAN_WIDTH,
    3.6,
    true
  ),

  // Avenida costeira com curvas suaves acompanhando a orla
  makeCoastalAvenue(),

  // Rotatórias
  makeRoundaboutStreet(
    'st_rot_palmeiras',
    'Rotatória das Palmeiras',
    ROT_PALMEIRAS.x,
    ROT_PALMEIRAS.z,
    ROT_PALMEIRAS.outer,
    ROT_PALMEIRAS.inner
  ),
  makeRoundaboutStreet(
    'st_rot_sol',
    'Rotatória Praça do Sol',
    ROT_PRACA_SOL.x,
    ROT_PRACA_SOL.z,
    ROT_PRACA_SOL.outer,
    ROT_PRACA_SOL.inner
  ),
  makeRoundaboutStreet(
    'st_rot_marina',
    'Rotatória da Marina',
    ROT_MARINA.x,
    ROT_MARINA.z,
    ROT_MARINA.outer,
    ROT_MARINA.inner
  ),

  // Ruas secundárias (2 faixas)
  makeStraightStreet(
    'st_mirante',
    'Rua do Mirante',
    'secondary',
    [[{ x: -248, z: -210 }, { x: getCoastalRoadX(-210), z: -210 }]],
    SECONDARY_STREET_WIDTH,
    2,
    0,
    2.6,
    true
  ),
  makeStraightStreet(
    'st_galpoes',
    'Rua dos Galpões',
    'secondary',
    [[{ x: -252, z: -60 }, { x: -20, z: -60 }]],
    SECONDARY_STREET_WIDTH,
    2,
    0,
    2.4,
    true
  ),
  makeStraightStreet(
    'st_flamingo',
    'Rua Flamingo',
    'secondary',
    [[{ x: -252, z: 65 }, { x: getCoastalRoadX(65), z: 65 }]],
    SECONDARY_STREET_WIDTH,
    2,
    0,
    2.6,
    true
  ),
  makeStraightStreet(
    'st_porto_sul',
    'Av. do Porto Sul',
    'secondary',
    [
      [{ x: -248, z: 130 }, { x: ROT_MARINA.x - ROT_MARINA.outer, z: 130 }],
      [{ x: ROT_MARINA.x + ROT_MARINA.outer, z: 130 }, { x: getCoastalRoadX(130), z: 130 }],
    ],
    SECONDARY_STREET_WIDTH,
    2,
    0,
    2.6,
    true
  ),
  makeStraightStreet(
    'st_enseada',
    'Rua da Enseada',
    'secondary',
    [[{ x: -248, z: 205 }, { x: getCoastalRoadX(205), z: 205 }]],
    SECONDARY_STREET_WIDTH,
    2,
    0,
    2.6,
    true
  ),
  makeStraightStreet(
    'st_fundicao',
    'Rua da Fundição',
    'secondary',
    [[{ x: -215, z: -210 }, { x: -215, z: 205 }]],
    SECONDARY_STREET_WIDTH,
    2,
    0,
    2.4,
    true
  ),
  makeStraightStreet(
    'st_brisa_marinha',
    'Rua Brisa Marinha',
    'secondary',
    [[{ x: -80, z: -210 }, { x: -80, z: 205 }]],
    SECONDARY_STREET_WIDTH,
    2,
    0,
    2.6,
    true
  ),
  makeStraightStreet(
    'st_cassino',
    'Rua do Cassino',
    'secondary',
    [[{ x: 24, z: -120 }, { x: 24, z: 130 }]],
    SECONDARY_STREET_WIDTH,
    2,
    0,
    2.6,
    true
  ),

  // Vielas e travessas estreitas
  makeStraightStreet(
    'st_viela_porto',
    'Viela do Porto',
    'alley',
    [[{ x: -178, z: -120 }, { x: -178, z: 0 }]],
    ALLEY_WIDTH,
    1,
    0,
    1.2,
    false
  ),
  makeStraightStreet(
    'st_beco_neon',
    'Beco do Neon',
    'alley',
    [[{ x: -80, z: -30 }, { x: -20, z: -30 }]],
    ALLEY_WIDTH,
    1,
    0,
    1.2,
    false
  ),
  makeStraightStreet(
    'st_trav_flamingo',
    'Travessa Flamingo',
    'alley',
    [[{ x: -50, z: 0 }, { x: -50, z: 65 }]],
    ALLEY_WIDTH,
    1,
    0,
    1.2,
    false
  ),
  makeStraightStreet(
    'st_viela_coral',
    'Viela Coral',
    'alley',
    [[{ x: -140, z: 168 }, { x: -80, z: 168 }]],
    ALLEY_WIDTH,
    1,
    0,
    1.2,
    false
  ),
  makeStraightStreet(
    'st_beco_pescadores',
    'Beco dos Pescadores',
    'alley',
    [[{ x: 2, z: 130 }, { x: 2, z: 205 }]],
    ALLEY_WIDTH,
    1,
    0,
    1.2,
    false
  ),
];

function segmentIntersection2D(
  a: StreetSegment,
  b: StreetSegment
): { x: number; z: number } | null {
  const rX = a.x2 - a.x1;
  const rZ = a.z2 - a.z1;
  const sX = b.x2 - b.x1;
  const sZ = b.z2 - b.z1;
  const denom = rX * sZ - rZ * sX;
  if (Math.abs(denom) < 1e-4) return null;

  const qpx = b.x1 - a.x1;
  const qpz = b.z1 - a.z1;
  const t = (qpx * sZ - qpz * sX) / denom;
  const u = (qpx * rZ - qpz * rX) / denom;
  if (t >= -0.02 && t <= 1.02 && u >= -0.02 && u <= 1.02) {
    return { x: a.x1 + t * rX, z: a.z1 + t * rZ };
  }
  return null;
}

function pointToSegmentDistSq(px: number, pz: number, x1: number, z1: number, x2: number, z2: number): number {
  const dx = x2 - x1;
  const dz = z2 - z1;
  const len2 = dx * dx + dz * dz;
  if (len2 < 1e-6) return (px - x1) ** 2 + (pz - z1) ** 2;
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (pz - z1) * dz) / len2));
  const cx = x1 + t * dx;
  const cz = z1 + t * dz;
  return (px - cx) ** 2 + (pz - cz) ** 2;
}

function isPointOnAnyStreetBed(x: number, z: number, streets: StreetSpec[], margin = 0.25): boolean {
  for (const s of streets) {
    if (s.kind === 'roundabout' && s.roundabout) {
      const d = Math.hypot(x - s.roundabout.centerX, z - s.roundabout.centerZ);
      if (d >= s.roundabout.innerRadius - margin && d <= s.roundabout.outerRadius + margin) {
        return true;
      }
      continue;
    }
    const halfW2 = (s.width * 0.5 + margin) ** 2;
    for (const seg of s.segments) {
      if (pointToSegmentDistSq(x, z, seg.x1, seg.z1, seg.x2, seg.z2) <= halfW2) {
        return true;
      }
    }
  }
  return false;
}

function buildIntersectionsFromStreets(streets: StreetSpec[]): IntersectionSpec[] {
  const list: IntersectionSpec[] = [];
  const streetById = new Map(streets.map((s) => [s.id, s]));

  const addOrMerge = (
    x: number,
    z: number,
    radius: number,
    hasSignal: boolean,
    isRoundabout: boolean,
    ids: string[]
  ): number => {
    for (let i = 0; i < list.length; i++) {
      const ex = list[i];
      if (Math.hypot(ex.x - x, ex.z - z) < 5.5) {
        ex.radius = Math.max(ex.radius, radius);
        ex.hasSignal = ex.hasSignal || hasSignal;
        ex.isRoundabout = ex.isRoundabout || isRoundabout;
        for (const id of ids) {
          if (!ex.streetIds.includes(id)) ex.streetIds.push(id);
        }
        return i;
      }
    }
    const idx = list.length;
    list.push({
      id: `int_${idx}`,
      x,
      z,
      radius,
      hasSignal,
      isRoundabout,
      streetIds: [...ids],
      neighborIds: [],
      arms: [],
      crosswalks: [],
      signals: [],
    });
    return idx;
  };

  for (const s of streets) {
    if (s.kind === 'roundabout' && s.roundabout) {
      addOrMerge(
        s.roundabout.centerX,
        s.roundabout.centerZ,
        s.roundabout.outerRadius,
        false,
        true,
        [s.id]
      );
    }
  }

  for (let i = 0; i < streets.length; i++) {
    const sa = streets[i];
    if (sa.kind === 'roundabout') continue;
    for (let j = i + 1; j < streets.length; j++) {
      const sb = streets[j];
      if (sb.kind === 'roundabout') continue;
      for (const segA of sa.segments) {
        for (const segB of sb.segments) {
          const hit = segmentIntersection2D(segA, segB);
          if (!hit) continue;
          const bothNonAlley = sa.kind !== 'alley' && sb.kind !== 'alley';
          const radius = Math.max(sa.width, sb.width) * 0.5;
          addOrMerge(hit.x, hit.z, radius, bothNonAlley, false, [sa.id, sb.id]);
        }
      }
    }
  }

  for (const s of streets) {
    if (s.kind === 'roundabout' && s.roundabout) {
      const rbCenterIdx = list.findIndex(
        (it) => it.isRoundabout && Math.hypot(it.x - s.roundabout!.centerX, it.z - s.roundabout!.centerZ) < 2
      );
      if (rbCenterIdx < 0) continue;
      const rb = list[rbCenterIdx];
      for (const other of streets) {
        if (other.id === s.id) continue;
        for (const seg of other.segments) {
          const dStart = Math.hypot(seg.x1 - rb.x, seg.z1 - rb.z);
          const dEnd = Math.hypot(seg.x2 - rb.x, seg.z2 - rb.z);
          if (Math.abs(dStart - s.roundabout.outerRadius) < 3.5 || Math.abs(dEnd - s.roundabout.outerRadius) < 3.5) {
            if (!rb.streetIds.includes(other.id)) rb.streetIds.push(other.id);
          }
        }
      }
    }
  }

  for (const s of streets) {
    if (s.kind === 'roundabout') continue;
    const onStreet: Array<{ idx: number; proj: number }> = [];
    const first = s.segments[0];
    const last = s.segments[s.segments.length - 1];
    const axisX = last.x2 - first.x1;
    const axisZ = last.z2 - first.z1;
    const axisLen = Math.hypot(axisX, axisZ) || 1;
    const ux = axisX / axisLen;
    const uz = axisZ / axisLen;

    for (let idx = 0; idx < list.length; idx++) {
      const it = list[idx];
      if (!it.streetIds.includes(s.id)) continue;
      onStreet.push({
        idx,
        proj: (it.x - first.x1) * ux + (it.z - first.z1) * uz,
      });
    }
    onStreet.sort((a, b) => a.proj - b.proj);
    for (let k = 0; k < onStreet.length - 1; k++) {
      const a = list[onStreet[k].idx];
      const b = list[onStreet[k + 1].idx];
      const aSpec = streetById.get(s.id)!;
      if (aSpec.segments.length > 1) {
        const midX = (a.x + b.x) * 0.5;
        const midZ = (a.z + b.z) * 0.5;
        const hitsAnySeg = aSpec.segments.some(
          (seg) => pointToSegmentDistSq(midX, midZ, seg.x1, seg.z1, seg.x2, seg.z2) < 9
        );
        if (!hitsAnySeg && !a.isRoundabout && !b.isRoundabout) continue;
      }
      if (!a.neighborIds.includes(onStreet[k + 1].idx)) a.neighborIds.push(onStreet[k + 1].idx);
      if (!b.neighborIds.includes(onStreet[k].idx)) b.neighborIds.push(onStreet[k].idx);
    }
  }

  const addArmCandidate = (arms: IntersectionArmSpec[], cand: IntersectionArmSpec) => {
    for (let i = 0; i < arms.length; i++) {
      const existing = arms[i];
      const diff = Math.abs(Math.atan2(Math.sin(cand.angle - existing.angle), Math.cos(cand.angle - existing.angle)));
      if (diff < 0.45) {
        if (cand.streetWidth > existing.streetWidth || (cand.hasCrosswalk && !existing.hasCrosswalk)) {
          arms[i] = cand;
        }
        return;
      }
    }
    arms.push(cand);
  };

  for (const inter of list) {
    const arms: IntersectionArmSpec[] = [];

    if (inter.isRoundabout) {
      const rbStreet = inter.streetIds.map((id) => streetById.get(id)).find((s) => s?.kind === 'roundabout');
      const outerR = rbStreet?.roundabout?.outerRadius ?? inter.radius;
      for (const sid of inter.streetIds) {
        const st = streetById.get(sid);
        if (!st || st.kind === 'roundabout') continue;
        for (const seg of st.segments) {
          const dStart = Math.hypot(seg.x1 - inter.x, seg.z1 - inter.z);
          if (Math.abs(dStart - outerR) < 4.5) {
            const dx = (seg.x1 - inter.x) / (dStart || 1);
            const dz = (seg.z1 - inter.z) / (dStart || 1);
            addArmCandidate(arms, {
              streetId: sid,
              streetWidth: st.width,
              dirX: dx,
              dirZ: dz,
              angle: Math.atan2(dz, dx),
              hasCrosswalk: st.hasCrosswalks,
            });
          }
          const dEnd = Math.hypot(seg.x2 - inter.x, seg.z2 - inter.z);
          if (Math.abs(dEnd - outerR) < 4.5) {
            const dx = (seg.x2 - inter.x) / (dEnd || 1);
            const dz = (seg.z2 - inter.z) / (dEnd || 1);
            addArmCandidate(arms, {
              streetId: sid,
              streetWidth: st.width,
              dirX: dx,
              dirZ: dz,
              angle: Math.atan2(dz, dx),
              hasCrosswalk: st.hasCrosswalks,
            });
          }
        }
      }
    } else {
      for (const sid of inter.streetIds) {
        const st = streetById.get(sid);
        if (!st || st.kind === 'roundabout') continue;
        const maxDistSq = (inter.radius + 5.5) ** 2;
        for (const seg of st.segments) {
          const d2 = pointToSegmentDistSq(inter.x, inter.z, seg.x1, seg.z1, seg.x2, seg.z2);
          if (d2 > maxDistSq) continue;
          const proj = (inter.x - seg.x1) * seg.dirX + (inter.z - seg.z1) * seg.dirZ;
          if (proj < seg.length - 2.5) {
            addArmCandidate(arms, {
              streetId: sid,
              streetWidth: st.width,
              dirX: seg.dirX,
              dirZ: seg.dirZ,
              angle: Math.atan2(seg.dirZ, seg.dirX),
              hasCrosswalk: st.hasCrosswalks,
            });
          }
          if (proj > 2.5) {
            addArmCandidate(arms, {
              streetId: sid,
              streetWidth: st.width,
              dirX: -seg.dirX,
              dirZ: -seg.dirZ,
              angle: Math.atan2(-seg.dirZ, -seg.dirX),
              hasCrosswalk: st.hasCrosswalks,
            });
          }
        }
      }
    }

    arms.sort((a, b) => a.angle - b.angle);
    inter.arms = arms;

    // Gera faixas de pedestres por braço válido do cruzamento
    const crosswalks: CrosswalkSpec[] = [];
    if (inter.hasSignal || inter.isRoundabout) {
      const centerDist = inter.radius + (inter.isRoundabout ? 2.2 : 1.8);
      for (let aIdx = 0; aIdx < arms.length; aIdx++) {
        const arm = arms[aIdx];
        if (!arm.hasCrosswalk) continue;
        const centerX = inter.x + arm.dirX * centerDist;
        const centerZ = inter.z + arm.dirZ * centerDist;
        const tangentX = -arm.dirZ;
        const tangentZ = arm.dirX;
        const sideHalf = arm.streetWidth * 0.5 + 1.8;
        const width = Math.min(arm.streetWidth - 1.2, Math.max(4.5, arm.streetWidth * 0.8));
        const crossAxis: 'ns' | 'ew' = Math.abs(arm.dirZ) >= Math.abs(arm.dirX) ? 'ew' : 'ns';
        crosswalks.push({
          id: `${inter.id}_cw_${crosswalks.length}`,
          intersectionId: inter.id,
          streetId: arm.streetId,
          centerX,
          centerZ,
          dirX: arm.dirX,
          dirZ: arm.dirZ,
          tangentX,
          tangentZ,
          width,
          crossAxis,
          hasSignal: inter.hasSignal && !inter.isRoundabout,
          cornerAX: centerX + tangentX * sideHalf,
          cornerAZ: centerZ + tangentZ * sideHalf,
          cornerBX: centerX - tangentX * sideHalf,
          cornerBZ: centerZ - tangentZ * sideHalf,
        });
      }
    }
    inter.crosswalks = crosswalks;

    // Gera postes de semáforo por cruzamento sinalizado nos cantos da calçada
    const signals: TrafficSignalSpec[] = [];
    if (inter.hasSignal && !inter.isRoundabout && arms.length >= 2) {
      const candidates: Array<{ x: number; z: number; yaw: number }> = [];
      for (let k = 0; k < arms.length; k++) {
        const armA = arms[k];
        const armB = arms[(k + 1) % arms.length];
        let gap = armB.angle - armA.angle;
        if (gap <= 0) gap += Math.PI * 2;
        if (gap > Math.PI * 0.85) continue;
        const midAngle = armA.angle + gap * 0.5;
        const dist = Math.min(
          inter.radius + 3.8,
          Math.max(inter.radius + 1.0, (Math.max(armA.streetWidth, armB.streetWidth) * 0.5 + 1.0) / Math.max(0.55, Math.sin(gap * 0.5)))
        );
        const sx = inter.x + Math.cos(midAngle) * dist;
        const sz = inter.z + Math.sin(midAngle) * dist;
        if (!isPointOnAnyStreetBed(sx, sz, streets, 0.35)) {
          candidates.push({ x: sx, z: sz, yaw: 0 });
        }
      }

      if (candidates.length === 0) {
        candidates.push({
          x: inter.x + inter.radius + 1.0,
          z: inter.z - inter.radius - 1.0,
          yaw: 0,
        });
      }

      const selected: Array<{ x: number; z: number; yaw: number }> = [candidates[0]];
      if (candidates.length > 1) {
        let farthest = candidates[1];
        let bestDist = -1;
        for (let c = 1; c < candidates.length; c++) {
          const d = Math.hypot(candidates[c].x - candidates[0].x, candidates[c].z - candidates[0].z);
          if (d > bestDist) {
            bestDist = d;
            farthest = candidates[c];
          }
        }
        if (bestDist > inter.radius * 1.1) {
          selected.push(farthest);
        }
      }

      const hasNsHead = crosswalks.some((c) => c.crossAxis === 'ns') || arms.some((a) => Math.abs(a.dirX) > 0.3);
      const hasEwHead = crosswalks.some((c) => c.crossAxis === 'ew') || arms.some((a) => Math.abs(a.dirZ) > 0.3);
      for (let sIdx = 0; sIdx < selected.length; sIdx++) {
        signals.push({
          id: `${inter.id}_sig_${sIdx}`,
          intersectionId: inter.id,
          x: selected[sIdx].x,
          z: selected[sIdx].z,
          yaw: selected[sIdx].yaw,
          hasNsHead,
          hasEwHead,
        });
      }
    }
    inter.signals = signals;
  }

  return list;
}

export const INTERSECTIONS: IntersectionSpec[] = buildIntersectionsFromStreets(STREETS);
export const CROSSWALKS: CrosswalkSpec[] = INTERSECTIONS.flatMap((inter) => inter.crosswalks);
export const TRAFFIC_SIGNALS: TrafficSignalSpec[] = INTERSECTIONS.flatMap((inter) => inter.signals);

export const DISTRICTS: DistrictSpec[] = [
  {
    id: 'praia',
    zoneId: 'praia',
    name: 'Orla de Solara',
    subtitle: 'Av. Beira-Mar, calçadão curvo e areia clara',
    mapColor: '#c89e69',
    groundHex: 0xd8c6b8,
    accentHex: 0x16f2d4,
    roofStyle: 'flat',
    visualTheme: 'coastal_beach',
    minX: 40,
    maxX: 148,
    minZ: -280,
    maxZ: 280,
    baseMaxNpcDensity: 34,
    weekendDensityScale: 1.35,
    nightDensityScale: 0.28,
    rainDensityScale: 0.45,
  },
  {
    id: 'centro',
    zoneId: 'centro',
    name: 'Centro Financeiro Neon',
    subtitle: 'Praça do Sol, torres espelhadas e cassino',
    mapColor: '#3e2d6e',
    groundHex: 0x25243b,
    accentHex: 0xff2e93,
    roofStyle: 'flat',
    visualTheme: 'financial_neon',
    minX: -80,
    maxX: 72,
    minZ: -130,
    maxZ: 56,
    baseMaxNpcDensity: 36,
    weekendDensityScale: 0.72,
    nightDensityScale: 0.5,
    rainDensityScale: 0.72,
  },
  {
    id: 'comercial',
    zoneId: 'comercial',
    name: 'Polo Comercial & Shopping',
    subtitle: 'Shopping Atlântico Solara e galerias neon',
    mapColor: '#6d357a',
    groundHex: 0x383354,
    accentHex: 0xf472b6,
    roofStyle: 'dome',
    visualTheme: 'commercial_mall',
    minX: -140,
    maxX: -80,
    minZ: -130,
    maxZ: 0,
    baseMaxNpcDensity: 32,
    weekendDensityScale: 1.25,
    nightDensityScale: 0.48,
    rainDensityScale: 0.85,
  },
  {
    id: 'historico',
    zoneId: 'historico',
    name: 'Centro Histórico',
    subtitle: 'Sobrados coloniais, arcos e calçamento antigo',
    mapColor: '#8d654d',
    groundHex: 0x4c403c,
    accentHex: 0xfbbf24,
    roofStyle: 'gable',
    visualTheme: 'historic_colonial',
    minX: -80,
    maxX: 75,
    minZ: 56,
    maxZ: 125,
    baseMaxNpcDensity: 24,
    weekendDensityScale: 1.28,
    nightDensityScale: 0.45,
    rainDensityScale: 0.6,
  },
  {
    id: 'residencial',
    zoneId: 'residencial',
    name: 'Bairro Brisa Sul',
    subtitle: 'Condomínios, hospital e alamedas arborizadas',
    mapColor: '#373563',
    groundHex: 0x2b2d47,
    accentHex: 0x38bdf8,
    roofStyle: 'flat',
    visualTheme: 'residential_apartments',
    minX: -140,
    maxX: -20,
    minZ: 0,
    maxZ: 208,
    baseMaxNpcDensity: 24,
    weekendDensityScale: 1.05,
    nightDensityScale: 0.42,
    rainDensityScale: 0.62,
  },
  {
    id: 'suburbio',
    zoneId: 'suburbio',
    name: 'Subúrbio Jardim Atlântico',
    subtitle: 'Casas com quintais, telhados e ruas calmas',
    mapColor: '#486b4e',
    groundHex: 0x2c4234,
    accentHex: 0x4ade80,
    roofStyle: 'gable',
    visualTheme: 'suburban_houses',
    minX: -280,
    maxX: -140,
    minZ: 58,
    maxZ: 208,
    baseMaxNpcDensity: 16,
    weekendDensityScale: 1.12,
    nightDensityScale: 0.34,
    rainDensityScale: 0.55,
  },
  {
    id: 'morro',
    zoneId: 'morro',
    name: 'Morro da Brisa',
    subtitle: 'Ladeiras íngremes, escadarias e casinhas coloridas',
    mapColor: '#9b5c42',
    groundHex: 0x5c4338,
    accentHex: 0xfb923c,
    roofStyle: 'terrace',
    visualTheme: 'hillside_favela',
    minX: -280,
    maxX: -148,
    minZ: -280,
    maxZ: -214,
    baseMaxNpcDensity: 28,
    weekendDensityScale: 1.15,
    nightDensityScale: 0.42,
    rainDensityScale: 0.7,
  },
  {
    id: 'parque',
    zoneId: 'parque',
    name: 'Parque Atlântico',
    subtitle: 'Gramados verdes, lago central e mirantes',
    mapColor: '#265c42',
    groundHex: 0x264f3a,
    accentHex: 0x2dd4bf,
    roofStyle: 'flat',
    visualTheme: 'urban_park',
    minX: -148,
    maxX: -20,
    minZ: -280,
    maxZ: -130,
    baseMaxNpcDensity: 22,
    weekendDensityScale: 1.38,
    nightDensityScale: 0.28,
    rainDensityScale: 0.45,
  },
  {
    id: 'campus',
    zoneId: 'campus',
    name: 'Campus Universidade Solara',
    subtitle: 'Reitoria clássica, biblioteca e quadra estudantil',
    mapColor: '#366156',
    groundHex: 0x3b4d3f,
    accentHex: 0x34d399,
    roofStyle: 'classic',
    visualTheme: 'university_campus',
    minX: -20,
    maxX: 70,
    minZ: -280,
    maxZ: -130,
    baseMaxNpcDensity: 28,
    weekendDensityScale: 0.52,
    nightDensityScale: 0.22,
    rainDensityScale: 0.72,
  },
  {
    id: 'porto',
    zoneId: 'porto',
    name: 'Marina & Píer Sul',
    subtitle: 'Docas, guindastes, contêineres e capitania',
    mapColor: '#2d4c6b',
    groundHex: 0x2b394a,
    accentHex: 0xf59e0b,
    roofStyle: 'sawtooth',
    visualTheme: 'harbor_marina',
    minX: -20,
    maxX: 78,
    minZ: 125,
    maxZ: 280,
    baseMaxNpcDensity: 16,
    weekendDensityScale: 1.0,
    nightDensityScale: 0.35,
    rainDensityScale: 0.6,
  },
  {
    id: 'industrial',
    zoneId: 'industrial',
    name: 'Setor Industrial & Armazéns',
    subtitle: 'Galpões, silos metálicos, fundição e oficinas',
    mapColor: '#333d4f',
    groundHex: 0x2d323e,
    accentHex: 0xff8c38,
    roofStyle: 'sawtooth',
    visualTheme: 'industrial_warehouse',
    minX: -280,
    maxX: -140,
    minZ: -214,
    maxZ: 58,
    baseMaxNpcDensity: 14,
    weekendDensityScale: 0.45,
    nightDensityScale: 0.24,
    rainDensityScale: 0.78,
  },
  {
    id: 'heliponto',
    zoneId: 'heliponto',
    name: 'Heliponto & Terminal Aéreo',
    subtitle: 'Pátio de aeronaves, hangar e torre de controle',
    mapColor: '#374759',
    groundHex: 0x222733,
    accentHex: 0x38bdf8,
    roofStyle: 'dome',
    visualTheme: 'airfield_helipad',
    minX: -280,
    maxX: -20,
    minZ: 208,
    maxZ: 280,
    baseMaxNpcDensity: 10,
    weekendDensityScale: 0.85,
    nightDensityScale: 0.3,
    rainDensityScale: 0.55,
  },
];

const DISTRICT_BY_ID = new Map<DistrictId, DistrictSpec>(DISTRICTS.map((d) => [d.id, d]));

export const MISSION_POINTS = {
  m1Trigger: { x: -42, z: -24 },
  m1CarSpawn: { x: -34, z: -18, heading: Math.PI / 2 },
  m1Dropoff: { x: 52, z: 130 }, // Marina do Píer Sul
  m2Trigger: { x: 4, z: -22 },
  m2Briefcase: { x: getCoastlineX(-96) + 8, z: -96 }, // Quiosque na Ponta Norte da Praia
  m2Dropoff: { x: 4, z: -22 }, // Hotel Neon
};

export const WORLD_POIS = {
  benches: [
    { x: getCoastlineX(-100) - 5.2, z: -100, yaw: Math.PI / 2, seatX: getCoastlineX(-100) - 5.5, seatZ: -100 },
    { x: getCoastlineX(24) - 5.2, z: 24, yaw: Math.PI / 2, seatX: getCoastlineX(24) - 5.5, seatZ: 24 },
    { x: getCoastlineX(160) - 5.2, z: 160, yaw: Math.PI / 2, seatX: getCoastlineX(160) - 5.5, seatZ: 160 },
    { x: -36, z: -44, yaw: 0, seatX: -36, seatZ: -43.8 },
    { x: -50, z: -232, yaw: 0, seatX: -50, seatZ: -231.5 }, // Banco no Parque Atlântico
    { x: 14, z: -224, yaw: Math.PI, seatX: 14, seatZ: -224.5 }, // Banco na praça do Campus
    { x: -24, z: 96, yaw: Math.PI / 2, seatX: -24.4, seatZ: 96 }, // Banco no Centro Histórico
  ],
  stalls: [
    { x: getCoastlineX(-24) - 5.2, z: -24, customerX: getCoastlineX(-24) - 7.6, customerZ: -24, yaw: Math.PI / 2, color: 0xff2e93 },
    { x: getCoastlineX(-52) + 8.0, z: -52, customerX: getCoastlineX(-52) + 5.6, customerZ: -52, yaw: -Math.PI / 2, color: 0x16f2d4 },
    { x: -64.0, z: -42, customerX: -64.0, customerZ: -39.5, yaw: 0, color: 0xff8c38 },
    { x: -28.0, z: 88, customerX: -28.0, customerZ: 90.5, yaw: 0, color: 0xfbbf24 },
  ],
  busStops: [
    {
      x: getCoastalRoadX(28) + 8.8,
      z: 28,
      waitX: getCoastalRoadX(28) + 10.4,
      waitZ: 28,
      yaw: -Math.PI / 2,
      roadStopX: getCoastalRoadX(28) + 3.2,
      roadStopZ: 28,
      axis: 'z' as const,
      dir: 1 as const,
      label: 'Orla Maré',
    },
    {
      x: -7.5,
      z: -86,
      waitX: -5.8,
      waitZ: -86,
      yaw: -Math.PI / 2,
      roadStopX: -14.2,
      roadStopZ: -86,
      axis: 'z' as const,
      dir: 1 as const,
      label: 'Alameda Centro',
    },
    {
      x: -152.5,
      z: 34,
      waitX: -154.2,
      waitZ: 34,
      yaw: Math.PI / 2,
      roadStopX: -145.8,
      roadStopZ: 34,
      axis: 'z' as const,
      dir: -1 as const,
      label: 'Av. Palmeiras Sul',
    },
    {
      x: -54,
      z: -107.5,
      waitX: -54,
      waitZ: -105.8,
      yaw: Math.PI,
      roadStopX: -54,
      roadStopZ: -114.2,
      axis: 'x' as const,
      dir: 1 as const,
      label: 'Av. Atlântica Norte',
    },
  ],
  volleyballCenter: { x: getCoastlineX(14) + 10, z: 14 },
  nightBars: [
    { x: -36, z: 22, color: 0xff7b29 },
    { x: 10, z: 24, color: 0xff2e93 },
    { x: 2, z: 84, color: 0xfbbf24 },
  ],
};

export const BUILDINGS_CATALOG: BuildingSpec[] = [
  // Zona Industrial & Armazéns (Oeste)
  { id: 'bld_0', label: 'Fundição Solara', blockId: 'blk_nw_far', districtId: 'industrial', category: 'workplace', x: -248, z: -165, w: 28, d: 24, h: 14, wallHex: '#2c354f', winHex: '#ffbe76', neonHex: 0xff8c38, roofStyle: 'sawtooth' },
  { id: 'bld_1', label: 'Depósito Oeste', blockId: 'blk_w_mid', districtId: 'industrial', category: 'workplace', x: -178, z: -165, w: 30, d: 22, h: 13, wallHex: '#2a3752', winHex: '#7ef9ff', neonHex: 0x00e5ff, roofStyle: 'sawtooth' },
  { id: 'bld_6', label: 'Galpão Porto Seco', blockId: 'blk_cw', districtId: 'industrial', category: 'workplace', x: -195, z: -90, w: 18, d: 22, h: 13, wallHex: '#2d3a58', winHex: '#ffbe76', neonHex: 0xff8c38, roofStyle: 'sawtooth' },
  { id: 'bld_7', label: 'Oficina Central Solara', blockId: 'blk_ind_sw', districtId: 'industrial', category: 'workplace', x: -178, z: 32, w: 24, d: 20, h: 12, wallHex: '#313a54', winHex: '#ffd166', neonHex: 0xff7b29, roofStyle: 'sawtooth' },

  // Polo Comercial & Shopping
  { id: 'bld_2', label: 'Torre Comércio Solara', blockId: 'blk_nw', districtId: 'comercial', category: 'home', x: -110, z: -90, w: 22, d: 20, h: 25, wallHex: '#3c295c', winHex: '#ff9de2', neonHex: 0xff2e93, roofStyle: 'flat' },
  { id: 'bld_26', label: 'Shopping Atlântico Solara', blockId: 'blk_shop', districtId: 'comercial', category: 'workplace', x: -110, z: -32, w: 30, d: 26, h: 14, wallHex: '#432e68', winHex: '#f9a8d4', neonHex: 0xf472b6, roofStyle: 'dome' },

  // Parque Atlântico
  { id: 'bld_3', label: 'Residencial Brisa', blockId: 'blk_n', districtId: 'parque', category: 'home', x: -50, z: -165, w: 26, d: 20, h: 20, wallHex: '#2f355e', winHex: '#7ef9ff', neonHex: 0x00f5d4, roofStyle: 'flat' },
  { id: 'bld_5', label: 'Condomínio Parque', blockId: 'blk_n_far', districtId: 'parque', category: 'home', x: -110, z: -242, w: 24, d: 18, h: 19, wallHex: '#2d3b5e', winHex: '#9bf6ff', neonHex: 0x16f2d4, roofStyle: 'flat' },

  // Campus Universidade Solara
  { id: 'bld_4', label: 'Instituto de Ciências Solara', blockId: 'blk_ne', districtId: 'campus', category: 'workplace', x: 10, z: -168, w: 24, d: 22, h: 19, wallHex: '#4b5568', winHex: '#fde68a', neonHex: 0x34d399, roofStyle: 'classic' },
  { id: 'bld_25', label: 'Reitoria & Biblioteca Solara', blockId: 'blk_campus_main', districtId: 'campus', category: 'workplace', x: 16, z: -246, w: 28, d: 22, h: 16, wallHex: '#596375', winHex: '#fef3c7', neonHex: 0x2dd4bf, roofStyle: 'classic' },

  // Centro Financeiro Neon
  { id: 'bld_8', label: 'Delegacia & Garagem', blockId: 'blk_cc', districtId: 'centro', category: 'workplace', x: -52, z: -90, w: 22, d: 18, h: 15, wallHex: '#3c2b56', winHex: '#8ef9f3', neonHex: 0xff3b9a, roofStyle: 'flat' },
  { id: 'bld_9', label: 'Hotel Financeiro Neon', blockId: 'blk_ce', districtId: 'centro', category: 'workplace', x: 4, z: -90, w: 20, d: 20, h: 31, wallHex: '#3b2048', winHex: '#ff9ff3', neonHex: 0xff2a85, roofStyle: 'flat' },
  { id: 'bld_10', label: 'Torre Central Plaza', blockId: 'blk_cw_mid', districtId: 'centro', category: 'workplace', x: -52, z: -43.5, w: 22, d: 13, h: 27, wallHex: '#2f2957', winHex: '#7ef9ff', neonHex: 0x00e5ff, roofStyle: 'flat' },
  { id: 'bld_11', label: 'Clube Flamingo', blockId: 'blk_sc_mid', districtId: 'centro', category: 'bar', x: -38, z: 34, w: 12, d: 20, h: 17, wallHex: '#4b2d52', winHex: '#ffbe76', neonHex: 0xff7b29, roofStyle: 'flat' },
  { id: 'bld_12', label: 'Cassino Maré', blockId: 'blk_se_mid', districtId: 'centro', category: 'bar', x: 4, z: 34, w: 18, d: 22, h: 24, wallHex: '#312c59', winHex: '#ff8cd9', neonHex: 0xff3b9a, roofStyle: 'dome' },
  { id: 'bld_13', label: 'Edifício Orla Sol', blockId: 'blk_ce_coast', districtId: 'centro', category: 'workplace', x: 46, z: 34, w: 16, d: 20, h: 21, wallHex: '#3c2a5e', winHex: '#7ef9ff', neonHex: 0x16f2d4, roofStyle: 'flat' },

  // Centro Histórico de Solara
  { id: 'bld_27', label: 'Igreja & Museu de Solara', blockId: 'blk_hist_w', districtId: 'historico', category: 'workplace', x: -52, z: 96, w: 22, d: 22, h: 15, wallHex: '#b38b6d', winHex: '#fde68a', neonHex: 0xfbbf24, roofStyle: 'gable' },
  { id: 'bld_28', label: 'Casarão Imperial', blockId: 'blk_hist_c', districtId: 'historico', category: 'bar', x: 2, z: 96, w: 18, d: 20, h: 11, wallHex: '#9d6b53', winHex: '#fef08a', neonHex: 0xf59e0b, roofStyle: 'gable' },
  { id: 'bld_29', label: 'Mercado das Artes', blockId: 'blk_hist_e', districtId: 'historico', category: 'workplace', x: 46, z: 96, w: 18, d: 20, h: 10, wallHex: '#8d5b4c', winHex: '#fde68a', neonHex: 0xfbbf24, roofStyle: 'gable' },

  // Bairro Brisa Sul (Residencial Vertical)
  { id: 'bld_14', label: 'Plaza Atlântico', blockId: 'blk_sw_mid', districtId: 'residencial', category: 'workplace', x: -110, z: 32, w: 24, d: 22, h: 22, wallHex: '#283655', winHex: '#70e4ff', neonHex: 0x00e5ff, roofStyle: 'flat' },
  { id: 'bld_17', label: 'Edifício Coral', blockId: 'blk_sc', districtId: 'residencial', category: 'home', x: -110, z: 190, w: 22, d: 14, h: 24, wallHex: '#472852', winHex: '#ffd166', neonHex: 0xff477e, roofStyle: 'flat' },
  { id: 'bld_18', label: 'Vila das Palmeiras', blockId: 'blk_sc_2', districtId: 'residencial', category: 'home', x: -50, z: 168, w: 22, d: 22, h: 18, wallHex: '#2d3b5c', winHex: '#8ef9f3', neonHex: 0x00f5d4, roofStyle: 'flat' },

  // Subúrbio Jardim Atlântico (Casas com telhados)
  { id: 'bld_15', label: 'Residência Jardim Sul', blockId: 'blk_sub_1', districtId: 'suburbio', category: 'home', x: -178, z: 98, w: 18, d: 16, h: 8, wallHex: '#596b5e', winHex: '#fef08a', neonHex: 0x4ade80, roofStyle: 'gable' },
  { id: 'bld_16', label: 'Casa Horizonte', blockId: 'blk_sub_2', districtId: 'suburbio', category: 'home', x: -246, z: 168, w: 18, d: 16, h: 8.5, wallHex: '#6c5d53', winHex: '#fde68a', neonHex: 0x4ade80, roofStyle: 'gable' },
  { id: 'bld_30', label: 'Casa das Brisas', blockId: 'blk_sub_3', districtId: 'suburbio', category: 'home', x: -246, z: 98, w: 18, d: 16, h: 8, wallHex: '#4f6272', winHex: '#fef9c3', neonHex: 0x2dd4bf, roofStyle: 'gable' },
  { id: 'bld_31', label: 'Sobrado Enseada', blockId: 'blk_sub_4', districtId: 'suburbio', category: 'home', x: -178, z: 168, w: 18, d: 16, h: 9, wallHex: '#70584c', winHex: '#fde68a', neonHex: 0xfbbf24, roofStyle: 'gable' },

  // Morro da Brisa (Comunidade em terraços elevados)
  { id: 'bld_21', label: 'Casa Pedra Azul', blockId: 'blk_morro_1', districtId: 'morro', category: 'home', x: -226, z: -238, w: 12, d: 11, h: 6.5, wallHex: '#35608a', winHex: '#ffe29a', neonHex: 0x38bdf8, roofStyle: 'terrace', baseY: 3.2 },
  { id: 'bld_22', label: 'Laje do Mirante', blockId: 'blk_morro_2', districtId: 'morro', category: 'home', x: -182, z: -238, w: 13, d: 11, h: 7.2, wallHex: '#a3483b', winHex: '#ffd166', neonHex: 0xf59e0b, roofStyle: 'terrace', baseY: 3.2 },
  { id: 'bld_23', label: 'Barracão Alto da Brisa', blockId: 'blk_morro_3', districtId: 'morro', category: 'home', x: -226, z: -266, w: 13, d: 11, h: 6.8, wallHex: '#8d5b3e', winHex: '#fef08a', neonHex: 0xf97316, roofStyle: 'terrace', baseY: 6.6 },
  { id: 'bld_24', label: 'Vila Estrela do Morro', blockId: 'blk_morro_4', districtId: 'morro', category: 'bar', x: -182, z: -266, w: 12, d: 11, h: 7.5, wallHex: '#2f6d63', winHex: '#fde047', neonHex: 0x2dd4bf, roofStyle: 'terrace', baseY: 6.6 },

  // Marina & Píer Sul
  { id: 'bld_19', label: 'Capitania Marina', blockId: 'blk_se', districtId: 'porto', category: 'workplace', x: 42, z: 168, w: 20, d: 20, h: 15, wallHex: '#35325c', winHex: '#8ef9f3', neonHex: 0xff9f1c, roofStyle: 'sawtooth' },
  { id: 'bld_20', label: 'Mirante da Enseada', blockId: 'blk_se_far', districtId: 'porto', category: 'home', x: 14, z: 235, w: 24, d: 20, h: 21, wallHex: '#382a54', winHex: '#ffd166', neonHex: 0xff477e, roofStyle: 'flat' },

  // Heliponto & Terminal Aéreo
  { id: 'bld_32', label: 'Hangar Aéreo Solara', blockId: 'blk_heli_w', districtId: 'heliponto', category: 'workplace', x: -248, z: 234, w: 26, d: 20, h: 12, wallHex: '#2d3b4e', winHex: '#bae6fd', neonHex: 0x38bdf8, roofStyle: 'dome' },
  { id: 'bld_33', label: 'Torre de Controle Aéreo', blockId: 'blk_heli_e', districtId: 'heliponto', category: 'workplace', x: -102, z: 234, w: 14, d: 14, h: 24, wallHex: '#36455a', winHex: '#7dd3fc', neonHex: 0x0ea5e9, roofStyle: 'dome' },
];

export const CORE_POIS: WorldPoiSpec[] = [
  // Serviços Públicos
  { id: 'poi_hospital', name: 'Hospital Santa Maré', category: 'hospital', districtId: 'residencial', x: -110, z: 32, entryX: -96, entryZ: 32 },
  { id: 'poi_police', name: 'Delegacia Central Solara', category: 'police', districtId: 'centro', x: -52, z: -90, entryX: -39, entryZ: -90 },

  // Lojas e Serviços
  { id: 'shop_clothing', name: 'Boutique Sol & Estilo', category: 'shop_clothing', districtId: 'centro', x: 4, z: -78, entryX: 4, entryZ: -74, openHour: 7, closeHour: 22 },
  { id: 'shop_barber', name: 'Barbearia Corte Neon', category: 'shop_barber', districtId: 'centro', x: -38, z: 45, entryX: -38, entryZ: 48, openHour: 8, closeHour: 21 },
  { id: 'shop_gun', name: 'Armaria Maré Forte', category: 'shop_gun', districtId: 'industrial', x: -186, z: -90, entryX: -183, entryZ: -90, openHour: 6, closeHour: 23 },
  { id: 'shop_workshop', name: 'Oficina & Custom Solara', category: 'shop_workshop', districtId: 'industrial', x: -178, z: 45, entryX: -178, entryZ: 49, openHour: 0, closeHour: 24 },
  { id: 'shop_market', name: 'Mercado Solara 24h', category: 'shop_market', districtId: 'parque', x: -50, z: -152, entryX: -50, entryZ: -148, openHour: 0, closeHour: 24 },
  { id: 'shop_dealership', name: 'Concessionária Atlântica', category: 'shop_dealership', districtId: 'porto', x: 42, z: 155, entryX: 42, entryZ: 151, openHour: 8, closeHour: 20 },

  // Paradas de ônibus
  ...WORLD_POIS.busStops.map((bs, idx) => ({
    id: `bus_stop_${idx}`,
    name: bs.label,
    category: 'bus_stop' as const,
    districtId: (bs.x > 40 ? 'praia' : bs.x < -140 ? 'industrial' : 'centro') as DistrictId,
    x: bs.x,
    z: bs.z,
    entryX: bs.waitX,
    entryZ: bs.waitZ,
    yaw: bs.yaw,
    roadStopX: bs.roadStopX,
    roadStopZ: bs.roadStopZ,
    axis: bs.axis,
    dir: bs.dir,
  })),

  // Bares noturnos
  ...WORLD_POIS.nightBars.map((bar, idx) => ({
    id: `bar_${idx}`,
    name: idx === 0 ? 'Bar Flamingo Lounge' : idx === 1 ? 'Bar Maré Neon' : 'Taberna Colonial',
    category: 'bar' as const,
    districtId: (idx === 2 ? 'historico' : 'centro') as DistrictId,
    x: bar.x,
    z: bar.z,
    entryX: bar.x,
    entryZ: bar.z + 2.2,
    colorHex: bar.color,
    openHour: 18,
    closeHour: 4,
  })),

  // Barracas e Vôlei
  ...WORLD_POIS.stalls.map((st, idx) => ({
    id: `stall_${idx}`,
    name: `Barraca Orla ${idx + 1}`,
    category: 'stall' as const,
    districtId: (st.x >= getCoastlineX(st.z) - 27 ? 'praia' : st.z >= 56 ? 'historico' : 'centro') as DistrictId,
    x: st.x,
    z: st.z,
    entryX: st.customerX,
    entryZ: st.customerZ,
    yaw: st.yaw,
    colorHex: st.color,
  })),

  {
    id: 'volleyball_main',
    name: 'Quadra da Praia',
    category: 'volleyball',
    districtId: 'praia',
    x: WORLD_POIS.volleyballCenter.x,
    z: WORLD_POIS.volleyballCenter.z,
    entryX: WORLD_POIS.volleyballCenter.x - 2.6,
    entryZ: WORLD_POIS.volleyballCenter.z,
  },
];

export const COVER_POINTS: CoverPointSpec[] = [
  { id: 'cov_seawall_n', districtId: 'praia', x: getCoastlineX(-80) - 2.0, z: -80, normalX: -1, normalZ: 0, kind: 'seawall' },
  { id: 'cov_seawall_s', districtId: 'praia', x: getCoastlineX(48) - 2.0, z: 48, normalX: -1, normalZ: 0, kind: 'seawall' },
  { id: 'cov_hotel_corner', districtId: 'centro', x: -7.0, z: -79.5, normalX: -1, normalZ: 1, kind: 'wall' },
  { id: 'cov_casino_corner', districtId: 'centro', x: -5.5, z: 22.5, normalX: -1, normalZ: -1, kind: 'wall' },
  { id: 'cov_police_corner', districtId: 'centro', x: -40.0, z: -80.5, normalX: 1, normalZ: 1, kind: 'wall' },
  { id: 'cov_plaza_corner', districtId: 'residencial', x: -97.5, z: 20.5, normalX: 1, normalZ: -1, kind: 'wall' },
  { id: 'cov_kiosk_n', districtId: 'praia', x: getCoastlineX(-96) + 5.2, z: -96, normalX: -1, normalZ: 0, kind: 'kiosk' },
  { id: 'cov_marina_wall', districtId: 'porto', x: 31.5, z: 157.5, normalX: -1, normalZ: -1, kind: 'wall' },
  { id: 'cov_shopping_corner', districtId: 'comercial', x: -94.0, z: -18.5, normalX: 1, normalZ: 1, kind: 'wall' },
  { id: 'cov_historico_arch', districtId: 'historico', x: -40.0, z: 84.5, normalX: 1, normalZ: -1, kind: 'wall' },
];

export const EVENT_SPAWNS: EventSpawnSpec[] = [
  { id: 'evt_orla_norte', districtId: 'praia', x: getCoastlineX(-80) - 6, z: -80, kind: 'beach' },
  { id: 'evt_orla_sul', districtId: 'praia', x: getCoastlineX(40) - 6, z: 40, kind: 'beach' },
  { id: 'evt_centro_1', districtId: 'centro', x: -20, z: -48, kind: 'road' },
  { id: 'evt_centro_2', districtId: 'centro', x: 10, z: 0, kind: 'sidewalk' },
  { id: 'evt_centro_3', districtId: 'centro', x: -50, z: 24, kind: 'plaza' },
  { id: 'evt_comercial_1', districtId: 'comercial', x: -95, z: -32, kind: 'plaza' },
  { id: 'evt_historico_1', districtId: 'historico', x: -25, z: 96, kind: 'plaza' },
  { id: 'evt_porto_1', districtId: 'porto', x: 24, z: 130, kind: 'road' },
  { id: 'evt_porto_2', districtId: 'porto', x: getCoastlineX(130) - 8, z: 130, kind: 'plaza' },
  { id: 'evt_res_1', districtId: 'residencial', x: -110, z: 85, kind: 'sidewalk' },
  { id: 'evt_sub_1', districtId: 'suburbio', x: -215, z: 130, kind: 'sidewalk' },
  { id: 'evt_morro_1', districtId: 'morro', x: -202, z: -238, kind: 'plaza' },
  { id: 'evt_ind_1', districtId: 'industrial', x: -178, z: -60, kind: 'road' },
  { id: 'evt_parque_1', districtId: 'parque', x: -50, z: -235, kind: 'plaza' },
  { id: 'evt_campus_1', districtId: 'campus', x: 14, z: -220, kind: 'plaza' },
  { id: 'evt_heli_1', districtId: 'heliponto', x: -188, z: 246, kind: 'plaza' },
];

/**
 * Fonte única de verdade para limites do mundo, malha viária baseada em StreetSpec,
 * curva costeira, elevação do Morro, 12 distritos com identidade própria, interseções, prédios e POIs.
 */
export class WorldRegistry {
  public static readonly bounds = WORLD_BOUNDS;
  public static readonly districts = DISTRICTS;
  public static readonly streets = STREETS;
  public static readonly intersections = INTERSECTIONS;
  public static readonly crosswalks = CROSSWALKS;
  public static readonly signals = TRAFFIC_SIGNALS;
  public static readonly buildings = BUILDINGS_CATALOG;
  public static readonly pois = CORE_POIS;
  public static readonly coverPoints = COVER_POINTS;
  public static readonly eventSpawns = EVENT_SPAWNS;
  public static readonly missionPoints = MISSION_POINTS;

  public static readonly canal = CANAL_SPEC;
  public static readonly bridges = CANAL_BRIDGES;
  public static readonly viaduct = VIADUTO_SPEC;
  public static readonly tunnel = TUNEL_SPEC;
  public static readonly softHills = SOFT_HILLS;
  public static readonly islands = OFFSHORE_ISLANDS;

  public static getCoastlineX(z: number): number {
    return getCoastlineX(z);
  }

  public static getCoastalRoadX(z: number): number {
    return getCoastalRoadX(z);
  }

  public static getMorroElevation(x: number, z: number): number {
    return getMorroElevation(x, z);
  }

  public static getTerrainHeightAt(x: number, z: number, currentY = 0): number {
    return getTerrainHeightAt(x, z, currentY);
  }

  public static resolveInfrastructureCollisions(pos: { x: number; y: number; z: number }, radius: number): boolean {
    return resolveInfrastructureCollisions(pos, radius);
  }

  public static getDistrictById(id: DistrictId): DistrictSpec {
    return DISTRICT_BY_ID.get(id) ?? DISTRICTS[1];
  }

  public static getDistrictAt(x: number, z: number): DistrictSpec {
    if (x >= getCoastlineX(z) - 27) return DISTRICT_BY_ID.get('praia')!;
    if (z < -214 && x < -148) return DISTRICT_BY_ID.get('morro')!;
    if (z < -130 && x < -20) return DISTRICT_BY_ID.get('parque')!;
    if (z < -130) return DISTRICT_BY_ID.get('campus')!;
    if (z >= 208 && x < -20) return DISTRICT_BY_ID.get('heliponto')!;
    if (z >= 125 && x >= -20) return DISTRICT_BY_ID.get('porto')!;
    if (z >= 56 && z < 125 && x >= -80) return DISTRICT_BY_ID.get('historico')!;
    if (z < 58 && x < -140) return DISTRICT_BY_ID.get('industrial')!;
    if (z >= 58 && x < -140) return DISTRICT_BY_ID.get('suburbio')!;
    if (z < 0 && x >= -140 && x < -80) return DISTRICT_BY_ID.get('comercial')!;
    if (z >= -130 && z < 56 && x >= -80) return DISTRICT_BY_ID.get('centro')!;
    return DISTRICT_BY_ID.get('residencial')!;
  }

  public static getStreetAt(x: number, z: number): StreetSpec | null {
    let best: StreetSpec | null = null;
    let bestDistSq = Infinity;

    for (const s of STREETS) {
      if (s.kind === 'roundabout' && s.roundabout) {
        const dCenter = Math.hypot(x - s.roundabout.centerX, z - s.roundabout.centerZ);
        if (dCenter >= s.roundabout.innerRadius - 1.5 && dCenter <= s.roundabout.outerRadius + 3.5) {
          const ringMid = (s.roundabout.innerRadius + s.roundabout.outerRadius) * 0.5;
          const d2 = (dCenter - ringMid) ** 2;
          if (d2 < bestDistSq) {
            bestDistSq = d2;
            best = s;
          }
        }
        continue;
      }

      const maxD = s.width * 0.65 + 1.5;
      const maxD2 = maxD * maxD;
      for (const seg of s.segments) {
        const d2 = pointToSegmentDistSq(x, z, seg.x1, seg.z1, seg.x2, seg.z2);
        if (d2 <= maxD2 && d2 < bestDistSq) {
          bestDistSq = d2;
          best = s;
        }
      }
    }
    return best;
  }

  public static isPointOnRoad(x: number, z: number, margin = 0, includeMedian = false): boolean {
    for (const s of STREETS) {
      if (s.kind === 'roundabout' && s.roundabout) {
        const d = Math.hypot(x - s.roundabout.centerX, z - s.roundabout.centerZ);
        if (d >= s.roundabout.innerRadius - margin && d <= s.roundabout.outerRadius + margin) {
          return true;
        }
        continue;
      }

      const halfW = s.width * 0.5 + margin;
      const halfW2 = halfW * halfW;
      const halfMed2 = !includeMedian && s.medianWidth > 0 ? Math.max(0, s.medianWidth * 0.5 - margin) ** 2 : -1;

      for (const seg of s.segments) {
        const d2 = pointToSegmentDistSq(x, z, seg.x1, seg.z1, seg.x2, seg.z2);
        if (d2 <= halfW2 && d2 > halfMed2) {
          return true;
        }
      }
    }
    return false;
  }

  public static getRoundabouts(): StreetSpec[] {
    return STREETS.filter((s) => s.kind === 'roundabout');
  }

  public static getLocationLabelAt(x: number, z: number): { district: DistrictSpec; streetName: string } {
    const district = WorldRegistry.getDistrictAt(x, z);
    const street = WorldRegistry.getStreetAt(x, z);
    return {
      district,
      streetName: street ? street.name : district.subtitle,
    };
  }

  public static getPoisByCategory(category: WorldPoiCategory): WorldPoiSpec[] {
    return CORE_POIS.filter((p) => p.category === category);
  }

  public static getShops(): WorldPoiSpec[] {
    return CORE_POIS.filter((p) => p.category.startsWith('shop_'));
  }

  public static isShopOpen(poi: WorldPoiSpec, gameTime: number): boolean {
    if (poi.openHour === undefined || poi.closeHour === undefined) return true;
    const h = ((gameTime % 24) + 24) % 24;
    if (poi.openHour === 0 && poi.closeHour === 24) return true;
    if (poi.openHour < poi.closeHour) {
      return h >= poi.openHour && h < poi.closeHour;
    }
    return h >= poi.openHour || h < poi.closeHour;
  }

  public static getCoverPointsNear(x: number, z: number, radius = 35): CoverPointSpec[] {
    const r2 = radius * radius;
    return COVER_POINTS.filter((c) => (c.x - x) ** 2 + (c.z - z) ** 2 <= r2);
  }

  public static getEventSpawnsInDistrict(districtId: DistrictId): EventSpawnSpec[] {
    return EVENT_SPAWNS.filter((e) => e.districtId === districtId);
  }
}
