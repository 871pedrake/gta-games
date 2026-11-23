/** Passo fixo de simulação física (120 Hz) */
export const FIXED_PHYSICS_DT = 1 / 120;

/** Limite máximo de substeps por frame para evitar espiral da morte */
export const MAX_SUBSTEPS_PER_FRAME = 4;

/** Limite máximo de dt bruto aceito por frame (proteção contra troca de aba) */
export const MAX_FRAME_DT = 0.05;

export interface FixedStepResult {
  substeps: number;
  accumulator: number;
  clampedDt: number;
}

/**
 * Executa a simulação física em passo fixo de 1/120 s (máximo 4 substeps por frame).
 * Limita o dt de entrada para resistir a pausas de aba sem explosões numéricas.
 */
export function runFixedSubsteps(
  dt: number,
  accumulator: number,
  stepFn: (subDt: number) => void
): FixedStepResult {
  const clampedDt = Number.isFinite(dt) && dt > 0 ? Math.min(dt, MAX_FRAME_DT) : 0;
  let nextAccum = (Number.isFinite(accumulator) && accumulator >= 0 ? accumulator : 0) + clampedDt;
  let substeps = 0;

  while (nextAccum >= FIXED_PHYSICS_DT && substeps < MAX_SUBSTEPS_PER_FRAME) {
    stepFn(FIXED_PHYSICS_DT);
    nextAccum -= FIXED_PHYSICS_DT;
    substeps++;
  }

  // Descarta excesso acumulado além do orçamento de 4 substeps (ex.: queda brusca de FPS)
  if (substeps >= MAX_SUBSTEPS_PER_FRAME && nextAccum > FIXED_PHYSICS_DT) {
    nextAccum = FIXED_PHYSICS_DT * 0.5;
  }

  return {
    substeps,
    accumulator: nextAccum,
    clampedDt,
  };
}
