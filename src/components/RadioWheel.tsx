import React, { useState } from 'react';
import { X } from 'lucide-react';
import { getRadioStation, RADIO_STATIONS } from '../game/RadioStations';
import { HudRadioState, RadioStationId } from '../game/types';
import { RadioStationLogo } from './RadioStationLogo';
import { RadioVisualizer } from './RadioVisualizer';

interface RadioWheelProps {
  radio: HudRadioState;
  muted: boolean;
  radioPrevKeyLabel: string;
  radioNextKeyLabel: string;
  onSelectStation: (stationId: RadioStationId) => void;
  onClose: () => void;
  sampleSpectrum?: (out: number[]) => boolean;
}

export const RadioWheel: React.FC<RadioWheelProps> = ({
  radio,
  muted,
  radioPrevKeyLabel,
  radioNextKeyLabel,
  onSelectStation,
  onClose,
  sampleSpectrum,
}) => {
  const [hoveredId, setHoveredId] = useState<RadioStationId | null>(null);
  const previewStation = getRadioStation(hoveredId ?? radio.stationId);
  const isCurrentPreview = previewStation.id === radio.stationId;

  return (
    <div
      onClick={onClose}
      className="pointer-events-auto fixed inset-0 z-30 flex items-center justify-center bg-black/55 backdrop-blur-xs p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Roda de Estações de Rádio"
        className="relative flex flex-col items-center"
      >
        <div className="mb-3 flex items-center gap-3 rounded-full border border-white/15 bg-[#0e0a1c]/95 px-4 py-1.5 shadow-lg">
          <span className="font-display text-xs font-bold tracking-wide text-white">
            Sintonia de Rádio ({radioPrevKeyLabel}/{radioNextKeyLabel})
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar roda de rádio"
            className="rounded-full p-0.5 text-slate-300 hover:bg-white/10 hover:text-white cursor-pointer"
          >
            <X size={14} />
          </button>
        </div>

        {/* Roda Radial estilo GTA */}
        <div
          className="relative h-[336px] w-[336px] sm:h-[420px] sm:w-[420px] rounded-full border border-white/15 bg-[#0c081a]/92 shadow-[0_0_55px_rgba(0,0,0,0.75)]"
          style={{
            boxShadow: `0 0 42px ${previewStation.colorHex}26, inset 0 0 36px rgba(255,255,255,0.03)`,
          }}
        >
          {/* Anel decorativo interno */}
          <div className="pointer-events-none absolute inset-12 sm:inset-16 rounded-full border border-white/10" />

          {/* Centro da Roda: Logo grande + Estação + Faixa Atual */}
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div
              className="flex h-[142px] w-[142px] sm:h-[172px] sm:w-[172px] flex-col items-center justify-center rounded-full border bg-[#120c26]/98 px-3 text-center shadow-2xl transition-colors"
              style={{ borderColor: `${previewStation.colorHex}80` }}
            >
              <RadioStationLogo
                stationId={previewStation.id}
                size={44}
                className="shrink-0 drop-shadow-md"
              />
              <div
                className="mt-1.5 font-display text-xs sm:text-sm font-bold leading-tight"
                style={{ color: previewStation.colorHex }}
              >
                {previewStation.name}
              </div>
              <div className="font-mono-hud text-[10px] text-slate-400">
                {previewStation.frequency}
              </div>
              <div className="mt-1 line-clamp-2 max-w-[132px] text-[10px] leading-snug text-slate-200">
                {previewStation.id === 'off'
                  ? 'Silenciar rádio'
                  : isCurrentPreview
                  ? `${radio.trackTitle} — ${radio.trackArtist}`
                  : previewStation.genre}
              </div>
              <RadioVisualizer
                active={!radio.isOff && !muted && previewStation.id !== 'off'}
                colorHex={previewStation.colorHex}
                barCount={10}
                heightPx={14}
                sampleSpectrum={sampleSpectrum}
                className="mt-1.5 w-16"
              />
            </div>
          </div>

          {/* 6 Estações dispostas radialmente */}
          {RADIO_STATIONS.map((station, index) => {
            const angleDeg = -90 + index * 60;
            const angleRad = (angleDeg * Math.PI) / 180;
            const radiusPct = 36.5;
            const leftPct = 50 + Math.cos(angleRad) * radiusPct;
            const topPct = 50 + Math.sin(angleRad) * radiusPct;
            const active = radio.stationId === station.id;
            const hovered = hoveredId === station.id;

            return (
              <button
                key={station.id}
                type="button"
                onMouseEnter={() => setHoveredId(station.id)}
                onMouseLeave={() => setHoveredId(null)}
                onFocus={() => setHoveredId(station.id)}
                onClick={() => onSelectStation(station.id)}
                aria-label={`${station.name} (${station.frequency})`}
                className={`absolute -translate-x-1/2 -translate-y-1/2 flex w-[84px] sm:w-[100px] flex-col items-center rounded-2xl border px-1.5 py-2 transition-all cursor-pointer ${
                  active || hovered
                    ? 'scale-105 bg-[#1b1438]/98 shadow-lg'
                    : 'border-white/15 bg-[#120d26]/92 hover:bg-[#191233]'
                }`}
                style={
                  active || hovered
                    ? {
                        left: `${leftPct}%`,
                        top: `${topPct}%`,
                        borderColor: station.colorHex,
                        boxShadow: `0 0 18px ${station.colorHex}45`,
                      }
                    : {
                        left: `${leftPct}%`,
                        top: `${topPct}%`,
                      }
                }
              >
                <RadioStationLogo stationId={station.id} size={36} />
                <span
                  className="mt-1 truncate max-w-full text-[10px] sm:text-[11px] font-bold leading-tight"
                  style={{ color: station.colorHex }}
                >
                  {station.name}
                </span>
                <span className="font-mono-hud text-[9px] text-slate-400">
                  {station.frequency}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
