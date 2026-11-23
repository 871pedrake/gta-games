import { LOD_FULL_DIST, LOD_LOW_DIST, LOD_MID_DIST } from './config';

export type LodLevel = 'full' | 'mid' | 'low';

export interface LodCounts {
  full: number;
  mid: number;
  low: number;
}

const LOD_FULL_SQ = LOD_FULL_DIST * LOD_FULL_DIST;
const LOD_MID_SQ = LOD_MID_DIST * LOD_MID_DIST;
const LOD_LOW_SQ = LOD_LOW_DIST * LOD_LOW_DIST;

/**
 * Classifica NPCs em 3 níveis de detalhe por distância ao jogador/câmera:
 * - Completo (<= 25m): animação integral de membros, cabeça e olhar
 * - Médio (25m–70m): pose simplificada de caminhada
 * - Baixo (70m–150m): silhueta estática para economizar CPU
 */
export class LODSystem {
  public readonly counts: LodCounts = { full: 0, mid: 0, low: 0 };

  public beginFrame(): void {
    this.counts.full = 0;
    this.counts.mid = 0;
    this.counts.low = 0;
  }

  public classify(distSq: number): LodLevel | null {
    if (distSq <= LOD_FULL_SQ) {
      this.counts.full++;
      return 'full';
    }
    if (distSq <= LOD_MID_SQ) {
      this.counts.mid++;
      return 'mid';
    }
    if (distSq <= LOD_LOW_SQ) {
      this.counts.low++;
      return 'low';
    }
    return null;
  }
}
