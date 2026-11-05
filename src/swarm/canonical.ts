/// <reference types="node" />
// Canonical exact serialization + SHA-256 for SimResult (golden/resume tests).
import { createHash } from 'node:crypto'
import type { ChartPoint, CompoundParams, FailureType, SimResult } from '../model/types'

/** Canonical plain-object form with fixed key order; every number exact. */
function canonicalCompound(c: CompoundParams): unknown {
  return {
    id: c.id,
    name: c.name,
    typicalDoseMgPerKg: c.typicalDoseMgPerKg,
    lowMultiplier: c.lowMultiplier,
    highMultiplier: c.highMultiplier,
    halfLifeHours: c.halfLifeHours,
    bioavailability: c.bioavailability,
    vdLPerKg: c.vdLPerKg,
    kCyp: c.kCyp,
    km: c.km,
    kDetox: c.kDetox,
    kGUse: c.kGUse,
    kMClear: c.kMClear,
    kGSyn: c.kGSyn,
    kDmg: c.kDmg,
    kFlow: c.kFlow,
    kNeighbor: c.kNeighbor,
    kPhase2Vmax: c.kPhase2Vmax,
    kmPhase2: c.kmPhase2,
    metaboliteThreshold: c.metaboliteThreshold,
    kidneyScale: c.kidneyScale,
    heartScale: c.heartScale,
    brainScale: c.brainScale,
    blurb: c.blurb,
  }
}

function canonicalPoint(p: ChartPoint): unknown {
  return {
    t: p.t,
    plasma: p.plasma,
    zone1C: p.zone1C,
    zone3C: p.zone3C,
    zone1M: p.zone1M,
    zone3M: p.zone3M,
    zone1D: p.zone1D,
    zone3D: p.zone3D,
    meanDamage: p.meanDamage,
    meanChronic: p.meanChronic,
    meanGsh: p.meanGsh,
    zone3Gsh: p.zone3Gsh,
    exposureIndex: p.exposureIndex,
    exposureFold: p.exposureFold,
    kidneyMedulla: p.kidneyMedulla,
    kidneyDamage: p.kidneyDamage,
    heartHerg: p.heartHerg,
    heartDamage: p.heartDamage,
    brainConc: p.brainConc,
    brainDamage: p.brainDamage,
  }
}

export function canonicalResult(r: SimResult): unknown {
  return {
    request: {
      compound: canonicalCompound(r.request.compound),
      doseMgPerKg: r.request.doseMgPerKg,
      weightKg: r.request.weightKg,
      horizonHours: r.request.horizonHours,
      dosingPattern: r.request.dosingPattern,
      seed: r.request.seed,
      coupleOrgans: r.request.coupleOrgans === true,
      // NOTE: metaboliteLoop excluded: absent/false/undefined all hash byte-identically.
    },
    cols: r.cols,
    rows: r.rows,
    perfusion: Array.from(r.perfusion),
    frames: r.frames.map((f) => ({
      t: f.t,
      damage: Array.from(f.damage),
      zoneDamage: Array.from(f.zoneDamage),
      chronicLoad: Array.from(f.chronicLoad),
      kidneyCortex: Array.from(f.kidneyCortex),
      kidneyMedulla: Array.from(f.kidneyMedulla),
      kidneyDamage: Array.from(f.kidneyDamage),
      heartHerg: f.heartHerg,
      heartDamage: f.heartDamage,
      brainConc: f.brainConc,
      brainDamage: f.brainDamage,
    })),
    series: r.series.map(canonicalPoint),
    peakZone3Metabolite: r.peakZone3Metabolite,
    timeAboveThresholdHours: r.timeAboveThresholdHours,
    fracNecrotic: r.fracNecrotic,
    meanFinalDamage: r.meanFinalDamage,
    maxFinalDamage: r.maxFinalDamage,
    meanFinalZoneDamage: [...r.meanFinalZoneDamage],
    meanChronicLoad: r.meanChronicLoad,
    timeChronicHighHours: r.timeChronicHighHours,
    hottestIndex: r.hottestIndex,
    failedAt: r.failedAt,
    failureType: r.failureType,
    dt: r.dt,
    coupleOrgans: r.coupleOrgans,
    kidneyMeanDamage: r.kidneyMeanDamage,
    kidneyPeakMeanDamage: r.kidneyPeakMeanDamage,
    kidneyFracInjured: r.kidneyFracInjured,
    kidneyPeakMedulla: r.kidneyPeakMedulla,
    kidneyHottestIndex: r.kidneyHottestIndex,
    kidneyClearance: r.kidneyClearance,
    heartPeakHerg: r.heartPeakHerg,
    heartPeakDamage: r.heartPeakDamage,
    heartFinalDamage: r.heartFinalDamage,
    heartClearance: r.heartClearance,
    brainPeakConc: r.brainPeakConc,
    brainPeakDamage: r.brainPeakDamage,
    brainFinalDamage: r.brainFinalDamage,
    brainClearance: r.brainClearance,
    metaboliteOutput: r.metaboliteOutput,
    // NOTE: sysMetaboliteFinal/sysMetabolitePeak excluded: loop metrics are
    // pinned by dedicated loop goldens, keeping historical hashes identical.
    meanFinalGsh: r.meanFinalGsh,
    exposureIndex: r.exposureIndex,
  }
}

export function simResultHash(r: SimResult): string {
  const json = JSON.stringify(canonicalResult(r))
  return createHash('sha256').update(json, 'utf8').digest('hex')
}

export interface GoldenSummary {
  meanFinalDamage: number
  peakPlasma: number
  fracNecrotic: number
  frameCount: number
  failedAt: number | null
  failureType: FailureType
}

export function summarizeResult(r: SimResult): GoldenSummary {
  let peakPlasma = 0
  for (const p of r.series) {
    if (p.plasma > peakPlasma) peakPlasma = p.plasma
  }
  return {
    meanFinalDamage: r.meanFinalDamage,
    peakPlasma,
    fracNecrotic: r.fracNecrotic,
    frameCount: r.frames.length,
    failedAt: r.failedAt,
    failureType: r.failureType,
  }
}
