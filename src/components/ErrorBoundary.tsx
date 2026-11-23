import React from 'react';
import { AlertTriangle, RotateCcw, Trash2 } from 'lucide-react';
import { SaveSystem } from '../game/core/SaveSystem';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  public static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      message: error?.message || 'Erro inesperado ao inicializar a cena 3D.',
    };
  }

  private handleReload = (): void => {
    window.location.reload();
  };

  private handleResetAndReload = (): void => {
    SaveSystem.clearSave();
    window.location.reload();
  };

  public render(): React.ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0d081d] p-6 text-slate-100">
        <div className="w-full max-w-md rounded-xl border border-white/15 bg-[#120d24] p-6 shadow-2xl">
          <div className="flex items-center gap-3 text-rose-400">
            <AlertTriangle size={22} />
            <h1 className="font-display text-xl font-bold tracking-wide text-white">
              Falha na Simulação 3D
            </h1>
          </div>
          <p className="mt-3 text-sm leading-relaxed text-slate-300">
            Ocorreu um erro durante a renderização ou execução do jogo. Você pode tentar recarregar ou limpar o progresso salvo caso o arquivo esteja corrompido.
          </p>
          <div className="mt-4 rounded-lg border border-white/10 bg-black/30 p-3 font-mono-hud text-xs text-rose-300 break-words">
            {this.state.message}
          </div>
          <div className="mt-5 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={this.handleReload}
              className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-cyan-600 px-4 py-2.5 text-xs font-semibold text-white hover:bg-cyan-500 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <RotateCcw size={14} />
              <span>Recarregar</span>
            </button>
            <button
              type="button"
              onClick={this.handleResetAndReload}
              className="flex items-center justify-center gap-2 rounded-lg border border-white/15 bg-[#1b1533] px-4 py-2.5 text-xs font-semibold text-slate-200 hover:bg-[#29204a] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Trash2 size={14} />
              <span>Limpar Save</span>
            </button>
          </div>
        </div>
      </div>
    );
  }
}
