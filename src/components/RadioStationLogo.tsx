import React from 'react';
import { RadioStationId } from '../game/types';

interface RadioStationLogoProps {
  stationId: RadioStationId;
  size?: number;
  className?: string;
}

export const RadioStationLogo: React.FC<RadioStationLogoProps> = ({
  stationId,
  size = 36,
  className = '',
}) => {
  switch (stationId) {
    case 'solara_fm':
      return (
        <svg
          width={size}
          height={size}
          viewBox="0 0 48 48"
          fill="none"
          aria-hidden="true"
          className={className}
        >
          <defs>
            <linearGradient id="solaraSun" x1="24" y1="6" x2="24" y2="34" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#fde047" />
              <stop offset="55%" stopColor="#ff2e93" />
              <stop offset="100%" stopColor="#22d3ee" />
            </linearGradient>
          </defs>
          <circle cx="24" cy="24" r="22" fill="#130b29" stroke="#22d3ee" strokeWidth="2" />
          {/* Outrun sun with horizontal scanline slices */}
          <path d="M11 25 A13 13 0 0 1 37 25 Z" fill="url(#solaraSun)" />
          <rect x="10" y="21" width="28" height="2.2" fill="#130b29" />
          <rect x="11" y="24.5" width="26" height="2" fill="#130b29" />
          {/* Coastal neon horizon & wave */}
          <path d="M8 29 Q16 25 24 29 T40 29" stroke="#22d3ee" strokeWidth="2.4" strokeLinecap="round" />
          <path d="M12 34.5 Q20 31.5 28 34.5 T36 34.5" stroke="#ff2e93" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      );

    case 'baia_beats':
      return (
        <svg
          width={size}
          height={size}
          viewBox="0 0 48 48"
          fill="none"
          aria-hidden="true"
          className={className}
        >
          <circle cx="24" cy="24" r="22" fill="#1b0a26" stroke="#ec4899" strokeWidth="2" />
          {/* Sub-bass speaker ring & equalizer bars */}
          <circle cx="24" cy="24" r="14.5" stroke="#ec4899" strokeOpacity="0.45" strokeWidth="1.5" strokeDasharray="3 2" />
          <rect x="13" y="21" width="3.5" height="10" rx="1.75" fill="#f472b6" />
          <rect x="18.5" y="14" width="3.5" height="20" rx="1.75" fill="#ec4899" />
          <rect x="24" y="10.5" width="3.5" height="27" rx="1.75" fill="#22d3ee" />
          <rect x="29.5" y="16" width="3.5" height="16" rx="1.75" fill="#ec4899" />
          <rect x="35" y="20" width="3.5" height="10" rx="1.75" fill="#f472b6" />
        </svg>
      );

    case 'litoral_rock':
      return (
        <svg
          width={size}
          height={size}
          viewBox="0 0 48 48"
          fill="none"
          aria-hidden="true"
          className={className}
        >
          <circle cx="24" cy="24" r="22" fill="#1d1309" stroke="#f59e0b" strokeWidth="2" />
          {/* Guitar pick badge */}
          <path
            d="M24 9 C33 9 37 14 35 23 C33.5 30 28 36.5 24 39 C20 36.5 14.5 30 13 23 C11 14 15 9 24 9 Z"
            fill="#2b1908"
            stroke="#fbbf24"
            strokeWidth="2"
          />
          {/* Lightning bolt */}
          <path
            d="M25.5 13.5 L18.5 24.5 H24 L21.5 34.5 L30 22.5 H24.5 L25.5 13.5 Z"
            fill="#f59e0b"
            stroke="#fef08a"
            strokeWidth="1"
            strokeLinejoin="round"
          />
        </svg>
      );

    case 'costa_chill':
      return (
        <svg
          width={size}
          height={size}
          viewBox="0 0 48 48"
          fill="none"
          aria-hidden="true"
          className={className}
        >
          <circle cx="24" cy="24" r="22" fill="#091d19" stroke="#34d399" strokeWidth="2" />
          {/* Vinyl / moon disc */}
          <circle cx="25" cy="21" r="10.5" fill="#10b981" fillOpacity="0.22" stroke="#6ee7b7" strokeWidth="1.6" />
          {/* Palm silhouette */}
          <path d="M21 36 Q22 26 24 20" stroke="#34d399" strokeWidth="2.5" strokeLinecap="round" />
          <path d="M24 20 Q17 16 12 19.5" stroke="#34d399" strokeWidth="2.2" strokeLinecap="round" />
          <path d="M24 20 Q19 13 15 13" stroke="#6ee7b7" strokeWidth="2" strokeLinecap="round" />
          <path d="M24 20 Q29 14 34 17" stroke="#34d399" strokeWidth="2.2" strokeLinecap="round" />
          <path d="M24 20 Q31 19 35 23.5" stroke="#6ee7b7" strokeWidth="2" strokeLinecap="round" />
          {/* Calm bay wave */}
          <path d="M11 36 Q18 33.5 24 36 T37 36" stroke="#34d399" strokeWidth="2" strokeLinecap="round" />
        </svg>
      );

    case 'noticias_bs':
      return (
        <svg
          width={size}
          height={size}
          viewBox="0 0 48 48"
          fill="none"
          aria-hidden="true"
          className={className}
        >
          <circle cx="24" cy="24" r="22" fill="#16102d" stroke="#a78bfa" strokeWidth="2" />
          {/* Broadcast tower */}
          <path d="M24 18 L18.5 36 H29.5 L24 18 Z" stroke="#c4b5fd" strokeWidth="2" strokeLinejoin="round" />
          <line x1="20.5" y1="29" x2="27.5" y2="29" stroke="#a78bfa" strokeWidth="1.8" />
          <circle cx="24" cy="16" r="2.6" fill="#c4b5fd" />
          {/* Signal arcs */}
          <path d="M16 12.5 A11 11 0 0 0 16 23.5" stroke="#a78bfa" strokeWidth="2" strokeLinecap="round" />
          <path d="M32 12.5 A11 11 0 0 1 32 23.5" stroke="#a78bfa" strokeWidth="2" strokeLinecap="round" />
          <path d="M12.5 9.5 A16 16 0 0 0 12.5 26.5" stroke="#7c3aed" strokeWidth="1.8" strokeLinecap="round" />
          <path d="M35.5 9.5 A16 16 0 0 1 35.5 26.5" stroke="#7c3aed" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      );

    case 'off':
    default:
      return (
        <svg
          width={size}
          height={size}
          viewBox="0 0 48 48"
          fill="none"
          aria-hidden="true"
          className={className}
        >
          <circle cx="24" cy="24" r="22" fill="#11131c" stroke="#64748b" strokeWidth="2" />
          <path
            d="M17 15.5 A10.5 10.5 0 1 0 31 15.5"
            stroke="#94a3b8"
            strokeWidth="2.6"
            strokeLinecap="round"
          />
          <line x1="24" y1="11" x2="24" y2="23" stroke="#94a3b8" strokeWidth="2.6" strokeLinecap="round" />
          <line x1="13" y1="35" x2="35" y2="13" stroke="#ef4444" strokeWidth="2.2" strokeLinecap="round" />
        </svg>
      );
  }
};
