import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { TypedEventBus } from '../core/EventBus';
import { captureSaveFromContext, restoreSaveIntoContext } from '../core/SaveBridge';
import { EngineContext } from '../core/SystemLifecycle';
import { createVehicleEntity } from '../models';
import { applyVehiclePaintAndFinish, syncVehicleCabinVisuals } from '../vehicles/builders/sharedBuilderUtils';
import { CarController } from '../vehicles/controllers/CarController';
import { resolveGroundVehicleCollisions } from '../vehicles/controllers/VehicleController';
import {
  CarPhysicsState,
  computeEngineDriveForce,
  stepCarPhysics,
} from '../vehicles/physics/carPhysics';
import { FIXED_PHYSICS_DT } from '../vehicles/physics/fixedStep';
import { VEHICLE_SPECS } from '../vehicles/VehicleSpecs';

function makeDummyShadowTex(): THREE.CanvasTexture {
  return new THREE.CanvasTexture({} as HTMLCanvasElement);
}

describe('FASE 3 — Carros: modelo de bicicleta dinâmico, suspensão 4 rodas, impulsos e variações', () => {
  it('constrói todas as variações de carro + utilitários com portas, acabamentos e detalhes corretos', () => {
    const tex = makeDummyShadowTex();

    // 4 portas: hatch, sedan, suv
    for (const type of ['hatch', 'sedan', 'suv'] as const) {
      const car = createVehicleEntity(`v_${type}`, type, VEHICLE_SPECS[type].defaultPaintHex, 0, 0, 0, tex, false);
      expect(car.doors?.length).toBe(4);
      expect(car.sprungGroup).toBeDefined();
      expect(car.paintMaterial).toBeDefined();
      expect(car.finish).toBe(VEHICLE_SPECS[type].defaultFinish);
    }

    // Picape: 2 portas + caçamba com tampa traseira articulada
    const pickup = createVehicleEntity('v_pickup', 'pickup', 0xef4444, 0, 0, 0, tex, false);
    expect(pickup.doors?.length).toBe(2);
    expect(pickup.tailgatePivot).toBeDefined();

    // Van: 2 portas dianteiras + 1 porta lateral de correr (~0,9 m)
    const van = createVehicleEntity('v_van', 'van', 0xe2e8f0, 0, 0, 0, tex, false);
    expect(van.doors?.length).toBe(3);
    const sliding = van.doors!.find((d) => d.mechanism === 'sliding');
    expect(sliding).toBeDefined();
    expect(sliding!.maxSlide).toBeCloseTo(0.9, 2);

    // Conversível: 2 portas, sem teto e interior sempre visível mesmo em qualidade baixa
    const conv = createVehicleEntity('v_conv', 'convertible', 0xfacc15, 0, 0, 0, tex, true);
    expect(conv.doors?.length).toBe(2);
    expect(VEHICLE_SPECS.convertible.hasRoof).toBe(false);
    conv.driver = 'player';
    syncVehicleCabinVisuals(conv, true, 'low', false);
    expect(conv.cabinVisuals?.interiorGroup?.visible).toBe(true);
    expect(conv.cabinVisuals?.seatedDriverGroup?.visible).toBe(true);

    // Esportivo: portas tesoura RWD; polícia, ônibus e ambulância preservados
    const sports = createVehicleEntity('v_sp', 'sports', 0xff2e93, 0, 0, 0, tex, false);
    expect(sports.doors?.every((d) => d.mechanism === 'scissor')).toBe(true);
    expect(VEHICLE_SPECS.police.handling.drivetrain).toBe('AWD');
    expect(VEHICLE_SPECS.bus.massKg).toBeGreaterThan(8000);
    const amb = createVehicleEntity('v_amb', 'ambulance', 0xf8fafc, 0, 0, 0, tex, false);
    expect(amb.doors?.length).toBe(2);
  });

  it('modelo de bicicleta evolui vx/vy/yawRate, troca marchas (1..5), satura na Vmax e atenua esterço em alta velocidade', () => {
    const spec = VEHICLE_SPECS.sports;
    const state: CarPhysicsState = {
      x: 0,
      z: 0,
      heading: 0,
      speed: 0,
      steerAngle: 0,
      lateralSpeed: 0,
      damageRatio: 0,
      vx: 0,
      vy: 0,
      yawRate: 0,
      longAccel: 0,
      latAccel: 0,
      gear: 1,
      rpmNormalized: 0.2,
    };

    const gLow = computeEngineDriveForce(4, 1, spec.handling, spec.massKg, 1, 1);
    const gHigh = computeEngineDriveForce(30, 1, spec.handling, spec.massKg, 1, 1);
    expect(gLow.gear).toBe(1);
    expect(gHigh.gear).toBeGreaterThanOrEqual(4);
    expect(gLow.driveForce).toBeGreaterThan(gHigh.driveForce * 0.7);

    // Acelera até próximo da velocidade máxima (arrasto quadrático + rolagem equilibram)
    for (let i = 0; i < 1200; i++) {
      stepCarPhysics(
        state,
        spec.handling,
        { throttle: 1, steerInput: 0, handbrake: false },
        { grip: 1, accelMult: 1, brakeMult: 1, lateralDriftMult: 0 },
        FIXED_PHYSICS_DT,
        spec.massKg
      );
    }
    expect(state.vx!).toBeGreaterThan(spec.handling.maxSpeed * 0.88);
    expect(state.vx!).toBeLessThanOrEqual(spec.handling.maxSpeed * 1.02);
    expect(state.gear).toBe(5);

    // Esterço em alta velocidade é menor que em baixa velocidade
    const lowSpeedState: CarPhysicsState = {
      x: 0, z: 0, heading: 0, speed: 3, steerAngle: 0, lateralSpeed: 0, damageRatio: 0, vx: 3,
    };
    const highSpeedState: CarPhysicsState = {
      x: 0, z: 0, heading: 0, speed: 34, steerAngle: 0, lateralSpeed: 0, damageRatio: 0, vx: 34,
    };
    for (let i = 0; i < 60; i++) {
      stepCarPhysics(
        lowSpeedState,
        spec.handling,
        { throttle: 0, steerInput: 1, handbrake: false },
        { grip: 1, accelMult: 1, brakeMult: 1, lateralDriftMult: 0 },
        FIXED_PHYSICS_DT,
        spec.massKg
      );
      stepCarPhysics(
        highSpeedState,
        spec.handling,
        { throttle: 0, steerInput: 1, handbrake: false },
        { grip: 1, accelMult: 1, brakeMult: 1, lateralDriftMult: 0 },
        FIXED_PHYSICS_DT,
        spec.massKg
      );
    }
    expect(Math.abs(highSpeedState.steerAngle)).toBeLessThan(Math.abs(lowSpeedState.steerAngle) * 0.75);
  });

  it('freio de mão trava eixo traseiro gerando deriva (drift) e círculo de atrito limita força combinada', () => {
    const spec = VEHICLE_SPECS.coupe;
    const gripState: CarPhysicsState = {
      x: 0, z: 0, heading: 0, speed: 22, steerAngle: 0.25, lateralSpeed: 0, damageRatio: 0, vx: 22, vy: 0, yawRate: 0,
    };
    const driftState: CarPhysicsState = {
      x: 0, z: 0, heading: 0, speed: 22, steerAngle: 0.25, lateralSpeed: 0, damageRatio: 0, vx: 22, vy: 0, yawRate: 0,
    };

    for (let i = 0; i < 60; i++) {
      stepCarPhysics(
        gripState,
        spec.handling,
        { throttle: 0.5, steerInput: 0.8, handbrake: false },
        { grip: 1, accelMult: 1, brakeMult: 1, lateralDriftMult: 0 },
        FIXED_PHYSICS_DT,
        spec.massKg
      );
      stepCarPhysics(
        driftState,
        spec.handling,
        { throttle: 0.5, steerInput: 0.8, handbrake: true },
        { grip: 1, accelMult: 1, brakeMult: 1, lateralDriftMult: 0 },
        FIXED_PHYSICS_DT,
        spec.massKg
      );
    }

    // Com freio de mão, a traseira perde aderência lateral e gera maior deslizamento/velocidade de guinada
    expect(Math.abs(driftState.vy!)).toBeGreaterThan(Math.abs(gripState.vy!) * 1.15);
    expect(driftState.vx!).toBeLessThan(gripState.vx!);

    // Multiplicadores de clima (chuva = grip reduzido) e damageRatio degradam aceleração e velocidade
    const rainDamaged: CarPhysicsState = {
      x: 0, z: 0, heading: 0, speed: 0, steerAngle: 0, lateralSpeed: 0, damageRatio: 0.8, vx: 0,
    };
    const clearHealthy: CarPhysicsState = {
      x: 0, z: 0, heading: 0, speed: 0, steerAngle: 0, lateralSpeed: 0, damageRatio: 0, vx: 0,
    };
    for (let i = 0; i < 120; i++) {
      stepCarPhysics(
        rainDamaged,
        spec.handling,
        { throttle: 1, steerInput: 0, handbrake: false },
        { grip: 0.72, accelMult: 0.85, brakeMult: 0.78, lateralDriftMult: 0.34 },
        FIXED_PHYSICS_DT,
        spec.massKg
      );
      stepCarPhysics(
        clearHealthy,
        spec.handling,
        { throttle: 1, steerInput: 0, handbrake: false },
        { grip: 1, accelMult: 1, brakeMult: 1, lateralDriftMult: 0 },
        FIXED_PHYSICS_DT,
        spec.massKg
      );
    }
    expect(rainDamaged.vx!).toBeLessThan(clearHealthy.vx! * 0.72);
  });

  it('amostra 4 rodas para pitch/roll em rampa e anima mergulho/rolagem/quique no sprungGroup', () => {
    const tex = makeDummyShadowTex();
    const suv = createVehicleEntity('suv_ramp', 'suv', 0xf97316, 0, 0, 0, tex, true);
    const ctrl = new CarController();

    // Rampa subindo no eixo +Z (inclinação de 25%)
    const rampGround = (_x: number, z: number) => Math.max(0, z * 0.25);

    for (let i = 0; i < 20; i++) {
      ctrl.update(
        suv,
        { throttle: 1, strafe: 0, handbrake: false, sprint: false },
        0.016,
        {
          grip: 1,
          accelMult: 1,
          brakeMult: 1,
          lateralDriftMult: 0,
          groundHeightAt: rampGround,
          resolveWorldCollisions: () => false,
          otherVehicles: [suv],
          onBuildingHit: vi.fn(),
          onVehicleCollision: vi.fn(),
          onDoorSlam: vi.fn(),
        }
      );
    }

    // Frente está mais alta que a traseira -> pitch negativo no Three.js levanta o nariz (+Z)
    expect(suv.pitch).toBeLessThan(-0.12);

    // Frenagem forte com velocidade gera mergulho positivo (nariz abaixa) na carroceria suspensa
    suv.vx = 20;
    suv.speed = 20;
    for (let i = 0; i < 12; i++) {
      ctrl.update(
        suv,
        { throttle: -1, strafe: -0.9, handbrake: false, sprint: false },
        0.016,
        {
          grip: 1,
          accelMult: 1,
          brakeMult: 1,
          lateralDriftMult: 0,
          groundHeightAt: () => 0,
          resolveWorldCollisions: () => false,
          otherVehicles: [suv],
          onBuildingHit: vi.fn(),
          onVehicleCollision: vi.fn(),
          onDoorSlam: vi.fn(),
        }
      );
    }
    expect(suv.bodyPitchOffset!).toBeGreaterThan(0.015);
    expect(Math.abs(suv.bodyRollOffset!)).toBeGreaterThan(0.01);
    expect(suv.sprungGroup!.rotation.x).toBeCloseTo(suv.bodyPitchOffset!, 4);
  });

  it('aplica impulso proporcional à massa em colisão entre ônibus e hatch e preserva paintHex/finish no save', () => {
    const tex = makeDummyShadowTex();
    const bus = createVehicleEntity('bus_col', 'bus', 0x2563eb, 0, 0, 0, tex, true);
    const hatch = createVehicleEntity('hatch_col', 'hatch', 0x22c55e, 0, 2.5, 0, tex, true);

    bus.speed = 18;
    bus.vx = 18;
    hatch.speed = 0;
    hatch.vx = 0;

    const onVehicleCollision = vi.fn();
    resolveGroundVehicleCollisions(bus, 0, {
      grip: 1,
      accelMult: 1,
      brakeMult: 1,
      lateralDriftMult: 0,
      groundHeightAt: () => 0,
      resolveWorldCollisions: () => false,
      otherVehicles: [bus, hatch],
      onBuildingHit: vi.fn(),
      onVehicleCollision,
      onDoorSlam: vi.fn(),
    });

    expect(onVehicleCollision).toHaveBeenCalledTimes(1);
    // Ônibus (~9800 kg) empurra o hatch (~1090 kg) com variação de velocidade muito maior no hatch
    const deltaHatch = Math.abs(hatch.vx!);
    const deltaBus = Math.abs(18 - bus.vx!);
    expect(deltaHatch).toBeGreaterThan(deltaBus * 4);

    // Preservação de paintHex e finish via SaveBridge
    applyVehiclePaintAndFinish(hatch, 0xa855f7, 'pearlescent');
    const storageMap = new Map<string, string>();
    Object.defineProperty(globalThis, 'window', {
      value: {
        localStorage: {
          getItem: (k: string) => storageMap.get(k) ?? null,
          setItem: (k: string, val: string) => storageMap.set(k, val),
          removeItem: (k: string) => storageMap.delete(k),
        },
      },
      configurable: true,
    });

    const ctx = {
      scene: new THREE.Scene(),
      vehicles: [hatch],
      weatherSystem: {
        getWeather: () => 'clear' as const,
        setWeather: vi.fn(),
      },
      state: {
        money: 500,
        health: 100,
        armor: 0,
        playerPos: new THREE.Vector3(0, 0, 0),
        playerYaw: 0,
        playerVelX: 0,
        playerVelY: 0,
        playerVelZ: 0,
        isGrounded: true,
        currentVehicle: null,
        gameTime: 12,
        dayNumber: 1,
        weapons: [{ id: 'fists', clip: 0, reserve: 0 }],
        activeWeaponId: 'fists',
        outfit: {
          head: 'head_none',
          torso: 'torso_jacket_neon',
          legs: 'legs_jeans_dark',
          shoes: 'shoes_sneakers_white',
          accessory: 'acc_shades_vice',
          hairStyle: 'hair_fade',
          skinTone: 'skin_tan',
        },
        completedEvents: [],
        discoveredAreas: [],
        lastSavedAtIso: null,
        combat: {
          weaponState: 'idle',
          aiming: false,
          reloading: false,
          reloadProgress: 0,
          recoilKickTimer: 0,
          meleeSwingTimer: 0,
          gunShopOpen: false,
          weaponWheelOpen: false,
        },
        radio: {},
      },
      events: new TypedEventBus(),
    } as unknown as EngineContext;

    const saved = captureSaveFromContext(ctx, []);
    expect(saved).not.toBeNull();
    applyVehiclePaintAndFinish(hatch, 0x111111, 'matte');
    restoreSaveIntoContext(ctx);
    expect(hatch.paintHex).toBe(0xa855f7);
    expect(hatch.finish).toBe('pearlescent');
    expect(hatch.paintMaterial!.color.getHex()).toBe(0xa855f7);
  });
});
