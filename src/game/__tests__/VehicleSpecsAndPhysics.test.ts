import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { VehicleType } from '../types';
import { createVehicleEntity } from '../vehicles/createVehicleEntity';
import { getVehicleController } from '../vehicles/controllers/ControllerRegistry';
import { stepBikePhysics } from '../vehicles/physics/bikePhysics';
import { stepCarPhysics } from '../vehicles/physics/carPhysics';
import { stepDoorsPhysics } from '../vehicles/physics/doorPhysics';
import {
  FIXED_PHYSICS_DT,
  MAX_FRAME_DT,
  MAX_SUBSTEPS_PER_FRAME,
  runFixedSubsteps,
} from '../vehicles/physics/fixedStep';
import { stepHeliPhysics } from '../vehicles/physics/heliPhysics';
import { stepPlanePhysics } from '../vehicles/physics/planePhysics';
import { VEHICLE_SPECS } from '../vehicles/VehicleSpecs';

function makeDummyShadowTex(): THREE.CanvasTexture {
  return new THREE.CanvasTexture({} as HTMLCanvasElement);
}

describe('FASE 1 — Base orientada a dados (VehicleSpecs, builders, controladores e física pura 1/120s)', () => {
  it('tabela VEHICLE_SPECS define metadados completos para todas as classes e tipos', () => {
    const types = Object.keys(VEHICLE_SPECS) as VehicleType[];
    expect(types).toEqual(
      expect.arrayContaining([
        'coupe',
        'sedan',
        'sports',
        'police',
        'bus',
        'ambulance',
        'sportbike',
        'streetbike',
        'helicopter',
        'plane',
      ])
    );

    for (const type of types) {
      const spec = VEHICLE_SPECS[type];
      expect(spec.massKg).toBeGreaterThan(100);
      expect(spec.dimensions.width).toBeGreaterThan(0.5);
      expect(spec.dimensions.length).toBeGreaterThan(1.5);
      expect(spec.handling.maxSpeed).toBeGreaterThan(10);
      expect(spec.seat.exitOffsetX).not.toBe(0);
      if (spec.class === 'heli' || spec.class === 'plane') {
        expect(spec.flight).toBeDefined();
        expect(spec.flight!.maxAltitude).toBeGreaterThan(50);
      }
    }
  });

  it('fábrica createVehicleEntity constrói todas as 4 classes (car, bike, heli, plane) preenchendo novos campos', () => {
    const tex = makeDummyShadowTex();
    const allTypes = Object.keys(VEHICLE_SPECS) as VehicleType[];

    for (const type of allTypes) {
      const spec = VEHICLE_SPECS[type];
      const entity = createVehicleEntity(`v_${type}`, type, spec.defaultPaintHex, 10, 20, 0.5, tex, true);

      expect(entity.class).toBe(spec.class);
      expect(entity.y).toBe(0);
      expect(entity.pitch).toBe(0);
      expect(entity.roll).toBe(0);
      expect(entity.seat).toEqual(spec.seat);
      expect(entity.handling).toEqual(spec.handling);
      expect(entity.name).toBe(spec.name);

      if (spec.doors.hasHingedDoors) {
        expect(entity.doors?.length).toBe(spec.doors.count);
      }
      if (spec.class === 'heli' || spec.class === 'plane') {
        expect(entity.flight).toBeDefined();
        expect(entity.rotors?.length).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('runFixedSubsteps executa passo fixo de 1/120 s e limita a 4 substeps mesmo após troca de aba (dt gigante)', () => {
    const stepFn = vi.fn();
    // dt = 1/60 s deve rodar exatamente 2 substeps de 1/120 s
    const resNormal = runFixedSubsteps(1 / 60, 0, stepFn);
    expect(resNormal.substeps).toBe(2);
    expect(stepFn).toHaveBeenCalledWith(FIXED_PHYSICS_DT);

    // dt = 12.0 s (troca de aba) é limitado a MAX_FRAME_DT e no máximo MAX_SUBSTEPS_PER_FRAME (4)
    const tabStepFn = vi.fn();
    const resTab = runFixedSubsteps(12.0, 0, tabStepFn);
    expect(resTab.clampedDt).toBe(MAX_FRAME_DT);
    expect(resTab.substeps).toBe(MAX_SUBSTEPS_PER_FRAME);
    expect(tabStepFn).toHaveBeenCalledTimes(MAX_SUBSTEPS_PER_FRAME);
  });

  it('funções puras de física (car, bike, heli, plane, doors) rodam sem THREE e progridem estado', () => {
    // Carro
    const carState = { x: 0, z: 0, heading: 0, speed: 0, steerAngle: 0, lateralSpeed: 0, damageRatio: 0 };
    stepCarPhysics(
      carState,
      VEHICLE_SPECS.coupe.handling,
      { throttle: 1, steerInput: 0.4, handbrake: false },
      { grip: 1, accelMult: 1, brakeMult: 1, lateralDriftMult: 0 },
      FIXED_PHYSICS_DT
    );
    expect(carState.speed).toBeGreaterThan(0);
    expect(carState.z).toBeGreaterThan(0);

    // Moto
    const bikeState = { x: 0, z: 0, heading: 0, speed: 15, steerAngle: 0, roll: 0, pitch: 0, damageRatio: 0 };
    stepBikePhysics(
      bikeState,
      VEHICLE_SPECS.sportbike.handling,
      { throttle: 1, steerInput: 0.8, handbrake: false },
      1,
      FIXED_PHYSICS_DT
    );
    expect(bikeState.steerAngle).toBeGreaterThan(0);
    expect(Math.abs(bikeState.roll)).toBeGreaterThan(0);

    // Helicóptero
    const heliState = { x: 0, y: 0, z: 0, vy: 0, heading: 0, speed: 0, pitch: 0, roll: 0, rotorSpeed: 24, airborne: false };
    for (let i = 0; i < 60; i++) {
      stepHeliPhysics(
        heliState,
        VEHICLE_SPECS.helicopter.handling,
        VEHICLE_SPECS.helicopter.flight!,
        { collective: 1, pitchInput: 0.5, yawInput: 0 },
        0,
        true,
        FIXED_PHYSICS_DT
      );
    }
    expect(heliState.y).toBeGreaterThan(0.5);
    expect(heliState.airborne).toBe(true);

    // Avião
    const planeState = { x: 0, y: 0, z: 0, vy: 0, heading: 0, speed: 30, pitch: 0, roll: 0, propSpeed: 36, airborne: false };
    for (let i = 0; i < 60; i++) {
      stepPlanePhysics(
        planeState,
        VEHICLE_SPECS.plane.handling,
        VEHICLE_SPECS.plane.flight!,
        { throttle: 1, rollInput: 0, pitchInput: 0.6 },
        0,
        true,
        FIXED_PHYSICS_DT
      );
    }
    expect(planeState.y).toBeGreaterThan(0.5);
    expect(planeState.airborne).toBe(true);

    // Porta pura (sem pivot THREE)
    const pureDoorVeh = {
      speed: 12,
      heading: 0,
      prevSpeed: 0,
      prevHeading: 0,
      doors: [
        {
          id: 'd_left',
          side: 'left' as const,
          openSign: 1 as const,
          angle: 0.5,
          angularVel: 0,
          targetAngle: null,
          maxAngle: 1.16,
          latched: false,
        },
      ],
    };
    stepDoorsPhysics(pureDoorVeh, 0.02);
    expect(pureDoorVeh.doors[0].angularVel).toBeLessThan(0);
  });

  it('ControllerRegistry despacha o controlador certo por classe de veículo', () => {
    expect(getVehicleController('car').vehicleClass).toBe('car');
    expect(getVehicleController('bike').vehicleClass).toBe('bike');
    expect(getVehicleController('heli').vehicleClass).toBe('heli');
    expect(getVehicleController('plane').vehicleClass).toBe('plane');

    const tex = makeDummyShadowTex();
    const car = createVehicleEntity('c1', 'coupe', 0x16f2d4, 0, 0, 0, tex, true);
    const ctrl = getVehicleController(car.class!);
    ctrl.update(
      car,
      { throttle: 1, strafe: 0, handbrake: false, sprint: false },
      0.016,
      {
        grip: 1,
        accelMult: 1,
        brakeMult: 1,
        lateralDriftMult: 0,
        groundHeightAt: () => 0,
        resolveWorldCollisions: () => false,
        otherVehicles: [car],
        onBuildingHit: vi.fn(),
        onVehicleCollision: vi.fn(),
        onDoorSlam: vi.fn(),
      }
    );
    expect(car.speed).toBeGreaterThan(0);
    expect(car.mesh.position.z).toBeGreaterThan(0);
  });
});
