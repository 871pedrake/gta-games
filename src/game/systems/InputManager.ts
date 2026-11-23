import { DEFAULT_KEY_BINDINGS } from '../core/SaveSystem';
import { EngineContext, GameSystem } from '../core/SystemLifecycle';
import { GameAction, KeyBindings } from '../types';

export interface TouchInputState {
  moveX: number; // -1..1
  moveY: number; // -1 (backward) .. +1 (forward)
  sprint: boolean;
  jump: boolean;
  interact: boolean;
  horn: boolean;
  aim: boolean;
  fire: boolean;
  reload: boolean;
  swapWeapon: boolean;
  radioNext?: boolean;
}

const ACTION_ACTIONS: GameAction[] = [
  'moveForward',
  'moveBackward',
  'moveLeft',
  'moveRight',
  'sprint',
  'jump',
  'interact',
  'toggleDoors',
  'horn',
  'radioNext',
  'radioPrev',
  'aim',
  'fire',
  'reload',
  'weaponWheel',
  'melee',
  'map',
  'weaponSlot1',
  'weaponSlot2',
  'weaponSlot3',
  'weaponSlot4',
  'weaponSlot5',
  'camLeft',
  'camRight',
  'cycleWeather',
  'cycleTimeScale',
  'toggleDebug',
  'toggleWaypoints',
  'toggleColliders',
  'toggleRoutineLabels',
  'spawnTestGroup',
  'pause',
];

export class InputManager implements GameSystem {
  public readonly name = 'InputManager';

  private ctx: EngineContext | null = null;
  private bindings: KeyBindings = { ...DEFAULT_KEY_BINDINGS };
  private keys = new Set<string>();
  private justPressedActions = new Set<GameAction>();

  // Estado analógico do Gamepad e Touch virtual
  public gamepadConnected = false;
  private gpMoveX = 0;
  private gpMoveY = 0;
  private gpCamX = 0;
  private gpCamY = 0;
  private gpSprint = false;
  private gpAimHeld = false;
  private gpFireHeld = false;
  private gpPrevFireHeld = false;
  private gpWeaponCycleDelta = 0;
  private gpPrevButtons = new Map<number, boolean>();

  private touchState: TouchInputState = {
    moveX: 0,
    moveY: 0,
    sprint: false,
    jump: false,
    interact: false,
    horn: false,
    aim: false,
    fire: false,
    reload: false,
    swapWeapon: false,
  };
  private touchPrevInteract = false;
  private touchPrevJump = false;
  private touchPrevHorn = false;
  private touchPrevFire = false;
  private touchPrevReload = false;
  private touchPrevSwapWeapon = false;
  private touchPrevAim = false;
  private touchPrevRadioNext = false;

  // Pointer lock e arrasto de câmera (fallback desarmado / touch)
  private onPointerLookDelta: ((dx: number, dy: number) => void) | null = null;
  private onPointerLockLost: (() => void) | null = null;
  private canUseDragFallback: (() => boolean) | null = null;
  private uiModalOpen = false;
  private pointerLocked = false;
  private hadPointerLock = false;
  private isDraggingCam = false;
  private lastPointerX = 0;
  private lastPointerY = 0;
  private capturingKey = false;

  constructor(initialBindings?: KeyBindings) {
    if (initialBindings) {
      this.bindings = { ...DEFAULT_KEY_BINDINGS, ...initialBindings };
    }
  }

  public init(ctx: EngineContext): void {
    this.ctx = ctx;
    if (typeof window === 'undefined') return;

    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    window.addEventListener('blur', this.handleBlur);
    window.addEventListener('gamepadconnected', this.handleGamepadChange);
    window.addEventListener('gamepaddisconnected', this.handleGamepadChange);
    document.addEventListener('pointerlockchange', this.handlePointerLockChange);

    const dom = ctx.renderer.domElement;
    dom.addEventListener('pointerdown', this.handlePointerDown);
    dom.addEventListener('contextmenu', this.handleContextMenu);
    window.addEventListener('pointermove', this.handlePointerMove);
    window.addEventListener('pointerup', this.handlePointerUp);
  }

  public setKeyBindings(bindings: KeyBindings): void {
    this.bindings = { ...DEFAULT_KEY_BINDINGS, ...bindings };
  }

  public getKeyBindings(): KeyBindings {
    return { ...this.bindings };
  }

  public setCapturingKey(capturing: boolean): void {
    this.capturingKey = capturing;
    if (capturing) {
      this.keys.clear();
      this.justPressedActions.clear();
    }
  }

  public setPointerLookHandler(cb: ((dx: number, dy: number) => void) | null): void {
    this.onPointerLookDelta = cb;
  }

  public setPointerLockLostHandler(cb: (() => void) | null): void {
    this.onPointerLockLost = cb;
  }

  public setCanUseDragFallback(cb: (() => boolean) | null): void {
    this.canUseDragFallback = cb;
  }

  public setUiModalOpen(open: boolean): void {
    this.uiModalOpen = open;
    if (open) {
      this.releasePointerLock();
      this.isDraggingCam = false;
      this.keys.delete('MouseLeft');
      this.keys.delete('MouseRight');
    }
  }

  public isUiModalOpen(): boolean {
    return this.uiModalOpen;
  }

  public isPointerLocked(): boolean {
    return this.pointerLocked;
  }

  public releasePointerLock(): void {
    this.hadPointerLock = false;
    if (typeof document !== 'undefined' && this.ctx && document.pointerLockElement === this.ctx.renderer.domElement) {
      try {
        document.exitPointerLock?.();
      } catch {
        // Ignora ambientes sem pointer lock
      }
    }
    this.pointerLocked = false;
  }

  public requestPointerLock(): void {
    if (typeof document === 'undefined' || !this.ctx) return;
    if (this.uiModalOpen || this.ctx.state.paused) return;
    const dom = this.ctx.renderer.domElement;
    if (document.pointerLockElement === dom) return;
    try {
      const maybePromise = dom.requestPointerLock?.() as unknown as Promise<void> | undefined;
      if (maybePromise && typeof maybePromise.catch === 'function') {
        maybePromise.catch(() => {
          // Ignora rejeição silenciosamente (ex.: saída imediata de foco)
        });
      }
    } catch {
      // Ignora ambientes sem suporte a Pointer Lock
    }
  }

  public isDraggingCamera(): boolean {
    return this.isDraggingCam;
  }

  public setTouchInput(partial: Partial<TouchInputState>): void {
    this.touchState = { ...this.touchState, ...partial };
  }

  public feedTouchLookDelta(dx: number, dy: number): void {
    this.onPointerLookDelta?.(dx, dy);
  }

  public getMoveAxes(): { forward: number; strafe: number } {
    const keyFwd =
      (this.isActionHeld('moveForward') || this.keys.has('ArrowUp') ? 1 : 0) -
      (this.isActionHeld('moveBackward') || this.keys.has('ArrowDown') ? 1 : 0);
    const keyStrafe =
      (this.isActionHeld('moveRight') || this.keys.has('ArrowRight') ? 1 : 0) -
      (this.isActionHeld('moveLeft') || this.keys.has('ArrowLeft') ? 1 : 0);

    const forward = Math.max(-1, Math.min(1, keyFwd + this.gpMoveY + this.touchState.moveY));
    const strafe = Math.max(-1, Math.min(1, keyStrafe + this.gpMoveX + this.touchState.moveX));
    return { forward, strafe };
  }

  public getCameraRotateAxes(): { yawDelta: number; pitchDelta: number } {
    const keyYaw =
      (this.isActionHeld('camLeft') ? 1 : 0) - (this.isActionHeld('camRight') ? 1 : 0);
    return {
      yawDelta: keyYaw - this.gpCamX * 1.4,
      pitchDelta: this.gpCamY * 0.9,
    };
  }

  public isSprinting(): boolean {
    return (
      this.isActionHeld('sprint') ||
      this.keys.has('ShiftRight') ||
      this.gpSprint ||
      this.touchState.sprint
    );
  }

  public isHandbrakeHeld(): boolean {
    return this.isActionHeld('jump') || this.touchState.jump;
  }

  public isAimHeld(): boolean {
    if (this.uiModalOpen) return false;
    return this.isActionHeld('aim') || this.gpAimHeld || this.touchState.aim;
  }

  public isFireHeld(): boolean {
    if (this.uiModalOpen) return false;
    return this.isActionHeld('fire') || this.gpFireHeld || this.touchState.fire;
  }

  public consumeWeaponCycleDelta(): number {
    const d = this.gpWeaponCycleDelta;
    this.gpWeaponCycleDelta = 0;
    return d;
  }

  public consumeAction(action: GameAction): boolean {
    if (this.justPressedActions.has(action)) {
      this.justPressedActions.delete(action);
      return true;
    }
    return false;
  }

  public isActionHeld(action: GameAction): boolean {
    const code = this.bindings[action];
    return this.keys.has(code);
  }

  public update(_dt: number): void {
    this.pollGamepad();
    this.pollTouchEdges();
  }

  public clearTransient(): void {
    this.justPressedActions.clear();
    this.gpWeaponCycleDelta = 0;
  }

  private pollTouchEdges(): void {
    if (this.touchState.interact && !this.touchPrevInteract) {
      this.justPressedActions.add('interact');
    }
    if (this.touchState.jump && !this.touchPrevJump) {
      this.justPressedActions.add('jump');
    }
    if (this.touchState.horn && !this.touchPrevHorn) {
      this.justPressedActions.add('horn');
    }
    if (this.touchState.fire && !this.touchPrevFire) {
      this.justPressedActions.add('fire');
    }
    if (this.touchState.reload && !this.touchPrevReload) {
      this.justPressedActions.add('reload');
    }
    if (this.touchState.aim && !this.touchPrevAim) {
      this.justPressedActions.add('aim');
    }
    if (this.touchState.swapWeapon && !this.touchPrevSwapWeapon) {
      this.gpWeaponCycleDelta += 1;
    }
    if (this.touchState.radioNext && !this.touchPrevRadioNext) {
      this.justPressedActions.add('radioNext');
    }

    this.touchPrevInteract = this.touchState.interact;
    this.touchPrevJump = this.touchState.jump;
    this.touchPrevHorn = this.touchState.horn;
    this.touchPrevFire = this.touchState.fire;
    this.touchPrevReload = this.touchState.reload;
    this.touchPrevAim = this.touchState.aim;
    this.touchPrevSwapWeapon = this.touchState.swapWeapon;
    this.touchPrevRadioNext = Boolean(this.touchState.radioNext);
  }

  private pollGamepad(): void {
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return;
    const pads = navigator.getGamepads();
    let pad: Gamepad | null = null;
    for (let i = 0; i < pads.length; i++) {
      if (pads[i] && pads[i]!.connected) {
        pad = pads[i];
        break;
      }
    }
    this.gamepadConnected = pad !== null;
    if (!pad) {
      this.gpMoveX = 0;
      this.gpMoveY = 0;
      this.gpCamX = 0;
      this.gpCamY = 0;
      this.gpSprint = false;
      this.gpAimHeld = false;
      this.gpFireHeld = false;
      this.gpPrevFireHeld = false;
      return;
    }

    const deadzone = (v: number) => (Math.abs(v) < 0.18 ? 0 : v);
    this.gpMoveX = deadzone(pad.axes[0] ?? 0);
    this.gpMoveY = -deadzone(pad.axes[1] ?? 0);
    this.gpCamX = deadzone(pad.axes[2] ?? 0);
    this.gpCamY = deadzone(pad.axes[3] ?? 0);

    const inVehicle = this.ctx?.state.currentVehicle !== null;
    const rt = pad.buttons[7]?.value ?? 0;
    const lt = pad.buttons[6]?.value ?? 0;

    if (inVehicle) {
      // No veículo: RT acelera, LT freia/dá ré
      if (rt > 0.15) this.gpMoveY = Math.max(this.gpMoveY, rt);
      if (lt > 0.15) this.gpMoveY = Math.min(this.gpMoveY, -lt);
      this.gpAimHeld = false;
      this.gpFireHeld = false;
      this.gpPrevFireHeld = false;
    } else {
      // A pé: LT mira, RT atira
      const prevAim = this.gpAimHeld;
      this.gpAimHeld = lt > 0.25;
      if (this.gpAimHeld && !prevAim) {
        this.justPressedActions.add('aim');
      }
      this.gpFireHeld = rt > 0.25;
      if (this.gpFireHeld && !this.gpPrevFireHeld) {
        this.justPressedActions.add('fire');
      }
      this.gpPrevFireHeld = this.gpFireHeld;
    }

    // LB (4) / L3 (10) = correr
    this.gpSprint = Boolean(pad.buttons[4]?.pressed || pad.buttons[10]?.pressed);

    const buttonEdge = (idx: number, action?: GameAction): boolean => {
      const pressed = Boolean(pad!.buttons[idx]?.pressed);
      const prev = this.gpPrevButtons.get(idx) ?? false;
      const edge = pressed && !prev;
      if (edge && action) {
        this.justPressedActions.add(action);
      }
      this.gpPrevButtons.set(idx, pressed);
      return edge;
    };

    buttonEdge(0, 'jump');     // A / Cruz
    buttonEdge(2, 'interact'); // X / Quadrado (entrar/sair do carro / loja)
    buttonEdge(3, 'horn');     // Y / Triângulo (buzina)
    buttonEdge(9, 'pause');    // Start / Options

    if (!inVehicle) {
      buttonEdge(1, 'reload'); // B / Círculo: recarregar a pé
      // RB (5) e D-pad (14 = esquerda, 15 = direita, 12 = cima, 13 = baixo) trocam de arma
      if (buttonEdge(5) || buttonEdge(15) || buttonEdge(12)) {
        this.gpWeaponCycleDelta += 1;
      }
      if (buttonEdge(14) || buttonEdge(13)) {
        this.gpWeaponCycleDelta -= 1;
      }
    } else {
      buttonEdge(1);
      buttonEdge(5, 'radioNext');
      buttonEdge(12);
      buttonEdge(13);
      buttonEdge(14, 'radioPrev');
      buttonEdge(15, 'radioNext');
    }
  }

  private handleGamepadChange = (): void => {
    this.pollGamepad();
  };

  private handlePointerLockChange = (): void => {
    if (!this.ctx || typeof document === 'undefined') return;
    const dom = this.ctx.renderer.domElement;
    const locked = document.pointerLockElement === dom;
    this.pointerLocked = locked;
    if (locked) {
      this.hadPointerLock = true;
      this.isDraggingCam = false;
      return;
    }

    // Perdeu o lock enquanto jogava sem estar pausado nem em modal -> pausa automaticamente
    if (this.hadPointerLock) {
      this.hadPointerLock = false;
      this.keys.clear();
      if (!this.ctx.state.paused && !this.uiModalOpen) {
        this.onPointerLockLost?.();
      }
    }
  };

  private handleContextMenu = (e: MouseEvent): void => {
    e.preventDefault();
  };

  private handleBlur = (): void => {
    this.keys.clear();
    this.justPressedActions.clear();
    this.isDraggingCam = false;
  };

  private handleKeyDown = (e: KeyboardEvent): void => {
    if (this.capturingKey) return;
    this.ctx?.audio.unlock();
    const code = e.code;

    if (
      code === 'Space' ||
      code === 'Tab' ||
      code === 'ArrowUp' ||
      code === 'ArrowDown' ||
      code === 'ArrowLeft' ||
      code === 'ArrowRight' ||
      code === this.bindings.toggleDebug
    ) {
      e.preventDefault();
    }

    this.keys.add(code);
    if (!e.repeat) {
      for (const action of ACTION_ACTIONS) {
        if (this.bindings[action] === code) {
          this.justPressedActions.add(action);
        }
      }
    }
  };

  private handleKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };

  private handlePointerDown = (e: PointerEvent): void => {
    if (!this.ctx) return;
    this.ctx.audio.unlock();

    if (this.uiModalOpen || this.ctx.state.paused) return;

    const isTouchPointer = e.pointerType === 'touch';
    const allowDragFallback = isTouchPointer || (this.canUseDragFallback ? this.canUseDragFallback() : true);

    if (!isTouchPointer && !this.pointerLocked) {
      this.requestPointerLock();
    }

    // Com arma equipada (não-desarmado) no mouse, clique não inicia arrasto de câmera
    if (!this.pointerLocked && allowDragFallback) {
      this.isDraggingCam = true;
      this.lastPointerX = e.clientX;
      this.lastPointerY = e.clientY;
    } else {
      this.isDraggingCam = false;
    }

    const mouseCode = e.button === 2 ? 'MouseRight' : e.button === 0 ? 'MouseLeft' : '';
    if (mouseCode) {
      this.keys.add(mouseCode);
      for (const action of ACTION_ACTIONS) {
        if (this.bindings[action] === mouseCode) {
          this.justPressedActions.add(action);
        }
      }
    }
  };

  private handlePointerMove = (e: PointerEvent): void => {
    if (this.uiModalOpen || this.ctx?.state.paused) return;

    if (this.pointerLocked) {
      if (e.movementX !== 0 || e.movementY !== 0) {
        this.onPointerLookDelta?.(e.movementX, e.movementY);
      }
      return;
    }

    if (!this.isDraggingCam) return;
    const dx = e.clientX - this.lastPointerX;
    const dy = e.clientY - this.lastPointerY;
    this.lastPointerX = e.clientX;
    this.lastPointerY = e.clientY;
    this.onPointerLookDelta?.(dx, dy);
  };

  private handlePointerUp = (e: PointerEvent): void => {
    this.isDraggingCam = false;
    if (e.button === 2) this.keys.delete('MouseRight');
    else if (e.button === 0) this.keys.delete('MouseLeft');
    else {
      this.keys.delete('MouseLeft');
      this.keys.delete('MouseRight');
    }
  };

  public dispose(): void {
    this.releasePointerLock();
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', this.handleKeyDown);
      window.removeEventListener('keyup', this.handleKeyUp);
      window.removeEventListener('blur', this.handleBlur);
      window.removeEventListener('gamepadconnected', this.handleGamepadChange);
      window.removeEventListener('gamepaddisconnected', this.handleGamepadChange);
      window.removeEventListener('pointermove', this.handlePointerMove);
      window.removeEventListener('pointerup', this.handlePointerUp);
    }
    if (typeof document !== 'undefined') {
      document.removeEventListener('pointerlockchange', this.handlePointerLockChange);
    }
    if (this.ctx) {
      const dom = this.ctx.renderer.domElement;
      dom.removeEventListener('pointerdown', this.handlePointerDown);
      dom.removeEventListener('contextmenu', this.handleContextMenu);
    }
    this.keys.clear();
    this.justPressedActions.clear();
    this.onPointerLookDelta = null;
    this.onPointerLockLost = null;
    this.canUseDragFallback = null;
    this.ctx = null;
  }
}
