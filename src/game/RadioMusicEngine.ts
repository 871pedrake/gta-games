import { RadioStationId } from './types';

export type RadioStyle = 'synthwave' | 'electro_funk' | 'rock' | 'bossa_lofi' | 'news';

export interface RadioTrackComposition {
  id: string;
  bpm: number;
  swing: number; // 0..0.3 applied to odd 16th steps
  style: RadioStyle;
  /** 4 acordes (1 por compasso de 16 passos), em notas MIDI */
  chords: readonly [readonly number[], readonly number[], readonly number[], readonly number[]];
  /** Padrão de baixo de 16 passos por compasso (offset de semitom sobre a tônica do acorde, ou null para pausa) */
  bassPattern: readonly (number | null)[];
  /** Melodia principal em 64 passos (4 compassos) com notas MIDI exatas ou null para pausa */
  leadMelody: readonly (number | null)[];
  /** Padrão de arpejo/acompanhamento em 16 passos (índice no acorde, ou null) */
  arpPattern: readonly (number | null)[];
  /** Máscaras rítmicas de 16 passos */
  drums: {
    kick: readonly number[];
    snare: readonly number[];
    hat: readonly number[];
    openHat: readonly number[];
    perc: readonly number[];
  };
}

export function midiToHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

const SOLARA_TRACKS: readonly RadioTrackComposition[] = [
  // 0: Maré Neon (116 BPM, F menor Synthwave)
  {
    id: 'solara_mare_neon',
    bpm: 116,
    swing: 0,
    style: 'synthwave',
    chords: [
      [53, 60, 63, 68], // Fm7
      [49, 56, 60, 65], // Dbmaj7
      [56, 63, 67, 72], // Abmaj7
      [51, 58, 63, 67], // Eb
    ],
    bassPattern: [0, 12, 0, null, 0, 12, 0, 12, 0, 12, 0, null, 0, 12, 7, 12],
    leadMelody: [
      // Bar 1 (Fm7)
      77, null, null, 75, null, 72, null, null, 68, null, 70, null, 72, null, null, null,
      // Bar 2 (Dbmaj7)
      77, null, null, 75, null, 72, null, 75, 73, null, null, 72, 68, null, null, null,
      // Bar 3 (Abmaj7)
      80, null, null, 79, null, 75, null, null, 72, null, 75, null, 79, null, null, null,
      // Bar 4 (Eb)
      79, null, 77, null, 75, null, 72, null, 75, null, 70, null, 72, null, 75, null,
    ],
    arpPattern: [0, 1, 2, 3, 2, 1, 0, 2, 1, 2, 3, 2, 0, 1, 2, 3],
    drums: {
      kick: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0],
      snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
      hat: [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 1],
      openHat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0],
      perc: [0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0],
    },
  },
  // 1: Noite na Av. Atlântica (104 BPM, A menor Outrun Melódico)
  {
    id: 'solara_av_atlantica',
    bpm: 104,
    swing: 0,
    style: 'synthwave',
    chords: [
      [57, 64, 67, 71], // Am9
      [53, 60, 64, 69], // Fmaj7
      [50, 57, 60, 64], // Dm9
      [52, 59, 62, 67], // Em7
    ],
    bassPattern: [0, null, 0, null, 12, null, 0, null, 0, null, 0, null, 7, null, 12, null],
    leadMelody: [
      76, null, 79, null, 81, null, null, null, 79, null, 76, null, 72, null, null, null,
      74, null, 76, null, 77, null, null, 76, 72, null, 69, null, null, null, null, null,
      72, null, 74, null, 76, null, null, null, 74, null, 72, null, 69, null, 72, null,
      71, null, 74, null, 76, null, 79, null, 76, null, null, null, 74, null, null, null,
    ],
    arpPattern: [0, null, 2, null, 1, null, 3, null, 0, null, 2, null, 3, null, 1, null],
    drums: {
      kick: [1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 1, 0],
      snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1],
      hat: [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0],
      openHat: [0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0],
      perc: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0],
    },
  },
  // 2: Horizonte Elétrico (124 BPM, C menor Electro-Pop)
  {
    id: 'solara_horizonte_eletrico',
    bpm: 124,
    swing: 0,
    style: 'synthwave',
    chords: [
      [48, 55, 60, 63], // Cm
      [56, 60, 63, 68], // Ab
      [58, 62, 65, 70], // Bb
      [55, 58, 62, 67], // Gm
    ],
    bassPattern: [0, 0, 12, 0, 0, 0, 12, 0, 0, 0, 12, 0, 7, 10, 12, 7],
    leadMelody: [
      72, null, 75, null, 79, null, 75, null, 77, null, 75, null, 72, null, null, null,
      80, null, 79, null, 75, null, 72, null, 75, null, null, 74, 72, null, null, null,
      82, null, 79, null, 77, null, 74, null, 77, null, 79, null, 82, null, null, null,
      79, null, 77, null, 75, null, 74, null, 72, null, 74, null, 75, null, null, null,
    ],
    arpPattern: [0, 2, 1, 3, 0, 2, 1, 3, 0, 2, 3, 1, 2, 3, 1, 0],
    drums: {
      kick: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
      snare: [0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0],
      hat: [0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0],
      openHat: [0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0],
      perc: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1],
    },
  },
];

const BAIA_BEATS_TRACKS: readonly RadioTrackComposition[] = [
  // 0: Grave do Porto (124 BPM, C menor House/Groove)
  {
    id: 'baia_grave_porto',
    bpm: 124,
    swing: 0.06,
    style: 'electro_funk',
    chords: [
      [48, 55, 58, 63], // Cm7
      [53, 56, 60, 63], // Fm7
      [56, 60, 63, 67], // Abmaj7
      [55, 58, 62, 65], // Gm7
    ],
    bassPattern: [0, null, null, 0, null, null, 3, null, 7, null, 0, null, 10, null, 7, null],
    leadMelody: [
      72, null, null, 75, null, null, 79, null, null, null, 75, null, 74, null, 72, null,
      77, null, null, 75, null, null, 72, null, null, null, null, null, null, null, null, null,
      80, null, null, 79, null, null, 75, null, 72, null, 75, null, 79, null, null, null,
      79, null, 77, null, 75, null, 74, null, 72, null, null, 70, 72, null, null, null,
    ],
    arpPattern: [0, null, null, 2, null, null, 1, null, null, 3, null, null, 2, null, null, null],
    drums: {
      kick: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1],
      snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
      hat: [1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 1, 0],
      openHat: [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0],
      perc: [0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0],
    },
  },
  // 1: Onda Sintética (128 BPM, G menor Club Melódico)
  {
    id: 'baia_onda_sintetica',
    bpm: 128,
    swing: 0,
    style: 'electro_funk',
    chords: [
      [55, 58, 62, 65], // Gm7
      [51, 58, 62, 67], // Ebmaj7
      [53, 57, 60, 62], // F6
      [50, 57, 60, 65], // Dm7
    ],
    bassPattern: [0, null, 12, 0, null, 12, 0, null, 0, null, 12, 0, 7, 10, 12, null],
    leadMelody: [
      79, null, 77, null, 74, null, 70, null, 74, null, 77, null, 79, null, null, null,
      82, null, 79, null, 77, null, 74, null, 75, null, 74, null, 70, null, null, null,
      77, null, 74, null, 72, null, 69, null, 72, null, 74, null, 77, null, null, null,
      81, null, 79, null, 77, null, 74, null, 72, null, 74, null, null, null, null, null,
    ],
    arpPattern: [0, 1, 2, 3, 2, 1, 3, 2, 0, 1, 2, 3, 1, 2, 3, 1],
    drums: {
      kick: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
      snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0],
      hat: [0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1],
      openHat: [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0],
      perc: [0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1],
    },
  },
  // 2: Pista Molhada (118 BPM, D menor Deep Funk-Tech)
  {
    id: 'baia_pista_molhada',
    bpm: 118,
    swing: 0.14,
    style: 'electro_funk',
    chords: [
      [50, 57, 60, 64], // Dm9
      [46, 53, 56, 62], // Bb13
      [55, 58, 62, 65], // Gm7
      [45, 52, 55, 61], // A7
    ],
    bassPattern: [0, 0, null, 12, null, 3, 5, null, 0, null, 7, 10, 12, null, 7, null],
    leadMelody: [
      74, null, 77, null, 81, null, null, 79, 77, null, 74, null, 72, null, null, null,
      70, null, 74, null, 77, null, null, null, 74, null, 72, null, 69, null, null, null,
      79, null, 77, null, 74, null, 70, null, 74, null, 77, null, 79, null, null, null,
      81, null, 79, null, 76, null, 73, null, 69, null, null, null, null, null, null, null,
    ],
    arpPattern: [0, null, 1, 2, null, 3, null, 1, 0, null, 2, null, 3, 2, null, null],
    drums: {
      kick: [1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 1, 0],
      snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
      hat: [1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 0],
      openHat: [0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0],
      perc: [0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0],
    },
  },
];

const LITORAL_ROCK_TRACKS: readonly RadioTrackComposition[] = [
  // 0: Asfalto Salgado (132 BPM, E menor Surf Rock)
  {
    id: 'rock_asfalto_salgado',
    bpm: 132,
    swing: 0,
    style: 'rock',
    chords: [
      [52, 59, 64], // Em
      [55, 62, 67], // G5
      [57, 64, 69], // A5
      [59, 66, 71], // B5
    ],
    bassPattern: [0, 0, 0, 0, 3, 0, 7, 0, 0, 0, 0, 0, 7, 5, 3, 0],
    leadMelody: [
      64, 64, 67, 64, 71, 64, 72, 71, 67, 64, 67, 71, 72, 71, 67, null,
      67, 67, 71, 67, 74, 67, 76, 74, 71, 67, 71, 74, 76, 74, 71, null,
      69, 69, 72, 69, 76, 69, 77, 76, 72, 69, 72, 76, 74, 72, 69, null,
      71, 71, 75, 71, 78, 75, 71, 75, 79, null, 78, null, 76, null, null, null,
    ],
    arpPattern: [0, null, 1, null, 2, null, 0, null, 0, null, 1, null, 2, null, 1, null],
    drums: {
      kick: [1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 1, 0, 0, 0, 1, 0],
      snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1],
      hat: [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0],
      openHat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0],
      perc: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    },
  },
  // 1: Vento do Píer (122 BPM, A Mixolídio Classic Highway Rock)
  {
    id: 'rock_vento_pier',
    bpm: 122,
    swing: 0,
    style: 'rock',
    chords: [
      [57, 64, 69], // A5
      [55, 62, 67], // G5
      [50, 57, 62], // D5
      [57, 64, 69], // A5
    ],
    bassPattern: [0, null, 0, 0, 7, null, 0, 0, 0, null, 0, 0, 10, 7, 5, 0],
    leadMelody: [
      69, null, 73, 74, 76, null, 73, null, 74, null, 76, null, 79, null, 76, null,
      79, null, 76, 74, 71, null, 74, null, 71, null, 69, null, 67, null, null, null,
      74, null, 76, 78, 81, null, 78, null, 76, null, 74, null, 69, null, null, null,
      73, null, 76, null, 79, null, 76, 74, 73, null, 69, null, null, null, null, null,
    ],
    arpPattern: [0, 1, 2, null, 0, 1, 2, null, 0, 1, null, 2, 0, null, 1, null],
    drums: {
      kick: [1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 0, 0],
      snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
      hat: [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0],
      openHat: [0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0],
      perc: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    },
  },
  // 2: Motor V8 (138 BPM, D menor Hard Rock)
  {
    id: 'rock_motor_v8',
    bpm: 138,
    swing: 0,
    style: 'rock',
    chords: [
      [50, 57, 62], // D5
      [48, 55, 60], // C5
      [46, 53, 58], // Bb5
      [45, 52, 57], // A5
    ],
    bassPattern: [0, 0, 0, null, 0, 0, 0, null, 0, 0, 7, 0, 10, 7, 5, 3],
    leadMelody: [
      62, 62, 65, null, 69, 62, 70, null, 69, 67, 65, null, 62, null, null, null,
      60, 60, 64, null, 67, 60, 69, null, 67, 65, 64, null, 60, null, null, null,
      70, null, 69, null, 65, null, 62, null, 65, null, 69, null, 70, null, null, null,
      73, null, 72, null, 69, null, 64, null, 69, null, null, null, null, null, null, null,
    ],
    arpPattern: [0, 0, 1, 0, 2, 0, 1, 0, 0, 0, 1, 0, 2, 1, 0, null],
    drums: {
      kick: [1, 0, 1, 0, 0, 0, 1, 0, 1, 0, 1, 0, 0, 0, 1, 1],
      snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
      hat: [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0],
      openHat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0],
      perc: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    },
  },
];

const COSTA_CHILL_TRACKS: readonly RadioTrackComposition[] = [
  // 0: Brisa das Palmeiras (88 BPM, Bossa Nova Cmaj9 -> A7 -> Dm9 -> G13)
  {
    id: 'chill_brisa_palmeiras',
    bpm: 88,
    swing: 0.16,
    style: 'bossa_lofi',
    chords: [
      [48, 55, 59, 62, 64], // Cmaj9
      [45, 55, 59, 61, 65], // A7b13
      [50, 57, 60, 64], // Dm9
      [43, 53, 57, 59, 64], // G13
    ],
    bassPattern: [0, null, null, 7, null, null, 0, null, 0, null, null, 7, null, null, 5, null],
    leadMelody: [
      76, null, null, 74, null, 72, null, 71, 69, null, 71, null, 72, null, null, null,
      73, null, null, 76, null, 74, null, 73, 69, null, null, null, null, null, null, null,
      72, null, null, 74, null, 76, null, 74, 72, null, 69, null, 72, null, null, null,
      71, null, 72, null, 74, null, 76, null, 74, null, null, 71, 67, null, null, null,
    ],
    // Clave bossa nova no piano elétrico (passos 0, 3, 6, 10, 12)
    arpPattern: [1, null, null, 2, null, null, 3, null, null, null, 2, null, 1, null, null, null],
    drums: {
      kick: [1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1],
      snare: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      hat: [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0],
      openHat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      // Sidestick / Clave Bossa Nova clássica
      perc: [1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 0],
    },
  },
  // 1: Café no Píer (80 BPM, Lo-Fi Hip-Hop Swung em F maior)
  {
    id: 'chill_cafe_pier',
    bpm: 80,
    swing: 0.24,
    style: 'bossa_lofi',
    chords: [
      [53, 57, 60, 64], // Fmaj7
      [52, 55, 59, 62], // Em7
      [50, 57, 60, 64], // Dm9
      [48, 55, 59, 62], // Cmaj9
    ],
    bassPattern: [0, null, null, null, null, null, 7, null, 0, null, null, 5, null, null, 7, null],
    leadMelody: [
      76, null, null, null, 74, null, 72, null, 69, null, null, null, null, null, 72, null,
      71, null, null, null, 67, null, 71, null, 74, null, null, null, null, null, null, null,
      72, null, null, 74, 76, null, null, null, 74, null, 72, null, 69, null, null, null,
      71, null, null, 72, 74, null, 76, null, 72, null, null, null, null, null, null, null,
    ],
    arpPattern: [0, null, 1, null, null, 2, null, 3, null, null, 1, null, 2, null, null, null],
    drums: {
      kick: [1, 0, 0, 0, 0, 0, 0, 1, 1, 0, 1, 0, 0, 0, 0, 0],
      snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1],
      hat: [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0],
      openHat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0],
      perc: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0],
    },
  },
  // 2: Crepúsculo Dourado (92 BPM, Sunset Lounge Bbmaj7 -> Gm9 -> Cm9 -> F13)
  {
    id: 'chill_crepusculo_dourado',
    bpm: 92,
    swing: 0.14,
    style: 'bossa_lofi',
    chords: [
      [46, 53, 57, 62], // Bbmaj7
      [43, 53, 57, 58, 62], // Gm9
      [48, 55, 58, 62], // Cm9
      [41, 51, 55, 57, 62], // F13
    ],
    bassPattern: [0, null, null, 0, 7, null, 0, null, 0, null, 5, null, 7, null, 10, null],
    leadMelody: [
      74, null, null, 77, null, 74, null, 70, 69, null, 70, null, 74, null, null, null,
      77, null, null, 74, null, 70, null, 67, 70, null, null, null, null, null, null, null,
      75, null, null, 74, null, 72, null, 70, 67, null, 70, null, 74, null, null, null,
      72, null, 70, null, 69, null, 67, null, 65, null, null, null, null, null, null, null,
    ],
    arpPattern: [0, null, 2, null, 1, null, 3, null, null, 2, null, 1, 3, null, 2, null],
    drums: {
      kick: [1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 1, 0],
      snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
      hat: [1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 1, 0],
      openHat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0],
      perc: [0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0],
    },
  },
];

const NEWS_TRACKS: readonly RadioTrackComposition[] = [
  // 0: Boletim do Trânsito — Orla & Porto (104 BPM, D dórico)
  {
    id: 'news_transito_orla',
    bpm: 104,
    swing: 0,
    style: 'news',
    chords: [
      [50, 57, 60, 64], // Dm9
      [48, 55, 60, 64], // Cmaj7
      [46, 53, 57, 62], // Bbmaj7
      [45, 52, 57, 60], // Am7
    ],
    bassPattern: [0, null, null, null, 0, null, 7, null, 0, null, null, null, 7, null, 5, null],
    leadMelody: [
      74, null, 76, null, 77, null, null, null, 76, null, 74, null, 69, null, null, null,
      72, null, 74, null, 76, null, null, null, 74, null, 72, null, 67, null, null, null,
      70, null, 72, null, 74, null, null, null, 72, null, 70, null, 65, null, null, null,
      69, null, 72, null, 76, null, null, null, 74, null, null, null, null, null, null, null,
    ],
    arpPattern: [0, null, 2, null, 1, null, 3, null, 0, null, 2, null, 3, null, 1, null],
    drums: {
      kick: [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0],
      snare: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      hat: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
      openHat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      perc: [1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 1, 0],
    },
  },
  // 1: Plantão Policial — Centro Neon (112 BPM, C menor Urgente)
  {
    id: 'news_plantao_policial',
    bpm: 112,
    swing: 0,
    style: 'news',
    chords: [
      [48, 55, 60, 63], // Cm
      [48, 55, 60, 63], // Cm
      [53, 56, 60, 65], // Fm
      [55, 59, 62, 67], // G
    ],
    bassPattern: [0, null, 0, null, 0, null, 7, null, 0, null, 0, null, 10, null, 7, null],
    leadMelody: [
      72, null, null, null, 75, null, null, null, 79, null, null, null, 75, null, null, null,
      72, null, null, null, 74, null, null, null, 75, null, 74, null, 72, null, null, null,
      77, null, null, null, 75, null, null, null, 72, null, null, null, 77, null, null, null,
      79, null, null, null, 74, null, null, null, 71, null, null, null, 79, null, null, null,
    ],
    arpPattern: [0, 1, 2, 1, 0, 1, 2, 1, 0, 1, 2, 1, 0, 1, 2, 3],
    drums: {
      kick: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
      snare: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      hat: [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0],
      openHat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      perc: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0],
    },
  },
  // 2: Previsão Costeira & Marés (96 BPM, G maior Leve)
  {
    id: 'news_previsao_mares',
    bpm: 96,
    swing: 0,
    style: 'news',
    chords: [
      [55, 59, 62, 66], // Gmaj7
      [52, 55, 59, 62], // Em7
      [48, 55, 59, 64], // Cmaj7
      [50, 57, 60, 66], // D7sus4/D9
    ],
    bassPattern: [0, null, null, null, 7, null, null, null, 0, null, null, null, 7, null, 5, null],
    leadMelody: [
      79, null, 78, null, 74, null, null, null, 71, null, 74, null, 79, null, null, null,
      76, null, 74, null, 71, null, null, null, 67, null, 71, null, 74, null, null, null,
      76, null, 79, null, 83, null, null, null, 79, null, 76, null, 74, null, null, null,
      78, null, 76, null, 74, null, null, null, 71, null, null, null, null, null, null, null,
    ],
    arpPattern: [0, null, 1, null, 2, null, 3, null, 0, null, 2, null, 1, null, 3, null],
    drums: {
      kick: [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0],
      snare: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      hat: [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0],
      openHat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      perc: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    },
  },
];

const STATION_TRACK_MAP: Record<Exclude<RadioStationId, 'off'>, readonly RadioTrackComposition[]> = {
  solara_fm: SOLARA_TRACKS,
  baia_beats: BAIA_BEATS_TRACKS,
  litoral_rock: LITORAL_ROCK_TRACKS,
  costa_chill: COSTA_CHILL_TRACKS,
  noticias_bs: NEWS_TRACKS,
};

export function getRadioTrackComposition(
  stationId: RadioStationId,
  trackIndex = 0
): RadioTrackComposition | null {
  if (stationId === 'off') return null;
  const list = STATION_TRACK_MAP[stationId];
  if (!list || list.length === 0) return null;
  const idx = ((trackIndex % list.length) + list.length) % list.length;
  return list[idx];
}
