import React from 'react';
import { Home, Play, Save, Settings } from 'lucide-react';

interface PauseMenuProps {
  lastSavedAtIso: string | null;
  onResume: () => void;
  onSaveNow: () => void;
  onOpenOptions: () => void;
  onReturnToMenu: () => void;
}

export const PauseMenu: React.FC<PauseMenuProps> = ({
  lastSavedAtIso,
  onResume,
  onSaveNow,
  onOpenOptions,
  onReturnToMenu,
}) => {
  const formattedSave = lastSavedAtIso
    ? new Date(lastSavedAtIso).toLocaleTimeString('pt-BR', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
    : 'Ainda não salvo';

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-[#090614]/70 backdrop-blur-sm p-6">
      <div className="w-full max-w-sm rounded-xl border border-white/15 bg-[#0e0a1c]/95 p-6 shadow-2xl">
        <h2 className="font-display text-2xl font-bold tracking-wide text-white">
          Jogo Pausado
        </h2>
        <div className="mt-1.5 flex items-center gap-2 text-xs text-slate-400">
          <span>Último salvamento</span>
          <span aria-hidden="true">·</span>
          <span className="font-mono-hud tabular-nums text-cyan-300">{formattedSave}</span>
        </div>

        <div className="mt-5 flex flex-col gap-2.5">
          <button
            type="button"
            onClick={onResume}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-cyan-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-cyan-500 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Play size={15} />
            <span>Retomar</span>
          </button>

          <button
            type="button"
            onClick={onSaveNow}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-white/15 bg-[#1b1533] px-4 py-2.5 text-sm font-semibold text-slate-100 hover:bg-[#29204a] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Save size={15} />
            <span>Salvar Agora</span>
          </button>

          <button
            type="button"
            onClick={onOpenOptions}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-white/15 bg-[#1b1533] px-4 py-2.5 text-sm font-semibold text-slate-100 hover:bg-[#29204a] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Settings size={15} />
            <span>Opções</span>
          </button>

          <button
            type="button"
            onClick={onReturnToMenu}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-rose-500/35 bg-rose-950/50 px-4 py-2.5 text-sm font-semibold text-rose-200 hover:bg-rose-900/60 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Home size={15} />
            <span>Voltar ao Menu Principal</span>
          </button>
        </div>
      </div>
    </div>
  );
};
