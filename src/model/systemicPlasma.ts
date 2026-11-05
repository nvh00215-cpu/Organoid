import type { CompoundParams } from './types'
import { bolusDelta, stepPlasma } from './plasma'

/**
 * Shared blood compartment.
 *
 * Intrinsic clearance (half-life and saturable Phase II) stays in stepPlasma.
 * Organ clearance is an extra first-order loss, applied only when coupling is on.
 * With a zero organ clearance this returns the same value as stepPlasma.
 * Metabolite output is reported by each organ and is not added back into parent drug.
 */
/** Renal metabolite elimination rate (1/h) at full renal function. */
export const K_RENAL_ELIM = 0.3
/** Basal (non-renal) metabolite decay rate (1/h); the elimination floor. */
export const K_METABOLIC_DECAY = 0.1
/** Medullary retention gain; mirrored as K_RECIRC in kidney.ts (drift-guarded by test). */
export const K_RECIRC = 0.3

/**
 * One explicit-Euler step of the systemic metabolite pool:
 * next = M + dt * (production - k * M), clamped at 0, where
 * k = K_RENAL_ELIM * renalFunction + K_METABOLIC_DECAY and renalFunction
 * is 0..1 (1 = healthy). Pure; holds no state.
 *
 * Stability: the update is stable and non-oscillating iff DT * k < 1.
 * Worst case (renalFunction = 1): DT * (0.3 + 0.1) = 0.04, far inside.
 *
 * Ceiling: for fixed production P, M converges to M* = P / k <= P /
 * K_METABOLIC_DECAY and never exceeds max(M0, P / k) (Euler invariant while
 * DT * k <= 1). Kidney injury can only lower k toward the decay floor, so
 * the metabolite -> damage -> lower-elimination loop saturates at P /
 * K_METABOLIC_DECAY instead of running away. Feedback gain back into
 * production is bounded by 0.02 * K_RECIRC = 0.006 << K_METABOLIC_DECAY.
 */
export function stepMetabolitePool(
  pool: number,
  production: number,
  renalFunction: number,
  dt: number,
): number {
  const k = K_RENAL_ELIM * renalFunction + K_METABOLIC_DECAY
  const next = pool + dt * (production - k * pool)
  return next < 0 ? 0 : next
}

export function stepCoupledPlasma(
  c: number,
  compound: CompoundParams,
  dt: number,
  organClearance: number,
): number {
  const intrinsic = stepPlasma(c, compound, dt)
  if (organClearance <= 0) return intrinsic
  const next = intrinsic - dt * organClearance * c
  return next < 0 ? 0 : next
}

/** Plasma level of a typical dose, used so organs compare fold-over-label, not raw mg/L. */
export function typicalPlasma(compound: CompoundParams): number {
  return bolusDelta(compound.typicalDoseMgPerKg, compound)
}

export function exposureFold(plasma: number, typical: number): number {
  return plasma / Math.max(typical, 1e-6)
}
