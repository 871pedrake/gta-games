import * as THREE from 'three';
import { MAX_SIMULATED_INJURED } from './config';
import { BuildingCollider } from './types';

export const RAGDOLL_POOL_SIZE = MAX_SIMULATED_INJURED;
const DUST_POOL_SIZE = 36;
const STAR_RING_COUNT = 30;

export type RagdollOutcome = 'out' | 'unconscious' | 'injured_recover';

export interface ActiveRagdoll {
  active: boolean;
  npcIndex: number;
  outcome: RagdollOutcome;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  rx: number;
  ry: number;
  rz: number;
  avx: number;
  avy: number;
  avz: number;
  age: number;
  maxLifetime: number;
  fadeStart: number;
  heightScale: number;
  widthScale: number;
  flailPhase: number;
  groundedTime: number;
  beingRescued: boolean;
}

interface DustParticle {
  active: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  age: number;
  life: number;
  isFlash: boolean;
}

const _mat = new THREE.Matrix4();
const _matLocal = new THREE.Matrix4();
const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _euler = new THREE.Euler();
const _scale = new THREE.Vector3();
const _color = new THREE.Color();

/**
 * Pool reciclável de 30 ragdolls articulados com proporções humanas realistas (1,75 m),
 * física simplificada e efeitos cartoon. Garante teto rígido de 30 feridos simultâneos.
 */
export class RagdollPool {
  public readonly slots: ActiveRagdoll[] = [];
  private readonly dustParticles: DustParticle[] = [];

  private readonly torsoMesh: THREE.InstancedMesh;
  private readonly headMesh: THREE.InstancedMesh;
  private readonly leftArmMesh: THREE.InstancedMesh;
  private readonly rightArmMesh: THREE.InstancedMesh;
  private readonly leftLegMesh: THREE.InstancedMesh;
  private readonly rightLegMesh: THREE.InstancedMesh;
  private readonly allPartMeshes: THREE.InstancedMesh[];

  // Efeitos cartoon (sem sangue/gore)
  private readonly dustMesh: THREE.InstancedMesh;
  private readonly starMesh: THREE.InstancedMesh;

  public inUseCount = 0;

  constructor(scene: THREE.Scene, isSoftwareGl: boolean) {
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.65 });

    // Proporções humanas realistas (~1,75 m de altura total)
    const torsoGeo = new THREE.BoxGeometry(0.38, 0.58, 0.22);
    const headGeo = new THREE.BoxGeometry(0.26, 0.26, 0.26);
    const armGeo = new THREE.BoxGeometry(0.12, 0.56, 0.13);
    const legGeo = new THREE.BoxGeometry(0.15, 0.78, 0.17);

    const makeMesh = (geo: THREE.BufferGeometry) => {
      const m = new THREE.InstancedMesh(geo, bodyMat, RAGDOLL_POOL_SIZE);
      m.frustumCulled = false;
      m.castShadow = !isSoftwareGl;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.instanceColor = new THREE.InstancedBufferAttribute(
        new Float32Array(RAGDOLL_POOL_SIZE * 3),
        3
      );
      scene.add(m);
      return m;
    };

    this.torsoMesh = makeMesh(torsoGeo);
    this.headMesh = makeMesh(headGeo);
    this.leftArmMesh = makeMesh(armGeo);
    this.rightArmMesh = makeMesh(armGeo);
    this.leftLegMesh = makeMesh(legGeo);
    this.rightLegMesh = makeMesh(legGeo);
    this.allPartMeshes = [
      this.torsoMesh,
      this.headMesh,
      this.leftArmMesh,
      this.rightArmMesh,
      this.leftLegMesh,
      this.rightLegMesh,
    ];

    const dustGeo = new THREE.DodecahedronGeometry(0.36, 0);
    const dustMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.85,
    });
    this.dustMesh = new THREE.InstancedMesh(dustGeo, dustMat, DUST_POOL_SIZE);
    this.dustMesh.frustumCulled = false;
    this.dustMesh.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(DUST_POOL_SIZE * 3),
      3
    );
    scene.add(this.dustMesh);

    const starGeo = new THREE.OctahedronGeometry(0.14, 0);
    const starMat = new THREE.MeshBasicMaterial({ color: 0xfacc15 });
    this.starMesh = new THREE.InstancedMesh(starGeo, starMat, STAR_RING_COUNT * 3);
    this.starMesh.frustumCulled = false;
    scene.add(this.starMesh);

    for (let i = 0; i < RAGDOLL_POOL_SIZE; i++) {
      this.slots.push({
        active: false,
        npcIndex: -1,
        outcome: 'out',
        x: 0,
        y: 0,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        rx: 0,
        ry: 0,
        rz: 0,
        avx: 0,
        avy: 0,
        avz: 0,
        age: 0,
        maxLifetime: 10,
        fadeStart: 8.5,
        heightScale: 1,
        widthScale: 1,
        flailPhase: 0,
        groundedTime: 0,
        beingRescued: false,
      });
      this.hideRagdoll(i);
    }

    for (let i = 0; i < DUST_POOL_SIZE; i++) {
      this.dustParticles.push({
        active: false,
        x: 0,
        y: 0,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        age: 0,
        life: 0.5,
        isFlash: false,
      });
      _mat.makeScale(0, 0, 0);
      this.dustMesh.setMatrixAt(i, _mat);
    }

    for (let i = 0; i < STAR_RING_COUNT * 3; i++) {
      _mat.makeScale(0, 0, 0);
      this.starMesh.setMatrixAt(i, _mat);
    }
  }

  private hideRagdoll(slotIdx: number): void {
    _mat.makeScale(0, 0, 0);
    for (const m of this.allPartMeshes) {
      m.setMatrixAt(slotIdx, _mat);
    }
    for (let s = 0; s < 3; s++) {
      this.starMesh.setMatrixAt(slotIdx * 3 + s, _mat);
    }
  }

  /**
   * Aloca um ragdoll do pool (recicla o mais antigo e libera seu NPC caso os 30 slots estejam ocupados).
   */
  public spawn(
    params: {
      npcIndex: number;
      x: number;
      y: number;
      z: number;
      yaw: number;
      impulseX: number;
      impulseY: number;
      impulseZ: number;
      outcome: RagdollOutcome;
      heightScale: number;
      widthScale: number;
      skinColor: number;
      shirtColor: number;
      pantsColor: number;
    },
    onRecycledNpc?: (oldNpcIndex: number) => void
  ): ActiveRagdoll {
    let slotIdx = this.slots.findIndex((s) => !s.active);
    if (slotIdx === -1) {
      let oldestIdx = 0;
      for (let i = 1; i < this.slots.length; i++) {
        if (this.slots[i].age > this.slots[oldestIdx].age) oldestIdx = i;
      }
      slotIdx = oldestIdx;
      const prevNpc = this.slots[slotIdx].npcIndex;
      if (prevNpc >= 0 && onRecycledNpc) {
        onRecycledNpc(prevNpc);
      }
    }

    const r = this.slots[slotIdx];
    r.active = true;
    r.npcIndex = params.npcIndex;
    r.outcome = params.outcome;
    r.x = params.x;
    r.y = params.y + 0.92;
    r.z = params.z;
    r.vx = params.impulseX;
    r.vy = params.impulseY;
    r.vz = params.impulseZ;
    r.rx = (Math.random() - 0.5) * 0.6;
    r.ry = params.yaw;
    r.rz = (Math.random() - 0.5) * 0.6;
    r.avx = (Math.random() - 0.5) * 11;
    r.avy = (Math.random() - 0.5) * 8;
    r.avz = (Math.random() - 0.5) * 11;
    r.age = 0;
    r.groundedTime = 0;
    r.heightScale = params.heightScale;
    r.widthScale = params.widthScale;
    r.flailPhase = Math.random() * Math.PI * 2;
    r.beingRescued = false;

    if (params.outcome === 'injured_recover') {
      r.maxLifetime = 2.4;
      r.fadeStart = 2.4;
    } else if (params.outcome === 'unconscious') {
      r.maxLifetime = 11.5;
      r.fadeStart = 10.6;
    } else {
      r.maxLifetime = 14.0;
      r.fadeStart = 13.0;
    }

    this.headMesh.setColorAt(slotIdx, _color.setHex(params.skinColor));
    this.torsoMesh.setColorAt(slotIdx, _color.setHex(params.shirtColor));
    this.leftArmMesh.setColorAt(slotIdx, _color.setHex(params.shirtColor));
    this.rightArmMesh.setColorAt(slotIdx, _color.setHex(params.shirtColor));
    this.leftLegMesh.setColorAt(slotIdx, _color.setHex(params.pantsColor));
    this.rightLegMesh.setColorAt(slotIdx, _color.setHex(params.pantsColor));
    for (const m of this.allPartMeshes) {
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }

    this.spawnCartoonImpactVfx(params.x, params.y + 0.95, params.z);
    return r;
  }

  /**
   * Acelera o fade do ragdoll ativo mais antigo para manter o teto rígido de feridos simultâneos.
   */
  public accelerateOldestFade(): void {
    let oldestIdx = -1;
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i];
      if (!s.active || s.beingRescued) continue;
      if (oldestIdx === -1 || s.age > this.slots[oldestIdx].age) {
        oldestIdx = i;
      }
    }
    if (oldestIdx !== -1) {
      const r = this.slots[oldestIdx];
      r.fadeStart = Math.min(r.fadeStart, r.age);
      r.maxLifetime = Math.min(r.maxLifetime, r.age + 0.8);
    }
  }

  public spawnCartoonImpactVfx(x: number, y: number, z: number): void {
    this.allocDust(x, y, z, 0, 0.5, 0, 0.16, true);
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2 + Math.random() * 0.6;
      const spd = 2.5 + Math.random() * 2.5;
      this.allocDust(
        x,
        y,
        z,
        Math.cos(a) * spd,
        1.5 + Math.random() * 2.0,
        Math.sin(a) * spd,
        0.55 + Math.random() * 0.25,
        false
      );
    }
  }

  private allocDust(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    life: number,
    isFlash: boolean
  ): void {
    const slot = this.dustParticles.findIndex((p) => !p.active);
    const idx = slot === -1 ? 0 : slot;
    const p = this.dustParticles[idx];
    p.active = true;
    p.x = x;
    p.y = y;
    p.z = z;
    p.vx = vx;
    p.vy = vy;
    p.vz = vz;
    p.age = 0;
    p.life = life;
    p.isFlash = isFlash;
    this.dustMesh.setColorAt(idx, _color.setHex(isFlash ? 0xffffff : 0xf1f5f9));
    if (this.dustMesh.instanceColor) this.dustMesh.instanceColor.needsUpdate = true;
  }

  public rescueSlot(slotIdx: number): void {
    const r = this.slots[slotIdx];
    if (!r || !r.active) return;
    r.active = false;
    r.beingRescued = false;
    this.hideRagdoll(slotIdx);
    for (const m of this.allPartMeshes) {
      m.instanceMatrix.needsUpdate = true;
    }
    this.starMesh.instanceMatrix.needsUpdate = true;
  }

  public update(
    dt: number,
    buildings: BuildingCollider[],
    groundHeightFn: (x: number, z: number, currentY?: number) => number,
    onRecover?: (npcIndex: number, x: number, z: number, wasUnconscious: boolean) => void,
    onExpire?: (npcIndex: number) => void,
    onHitNpc?: (ragdoll: ActiveRagdoll) => void
  ): void {
    let activeCount = 0;

    for (let i = 0; i < RAGDOLL_POOL_SIZE; i++) {
      const r = this.slots[i];
      if (!r.active) continue;

      r.age += dt;
      if (r.beingRescued && r.age > r.fadeStart - 0.8) {
        r.age = r.fadeStart - 0.8;
      }
      if (r.age >= r.maxLifetime) {
        r.active = false;
        r.beingRescued = false;
        this.hideRagdoll(i);
        if (r.outcome === 'injured_recover' || r.outcome === 'unconscious') {
          onRecover?.(r.npcIndex, r.x, r.z, r.outcome === 'unconscious');
        } else {
          onExpire?.(r.npcIndex);
        }
        continue;
      }

      activeCount++;

      r.vy -= 22 * dt;
      r.x += r.vx * dt;
      r.y += r.vy * dt;
      r.z += r.vz * dt;

      r.rx += r.avx * dt;
      r.ry += r.avy * dt;
      r.rz += r.avz * dt;

      const floorY = groundHeightFn(r.x, r.z, r.y - 0.24) + 0.24;
      if (r.y <= floorY) {
        r.y = floorY;
        if (Math.abs(r.vy) > 2.2) {
          r.vy = -r.vy * 0.36;
        } else {
          r.vy = 0;
          r.groundedTime += dt;
          const targetPitch = Math.PI / 2;
          r.rx += (targetPitch - r.rx) * Math.min(1, dt * 8);
          r.rz *= Math.exp(-8 * dt);
        }
        r.vx *= Math.exp(-5.5 * dt);
        r.vz *= Math.exp(-5.5 * dt);
        r.avx *= Math.exp(-6.5 * dt);
        r.avy *= Math.exp(-6.5 * dt);
        r.avz *= Math.exp(-6.5 * dt);
      }

      for (const b of buildings) {
        const minX = b.x - b.halfW - 0.5;
        const maxX = b.x + b.halfW + 0.5;
        const minZ = b.z - b.halfD - 0.5;
        const maxZ = b.z + b.halfD + 0.5;
        if (r.x > minX && r.x < maxX && r.z > minZ && r.z < maxZ) {
          const dL = r.x - minX;
          const dR = maxX - r.x;
          const dT = r.z - minZ;
          const dB = maxZ - r.z;
          const m = Math.min(dL, dR, dT, dB);
          if (m === dL) { r.x = minX; r.vx = -Math.abs(r.vx) * 0.5; }
          else if (m === dR) { r.x = maxX; r.vx = Math.abs(r.vx) * 0.5; }
          else if (m === dT) { r.z = minZ; r.vz = -Math.abs(r.vz) * 0.5; }
          else { r.z = maxZ; r.vz = Math.abs(r.vz) * 0.5; }
        }
      }

      if (r.vx * r.vx + r.vz * r.vz > 24 && onHitNpc) {
        onHitNpc(r);
      }

      r.flailPhase += dt * (r.vy > 0.5 ? 12 : 3);
      const fadeRatio =
        r.age > r.fadeStart
          ? Math.max(0.01, 1 - (r.age - r.fadeStart) / Math.max(0.05, r.maxLifetime - r.fadeStart))
          : 1;

      this.writeRagdollMatrices(i, r, fadeRatio);
    }

    this.inUseCount = activeCount;

    for (const m of this.allPartMeshes) {
      m.instanceMatrix.needsUpdate = true;
    }

    for (let i = 0; i < DUST_POOL_SIZE; i++) {
      const p = this.dustParticles[i];
      if (!p.active) continue;
      p.age += dt;
      if (p.age >= p.life) {
        p.active = false;
        _mat.makeScale(0, 0, 0);
        this.dustMesh.setMatrixAt(i, _mat);
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      const t = p.age / p.life;
      const sc = p.isFlash ? 2.4 * (1 - t) : (0.5 + t * 1.4) * (1 - t);
      _pos.set(p.x, p.y, p.z);
      _quat.identity();
      _scale.setScalar(Math.max(0.01, sc));
      _mat.compose(_pos, _quat, _scale);
      this.dustMesh.setMatrixAt(i, _mat);
    }
    this.dustMesh.instanceMatrix.needsUpdate = true;
    this.starMesh.instanceMatrix.needsUpdate = true;
  }

  private writeRagdollMatrices(slotIdx: number, r: ActiveRagdoll, fadeScale: number): void {
    _euler.set(r.rx, r.ry, r.rz, 'YXZ');
    _quat.setFromEuler(_euler);
    _pos.set(r.x, r.y, r.z);
    _scale.set(r.widthScale * fadeScale, r.heightScale * fadeScale, r.widthScale * fadeScale);
    _mat.compose(_pos, _quat, _scale);

    this.torsoMesh.setMatrixAt(slotIdx, _mat);

    const flail = Math.sin(r.flailPhase) * 0.55;
    _euler.set(flail * 0.3, 0, 0);
    _quat.setFromEuler(_euler);
    _pos.set(0, 0.44, 0);
    _scale.set(1, 1, 1);
    _matLocal.compose(_pos, _quat, _scale).premultiply(_mat);
    this.headMesh.setMatrixAt(slotIdx, _matLocal);

    _euler.set(-1.2 + flail, 0, 0.5);
    _quat.setFromEuler(_euler);
    _pos.set(-0.26, 0.2, 0);
    _matLocal.compose(_pos, _quat, _scale).premultiply(_mat);
    this.leftArmMesh.setMatrixAt(slotIdx, _matLocal);

    _euler.set(-1.2 - flail, 0, -0.5);
    _quat.setFromEuler(_euler);
    _pos.set(0.26, 0.2, 0);
    _matLocal.compose(_pos, _quat, _scale).premultiply(_mat);
    this.rightArmMesh.setMatrixAt(slotIdx, _matLocal);

    _euler.set(flail * 0.7, 0, 0.12);
    _quat.setFromEuler(_euler);
    _pos.set(-0.1, -0.52, 0);
    _matLocal.compose(_pos, _quat, _scale).premultiply(_mat);
    this.leftLegMesh.setMatrixAt(slotIdx, _matLocal);

    _euler.set(-flail * 0.7, 0, -0.12);
    _quat.setFromEuler(_euler);
    _pos.set(0.1, -0.52, 0);
    _matLocal.compose(_pos, _quat, _scale).premultiply(_mat);
    this.rightLegMesh.setMatrixAt(slotIdx, _matLocal);

    if (r.groundedTime > 0.1 && (r.outcome === 'unconscious' || r.outcome === 'injured_recover') && fadeScale > 0.3) {
      for (let s = 0; s < 3; s++) {
        const ang = r.age * 4.5 + (s * Math.PI * 2) / 3;
        _pos.set(r.x + Math.cos(ang) * 0.42, r.y + 0.82, r.z + Math.sin(ang) * 0.42);
        _euler.set(0, ang, 0);
        _quat.setFromEuler(_euler);
        _scale.setScalar(0.85 * fadeScale);
        _matLocal.compose(_pos, _quat, _scale);
        this.starMesh.setMatrixAt(slotIdx * 3 + s, _matLocal);
      }
    } else {
      _matLocal.makeScale(0, 0, 0);
      for (let s = 0; s < 3; s++) {
        this.starMesh.setMatrixAt(slotIdx * 3 + s, _matLocal);
      }
    }
  }
}
