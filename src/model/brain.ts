/**
 * 0D brain compartment. brainConc tracks plasma fold through a slow barrier.
 * dB/dt = scale * kPerm * (fold - B) - efflux * kOut * B
 * Clearance back to plasma is zero. Parameters are illustrative, not fitted.
 */

export const NEURO_THRESHOLD = 0.85

const K_PERM = 0.14
const K_OUT = 0.02
const K_NEURO = 0.22
const K_RECOVER = 0.004

export interface BrainState {
  conc: number
  damage: number
  clearanceRate: number
  metaboliteOutput: number
}

function clamp01(x: number): number {
  if (x < 0) return 0
  if (x > 1) return 1
  return x
}

export function stepBrain(
  conc: number,
  damage: number,
  fold: number,
  brainScale: number,
  dt: number,
  efflux: number,
): BrainState {
  const perm = Math.max(0, brainScale) * K_PERM
  const nextC = Math.max(0, conc + dt * (perm * (fold - conc) - K_OUT * efflux * conc))
  const excess = Math.max(0, nextC - NEURO_THRESHOLD)
  const drive = excess / (excess + 1.2)
  const nextD = clamp01(damage + dt * (K_NEURO * drive * (1 - damage) - K_RECOVER * damage))
  return {
    conc: nextC,
    damage: nextD,
    clearanceRate: 0,
    metaboliteOutput: 0,
  }
}
