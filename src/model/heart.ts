/**
 * 0D cardiac compartment. Channel block is algebraic in plasma fold.
 * Injury integrates only while blockade sits above HERG_THRESHOLD.
 * Clearance is a small constant: the heart does not eliminate drug.
 * Parameters are illustrative, not fitted.
 */

export const HERG_THRESHOLD = 0.38
export const HEART_CLEARANCE = 0.003

const HERG_KM = 2.8
const K_CARDIAC = 0.42
const K_RECOVER = 0.004

export interface HeartState {
  herg: number
  damage: number
  clearanceRate: number
  metaboliteOutput: number
}

function clamp01(x: number): number {
  if (x < 0) return 0
  if (x > 1) return 1
  return x
}

export function hergBlock(fold: number, heartScale: number): number {
  return clamp01((heartScale * fold) / (HERG_KM + fold))
}

export function stepHeart(damage: number, fold: number, heartScale: number, dt: number): HeartState {
  const herg = hergBlock(fold, heartScale)
  const excess = Math.max(0, herg - HERG_THRESHOLD)
  const next = clamp01(damage + dt * (K_CARDIAC * excess * (1 - damage) - K_RECOVER * damage))
  return {
    herg,
    damage: next,
    clearanceRate: HEART_CLEARANCE,
    metaboliteOutput: 0,
  }
}
