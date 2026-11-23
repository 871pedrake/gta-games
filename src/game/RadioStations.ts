import { RadioStationId } from './types';

export interface RadioTrack {
  title: string;
  artist: string;
  durationSec: number;
}

export interface RadioStationDef {
  id: RadioStationId;
  name: string;
  frequency: string;
  genre: string;
  colorHex: string;
  bpm: number;
  tracks: RadioTrack[];
}

export const RADIO_STATIONS: RadioStationDef[] = [
  {
    id: 'solara_fm',
    name: 'Solara FM',
    frequency: '104.5 FM',
    genre: 'Synthwave & Neon Pop',
    colorHex: '#22d3ee',
    bpm: 116,
    tracks: [
      { title: 'Maré Neon', artist: 'Mirage 84', durationSec: 32 },
      { title: 'Noite na Av. Atlântica', artist: 'Sunset Drive', durationSec: 36 },
      { title: 'Horizonte Elétrico', artist: 'Lazer Costa', durationSec: 30 },
    ],
  },
  {
    id: 'baia_beats',
    name: 'Baía Beats',
    frequency: '98.1 FM',
    genre: 'Eletrônica & Funk Groove',
    colorHex: '#ec4899',
    bpm: 124,
    tracks: [
      { title: 'Grave do Porto', artist: 'DJ Brisa', durationSec: 28 },
      { title: 'Onda Sintética', artist: 'Baía Crew', durationSec: 34 },
      { title: 'Pista Molhada', artist: 'SubLitoral', durationSec: 30 },
    ],
  },
  {
    id: 'litoral_rock',
    name: 'Litoral Rock',
    frequency: '91.7 FM',
    genre: 'Surf & Classic Rock',
    colorHex: '#f59e0b',
    bpm: 132,
    tracks: [
      { title: 'Asfalto Salgado', artist: 'Os Faróis', durationSec: 34 },
      { title: 'Vento do Píer', artist: 'Maré Alta', durationSec: 30 },
      { title: 'Motor V8', artist: 'Rota Costeira', durationSec: 32 },
    ],
  },
  {
    id: 'costa_chill',
    name: 'Costa Chill',
    frequency: '107.3 FM',
    genre: 'Lo-Fi & Bossa Lounge',
    colorHex: '#34d399',
    bpm: 86,
    tracks: [
      { title: 'Brisa das Palmeiras', artist: 'Trio Solara', durationSec: 38 },
      { title: 'Café no Píer', artist: 'Lua Mansa', durationSec: 34 },
      { title: 'Crepúsculo Dourado', artist: 'Mar Sereno', durationSec: 36 },
    ],
  },
  {
    id: 'noticias_bs',
    name: 'CBN Baía',
    frequency: '88.9 FM',
    genre: 'Notícias & Trânsito',
    colorHex: '#a78bfa',
    bpm: 104,
    tracks: [
      { title: 'Boletim do Trânsito — Orla & Porto', artist: 'Repórter Marina Luz', durationSec: 26 },
      { title: 'Plantão Policial — Centro Neon', artist: 'Central Baía Solara', durationSec: 24 },
      { title: 'Previsão Costeira & Marés', artist: 'Instituto Solara', durationSec: 26 },
    ],
  },
  {
    id: 'off',
    name: 'Rádio Desligada',
    frequency: 'OFF',
    genre: 'Sem sintonia',
    colorHex: '#64748b',
    bpm: 0,
    tracks: [
      { title: 'Som ambiente do motor', artist: 'Rádio desligada', durationSec: 9999 },
    ],
  },
];

export const DEFAULT_RADIO_STATION_ID: RadioStationId = 'solara_fm';

export function getRadioStation(id: RadioStationId): RadioStationDef {
  return RADIO_STATIONS.find((s) => s.id === id) ?? RADIO_STATIONS[0];
}

export function getRadioStationIndex(id: RadioStationId): number {
  const idx = RADIO_STATIONS.findIndex((s) => s.id === id);
  return idx >= 0 ? idx : 0;
}

export function getNextRadioStationId(currentId: RadioStationId, dir: 1 | -1): RadioStationId {
  const idx = getRadioStationIndex(currentId);
  const next = (idx + dir + RADIO_STATIONS.length) % RADIO_STATIONS.length;
  return RADIO_STATIONS[next].id;
}
