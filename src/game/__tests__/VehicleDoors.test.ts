import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { createVehicleEntity } from '../models';
import { InputManager } from '../systems/InputManager';
import {
  applyDoorCrashImpulse,
  stepVehicleDoors,
  toggleAllVehicleDoors,
  triggerDoorEntryAnimation,
  triggerDoorExitSwing,
} from '../systems/VehicleDoorPhysics';
import { VehicleSystem } from '../systems/VehicleSystem';
import { EngineContext } from '../core/SystemLifecycle';
import { TypedEventBus } from '../core/EventBus';

function makeDummyShadowTex(): THREE.CanvasTexture {
  return new THREE.CanvasTexture({} as HTMLCanvasElement);
}

function makeVehicleTestCtx(playerX = -52, playerZ = -16) {
  const events = new TypedEventBus();
  const state = {
    playerPos: new THREE.Vector3(playerX, 0, playerZ),
    currentVehicle: null,
    missionCar: null,
    elapsedSec: 0,
    weatherEffects: { grip: 1, accelMult: 1, brakeMult: 1, lateralDriftMult: 0 },
  } as unknown as EngineContext['state'];

  const audio = {
    unlock: vi.fn(),
    playDoorToggle: vi.fn(),
    playDoorOpen: vi.fn(),
    playDoorSlam: vi.fn(),
    playCollision: vi.fn(),
    playHorn: vi.fn(),
  } as unknown as EngineContext['audio'];

  const ctx = {
    scene: new THREE.Scene(),
    vehicles: [],
    state,
    events,
    audio,
    crowd: { triggerPanicRadius: vi.fn(), graph: {} } as unknown as EngineContext['crowd'],
    transit: { releaseBusPassengersOnHijack: vi.fn() } as unknown as EngineContext['transit'],
    weatherEffects: { grip: 1, accelMult: 1, brakeMult: 1, lateralDriftMult: 0 } as EngineContext['weatherEffects'],
    groundHeightAt: () => 0,
    resolveWorldCollisions: () => false,
    isSoftwareGl: true,
  } as unknown as EngineContext;

  return { ctx, state, events, audio };
}

describe('Fase 1 — Portas com física (dobradiça, inércia e colisões)', () => {
  it('constrói portas articuladas esquerda e direita em carros e viaturas com abertura para fora correta', () => {
    const tex = makeDummyShadowTex();

    for (const type of ['coupe', 'sedan', 'sports', 'police'] as const) {
      const car = createVehicleEntity(`test_${type}`, type, 0x16f2d4, 0, 0, 0, tex, true);
      expect(car.doors).toBeDefined();
      const expectedDoors = type === 'sedan' ? 4 : 2;
      expect(car.doors?.length).toBe(expectedDoors);

      const leftDoor = car.doors!.find((d) => d.side === 'left')!;
      const rightDoor = car.doors!.find((d) => d.side === 'right')!;
      expect(leftDoor.latched).toBe(true);
      expect(rightDoor.latched).toBe(true);
      expect(leftDoor.angle).toBe(0);
      expect(rightDoor.angle).toBe(0);

      // Verifica pela matriz do Three.js que um ponto traseiro da porta abre PARA FORA (-X esquerda, +X direita)
      leftDoor.pivot.rotation.y = leftDoor.openSign * 0.8;
      rightDoor.pivot.rotation.y = rightDoor.openSign * 0.8;
      car.mesh.updateMatrixWorld(true);

      const rearLocal = new THREE.Vector3(0, 0, -1);
      const leftTipWorld = rearLocal.clone().applyMatrix4(leftDoor.pivot.matrixWorld);
      const rightTipWorld = rearLocal.clone().applyMatrix4(rightDoor.pivot.matrixWorld);

      expect(leftTipWorld.x).toBeLessThan(leftDoor.pivot.position.x);
      expect(rightTipWorld.x).toBeGreaterThan(rightDoor.pivot.position.x);
    }

    // Ônibus e ambulância continuam funcionando sem erros
    const bus = createVehicleEntity('test_bus', 'bus', 0xfacc15, 0, 0, 0, tex, true);
    expect(bus.doors?.length ?? 0).toBe(0);
  });

  it('aceleração para frente fecha porta destravada e trava com som de batida; frenagem abre a porta', () => {
    const car = createVehicleEntity('phys_car', 'coupe', 0x16f2d4, 0, 0, 0, makeDummyShadowTex(), true);
    const leftDoor = car.doors!.find((d) => d.side === 'left')!;

    // Destrava a porta levemente aberta e freia forte (speed caindo de 18 para 4)
    leftDoor.latched = false;
    leftDoor.angle = 0.25;
    leftDoor.angularVel = 0;
    car.prevSpeed = 18;
    car.speed = 12;

    stepVehicleDoors(car, 0.03);
    expect(leftDoor.angularVel).toBeGreaterThan(0);
    const angleAfterBrake = leftDoor.angle;
    expect(angleAfterBrake).toBeGreaterThan(0.25);

    // Agora acelera forte para frente: deve empurrar a porta aberta rumo ao fechamento até bater e travar
    const onSlam = vi.fn();
    leftDoor.angle = 0.45;
    leftDoor.angularVel = 0;
    car.prevSpeed = 0;

    for (let i = 0; i < 40; i++) {
      car.prevSpeed = car.speed;
      car.speed += 0.9; // aceleração longitudinal forte (~30 m/s^2 em dt=0.03)
      stepVehicleDoors(car, 0.03, onSlam);
      if (leftDoor.latched) break;
    }

    expect(leftDoor.latched).toBe(true);
    expect(leftDoor.angle).toBe(0);
    expect(onSlam).toHaveBeenCalledTimes(1);
  });

  it('força centrífuga em curva à esquerda abre a porta direita e puxa a esquerda para fechar', () => {
    const car = createVehicleEntity('turn_car', 'sports', 0xff2e93, 0, 0, 0, makeDummyShadowTex(), true);
    const leftDoor = car.doors!.find((d) => d.side === 'left')!;
    const rightDoor = car.doors!.find((d) => d.side === 'right')!;

    leftDoor.latched = false;
    rightDoor.latched = false;
    leftDoor.angle = 0.35;
    rightDoor.angle = 0.35;
    leftDoor.angularVel = 0;
    rightDoor.angularVel = 0;

    // Movimento rápido para frente virando para a esquerda (heading aumentando)
    car.prevSpeed = 20;
    car.speed = 20;
    car.prevHeading = 0;
    car.heading = 0.12;

    stepVehicleDoors(car, 0.03);
    expect(rightDoor.angularVel).toBeGreaterThan(0); // porta direita empurrada para fora
    expect(leftDoor.angularVel).toBeLessThan(0);     // porta esquerda puxada para dentro
  });

  it('respeita batente máximo da dobradiça com quique elástico e reage a impactos de colisão', () => {
    const car = createVehicleEntity('crash_car', 'sedan', 0x38bdf8, 0, 0, 0, makeDummyShadowTex(), true);
    const leftDoor = car.doors!.find((d) => d.side === 'left')!;

    leftDoor.latched = false;
    leftDoor.angle = leftDoor.maxAngle - 0.01;
    leftDoor.angularVel = 8;

    stepVehicleDoors(car, 0.03);
    expect(leftDoor.angle).toBeLessThanOrEqual(leftDoor.maxAngle);
    expect(leftDoor.angularVel).toBeLessThan(0); // quicou no batente

    // Colisão destrava e impulsiona porta fechada
    leftDoor.latched = true;
    leftDoor.angle = 0;
    leftDoor.angularVel = 0;
    applyDoorCrashImpulse(car, 0.9, -0.8);
    expect(leftDoor.latched).toBe(false);
    expect(leftDoor.angularVel).toBeGreaterThan(2);
  });

  it('anima entrada, saída e alternância manual (J) no VehicleSystem', () => {
    const { ctx, state, audio } = makeVehicleTestCtx(-52, -16);
    const input = new InputManager();
    const vehicleSys = new VehicleSystem(input, makeDummyShadowTex());
    vehicleSys.init(ctx);

    const starter = ctx.vehicles.find((v) => v.id === 'starter_coupe')!;
    expect(starter).toBeDefined();
    const driverDoor = starter.doors!.find((d) => d.side === 'left')!;

    // Entrar no veículo abre brevemente e depois puxa para travar
    vehicleSys.toggleVehicle();
    expect(state.currentVehicle).toBe(starter);
    expect(driverDoor.angle).toBeGreaterThan(0.1);
    expect(audio.playDoorOpen).toHaveBeenCalled();

    for (let i = 0; i < 40; i++) {
      vehicleSys.update(0.03);
    }
    expect(driverDoor.latched).toBe(true);
    expect(driverDoor.angle).toBe(0);

    // Alternar portas manualmente destrava todas as portas para balançar
    const toggleResult = toggleAllVehicleDoors(starter);
    expect(toggleResult).toBe('opened');
    expect(starter.doors!.every((d) => !d.latched)).toBe(true);

    // Sair do veículo empurra a porta do motorista para abrir com física
    toggleAllVehicleDoors(starter); // fecha antes para testar saída limpa
    for (let i = 0; i < 40; i++) vehicleSys.update(0.03);
    vehicleSys.toggleVehicle();
    expect(state.currentVehicle).toBeNull();
    expect(driverDoor.latched).toBe(false);
    expect(driverDoor.angularVel).toBeGreaterThan(4);

    // Após alguns frames fora do carro, a porta abre até próximo do batente sem travar
    for (let i = 0; i < 12; i++) vehicleSys.update(0.03);
    expect(driverDoor.angle).toBeGreaterThan(0.4);

    // Helper triggerDoorEntryAnimation direto também prepara openTimer
    triggerDoorExitSwing(starter);
    expect(driverDoor.latched).toBe(false);
    triggerDoorEntryAnimation(starter);
    expect(driverDoor.targetAngle).toBeGreaterThan(0.5);

    vehicleSys.dispose();
  });
});
