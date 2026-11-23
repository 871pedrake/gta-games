import React, { useEffect, useRef } from 'react';

interface RadioVisualizerProps {
  active: boolean;
  colorHex: string;
  barCount?: number;
  heightPx?: number;
  sampleSpectrum?: (out: number[]) => boolean;
  className?: string;
}

export const RadioVisualizer: React.FC<RadioVisualizerProps> = ({
  active,
  colorHex,
  barCount = 12,
  heightPx = 18,
  sampleSpectrum,
  className = '',
}) => {
  const barRefs = useRef<Array<HTMLDivElement | null>>([]);
  const levelsRef = useRef<number[]>([]);

  useEffect(() => {
    const bars = new Array<number>(barCount).fill(0);
    levelsRef.current = new Array<number>(barCount).fill(0.08);

    const applyBarStyles = (playing: boolean) => {
      for (let i = 0; i < barCount; i++) {
        const el = barRefs.current[i];
        if (!el) continue;
        const lvl = levelsRef.current[i] ?? 0.08;
        el.style.transform = `scaleY(${lvl.toFixed(3)})`;
        el.style.opacity = playing ? (0.52 + lvl * 0.48).toFixed(2) : '0.28';
      }
    };

    if (!active || !sampleSpectrum) {
      for (let i = 0; i < barCount; i++) levelsRef.current[i] = 0.08;
      applyBarStyles(false);
      return;
    }

    let rafId = 0;
    const tick = () => {
      const playing = sampleSpectrum(bars);
      for (let i = 0; i < barCount; i++) {
        const target = playing ? Math.max(0.1, Math.min(1, bars[i] ?? 0)) : 0.08;
        const prev = levelsRef.current[i] ?? 0.08;
        // Subida rápida no ataque, queda suave para fluidez visual
        const smoothed = target > prev ? prev + (target - prev) * 0.55 : prev + (target - prev) * 0.22;
        levelsRef.current[i] = smoothed;
      }
      applyBarStyles(playing);
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [active, barCount, sampleSpectrum]);

  return (
    <div
      aria-hidden="true"
      className={`flex items-end gap-[2px] ${className}`}
      style={{ height: `${heightPx}px` }}
    >
      {Array.from({ length: barCount }, (_, i) => (
        <div
          key={i}
          ref={(el) => {
            barRefs.current[i] = el;
          }}
          className="w-[3px] flex-1 origin-bottom rounded-t-sm transition-colors duration-150 will-change-transform"
          style={{
            height: '100%',
            transform: 'scaleY(0.08)',
            opacity: active ? 0.65 : 0.28,
            backgroundColor: active ? colorHex : '#64748b',
            boxShadow: active ? `0 0 6px ${colorHex}66` : 'none',
          }}
        />
      ))}
    </div>
  );
};
