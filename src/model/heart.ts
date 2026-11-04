/**
 * 0D cardiac compartment. Channel block is algebraic in plasma fold.
 * Injury integrates only while blockade sits above HERG_THRESHOLD.
 * Clearance is a small constant: the heart does not eliminate drug.
 * Parameters are illustrative, not fitted.
 */

import type { SimResult } from './types.ts'

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

export interface HeartQtLoad {
  /** Time-averaged suprathreshold blockade: avg of max(0, herg - threshold). */
  readonly load: number
  /** 0..1 form: load / (1 - HERG_THRESHOLD). */
  readonly loadNorm: number
  /** Fraction of prefix duration with herg above HERG_THRESHOLD. */
  readonly timeFrac: number
}

/** Clamp an optional tick to a valid recorded-frame index. */
function resolveTick(frameCount: number, uptoTick: number | undefined): number {
  const last = frameCount - 1
  if (uptoTick === undefined || !Number.isFinite(uptoTick)) return last
  return Math.max(0, Math.min(Math.floor(uptoTick), last))
}

/**
 * hERG-driven QT-style electrical load over recorded frames 0..uptoTick
 * (default: full run), separate from cumulative myocardial damage (which
 * stays in heartPeakDamage/heartFinalDamage). Blockade is acute and
 * reversible; damage is accumulated. Trapezoidal time average of
 * max(0, herg - HERG_THRESHOLD); timeFrac weights each segment by duration
 * when the segment midpoint exceeds the threshold. Pure derivation from
 * recorded frames; the simulation loop is untouched. Integrals are over
 * recorded (stride-sampled) frames, not every dt step.
 */
export function heartQtLoad(result: SimResult, uptoTick?: number): HeartQtLoad {
  const frames = result.frames
  const idx = resolveTick(frames.length, uptoTick)
  let integral = 0
  let above = 0
  for (let k = 0; k < idx; k++) {
    const dt = frames[k + 1].t - frames[k].t
    if (dt <= 0) continue
    const e0 = Math.max(0, frames[k].heartHerg - HERG_THRESHOLD)
    const e1 = Math.max(0, frames[k + 1].heartHerg - HERG_THRESHOLD)
    integral += ((e0 + e1) / 2) * dt
    if ((frames[k].heartHerg + frames[k + 1].heartHerg) / 2 > HERG_THRESHOLD) above += dt
  }
  const duration = frames[idx].t - frames[0].t
  const load = duration > 0 ? integral / duration : 0
  const timeFrac = duration > 0 ? above / duration : 0
  return { load, loadNorm: load / (1 - HERG_THRESHOLD), timeFrac }
}

/**
 * Cardiac washout index over recorded frames 0..uptoTick (default: full
 * run): (peakHerg - currentHerg) / peakHerg, where peakHerg is the max over
 * the prefix. Returns 1.0 when peak is 0: 1.0 means never blocked or fully
 * washed out, 0.0 means blockade still at peak. Bounded 0..1. Pure
 * derivation; the peak is over recorded (stride-sampled) frames, not every
 * dt step, so it need not equal heartPeakHerg tracked in-loop.
 */
export function heartWashoutIndex(result: SimResult, uptoTick?: number): number {
  const frames = result.frames
  const idx = resolveTick(frames.length, uptoTick)
  let peak = 0
  for (let k = 0; k <= idx; k++) {
    if (frames[k].heartHerg > peak) peak = frames[k].heartHerg
  }
  if (peak === 0) return 1
  return (peak - frames[idx].heartHerg) / peak
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
