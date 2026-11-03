import type { WhitelistedParam } from './types.ts'

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
export const LIMITS: Record<WhitelistedParam, ParamLimits> = {
  kGSyn: { min: 0.02, max: 0.6 },
  kDetox: { min: 0.5, max: 8 },
  kMClear: { min: 0.02, max: 1.5 },
  kPhase2Vmax: { min: 0.5, max: 10 },
}

export interface ClampResult {
  readonly param: WhitelistedParam
  readonly value: number
  readonly clamped: boolean
}

export function clampAction(param: WhitelistedParam, value: number): ClampResult {
  if (!Number.isFinite(value)) {
    throw new Error(`clampAction: non-finite value for ${param}`)
  }
  const { min, max } = LIMITS[param]
  if (value < min) return { param, value: min, clamped: true }
  if (value > max) return { param, value: max, clamped: true }
  return { param, value, clamped: false }
}
