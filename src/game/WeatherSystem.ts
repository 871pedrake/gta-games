import * as THREE from 'three';
import { WeatherType } from './types';

const RAIN_STREAK_COUNT = 900;
const HEAT_MOTE_COUNT = 90;
const WEATHER_ORDER: WeatherType[] = ['clear', 'rain', 'fog', 'heat'];

export const WEATHER_LABELS: Record<WeatherType, string> = {
  clear: 'Céu Limpo',
  rain: 'Chuva Tropical',
  fog: 'Neblina Densa',
  heat: 'Calor Intenso',
};

export interface WeatherEffects {
  current: WeatherType;
  target: WeatherType;
  label: string;
  rainIntensity: number;
  fogDensity: number;
  heatIntensity: number;
  wetness: number;
  grip: number;
  accelMult: number;
  brakeMult: number;
  lateralDriftMult: number;
  npcTrafficSpeedMult: number;
  sunMultiplier: number;
  neonMultiplier: number;
  headlightMultiplier: number;
  exposure: number;
  lightningBoost: number;
  skyTintHex: number;
  skyTintAlpha: number;
  fogTintHex: number;
  fogTintAlpha: number;
}

/**
 * Gerencia o sistema de clima dinâmico (Céu Limpo, Chuva, Neblina e Calor Intenso),
 * renderizando partículas de chuva 3D e mormaço, relâmpagos sutis e modulando iluminação,
 * névoa, rugosidade do asfalto e aderência dos veículos.
 */
export class WeatherSystem {
  private currentWeather: WeatherType = 'clear';
  private autoTimer = 75;

  // Intensidades suavizadas (0..1) para transições fluidas
  private rainLevel = 0;
  private fogLevel = 0;
  private heatLevel = 0;
  private wetness = 0;
  private lightningTimer = 7;
  private lightningBoost = 0;

  // Chuva em 1 draw call via LineSegments ao redor do jogador
  private readonly rainLines: THREE.LineSegments;
  private readonly rainPosAttr: THREE.BufferAttribute;
  private readonly rainPositions: Float32Array;
  private readonly rainSeeds: Float32Array;

  // Partículas de calor intenso / mormaço sobre o asfalto
  private readonly heatPoints: THREE.Points;
  private readonly heatPosAttr: THREE.BufferAttribute;
  private readonly heatPositions: Float32Array;
  private readonly heatSeeds: Float32Array;
  private readonly heatMat: THREE.PointsMaterial;

  public readonly effects: WeatherEffects = {
    current: 'clear',
    target: 'clear',
    label: WEATHER_LABELS.clear,
    rainIntensity: 0,
    fogDensity: 0.0056,
    heatIntensity: 0,
    wetness: 0,
    grip: 1.0,
    accelMult: 1.0,
    brakeMult: 1.0,
    lateralDriftMult: 0,
    npcTrafficSpeedMult: 1.0,
    sunMultiplier: 1.0,
    neonMultiplier: 1.0,
    headlightMultiplier: 1.0,
    exposure: 1.12,
    lightningBoost: 0,
    skyTintHex: 0xffffff,
    skyTintAlpha: 0,
    fogTintHex: 0xffffff,
    fogTintAlpha: 0,
  };

  constructor(scene: THREE.Scene) {
    // 1. Geometria de gotas/riscos de chuva
    this.rainPositions = new Float32Array(RAIN_STREAK_COUNT * 6);
    this.rainSeeds = new Float32Array(RAIN_STREAK_COUNT * 4);
    for (let i = 0; i < RAIN_STREAK_COUNT; i++) {
      const rx = (Math.random() - 0.5) * 86;
      const ry = Math.random() * 26;
      const rz = (Math.random() - 0.5) * 86;
      const spd = 22 + Math.random() * 10;
      this.rainSeeds[i * 4] = rx;
      this.rainSeeds[i * 4 + 1] = ry;
      this.rainSeeds[i * 4 + 2] = rz;
      this.rainSeeds[i * 4 + 3] = spd;
    }

    const rainGeo = new THREE.BufferGeometry();
    this.rainPosAttr = new THREE.BufferAttribute(this.rainPositions, 3);
    this.rainPosAttr.setUsage(THREE.DynamicDrawUsage);
    rainGeo.setAttribute('position', this.rainPosAttr);

    const rainMat = new THREE.LineBasicMaterial({
      color: 0xa5d8ff,
      transparent: true,
      opacity: 0.48,
      depthWrite: false,
    });
    this.rainLines = new THREE.LineSegments(rainGeo, rainMat);
    this.rainLines.frustumCulled = false;
    this.rainLines.visible = false;
    scene.add(this.rainLines);

    // 2. Partículas sutis de calor/mormaço
    this.heatPositions = new Float32Array(HEAT_MOTE_COUNT * 3);
    this.heatSeeds = new Float32Array(HEAT_MOTE_COUNT * 3);
    for (let i = 0; i < HEAT_MOTE_COUNT; i++) {
      this.heatSeeds[i * 3] = (Math.random() - 0.5) * 68;
      this.heatSeeds[i * 3 + 1] = 0.3 + Math.random() * 5.5;
      this.heatSeeds[i * 3 + 2] = (Math.random() - 0.5) * 68;
    }
    const heatGeo = new THREE.BufferGeometry();
    this.heatPosAttr = new THREE.BufferAttribute(this.heatPositions, 3);
    this.heatPosAttr.setUsage(THREE.DynamicDrawUsage);
    heatGeo.setAttribute('position', this.heatPosAttr);

    this.heatMat = new THREE.PointsMaterial({
      color: 0xffd07a,
      size: 0.28,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    this.heatPoints = new THREE.Points(heatGeo, this.heatMat);
    this.heatPoints.frustumCulled = false;
    this.heatPoints.visible = false;
    scene.add(this.heatPoints);
  }

  public getWeather(): WeatherType {
    return this.currentWeather;
  }

  public setWeather(weather: WeatherType): void {
    this.currentWeather = weather;
    this.autoTimer = 85;
  }

  public cycleWeather(): WeatherType {
    const idx = WEATHER_ORDER.indexOf(this.currentWeather);
    const next = WEATHER_ORDER[(idx + 1) % WEATHER_ORDER.length];
    this.setWeather(next);
    return next;
  }

  public update(
    dt: number,
    playerX: number,
    playerZ: number,
    isNight: boolean,
    timeScale: number
  ): WeatherEffects {
    // Ciclo automático de clima (escala suavemente com timeScale sem piscar em 60x)
    const weatherClockMult = Math.min(4, Math.max(1, Math.sqrt(timeScale)));
    this.autoTimer -= dt * weatherClockMult;
    if (this.autoTimer <= 0) {
      this.cycleWeather();
    }

    const tRain = this.currentWeather === 'rain' ? 1 : 0;
    const tFog = this.currentWeather === 'fog' ? 1 : 0;
    const tHeat = this.currentWeather === 'heat' ? 1 : 0;

    const blend = 1 - Math.exp(-1.1 * dt);
    this.rainLevel += (tRain - this.rainLevel) * blend;
    this.fogLevel += (tFog - this.fogLevel) * blend;
    this.heatLevel += (tHeat - this.heatLevel) * blend;

    // Pista molha rápido na chuva e seca gradualmente depois
    const wetRate = tRain > 0.5 ? 0.35 : -0.14;
    this.wetness = THREE.MathUtils.clamp(this.wetness + wetRate * dt, 0, 1);

    // Relâmpagos esparsos durante chuva intensa
    if (this.rainLevel > 0.55) {
      this.lightningTimer -= dt;
      if (this.lightningTimer <= 0) {
        this.lightningBoost = 2.4;
        this.lightningTimer = 7 + Math.random() * 11;
      }
    }
    if (this.lightningBoost > 0) {
      this.lightningBoost = Math.max(0, this.lightningBoost - dt * 9.5);
    }

    // Atualiza partículas 3D de chuva centradas no jogador
    if (this.rainLevel > 0.03) {
      this.rainLines.visible = true;
      (this.rainLines.material as THREE.LineBasicMaterial).opacity = 0.52 * this.rainLevel;
      const windX = -3.4 * this.rainLevel;
      const windZ = -1.6 * this.rainLevel;

      for (let i = 0; i < RAIN_STREAK_COUNT; i++) {
        const base = i * 4;
        let rx = this.rainSeeds[base];
        let ry = this.rainSeeds[base + 1];
        let rz = this.rainSeeds[base + 2];
        const spd = this.rainSeeds[base + 3];

        ry -= spd * dt;
        rx += windX * dt;
        rz += windZ * dt;

        if (ry < 0) {
          ry += 26;
          rx = (Math.random() - 0.5) * 86;
          rz = (Math.random() - 0.5) * 86;
        }
        this.rainSeeds[base] = rx;
        this.rainSeeds[base + 1] = ry;
        this.rainSeeds[base + 2] = rz;

        const wx = playerX + rx;
        const wz = playerZ + rz;
        const p = i * 6;
        this.rainPositions[p] = wx;
        this.rainPositions[p + 1] = ry;
        this.rainPositions[p + 2] = wz;
        this.rainPositions[p + 3] = wx - windX * 0.035;
        this.rainPositions[p + 4] = ry + 0.95;
        this.rainPositions[p + 5] = wz - windZ * 0.035;
      }
      this.rainPosAttr.needsUpdate = true;
    } else {
      this.rainLines.visible = false;
    }

    // Atualiza partículas sutis de calor ascendente
    if (this.heatLevel > 0.04) {
      this.heatPoints.visible = true;
      this.heatMat.opacity = 0.28 * this.heatLevel;
      for (let i = 0; i < HEAT_MOTE_COUNT; i++) {
        const s = i * 3;
        let hx = this.heatSeeds[s];
        let hy = this.heatSeeds[s + 1];
        let hz = this.heatSeeds[s + 2];
        hy += (0.85 + (i % 5) * 0.15) * dt;
        hx += Math.sin(hy * 1.4 + i) * 0.45 * dt;
        if (hy > 6.5) hy = 0.2;
        this.heatSeeds[s] = hx;
        this.heatSeeds[s + 1] = hy;
        this.heatPositions[s] = playerX + hx;
        this.heatPositions[s + 1] = hy;
        this.heatPositions[s + 2] = playerZ + hz;
      }
      this.heatPosAttr.needsUpdate = true;
    } else {
      this.heatPoints.visible = false;
    }

    // Calcula física e modificadores visuais combinados
    const grip = THREE.MathUtils.clamp(
      1.0 - this.wetness * 0.42 - this.fogLevel * 0.14 - this.heatLevel * 0.05,
      0.52,
      1.0
    );
    const accelMult = 1.0 - this.wetness * 0.16 - this.fogLevel * 0.06 - this.heatLevel * 0.04;
    const brakeMult = 1.0 - this.wetness * 0.46 - this.fogLevel * 0.18 - this.heatLevel * 0.05;
    const lateralDriftMult = this.wetness * 1.0 + this.fogLevel * 0.22 + this.heatLevel * 0.06;
    const npcTrafficSpeedMult = 1.0 - this.rainLevel * 0.22 - this.fogLevel * 0.35;

    const fogDensity =
      0.0056 +
      this.rainLevel * 0.0046 +
      this.fogLevel * 0.0205 +
      this.heatLevel * 0.0014;

    const sunMultiplier =
      1.0 - this.rainLevel * 0.5 + -this.fogLevel * 0.34 + this.heatLevel * 0.38;
    const neonMultiplier = 1.0 + this.rainLevel * 0.55 + this.fogLevel * 0.4 - this.heatLevel * 0.2;
    const headlightMultiplier = 1.0 + this.rainLevel * 0.9 + this.fogLevel * 1.3;
    const exposure = 1.12 - this.rainLevel * 0.14 - this.fogLevel * 0.06 + this.heatLevel * 0.18;

    let skyTintHex = 0xffffff;
    let skyTintAlpha = 0;
    let fogTintHex = 0xffffff;
    let fogTintAlpha = 0;

    if (this.rainLevel >= this.fogLevel && this.rainLevel >= this.heatLevel && this.rainLevel > 0.02) {
      skyTintHex = isNight ? 0x0c1428 : 0x3b4d6b;
      fogTintHex = isNight ? 0x111c36 : 0x475c7a;
      skyTintAlpha = 0.72 * this.rainLevel;
      fogTintAlpha = 0.78 * this.rainLevel;
    } else if (this.fogLevel >= this.heatLevel && this.fogLevel > 0.02) {
      skyTintHex = isNight ? 0x222c47 : 0x9aaec9;
      fogTintHex = isNight ? 0x293554 : 0xb3c4db;
      skyTintAlpha = 0.82 * this.fogLevel;
      fogTintAlpha = 0.88 * this.fogLevel;
    } else if (this.heatLevel > 0.02) {
      skyTintHex = isNight ? 0x452236 : 0xffaa5c;
      fogTintHex = isNight ? 0x52293e : 0xffc078;
      skyTintAlpha = 0.45 * this.heatLevel;
      fogTintAlpha = 0.52 * this.heatLevel;
    }

    const e = this.effects;
    e.current = this.currentWeather;
    e.target = this.currentWeather;
    e.label = WEATHER_LABELS[this.currentWeather];
    e.rainIntensity = this.rainLevel;
    e.fogDensity = fogDensity;
    e.heatIntensity = this.heatLevel;
    e.wetness = this.wetness;
    e.grip = grip;
    e.accelMult = accelMult;
    e.brakeMult = brakeMult;
    e.lateralDriftMult = lateralDriftMult;
    e.npcTrafficSpeedMult = npcTrafficSpeedMult;
    e.sunMultiplier = sunMultiplier;
    e.neonMultiplier = neonMultiplier;
    e.headlightMultiplier = headlightMultiplier;
    e.exposure = exposure;
    e.lightningBoost = this.lightningBoost;
    e.skyTintHex = skyTintHex;
    e.skyTintAlpha = skyTintAlpha;
    e.fogTintHex = fogTintHex;
    e.fogTintAlpha = fogTintAlpha;

    return e;
  }
}
