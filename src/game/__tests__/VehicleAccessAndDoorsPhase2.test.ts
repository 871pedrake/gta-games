import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { TypedEventBus } from '../core/EventBus';
import { EngineContext } from '../core/SystemLifecycle';
import { createVehicleEntity } from '../models';
import { InputManager } from '../systems/InputManager';
import { applyDoorCrashImpulse, stepVehicleDoors } from '../systems/VehicleDoorPhysics';
import { VehicleSystem } from '../systems/VehicleSystem';
import { VehicleDoorEventState } from '../types';
import { syncVehicleCabinVisuals } from '../vehicles/builders/sharedBuilderUtils';
import {
  DOOR_DAMP_C,
  DOOR_OPEN_VIS_ANGLE_RAD,
  DOOR_SPRING_K,
  stepDoorsPhysics,
} from '../vehicles/physics/doorPhysics';
import { VEHICLE_SPECS } from '../vehicles/VehicleSpecs';

function makeDummyShadowTex(): THREE.CanvasTexture {
  return new THREE.CanvasTexture({} as HTMLCanvasElement);
}

function makePhase2Ctx(
  playerX = -52,
  playerZ = -16,
  options?: {
    isSoftwareGl?: boolean;
    qualityPreset?: 'low' | 'medium' | 'high';
    resolveWorldCollisions?: (pos: THREE.Vector3, radius: number) => boolean;
  }
) {
  const events = new TypedEventBus();
  const state = {
    playerPos: new THREE.Vector3(playerX, 0, playerZ),
    playerYaw: 0,
    playerVelX: 0,
    playerVelY: 0,
    playerVelZ: 0,
    isGrounded: true,
    health: 100,
    armor: 0,
    currentVehicle: null,
    missionCar: null,
    elapsedSec: 0,
    vehicleAccess: {
      active: false,
      vehicleId: null,
      x: playerX,
      y: 0,
      z: playerZ,
      yaw: 0,
      walkPhase: 0,
      sitBlend: 0,
      visible: false,
    },
  } as unknown as EngineContext['state'];

  const audio = {
    unlock: vi.fn(),
    playDoorToggle: vi.fn(),
    playDoorOpen: vi.fn(),
    playDoorClose: vi.fn(),
    playDoorSlam: vi.fn(),
    playCollision: vi.fn(),
    playHorn: vi.fn(),
  } as unknown as EngineContext['audio'];

  const ragdolls = {
    spawn: vi.fn(),
  } as unknown as EngineContext['ragdolls'];

  const ctx = {
    scene: new THREE.Scene(),
    vehicles: [],
    state,
    events,
    audio,
    ragdolls,
    crowd: { triggerPanicRadius: vi.fn(), graph: {} } as unknown as EngineContext['crowd'],
    transit: { releaseBusPassengersOnHijack: vi.fn() } as unknown as EngineContext['transit'],
    weatherEffects: { grip: 1, accelMult: 1, brakeMult: 1, lateralDriftMult: 0 } as EngineContext['weatherEffects'],
    groundHeightAt: () => 0,
    resolveWorldCollisions: options?.resolveWorldCollisions ?? (() => false),
    isSoftwareGl: options?.isSoftwareGl ?? false,
    qualityPreset: options?.qualityPreset ?? 'medium',
  } as unknown as EngineContext;

  return { ctx, state, events, audio, ragdolls };
}

function triggerInteractKey(input: InputManager): void {
  // Simula aperto da tecla F (padrão de interact no InputManager)
  (input as unknown as { justPressedActions: Set<string> }).justPressedActions.add('interact');
}

describe('FASE 2 — Portas com física + entrar/sair animado', () => {
  it('mecanismos por modelo: tesoura (esportivo em eixo X), corrediça (~0,9 m na van) e dobradiça comum (~65°)', () => {
    const tex = makeDummyShadowTex();
    const sports = createVehicleEntity('sp1', 'sports', 0xff2e93, 0, 0, 0, tex, false);
    const van = createVehicleEntity('amb1', 'ambulance', 0xf8fafc, 0, 0, 0, tex, false);
    const coupe = createVehicleEntity('cp1', 'coupe', 0x16f2d4, 0, 0, 0, tex, false);

    // Ângulo máximo ~65° e parâmetros mola-amortecedor k≈60, c≈9
    expect(VEHICLE_SPECS.coupe.doors.maxAngle).toBeCloseTo((65 * Math.PI) / 180, 3);
    expect(DOOR_SPRING_K).toBe(60);
    expect(DOOR_DAMP_C).toBe(9);

    // Porta tesoura do esportivo gira no eixo horizontal (X)
    const spLeft = sports.doors!.find((d) => d.side === 'left')!;
    expect(spLeft.mechanism).toBe('scissor');
    spLeft.latched = false;
    spLeft.angle = spLeft.maxAngle;
    stepVehicleDoors(sports, 0.016);
    expect(spLeft.pivot.rotation.x).toBeGreaterThan(0.9);

    // Porta de correr da van/ambulância desliza ~0,9 m para trás em Z
    const vanSlide = van.doors!.find((d) => d.side === 'right')!;
    expect(vanSlide.mechanism).toBe('sliding');
    const restZ = vanSlide.restPosZ!;
    vanSlide.latched = false;
    vanSlide.targetAngle = vanSlide.maxAngle;
    for (let i = 0; i < 60; i++) {
      stepVehicleDoors(van, 0.02);
    }
    expect(vanSlide.slideDistance).toBeCloseTo(0.9, 1);
    expect(restZ - vanSlide.pivot.position.z).toBeCloseTo(0.9, 1);

    // Vão escuro é ativado apenas quando ângulo > 2°
    const cpLeft = coupe.doors!.find((d) => d.side === 'left')!;
    syncVehicleCabinVisuals(coupe, false, 'medium');
    expect(coupe.cabinVisuals!.doorWellGroups[0].visible).toBe(false);
    cpLeft.angle = DOOR_OPEN_VIS_ANGLE_RAD + 0.02;
    syncVehicleCabinVisuals(coupe, false, 'medium');
    expect(coupe.cabinVisuals!.doorWellGroups[0].visible).toBe(true);
  });

  it('qualidade média/alta deixa vidro semitransparente com piloto visível; low/softwareGl mantém opaco', () => {
    const tex = makeDummyShadowTex();
    const car = createVehicleEntity('glass_car', 'coupe', 0x38bdf8, 0, 0, 0, tex, false);
    car.driver = 'player';

    syncVehicleCabinVisuals(car, false, 'high');
    expect(car.cabinVisuals!.glassMats[0].transparent).toBe(true);
    expect(car.cabinVisuals!.glassMats[0].opacity).toBeLessThan(0.7);
    expect(car.cabinVisuals!.interiorGroup!.visible).toBe(true);
    expect(car.cabinVisuals!.seatedDriverGroup!.visible).toBe(true);

    syncVehicleCabinVisuals(car, false, 'low');
    expect(car.cabinVisuals!.glassMats[0].transparent).toBe(false);
    expect(car.cabinVisuals!.glassMats[0].opacity).toBe(1);
    expect(car.cabinVisuals!.interiorGroup!.visible).toBe(false);

    syncVehicleCabinVisuals(car, true, 'high');
    expect(car.cabinVisuals!.glassMats[0].transparent).toBe(false);
  });

  it('batida lateral forte deixa porta entreaberta e fechamento em 0° gera tranco, som e evento vehicleDoorChanged', () => {
    const tex = makeDummyShadowTex();
    const car = createVehicleEntity('hit_car', 'sedan', 0x38bdf8, 0, 0, 0, tex, false);
    const states: VehicleDoorEventState[] = [];

    applyDoorCrashImpulse(car, 0.95, -0.8);
    const leftDoor = car.doors!.find((d) => d.side === 'left')!;
    expect(leftDoor.latched).toBe(false);
    expect(leftDoor.ajarAngle).toBeGreaterThan(0.1);

    for (let i = 0; i < 120; i++) {
      stepDoorsPhysics(car, 0.02, undefined, (door, _idx, st) => {
        if (door.side === 'left') states.push(st);
      });
    }
    // Estabiliza entreaberta (> 2°) em vez de travar totalmente fechada
    expect(leftDoor.latched).toBe(false);
    expect(leftDoor.angle).toBeGreaterThan(DOOR_OPEN_VIS_ANGLE_RAD);
    expect(states).toContain('ajar');
  });

  it('máquina de estados de entrada pelo lado mais próximo (passageiro desliza até motorista) emite vehicleEntered só ao sentar', () => {
    // Jogador posicionado à direita do carro inicial (-52, -16) -> deve escolher porta do passageiro (direita)
    const { ctx, state, events, audio } = makePhase2Ctx(-49.6, -16.1);
    const input = new InputManager();
    const vehicleSys = new VehicleSystem(input, makeDummyShadowTex());
    vehicleSys.init(ctx);

    const starter = ctx.vehicles.find((v) => v.id === 'starter_coupe')!;
    const enteredSpy = vi.fn();
    const doorChangedSpy = vi.fn();
    events.on('vehicleEntered', enteredSpy);
    events.on('vehicleDoorChanged', doorChangedSpy);

    triggerInteractKey(input);
    vehicleSys.update(0.016);
    expect(vehicleSys.getAccessPhase()).toBe('approaching');
    expect(state.currentVehicle).toBeNull();
    expect(enteredSpy).not.toHaveBeenCalled();

    // Avança ~0,6s até abrir a porta direita e iniciar embarque
    for (let i = 0; i < 45; i++) {
      vehicleSys.update(0.02);
      if (vehicleSys.getAccessPhase() === 'boarding') break;
    }
    expect(vehicleSys.getAccessPhase()).toBe('boarding');
    expect(starter.doors![1].angle).toBeGreaterThan(0.35); // porta direita abriu
    expect(audio.playDoorToggle).toHaveBeenCalled();
    expect(enteredSpy).not.toHaveBeenCalled(); // ainda não sentou!

    // Avança embarque até sentar -> emite vehicleEntered e entra em doorClosing -> driving
    for (let i = 0; i < 80; i++) {
      vehicleSys.update(0.02);
    }
    expect(enteredSpy).toHaveBeenCalledTimes(1);
    expect(state.currentVehicle).toBe(starter);
    expect(vehicleSys.getAccessPhase()).toBe('driving');
    expect(audio.playDoorClose).toHaveBeenCalled();
    expect(doorChangedSpy).toHaveBeenCalledWith(
      expect.objectContaining({ vehicleId: starter.id, doorIndex: 1, state: 'closed' })
    );

    vehicleSys.dispose();
  });

  it('saída exige baixa velocidade, valida colisão tentando outro lado e fecha porta após se afastar > 2 m', () => {
    const { ctx, state, events } = makePhase2Ctx(-52, -16, {
      // Bloqueia o lado esquerdo (motorista, x < car.x) simulando parede colada à esquerda
      resolveWorldCollisions: (pos) => {
        if (pos.x < -52.2) {
          pos.x = -52.1;
          return true;
        }
        return false;
      },
    });
    const input = new InputManager();
    const vehicleSys = new VehicleSystem(input, makeDummyShadowTex());
    vehicleSys.init(ctx);
    const starter = ctx.vehicles.find((v) => v.id === 'starter_coupe')!;
    const banners: string[] = [];
    events.on('bannerRequested', ({ text }) => banners.push(text));

    // Entra diretamente para testar saída
    vehicleSys.toggleVehicle();
    for (let i = 0; i < 40; i++) vehicleSys.update(0.02);
    starter.speed = 15;

    // Tentativa de saída em alta velocidade mostra banner "Pare o veículo"
    triggerInteractKey(input);
    vehicleSys.update(0.016);
    expect(banners.some((b) => b.includes('Pare o veículo'))).toBe(true);
    expect(state.currentVehicle).toBe(starter);

    // Para o veículo e sai -> como esquerda está bloqueada, deve sair pela direita
    starter.speed = 0;
    triggerInteractKey(input);
    for (let i = 0; i < 60; i++) {
      vehicleSys.update(0.02);
      if (state.currentVehicle === null && vehicleSys.getAccessPhase() === 'idle') break;
    }
    expect(state.currentVehicle).toBeNull();
    expect(state.playerPos.x).toBeGreaterThan(starter.x); // caiu do lado direito
    expect(starter.doors![1].angle).toBeGreaterThan(0.2); // porta direita ficou aberta

    // Afasta o jogador > 2 m do carro -> porta começa a fechar até travar
    state.playerPos.x += 2.6;
    for (let i = 0; i < 80; i++) {
      vehicleSys.update(0.02);
    }
    expect(starter.doors![1].latched).toBe(true);
    expect(starter.doors![1].angle).toBe(0);

    vehicleSys.dispose();
  });

  it('reverte com F no meio da animação, aborta em dano/busted sem travar e ejeta motorista em roubo de NPC', () => {
    const { ctx, state, events, ragdolls } = makePhase2Ctx(-54.2, -16);
    const input = new InputManager();
    const vehicleSys = new VehicleSystem(input, makeDummyShadowTex());
    vehicleSys.init(ctx);
    const starter = ctx.vehicles.find((v) => v.id === 'starter_coupe')!;
    starter.driver = 'npc';

    const crimeSpy = vi.fn();
    events.on('crimeCommitted', crimeSpy);

    // 1. Inicia aproximação e aperta F no meio para reverter/cancelar
    triggerInteractKey(input);
    vehicleSys.update(0.05);
    expect(vehicleSys.getAccessPhase()).toBe('approaching');
    triggerInteractKey(input);
    vehicleSys.update(0.016);
    expect(vehicleSys.getAccessPhase()).toBe('idle');
    expect(state.vehicleAccess!.active).toBe(false);

    // 2. Inicia de novo até doorOpening (roubo de NPC) -> ragdoll + crimeCommitted
    triggerInteractKey(input);
    for (let i = 0; i < 45; i++) {
      vehicleSys.update(0.02);
      if (vehicleSys.getAccessPhase() === 'boarding') break;
    }
    expect(ragdolls.spawn).toHaveBeenCalledTimes(1);
    expect(crimeSpy).toHaveBeenCalledWith(expect.objectContaining({ source: 'carjack' }));

    // 3. Dano durante embarque aborta limpo para idle sem travar controles
    events.emit('playerDamaged', { amount: 15, armorAbsorbed: 0, source: 'shot' });
    expect(vehicleSys.getAccessPhase()).toBe('idle');
    expect(state.vehicleAccess!.active).toBe(false);
    expect(state.currentVehicle).toBeNull();

    // 4. Prisão (busted) também aborta limpo para idle
    triggerInteractKey(input);
    vehicleSys.update(0.05);
    events.emit('busted', { fine: 100 });
    expect(vehicleSys.getAccessPhase()).toBe('idle');
    expect(state.vehicleAccess!.active).toBe(false);

    vehicleSys.dispose();
  });
});
