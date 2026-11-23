import React, { useEffect, useRef, useState } from 'react';
import { RotateCcw, X } from 'lucide-react';
import { QUALITY_SETTINGS, QualityPreset } from '../game/config';
import { DEFAULT_KEY_BINDINGS } from '../game/core/SaveSystem';
import { AimMode, GameAction, GameOptions, TouchMode } from '../game/types';

interface OptionsModalProps {
  options: GameOptions;
  onChange: (next: GameOptions) => void;
  onClose: () => void;
  onKeyCaptureChange: (capturing: boolean) => void;
}

const ACTION_LABELS: Array<{ action: GameAction; label: string }> = [
  { action: 'moveForward', label: 'Avançar / Acelerar' },
  { action: 'moveBackward', label: 'Recuar / Frear' },
  { action: 'moveLeft', label: 'Esquerda' },
  { action: 'moveRight', label: 'Direita' },
  { action: 'sprint', label: 'Correr' },
  { action: 'jump', label: 'Pular / Freio de Mão' },
  { action: 'interact', label: 'Entrar / Sair do Carro' },
  { action: 'toggleDoors', label: 'Abrir / Fechar Portas (Veículo)' },
  { action: 'horn', label: 'Buzinar' },
  { action: 'radioNext', label: 'Próxima Rádio (Veículo)' },
  { action: 'radioPrev', label: 'Rádio Anterior (Veículo)' },
  { action: 'aim', label: 'Mirar' },
  { action: 'fire', label: 'Atirar' },
  { action: 'reload', label: 'Recarregar' },
  { action: 'melee', label: 'Corpo a Corpo' },
  { action: 'weaponWheel', label: 'Roda de Armas' },
  { action: 'map', label: 'Mapa da Cidade' },
  { action: 'cycleWeather', label: 'Alternar Clima' },
  { action: 'cycleTimeScale', label: 'Velocidade do Relógio' },
  { action: 'pause', label: 'Pausar' },
];

const QUALITY_ORDER: QualityPreset[] = ['low', 'medium', 'high'];
const TOUCH_MODES: Array<{ id: TouchMode; label: string }> = [
  { id: 'auto', label: 'Automático' },
  { id: 'on', label: 'Sempre Ativo' },
  { id: 'off', label: 'Desativado' },
];

function formatKeyCode(code: string): string {
  return code
    .replace(/^Key/, '')
    .replace(/^Digit/, '')
    .replace('ShiftLeft', 'Shift')
    .replace('Space', 'Espaço')
    .replace('Escape', 'Esc')
    .replace('MouseLeft', 'Botão Esq.')
    .replace('MouseRight', 'Botão Dir.');
}

export const OptionsModal: React.FC<OptionsModalProps> = ({
  options,
  onChange,
  onClose,
  onKeyCaptureChange,
}) => {
  const [listeningAction, setListeningAction] = useState<GameAction | null>(null);
  const suppressNextClickRef = useRef(false);

  useEffect(() => {
    onKeyCaptureChange(listeningAction !== null);
    if (!listeningAction) return;

    const onKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const nextBindings = {
        ...options.keyBindings,
        [listeningAction]: e.code,
      };
      onChange({ ...options, keyBindings: nextBindings });
      setListeningAction(null);
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [listeningAction, options, onChange, onKeyCaptureChange]);

  useEffect(() => {
    return () => onKeyCaptureChange(false);
  }, [onKeyCaptureChange]);

  const handleResetBindings = () => {
    onChange({
      ...options,
      keyBindings: { ...DEFAULT_KEY_BINDINGS },
    });
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-[#090614]/80 backdrop-blur-sm p-4">
      <div className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-xl border border-white/15 bg-[#0e0a1c]/98 shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
          <h2 className="font-display text-xl font-bold tracking-wide text-white">
            Opções e Controles
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar opções"
            className="rounded-lg border border-white/15 bg-[#1b1533] p-2 text-slate-300 hover:text-white cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5 text-sm">
          {/* Qualidade gráfica */}
          <div>
            <div className="text-xs font-semibold text-slate-300">Qualidade Gráfica e Multidão</div>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {QUALITY_ORDER.map((preset) => {
                const active = options.qualityPreset === preset;
                return (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => onChange({ ...options, qualityPreset: preset })}
                    className={`rounded-lg border px-3 py-2 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      active
                        ? 'border-cyan-400 bg-cyan-600 text-white'
                        : 'border-white/15 bg-[#1b1533] text-slate-300 hover:bg-[#29204a]'
                    }`}
                  >
                    {QUALITY_SETTINGS[preset].label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Áudio */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <div className="flex items-center justify-between text-xs font-semibold text-slate-300">
                <span>Volume Geral</span>
                <span className="font-mono-hud tabular-nums text-cyan-300">
                  {Math.round(options.volume * 100)}%
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round(options.volume * 100)}
                onChange={(e) =>
                  onChange({ ...options, volume: Number(e.target.value) / 100 })
                }
                className="mt-2 w-full accent-cyan-400 cursor-pointer"
              />
            </div>

            <div className="flex items-center justify-between rounded-lg border border-white/10 bg-[#151029] px-3.5 py-2.5">
              <span className="text-xs font-semibold text-slate-200">Silenciar Áudio</span>
              <button
                type="button"
                onClick={() => onChange({ ...options, muted: !options.muted })}
                className={`rounded-md px-3 py-1 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  options.muted
                    ? 'bg-rose-600 text-white'
                    : 'bg-emerald-600/80 text-white'
                }`}
              >
                {options.muted ? 'Mudo' : 'Ativo'}
              </button>
            </div>
          </div>

          {/* Câmera e Touch */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <div className="flex items-center justify-between text-xs font-semibold text-slate-300">
                <span>Sensibilidade da Câmera</span>
                <span className="font-mono-hud tabular-nums text-cyan-300">
                  {options.cameraSensitivity.toFixed(1)}x
                </span>
              </div>
              <input
                type="range"
                min={4}
                max={22}
                value={Math.round(options.cameraSensitivity * 10)}
                onChange={(e) =>
                  onChange({
                    ...options,
                    cameraSensitivity: Number(e.target.value) / 10,
                  })
                }
                className="mt-2 w-full accent-cyan-400 cursor-pointer"
              />
            </div>

            <div className="flex items-center justify-between rounded-lg border border-white/10 bg-[#151029] px-3.5 py-2.5">
              <span className="text-xs font-semibold text-slate-200">Inverter Eixo Y</span>
              <button
                type="button"
                onClick={() => onChange({ ...options, invertY: !options.invertY })}
                className={`rounded-md px-3 py-1 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  options.invertY
                    ? 'bg-cyan-600 text-white'
                    : 'bg-[#221a3d] text-slate-300'
                }`}
              >
                {options.invertY ? 'Sim' : 'Não'}
              </button>
            </div>
          </div>

          {/* Modo de mira e sensibilidade ao mirar */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <div className="flex items-center justify-between text-xs font-semibold text-slate-300">
                <span>Sensibilidade ao Mirar</span>
                <span className="font-mono-hud tabular-nums text-cyan-300">
                  {options.aimSensitivityMul.toFixed(1)}x
                </span>
              </div>
              <input
                type="range"
                min={2}
                max={12}
                value={Math.round(options.aimSensitivityMul * 10)}
                onChange={(e) =>
                  onChange({
                    ...options,
                    aimSensitivityMul: Number(e.target.value) / 10,
                  })
                }
                className="mt-2 w-full accent-cyan-400 cursor-pointer"
              />
            </div>

            <div>
              <div className="text-xs font-semibold text-slate-300">Modo de Mira</div>
              <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                {([
                  { id: 'hold', label: 'Segurar' },
                  { id: 'toggle', label: 'Alternar' },
                ] as Array<{ id: AimMode; label: string }>).map((mode) => {
                  const active = options.aimMode === mode.id;
                  return (
                    <button
                      key={mode.id}
                      type="button"
                      onClick={() => onChange({ ...options, aimMode: mode.id })}
                      className={`rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
                        active
                          ? 'border-cyan-400 bg-cyan-600 text-white'
                          : 'border-white/15 bg-[#1b1533] text-slate-300 hover:bg-[#29204a]'
                      }`}
                    >
                      {mode.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div>
            <div className="text-xs font-semibold text-slate-300">Controles Touch na Tela</div>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {TOUCH_MODES.map((tm) => {
                const active = options.touchMode === tm.id;
                return (
                  <button
                    key={tm.id}
                    type="button"
                    onClick={() => onChange({ ...options, touchMode: tm.id })}
                    className={`rounded-lg border px-2.5 py-2 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      active
                        ? 'border-cyan-400 bg-cyan-600 text-white'
                        : 'border-white/15 bg-[#1b1533] text-slate-300 hover:bg-[#29204a]'
                    }`}
                  >
                    {tm.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Remapeamento de Teclas */}
          <div className="border-t border-white/10 pt-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-300">
                Teclas (clique para remapear)
              </span>
              <button
                type="button"
                onClick={handleResetBindings}
                className="flex items-center gap-1.5 rounded-md border border-white/15 bg-[#1b1533] px-2.5 py-1 text-xs font-medium text-slate-300 hover:text-white cursor-pointer"
              >
                <RotateCcw size={12} />
                <span>Restaurar Padrão</span>
              </button>
            </div>

            <div className="mt-2.5 space-y-1.5">
              {ACTION_LABELS.map(({ action, label }) => {
                const isListening = listeningAction === action;
                const handleMouseBind = (e: React.MouseEvent<HTMLButtonElement>) => {
                  if (!isListening) return;
                  e.preventDefault();
                  e.stopPropagation();
                  suppressNextClickRef.current = true;
                  const mouseCode = e.button === 2 ? 'MouseRight' : e.button === 0 ? 'MouseLeft' : null;
                  if (!mouseCode) {
                    setListeningAction(null);
                    return;
                  }
                  onChange({
                    ...options,
                    keyBindings: {
                      ...options.keyBindings,
                      [action]: mouseCode,
                    },
                  });
                  setListeningAction(null);
                };
                return (
                  <div
                    key={action}
                    className="flex items-center justify-between rounded-lg border border-white/10 bg-[#151029] px-3 py-2"
                  >
                    <span className="text-xs text-slate-200">{label}</span>
                    <button
                      type="button"
                      onClick={() => {
                        if (suppressNextClickRef.current) {
                          suppressNextClickRef.current = false;
                          return;
                        }
                        if (!isListening) setListeningAction(action);
                      }}
                      onMouseDown={handleMouseBind}
                      onContextMenu={(e) => {
                        if (isListening) e.preventDefault();
                      }}
                      className={`min-w-[96px] rounded-md border px-2.5 py-1 font-mono-hud text-xs font-semibold transition-colors cursor-pointer ${
                        isListening
                          ? 'border-amber-400 bg-amber-600 text-white'
                          : 'border-white/15 bg-[#221a3d] text-cyan-300 hover:bg-[#2d2250]'
                      }`}
                    >
                      {isListening
                        ? 'Tecla/Clique...'
                        : formatKeyCode(options.keyBindings[action])}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="border-t border-white/10 px-6 py-3.5 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-cyan-600 px-5 py-2 text-xs font-semibold text-white hover:bg-cyan-500 transition-colors cursor-pointer"
          >
            Concluir
          </button>
        </div>
      </div>
    </div>
  );
};
