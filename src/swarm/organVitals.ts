import { GRID_COUNT, NECROTIC } from '../model/types.ts'
import { heartQtLoad, heartWashoutIndex } from '../model/heart.ts'
import { kidneyCorticalLoad, kidneyRecoveryIndex } from '../model/kidney.ts'
import type { SimResult } from '../model/types.ts'
import { z } from 'zod'
import type { Distress } from './types.ts'

/** Mirror of MEDULLA_THRESHOLD in model/kidney.ts (drift-guarded by test). */
export const KIDNEY_MEDULLA_THRESHOLD = 3.6
/** Mirror of HERG_THRESHOLD in model/heart.ts (drift-guarded by test). */
export const HEART_HERG_THRESHOLD = 0.38

/** Kidney distress bands. Injury cutoffs are percents; see prompt rubric. */
export const KIDNEY_BANDS = {
  criticalMedulla: 7.2,
  criticalInjuryPct: 25,
  highInjuryPct: 15,
  moderateMedulla: 2.0,
  moderateInjuryPct: 5,
  moderateDamage: 0.1,
} as const

/** Heart distress bands, as fractions matching the vitals. */
export const HEART_BANDS = {
  criticalDamage: 0.4,
  criticalHerg: 0.75,
  highDamage: 0.2,
  highHerg: 0.55,
  moderateDamage: 0.08,
} as const

export const KidneyVitalsSchema = z.object({
  tick: z.number().int().nonnegative(),
  tHours: z.number().finite().nonnegative(),
  medullaMean: z.number().finite().nonnegative(),
  damageMean: z.number().finite().min(0).max(1),
  injuryFrac: z.number().finite().min(0).max(1),
  cortexMean: z.number().finite().nonnegative(),
  corticalLoadNorm: z.number().finite().min(0).max(1),
  recoveryIndex: z.number().finite().min(0).max(1),
})
export type KidneyVitals = z.infer<typeof KidneyVitalsSchema>

export const HeartVitalsSchema = z.object({
  tick: z.number().int().nonnegative(),
  tHours: z.number().finite().nonnegative(),
  herg: z.number().finite().min(0).max(1),
  damage: z.number().finite().min(0).max(1),
  qtLoadNorm: z.number().finite().min(0).max(1),
  qtTimeFrac: z.number().finite().min(0).max(1),
  washoutIndex: z.number().finite().min(0).max(1),
})
export type HeartVitals = z.infer<typeof HeartVitalsSchema>

export function summarizeKidney(result: SimResult, frameIndex: number): KidneyVitals {
  const last = result.frames.length - 1
  const idx = Math.max(0, Math.min(frameIndex, last))
  const frame = result.frames[idx]
  const point = result.series[idx]
  let cortexSum = 0
  let injured = 0
  for (let i = 0; i < GRID_COUNT; i++) {
    cortexSum += frame.kidneyCortex[i]
    if (frame.kidneyDamage[i] > NECROTIC) injured++
  }
  return {
    tick: idx,
    tHours: frame.t,
    medullaMean: point.kidneyMedulla,
    damageMean: point.kidneyDamage,
    injuryFrac: injured / GRID_COUNT,
    cortexMean: cortexSum / GRID_COUNT,
    corticalLoadNorm: kidneyCorticalLoad(result, idx).loadNorm,
    recoveryIndex: kidneyRecoveryIndex(result, idx),
  }
}

export function summarizeHeart(result: SimResult, frameIndex: number): HeartVitals {
  const last = result.frames.length - 1
  const idx = Math.max(0, Math.min(frameIndex, last))
  const frame = result.frames[idx]
  return {
    tick: idx,
    tHours: frame.t,
    herg: frame.heartHerg,
    damage: frame.heartDamage,
    qtLoadNorm: heartQtLoad(result, idx).loadNorm,
    qtTimeFrac: heartQtLoad(result, idx).timeFrac,
    washoutIndex: heartWashoutIndex(result, idx),
  }
}

export function kidneyFallbackDistress(v: KidneyVitals): Distress {
  if (v.medullaMean > KIDNEY_BANDS.criticalMedulla || v.injuryFrac * 100 > KIDNEY_BANDS.criticalInjuryPct) {
    return 'CRITICAL'
  }
  if (v.medullaMean > KIDNEY_MEDULLA_THRESHOLD || v.injuryFrac * 100 > KIDNEY_BANDS.highInjuryPct) {
    return 'HIGH'
  }
  if (
    v.medullaMean > KIDNEY_BANDS.moderateMedulla ||
    v.injuryFrac * 100 > KIDNEY_BANDS.moderateInjuryPct ||
    v.damageMean > KIDNEY_BANDS.moderateDamage
  ) {
    return 'MODERATE'
  }
  return 'LOW'
}

export function heartFallbackDistress(v: HeartVitals): Distress {
  if (v.damage > HEART_BANDS.criticalDamage || v.herg > HEART_BANDS.criticalHerg) return 'CRITICAL'
  if (v.damage > HEART_BANDS.highDamage || v.herg > HEART_BANDS.highHerg) return 'HIGH'
  if (v.damage > HEART_BANDS.moderateDamage || v.herg > HEART_HERG_THRESHOLD) return 'MODERATE'
  return 'LOW'
}
