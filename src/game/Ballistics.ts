import {
  BALLISTICS_RICOCHET_ENERGY_RETENTION,
  BALLISTICS_RICOCHET_MAX_ANGLE_RAD,
} from './config';
import { PedestrianAI } from './PedestrianAI';
import { BuildingCollider, VehicleEntity } from './types';

export type HitRegion = 'head' | 'torso' | 'limb';
export type BallisticHitKind = 'none' | 'world' | 'terrain' | 'vehicle' | 'npc';
export type ProjectileOwnerKind = 'player' | 'police' | 'npc';

export interface BallisticProjectile {
  active: boolean;
  ownerKind: ProjectileOwnerKind;
  weaponId: string;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  gravity: number;
  drag: number;
  damage: number;
  headshotMul: number;
  limbMul: number;
  falloffStart: number;
  falloffMinMul: number;
  impulseStrength: number;
  traveled: number;
  maxRange: number;
  age: number;
  maxLife: number;
  ricocheted: boolean;
  tracerColorHex: number;
  hasTracer?: boolean;
  flybyPlayed?: boolean;
}

export interface BallisticHitResult {
  hit: boolean;
  kind: BallisticHitKind;
  t: number;
  distance: number;
  x: number;
  y: number;
  z: number;
  nx: number;
  ny: number;
  nz: number;
  region: HitRegion;
  targetIndex: number;
  targetId: string;
}

/**
 * Grade espacial 2D para prédios (BuildingCollider), evitando varredura O(N)
 * a cada subpasso de projétil ou raycast da câmera. Zero alocações por consulta.
 */
export class BuildingSpatialGrid {
  private readonly cellSize: number;
  private buildings: ReadonlyArray<BuildingCollider>;
  private readonly cells = new Map<number, number[]>();
  private visitedStamp: Uint32Array;
  private stampCursor = 1;

  constructor(buildings: ReadonlyArray<BuildingCollider>, cellSize = 32) {
    this.buildings = buildings;
    this.cellSize = Math.max(8, cellSize);
    this.visitedStamp = new Uint32Array(Math.max(1, buildings.length));
    this.rebuild(buildings);
  }

  private packCell(cx: number, cz: number): number {
    return (cx + 4096) * 8192 + (cz + 4096);
  }

  public rebuild(buildings: ReadonlyArray<BuildingCollider>): void {
    this.buildings = buildings;
    this.cells.clear();
    if (this.visitedStamp.length < buildings.length) {
      this.visitedStamp = new Uint32Array(buildings.length);
    }
    const inv = 1 / this.cellSize;
    for (let i = 0; i < buildings.length; i++) {
      const b = buildings[i];
      const minCx = Math.floor((b.x - b.halfW - 0.5) * inv);
      const maxCx = Math.floor((b.x + b.halfW + 0.5) * inv);
      const minCz = Math.floor((b.z - b.halfD - 0.5) * inv);
      const maxCz = Math.floor((b.z + b.halfD + 0.5) * inv);
      for (let cx = minCx; cx <= maxCx; cx++) {
        for (let cz = minCz; cz <= maxCz; cz++) {
          const key = this.packCell(cx, cz);
          let list = this.cells.get(key);
          if (!list) {
            list = [];
            this.cells.set(key, list);
          }
          list.push(i);
        }
      }
    }
  }

  public querySegment(x0: number, z0: number, x1: number, z1: number, outIndices: number[]): number[] {
    outIndices.length = 0;
    if (this.buildings.length === 0) return outIndices;

    this.stampCursor++;
    if (this.stampCursor >= 0xfffffff0) {
      this.visitedStamp.fill(0);
      this.stampCursor = 1;
    }
    const stamp = this.stampCursor;

    const inv = 1 / this.cellSize;
    let cx = Math.floor(x0 * inv);
    let cz = Math.floor(z0 * inv);
    const endCx = Math.floor(x1 * inv);
    const endCz = Math.floor(z1 * inv);

    const dx = x1 - x0;
    const dz = z1 - z0;
    const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
    const stepZ = dz > 0 ? 1 : dz < 0 ? -1 : 0;

    const tDeltaX = stepX !== 0 ? this.cellSize / Math.abs(dx) : Number.POSITIVE_INFINITY;
    const tDeltaZ = stepZ !== 0 ? this.cellSize / Math.abs(dz) : Number.POSITIVE_INFINITY;

    const nextBoundX = (cx + (stepX > 0 ? 1 : 0)) * this.cellSize;
    const nextBoundZ = (cz + (stepZ > 0 ? 1 : 0)) * this.cellSize;
    let tMaxX = stepX !== 0 ? Math.abs((nextBoundX - x0) / dx) : Number.POSITIVE_INFINITY;
    let tMaxZ = stepZ !== 0 ? Math.abs((nextBoundZ - z0) / dz) : Number.POSITIVE_INFINITY;

    const maxSteps = Math.min(256, Math.abs(endCx - cx) + Math.abs(endCz - cz) + 4);
    for (let s = 0; s < maxSteps; s++) {
      const list = this.cells.get(this.packCell(cx, cz));
      if (list) {
        for (let i = 0; i < list.length; i++) {
          const bIdx = list[i];
          if (this.visitedStamp[bIdx] !== stamp) {
            this.visitedStamp[bIdx] = stamp;
            outIndices.push(bIdx);
          }
        }
      }

      if (cx === endCx && cz === endCz) break;

      if (tMaxX < tMaxZ) {
        tMaxX += tDeltaX;
        cx += stepX;
      } else {
        tMaxZ += tDeltaZ;
        cz += stepZ;
      }
    }

    return outIndices;
  }
}

export function createEmptyBallisticHit(): BallisticHitResult {
  return {
    hit: false,
    kind: 'none',
    t: 1,
    distance: 0,
    x: 0,
    y: 0,
    z: 0,
    nx: 0,
    ny: 1,
    nz: 0,
    region: 'torso',
    targetIndex: -1,
    targetId: '',
  };
}

export function resetBallisticHit(out: BallisticHitResult): void {
  out.hit = false;
  out.kind = 'none';
  out.t = 1;
  out.distance = 0;
  out.x = 0;
  out.y = 0;
  out.z = 0;
  out.nx = 0;
  out.ny = 1;
  out.nz = 0;
  out.region = 'torso';
  out.targetIndex = -1;
  out.targetId = '';
}

/**
 * Avança velocidade e posição de um projétil por dt usando gravidade + arrasto linear,
 * acumulando distância percorrida e tempo de vida.
 */
export function advanceProjectileStep(
  p: BallisticProjectile,
  dt: number,
  outNext: { x: number; y: number; z: number }
): number {
  const dragFactor = Math.max(0, 1 - p.drag * dt);
  p.vx *= dragFactor;
  p.vy = (p.vy - p.gravity * dt) * dragFactor;
  p.vz *= dragFactor;

  const dx = p.vx * dt;
  const dy = p.vy * dt;
  const dz = p.vz * dt;
  outNext.x = p.x + dx;
  outNext.y = p.y + dy;
  outNext.z = p.z + dz;

  const segLen = Math.hypot(dx, dy, dz);
  p.traveled += segLen;
  p.age += dt;
  return segLen;
}

export function computeDistanceDamageFalloff(
  distance: number,
  falloffStart: number,
  maxRange: number,
  minMul: number
): number {
  if (distance <= falloffStart || maxRange <= falloffStart) return 1.0;
  const t = Math.min(1, Math.max(0, (distance - falloffStart) / (maxRange - falloffStart)));
  return 1.0 - t * (1.0 - minMul);
}

/**
 * Distribuição uniforme no disco do cone de espalhamento usando r = R * sqrt(u).
 */
export function computeSpreadDirection(
  dirX: number,
  dirY: number,
  dirZ: number,
  spreadRad: number,
  randAngle: number,
  randMag: number,
  outDir: { x: number; y: number; z: number }
): void {
  if (spreadRad <= 1e-6) {
    outDir.x = dirX;
    outDir.y = dirY;
    outDir.z = dirZ;
    return;
  }

  let upX = 0;
  let upY = 1;
  let upZ = 0;
  if (Math.abs(dirY) > 0.96) {
    upX = 1;
    upY = 0;
    upZ = 0;
  }

  let rx = dirY * upZ - dirZ * upY;
  let ry = dirZ * upX - dirX * upZ;
  let rz = dirX * upY - dirY * upX;
  const rLen = Math.hypot(rx, ry, rz) || 1;
  rx /= rLen;
  ry /= rLen;
  rz /= rLen;

  const ux = ry * dirZ - rz * dirY;
  const uy = rz * dirX - rx * dirZ;
  const uz = rx * dirY - ry * dirX;

  const r = spreadRad * Math.sqrt(Math.max(0, Math.min(1, randMag)));
  const offR = Math.cos(randAngle) * r;
  const offU = Math.sin(randAngle) * r;

  const fx = dirX + rx * offR + ux * offU;
  const fy = dirY + ry * offR + uy * offU;
  const fz = dirZ + rz * offR + uz * offU;
  const fLen = Math.hypot(fx, fy, fz) || 1;
  outDir.x = fx / fLen;
  outDir.y = fy / fLen;
  outDir.z = fz / fLen;
}

/**
 * Calcula se ocorre ricochete em superfície dura (ângulo rasante < 12°).
 * Se ocorrer, reflete a velocidade do projétil preservando 40% da energia (perde 60%).
 */
export function tryApplyRicochet(
  p: BallisticProjectile,
  hit: BallisticHitResult
): boolean {
  if (p.ricocheted) return false;
  if (hit.kind !== 'world' && hit.kind !== 'vehicle' && hit.kind !== 'terrain') return false;

  const speed = Math.hypot(p.vx, p.vy, p.vz);
  if (speed < 25) return false;

  const vDotN = (p.vx * hit.nx + p.vy * hit.ny + p.vz * hit.nz) / speed;
  if (vDotN >= 0) return false;

  // Ângulo entre o vetor velocidade e o plano da superfície
  const grazingAngle = Math.asin(Math.min(1, Math.abs(vDotN)));
  if (grazingAngle >= BALLISTICS_RICOCHET_MAX_ANGLE_RAD) return false;

  const vn = p.vx * hit.nx + p.vy * hit.ny + p.vz * hit.nz;
  const speedRetention = Math.sqrt(BALLISTICS_RICOCHET_ENERGY_RETENTION);

  p.vx = (p.vx - 2 * vn * hit.nx) * speedRetention;
  p.vy = (p.vy - 2 * vn * hit.ny) * speedRetention;
  p.vz = (p.vz - 2 * vn * hit.nz) * speedRetention;
  p.damage *= BALLISTICS_RICOCHET_ENERGY_RETENTION;
  p.impulseStrength *= BALLISTICS_RICOCHET_ENERGY_RETENTION;
  p.ricocheted = true;

  p.x = hit.x + hit.nx * 0.03;
  p.y = hit.y + hit.ny * 0.03;
  p.z = hit.z + hit.nz * 0.03;
  return true;
}

/**
 * Interseção segmento (p0 -> p1) contra caixa alinhada aos eixos (AABB).
 */
export function intersectSegmentAABB(
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
  minX: number,
  minY: number,
  minZ: number,
  maxX: number,
  maxY: number,
  maxZ: number,
  outNormal: { nx: number; ny: number; nz: number }
): number | null {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const dz = z1 - z0;

  let tMin = 0;
  let tMax = 1;
  let hitNx = 0;
  let hitNy = 0;
  let hitNz = 0;

  // Eixo X
  if (Math.abs(dx) < 1e-8) {
    if (x0 < minX || x0 > maxX) return null;
  } else {
    const inv = 1 / dx;
    let t1 = (minX - x0) * inv;
    let t2 = (maxX - x0) * inv;
    let s = -1;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
      s = 1;
    }
    if (t1 > tMin) {
      tMin = t1;
      hitNx = s;
      hitNy = 0;
      hitNz = 0;
    }
    if (t2 < tMax) tMax = t2;
    if (tMin > tMax) return null;
  }

  // Eixo Y
  if (Math.abs(dy) < 1e-8) {
    if (y0 < minY || y0 > maxY) return null;
  } else {
    const inv = 1 / dy;
    let t1 = (minY - y0) * inv;
    let t2 = (maxY - y0) * inv;
    let s = -1;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
      s = 1;
    }
    if (t1 > tMin) {
      tMin = t1;
      hitNx = 0;
      hitNy = s;
      hitNz = 0;
    }
    if (t2 < tMax) tMax = t2;
    if (tMin > tMax) return null;
  }

  // Eixo Z
  if (Math.abs(dz) < 1e-8) {
    if (z0 < minZ || z0 > maxZ) return null;
  } else {
    const inv = 1 / dz;
    let t1 = (minZ - z0) * inv;
    let t2 = (maxZ - z0) * inv;
    let s = -1;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
      s = 1;
    }
    if (t1 > tMin) {
      tMin = t1;
      hitNx = 0;
      hitNy = 0;
      hitNz = s;
    }
    if (t2 < tMax) tMax = t2;
    if (tMin > tMax) return null;
  }

  outNormal.nx = hitNx;
  outNormal.ny = hitNy;
  outNormal.nz = hitNz;
  return tMin;
}

/**
 * Interseção segmento (p0 -> p1) contra esfera (usada nas pontas da cápsula e cabeça).
 */
export function intersectSegmentSphere(
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
  cx: number,
  cy: number,
  cz: number,
  radius: number,
  outNormal: { nx: number; ny: number; nz: number }
): number | null {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const dz = z1 - z0;
  const fx = x0 - cx;
  const fy = y0 - cy;
  const fz = z0 - cz;

  const a = dx * dx + dy * dy + dz * dz;
  const c = fx * fx + fy * fy + fz * fz - radius * radius;
  if (a < 1e-10) {
    if (c > 0) return null;
    const fLen = Math.hypot(fx, fy, fz) || 1;
    outNormal.nx = fx / fLen;
    outNormal.ny = fy / fLen;
    outNormal.nz = fz / fLen;
    return 0;
  }

  const b = 2 * (fx * dx + fy * dy + fz * dz);
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;

  const sqrtD = Math.sqrt(disc);
  const t0 = (-b - sqrtD) / (2 * a);
  const t1 = (-b + sqrtD) / (2 * a);
  let tHit: number | null = null;
  if (t0 >= 0 && t0 <= 1) tHit = t0;
  else if (t0 < 0 && t1 >= 0) tHit = 0;
  if (tHit === null) return null;

  const nx = x0 + dx * tHit - cx;
  const ny = y0 + dy * tHit - cy;
  const nz = z0 + dz * tHit - cz;
  const nLen = Math.hypot(nx, ny, nz) || 1;
  outNormal.nx = nx / nLen;
  outNormal.ny = ny / nLen;
  outNormal.nz = nz / nLen;
  return tHit;
}

const _sphereTmp = { nx: 0, ny: 1, nz: 0 };

/**
 * Testa segmento contra cápsula vertical de NPC (raio ≈ 0,28*widthScale, altura 1,75*heightScale)
 * + esfera dedicada de cabeça para detecção precisa de headshot e normal exata.
 */
export function intersectSegmentNpcCapsule(
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
  cx: number,
  baseY: number,
  cz: number,
  widthScale: number,
  heightScale: number,
  outRegion: { region: HitRegion; nx: number; ny: number; nz: number }
): number | null {
  const radius = 0.28 * widthScale;
  const height = 1.75 * heightScale;
  const headY = baseY + height - 0.16 * heightScale;
  const headRadius = 0.22 * widthScale;

  let bestT: number | null = null;
  let bestHitY = baseY;

  // 1. Esfera de cabeça (headshot prioritário)
  const tHead = intersectSegmentSphere(x0, y0, z0, x1, y1, z1, cx, headY, cz, headRadius, _sphereTmp);
  if (tHead !== null) {
    bestT = tHead;
    outRegion.region = 'head';
    outRegion.nx = _sphereTmp.nx;
    outRegion.ny = _sphereTmp.ny;
    outRegion.nz = _sphereTmp.nz;
    bestHitY = y0 + (y1 - y0) * tHead;
  }

  // 2. Cápsula corporal (cilindro central + calotas esféricas)
  const capMinY = baseY + radius;
  const capMaxY = Math.max(capMinY + 0.05, baseY + height - radius);
  const dx = x1 - x0;
  const dy = y1 - y0;
  const dz = z1 - z0;
  const fx = x0 - cx;
  const fz = z0 - cz;

  const a = dx * dx + dz * dz;
  const b = 2 * (fx * dx + fz * dz);
  const c = fx * fx + fz * fz - radius * radius;

  if (a > 1e-8) {
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const sqrtD = Math.sqrt(disc);
      const t0 = (-b - sqrtD) / (2 * a);
      const t1 = (-b + sqrtD) / (2 * a);
      const tCand = t0 >= 0 ? t0 : t1 >= 0 ? 0 : -1;
      if (tCand >= 0 && tCand <= 1) {
        const yAt = y0 + dy * tCand;
        if (yAt >= capMinY && yAt <= capMaxY && (bestT === null || tCand < bestT)) {
          bestT = tCand;
          bestHitY = yAt;
          const nx = x0 + dx * tCand - cx;
          const nz = z0 + dz * tCand - cz;
          const nLen = Math.hypot(nx, nz) || 1;
          outRegion.nx = nx / nLen;
          outRegion.ny = 0;
          outRegion.nz = nz / nLen;
        }
      }
    }
  }

  // Calota superior e inferior da cápsula
  const tTop = intersectSegmentSphere(x0, y0, z0, x1, y1, z1, cx, capMaxY, cz, radius, _sphereTmp);
  if (tTop !== null && (bestT === null || tTop < bestT)) {
    bestT = tTop;
    bestHitY = y0 + dy * tTop;
    outRegion.nx = _sphereTmp.nx;
    outRegion.ny = _sphereTmp.ny;
    outRegion.nz = _sphereTmp.nz;
  }

  const tBot = intersectSegmentSphere(x0, y0, z0, x1, y1, z1, cx, capMinY, cz, radius, _sphereTmp);
  if (tBot !== null && (bestT === null || tBot < bestT)) {
    bestT = tBot;
    bestHitY = y0 + dy * tBot;
    outRegion.nx = _sphereTmp.nx;
    outRegion.ny = _sphereTmp.ny;
    outRegion.nz = _sphereTmp.nz;
  }

  if (bestT === null) return null;

  if (tHead === null || bestT < tHead) {
    const relY = (bestHitY - baseY) / Math.max(0.5, height);
    if (relY >= 0.8) outRegion.region = 'head';
    else if (relY >= 0.42) outRegion.region = 'torso';
    else outRegion.region = 'limb';
  }
  return bestT;
}

const _tmpNormal = { nx: 0, ny: 1, nz: 0 };
const _buildingQueryBuf: number[] = [];
const _npcHitTmp: { region: HitRegion; nx: number; ny: number; nz: number } = {
  region: 'torso',
  nx: 0,
  ny: 1,
  nz: 0,
};

export interface BallisticWorldParams {
  buildings: ReadonlyArray<BuildingCollider>;
  buildingGrid?: BuildingSpatialGrid;
  vehicles: ReadonlyArray<VehicleEntity>;
  ignoreVehicleId: string | null;
  agents: ReadonlyArray<PedestrianAI>;
  candidateNpcIndices: ReadonlyArray<number>;
  groundHeightAt: (x: number, z: number, currentY?: number) => number;
}

function computeTerrainNormal(
  x: number,
  z: number,
  y: number,
  groundHeightAt: (x: number, z: number, currentY?: number) => number,
  out: BallisticHitResult
): void {
  const eps = 0.35;
  const hL = groundHeightAt(x - eps, z, y);
  const hR = groundHeightAt(x + eps, z, y);
  const hD = groundHeightAt(x, z - eps, y);
  const hU = groundHeightAt(x, z + eps, y);
  const nx = hL - hR;
  const ny = 2 * eps;
  const nz = hD - hU;
  const len = Math.hypot(nx, ny, nz) || 1;
  out.nx = nx / len;
  out.ny = ny / len;
  out.nz = nz / len;
}

/**
 * Resolve o impacto mais próximo de um segmento 3D contra prédios (via spatial grid),
 * terreno, veículos (OBB) e NPCs (cápsula + esfera de cabeça) sem alocação por chamada.
 */
export function castBallisticSegment(
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
  world: BallisticWorldParams,
  outHit: BallisticHitResult
): BallisticHitResult {
  resetBallisticHit(outHit);
  const segLen = Math.hypot(x1 - x0, y1 - y0, z1 - z0);
  if (segLen < 1e-6) return outHit;

  let bestT = 1.0001;

  // 1. Prédios via Spatial Grid (ou lista direta em mocks simples)
  if (world.buildingGrid) {
    world.buildingGrid.querySegment(x0, z0, x1, z1, _buildingQueryBuf);
    for (let k = 0; k < _buildingQueryBuf.length; k++) {
      const idx = _buildingQueryBuf[k];
      const b = world.buildings[idx];
      if (!b) continue;
      const baseY = b.baseY ?? 0;
      const t = intersectSegmentAABB(
        x0,
        y0,
        z0,
        x1,
        y1,
        z1,
        b.x - b.halfW,
        baseY,
        b.z - b.halfD,
        b.x + b.halfW,
        baseY + b.height,
        b.z + b.halfD,
        _tmpNormal
      );
      if (t !== null && t < bestT) {
        bestT = t;
        outHit.hit = true;
        outHit.kind = 'world';
        outHit.t = t;
        outHit.nx = _tmpNormal.nx;
        outHit.ny = _tmpNormal.ny;
        outHit.nz = _tmpNormal.nz;
        outHit.targetIndex = idx;
        outHit.targetId = b.label ?? `building_${idx}`;
      }
    }
  } else {
    for (let i = 0; i < world.buildings.length; i++) {
      const b = world.buildings[i];
      const baseY = b.baseY ?? 0;
      const t = intersectSegmentAABB(
        x0,
        y0,
        z0,
        x1,
        y1,
        z1,
        b.x - b.halfW,
        baseY,
        b.z - b.halfD,
        b.x + b.halfW,
        baseY + b.height,
        b.z + b.halfD,
        _tmpNormal
      );
      if (t !== null && t < bestT) {
        bestT = t;
        outHit.hit = true;
        outHit.kind = 'world';
        outHit.t = t;
        outHit.nx = _tmpNormal.nx;
        outHit.ny = _tmpNormal.ny;
        outHit.nz = _tmpNormal.nz;
        outHit.targetIndex = i;
        outHit.targetId = b.label ?? `building_${i}`;
      }
    }
  }

  // 2. Terreno (amostragem em 4 passos + busca binária rápida de 3 iterações + normal)
  const terrainSteps = 4;
  let prevT = 0;
  let prevDiff = y0 - world.groundHeightAt(x0, z0, y0);
  for (let s = 1; s <= terrainSteps; s++) {
    const curT = s / terrainSteps;
    if (curT > bestT) break;
    const sx = x0 + (x1 - x0) * curT;
    const sy = y0 + (y1 - y0) * curT;
    const sz = z0 + (z1 - z0) * curT;
    const gy = world.groundHeightAt(sx, sz, sy);
    const diff = sy - gy;
    if (diff <= 0 && prevDiff > 0) {
      let lo = prevT;
      let hi = curT;
      for (let it = 0; it < 3; it++) {
        const mid = (lo + hi) * 0.5;
        const mx = x0 + (x1 - x0) * mid;
        const my = y0 + (y1 - y0) * mid;
        const mz = z0 + (z1 - z0) * mid;
        if (my - world.groundHeightAt(mx, mz, my) > 0) lo = mid;
        else hi = mid;
      }
      const exactT = (lo + hi) * 0.5;
      if (exactT < bestT) {
        bestT = exactT;
        outHit.hit = true;
        outHit.kind = 'terrain';
        outHit.t = exactT;
        const hx = x0 + (x1 - x0) * exactT;
        const hy = y0 + (y1 - y0) * exactT;
        const hz = z0 + (z1 - z0) * exactT;
        computeTerrainNormal(hx, hz, hy, world.groundHeightAt, outHit);
        outHit.targetIndex = -1;
        outHit.targetId = 'terrain';
      }
      break;
    }
    prevT = curT;
    prevDiff = diff;
  }

  // 3. Veículos (OBB local no plano XZ)
  for (let i = 0; i < world.vehicles.length; i++) {
    const v = world.vehicles[i];
    if (v.id === world.ignoreVehicleId) continue;

    const sinH = Math.sin(v.heading);
    const cosH = Math.cos(v.heading);
    const vBaseY = v.mesh.position.y;
    const vHeight = v.type === 'bus' ? 2.85 : v.type === 'ambulance' ? 2.45 : 1.5;

    const dx0 = x0 - v.x;
    const dz0 = z0 - v.z;
    const lx0 = dx0 * cosH - dz0 * sinH;
    const lz0 = dx0 * sinH + dz0 * cosH;

    const dx1 = x1 - v.x;
    const dz1 = z1 - v.z;
    const lx1 = dx1 * cosH - dz1 * sinH;
    const lz1 = dx1 * sinH + dz1 * cosH;

    const t = intersectSegmentAABB(
      lx0,
      y0,
      lz0,
      lx1,
      y1,
      lz1,
      -v.halfWidth,
      vBaseY + 0.12,
      -v.halfLength,
      v.halfWidth,
      vBaseY + vHeight,
      v.halfLength,
      _tmpNormal
    );
    if (t !== null && t < bestT) {
      bestT = t;
      outHit.hit = true;
      outHit.kind = 'vehicle';
      outHit.t = t;
      outHit.nx = _tmpNormal.nx * cosH + _tmpNormal.nz * sinH;
      outHit.ny = _tmpNormal.ny;
      outHit.nz = -_tmpNormal.nx * sinH + _tmpNormal.nz * cosH;
      outHit.targetIndex = i;
      outHit.targetId = v.id;
    }
  }

  // 4. NPCs candidatos da grade espacial (cápsula + esfera de cabeça)
  for (let k = 0; k < world.candidateNpcIndices.length; k++) {
    const idx = world.candidateNpcIndices[k];
    const npc = world.agents[idx];
    if (!npc || !npc.active || npc.insideBuilding || npc.ragdollActive || npc.injuryStatus === 'out') {
      continue;
    }
    const t = intersectSegmentNpcCapsule(
      x0,
      y0,
      z0,
      x1,
      y1,
      z1,
      npc.x,
      npc.y,
      npc.z,
      npc.widthScale,
      npc.heightScale,
      _npcHitTmp
    );
    if (t !== null && t < bestT) {
      bestT = t;
      outHit.hit = true;
      outHit.kind = 'npc';
      outHit.t = t;
      outHit.nx = _npcHitTmp.nx;
      outHit.ny = _npcHitTmp.ny;
      outHit.nz = _npcHitTmp.nz;
      outHit.region = _npcHitTmp.region;
      outHit.targetIndex = npc.index;
      outHit.targetId = `npc_${npc.index}`;
    }
  }

  if (outHit.hit) {
    outHit.x = x0 + (x1 - x0) * outHit.t;
    outHit.y = y0 + (y1 - y0) * outHit.t;
    outHit.z = z0 + (z1 - z0) * outHit.t;
    outHit.distance = segLen * outHit.t;
  }

  return outHit;
}
