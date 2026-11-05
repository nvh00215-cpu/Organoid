/**
 * Nephron ODE. Cortex and medulla sit inside every hex, the same way
 * Zone 1–3 sit inside every lobule. The grid is perfusion plus neighbor congestion.
 *
 * Secretion is Michaelis–Menten: Vmax * fold / (Km + fold).
 * Medulla concentrates the cortical filtrate by water reabsorption.
 * Parameters are illustrative, not fitted.
 */
import { NECROTIC } from './types.ts'
import type { SimResult } from './types.ts'


export const MEDULLA_THRESHOLD = 3.6
/** Healthy-kidney contribution to plasma clearance (1/h) at mean perfusion of 1. */
export const K_KIDNEY_CLEARANCE = 0.004
/**
 * Cortical load threshold (filtrate concentration units). Rationale: on the
 * APAP single-3d ladder, hex-averaged cortical delivery peaks near 0.64 at
 * therapeutic dose, 1.22 at 2x typical, and 2.66 at high dose, so 1.0 sits
 * clearly above ordinary therapeutic handling while registering elevated
 * dosing. Per-hex values run hotter than the mean, so stressed regions
 * register earlier. Marks proximal secretion-overload stress. Illustrative,
 * like all constants here. The cortex is never injured by this model;
 * indices built on this threshold measure load/stress only, never damage.
 */
export const CORTEX_THRESHOLD = 1.0
/**
 * Medullary retention gain per unit of systemic metabolite pool. Mirrors
 * K_RECIRC in systemicPlasma.ts (drift-guarded by test); defined here so
 * kidney.ts needs no new module edge. Therapeutic-scale pools add a
 * fraction of a concentration unit to medullary target; overdose pools add
 * a few units, comparable to the congestion term. Illustrative.
 */
export const K_RECIRC = 0.3

const K_GFR = 0.55
const K_SEC_VMAX = 0.9
const K_SEC_KM = 2.2
const K_WASH = 1.8
const CONC_FACTOR = 3.1
const K_CONC = 0.22
const K_MED_CLEAR = 0.03
const K_DMG = 0.28
const K_REGEN = 0.004
const DRIVE_KM = 2.5

export interface KidneyFlux {
  clearanceRate: number
  metaboliteOutput: number
  meanCortex: number
  meanMedulla: number
  meanDamage: number
  fracInjured: number
}

function clamp01(x: number): number {
  if (x < 0) return 0
  if (x > 1) return 1
  return x
}

export interface KidneyCorticalLoad {
  /** Time- and hex-averaged cortical excess above CORTEX_THRESHOLD (>= 0). */
  readonly load: number
  /** Saturating 0..1 form: load / (load + CORTEX_THRESHOLD). */
  readonly loadNorm: number
}

/** Clamp an optional tick to a valid recorded-frame index. */
function resolveTick(frameCount: number, uptoTick: number | undefined): number {
  const last = frameCount - 1
  if (uptoTick === undefined || !Number.isFinite(uptoTick)) return last
  return Math.max(0, Math.min(Math.floor(uptoTick), last))
}

/** Hex-averaged excess above threshold in one cortical array. */
function meanExcess(values: Float32Array, threshold: number): number {
  if (values.length === 0) return 0
  let sum = 0
  for (let i = 0; i < values.length; i++) {
    const excess = values[i] - threshold
    if (excess > 0) sum += excess
  }
  return sum / values.length
}

/**
 * Cortical load/stress index over recorded frames 0..uptoTick (default: full
 * run). Trapezoidal time average of hex-averaged max(0, cortex - threshold).
 * The cortex is never injured by this model; this measures filtrate load and
 * proximal secretion-overload stress only, never damage. Pure derivation from
 * recorded frames; the simulation loop is untouched. Integrals are over
 * recorded (stride-sampled) frames, not every dt step.
 */
export function kidneyCorticalLoad(
  result: SimResult,
  uptoTick?: number,
): KidneyCorticalLoad {
  const frames = result.frames
  const idx = resolveTick(frames.length, uptoTick)
  let integral = 0
  for (let k = 0; k < idx; k++) {
    const dt = frames[k + 1].t - frames[k].t
    if (dt <= 0) continue
    const e0 = meanExcess(frames[k].kidneyCortex, CORTEX_THRESHOLD)
    const e1 = meanExcess(frames[k + 1].kidneyCortex, CORTEX_THRESHOLD)
    integral += ((e0 + e1) / 2) * dt
  }
  const duration = frames[idx].t - frames[0].t
  const load = duration > 0 ? integral / duration : 0
  return { load, loadNorm: load / (load + CORTEX_THRESHOLD) }
}

/**
 * Damage-weighted renal recovery index over recorded frames 0..uptoTick
 * (default: full run): sum_hex(peak_hex - current_hex) / sum_hex(peak_hex),
 * where peak_hex is the max damage over the prefix and current_hex is the
 * damage at uptoTick. Returns 1.0 when sum(peak) is 0: 1.0 means intact or
 * fully recovered, 0.0 means no recovery from peak. Bounded 0..1. Pure
 * derivation; peaks are over recorded (stride-sampled) frames, not every dt
 * step, so they need not equal in-loop aggregates such as
 * kidneyPeakMeanDamage.
 */
export function kidneyRecoveryIndex(result: SimResult, uptoTick?: number): number {
  const frames = result.frames
  const idx = resolveTick(frames.length, uptoTick)
  const n = frames[0].kidneyDamage.length
  let sumPeak = 0
  let sumRelief = 0
  for (let i = 0; i < n; i++) {
    let peak = 0
    for (let k = 0; k <= idx; k++) {
      const d = frames[k].kidneyDamage[i]
      if (d > peak) peak = d
    }
    sumPeak += peak
    sumRelief += peak - frames[idx].kidneyDamage[i]
  }
  if (sumPeak === 0) return 1
  return sumRelief / sumPeak
}

export function stepKidney(
  cortex: Float32Array,
  medulla: Float32Array,
  damage: Float32Array,
  perfusion: Float32Array,
  nbrs: number[][],
  stress: Float32Array,
  fold: number,
  kidneyScale: number,
  dt: number,
  sysMetabolite = 0,
): KidneyFlux {
  const n = damage.length
  const secretion = (K_SEC_VMAX * fold) / (K_SEC_KM + fold + 1e-9)

  for (let i = 0; i < n; i++) {
    const list = nbrs[i]
    let acc = 0
    for (const j of list) acc += Math.max(0, damage[j] - 0.4)
    stress[i] = acc / Math.max(1, list.length)
  }

  let sumC = 0
  let sumM = 0
  let sumD = 0
  let sumLocal = 0
  let injured = 0

  for (let i = 0; i < n; i++) {
    const congestion = stress[i]
    const gfrScale = 1 / (1 + 2.2 * congestion)
    const delivered = gfrScale * (K_GFR * perfusion[i] * fold + secretion)
    const c0 = cortex[i]
    const m0 = medulla[i]
    const d0 = damage[i]
    const nextC = Math.max(0, c0 + dt * K_WASH * (delivered - c0))
    // Explicitly guarded: a zero pool adds exactly 0 (bit-identical off-mode).
    const retention = sysMetabolite > 0 ? K_RECIRC * sysMetabolite : 0
    const targetM = CONC_FACTOR * kidneyScale * (1 + 0.85 * congestion) * nextC + retention
    const nextM = Math.max(0, m0 + dt * (K_CONC * (targetM - m0) - K_MED_CLEAR * m0))
    const excess = Math.max(0, nextM - MEDULLA_THRESHOLD)
    const drive = excess / (excess + DRIVE_KM)
    const nextD = clamp01(
      d0 + dt * (K_DMG * drive * (1 - d0) * (1 + congestion) - K_REGEN * d0),
    )
    cortex[i] = nextC
    medulla[i] = nextM
    damage[i] = nextD
    sumC += nextC
    sumM += nextM
    sumD += nextD
    sumLocal += perfusion[i] * (1 - 0.72 * nextD)
    if (nextD > NECROTIC) injured++
  }

  return {
    clearanceRate: K_KIDNEY_CLEARANCE * (sumLocal / n),
    metaboliteOutput: (sumM / n) * 0.02,
    meanCortex: sumC / n,
    meanMedulla: sumM / n,
    meanDamage: sumD / n,
    fracInjured: injured / n,
  }
}
