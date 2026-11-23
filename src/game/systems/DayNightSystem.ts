import * as THREE from 'three';
import { DAY_DURATION_SECONDS, SUN_INTENSITY } from '../config';
import { EngineContext, GameSystem } from '../core/SystemLifecycle';

const _colorSkyA = new THREE.Color();
const _colorSkyB = new THREE.Color();
const _colorSunA = new THREE.Color();
const _colorSunB = new THREE.Color();
const _weatherTint = new THREE.Color();

export class DayNightSystem implements GameSystem {
  public readonly name = 'DayNightSystem';

  private ctx: EngineContext | null = null;
  public sunLight!: THREE.DirectionalLight;
  public hemiLight!: THREE.HemisphereLight;
  public rimLight!: THREE.DirectionalLight;

  public init(ctx: EngineContext): void {
    this.ctx = ctx;
    this.hemiLight = new THREE.HemisphereLight(0xff7eb3, 0x1e1b3a, 0.85);
    ctx.scene.add(this.hemiLight);

    this.sunLight = new THREE.DirectionalLight(0xff9259, SUN_INTENSITY);
    this.sunLight.position.set(80, 38, -60);
    this.sunLight.castShadow = !ctx.isSoftwareGl;
    this.sunLight.shadow.mapSize.set(2048, 2048);
    const d = 115;
    this.sunLight.shadow.camera.left = -d;
    this.sunLight.shadow.camera.right = d;
    this.sunLight.shadow.camera.top = d;
    this.sunLight.shadow.camera.bottom = -d;
    this.sunLight.shadow.camera.near = 2;
    this.sunLight.shadow.camera.far = 260;
    this.sunLight.shadow.bias = -0.0005;
    this.sunLight.shadow.normalBias = 0.03;
    ctx.scene.add(this.sunLight);

    this.rimLight = new THREE.DirectionalLight(0x38bdf8, 0.55);
    this.rimLight.position.set(-70, 28, 80);
    ctx.scene.add(this.rimLight);

    // Sincroniza estado visual inicial sem esperar o primeiro tick completo
    this.update(0);
  }

  public advanceTimePhase(): void {
    if (!this.ctx) return;
    const { state } = this.ctx;
    const prev = state.gameTime;
    state.gameTime = (state.gameTime + 4) % 24;
    if (state.gameTime < prev) state.dayNumber++;
    this.update(0);
  }

  public cycleTimeScale(): number {
    if (!this.ctx) return 1;
    const { state, events } = this.ctx;
    state.timeScale = state.timeScale === 1 ? 10 : state.timeScale === 10 ? 60 : 1;
    events.emit('timeScaleChanged', { timeScale: state.timeScale });
    events.emit('bannerRequested', {
      text: `Velocidade do relógio: ${state.timeScale}x`,
      duration: 1.8,
    });
    return state.timeScale;
  }

  public isNight(): boolean {
    if (!this.ctx) return false;
    const gt = this.ctx.state.gameTime;
    return gt >= 19.5 || gt < 5.5;
  }

  public isWeekendDay(): boolean {
    if (!this.ctx) return false;
    return ((this.ctx.state.dayNumber - 1) % 7) >= 5;
  }

  public getTimeLabel(): string {
    if (!this.ctx) return 'Pôr do Sol';
    const h = this.ctx.state.gameTime;
    if (h >= 17.0 && h < 19.5) return 'Pôr do Sol';
    if (h >= 19.5 || h < 5.5) return 'Noite Neon';
    if (h >= 5.5 && h < 7.5) return 'Amanhecer';
    return 'Dia Tropical';
  }

  public formatGameClock(): string {
    if (!this.ctx) return '17:30';
    const totalMin = Math.floor(this.ctx.state.gameTime * 60) % 1440;
    const hh = Math.floor(totalMin / 60).toString().padStart(2, '0');
    const mm = (totalMin % 60).toString().padStart(2, '0');
    return `${hh}:${mm}`;
  }

  public setShadowsEnabled(enabled: boolean): void {
    this.setShadowQuality(enabled, this.sunLight?.shadow.mapSize.x || 1024);
  }

  public setShadowQuality(enabled: boolean, mapSize: number): void {
    if (!this.sunLight || !this.ctx) return;
    if (this.ctx.isSoftwareGl) {
      this.sunLight.castShadow = false;
      return;
    }
    this.sunLight.castShadow = enabled;
    if (this.sunLight.shadow.mapSize.x !== mapSize || this.sunLight.shadow.mapSize.y !== mapSize) {
      if (this.sunLight.shadow.map) {
        this.sunLight.shadow.map.dispose();
        this.sunLight.shadow.map = null;
      }
      this.sunLight.shadow.mapSize.set(mapSize, mapSize);
      this.sunLight.shadow.needsUpdate = true;
    }
  }

  public update(dt: number): void {
    if (!this.ctx) return;
    const { state, scene, renderer, world, vehicles, weatherEffects } = this.ctx;

    const hoursPerSec = 24 / DAY_DURATION_SECONDS;
    state.gameTime += dt * hoursPerSec * state.timeScale;
    if (state.gameTime >= 24) {
      state.gameTime -= 24;
      state.dayNumber++;
    }

    state.timeNormalized = ((state.gameTime - 18 + 24) % 24) / 24;
    const t = state.timeNormalized;

    const phases = [
      { pos: 0.0, sky: 0xff5f8f, fog: 0x5c2356, sun: 0xff7b42, sunInt: 1.85, hemiSky: 0xff8ec7, hemiGnd: 0x26183d, sunElev: 0.28, neon: 1.5 },
      { pos: 0.14, sky: 0x0b0f29, fog: 0x101433, sun: 0x5c7cfa, sunInt: 0.52, hemiSky: 0x3b4d9b, hemiGnd: 0x0b0c1c, sunElev: 0.45, neon: 2.3 },
      { pos: 0.46, sky: 0x0e1330, fog: 0x141838, sun: 0x6b8cff, sunInt: 0.58, hemiSky: 0x4156a6, hemiGnd: 0x0d0e1f, sunElev: 0.5, neon: 2.2 },
      { pos: 0.55, sky: 0xff9a76, fog: 0x825580, sun: 0xffbe76, sunInt: 1.65, hemiSky: 0xffc6a8, hemiGnd: 0x3a2b4d, sunElev: 0.35, neon: 1.1 },
      { pos: 0.74, sky: 0x3ca3e8, fog: 0x52b6e8, sun: 0xfff3d6, sunInt: 2.1, hemiSky: 0x99e2ff, hemiGnd: 0x3b354d, sunElev: 0.92, neon: 0.55 },
      { pos: 0.92, sky: 0x618ce6, fog: 0x6d68a8, sun: 0xffd19c, sunInt: 1.9, hemiSky: 0xffb3c6, hemiGnd: 0x33274a, sunElev: 0.55, neon: 0.95 },
      { pos: 1.0, sky: 0xff5f8f, fog: 0x5c2356, sun: 0xff7b42, sunInt: 1.85, hemiSky: 0xff8ec7, hemiGnd: 0x26183d, sunElev: 0.28, neon: 1.5 },
    ];

    let p0 = phases[0];
    let p1 = phases[1];
    for (let i = 0; i < phases.length - 1; i++) {
      if (t >= phases[i].pos && t <= phases[i + 1].pos) {
        p0 = phases[i];
        p1 = phases[i + 1];
        break;
      }
    }
    const localAlpha = (t - p0.pos) / Math.max(0.0001, p1.pos - p0.pos);
    const w = weatherEffects;

    _colorSkyA.setHex(p0.sky);
    _colorSkyB.setHex(p1.sky);
    _colorSkyA.lerp(_colorSkyB, localAlpha);
    const bg = scene.background as THREE.Color;
    bg.copy(_colorSkyA);
    if (w.skyTintAlpha > 0.005) {
      _weatherTint.setHex(w.skyTintHex);
      bg.lerp(_weatherTint, w.skyTintAlpha);
    }
    if (w.lightningBoost > 0.05) {
      _weatherTint.setHex(0xdbeafe);
      bg.lerp(_weatherTint, Math.min(0.65, w.lightningBoost * 0.25));
    }

    _colorSunA.setHex(p0.fog);
    _colorSunB.setHex(p1.fog);
    _colorSunA.lerp(_colorSunB, localAlpha);
    const fog = scene.fog as THREE.FogExp2;
    fog.color.copy(_colorSunA);
    if (w.fogTintAlpha > 0.005) {
      _weatherTint.setHex(w.fogTintHex);
      fog.color.lerp(_weatherTint, w.fogTintAlpha);
    }
    fog.density = w.fogDensity;

    _colorSunA.setHex(p0.sun);
    _colorSunB.setHex(p1.sun);
    this.sunLight.color.copy(_colorSunA.lerp(_colorSunB, localAlpha));
    this.sunLight.intensity =
      Math.max(0.22, THREE.MathUtils.lerp(p0.sunInt, p1.sunInt, localAlpha) * w.sunMultiplier) +
      w.lightningBoost;

    const elev = THREE.MathUtils.lerp(p0.sunElev, p1.sunElev, localAlpha);
    this.sunLight.position.set(110 * Math.cos(t * Math.PI * 2), 25 + elev * 85, -70);

    _colorSunA.setHex(p0.hemiSky);
    _colorSunB.setHex(p1.hemiSky);
    this.hemiLight.color.copy(_colorSunA.lerp(_colorSunB, localAlpha));
    _colorSunA.setHex(p0.hemiGnd);
    _colorSunB.setHex(p1.hemiGnd);
    this.hemiLight.groundColor.copy(_colorSunA.lerp(_colorSunB, localAlpha));
    this.hemiLight.intensity = 0.85 * (1 - w.rainIntensity * 0.22) + w.lightningBoost * 0.45;

    renderer.toneMappingExposure = w.exposure;
    world.asphaltMat.roughness = 0.82 - w.wetness * 0.64;
    world.asphaltMat.metalness = 0.08 + w.wetness * 0.28;
    world.promenadeMat.roughness = 0.84 - w.wetness * 0.54;
    world.promenadeMat.metalness = 0.04 + w.wetness * 0.16;

    const neonIntensity = THREE.MathUtils.lerp(p0.neon, p1.neon, localAlpha) * w.neonMultiplier;
    for (const m of world.neonTrimMats) m.emissiveIntensity = neonIntensity;
    for (const m of world.lampBulbMats) m.emissiveIntensity = neonIntensity * 0.9;
    for (const m of world.facadeMats) m.emissiveIntensity = 0.15 + neonIntensity * 0.28;
    for (const v of vehicles) {
      for (const hl of v.headlights) {
        (hl.material as THREE.MeshStandardMaterial).emissiveIntensity = 1.6 * w.headlightMultiplier;
      }
    }
  }

  public dispose(): void {
    if (this.ctx) {
      this.ctx.scene.remove(this.sunLight, this.hemiLight, this.rimLight);
    }
    this.sunLight?.shadow?.map?.dispose();
    this.ctx = null;
  }
}
