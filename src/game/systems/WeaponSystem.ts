import * as THREE from 'three';
import {
  advanceProjectileStep,
  BallisticProjectile,
  BuildingSpatialGrid,
  castBallisticSegment,
  computeDistanceDamageFalloff,
  computeSpreadDirection,
  createEmptyBallisticHit,
  ProjectileOwnerKind,
  tryApplyRicochet,
} from '../Ballistics';
import {
  BALLISTICS_FIXED_STEP,
  BALLISTICS_GRAVITY,
  BALLISTICS_MAX_STEPS_PER_FRAME,
  CAM_TPS_AIM_RAY_DIST,
  GUN_SHOP_INTERACT_RADIUS,
  MAX_SIMULATED_INJURED,
  PLAYER_MAX_ARMOR,
  PLAYER_MAX_HEALTH,
  QUALITY_SETTINGS,
  QualityPreset,
  WEAPON_CASING_POOL_SIZE,
  WEAPON_PROJECTILE_POOL_SIZE,
  WEAPON_TRACER_POOL_SIZE,
} from '../config';
import { EngineContext, GameSystem } from '../core/SystemLifecycle';
import { createMuzzleFlashTexture } from '../models';
import { RagdollOutcome } from '../RagdollPool';
import { SavedWeaponAmmo, WeaponDebugStats } from '../types';
import {
  ARMOR_VEST_PRICE,
  getWeaponDef,
  isWeaponId,
  WEAPON_BY_SLOT,
  WEAPON_DEFS,
  WEAPON_LIST,
  WeaponDef,
  WeaponId,
} from '../WeaponDefs';
import { CORE_POIS } from '../world/WorldRegistry';
import { CameraRig } from './CameraRig';
import { InputManager } from './InputManager';

interface TracerVisual {
  active: boolean;
  x0: number;
  y0: number;
  z0: number;
  x1: number;
  y1: number;
  z1: number;
  age: number;
  life: number;
  colorHex: number;
}

interface CasingVisual {
  active: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  rx: number;
  ry: number;
  rz: number;
  age: number;
  life: number;
}

interface DecalVisual {
  active: boolean;
  x: number;
  y: number;
  z: number;
  nx: number;
  ny: number;
  nz: number;
  scale: number;
  age: number;
}

interface CartoonFxParticle {
  active: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  scale: number;
  age: number;
  life: number;
  colorHex: number;
  gravity: number;
}

interface DebugTrajectorySegment {
  active: boolean;
  x0: number;
  y0: number;
  z0: number;
  x1: number;
  y1: number;
  z1: number;
  age: number;
  colorHex: number;
}

const MAX_DECAL_CAPACITY = 64;
const MAX_PARTICLE_CAPACITY = 260;
const MAX_DEBUG_TRAJECTORIES = 180;
const DEBUG_TRAJECTORY_LIFETIME = 2.5;

const _mat = new THREE.Matrix4();
const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _color = new THREE.Color();
const _up = new THREE.Vector3(0, 1, 0);
const _zAxis = new THREE.Vector3(0, 0, 1);
const _euler = new THREE.Euler();
const _dir = new THREE.Vector3();
const _aimOrigin = new THREE.Vector3();
const _aimDir = new THREE.Vector3();
const _aimTarget = new THREE.Vector3();
const _muzzlePos = new THREE.Vector3();
const _toTarget = new THREE.Vector3();
const _nextPos = { x: 0, y: 0, z: 0 };
const _spreadDir = { x: 0, y: 0, z: 1 };
const _hit = createEmptyBallisticHit();

export class WeaponSystem implements GameSystem {
  public readonly name = 'WeaponSystem';

  private ctx: EngineContext | null = null;
  private readonly input: InputManager;
  private readonly cameraRig: CameraRig;
  private qualityPreset: QualityPreset = 'medium';

  private tracerMesh: THREE.InstancedMesh | null = null;
  private casingMesh: THREE.InstancedMesh | null = null;
  private decalMesh: THREE.InstancedMesh | null = null;
  private fxMesh: THREE.InstancedMesh | null = null;
  private muzzleFlashTex: THREE.CanvasTexture | null = null;
  private muzzleFlashSprite: THREE.Sprite | null = null;
  private muzzleLight: THREE.PointLight | null = null;
  private debugTrajLines: THREE.LineSegments | null = null;
  private debugTrajPosAttr: THREE.BufferAttribute | null = null;
  private debugTrajColAttr: THREE.BufferAttribute | null = null;

  private readonly projectiles: BallisticProjectile[] = [];
  private readonly tracers: TracerVisual[] = [];
  private readonly casings: CasingVisual[] = [];
  private readonly decals: DecalVisual[] = [];
  private readonly particles: CartoonFxParticle[] = [];
  private readonly debugTrajectories: DebugTrajectorySegment[] = [];
  private readonly debugStatsCache: WeaponDebugStats = {
    activeProjectiles: 0,
    activeParticles: 0,
    activeDecals: 0,
    activeTracers: 0,
    activeCasings: 0,
  };
  private debugTrajCursor = 0;

  private readonly npcQueryBuf: number[] = [];
  private readonly witnessQueryBuf: number[] = [];

  private decalCursor = 0;
  private particleCursor = 0;
  private casingCursor = 0;
  private tracerCursor = 0;
  private tracerShotCounter = 0;
  private muzzleFlashTimer = 0;
  private muzzleFlashDuration = 0.055;
  private muzzleFlashBaseScale = 0.45;
  private muzzleLightBaseIntensity = 3.2;

  private fireCooldown = 0;
  private autoAccum = 0;
  private physicsAccum = 0;
  private wasFireHeld = false;
  private pendingFirePressed = false;
  private pendingFireHeld = false;
  private pendingMeleePressed = false;
  private reloadTimer = 0;
  private switchTimer = 0;
  private currentSpreadBloom = 0;
  private aimToggleActive = false;
  private wheelClosedManually = false;
  private shootingCrimeCooldown = 0;
  private lastShootingCrimeStars = 0;
  private panicThrottleTimer = 0;
  private lastPanicRadius = 0;
  private unsubWantedReset: (() => void) | null = null;
  private gunShopPos = { x: -183, z: -90 };
  private muzzlePosProvider: ((out: THREE.Vector3) => boolean) | null = null;
  private buildingGrid: BuildingSpatialGrid | null = null;
  private indexedBuildingsRef: ReadonlyArray<import('../types').BuildingCollider> | null = null;
  private indexedBuildingCount = -1;

  constructor(input: InputManager, cameraRig: CameraRig, qualityPreset: QualityPreset = 'medium') {
    this.input = input;
    this.cameraRig = cameraRig;
    this.qualityPreset = qualityPreset;

    for (let i = 0; i < WEAPON_PROJECTILE_POOL_SIZE; i++) {
      this.projectiles.push({
        active: false,
        ownerKind: 'player',
        weaponId: 'pistol',
        x: 0,
        y: 0,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        gravity: BALLISTICS_GRAVITY,
        drag: 0.14,
        damage: 24,
        headshotMul: 2.5,
        limbMul: 1.0,
        falloffStart: 32,
        falloffMinMul: 0.5,
        impulseStrength: 7.5,
        traveled: 0,
        maxRange: 80,
        age: 0,
        maxLife: 1.5,
        ricocheted: false,
        tracerColorHex: 0xffe066,
        hasTracer: true,
        flybyPlayed: false,
      });
    }
    for (let i = 0; i < WEAPON_TRACER_POOL_SIZE; i++) {
      this.tracers.push({
        active: false,
        x0: 0,
        y0: 0,
        z0: 0,
        x1: 0,
        y1: 0,
        z1: 0,
        age: 0,
        life: 0.08,
        colorHex: 0xffe066,
      });
    }
    for (let i = 0; i < WEAPON_CASING_POOL_SIZE; i++) {
      this.casings.push({
        active: false,
        x: 0,
        y: 0,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        rx: 0,
        ry: 0,
        rz: 0,
        age: 0,
        life: 1.8,
      });
    }
    for (let i = 0; i < MAX_DECAL_CAPACITY; i++) {
      this.decals.push({
        active: false,
        x: 0,
        y: 0,
        z: 0,
        nx: 0,
        ny: 1,
        nz: 0,
        scale: 0.14,
        age: 0,
      });
    }
    for (let i = 0; i < MAX_PARTICLE_CAPACITY; i++) {
      this.particles.push({
        active: false,
        x: 0,
        y: 0,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        scale: 0.1,
        age: 0,
        life: 0.35,
        colorHex: 0xfacc15,
        gravity: 9.8,
      });
    }
    for (let i = 0; i < MAX_DEBUG_TRAJECTORIES; i++) {
      this.debugTrajectories.push({
        active: false,
        x0: 0,
        y0: 0,
        z0: 0,
        x1: 0,
        y1: 0,
        z1: 0,
        age: 0,
        colorHex: 0x38bdf8,
      });
    }
  }

  public init(ctx: EngineContext): void {
    this.ctx = ctx;
    this.buildingGrid = new BuildingSpatialGrid(ctx.world.buildings, 32);
    this.indexedBuildingsRef = ctx.world.buildings;
    this.indexedBuildingCount = ctx.world.buildings.length;
    this.unsubWantedReset = ctx.events.on('wantedChanged', ({ stars }) => {
      if (stars === 0) {
        this.lastShootingCrimeStars = 0;
        this.shootingCrimeCooldown = 0;
      }
    });

    const gunShopPoi = CORE_POIS.find((p) => p.category === 'shop_gun');
    if (gunShopPoi) {
      this.gunShopPos = { x: gunShopPoi.entryX, z: gunShopPoi.entryZ };
    }

    // Fallback de arrasto de câmera só quando desarmado (punhos) ou no veículo
    this.input.setCanUseDragFallback(() => {
      if (!this.ctx) return true;
      const { state } = this.ctx;
      if (state.currentVehicle !== null) return true;
      return !getWeaponDef(state.activeWeaponId).isFirearm;
    });

    // 4 InstancedMeshes leves para rastros, estojos, decais e partículas cartoon
    const tracerGeo = new THREE.BoxGeometry(0.032, 0.032, 1.0);
    const tracerMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 });
    this.tracerMesh = new THREE.InstancedMesh(tracerGeo, tracerMat, WEAPON_TRACER_POOL_SIZE);
    this.tracerMesh.frustumCulled = false;
    this.tracerMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.tracerMesh.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(WEAPON_TRACER_POOL_SIZE * 3),
      3
    );

    const casingGeo = new THREE.BoxGeometry(0.022, 0.022, 0.055);
    const casingMat = new THREE.MeshStandardMaterial({ color: 0xf59e0b, roughness: 0.3, metalness: 0.85 });
    this.casingMesh = new THREE.InstancedMesh(casingGeo, casingMat, WEAPON_CASING_POOL_SIZE);
    this.casingMesh.frustumCulled = false;
    this.casingMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    const decalGeo = new THREE.PlaneGeometry(0.24, 0.24);
    const decalMat = new THREE.MeshBasicMaterial({
      color: 0x111827,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
    });
    this.decalMesh = new THREE.InstancedMesh(decalGeo, decalMat, MAX_DECAL_CAPACITY);
    this.decalMesh.frustumCulled = false;
    this.decalMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    const fxGeo = new THREE.OctahedronGeometry(0.11, 0);
    const fxMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.fxMesh = new THREE.InstancedMesh(fxGeo, fxMat, MAX_PARTICLE_CAPACITY);
    this.fxMesh.frustumCulled = false;
    this.fxMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.fxMesh.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(MAX_PARTICLE_CAPACITY * 3),
      3
    );

    this.muzzleFlashTex = createMuzzleFlashTexture();
    const flashMat = new THREE.SpriteMaterial({
      ...(this.muzzleFlashTex ? { map: this.muzzleFlashTex } : {}),
      color: 0xffe49e,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      opacity: 0.95,
    });
    this.muzzleFlashSprite = new THREE.Sprite(flashMat);
    this.muzzleFlashSprite.visible = false;

    // Única PointLight compartilhada para o flash do cano
    this.muzzleLight = new THREE.PointLight(0xffb74d, 0, 7.5, 2.0);
    this.muzzleLight.visible = false;

    // Linhas de trajetórias balísticas para o debug (F3 / P), pré-alocadas
    const trajGeo = new THREE.BufferGeometry();
    const posBuf = new Float32Array(MAX_DEBUG_TRAJECTORIES * 6);
    const colBuf = new Float32Array(MAX_DEBUG_TRAJECTORIES * 6);
    this.debugTrajPosAttr = new THREE.BufferAttribute(posBuf, 3);
    this.debugTrajPosAttr.setUsage(THREE.DynamicDrawUsage);
    this.debugTrajColAttr = new THREE.BufferAttribute(colBuf, 3);
    this.debugTrajColAttr.setUsage(THREE.DynamicDrawUsage);
    trajGeo.setAttribute('position', this.debugTrajPosAttr);
    trajGeo.setAttribute('color', this.debugTrajColAttr);
    trajGeo.setDrawRange(0, 0);
    const trajMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.92 });
    this.debugTrajLines = new THREE.LineSegments(trajGeo, trajMat);
    this.debugTrajLines.frustumCulled = false;
    this.debugTrajLines.visible = false;

    ctx.scene.add(
      this.tracerMesh,
      this.casingMesh,
      this.decalMesh,
      this.fxMesh,
      this.muzzleFlashSprite,
      this.muzzleLight,
      this.debugTrajLines
    );
    this.hideAllInstances();
  }

  public getDebugStats(): WeaponDebugStats {
    let activeProjectiles = 0;
    for (let i = 0; i < this.projectiles.length; i++) {
      if (this.projectiles[i].active) activeProjectiles++;
    }
    let activeParticles = 0;
    for (let i = 0; i < this.particles.length; i++) {
      if (this.particles[i].active) activeParticles++;
    }
    let activeDecals = 0;
    for (let i = 0; i < this.decals.length; i++) {
      if (this.decals[i].active) activeDecals++;
    }
    let activeTracers = 0;
    for (let i = 0; i < this.tracers.length; i++) {
      if (this.tracers[i].active) activeTracers++;
    }
    let activeCasings = 0;
    for (let i = 0; i < this.casings.length; i++) {
      if (this.casings[i].active) activeCasings++;
    }
    this.debugStatsCache.activeProjectiles = activeProjectiles;
    this.debugStatsCache.activeParticles = activeParticles;
    this.debugStatsCache.activeDecals = activeDecals;
    this.debugStatsCache.activeTracers = activeTracers;
    this.debugStatsCache.activeCasings = activeCasings;
    return this.debugStatsCache;
  }

  public setQualityPreset(preset: QualityPreset): void {
    this.qualityPreset = preset;
    if (this.decalMesh) {
      const cap = this.getMaxDecals();
      _mat.makeScale(0, 0, 0);
      let cleared = false;
      for (let i = cap; i < MAX_DECAL_CAPACITY; i++) {
        if (this.decals[i].active) {
          this.decals[i].active = false;
          this.decalMesh.setMatrixAt(i, _mat);
          cleared = true;
        }
      }
      if (cleared) this.decalMesh.instanceMatrix.needsUpdate = true;
    }
  }

  public setMuzzlePositionProvider(provider: ((out: THREE.Vector3) => boolean) | null): void {
    this.muzzlePosProvider = provider;
  }

  private getMaxDecals(): number {
    const cap = QUALITY_SETTINGS[this.qualityPreset].maxDecals;
    return this.ctx?.isSoftwareGl ? Math.min(10, cap) : cap;
  }

  private getMaxParticles(): number {
    const cap = QUALITY_SETTINGS[this.qualityPreset].maxParticles;
    return this.ctx?.isSoftwareGl ? Math.min(36, Math.floor(cap * 0.5)) : cap;
  }

  private hideAllInstances(): void {
    _mat.makeScale(0, 0, 0);
    if (this.tracerMesh) {
      for (let i = 0; i < WEAPON_TRACER_POOL_SIZE; i++) this.tracerMesh.setMatrixAt(i, _mat);
      this.tracerMesh.instanceMatrix.needsUpdate = true;
    }
    if (this.casingMesh) {
      for (let i = 0; i < WEAPON_CASING_POOL_SIZE; i++) this.casingMesh.setMatrixAt(i, _mat);
      this.casingMesh.instanceMatrix.needsUpdate = true;
    }
    if (this.decalMesh) {
      for (let i = 0; i < MAX_DECAL_CAPACITY; i++) this.decalMesh.setMatrixAt(i, _mat);
      this.decalMesh.instanceMatrix.needsUpdate = true;
    }
    if (this.fxMesh) {
      for (let i = 0; i < MAX_PARTICLE_CAPACITY; i++) this.fxMesh.setMatrixAt(i, _mat);
      this.fxMesh.instanceMatrix.needsUpdate = true;
    }
  }

  public getWeaponEntry(weaponId: string): SavedWeaponAmmo | undefined {
    return this.ctx?.state.weapons.find((w) => w.id === weaponId);
  }

  public selectWeapon(weaponId: string): boolean {
    if (!this.ctx || !isWeaponId(weaponId)) return false;
    const entry = this.getWeaponEntry(weaponId);
    if (!entry) return false;
    if (this.ctx.state.activeWeaponId === weaponId) return true;

    const def = WEAPON_DEFS[weaponId];
    this.ctx.state.activeWeaponId = weaponId;

    // Trocar de arma cancela a recarga e entra em switching (0,35 s)
    this.reloadTimer = 0;
    this.switchTimer = def.switchSec;
    this.ctx.state.combat.reloading = false;
    this.ctx.state.combat.reloadProgress = 0;
    this.ctx.state.combat.switchProgress = def.switchSec > 0 ? 0 : 1;
    this.autoAccum = 0;
    this.fireCooldown = 0;
    this.wasFireHeld = false;
    this.currentSpreadBloom = 0;
    if (!def.isFirearm) {
      this.aimToggleActive = false;
      this.ctx.state.combat.aiming = false;
    }
    this.syncWeaponState();
    return true;
  }

  public cycleWeapon(delta: number): void {
    if (!this.ctx || delta === 0) return;
    const owned = WEAPON_LIST.filter((w) => this.getWeaponEntry(w.id));
    if (owned.length <= 1) return;
    const curIdx = Math.max(0, owned.findIndex((w) => w.id === this.ctx!.state.activeWeaponId));
    const nextIdx = (curIdx + delta + owned.length * 4) % owned.length;
    this.selectWeapon(owned[nextIdx].id);
  }

  public toggleShoulder(): void {
    if (!this.ctx) return;
    this.ctx.state.combat.shoulderSide = this.ctx.state.combat.shoulderSide === 1 ? -1 : 1;
  }

  public giveAllWeapons(): void {
    if (!this.ctx) return;
    const { state, audio, events } = this.ctx;
    for (const def of WEAPON_LIST) {
      const existing = state.weapons.find((w) => w.id === def.id);
      if (existing) {
        existing.clip = def.clipSize;
        existing.reserve = def.maxReserve;
      } else {
        state.weapons.push({
          id: def.id,
          clip: def.clipSize,
          reserve: def.maxReserve,
        });
      }
    }
    if (state.activeWeaponId === 'fists') {
      this.selectWeapon('pistol');
    }
    audio.playReload();
    events.emit('bannerRequested', { text: 'DEV: Todas as armas e munição adicionadas!', duration: 2.5 });
  }

  public setWeaponWheelOpen(open: boolean): void {
    if (!this.ctx) return;
    this.ctx.state.combat.weaponWheelOpen = open;
    if (open) {
      this.ctx.state.combat.gunShopOpen = false;
      this.aimToggleActive = false;
      this.ctx.state.combat.aiming = false;
    } else if (this.input.isActionHeld('weaponWheel')) {
      this.wheelClosedManually = true;
    }
    this.input.setUiModalOpen(open || this.ctx.state.combat.gunShopOpen);
  }

  public setGunShopOpen(open: boolean): void {
    if (!this.ctx) return;
    this.ctx.state.combat.gunShopOpen = open;
    if (open) {
      this.ctx.state.combat.weaponWheelOpen = false;
      this.aimToggleActive = false;
      this.ctx.state.combat.aiming = false;
      this.ctx.events.emit('shopOpened', { shopId: 'shop_gun', category: 'weapons' });
    }
    this.input.setUiModalOpen(open || this.ctx.state.combat.weaponWheelOpen);
  }

  public buyGunShopItem(itemId: string): { ok: boolean; message: string } {
    if (!this.ctx) return { ok: false, message: 'Sistema indisponível.' };
    const { state, events, audio } = this.ctx;

    const fail = (message: string) => {
      audio.playDryFire();
      events.emit('bannerRequested', { text: message, duration: 2.2 });
      return { ok: false, message };
    };

    if (itemId === 'armor') {
      if (state.armor >= PLAYER_MAX_ARMOR) {
        return fail('Colete já está em 100%.');
      }
      if (state.money < ARMOR_VEST_PRICE) {
        return fail(`Dinheiro insuficiente ($${ARMOR_VEST_PRICE} necessários).`);
      }
      state.money -= ARMOR_VEST_PRICE;
      state.armor = PLAYER_MAX_ARMOR;
      audio.playCashPickup();
      events.emit('purchaseMade', {
        shopId: 'shop_gun',
        itemId: 'armor',
        category: 'armor',
        price: ARMOR_VEST_PRICE,
      });
      events.emit('bannerRequested', { text: 'Colete balístico equipado!', duration: 2.2 });
      return { ok: true, message: 'Colete balístico equipado!' };
    }

    if (!isWeaponId(itemId) || itemId === 'fists') {
      return fail('Item inválido.');
    }

    const def = WEAPON_DEFS[itemId];
    const existing = state.weapons.find((w) => w.id === itemId);

    if (!existing) {
      if (state.money < def.price) {
        return fail(`Dinheiro insuficiente para ${def.shortName} ($${def.price}).`);
      }
      state.money -= def.price;
      state.weapons.push({
        id: itemId,
        clip: def.clipSize,
        reserve: Math.min(def.maxReserve, def.clipSize * 2),
      });
      this.selectWeapon(itemId);
      audio.playCashPickup();
      events.emit('purchaseMade', {
        shopId: 'shop_gun',
        itemId,
        category: def.category,
        price: def.price,
      });
      events.emit('bannerRequested', { text: `${def.name} adquirida e equipada!`, duration: 2.4 });
      return { ok: true, message: `${def.name} adquirida!` };
    }

    // Já possui a arma: compra pacote de munição
    if (existing.reserve >= def.maxReserve) {
      return fail('Munição no limite máximo.');
    }
    if (state.money < def.ammoPackPrice) {
      return fail(`Dinheiro insuficiente para munição ($${def.ammoPackPrice}).`);
    }
    state.money -= def.ammoPackPrice;
    existing.reserve = Math.min(def.maxReserve, existing.reserve + def.ammoPackAmount);
    audio.playReload();
    events.emit('purchaseMade', {
      shopId: 'shop_gun',
      itemId: `${itemId}_ammo`,
      category: 'ammo',
      price: def.ammoPackPrice,
    });
    events.emit('bannerRequested', {
      text: `+${def.ammoPackAmount} munições para ${def.shortName}!`,
      duration: 2.0,
    });
    return { ok: true, message: `+${def.ammoPackAmount} munições para ${def.shortName}!` };
  }

  public damagePlayer(
    amount: number,
    source: string
  ): { healthLost: number; armorAbsorbed: number; died: boolean } {
    if (!this.ctx || amount <= 0 || this.ctx.state.health <= 0) {
      return { healthLost: 0, armorAbsorbed: 0, died: false };
    }
    const { state, events, audio, groundHeightAt } = this.ctx;

    // Colete absorve até 65% do dano enquanto houver carga
    const armorAbsorbed = state.armor > 0 ? Math.min(state.armor, amount * 0.65) : 0;
    state.armor = Math.max(0, state.armor - armorAbsorbed);

    const healthLost = Math.max(0, amount - armorAbsorbed);
    state.health = Math.max(0, state.health - healthLost);
    state.cameraShake = Math.max(state.cameraShake, Math.min(0.45, 0.1 + healthLost * 0.008));

    events.emit('playerDamaged', {
      amount: Math.round(healthLost * 10) / 10,
      armorAbsorbed: Math.round(armorAbsorbed * 10) / 10,
      source,
    });

    if (state.health <= 0) {
      const hospitalFee = Math.min(state.money, 150);
      state.money -= hospitalFee;
      const deathX = state.playerPos.x;
      const deathZ = state.playerPos.z;
      events.emit('playerDied', { hospitalFee, x: deathX, z: deathZ });

      if (state.currentVehicle) {
        state.currentVehicle.driver = 'none';
        state.currentVehicle = null;
      }
      this.cancelReload();
      this.aimToggleActive = false;
      state.combat.aiming = false;
      state.health = PLAYER_MAX_HEALTH;
      state.playerPos.set(-96, groundHeightAt(-96, 32), 32);
      state.playerVelX = 0;
      state.playerVelY = 0;
      state.playerVelZ = 0;
      audio.playBusted();
      events.emit('bannerRequested', {
        text: `Nocauteado! Atendimento no Hospital Santa Maré (-$${hospitalFee}).`,
        duration: 4.0,
      });
      return { healthLost, armorAbsorbed, died: true };
    }

    audio.playImpact(0.45);
    return { healthLost, armorAbsorbed, died: false };
  }

  public update(dt: number): void {
    if (!this.ctx) return;
    const { state } = this.ctx;

    if (this.switchTimer > 0) this.switchTimer = Math.max(0, this.switchTimer - dt);
    if (this.fireCooldown > 0) this.fireCooldown = Math.max(0, this.fireCooldown - dt);
    if (this.shootingCrimeCooldown > 0) this.shootingCrimeCooldown = Math.max(0, this.shootingCrimeCooldown - dt);
    if (this.panicThrottleTimer > 0) {
      this.panicThrottleTimer = Math.max(0, this.panicThrottleTimer - dt);
      if (this.panicThrottleTimer === 0) this.lastPanicRadius = 0;
    }
    if (state.combat.recoilKickTimer > 0) state.combat.recoilKickTimer = Math.max(0, state.combat.recoilKickTimer - dt);
    if (state.combat.meleeSwingTimer > 0) state.combat.meleeSwingTimer = Math.max(0, state.combat.meleeSwingTimer - dt);
    if (state.combat.hitMarkerTimer > 0) state.combat.hitMarkerTimer = Math.max(0, state.combat.hitMarkerTimer - dt);

    const vehicleBusy = state.currentVehicle !== null || Boolean(state.vehicleAccess?.active);

    // Proximidade da Armaria Maré Forte (shop_gun)
    const shopDx = state.playerPos.x - this.gunShopPos.x;
    const shopDz = state.playerPos.z - this.gunShopPos.z;
    const nearShop =
      !vehicleBusy &&
      shopDx * shopDx + shopDz * shopDz <= GUN_SHOP_INTERACT_RADIUS * GUN_SHOP_INTERACT_RADIUS;
    state.combat.nearGunShop = nearShop;

    if (nearShop && this.input.consumeAction('interact')) {
      this.setGunShopOpen(!state.combat.gunShopOpen);
    } else if (!nearShop && state.combat.gunShopOpen) {
      this.setGunShopOpen(false);
    }

    this.input.consumeAction('weaponWheel');
    const wheelKeyHeld = this.input.isActionHeld('weaponWheel');
    if (!wheelKeyHeld) {
      this.wheelClosedManually = false;
    }
    const shouldWheelOpen =
      !vehicleBusy &&
      !state.combat.gunShopOpen &&
      wheelKeyHeld &&
      !this.wheelClosedManually;
    if (shouldWheelOpen !== state.combat.weaponWheelOpen) {
      this.setWeaponWheelOpen(shouldWheelOpen);
    }

    // Troca por teclas 1..5
    const slotActions = ['weaponSlot1', 'weaponSlot2', 'weaponSlot3', 'weaponSlot4', 'weaponSlot5'] as const;
    for (let i = 0; i < slotActions.length; i++) {
      if (this.input.consumeAction(slotActions[i])) {
        const targetId = WEAPON_BY_SLOT[i + 1];
        if (targetId) this.selectWeapon(targetId);
      }
    }

    const cycleDelta = this.input.consumeWeaponCycleDelta();
    if (cycleDelta !== 0) {
      this.cycleWeapon(cycleDelta);
    }

    // Em veículo, em animação de embarque ou em modal, não atira nem mira a pé
    const modalOpen = state.combat.gunShopOpen || state.combat.weaponWheelOpen;
    if (vehicleBusy || modalOpen) {
      this.aimToggleActive = false;
      state.combat.aiming = false;
      this.wasFireHeld = false;
      this.pendingFirePressed = false;
      this.pendingFireHeld = false;
      this.pendingMeleePressed = false;
      this.autoAccum = 0;
      this.syncWeaponState();
      return;
    }

    const weaponDef = getWeaponDef(state.activeWeaponId);
    const { forward, strafe } = this.input.getMoveAxes();
    const movingRatio = Math.min(1, Math.hypot(forward, strafe));
    const sprintingNow = this.input.isSprinting() && movingRatio > 0.05;

    // Atualiza modo de mira (hold vs toggle); sprint cancela a mira
    if (!weaponDef.isFirearm || sprintingNow) {
      this.aimToggleActive = false;
      state.combat.aiming = false;
    } else if (this.cameraRig.aimMode === 'toggle') {
      if (this.input.consumeAction('aim')) {
        this.aimToggleActive = !this.aimToggleActive;
      }
      state.combat.aiming = this.aimToggleActive;
    } else {
      state.combat.aiming = this.input.isAimHeld();
    }

    // Recarga (só se clip < pente e reserve > 0, e não trocando de arma)
    const entry = this.getWeaponEntry(weaponDef.id);
    if (weaponDef.isFirearm && entry && this.switchTimer <= 0) {
      if (this.input.consumeAction('reload')) {
        this.tryStartReload(weaponDef, entry);
      }
      if (this.reloadTimer > 0) {
        this.reloadTimer -= dt;
        state.combat.reloading = true;
        state.combat.reloadProgress = Math.min(1, 1 - this.reloadTimer / Math.max(0.1, weaponDef.reloadSec));
        if (this.reloadTimer <= 0) {
          this.stepReloadComplete(weaponDef, entry);
        }
      }
    } else if (!weaponDef.isFirearm) {
      this.reloadTimer = 0;
      state.combat.reloading = false;
      state.combat.reloadProgress = 0;
    }

    // Armazena intenções de disparo / corpo a corpo para executar em lateUpdate(dt) após cameraRig.update
    if (this.input.consumeAction('melee')) {
      this.pendingMeleePressed = true;
    }
    if (this.input.consumeAction('fire')) {
      this.pendingFirePressed = true;
    }
    this.pendingFireHeld = this.input.isFireHeld();

    // Dispersão dinâmica: menor mirando, aumenta correndo/pulando e com bloom por tiro
    this.currentSpreadBloom = Math.max(0, this.currentSpreadBloom - dt * weaponDef.spreadRecovery);
    const baseSpread = state.combat.aiming ? weaponDef.spreadAim : weaponDef.spreadHip;
    const runPenalty = movingRatio * weaponDef.spreadMovePenalty * (sprintingNow ? 1.45 : 1.0);
    const airPenalty = !state.isGrounded ? weaponDef.spreadMovePenalty * 1.5 : 0;
    state.combat.spreadAngle = Math.min(
      weaponDef.maxSpread,
      baseSpread + runPenalty + airPenalty + this.currentSpreadBloom
    );
    this.syncWeaponState();
  }

  /**
   * Executado em engine.ts logo após cameraRig.update(dt), garantindo raio central
   * sem atraso de 1 frame e correção de paralaxe cano -> ponto-alvo.
   */
  public lateUpdate(dt: number): void {
    if (!this.ctx) return;
    const { state } = this.ctx;
    const modalOpen = state.combat.gunShopOpen || state.combat.weaponWheelOpen;

    if (state.currentVehicle === null && !modalOpen && this.switchTimer <= 0) {
      if (this.pendingMeleePressed) {
        if (this.fireCooldown <= 0) {
          this.performMeleeAttack();
          this.fireCooldown = 60 / WEAPON_DEFS.fists.rpm;
        }
        this.pendingMeleePressed = false;
      }

      const weaponDef = getWeaponDef(state.activeWeaponId);
      const entry = this.getWeaponEntry(weaponDef.id);
      this.handleFiringInput(dt, weaponDef, entry, this.pendingFirePressed, this.pendingFireHeld);
      this.pendingFirePressed = false;
    } else {
      this.pendingFirePressed = false;
      this.pendingMeleePressed = false;
    }

    this.stepProjectilesAndFx(dt);
    this.syncWeaponState();
  }

  private syncWeaponState(): void {
    if (!this.ctx) return;
    const { combat, activeWeaponId } = this.ctx.state;
    const switchDur = Math.max(0.05, getWeaponDef(activeWeaponId).switchSec);
    if (this.switchTimer > 0) {
      combat.weaponState = 'switching';
      combat.switchProgress = Math.min(1, Math.max(0, 1 - this.switchTimer / switchDur));
    } else if (this.reloadTimer > 0) {
      combat.weaponState = 'reloading';
      combat.switchProgress = 1;
    } else if (this.fireCooldown > 0 || combat.recoilKickTimer > 0 || combat.meleeSwingTimer > 0) {
      combat.weaponState = 'firing';
      combat.switchProgress = 1;
    } else {
      combat.weaponState = 'idle';
      combat.switchProgress = 1;
    }
  }

  private tryStartReload(def: WeaponDef, entry: SavedWeaponAmmo): void {
    if (!this.ctx || !def.isFirearm || this.switchTimer > 0 || this.reloadTimer > 0) return;
    if (entry.clip >= def.clipSize || entry.reserve <= 0) return;
    this.reloadTimer = def.reloadSec;
    this.ctx.state.combat.reloading = true;
    this.ctx.state.combat.reloadProgress = 0;
    this.ctx.audio.playReload(def.reloadMode === 'shell' ? 'shell' : 'mag');
  }

  private cancelReload(): void {
    this.reloadTimer = 0;
    if (this.ctx) {
      this.ctx.state.combat.reloading = false;
      this.ctx.state.combat.reloadProgress = 0;
    }
  }

  private stepReloadComplete(def: WeaponDef, entry: SavedWeaponAmmo): void {
    if (!this.ctx) return;
    if (def.reloadMode === 'shell') {
      if (entry.clip < def.clipSize && entry.reserve > 0) {
        entry.clip += 1;
        entry.reserve -= 1;
      }
      if (entry.clip < def.clipSize && entry.reserve > 0) {
        // Continua recarregando o próximo cartucho (0,55s/cartucho)
        this.reloadTimer = def.reloadSec;
        this.ctx.state.combat.reloading = true;
        this.ctx.state.combat.reloadProgress = 0;
        this.ctx.audio.playReload('shell');
        return;
      }
    } else {
      const needed = def.clipSize - entry.clip;
      const loaded = Math.min(needed, entry.reserve);
      entry.clip += loaded;
      entry.reserve -= loaded;
    }
    this.cancelReload();
  }

  private handleFiringInput(
    dt: number,
    def: WeaponDef,
    entry: SavedWeaponAmmo | undefined,
    firePressed: boolean,
    fireHeld: boolean
  ): void {
    if (!def.isFirearm) {
      if (firePressed && this.fireCooldown <= 0) {
        this.performMeleeAttack();
        this.fireCooldown = 60 / def.rpm;
      }
      this.wasFireHeld = fireHeld;
      this.autoAccum = 0;
      return;
    }

    // Escopeta (cartucho a cartucho) pode ser interrompida atirando se já houver cartucho no pente
    const wantsFire = firePressed || (fireHeld && !this.wasFireHeld);
    if (this.reloadTimer > 0) {
      if (def.reloadMode === 'shell' && wantsFire && entry && entry.clip > 0) {
        this.cancelReload();
      } else {
        this.wasFireHeld = fireHeld;
        this.autoAccum = 0;
        return;
      }
    }

    const shotInterval = 60 / def.rpm;

    if (def.fireMode === 'semi') {
      if (firePressed && this.fireCooldown <= 0) {
        const fired = this.fireSingleShot(def, entry, true);
        this.fireCooldown = fired ? shotInterval : 0.08;
      }
      this.wasFireHeld = fireHeld;
      this.autoAccum = 0;
      return;
    }

    // Modo automático com acumulador de tempo por RPM
    if (fireHeld || firePressed) {
      if ((firePressed || !this.wasFireHeld) && this.fireCooldown <= 0) {
        const fired = this.fireSingleShot(def, entry, true);
        this.autoAccum = 0;
        this.fireCooldown = fired ? shotInterval : 0.08;
      } else if (entry && entry.clip > 0) {
        this.autoAccum += dt;
        let shots = 0;
        while (this.autoAccum >= shotInterval && shots < 4) {
          this.autoAccum -= shotInterval;
          if (!this.fireSingleShot(def, entry, false)) break;
          shots++;
        }
      }
    } else {
      this.autoAccum = 0;
    }

    this.wasFireHeld = fireHeld;
  }

  private fireSingleShot(def: WeaponDef, entry: SavedWeaponAmmo | undefined, allowDryClickSound: boolean): boolean {
    if (!this.ctx || !entry) return false;
    if (entry.clip <= 0) {
      if (allowDryClickSound) {
        this.ctx.audio.playDryFire();
      }
      if (entry.reserve > 0) {
        this.tryStartReload(def, entry);
      }
      return false;
    }

    const { state, audio, events, crowd, vehicles, groundHeightAt } = this.ctx;
    entry.clip--;
    state.combat.recoilKickTimer = 0.14;

    // 1. Raio central da câmera pelo centro da tela até 150 m (ou alcance da arma)
    this.cameraRig.getAimRay(_aimOrigin, _aimDir);
    const aimRayDist = Math.max(CAM_TPS_AIM_RAY_DIST, def.range);
    const farX = _aimOrigin.x + _aimDir.x * aimRayDist;
    const farY = _aimOrigin.y + _aimDir.y * aimRayDist;
    const farZ = _aimOrigin.z + _aimDir.z * aimRayDist;

    const midX = (_aimOrigin.x + farX) * 0.5;
    const midZ = (_aimOrigin.z + farZ) * 0.5;
    crowd.queryRadiusIndices(midX, midZ, aimRayDist * 0.55 + 8, this.npcQueryBuf);

    if (
      this.indexedBuildingsRef !== this.ctx.world.buildings ||
      this.indexedBuildingCount !== this.ctx.world.buildings.length
    ) {
      if (this.buildingGrid) this.buildingGrid.rebuild(this.ctx.world.buildings);
      else this.buildingGrid = new BuildingSpatialGrid(this.ctx.world.buildings, 32);
      this.indexedBuildingsRef = this.ctx.world.buildings;
      this.indexedBuildingCount = this.ctx.world.buildings.length;
    }

    const aimHit = castBallisticSegment(
      _aimOrigin.x,
      _aimOrigin.y,
      _aimOrigin.z,
      farX,
      farY,
      farZ,
      {
        buildings: this.ctx.world.buildings,
        buildingGrid: this.buildingGrid ?? undefined,
        vehicles,
        ignoreVehicleId: null,
        agents: crowd.agents,
        candidateNpcIndices: this.npcQueryBuf,
        groundHeightAt,
      },
      _hit
    );

    if (aimHit.hit) {
      _aimTarget.set(aimHit.x, aimHit.y, aimHit.z);
    } else {
      _aimTarget.set(farX, farY, farZ);
    }

    // 2. Posição real do cano + correção de paralaxe (com fallback para direção da câmera se alvo atrás do cano)
    const fwdX = Math.sin(state.playerYaw);
    const fwdZ = Math.cos(state.playerYaw);
    const rightX = Math.cos(state.playerYaw);
    const rightZ = -Math.sin(state.playerYaw);
    if (!this.muzzlePosProvider || !this.muzzlePosProvider(_muzzlePos)) {
      _muzzlePos.set(
        state.playerPos.x + fwdX * 0.55 + rightX * 0.28,
        state.playerPos.y + 1.4,
        state.playerPos.z + fwdZ * 0.55 + rightZ * 0.28
      );
    }

    _toTarget.subVectors(_aimTarget, _muzzlePos);
    if (_toTarget.dot(_aimDir) <= 0.25 || _toTarget.lengthSq() < 0.04) {
      _dir.copy(_aimDir);
    } else {
      _dir.copy(_toTarget).normalize();
    }

    const spreadRad = state.combat.spreadAngle;
    this.tracerShotCounter++;
    const tracerStep = def.id === 'smg' ? 3 : 2;
    const shotHasTracer = def.pellets > 1 ? false : this.tracerShotCounter % tracerStep === 1;
    for (let p = 0; p < def.pellets; p++) {
      computeSpreadDirection(
        _dir.x,
        _dir.y,
        _dir.z,
        spreadRad,
        Math.random() * Math.PI * 2,
        Math.random(),
        _spreadDir
      );
      const pelletTracer = def.pellets > 1 ? p % 4 === 0 : shotHasTracer;
      this.spawnProjectile(
        def,
        _muzzlePos.x,
        _muzzlePos.y,
        _muzzlePos.z,
        _spreadDir.x,
        _spreadDir.y,
        _spreadDir.z,
        'player',
        pelletTracer
      );
    }

    // Flash no cano (sprite + PointLight compartilhada), ejeção de estojo, recuo, tremor leve e som
    this.triggerMuzzleFlash(def.id, _muzzlePos.x, _muzzlePos.y, _muzzlePos.z);
    this.spawnCasing(_muzzlePos.x - fwdX * 0.22, _muzzlePos.y, _muzzlePos.z - fwdZ * 0.22, rightX, rightZ);
    const yawJitter = (Math.random() - 0.5) * 2 * def.recoilYaw;
    this.cameraRig.applyRecoil(def.recoilPitch, yawJitter);
    this.currentSpreadBloom = Math.min(def.maxSpread, this.currentSpreadBloom + def.spreadPerShot);

    const shakeBase = def.id === 'shotgun' ? 0.055 : def.id === 'rifle' ? 0.032 : def.id === 'pistol' ? 0.022 : 0.016;
    state.cameraShake = Math.max(state.cameraShake, shakeBase * (state.combat.aiming ? 0.7 : 1.0));

    audio.playGunshot(def.id);
    this.triggerPanicThrottled(state.playerPos.x, state.playerPos.z, def.noiseRadius);

    events.emit('weaponFired', {
      weaponId: def.id,
      originX: _muzzlePos.x,
      originY: _muzzlePos.y,
      originZ: _muzzlePos.z,
      dirX: _dir.x,
      dirY: _dir.y,
      dirZ: _dir.z,
    });

    // Testemunhas próximas / polícia ouvem disparo em área urbana -> 1★ com cooldown
    const witnesses = crowd.queryRadiusIndices(
      state.playerPos.x,
      state.playerPos.z,
      def.noiseRadius * 0.45,
      this.witnessQueryBuf
    );
    let sawCop = false;
    for (let i = 0; i < vehicles.length; i++) {
      const v = vehicles[i];
      if (v.driver === 'police' && Math.hypot(v.x - state.playerPos.x, v.z - state.playerPos.z) < 60) {
        sawCop = true;
        break;
      }
    }
    if (witnesses.length > 0 || sawCop) {
      this.emitShootingCrime(1, sawCop ? 'Polícia ouviu disparos!' : 'Disparos em público reportados!');
    }

    if (entry.clip === 0 && entry.reserve > 0 && def.fireMode === 'auto') {
      this.tryStartReload(def, entry);
    }
    return true;
  }

  private triggerPanicThrottled(x: number, z: number, radius: number): void {
    if (!this.ctx) return;
    if (this.panicThrottleTimer > 0 && radius <= this.lastPanicRadius) return;
    this.panicThrottleTimer = 0.35;
    this.lastPanicRadius = radius;
    this.ctx.crowd.triggerPanicRadius(x, z, radius);
  }

  private emitShootingCrime(minStars: number, reason: string): void {
    if (!this.ctx) return;
    if (this.shootingCrimeCooldown > 0 && minStars <= this.lastShootingCrimeStars) {
      return;
    }
    this.lastShootingCrimeStars = Math.max(this.lastShootingCrimeStars, minStars);
    this.shootingCrimeCooldown = 6.0;
    this.ctx.events.emit('crimeCommitted', {
      minStars,
      reason,
      source: 'shooting',
    });
  }

  private performMeleeAttack(): void {
    if (!this.ctx) return;
    const { state, audio, crowd, events } = this.ctx;
    const def = WEAPON_DEFS.fists;
    state.combat.meleeSwingTimer = 0.28;
    audio.playMeleeSwing();

    const fwdX = Math.sin(state.playerYaw);
    const fwdZ = Math.cos(state.playerYaw);
    const candidates = crowd.queryRadiusIndices(
      state.playerPos.x + fwdX * (def.range * 0.5),
      state.playerPos.z + fwdZ * (def.range * 0.5),
      def.range * 0.75 + 0.6,
      this.npcQueryBuf
    );

    let bestIdx = -1;
    let bestD2 = def.range * def.range;
    for (let i = 0; i < candidates.length; i++) {
      const npc = crowd.agents[candidates[i]];
      if (!npc || !npc.active || npc.insideBuilding || npc.ragdollActive || npc.injuryStatus === 'out') continue;
      const dx = npc.x - state.playerPos.x;
      const dz = npc.z - state.playerPos.z;
      const d2 = dx * dx + dz * dz;
      const d = Math.sqrt(d2) || 1;
      const dot = (dx / d) * fwdX + (dz / d) * fwdZ;
      if ((dot >= 0.35 || d < 0.35) && d2 <= bestD2) {
        bestD2 = d2;
        bestIdx = npc.index;
      }
    }

    if (bestIdx >= 0) {
      const npc = crowd.agents[bestIdx];
      this.applyNpcDamage(def, npc.index, def.damage, false, 1.0, npc.x, npc.y + 1.25, npc.z, fwdX, 0.25, fwdZ);
      audio.playImpact(0.65);
      events.emit('crimeCommitted', {
        minStars: 1,
        reason: 'Agressão reportada!',
        source: 'assault',
      });
    }
  }

  private spawnProjectile(
    def: WeaponDef,
    x: number,
    y: number,
    z: number,
    dx: number,
    dy: number,
    dz: number,
    ownerKind: ProjectileOwnerKind = 'player',
    hasTracer = true
  ): void {
    const state = this.ctx?.state;
    let slot = this.projectiles.find((p) => !p.active);
    if (!slot) slot = this.projectiles[0];
    slot.active = true;
    slot.ownerKind = ownerKind;
    slot.weaponId = def.id;
    slot.x = x;
    slot.y = y;
    slot.z = z;
    // Velocidade inicial = direção * velocidade do projétil + 30% da velocidade do jogador
    const inheritScale = ownerKind === 'player' && state ? 0.3 : 0;
    slot.vx = dx * def.muzzleSpeed + (state ? state.playerVelX * inheritScale : 0);
    slot.vy = dy * def.muzzleSpeed + (state ? state.playerVelY * inheritScale : 0);
    slot.vz = dz * def.muzzleSpeed + (state ? state.playerVelZ * inheritScale : 0);
    slot.gravity = def.gravity;
    slot.drag = def.drag;
    slot.damage = def.damage;
    slot.headshotMul = def.headshotMul;
    slot.limbMul = def.limbMul;
    slot.falloffStart = def.falloffStart;
    slot.falloffMinMul = def.falloffMinMul;
    slot.impulseStrength = def.impulseStrength;
    slot.traveled = 0;
    slot.maxRange = def.range;
    slot.age = 0;
    slot.maxLife = Math.max(0.45, (def.range / Math.max(40, def.muzzleSpeed)) * 2.4 + 0.35);
    slot.ricocheted = false;
    slot.tracerColorHex = def.tracerColorHex;
    slot.hasTracer = hasTracer;
    slot.flybyPlayed = false;
  }

  private triggerMuzzleFlash(weaponId: string, x: number, y: number, z: number): void {
    this.muzzleFlashDuration = this.ctx?.isSoftwareGl ? 0.04 : 0.055;
    this.muzzleFlashTimer = this.muzzleFlashDuration;
    this.muzzleFlashBaseScale = weaponId === 'shotgun' ? 0.64 : weaponId === 'rifle' ? 0.52 : weaponId === 'smg' ? 0.42 : 0.36;
    this.muzzleLightBaseIntensity = weaponId === 'shotgun' ? 4.2 : weaponId === 'rifle' ? 3.6 : 2.8;

    if (this.muzzleFlashSprite) {
      this.muzzleFlashSprite.position.set(x, y, z);
      this.muzzleFlashSprite.scale.setScalar(this.muzzleFlashBaseScale);
      (this.muzzleFlashSprite.material as THREE.SpriteMaterial).rotation = Math.random() * Math.PI * 2;
      (this.muzzleFlashSprite.material as THREE.SpriteMaterial).opacity = 0.95;
      this.muzzleFlashSprite.visible = true;
    }
    if (this.muzzleLight) {
      this.muzzleLight.position.set(x, y, z);
      this.muzzleLight.intensity = this.muzzleLightBaseIntensity;
      this.muzzleLight.visible = true;
    }
  }

  private stepProjectilesAndFx(dt: number): void {
    if (!this.ctx) return;
    const { world, vehicles, crowd, groundHeightAt, camera, audio } = this.ctx;

    // Atualiza flash do cano (sprite + PointLight única compartilhada)
    if (this.muzzleFlashTimer > 0) {
      this.muzzleFlashTimer = Math.max(0, this.muzzleFlashTimer - dt);
      const t = this.muzzleFlashDuration > 0 ? this.muzzleFlashTimer / this.muzzleFlashDuration : 0;
      const hasLiveMuzzle = this.muzzleFlashTimer > 0 && this.muzzlePosProvider?.(_muzzlePos);
      if (this.muzzleFlashSprite) {
        if (this.muzzleFlashTimer > 0) {
          if (hasLiveMuzzle) this.muzzleFlashSprite.position.copy(_muzzlePos);
          this.muzzleFlashSprite.scale.setScalar(this.muzzleFlashBaseScale * (0.55 + 0.45 * t));
          (this.muzzleFlashSprite.material as THREE.SpriteMaterial).opacity = t * 0.95;
        } else {
          this.muzzleFlashSprite.visible = false;
        }
      }
      if (this.muzzleLight) {
        if (this.muzzleFlashTimer > 0) {
          if (hasLiveMuzzle) this.muzzleLight.position.copy(_muzzlePos);
          this.muzzleLight.intensity = this.muzzleLightBaseIntensity * t;
        } else {
          this.muzzleLight.intensity = 0;
          this.muzzleLight.visible = false;
        }
      }
    }

    if (this.indexedBuildingsRef !== world.buildings || this.indexedBuildingCount !== world.buildings.length) {
      if (this.buildingGrid) this.buildingGrid.rebuild(world.buildings);
      else this.buildingGrid = new BuildingSpatialGrid(world.buildings, 32);
      this.indexedBuildingsRef = world.buildings;
      this.indexedBuildingCount = world.buildings.length;
    }

    // 1. Atualiza projéteis em passos fixos de 1/120 s (máx. 8 passos/frame)
    this.physicsAccum += dt;
    let fixedSteps = 0;
    while (this.physicsAccum >= BALLISTICS_FIXED_STEP && fixedSteps < BALLISTICS_MAX_STEPS_PER_FRAME) {
      this.physicsAccum -= BALLISTICS_FIXED_STEP;
      fixedSteps++;

      for (let i = 0; i < this.projectiles.length; i++) {
        const p = this.projectiles[i];
        if (!p.active) continue;

        const x0 = p.x;
        const y0 = p.y;
        const z0 = p.z;
        const segLen = advanceProjectileStep(p, BALLISTICS_FIXED_STEP, _nextPos);

        // Passagem de bala próxima à câmera/jogador (ricochetes ou tiros de terceiros)
        if (!p.flybyPlayed && (p.ownerKind !== 'player' || p.ricocheted)) {
          const sx = _nextPos.x - x0;
          const sy = _nextPos.y - y0;
          const sz = _nextPos.z - z0;
          const sLen2 = sx * sx + sy * sy + sz * sz;
          if (sLen2 > 1e-6) {
            const cx = camera.position.x - x0;
            const cy = camera.position.y - y0;
            const cz = camera.position.z - z0;
            const projT = Math.max(0, Math.min(1, (cx * sx + cy * sy + cz * sz) / sLen2));
            const px = x0 + sx * projT - camera.position.x;
            const py = y0 + sy * projT - camera.position.y;
            const pz = z0 + sz * projT - camera.position.z;
            const d2 = px * px + py * py + pz * pz;
            if (d2 < 3.8 * 3.8 && d2 > 0.25 * 0.25) {
              p.flybyPlayed = true;
              const rightX = Math.cos(this.cameraRig.camYaw);
              const rightZ = -Math.sin(this.cameraRig.camYaw);
              const pan = (px * rightX + pz * rightZ) / Math.max(0.5, Math.sqrt(d2));
              audio.playBulletFlyby(pan);
            }
          }
        }

        const midX = (x0 + _nextPos.x) * 0.5;
        const midZ = (z0 + _nextPos.z) * 0.5;
        crowd.queryRadiusIndices(midX, midZ, segLen * 0.5 + 3.0, this.npcQueryBuf);

        const hit = castBallisticSegment(
          x0,
          y0,
          z0,
          _nextPos.x,
          _nextPos.y,
          _nextPos.z,
          {
            buildings: world.buildings,
            buildingGrid: this.buildingGrid ?? undefined,
            vehicles,
            ignoreVehicleId: null,
            agents: crowd.agents,
            candidateNpcIndices: this.npcQueryBuf,
            groundHeightAt,
          },
          _hit
        );

        if (hit.hit) {
          if (p.hasTracer !== false) {
            this.spawnTracer(x0, y0, z0, hit.x, hit.y, hit.z, p.tracerColorHex);
          }
          const trajColor =
            hit.kind === 'npc' && hit.region === 'head'
              ? 0xff2e93
              : hit.kind === 'npc' || hit.kind === 'vehicle'
              ? 0xfacc15
              : 0xf97316;
          this.recordTrajectorySegment(x0, y0, z0, hit.x, hit.y, hit.z, trajColor);
          this.resolveProjectileImpact(p, hit);
          if (tryApplyRicochet(p, hit)) {
            audio.playBulletImpact('metal', p.traveled / Math.max(1, p.maxRange));
            if (p.traveled >= p.maxRange || p.age >= p.maxLife) {
              p.active = false;
            }
          } else {
            p.active = false;
          }
        } else {
          if (p.hasTracer !== false) {
            this.spawnTracer(x0, y0, z0, _nextPos.x, _nextPos.y, _nextPos.z, p.tracerColorHex);
          }
          this.recordTrajectorySegment(
            x0,
            y0,
            z0,
            _nextPos.x,
            _nextPos.y,
            _nextPos.z,
            p.ricocheted ? 0xa855f7 : 0x38bdf8
          );
          p.x = _nextPos.x;
          p.y = _nextPos.y;
          p.z = _nextPos.z;
          if (p.traveled >= p.maxRange || p.age >= p.maxLife || p.y < -15) {
            p.active = false;
          }
        }
      }
    }
    if (fixedSteps === BALLISTICS_MAX_STEPS_PER_FRAME && this.physicsAccum > BALLISTICS_FIXED_STEP) {
      this.physicsAccum = BALLISTICS_FIXED_STEP;
    }

    // 2. Atualiza tracers
    if (this.tracerMesh) {
      let dirty = false;
      for (let i = 0; i < this.tracers.length; i++) {
        const t = this.tracers[i];
        if (!t.active) continue;
        dirty = true;
        t.age += dt;
        if (t.age >= t.life) {
          t.active = false;
          _mat.makeScale(0, 0, 0);
          this.tracerMesh.setMatrixAt(i, _mat);
          continue;
        }
        const len = Math.hypot(t.x1 - t.x0, t.y1 - t.y0, t.z1 - t.z0);
        if (len < 0.02) {
          _mat.makeScale(0, 0, 0);
          this.tracerMesh.setMatrixAt(i, _mat);
          continue;
        }
        _pos.set((t.x0 + t.x1) * 0.5, (t.y0 + t.y1) * 0.5, (t.z0 + t.z1) * 0.5);
        _dir.set(t.x1 - t.x0, t.y1 - t.y0, t.z1 - t.z0).normalize();
        _quat.setFromUnitVectors(_zAxis, _dir);
        const fade = 1 - t.age / t.life;
        _scale.set(fade, fade, Math.min(len, 14));
        _mat.compose(_pos, _quat, _scale);
        this.tracerMesh.setMatrixAt(i, _mat);
        this.tracerMesh.setColorAt(i, _color.setHex(t.colorHex));
      }
      if (dirty) {
        this.tracerMesh.instanceMatrix.needsUpdate = true;
        if (this.tracerMesh.instanceColor) this.tracerMesh.instanceColor.needsUpdate = true;
      }
    }

    // 3. Atualiza estojos ejetados (gravidade, quique e atrito até assentar)
    if (this.casingMesh) {
      let dirty = false;
      for (let i = 0; i < this.casings.length; i++) {
        const c = this.casings[i];
        if (!c.active) continue;
        dirty = true;
        c.age += dt;
        if (c.age >= c.life) {
          c.active = false;
          _mat.makeScale(0, 0, 0);
          this.casingMesh.setMatrixAt(i, _mat);
          continue;
        }
        c.vy -= 14.0 * dt;
        c.x += c.vx * dt;
        c.y += c.vy * dt;
        c.z += c.vz * dt;
        const floor = groundHeightAt(c.x, c.z, c.y) + 0.02;
        if (c.y <= floor) {
          c.y = floor;
          if (Math.abs(c.vy) < 0.45) {
            c.vy = 0;
            c.vx *= 0.84;
            c.vz *= 0.84;
          } else {
            c.vy = Math.abs(c.vy) * 0.35;
            c.vx *= 0.65;
            c.vz *= 0.65;
            c.rx += dt * 15;
            c.ry += dt * 11;
          }
        } else {
          c.rx += dt * 15;
          c.ry += dt * 11;
        }
        _pos.set(c.x, c.y, c.z);
        _euler.set(c.rx, c.ry, c.rz);
        _quat.setFromEuler(_euler);
        const s = c.age > c.life * 0.8 ? (1 - c.age / c.life) * 5 : 1;
        _scale.set(s, s, s);
        _mat.compose(_pos, _quat, _scale);
        this.casingMesh.setMatrixAt(i, _mat);
      }
      if (dirty) this.casingMesh.instanceMatrix.needsUpdate = true;
    }

    // 4. Atualiza partículas cartoon de impacto (faíscas, poeira, estrelinhas)
    if (this.fxMesh) {
      let dirty = false;
      for (let i = 0; i < this.particles.length; i++) {
        const pt = this.particles[i];
        if (!pt.active) continue;
        dirty = true;
        pt.age += dt;
        if (pt.age >= pt.life) {
          pt.active = false;
          _mat.makeScale(0, 0, 0);
          this.fxMesh.setMatrixAt(i, _mat);
          continue;
        }
        pt.vy -= pt.gravity * dt;
        pt.x += pt.vx * dt;
        pt.y += pt.vy * dt;
        pt.z += pt.vz * dt;
        const s = pt.scale * (1 - pt.age / pt.life);
        _pos.set(pt.x, pt.y, pt.z);
        _euler.set(pt.age * 10, pt.age * 12, 0);
        _quat.setFromEuler(_euler);
        _scale.set(s, s, s);
        _mat.compose(_pos, _quat, _scale);
        this.fxMesh.setMatrixAt(i, _mat);
        this.fxMesh.setColorAt(i, _color.setHex(pt.colorHex));
      }
      if (dirty) {
        this.fxMesh.instanceMatrix.needsUpdate = true;
        if (this.fxMesh.instanceColor) this.fxMesh.instanceColor.needsUpdate = true;
      }
    }

    // 5. Atualiza desvanecimento dos decais no ring buffer
    if (this.decalMesh) {
      let dirty = false;
      for (let i = 0; i < this.decals.length; i++) {
        const d = this.decals[i];
        if (!d.active) continue;
        d.age += dt;
        if (d.age >= 10.0) {
          d.active = false;
          _mat.makeScale(0, 0, 0);
          this.decalMesh.setMatrixAt(i, _mat);
          dirty = true;
        } else if (d.age >= 7.0) {
          const fade = Math.max(0.01, 1 - (d.age - 7.0) / 3.0);
          _pos.set(d.x, d.y, d.z);
          _dir.set(d.nx, d.ny, d.nz).normalize();
          _quat.setFromUnitVectors(_zAxis, _dir);
          _scale.set(d.scale * 4 * fade, d.scale * 4 * fade, 1);
          _mat.compose(_pos, _quat, _scale);
          this.decalMesh.setMatrixAt(i, _mat);
          dirty = true;
        }
      }
      if (dirty) this.decalMesh.instanceMatrix.needsUpdate = true;
    }

    // 6. Trajetórias balísticas no modo debug (F3 ou P)
    this.updateDebugTrajectories(dt);
  }

  private recordTrajectorySegment(
    x0: number,
    y0: number,
    z0: number,
    x1: number,
    y1: number,
    z1: number,
    colorHex: number
  ): void {
    const seg = this.debugTrajectories[this.debugTrajCursor];
    this.debugTrajCursor = (this.debugTrajCursor + 1) % MAX_DEBUG_TRAJECTORIES;
    seg.active = true;
    seg.x0 = x0;
    seg.y0 = y0;
    seg.z0 = z0;
    seg.x1 = x1;
    seg.y1 = y1;
    seg.z1 = z1;
    seg.age = 0;
    seg.colorHex = colorHex;
  }

  private updateDebugTrajectories(dt: number): void {
    const showTraj = Boolean(this.ctx?.state.showDebugPanel || this.ctx?.state.showColliders);
    let vertexCount = 0;
    const posArr = this.debugTrajPosAttr?.array as Float32Array | undefined;
    const colArr = this.debugTrajColAttr?.array as Float32Array | undefined;

    for (let i = 0; i < this.debugTrajectories.length; i++) {
      const seg = this.debugTrajectories[i];
      if (!seg.active) continue;
      seg.age += dt;
      if (seg.age >= DEBUG_TRAJECTORY_LIFETIME) {
        seg.active = false;
        continue;
      }
      if (showTraj && posArr && colArr) {
        const pOff = vertexCount * 3;
        posArr[pOff] = seg.x0;
        posArr[pOff + 1] = seg.y0;
        posArr[pOff + 2] = seg.z0;
        posArr[pOff + 3] = seg.x1;
        posArr[pOff + 4] = seg.y1;
        posArr[pOff + 5] = seg.z1;

        const fade = Math.max(0.15, 1 - seg.age / DEBUG_TRAJECTORY_LIFETIME);
        _color.setHex(seg.colorHex);
        const r = _color.r * fade;
        const g = _color.g * fade;
        const b = _color.b * fade;
        colArr[pOff] = r;
        colArr[pOff + 1] = g;
        colArr[pOff + 2] = b;
        colArr[pOff + 3] = r;
        colArr[pOff + 4] = g;
        colArr[pOff + 5] = b;
        vertexCount += 2;
      }
    }

    if (this.debugTrajLines) {
      this.debugTrajLines.visible = showTraj && vertexCount > 0;
      if (this.debugTrajLines.visible) {
        this.debugTrajLines.geometry.setDrawRange(0, vertexCount);
        if (this.debugTrajPosAttr) this.debugTrajPosAttr.needsUpdate = true;
        if (this.debugTrajColAttr) this.debugTrajColAttr.needsUpdate = true;
      }
    }
  }

  private resolveProjectileImpact(p: BallisticProjectile, hit: typeof _hit): void {
    if (!this.ctx) return;
    const { audio, vehicles, events } = this.ctx;
    const def = getWeaponDef(p.weaponId);
    const totalDist = p.traveled;
    const falloff = computeDistanceDamageFalloff(totalDist, p.falloffStart, p.maxRange, p.falloffMinMul);

    if (hit.kind === 'npc') {
      const headshot = hit.region === 'head';
      const damage = Math.round(p.damage * falloff * (headshot ? p.headshotMul : 1));
      const speed = Math.hypot(p.vx, p.vy, p.vz) || 1;
      this.applyNpcDamage(
        def,
        hit.targetIndex,
        damage,
        headshot,
        falloff,
        hit.x,
        hit.y,
        hit.z,
        p.vx / speed,
        p.vy / speed,
        p.vz / speed
      );
      return;
    }

    if (hit.kind === 'vehicle') {
      const v = vehicles[hit.targetIndex];
      const damage = Math.round(p.damage * falloff * 0.6);
      const isPoliceVehicle = Boolean(v && (v.driver === 'police' || v.type === 'police'));
      if (v) {
        v.maxHealth = v.maxHealth ?? 100;
        v.health = Math.max(15, (v.health ?? 100) - damage);
        v.damageRatio = 1 - v.health / v.maxHealth;
        const bodyChild = v.mesh?.children?.[2];
        if (bodyChild) {
          bodyChild.rotation.z = (v.damageRatio ?? 0) * 0.06 * (Math.random() < 0.5 ? 1 : -1);
          bodyChild.rotation.x = (v.damageRatio ?? 0) * 0.04;
        }
        if (v.driver === 'npc') {
          v.npcTargetSpeed = Math.max(v.maxSpeed * 0.9, 18);
        }
      }
      this.spawnCartoonBurst(hit.x, hit.y, hit.z, hit.nx, hit.ny, hit.nz, 7, 0xfef08a, 14.0);
      this.spawnDecal(hit.x, hit.y, hit.z, hit.nx, hit.ny, hit.nz, 0.16);
      audio.playHitMarker(false);
      audio.playBulletImpact('metal', totalDist / Math.max(1, p.maxRange));
      events.emit('weaponHit', {
        weaponId: p.weaponId,
        targetKind: 'vehicle',
        targetId: hit.targetId,
        damage,
        headshot: false,
        x: hit.x,
        y: hit.y,
        z: hit.z,
      });
      if (isPoliceVehicle) {
        this.emitShootingCrime(3, 'Viatura policial alvejada! Procurado nível 3!');
      }
      return;
    }

    // Mundo / Terreno: poeira/faíscas e áudio por material
    if (hit.kind === 'terrain') {
      this.spawnCartoonBurst(hit.x, hit.y, hit.z, hit.nx, hit.ny, hit.nz, 5, 0xd6b48c, 7.5);
      audio.playBulletImpact('terrain', totalDist / Math.max(1, p.maxRange));
    } else {
      this.spawnCartoonBurst(hit.x, hit.y, hit.z, hit.nx, hit.ny, hit.nz, 5, 0xfbbf24, 12.5);
      audio.playBulletImpact('concrete', totalDist / Math.max(1, p.maxRange));
    }
    this.spawnDecal(hit.x, hit.y, hit.z, hit.nx, hit.ny, hit.nz, 0.18);
    events.emit('weaponHit', {
      weaponId: p.weaponId,
      targetKind: 'world',
      targetId: hit.targetId,
      damage: 0,
      headshot: false,
      x: hit.x,
      y: hit.y,
      z: hit.z,
    });
  }

  private applyNpcDamage(
    def: WeaponDef,
    npcIndex: number,
    damage: number,
    headshot: boolean,
    falloff: number,
    hx: number,
    hy: number,
    hz: number,
    dirX: number,
    dirY: number,
    dirZ: number
  ): void {
    if (!this.ctx) return;
    const { state, crowd, ragdolls, audio, events } = this.ctx;
    const npc = crowd.agents[npcIndex];
    if (!npc) return;

    const isGuardOrPolice = npc.profile?.profession === 'guard';
    npc.health -= damage;
    npc.injuredByPlayer = true;

    // Critério idêntico ao ImpactSystem: out <= 0, unconscious <= 28, senão injured_recover
    let outcome: RagdollOutcome = 'injured_recover';
    if (npc.health <= 0) {
      npc.health = 0;
      outcome = 'out';
    } else if (npc.health <= 28) {
      outcome = 'unconscious';
    } else {
      outcome = 'injured_recover';
    }

    state.combat.hitMarkerTimer = 0.22;
    state.combat.lastHitHeadshot = headshot;
    state.combat.lastHitKill = outcome === 'out';
    audio.playHitMarker(headshot || outcome === 'out');
    if (def.isFirearm) {
      audio.playBulletImpact('npc', Math.min(1, Math.hypot(hx - state.playerPos.x, hz - state.playerPos.z) / Math.max(1, def.range)));
    }

    // Feedback cartoon (SEM sangue/gore: faíscas e estrelinhas)
    this.spawnCartoonBurst(hx, hy, hz, -dirX, 0.7, -dirZ, headshot ? 9 : 5, headshot ? 0xfacc15 : 0x38bdf8, 10.5);

    // Sem hit-stop em tiro comum: apenas bem curto em abate ou headshot
    if (def.isFirearm && (outcome === 'out' || headshot)) {
      state.hitStopTimer = Math.max(state.hitStopTimer, outcome === 'out' ? 0.035 : 0.025);
    }

    const shouldRagdoll = npc.health <= 0 || npc.health <= 28 || headshot || damage >= 26;
    if (shouldRagdoll && !npc.ragdollActive) {
      if (crowd.activeInjuredCount >= MAX_SIMULATED_INJURED) {
        ragdolls.accelerateOldestFade();
        crowd.enforceInjuredCap(MAX_SIMULATED_INJURED - 1);
      }

      npc.injuryStatus = outcome === 'out' ? 'out' : outcome === 'unconscious' ? 'unconscious' : 'injured';
      npc.ragdollActive = true;
      npc.injuredTimer = 0;

      // Impulso = direção * knockback * falloff (+ componente vertical 1,5..3,5 m/s, teto ~10 m/s; headshot mais forte)
      const hsBoost = headshot ? 1.35 : 1.0;
      const knockMag = Math.min(10.0, def.impulseStrength * Math.max(0.25, falloff) * hsBoost);
      let impX = dirX * knockMag;
      let impZ = dirZ * knockMag;
      const impY = Math.max(1.5, Math.min(3.5, (headshot ? 3.2 : 2.1) + dirY * knockMag * 0.25));
      const maxHoriz = Math.sqrt(Math.max(1, 10.0 * 10.0 - impY * impY));
      const curHoriz = Math.hypot(impX, impZ);
      if (curHoriz > maxHoriz && curHoriz > 1e-4) {
        const s = maxHoriz / curHoriz;
        impX *= s;
        impZ *= s;
      }

      ragdolls.spawn(
        {
          npcIndex: npc.index,
          x: npc.x,
          y: npc.y,
          z: npc.z,
          yaw: npc.yaw,
          impulseX: impX,
          impulseY: impY,
          impulseZ: impZ,
          outcome,
          heightScale: npc.heightScale,
          widthScale: npc.widthScale,
          skinColor: npc.skinColor,
          shirtColor: npc.shirtColor,
          pantsColor: npc.pantsColor,
        },
        (oldIdx) => crowd.agents[oldIdx]?.resetToHealthy()
      );
    } else if (!npc.ragdollActive) {
      if (npc.injuryStatus === 'healthy') {
        if (crowd.activeInjuredCount >= MAX_SIMULATED_INJURED) {
          ragdolls.accelerateOldestFade();
          crowd.enforceInjuredCap(MAX_SIMULATED_INJURED - 1);
        }
        npc.injuryStatus = 'injured';
      }
      npc.triggerFlee(state.playerPos.x, state.playerPos.z, 1.0);
    }

    this.triggerPanicThrottled(hx, hz, 24);

    events.emit('weaponHit', {
      weaponId: def.id,
      targetKind: 'npc',
      targetId: `npc_${npc.index}`,
      damage,
      headshot,
      x: hx,
      y: hy,
      z: hz,
    });

    if (def.isFirearm) {
      if (isGuardOrPolice) {
        this.emitShootingCrime(3, 'Agente atingido por disparos! Procurado nível 3!');
      } else if (shouldRagdoll || npc.health <= 0) {
        this.emitShootingCrime(2, 'Cidadão derrubado por disparos! Polícia acionada!');
      } else {
        this.emitShootingCrime(2, 'Cidadão ferido por disparos! Polícia acionada!');
      }
    }
  }

  private spawnTracer(
    x0: number,
    y0: number,
    z0: number,
    x1: number,
    y1: number,
    z1: number,
    colorHex: number
  ): void {
    const t = this.tracers[this.tracerCursor];
    this.tracerCursor = (this.tracerCursor + 1) % WEAPON_TRACER_POOL_SIZE;
    t.active = true;
    t.x0 = x0;
    t.y0 = y0;
    t.z0 = z0;
    t.x1 = x1;
    t.y1 = y1;
    t.z1 = z1;
    t.age = 0;
    t.life = 0.065;
    t.colorHex = colorHex;
  }

  private spawnCasing(x: number, y: number, z: number, rightX: number, rightZ: number): void {
    if (this.ctx?.isSoftwareGl) return;
    const c = this.casings[this.casingCursor];
    this.casingCursor = (this.casingCursor + 1) % WEAPON_CASING_POOL_SIZE;
    c.active = true;
    c.x = x;
    c.y = y;
    c.z = z;
    const eject = 2.0 + Math.random() * 1.4;
    c.vx = rightX * eject + (Math.random() - 0.5) * 0.6;
    c.vy = 2.2 + Math.random() * 1.1;
    c.vz = rightZ * eject + (Math.random() - 0.5) * 0.6;
    c.rx = Math.random() * Math.PI;
    c.ry = Math.random() * Math.PI;
    c.rz = Math.random() * Math.PI;
    c.age = 0;
    c.life = 1.6;
  }

  private spawnDecal(x: number, y: number, z: number, nx: number, ny: number, nz: number, scale: number): void {
    if (!this.decalMesh) return;
    const maxDecals = Math.max(1, this.getMaxDecals());
    const idx = this.decalCursor % maxDecals;
    this.decalCursor = (this.decalCursor + 1) % maxDecals;

    const d = this.decals[idx];
    d.active = true;
    d.x = x + nx * 0.015;
    d.y = y + ny * 0.015;
    d.z = z + nz * 0.015;
    d.nx = nx;
    d.ny = ny;
    d.nz = nz;
    d.scale = scale;
    d.age = 0;

    _pos.set(d.x, d.y, d.z);
    _dir.set(nx, ny, nz).normalize();
    _quat.setFromUnitVectors(_zAxis, _dir);
    _scale.set(scale * 4, scale * 4, 1);
    _mat.compose(_pos, _quat, _scale);
    this.decalMesh.setMatrixAt(idx, _mat);
    this.decalMesh.instanceMatrix.needsUpdate = true;
  }

  private spawnCartoonBurst(
    x: number,
    y: number,
    z: number,
    nx: number,
    ny: number,
    nz: number,
    count: number,
    colorHex: number,
    gravity = 11.5
  ): void {
    const maxParticles = Math.max(8, this.getMaxParticles());
    const actualCount = this.ctx?.isSoftwareGl ? Math.max(2, Math.floor(count * 0.5)) : count;
    for (let k = 0; k < actualCount; k++) {
      const idx = this.particleCursor % maxParticles;
      this.particleCursor = (this.particleCursor + 1) % maxParticles;
      const pt = this.particles[idx];
      pt.active = true;
      pt.x = x;
      pt.y = y;
      pt.z = z;
      pt.vx = nx * (2.5 + Math.random() * 2.5) + (Math.random() - 0.5) * 3.2;
      pt.vy = Math.max(0.8, ny * 3.2 + Math.random() * 2.4);
      pt.vz = nz * (2.5 + Math.random() * 2.5) + (Math.random() - 0.5) * 3.2;
      pt.scale = 0.75 + Math.random() * 0.6;
      pt.age = 0;
      pt.life = gravity < 9 ? 0.36 + Math.random() * 0.24 : 0.24 + Math.random() * 0.2;
      pt.colorHex = k % 2 === 0 ? colorHex : 0xffffff;
      pt.gravity = gravity;
    }
  }

  public dispose(): void {
    this.unsubWantedReset?.();
    this.unsubWantedReset = null;
    this.input.setCanUseDragFallback(null);
    if (this.ctx) {
      if (this.tracerMesh) this.ctx.scene.remove(this.tracerMesh);
      if (this.casingMesh) this.ctx.scene.remove(this.casingMesh);
      if (this.decalMesh) this.ctx.scene.remove(this.decalMesh);
      if (this.fxMesh) this.ctx.scene.remove(this.fxMesh);
      if (this.muzzleFlashSprite) this.ctx.scene.remove(this.muzzleFlashSprite);
      if (this.muzzleLight) this.ctx.scene.remove(this.muzzleLight);
      if (this.debugTrajLines) this.ctx.scene.remove(this.debugTrajLines);
    }
    this.tracerMesh?.geometry.dispose();
    (this.tracerMesh?.material as THREE.Material | undefined)?.dispose();
    this.casingMesh?.geometry.dispose();
    (this.casingMesh?.material as THREE.Material | undefined)?.dispose();
    this.decalMesh?.geometry.dispose();
    (this.decalMesh?.material as THREE.Material | undefined)?.dispose();
    this.fxMesh?.geometry.dispose();
    (this.fxMesh?.material as THREE.Material | undefined)?.dispose();
    this.debugTrajLines?.geometry.dispose();
    (this.debugTrajLines?.material as THREE.Material | undefined)?.dispose();
    (this.muzzleFlashSprite?.material as THREE.Material | undefined)?.dispose();
    this.muzzleFlashTex?.dispose();
    this.muzzleLight?.dispose();

    this.tracerMesh = null;
    this.casingMesh = null;
    this.decalMesh = null;
    this.fxMesh = null;
    this.muzzleFlashSprite = null;
    this.muzzleFlashTex = null;
    this.muzzleLight = null;
    this.debugTrajLines = null;
    this.debugTrajPosAttr = null;
    this.debugTrajColAttr = null;
    this.ctx = null;
  }
}
