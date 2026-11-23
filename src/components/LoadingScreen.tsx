import React from 'react';
import { LoadingProgress } from '../game/types';

interface LoadingScreenProps {
  loading: LoadingProgress;
}

export const LoadingScreen: React.FC<LoadingScreenProps> = ({ loading }) => {
  const pct = Math.max(0, Math.min(100, Math.round(loading.progress)));

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-[#0d081d]/96 backdrop-blur-sm p-6">
      <div className="w-full max-w-md rounded-xl border border-white/15 bg-[#120d24] p-7 shadow-2xl">
        <div className="text-xs font-medium text-cyan-300">
          Baía Solara 3D
        </div>
        <h1 className="mt-1 font-display text-2xl font-bold tracking-wide text-white">
          Carregando Cidade
        </h1>
        <p className="mt-2 text-sm text-slate-300">{loading.stage}</p>

        <div className="mt-5 h-2.5 w-full overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full bg-gradient-to-r from-[#ff2e93] via-amber-400 to-cyan-400 transition-all duration-200"
            style={{ width: `${pct}%` }}
          />
        </div>

        <div className="mt-2.5 flex items-center justify-between text-xs text-slate-400">
          <span>Preparando mundo aberto e multidão</span>
          <span className="font-mono-hud tabular-nums font-semibold text-cyan-300">
            {pct}%
          </span>
        </div>
      </div>
    </div>
  );
};
