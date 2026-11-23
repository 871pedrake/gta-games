import React from 'react';
import { Play, RotateCcw, Settings } from 'lucide-react';
import { SaveGameData } from '../game/types';

interface MainMenuProps {
  savedGame: SaveGameData | null;
  onNewGame: () => void;
  onContinue: () => void;
  onOpenOptions: () => void;
}

export const MainMenu: React.FC<MainMenuProps> = ({
  savedGame,
  onNewGame,
  onContinue,
  onOpenOptions,
}) => {
  const formatClock = (gt: number) => {
    const totalMin = Math.floor(gt * 60) % 1440;
    const hh = Math.floor(totalMin / 60).toString().padStart(2, '0');
    const mm = (totalMin % 60).toString().padStart(2, '0');
    return `${hh}:${mm}`;
  };

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-[#090614]/65 backdrop-blur-xs p-6">
      <div className="w-full max-w-md rounded-xl border border-white/15 bg-[#0e0a1c]/95 p-7 shadow-2xl">
        <h1 className="font-display text-3xl font-bold tracking-wide text-white text-balance">
          Baía Solara 3D
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-300">
          Cidade litorânea em mundo aberto com ciclo dia e noite, tráfego inteligente e missões na orla.
        </p>

        {savedGame && (
          <div className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-300">
            <span className="font-mono-hud tabular-nums text-emerald-400 font-semibold">
              ${savedGame.money.toLocaleString('pt-BR')}
            </span>
            <span aria-hidden="true">·</span>
            <span className="font-mono-hud tabular-nums">Dia {savedGame.dayNumber}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono-hud tabular-nums">{formatClock(savedGame.gameTime)}</span>
            <span aria-hidden="true">·</span>
            <span>{savedGame.completedMissions.length}/2 missões</span>
          </div>
        )}

        <div className="mt-6 flex flex-col gap-2.5">
          {savedGame && (
            <button
              type="button"
              onClick={onContinue}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-cyan-600 px-4 py-3 text-sm font-semibold text-white hover:bg-cyan-500 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Play size={16} />
              <span>Continuar Jogo</span>
            </button>
          )}

          <button
            type="button"
            onClick={onNewGame}
            className={`flex w-full items-center justify-center gap-2 rounded-lg px-4 py-3 text-sm font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              savedGame
                ? 'border border-white/15 bg-[#1b1533] text-slate-100 hover:bg-[#29204a]'
                : 'bg-[#ff2e93] text-white hover:bg-pink-500'
            }`}
          >
            <RotateCcw size={16} />
            <span>Novo Jogo</span>
          </button>

          <button
            type="button"
            onClick={onOpenOptions}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-white/15 bg-[#1b1533] px-4 py-3 text-sm font-semibold text-slate-200 hover:bg-[#29204a] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Settings size={16} />
            <span>Opções e Controles</span>
          </button>
        </div>

        <div className="mt-5 border-t border-white/10 pt-3 text-xs text-slate-400">
          WASD mover · Mouse girar câmera · F entrar no carro · Esc pausar
        </div>
      </div>
    </div>
  );
};
