import type { SettableParam } from './types.ts'

export interface ParamLimits {
  readonly min: number
  readonly max: number
}

/**
 * Safe range per whitelisted parameter, anchored to the acetaminophen
 * baselines in model/compounds.ts (kGSyn 0.12, kDetox 3.4, kMClear 0.22,
 * kPhase2Vmax 3.2). Upper bounds keep the explicit-Euler step stable at
 * DT = 0.1 h; the min/max sweep test verifies every bound empirically.
 */
export const LIMITS: Record<SettableParam, ParamLimits> = {
  kGSyn: { min: 0.02, max: 0.6 },
  kDetox: { min: 0.5, max: 8 },
  kMClear: { min: 0.02, max: 1.5 },
  kPhase2Vmax: { min: 0.5, max: 10 },
  kBrainEfflux: { min: 0.5, max: 2 },
}

/**
 * Maximum change of a rate-limited parameter per engine.setParam call, i.e.
 * per checkpoint. kBrainEfflux moves at most 0.1, so a full-range move needs
 * more checkpoints than a run has: efflux upregulation is slow by
 * construction. Bounds and rate are ILLUSTRATIVE and uncalibrated.
 */
export const RATE_LIMITS: Partial<Record<SettableParam, number>> = {
  kBrainEfflux: 0.1,
}

export interface ClampResult {
  readonly param: SettableParam
  readonly value: number
  readonly clamped: boolean
}

export function clampAction(param: SettableParam, value: number): ClampResult {
  if (!Number.isFinite(value)) {
    throw new Error(`clampAction: non-finite value for ${param}`)
  }
  const { min, max } = LIMITS[param]
  if (value < min) return { param, value: min, clamped: true }
  if (value > max) return { param, value: max, clamped: true }
  return { param, value, clamped: false }
}
