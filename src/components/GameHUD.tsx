import React from 'react';
import {
  AlertTriangle,
  Box,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Clock,
  CloudFog,
  CloudRain,
  Crosshair,
  Download,
  FastForward,
  Flag,
  Heart,
  Pause,
  Route,
  Shield,
  ShoppingBag,
  SkipForward,
  SlidersHorizontal,
  Star,
  Sun,
  Tag,
  ThermometerSun,
  UserPlus,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import {
  BUDGET_MAX_DRAW_CALLS,
  BUDGET_MAX_TRIANGLES,
  QUALITY_SETTINGS,
  QualityPreset,
} from '../game/config';
import { HudSnapshot, MissionId, RadioStationId, WeatherType } from '../game/types';
import { ARMOR_VEST_PRICE, WEAPON_LIST } from '../game/WeaponDefs';
import { RadioStationLogo } from './RadioStationLogo';
import { RadioVisualizer } from './RadioVisualizer';
import { RadioWheel } from './RadioWheel';

interface GameHUDProps {
  hud: HudSnapshot;
  minimapCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  reticleRef?: React.Ref<HTMLDivElement>;
  dockCollapsed: boolean;
  interactKeyLabel?: string;
  doorsKeyLabel?: string;
  radioPrevKeyLabel?: string;
  radioNextKeyLabel?: string;
  onPause: () => void;
  onToggleDock: () => void;
  onStartMission: (id: MissionId) => void;
  onAdvanceTime: () => void;
  onCycleTimeScale: () => void;
  onCycleWeather: () => void;
  onToggleMute: () => void;
  onToggleWaypoints: () => void;
  onToggleColliders: () => void;
  onToggleRoutineLabels: () => void;
  onSpawnTestGroup: () => void;
  onToggleDebugPanel: () => void;
  onSetQualityPreset: (preset: QualityPreset) => void;
  onDownloadHtml: () => void;
  onSelectWeapon: (weaponId: string) => void;
  onCloseWeaponWheel: () => void;
  onOpenGunShop: () => void;
  onCloseGunShop: () => void;
  onBuyGunShopItem: (itemId: string) => void;
  onGiveAllWeapons: () => void;
  onCycleRadio?: (dir: 1 | -1) => void;
  onSkipRadioTrack?: () => void;
  onSelectRadioStation?: (stationId: RadioStationId) => void;
  onSetRadioWheelOpen?: (open: boolean) => void;
  onSampleRadioSpectrum?: (out: number[]) => boolean;
}

function WeatherIcon({ weather }: { weather: WeatherType }) {
  if (weather === 'rain') return <CloudRain size={13} className="text-sky-300" />;
  if (weather === 'fog') return <CloudFog size={13} className="text-slate-300" />;
  if (weather === 'heat') return <ThermometerSun size={13} className="text-amber-300" />;
  return <Sun size={13} className="text-yellow-300" />;
}

const QUALITY_ORDER: QualityPreset[] = ['low', 'medium', 'high'];

export const GameHUD: React.FC<GameHUDProps> = ({
  hud,
  minimapCanvasRef,
  reticleRef,
  dockCollapsed,
  interactKeyLabel = 'F',
  doorsKeyLabel = 'J',
  radioPrevKeyLabel = 'Z',
  radioNextKeyLabel = 'X',
  onPause,
  onToggleDock,
  onStartMission,
  onAdvanceTime,
  onCycleTimeScale,
  onCycleWeather,
  onToggleMute,
  onToggleWaypoints,
  onToggleColliders,
  onToggleRoutineLabels,
  onSpawnTestGroup,
  onToggleDebugPanel,
  onSetQualityPreset,
  onDownloadHtml,
  onSelectWeapon,
  onCloseWeaponWheel,
  onOpenGunShop,
  onCloseGunShop,
  onBuyGunShopItem,
  onGiveAllWeapons,
  onCycleRadio,
  onSkipRadioTrack,
  onSelectRadioStation,
  onSetRadioWheelOpen,
  onSampleRadioSpectrum,
}) => {
  const hasZoneAlert = hud.zoneAlerts.length > 0;
  const showCrosshair =
    !hud.inVehicle &&
    !hud.gunShopOpen &&
    !hud.weaponWheelOpen &&
    hud.weapon.isFirearm;

  return (
    <div className="pointer-events-none fixed inset-0 z-10 flex flex-col justify-between p-4">
      {/* Retículo dinâmico central TPS via CSS variables/ref (sem re-render por quadro) */}
      {showCrosshair && (
        <div
          ref={reticleRef}
          aria-hidden="true"
          data-critical="false"
          className="pointer-events-none fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
        >
          <div className="relative h-1 w-1">
            {/* Ponto central */}
            <div
              className={`absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full ${
                hud.isAiming ? 'bg-cyan-300 shadow-[0_0_6px_rgba(34,211,238,0.9)]' : 'bg-white/90'
              }`}
            />
            {/* Barras cardeais guiadas por --crosshair-spread */}
            <div
              className="absolute left-1/2 h-2.5 w-[2px] -translate-x-1/2 bg-white/95 shadow-[0_0_3px_rgba(0,0,0,0.85)]"
              style={{ bottom: 'var(--crosshair-spread, 10px)' }}
            />
            <div
              className="absolute left-1/2 h-2.5 w-[2px] -translate-x-1/2 bg-white/95 shadow-[0_0_3px_rgba(0,0,0,0.85)]"
              style={{ top: 'var(--crosshair-spread, 10px)' }}
            />
            <div
              className="absolute top-1/2 h-[2px] w-2.5 -translate-y-1/2 bg-white/95 shadow-[0_0_3px_rgba(0,0,0,0.85)]"
              style={{ right: 'var(--crosshair-spread, 10px)' }}
            />
            <div
              className="absolute top-1/2 h-[2px] w-2.5 -translate-y-1/2 bg-white/95 shadow-[0_0_3px_rgba(0,0,0,0.85)]"
              style={{ left: 'var(--crosshair-spread, 10px)' }}
            />

            {/* Indicador de acerto guiado por --hit-opacity / --hit-scale / --hit-color */}
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
              <div
                className="h-6 w-6 border-2 drop-shadow-[0_0_3px_rgba(0,0,0,0.9)]"
                style={{
                  opacity: 'var(--hit-opacity, 0)',
                  transform: 'rotate(45deg) scale(var(--hit-scale, 1))',
                  borderColor: 'var(--hit-color, #ffffff)',
                  clipPath:
                    'polygon(0 0, 35% 0, 35% 35%, 0 35%, 0 100%, 35% 100%, 35% 65%, 65% 65%, 65% 100%, 100% 100%, 100% 65%, 65% 65%, 65% 35%, 100% 35%, 100% 0, 65% 0, 65% 35%, 35% 35%)',
                }}
              />
            </div>
          </div>
        </div>
      )}
      {/* Linha superior: Minimapa + Botão/Painel Debug F3 à esquerda, Missão ao centro, Dinheiro/Estrelas/Relógio à direita */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          {/* Minimapa */}
          <div className="pointer-events-auto rounded-xl border border-white/15 bg-[#0e0a1c]/90 p-2.5 shadow-lg">
            <canvas
              ref={minimapCanvasRef}
              width={156}
              height={156}
              className="block rounded-lg border border-white/10"
            />
            <div className="mt-2 flex flex-wrap items-center justify-center gap-x-2 gap-y-0.5 text-[10px] font-medium text-slate-300">
              <span className="text-[#ff2e93]">M1</span>
              <span aria-hidden="true">·</span>
              <span className="text-[#16f2d4]">M2</span>
              <span aria-hidden="true">·</span>
              <span className="text-amber-400">Armaria (A)</span>
              <span aria-hidden="true">·</span>
              <span className="text-[#facc15]">Ônibus</span>
              <span aria-hidden="true">·</span>
              <span className="text-[#ef4444]">Polícia/SAMU</span>
            </div>
            <div className="mt-1.5 border-t border-white/10 pt-1 text-center">
              <div className="text-[11px] font-semibold text-cyan-300 truncate max-w-[156px]">
                {hud.currentDistrictName}
              </div>
              <div className="text-[10px] text-slate-400 truncate max-w-[156px]">
                {hud.currentStreetName}
              </div>
            </div>
          </div>

          {/* Ações rápidas: Debug (F3) e Pausa (Esc) */}
          <div className="pointer-events-auto flex items-center gap-1.5">
            <button
              type="button"
              onClick={onToggleDebugPanel}
              className={`flex flex-1 items-center justify-between gap-2 rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition-colors cursor-pointer ${
                hud.showDebugPanel
                  ? 'border-cyan-400/70 bg-cyan-950/90 text-cyan-200'
                  : 'border-white/15 bg-[#0e0a1c]/88 text-slate-300 hover:bg-[#1a1333] hover:text-white'
              }`}
            >
              <span className="flex items-center gap-1.5">
                <SlidersHorizontal size={12} />
                <span>{hud.showDebugPanel ? 'Ocultar Debug' : 'Debug (F3)'}</span>
              </span>
              {hasZoneAlert && (
                <span className="flex items-center gap-0.5 text-amber-300">
                  <AlertTriangle size={11} />
                  <span>{hud.zoneAlerts.length}</span>
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={onPause}
              aria-label="Pausar jogo"
              className="flex items-center gap-1 rounded-lg border border-white/15 bg-[#0e0a1c]/88 px-2.5 py-1 text-[11px] font-semibold text-slate-200 hover:bg-[#1a1333] hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Pause size={12} />
              <span>Esc</span>
            </button>
          </div>

          {/* Painel completo de Debug (visível apenas quando ativado via F3) */}
          {hud.showDebugPanel && (
            <div className="pointer-events-auto rounded-xl border border-white/15 bg-[#0e0a1c]/94 px-3 py-2.5 shadow-lg text-xs w-[238px]">
              <div className="flex items-center justify-between gap-3">
                <span className="font-semibold text-slate-300">FPS</span>
                <span className="font-mono-hud tabular-nums font-bold text-cyan-300">{hud.fps}</span>
              </div>

              {/* Seletor de Qualidade (Baixo / Médio / Alto) */}
              <div className="mt-2 border-t border-white/10 pt-2">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  Qualidade (NPCs na tela)
                </div>
                <div className="mt-1 grid grid-cols-3 gap-1">
                  {QUALITY_ORDER.map((preset) => {
                    const active = hud.qualityPreset === preset;
                    return (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => onSetQualityPreset(preset)}
                        className={`rounded border px-1.5 py-1 text-[10px] font-semibold transition-colors cursor-pointer ${
                          active
                            ? 'border-cyan-400 bg-cyan-600/90 text-white'
                            : 'border-white/15 bg-[#1b1533] text-slate-300 hover:bg-[#29204a]'
                        }`}
                      >
                        {QUALITY_SETTINGS[preset].label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="mt-2 border-t border-white/10 pt-1.5 space-y-0.5">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  Renderização (renderer.info)
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-400">Draw calls</span>
                  <span
                    className={`font-mono-hud tabular-nums font-semibold ${
                      hud.renderTelemetry.calls > BUDGET_MAX_DRAW_CALLS
                        ? 'text-amber-300'
                        : 'text-emerald-300'
                    }`}
                  >
                    {hud.renderTelemetry.calls} / {BUDGET_MAX_DRAW_CALLS}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-400">Triângulos</span>
                  <span
                    className={`font-mono-hud tabular-nums ${
                      hud.renderTelemetry.triangles > BUDGET_MAX_TRIANGLES
                        ? 'text-amber-300'
                        : 'text-slate-200'
                    }`}
                  >
                    {hud.renderTelemetry.triangles.toLocaleString('pt-BR')}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-400">Geos / Tex / Prog</span>
                  <span className="font-mono-hud tabular-nums text-slate-300">
                    {hud.renderTelemetry.geometries} / {hud.renderTelemetry.textures} / {hud.renderTelemetry.programs}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-400">DPR / Escala</span>
                  <span className="font-mono-hud tabular-nums text-cyan-300">
                    {hud.renderTelemetry.pixelRatio.toFixed(2)} ({hud.renderTelemetry.dynamicScalePct}%)
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-400">Alcance (far)</span>
                  <span className="font-mono-hud tabular-nums text-slate-300">
                    {hud.renderTelemetry.drawDistance} m
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-400">Chunks (F / I / D)</span>
                  <span className="font-mono-hud tabular-nums text-cyan-300">
                    {hud.renderTelemetry.chunksFull} / {hud.renderTelemetry.chunksImpostor} / {hud.renderTelemetry.chunksUnloaded}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-400">Balas / Part. / Decais</span>
                  <span className="font-mono-hud tabular-nums text-amber-300">
                    {hud.weaponDebug.activeProjectiles} / {hud.weaponDebug.activeParticles} / {hud.weaponDebug.activeDecals}
                  </span>
                </div>
              </div>

              <div className="mt-2 border-t border-white/10 pt-1.5 space-y-0.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-400">Visíveis na tela</span>
                  <span className="font-mono-hud tabular-nums font-semibold text-slate-100">
                    {hud.activeNpcs} / {hud.maxNpcs}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-400">Pool baixa fidel.</span>
                  <span className="font-mono-hud tabular-nums text-slate-300">
                    {hud.backgroundNpcs}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-400">Dentro de prédios</span>
                  <span className="font-mono-hud tabular-nums text-sky-300">
                    {hud.insideBuildingsNpcs}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-400">LOD (C / M / B)</span>
                  <span className="font-mono-hud tabular-nums text-emerald-300">
                    {hud.lodCounts.full} / {hud.lodCounts.mid} / {hud.lodCounts.low}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-400">Feridos ativos</span>
                  <span className="font-mono-hud tabular-nums font-semibold text-pink-400">
                    {hud.activeInjuredCount} / {hud.maxInjuredCap}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-400">Acertos jogador</span>
                  <span className="font-mono-hud tabular-nums text-rose-300">
                    {hud.injuredCount}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-400">Ragdolls</span>
                  <span className="font-mono-hud tabular-nums text-amber-300">
                    {hud.ragdollsInUse} / {hud.ragdollsPoolSize}
                  </span>
                </div>
              </div>

              {/* Contagem e Alertas por Zona Urbana */}
              <div className="mt-2 border-t border-white/10 pt-1.5">
                <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  <span>Zonas (1 NPC / 6m)</span>
                  {hasZoneAlert && (
                    <span className="flex items-center gap-0.5 text-amber-300">
                      <AlertTriangle size={10} />
                      <span>Excesso</span>
                    </span>
                  )}
                </div>
                <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px]">
                  {hud.zoneStats.map((z) => (
                    <div key={z.id} className="flex items-center justify-between gap-1.5">
                      <span className={z.overLimit ? 'truncate font-semibold text-amber-300' : 'truncate text-slate-300'}>
                        {z.label}
                      </span>
                      <span
                        className={`font-mono-hud tabular-nums ${
                          z.overLimit ? 'font-bold text-amber-300' : 'text-slate-200'
                        }`}
                      >
                        {z.count}/{z.maxDensity}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-2 border-t border-white/10 pt-1.5 space-y-0.5">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-slate-400">Semáforo</span>
                  <span className="font-mono-hud text-[11px] font-semibold text-emerald-300">
                    {hud.trafficSignalPhase}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-slate-400">Ônibus ({hud.activeBuses})</span>
                  <span className="font-mono-hud tabular-nums text-[11px] font-semibold text-yellow-300">
                    {hud.busPassengersTotal} passag.
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-slate-400">SAMU</span>
                  <span
                    className={`font-mono-hud text-[11px] font-semibold ${
                      hud.ambulanceStatus === 'A caminho' || hud.ambulanceStatus === 'Atendendo'
                        ? 'text-rose-400'
                        : 'text-cyan-300'
                    }`}
                  >
                    {hud.ambulanceStatus}
                  </span>
                </div>
              </div>

              <div className="mt-2 grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={onCycleTimeScale}
                  className={`flex items-center justify-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                    hud.timeScale > 1
                      ? 'border-amber-400 bg-amber-600/85 text-white'
                      : 'border-white/15 bg-[#1b1533] text-slate-200 hover:bg-[#29204a]'
                  }`}
                >
                  <FastForward size={12} />
                  <span>{hud.timeScale}x (T)</span>
                </button>

                <button
                  type="button"
                  onClick={onSpawnTestGroup}
                  className="flex items-center justify-center gap-1 rounded-lg border border-white/15 bg-[#1b1533] px-2 py-1 text-[11px] font-semibold text-slate-200 hover:bg-[#29204a] transition-colors whitespace-nowrap cursor-pointer"
                >
                  <UserPlus size={12} />
                  <span>+10 (K)</span>
                </button>

                <button
                  type="button"
                  onClick={onToggleRoutineLabels}
                  className={`flex items-center justify-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                    hud.showRoutineLabels
                      ? 'border-sky-400 bg-sky-600/90 text-white'
                      : 'border-white/15 bg-[#1b1533] text-slate-200 hover:bg-[#29204a]'
                  }`}
                >
                  <Tag size={12} />
                  <span>Rotinas (H)</span>
                </button>

                <button
                  type="button"
                  onClick={onToggleColliders}
                  className={`flex items-center justify-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                    hud.showColliders
                      ? 'border-pink-400 bg-pink-600/90 text-white'
                      : 'border-white/15 bg-[#1b1533] text-slate-200 hover:bg-[#29204a]'
                  }`}
                >
                  <Box size={12} />
                  <span>Colis. (P)</span>
                </button>
              </div>

              <button
                type="button"
                onClick={onToggleWaypoints}
                className={`mt-1.5 flex w-full items-center justify-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                  hud.showWaypoints
                    ? 'border-cyan-400 bg-cyan-600/90 text-white'
                    : 'border-white/15 bg-[#1b1533] text-slate-200 hover:bg-[#29204a]'
                }`}
              >
                <Route size={13} />
                <span>{hud.showWaypoints ? 'Waypoints: ON (G)' : 'Waypoints: OFF (G)'}</span>
              </button>

              <button
                type="button"
                onClick={onGiveAllWeapons}
                className="mt-1.5 flex w-full items-center justify-center gap-1.5 rounded-lg border border-amber-400/45 bg-amber-950/70 px-2.5 py-1 text-[11px] font-semibold text-amber-200 hover:bg-amber-900/80 transition-colors whitespace-nowrap cursor-pointer"
              >
                <Crosshair size={12} />
                <span>DEV: Dar todas as armas</span>
              </button>
            </div>
          )}
        </div>

        {/* Objetivo da Missão Ativa + Notificação "Tocando Agora" da Rádio */}
        <div className="flex flex-col items-center gap-2">
          <div className="hidden max-w-md rounded-xl border border-white/15 bg-[#0e0a1c]/90 px-4 py-2.5 text-center shadow-lg md:block">
            <div className="font-display text-sm font-bold tracking-wide text-[#facc15]">
              {hud.mission.title}
            </div>
            <p className="mt-0.5 text-xs leading-relaxed text-slate-200">
              {hud.mission.objective}
            </p>
          </div>

          {hud.inVehicle && hud.radio.notificationTimer > 0 && (
            <div
              role="status"
              aria-live="polite"
              className="pointer-events-none flex items-center gap-3 rounded-xl border bg-[#0e0a1c]/95 px-4 py-2 shadow-xl backdrop-blur-sm"
              style={{ borderColor: `${hud.radio.colorHex}80` }}
            >
              <div className="shrink-0">
                <RadioStationLogo stationId={hud.radio.stationId} size={34} />
              </div>
              <div className="min-w-0 text-left">
                <div className="flex items-center gap-2">
                  <span
                    className="font-display text-xs font-bold tracking-wide"
                    style={{ color: hud.radio.colorHex }}
                  >
                    {hud.radio.stationName}
                  </span>
                  <span className="font-mono-hud text-[10px] text-slate-400">
                    {hud.radio.frequency}
                  </span>
                  <span className="text-[10px] text-slate-500">·</span>
                  <span className="text-[10px] text-slate-300">{hud.radio.genre}</span>
                </div>
                <div className="mt-0.5 truncate max-w-[260px] text-xs font-medium text-white">
                  {hud.radio.isOff
                    ? 'Rádio silenciada'
                    : `Tocando agora: ${hud.radio.trackTitle} — ${hud.radio.trackArtist}`}
                </div>
              </div>
              <RadioVisualizer
                active={!hud.radio.isOff && !hud.muted}
                colorHex={hud.radio.colorHex}
                barCount={8}
                heightPx={22}
                sampleSpectrum={onSampleRadioSpectrum}
                className="w-9 shrink-0"
              />
              <span className="hidden sm:inline-block rounded border border-white/15 bg-white/5 px-1.5 py-0.5 font-mono-hud text-[10px] text-slate-300">
                {radioPrevKeyLabel}/{radioNextKeyLabel}
              </span>
            </div>
          )}
        </div>

        {/* Dinheiro, Estrelas de Procurado, Relógio 24h e Estado do Carro */}
        <div className="rounded-xl border border-white/15 bg-[#0e0a1c]/90 px-4 py-3 text-right shadow-lg min-w-[220px]">
          <div className="font-mono-hud tabular-nums text-2xl font-bold tracking-tight text-emerald-400">
            $ {hud.money.toLocaleString('pt-BR')}
          </div>

          <div
            className="mt-1.5 flex items-center justify-end gap-1.5"
            aria-label={`Procurado: ${hud.wantedStars} de 3 estrelas`}
          >
            {[1, 2, 3].map((starIndex) => {
              const active = starIndex <= hud.wantedStars;
              return (
                <Star
                  key={starIndex}
                  size={20}
                  className={
                    active
                      ? 'fill-amber-400 text-amber-400'
                      : 'fill-transparent text-slate-600'
                  }
                />
              );
            })}
          </div>

          {hud.wantedStars > 0 && (
            <div className="mt-1.5 text-[11px] font-medium text-amber-300">
              {hud.bustProgress > 0.05
                ? `Cercado! (${Math.round(hud.bustProgress * 100)}%)`
                : hud.evadingProgress > 0.05
                ? `Despistando polícia (${Math.round(hud.evadingProgress * 100)}%)`
                : 'Polícia em perseguição'}
            </div>
          )}

          <div className="mt-2 flex items-center justify-end gap-2 text-xs text-slate-200">
            <span className="font-mono-hud tabular-nums font-bold text-cyan-300">
              {hud.gameTimeFormatted}
            </span>
            <span aria-hidden="true">·</span>
            <span className="text-pink-400 font-medium">{hud.timeOfDayLabel}</span>
          </div>
          <div className="mt-0.5 text-[11px] text-slate-400">
            Dia {hud.dayNumber} · {hud.isWeekend ? 'Fim de Semana' : 'Dia Útil'} ({hud.timeScale}x)
          </div>
          <div className="mt-1.5 flex items-center justify-end gap-2 text-[11px]">
            <span className="flex items-center gap-1 font-medium text-slate-100">
              <WeatherIcon weather={hud.weather} />
              <span>{hud.weatherLabel}</span>
            </span>
            <span aria-hidden="true" className="text-slate-500">·</span>
            <span
              className={`font-mono-hud tabular-nums font-semibold ${
                hud.weatherGripPct < 75
                  ? 'text-sky-300'
                  : hud.weatherGripPct < 95
                  ? 'text-amber-300'
                  : 'text-emerald-300'
              }`}
            >
              Pista {hud.weatherGripPct}%
            </span>
          </div>

          {/* Vida, Colete e Arma Ativa */}
          <div className="mt-2.5 border-t border-white/10 pt-2 space-y-1.5 text-left">
            <div className="flex items-center gap-2 text-[11px]">
              <Heart size={12} className="text-rose-400 shrink-0" />
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full bg-rose-500 transition-all"
                  style={{ width: `${Math.max(0, Math.min(100, hud.health))}%` }}
                />
              </div>
              <span className="font-mono-hud tabular-nums text-slate-200 w-7 text-right">
                {hud.health}
              </span>
            </div>

            {hud.armor > 0 && (
              <div className="flex items-center gap-2 text-[11px]">
                <Shield size={12} className="text-sky-400 shrink-0" />
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full bg-sky-400 transition-all"
                    style={{ width: `${Math.max(0, Math.min(100, hud.armor))}%` }}
                  />
                </div>
                <span className="font-mono-hud tabular-nums text-sky-200 w-7 text-right">
                  {hud.armor}
                </span>
              </div>
            )}

            {!hud.inVehicle && (
              <>
                <div className="flex items-center justify-between gap-2 pt-0.5 text-xs">
                  <span className="flex items-center gap-1.5 font-semibold text-cyan-200 truncate">
                    <Crosshair size={13} className="text-pink-400 shrink-0" />
                    <span>{hud.weaponName}</span>
                  </span>
                  {hud.weapon.weaponState === 'switching' ? (
                    <span className="text-[11px] font-semibold text-cyan-300 shrink-0">Trocando...</span>
                  ) : hud.weapon.isFirearm ? (
                    <span className="font-mono-hud tabular-nums font-bold text-amber-300 shrink-0">
                      {hud.isReloading
                        ? 'Recarregando...'
                        : `${hud.ammoClip} / ${hud.ammoReserve}`}
                    </span>
                  ) : (
                    <span className="text-[11px] text-slate-400">Corpo a corpo</span>
                  )}
                </div>

                {hud.isReloading && (
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                    <div
                      className="h-full bg-amber-400 transition-all duration-75"
                      style={{ width: `${Math.round(hud.reloadProgress * 100)}%` }}
                    />
                  </div>
                )}

                <div className="flex items-center justify-between gap-1 pt-0.5">
                  <div className="flex items-center gap-1">
                    {WEAPON_LIST.map((w) => {
                      const owned = hud.weapon.ownedWeapons.some((ow) => ow.id === w.id);
                      const active = hud.activeWeaponId === w.id;
                      return (
                        <button
                          key={w.id}
                          type="button"
                          disabled={!owned}
                          title={`${w.shortName} (${w.slot})`}
                          onClick={() => onSelectWeapon(w.id)}
                          className={`pointer-events-auto h-5 min-w-[22px] rounded border px-1 font-mono-hud text-[10px] font-bold transition-colors ${
                            !owned
                              ? 'border-white/5 bg-white/[0.03] text-slate-600 cursor-not-allowed'
                              : active
                              ? 'border-cyan-400 bg-cyan-600/80 text-white cursor-pointer'
                              : 'border-white/15 bg-white/[0.06] text-slate-300 hover:bg-white/15 cursor-pointer'
                          }`}
                        >
                          {w.slot}
                        </button>
                      );
                    })}
                  </div>
                  <span className="text-[10px] text-slate-400">Tab: Roda</span>
                </div>
              </>
            )}
          </div>

          {hud.inVehicle && (
            <div className="mt-2 border-t border-white/10 pt-2">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="text-slate-300 truncate max-w-[125px]">{hud.vehicleName}</span>
                <span className="font-mono-hud tabular-nums font-bold text-cyan-300">
                  {hud.speedKmh} km/h
                </span>
              </div>
              <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-slate-400">
                <span>Lataria</span>
                <span
                  className={`font-mono-hud tabular-nums font-semibold ${
                    hud.vehicleHealthPct > 60
                      ? 'text-emerald-400'
                      : hud.vehicleHealthPct > 35
                      ? 'text-amber-300'
                      : 'text-rose-400'
                  }`}
                >
                  {hud.vehicleHealthPct}%
                </span>
              </div>
              <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                <div
                  className={`h-full transition-all ${
                    hud.vehicleHealthPct > 60
                      ? 'bg-emerald-400'
                      : hud.vehicleHealthPct > 35
                      ? 'bg-amber-400'
                      : 'bg-rose-500'
                  }`}
                  style={{ width: `${hud.vehicleHealthPct}%` }}
                />
              </div>

              {/* Rádio do Veículo */}
              <div className="mt-2 border-t border-white/10 pt-2 text-left">
                <div className="flex items-center justify-between gap-1.5">
                  <button
                    type="button"
                    onClick={() => onCycleRadio?.(-1)}
                    aria-label="Estação anterior"
                    title={`Estação anterior (${radioPrevKeyLabel})`}
                    className="pointer-events-auto flex h-6 w-6 shrink-0 items-center justify-center rounded border border-white/15 bg-[#1b1533] text-slate-200 hover:bg-[#29204a] cursor-pointer"
                  >
                    <ChevronLeft size={13} />
                  </button>

                  <button
                    type="button"
                    onClick={() => onSetRadioWheelOpen?.(!hud.radio.wheelOpen)}
                    title="Abrir seletor de estações"
                    className="pointer-events-auto flex min-w-0 flex-1 items-center justify-between gap-1.5 rounded border border-white/15 bg-[#16102b] px-2 py-1 hover:bg-[#221a3d] cursor-pointer"
                  >
                    <span className="flex min-w-0 items-center gap-1.5">
                      <RadioStationLogo stationId={hud.radio.stationId} size={16} className="shrink-0" />
                      <span
                        className="truncate text-[11px] font-bold"
                        style={{ color: hud.radio.colorHex }}
                      >
                        {hud.radio.stationName}
                      </span>
                    </span>
                    <span className="font-mono-hud text-[10px] text-slate-400 shrink-0">
                      {hud.radio.frequency}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => onCycleRadio?.(1)}
                    aria-label="Próxima estação"
                    title={`Próxima estação (${radioNextKeyLabel})`}
                    className="pointer-events-auto flex h-6 w-6 shrink-0 items-center justify-center rounded border border-white/15 bg-[#1b1533] text-slate-200 hover:bg-[#29204a] cursor-pointer"
                  >
                    <ChevronRight size={13} />
                  </button>
                </div>

                <div className="mt-1.5 flex items-center justify-between gap-2 text-[10px]">
                  <span className="truncate max-w-[118px] text-slate-300">
                    {hud.radio.isOff
                      ? 'Rádio desligada'
                      : `${hud.radio.trackTitle} · ${hud.radio.trackArtist}`}
                  </span>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {!hud.radio.isOff && hud.radio.trackCount > 1 && (
                      <button
                        type="button"
                        onClick={() => onSkipRadioTrack?.()}
                        aria-label="Próxima música da estação"
                        title={`Próxima música (${hud.radio.trackIndex + 1}/${hud.radio.trackCount})`}
                        className="pointer-events-auto flex items-center gap-0.5 rounded border border-white/15 bg-[#1b1533] px-1.5 py-0.5 font-mono-hud text-[9px] text-slate-200 hover:bg-[#29204a] cursor-pointer"
                      >
                        <SkipForward size={10} />
                        <span>
                          {hud.radio.trackIndex + 1}/{hud.radio.trackCount}
                        </span>
                      </button>
                    )}
                    <RadioVisualizer
                      active={!hud.radio.isOff && !hud.muted}
                      colorHex={hud.radio.colorHex}
                      barCount={10}
                      heightPx={13}
                      sampleSpectrum={onSampleRadioSpectrum}
                      className="w-10"
                    />
                    <span className="font-mono-hud text-slate-400">
                      {radioPrevKeyLabel}/{radioNextKeyLabel}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Avisos centrais discretos + Roda de Armas + Armaria Maré Forte */}
      <div className="pointer-events-none flex flex-col items-center gap-2">
        {hud.bannerText && (
          <div
            className={`relative z-40 rounded-lg border px-4 py-2 text-sm font-semibold shadow-lg ${
              hud.bustedFlash
                ? 'border-rose-400 bg-rose-600/95 text-white'
                : 'border-pink-400/50 bg-[#170f2e]/95 text-white'
            }`}
          >
            {hud.bannerText}
          </div>
        )}

        {hud.nearVehiclePrompt && (
          <div className="rounded-lg border border-cyan-400/60 bg-[#0e0a1c]/95 px-3.5 py-1.5 text-xs font-semibold text-cyan-300">
            Pressione {interactKeyLabel} para entrar · {doorsKeyLabel} para abrir/fechar portas
          </div>
        )}

        {hud.nearGunShopPrompt && (
          <button
            type="button"
            onClick={onOpenGunShop}
            className="pointer-events-auto rounded-lg border border-amber-400/75 bg-[#0e0a1c]/95 px-4 py-2 text-xs font-semibold text-amber-300 shadow-lg hover:bg-amber-950/90 cursor-pointer"
          >
            Pressione {interactKeyLabel} ou clique aqui para abrir a Armaria Maré Forte
          </button>
        )}
      </div>

      {hud.weaponWheelOpen && (
        <div
          onClick={onCloseWeaponWheel}
          className="pointer-events-auto fixed inset-0 z-30 flex items-center justify-center bg-black/45 p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-2xl border border-cyan-400/40 bg-[#0e0a1c]/96 p-4 shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-white/10 pb-2">
              <span className="font-display text-sm font-bold text-white">Roda de Armas (Segure Tab · 1–5)</span>
              <button
                type="button"
                onClick={onCloseWeaponWheel}
                className="rounded-md p-1 text-slate-300 hover:bg-white/10 hover:text-white cursor-pointer"
              >
                <X size={15} />
              </button>
            </div>
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {WEAPON_LIST.map((w) => {
                const owned = hud.weapon.ownedWeapons.find((ow) => ow.id === w.id);
                const active = hud.weapon.activeWeaponId === w.id;
                return (
                  <button
                    key={w.id}
                    type="button"
                    disabled={!owned}
                    onClick={() => onSelectWeapon(w.id)}
                    className={`flex items-center justify-between rounded-xl border px-3 py-2.5 text-left text-xs transition-colors ${
                      !owned
                        ? 'border-white/5 bg-[#120d24]/60 text-slate-500 cursor-not-allowed'
                        : active
                        ? 'border-cyan-400 bg-cyan-700/70 text-white cursor-pointer'
                        : 'border-white/15 bg-[#1b1533] text-slate-200 hover:bg-[#29204a] cursor-pointer'
                    }`}
                  >
                    <div>
                      <div className="font-semibold">
                        [{w.slot}] {w.shortName}
                      </div>
                      <div className="text-[10px] text-slate-300">
                        {!owned ? 'Comprar na Armaria' : w.isFirearm ? `${owned.clip}/${owned.reserve}` : 'Corpo a corpo'}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {hud.inVehicle && hud.radio.wheelOpen && (
        <RadioWheel
          radio={hud.radio}
          muted={hud.muted}
          radioPrevKeyLabel={radioPrevKeyLabel}
          radioNextKeyLabel={radioNextKeyLabel}
          onSelectStation={(stationId) => onSelectRadioStation?.(stationId)}
          onClose={() => onSetRadioWheelOpen?.(false)}
          sampleSpectrum={onSampleRadioSpectrum}
        />
      )}

      {hud.gunShopOpen && (
        <div
          onClick={onCloseGunShop}
          className="pointer-events-auto fixed inset-0 z-30 flex items-center justify-center bg-black/55 p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg rounded-2xl border border-amber-400/50 bg-[#0e0a1c]/98 p-4 shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-white/10 pb-2.5">
              <div className="flex items-center gap-2">
                <ShoppingBag size={16} className="text-amber-400" />
                <span className="font-display text-base font-bold text-white">
                  Armaria Maré Forte
                </span>
              </div>
              <div className="flex items-center gap-3">
                <span className="font-mono-hud text-sm font-bold text-emerald-400">
                  $ {hud.money.toLocaleString('pt-BR')}
                </span>
                <button
                  type="button"
                  onClick={onCloseGunShop}
                  className="rounded-md p-1 text-slate-300 hover:bg-white/10 hover:text-white cursor-pointer"
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            <div className="mt-3 max-h-[60vh] space-y-2 overflow-y-auto pr-1">
              {WEAPON_LIST.filter((w) => w.isFirearm).map((w) => {
                const owned = hud.weapon.ownedWeapons.find((ow) => ow.id === w.id);
                const price = owned ? w.ammoPackPrice : w.price;
                const canAfford = hud.money >= price;
                const ammoFull = Boolean(owned && owned.reserve >= w.maxReserve);
                return (
                  <div
                    key={w.id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-[#17112b] px-3.5 py-2.5"
                  >
                    <div>
                      <div className="text-xs font-bold text-white">{w.name}</div>
                      <div className="text-[11px] text-slate-400">{w.description}</div>
                      {owned && (
                        <div className="mt-0.5 text-[10px] font-mono-hud text-cyan-300">
                          Munição: {owned.clip}/{owned.reserve} (Máx {w.maxReserve})
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      disabled={ammoFull}
                      onClick={() => onBuyGunShopItem(w.id)}
                      className={`shrink-0 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
                        ammoFull
                          ? 'border-white/10 bg-[#221a3d] text-slate-500 cursor-not-allowed'
                          : !canAfford
                          ? 'border-rose-400/35 bg-rose-950/50 text-rose-200 hover:bg-rose-900/60 cursor-pointer'
                          : 'border-amber-400/60 bg-amber-600/90 text-white hover:bg-amber-500 cursor-pointer'
                      }`}
                    >
                      {ammoFull
                        ? 'Cheio'
                        : owned
                        ? `+${w.ammoPackAmount} Mun. ($${w.ammoPackPrice})`
                        : `Comprar ($${w.price})`}
                    </button>
                  </div>
                );
              })}

              <div className="flex items-center justify-between gap-3 rounded-xl border border-sky-400/25 bg-[#131832] px-3.5 py-2.5">
                <div>
                  <div className="text-xs font-bold text-sky-200">Colete Balístico</div>
                  <div className="text-[11px] text-slate-400">
                    Proteção completa ({hud.armor}/100 atual).
                  </div>
                </div>
                <button
                  type="button"
                  disabled={hud.armor >= 100}
                  onClick={() => onBuyGunShopItem('armor')}
                  className={`shrink-0 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
                    hud.armor >= 100
                      ? 'border-white/10 bg-[#221a3d] text-slate-500 cursor-not-allowed'
                      : hud.money < ARMOR_VEST_PRICE
                      ? 'border-rose-400/35 bg-rose-950/50 text-rose-200 hover:bg-rose-900/60 cursor-pointer'
                      : 'border-sky-400/60 bg-sky-600/90 text-white hover:bg-sky-500 cursor-pointer'
                  }`}
                >
                  {hud.armor >= 100 ? 'Equipado' : `Equipar ($${ARMOR_VEST_PRICE})`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Dock inferior retrátil */}
      <div className="flex flex-col items-center">
        <button
          type="button"
          onClick={onToggleDock}
          className="pointer-events-auto mb-1.5 flex items-center gap-1.5 rounded-t-lg border border-b-0 border-white/15 bg-[#0e0a1c]/90 px-3 py-1 text-[11px] font-medium text-slate-300 hover:text-white transition-colors cursor-pointer"
        >
          {dockCollapsed ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          <span>{dockCollapsed ? 'Mostrar Controles (U)' : 'Ocultar Controles (U)'}</span>
        </button>

        {!dockCollapsed && (
          <div className="pointer-events-auto flex flex-wrap items-center justify-center gap-2 rounded-xl border border-white/15 bg-[#0e0a1c]/92 px-3.5 py-2 shadow-xl max-w-[94vw]">
            <button
              type="button"
              onClick={() => onStartMission('mission1')}
              className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                hud.mission.id === 'mission1'
                  ? 'border-pink-400 bg-pink-600 text-white'
                  : 'border-white/15 bg-[#1b1533] text-slate-100 hover:bg-[#29204a]'
              }`}
            >
              <Flag size={13} />
              <span>Missão 1: Carga Quente</span>
            </button>

            <button
              type="button"
              onClick={() => onStartMission('mission2')}
              className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                hud.mission.id === 'mission2'
                  ? 'border-cyan-400 bg-cyan-600 text-white'
                  : 'border-white/15 bg-[#1b1533] text-slate-100 hover:bg-[#29204a]'
              }`}
            >
              <Flag size={13} />
              <span>Missão 2: Maleta da Orla</span>
            </button>

            <button
              type="button"
              onClick={onAdvanceTime}
              className="flex items-center gap-1.5 rounded-lg border border-white/15 bg-[#1b1533] px-3 py-1.5 text-xs font-semibold text-slate-100 hover:bg-[#29204a] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Clock size={13} />
              <span>+4h Horário</span>
            </button>

            <button
              type="button"
              onClick={onCycleWeather}
              className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                hud.weather !== 'clear'
                  ? 'border-sky-400/70 bg-sky-900/70 text-sky-100 hover:bg-sky-800/80'
                  : 'border-white/15 bg-[#1b1533] text-slate-100 hover:bg-[#29204a]'
              }`}
            >
              <WeatherIcon weather={hud.weather} />
              <span>Clima (C)</span>
            </button>

            <button
              type="button"
              onClick={onToggleMute}
              aria-label={hud.muted ? 'Ativar áudio' : 'Silenciar áudio'}
              className="flex items-center gap-1.5 rounded-lg border border-white/15 bg-[#1b1533] px-2.5 py-1.5 text-xs font-semibold text-slate-100 hover:bg-[#29204a] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {hud.muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
            </button>

            <button
              type="button"
              onClick={onDownloadHtml}
              className="flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-950/70 px-3 py-1.5 text-xs font-semibold text-emerald-300 hover:bg-emerald-900/80 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Download size={13} />
              <span>Baixar HTML Único</span>
            </button>

            <div className="hidden xl:flex items-center gap-2 pl-2 text-[11px] text-slate-400 whitespace-nowrap">
              <span>WASD Mover</span>
              <span aria-hidden="true">·</span>
              <span>{interactKeyLabel} Carro</span>
              <span aria-hidden="true">·</span>
              <span>C Clima</span>
              <span aria-hidden="true">·</span>
              <span>B Buzina</span>
              {hud.inVehicle && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="text-amber-300">{doorsKeyLabel} Portas</span>
                  <span aria-hidden="true">·</span>
                  <span className="text-cyan-300">
                    {radioPrevKeyLabel}/{radioNextKeyLabel} Rádio
                  </span>
                </>
              )}
              <span aria-hidden="true">·</span>
              <span>F3 Debug</span>
              {hud.gamepadConnected && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="text-cyan-300">Gamepad ativo</span>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
