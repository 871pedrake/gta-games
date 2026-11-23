import React, { useRef, useState } from 'react';
import { CarFront, Crosshair, Radio, RefreshCw, Repeat, Target, Volume2 } from 'lucide-react';
import { TouchInputState } from '../game/systems/InputManager';

interface TouchControlsProps {
  inVehicle: boolean;
  hasFirearm: boolean;
  aiming: boolean;
  onChangeTouch: (partial: Partial<TouchInputState>) => void;
  onLookDelta: (dx: number, dy: number) => void;
}

export const TouchControls: React.FC<TouchControlsProps> = ({
  inVehicle,
  hasFirearm,
  aiming,
  onChangeTouch,
  onLookDelta,
}) => {
  const padRef = useRef<HTMLDivElement | null>(null);
  const [knobOffset, setKnobOffset] = useState({ x: 0, y: 0 });
  const activePointerId = useRef<number | null>(null);
  const lookPointerId = useRef<number | null>(null);
  const lastLookPos = useRef({ x: 0, y: 0 });

  const updateStick = (clientX: number, clientY: number) => {
    const pad = padRef.current;
    if (!pad) return;
    const rect = pad.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const maxR = rect.width * 0.38;

    let dx = clientX - cx;
    let dy = clientY - cy;
    const dist = Math.hypot(dx, dy);
    if (dist > maxR && dist > 0) {
      dx = (dx / dist) * maxR;
      dy = (dy / dist) * maxR;
    }
    setKnobOffset({ x: dx, y: dy });
    onChangeTouch({
      moveX: dx / maxR,
      moveY: -dy / maxR,
    });
  };

  const resetStick = () => {
    activePointerId.current = null;
    setKnobOffset({ x: 0, y: 0 });
    onChangeTouch({ moveX: 0, moveY: 0 });
  };

  return (
    <>
      {/* Área direita transparente para girar câmera com o dedo */}
      <div
        onPointerDown={(e) => {
          lookPointerId.current = e.pointerId;
          lastLookPos.current = { x: e.clientX, y: e.clientY };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (lookPointerId.current !== e.pointerId) return;
          const dx = e.clientX - lastLookPos.current.x;
          const dy = e.clientY - lastLookPos.current.y;
          lastLookPos.current = { x: e.clientX, y: e.clientY };
          onLookDelta(dx * 1.35, dy * 1.35);
        }}
        onPointerUp={(e) => {
          if (lookPointerId.current === e.pointerId) lookPointerId.current = null;
        }}
        onPointerCancel={() => {
          lookPointerId.current = null;
        }}
        className="fixed right-0 top-24 bottom-44 left-1/2 z-15 touch-none"
        aria-label="Área de olhar"
      />

      <div className="pointer-events-none fixed inset-x-0 bottom-16 z-20 flex items-end justify-between px-5 sm:px-8">
        {/* Joystick Virtual Esquerdo */}
        <div
          ref={padRef}
          onPointerDown={(e) => {
            e.stopPropagation();
            activePointerId.current = e.pointerId;
            e.currentTarget.setPointerCapture(e.pointerId);
            updateStick(e.clientX, e.clientY);
          }}
          onPointerMove={(e) => {
            if (activePointerId.current !== e.pointerId) return;
            updateStick(e.clientX, e.clientY);
          }}
          onPointerUp={(e) => {
            if (activePointerId.current !== e.pointerId) return;
            resetStick();
          }}
          onPointerCancel={resetStick}
          className="pointer-events-auto relative h-28 w-28 touch-none rounded-full border border-white/25 bg-[#0e0a1c]/65 backdrop-blur-xs"
          aria-label="Direcional analógico"
        >
          <div
            className="absolute left-1/2 top-1/2 h-11 w-11 -translate-x-1/2 -translate-y-1/2 rounded-full border border-cyan-300/70 bg-cyan-500/45 shadow-md"
            style={{
              transform: `translate(${knobOffset.x}px, ${knobOffset.y}px)`,
            }}
          />
        </div>

        {/* Botões de Ação Direitos (alvo mínimo >= 44px) */}
        <div className="pointer-events-auto grid grid-cols-2 gap-2 touch-none">
          {!inVehicle && (
            <>
              <button
                type="button"
                onPointerDown={(e) => {
                  e.stopPropagation();
                  onChangeTouch({ aim: true });
                }}
                onPointerUp={() => onChangeTouch({ aim: false })}
                onPointerCancel={() => onChangeTouch({ aim: false })}
                className={`flex h-12 min-w-[60px] items-center justify-center gap-1 rounded-xl border px-3 text-xs font-semibold ${
                  aiming
                    ? 'border-cyan-300 bg-cyan-600 text-white'
                    : 'border-cyan-400/50 bg-[#0e0a1c]/85 text-cyan-200 active:bg-cyan-600 active:text-white'
                }`}
              >
                <Target size={15} />
                <span>Mirar</span>
              </button>

              <button
                type="button"
                onPointerDown={(e) => {
                  e.stopPropagation();
                  onChangeTouch({ fire: true });
                }}
                onPointerUp={() => onChangeTouch({ fire: false })}
                onPointerCancel={() => onChangeTouch({ fire: false })}
                className="flex h-12 min-w-[60px] items-center justify-center gap-1 rounded-xl border border-rose-400/60 bg-rose-950/85 px-3 text-xs font-semibold text-rose-100 active:bg-rose-600 active:text-white"
              >
                <Crosshair size={15} />
                <span>{hasFirearm ? 'Atirar' : 'Soco'}</span>
              </button>

              <button
                type="button"
                onPointerDown={(e) => {
                  e.stopPropagation();
                  onChangeTouch({ reload: true });
                }}
                onPointerUp={() => onChangeTouch({ reload: false })}
                onPointerCancel={() => onChangeTouch({ reload: false })}
                className="flex h-11 min-w-[60px] items-center justify-center gap-1 rounded-xl border border-amber-400/50 bg-[#0e0a1c]/85 px-2.5 text-[11px] font-semibold text-amber-200 active:bg-amber-600 active:text-white"
              >
                <RefreshCw size={14} />
                <span>Recarr.</span>
              </button>

              <button
                type="button"
                onPointerDown={(e) => {
                  e.stopPropagation();
                  onChangeTouch({ swapWeapon: true });
                }}
                onPointerUp={() => onChangeTouch({ swapWeapon: false })}
                onPointerCancel={() => onChangeTouch({ swapWeapon: false })}
                className="flex h-11 min-w-[60px] items-center justify-center gap-1 rounded-xl border border-white/25 bg-[#0e0a1c]/85 px-2.5 text-[11px] font-semibold text-slate-200 active:bg-cyan-600 active:text-white"
              >
                <Repeat size={14} />
                <span>Arma</span>
              </button>
            </>
          )}

          <button
            type="button"
            onPointerDown={(e) => {
              e.stopPropagation();
              onChangeTouch({ interact: true });
            }}
            onPointerUp={() => onChangeTouch({ interact: false })}
            onPointerCancel={() => onChangeTouch({ interact: false })}
            className="flex h-12 min-w-[60px] items-center justify-center gap-1 rounded-xl border border-cyan-400/50 bg-[#0e0a1c]/85 px-3 text-xs font-semibold text-cyan-200 active:bg-cyan-600 active:text-white"
          >
            <CarFront size={16} />
            <span>{inVehicle ? 'Sair' : 'Usar'}</span>
          </button>

          <button
            type="button"
            onPointerDown={(e) => {
              e.stopPropagation();
              onChangeTouch({ jump: true });
            }}
            onPointerUp={() => onChangeTouch({ jump: false })}
            onPointerCancel={() => onChangeTouch({ jump: false })}
            className="flex h-12 min-w-[60px] items-center justify-center rounded-xl border border-pink-400/50 bg-[#0e0a1c]/85 px-3 text-xs font-semibold text-pink-200 active:bg-pink-600 active:text-white"
          >
            {inVehicle ? 'Freio' : 'Pular'}
          </button>

          {!inVehicle ? (
            <button
              type="button"
              onPointerDown={(e) => {
                e.stopPropagation();
                onChangeTouch({ sprint: true });
              }}
              onPointerUp={() => onChangeTouch({ sprint: false })}
              onPointerCancel={() => onChangeTouch({ sprint: false })}
              className="col-span-2 flex h-11 items-center justify-center rounded-xl border border-white/25 bg-[#0e0a1c]/85 px-3 text-xs font-semibold text-slate-100 active:bg-amber-600"
            >
              Correr
            </button>
          ) : (
            <>
              <button
                type="button"
                onPointerDown={(e) => {
                  e.stopPropagation();
                  onChangeTouch({ horn: true });
                }}
                onPointerUp={() => onChangeTouch({ horn: false })}
                onPointerCancel={() => onChangeTouch({ horn: false })}
                className="flex h-11 min-w-[60px] items-center justify-center gap-1.5 rounded-xl border border-amber-400/50 bg-[#0e0a1c]/85 px-3 text-xs font-semibold text-amber-200 active:bg-amber-600 active:text-white"
              >
                <Volume2 size={15} />
                <span>Buzinar</span>
              </button>

              <button
                type="button"
                onPointerDown={(e) => {
                  e.stopPropagation();
                  onChangeTouch({ radioNext: true });
                }}
                onPointerUp={() => onChangeTouch({ radioNext: false })}
                onPointerCancel={() => onChangeTouch({ radioNext: false })}
                className="flex h-11 min-w-[60px] items-center justify-center gap-1.5 rounded-xl border border-cyan-400/50 bg-[#0e0a1c]/85 px-3 text-xs font-semibold text-cyan-200 active:bg-cyan-600 active:text-white"
              >
                <Radio size={15} />
                <span>Rádio</span>
              </button>
            </>
          )}
        </div>
      </div>
    </>
  );
};
