import type { CompoundId, CompoundParams, CustomOverrides } from './types'

export const COMPOUNDS: Record<Exclude<CompoundId, 'custom'>, CompoundParams> = {
  acetaminophen: {
    id: 'acetaminophen',
    name: 'Acetaminophen',
    typicalDoseMgPerKg: 15,
    lowMultiplier: 0.4,
    highMultiplier: 4.8,
    halfLifeHours: 2.5,
    bioavailability: 0.9,
    vdLPerKg: 0.95,
    kCyp: 0.85,
    km: 48,
    kDetox: 3.4,
    kGUse: 0.7,
    kMClear: 0.22,
    kGSyn: 0.12,
    kDmg: 0.48,
    kFlow: 2.4,
    kNeighbor: 0.22,
    kPhase2Vmax: 3.2,
    kmPhase2: 14,
    metaboliteThreshold: 0.12,
    kidneyScale: 1.1,
    heartScale: 0.9,
    brainScale: 0.55,
    blurb:
      'APAP-class: Phase II saturates at overdose, CYP bioactivation and GSH loss peak in Zone 3 (pericentral).',
  },
  ibuprofen: {
    id: 'ibuprofen',
    name: 'Ibuprofen',
    typicalDoseMgPerKg: 10,
    lowMultiplier: 0.5,
    highMultiplier: 6,
    halfLifeHours: 2.2,
    bioavailability: 0.8,
    vdLPerKg: 0.15,
    kCyp: 0.12,
    km: 40,
    kDetox: 3.5,
    kGUse: 0.08,
    kMClear: 0.5,
    kGSyn: 0.22,
    kDmg: 0.05,
    kFlow: 2.2,
    kNeighbor: 0.06,
    kPhase2Vmax: 5.5,
    kmPhase2: 20,
    metaboliteThreshold: 0.45,
    kidneyScale: 1.55,
    heartScale: 0.3,
    brainScale: 0.22,
    blurb:
      'NSAID-class proxy: lower reactive-metabolite burden. High dose may stress tissue without a classic centrilobular wave.',
  },
}

export const DEFAULT_CUSTOM: CustomOverrides = {
  name: 'New compound',
  halfLifeHours: 3,
  cypStrength: 1,
  metaboliteThreshold: 0.4,
  typicalDoseMgPerKg: 20,
}

export function customToCompound(overrides: CustomOverrides): CompoundParams {
  const cyp = Math.max(0.05, overrides.cypStrength)
  return {
    id: 'custom',
    name: overrides.name.trim() || 'New compound',
    typicalDoseMgPerKg: overrides.typicalDoseMgPerKg,
    lowMultiplier: 0.25,
    highMultiplier: 12,
    halfLifeHours: overrides.halfLifeHours,
    bioavailability: 0.9,
    vdLPerKg: 0.8,
    kCyp: 0.55 * cyp,
    km: 18,
    kDetox: 3.4,
    kGUse: 0.45 * cyp,
    kMClear: 0.22,
    kGSyn: 0.12,
    kDmg: 0.28 * (0.45 + 0.7 * cyp),
    kFlow: 2.3,
    kNeighbor: 0.18 + 0.12 * cyp,
    kPhase2Vmax: 3.4,
    kmPhase2: 14,
    metaboliteThreshold: overrides.metaboliteThreshold,
    kidneyScale: 0.75 + 0.35 * cyp,
    heartScale: 0.7,
    brainScale: 0.4,
    blurb:
      'User-specified CYP strength and metabolite threshold on the same 3-zone lobule scaffold.',
  }
}

export function doseForMode(
  compound: CompoundParams,
  mode: 'low' | 'therapeutic' | 'high',
): number {
  if (mode === 'low') return compound.typicalDoseMgPerKg * compound.lowMultiplier
  if (mode === 'high') return compound.typicalDoseMgPerKg * compound.highMultiplier
  return compound.typicalDoseMgPerKg
}
