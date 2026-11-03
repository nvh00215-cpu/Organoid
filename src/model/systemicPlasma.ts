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
