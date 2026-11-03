/**
 * Nephron ODE. Cortex and medulla sit inside every hex, the same way
 * Zone 1–3 sit inside every lobule. The grid is perfusion plus neighbor congestion.
 *
 * Secretion is Michaelis–Menten: Vmax * fold / (Km + fold).
 * Medulla concentrates the cortical filtrate by water reabsorption.
 * Parameters are illustrative, not fitted.
 */
import { NECROTIC } from './types'

export const MEDULLA_THRESHOLD = 3.6
/** Healthy-kidney contribution to plasma clearance (1/h) at mean perfusion of 1. */
export const K_KIDNEY_CLEARANCE = 0.004

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
    const targetM = CONC_FACTOR * kidneyScale * (1 + 0.85 * congestion) * nextC
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
