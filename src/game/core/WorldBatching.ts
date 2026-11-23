import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export interface InstanceTransform {
  x: number;
  y: number;
  z: number;
  rotX?: number;
  rotY?: number;
  rotZ?: number;
  scaleX?: number;
  scaleY?: number;
  scaleZ?: number;
}

export interface ColoredGeometryPart {
  geo: THREE.BufferGeometry;
  colorHex?: number;
}

const _mat4 = new THREE.Matrix4();
const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _euler = new THREE.Euler();
const _scale = new THREE.Vector3();
const _color = new THREE.Color();

/**
 * Normaliza atributos de geometrias estáticas e realiza merge seguro em um único draw call.
 * Descarta as geometrias intermediárias passadas após o merge.
 */
export function mergeAndDisposeGeometries(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  if (geos.length === 0) return new THREE.BufferGeometry();
  const normalized: THREE.BufferGeometry[] = [];
  for (const g of geos) {
    const nonIdx = g.index ? g.toNonIndexed() : g.clone();
    if (!nonIdx.getAttribute('normal')) {
      nonIdx.computeVertexNormals();
    }
    if (!nonIdx.getAttribute('uv')) {
      const count = nonIdx.getAttribute('position').count;
      nonIdx.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(count * 2), 2));
    }
    if (nonIdx.getAttribute('tangent')) nonIdx.deleteAttribute('tangent');
    if (nonIdx.getAttribute('color')) nonIdx.deleteAttribute('color');
    normalized.push(nonIdx);
    g.dispose();
  }

  const merged = mergeGeometries(normalized, false);
  for (const n of normalized) n.dispose();
  return merged ?? new THREE.BufferGeometry();
}

/**
 * Mescla múltiplas geometrias preservando ou aplicando vertex colors por parte.
 */
export function mergeColoredGeometries(
  parts: ColoredGeometryPart[],
  disposeInputs = true
): THREE.BufferGeometry {
  if (parts.length === 0) return new THREE.BufferGeometry();
  const normalized: THREE.BufferGeometry[] = [];

  for (const { geo, colorHex } of parts) {
    const posAttr = geo.getAttribute('position');
    if (!posAttr || posAttr.count === 0) {
      if (disposeInputs) geo.dispose();
      continue;
    }

    const nonIdx = geo.index ? geo.toNonIndexed() : geo.clone();
    if (!nonIdx.getAttribute('normal')) {
      nonIdx.computeVertexNormals();
    }
    const vCount = nonIdx.getAttribute('position').count;
    if (!nonIdx.getAttribute('uv')) {
      nonIdx.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(vCount * 2), 2));
    }
    if (nonIdx.getAttribute('tangent')) nonIdx.deleteAttribute('tangent');

    const existingColor = nonIdx.getAttribute('color');
    if (colorHex !== undefined) {
      _color.setHex(colorHex);
      const colors = new Float32Array(vCount * 3);
      for (let i = 0; i < vCount; i++) {
        colors[i * 3] = _color.r;
        colors[i * 3 + 1] = _color.g;
        colors[i * 3 + 2] = _color.b;
      }
      nonIdx.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    } else if (!existingColor) {
      const colors = new Float32Array(vCount * 3);
      colors.fill(1.0);
      nonIdx.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    } else if (existingColor.itemSize !== 3) {
      const colors = new Float32Array(vCount * 3);
      for (let i = 0; i < vCount; i++) {
        colors[i * 3] = existingColor.getX(i);
        colors[i * 3 + 1] = existingColor.getY(i);
        colors[i * 3 + 2] = existingColor.getZ(i);
      }
      nonIdx.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    }

    normalized.push(nonIdx);
    if (disposeInputs) geo.dispose();
  }

  if (normalized.length === 0) return new THREE.BufferGeometry();
  const merged = mergeGeometries(normalized, false);
  for (const n of normalized) n.dispose();
  return merged ?? new THREE.BufferGeometry();
}

interface ClipVertex {
  px: number;
  py: number;
  pz: number;
  nx: number;
  ny: number;
  nz: number;
  u: number;
  v: number;
  r: number;
  g: number;
  b: number;
}

interface ChunkBucket {
  pos: number[];
  norm: number[];
  uv: number[];
  col: number[];
}

function lerpVertex(a: ClipVertex, b: ClipVertex, t: number): ClipVertex {
  const nx = a.nx + (b.nx - a.nx) * t;
  const ny = a.ny + (b.ny - a.ny) * t;
  const nz = a.nz + (b.nz - a.nz) * t;
  const nLen = Math.hypot(nx, ny, nz) || 1;
  return {
    px: a.px + (b.px - a.px) * t,
    py: a.py + (b.py - a.py) * t,
    pz: a.pz + (b.pz - a.pz) * t,
    nx: nx / nLen,
    ny: ny / nLen,
    nz: nz / nLen,
    u: a.u + (b.u - a.u) * t,
    v: a.v + (b.v - a.v) * t,
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t,
  };
}

function clipPolyAgainstPlane(
  poly: ClipVertex[],
  axis: 'x' | 'z',
  bound: number,
  keepGreaterOrEqual: boolean
): ClipVertex[] {
  if (poly.length === 0) return poly;
  const out: ClipVertex[] = [];
  const val = (v: ClipVertex) => (axis === 'x' ? v.px : v.pz);
  const inside = (v: ClipVertex) =>
    keepGreaterOrEqual ? val(v) >= bound - 1e-6 : val(v) <= bound + 1e-6;

  let prev = poly[poly.length - 1];
  let prevIn = inside(prev);

  for (let i = 0; i < poly.length; i++) {
    const cur = poly[i];
    const curIn = inside(cur);
    if (curIn !== prevIn) {
      const denom = val(cur) - val(prev);
      const t = Math.abs(denom) > 1e-8 ? Math.max(0, Math.min(1, (bound - val(prev)) / denom)) : 0.5;
      out.push(lerpVertex(prev, cur, t));
    }
    if (curIn) {
      out.push(cur);
    }
    prev = cur;
    prevIn = curIn;
  }
  return out;
}

function pushClippedTri(bucket: ChunkBucket, a: ClipVertex, b: ClipVertex, c: ClipVertex, hasColor: boolean): void {
  const ux = b.px - a.px;
  const uy = b.py - a.py;
  const uz = b.pz - a.pz;
  const vx = c.px - a.px;
  const vy = c.py - a.py;
  const vz = c.pz - a.pz;
  const cx = uy * vz - uz * vy;
  const cy = uz * vx - ux * vz;
  const cz = ux * vy - uy * vx;
  if (cx * cx + cy * cy + cz * cz < 1e-10) return;

  bucket.pos.push(a.px, a.py, a.pz, b.px, b.py, b.pz, c.px, c.py, c.pz);
  bucket.norm.push(a.nx, a.ny, a.nz, b.nx, b.ny, b.nz, c.nx, c.ny, c.nz);
  bucket.uv.push(a.u, a.v, b.u, b.v, c.u, c.v);
  if (hasColor) {
    bucket.col.push(a.r, a.g, a.b, b.r, b.g, b.b, c.r, c.g, c.b);
  }
}

/**
 * Recorta e particiona qualquer BufferGeometry em chunks de chunkSize × chunkSize m (XZ)
 * usando recorte exato de polígonos (Sutherland-Hodgman), sem fendas ou sobreposição.
 */
export function splitGeometryIntoChunks(
  geo: THREE.BufferGeometry,
  chunkSize = 64,
  disposeInput = true
): Map<string, THREE.BufferGeometry> {
  const result = new Map<string, THREE.BufferGeometry>();
  const rawPos = geo.getAttribute('position');
  if (!rawPos || rawPos.count < 3) {
    if (disposeInput) geo.dispose();
    return result;
  }

  const nonIdx = geo.index ? geo.toNonIndexed() : geo;
  if (!nonIdx.getAttribute('normal')) {
    nonIdx.computeVertexNormals();
  }
  const posAttr = nonIdx.getAttribute('position');
  const normAttr = nonIdx.getAttribute('normal');
  const uvAttr = nonIdx.getAttribute('uv');
  const colAttr = nonIdx.getAttribute('color');
  const hasColor = Boolean(colAttr);

  const buckets = new Map<string, ChunkBucket>();
  const getBucket = (cx: number, cz: number): ChunkBucket => {
    const key = `${cx},${cz}`;
    let b = buckets.get(key);
    if (!b) {
      b = { pos: [], norm: [], uv: [], col: [] };
      buckets.set(key, b);
    }
    return b;
  };

  const readVert = (idx: number): ClipVertex => ({
    px: posAttr.getX(idx),
    py: posAttr.getY(idx),
    pz: posAttr.getZ(idx),
    nx: normAttr ? normAttr.getX(idx) : 0,
    ny: normAttr ? normAttr.getY(idx) : 1,
    nz: normAttr ? normAttr.getZ(idx) : 0,
    u: uvAttr ? uvAttr.getX(idx) : 0,
    v: uvAttr ? uvAttr.getY(idx) : 0,
    r: colAttr ? colAttr.getX(idx) : 1,
    g: colAttr ? colAttr.getY(idx) : 1,
    b: colAttr ? colAttr.getZ(idx) : 1,
  });

  const triCount = Math.floor(posAttr.count / 3);
  for (let t = 0; t < triCount; t++) {
    const v0 = readVert(t * 3);
    const v1 = readVert(t * 3 + 1);
    const v2 = readVert(t * 3 + 2);

    const minX = Math.min(v0.px, v1.px, v2.px);
    const maxX = Math.max(v0.px, v1.px, v2.px);
    const minZ = Math.min(v0.pz, v1.pz, v2.pz);
    const maxZ = Math.max(v0.pz, v1.pz, v2.pz);

    let cxMin = Math.floor((minX + 1e-4) / chunkSize);
    let cxMax = Math.floor((maxX - 1e-4) / chunkSize);
    if (cxMax < cxMin) {
      cxMin = Math.floor(minX / chunkSize);
      cxMax = cxMin;
    }

    let czMin = Math.floor((minZ + 1e-4) / chunkSize);
    let czMax = Math.floor((maxZ - 1e-4) / chunkSize);
    if (czMax < czMin) {
      czMin = Math.floor(minZ / chunkSize);
      czMax = czMin;
    }

    if (cxMin === cxMax && czMin === czMax) {
      pushClippedTri(getBucket(cxMin, czMin), v0, v1, v2, hasColor);
      continue;
    }

    for (let cx = cxMin; cx <= cxMax; cx++) {
      const x0 = cx * chunkSize;
      const x1 = x0 + chunkSize;
      const xClipped = clipPolyAgainstPlane(
        clipPolyAgainstPlane([v0, v1, v2], 'x', x0, true),
        'x',
        x1,
        false
      );
      if (xClipped.length < 3) continue;

      for (let cz = czMin; cz <= czMax; cz++) {
        const z0 = cz * chunkSize;
        const z1 = z0 + chunkSize;
        const clipped = clipPolyAgainstPlane(
          clipPolyAgainstPlane(xClipped, 'z', z0, true),
          'z',
          z1,
          false
        );
        if (clipped.length < 3) continue;

        const bucket = getBucket(cx, cz);
        for (let i = 1; i < clipped.length - 1; i++) {
          pushClippedTri(bucket, clipped[0], clipped[i], clipped[i + 1], hasColor);
        }
      }
    }
  }

  for (const [key, b] of buckets.entries()) {
    if (b.pos.length === 0) continue;
    const chunkGeo = new THREE.BufferGeometry();
    chunkGeo.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
    chunkGeo.setAttribute('normal', new THREE.Float32BufferAttribute(b.norm, 3));
    chunkGeo.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
    if (hasColor) {
      chunkGeo.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 3));
    }
    chunkGeo.computeBoundingSphere();
    result.set(key, chunkGeo);
  }

  if (nonIdx !== geo) nonIdx.dispose();
  if (disposeInput) geo.dispose();
  return result;
}

/**
 * Helper conveniente para posicionar uma cópia transformada antes de mesclar no lote do quarteirão.
 */
export function makeBakedBox(
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  rotY = 0
): THREE.BufferGeometry {
  const geo = new THREE.BoxGeometry(w, h, d);
  if (rotY !== 0) geo.rotateY(rotY);
  geo.translate(x, y, z);
  return geo;
}

export function makeBakedPlaneXZ(
  w: number,
  d: number,
  x: number,
  y: number,
  z: number
): THREE.BufferGeometry {
  const geo = new THREE.PlaneGeometry(w, d);
  geo.rotateX(-Math.PI / 2);
  geo.translate(x, y, z);
  return geo;
}

/**
 * Cria um InstancedMesh único para múltiplos props idênticos, reduzindo N draw calls para 1.
 */
export function createInstancedBatch(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  transforms: InstanceTransform[],
  castShadow = false,
  receiveShadow = false
): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, transforms.length));
  mesh.castShadow = castShadow;
  mesh.receiveShadow = receiveShadow;

  for (let i = 0; i < transforms.length; i++) {
    const t = transforms[i];
    _pos.set(t.x, t.y, t.z);
    _euler.set(t.rotX ?? 0, t.rotY ?? 0, t.rotZ ?? 0);
    _quat.setFromEuler(_euler);
    _scale.set(t.scaleX ?? 1, t.scaleY ?? 1, t.scaleZ ?? 1);
    _mat4.compose(_pos, _quat, _scale);
    mesh.setMatrixAt(i, _mat4);
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  return mesh;
}
