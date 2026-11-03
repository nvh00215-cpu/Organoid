// Golden snapshots: SHA-256 of a canonical exact serialization of SimResult.
// Compare mode (default): npx vitest run src/swarm/golden.test.ts
// Regenerate: WRITE_FIXTURES=1 npx vitest run src/swarm/golden.test.ts
// Fixtures live in src/swarm/__fixtures__/ (hash + small readable summary).
/// <reference types="node" />
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { COMPOUNDS, doseForMode } from '../model/compounds'
import { simulate } from '../model/simulate'
import type {
  ChartPoint,
  CompoundParams,
  DosingPattern,
  FailureType,
  SimRequest,
  SimResult,
} from '../model/types'

const HERE = dirname(fileURLToPath(import.meta.url))
const FIXTURE_DIR = join(HERE, '__fixtures__')

interface GoldenScenario {
  name: string
  compound: CompoundParams
  doseMgPerKg: number
  horizonHours: number
  dosingPattern: DosingPattern
  seed: number
  coupleOrgans: boolean
}

function toRequest(s: GoldenScenario): SimRequest {
  return {
    compound: s.compound,
    doseMgPerKg: s.doseMgPerKg,
    weightKg: 70,
    horizonHours: s.horizonHours,
    dosingPattern: s.dosingPattern,
    seed: s.seed,
    coupleOrgans: s.coupleOrgans,
  }
}

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

function canonicalResult(r: SimResult): unknown {
  return {
    request: {
      compound: canonicalCompound(r.request.compound),
      doseMgPerKg: r.request.doseMgPerKg,
      weightKg: r.request.weightKg,
      horizonHours: r.request.horizonHours,
      dosingPattern: r.request.dosingPattern,
      seed: r.request.seed,
      coupleOrgans: r.request.coupleOrgans === true,
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

interface GoldenFixture {
  scenario: {
    compound: string
    doseMgPerKg: number
    horizonHours: number
    dosingPattern: string
    seed: number
    coupleOrgans: boolean
  }
  sha256: string
  summary: GoldenSummary
}

function fixturePath(name: string): string {
  return join(FIXTURE_DIR, `${name}.golden.json`)
}

function writeFixture(s: GoldenScenario, r: SimResult): GoldenFixture {
  const fixture: GoldenFixture = {
    scenario: {
      compound: s.compound.id,
      doseMgPerKg: s.doseMgPerKg,
      horizonHours: s.horizonHours,
      dosingPattern: s.dosingPattern,
      seed: s.seed,
      coupleOrgans: s.coupleOrgans,
    },
    sha256: simResultHash(r),
    summary: summarizeResult(r),
  }
  mkdirSync(FIXTURE_DIR, { recursive: true })
  writeFileSync(fixturePath(s.name), JSON.stringify(fixture, null, 2) + '\n', 'utf8')
  return fixture
}

function readFixture(s: GoldenScenario): GoldenFixture {
  const path = fixturePath(s.name)
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as GoldenFixture
  } catch {
    throw new Error(`Missing fixture ${path}. Regenerate with WRITE_FIXTURES=1.`)
  }
}

const APAP = COMPOUNDS.acetaminophen

const SCENARIOS: GoldenScenario[] = [
  {
    name: 'apap-high-single-3d',
    compound: APAP,
    doseMgPerKg: doseForMode(APAP, 'high'),
    horizonHours: 72,
    dosingPattern: 'single',
    seed: 42,
    coupleOrgans: false,
  },
  {
    name: 'apap-therapeutic-repeated-30d',
    compound: APAP,
    doseMgPerKg: doseForMode(APAP, 'therapeutic'),
    horizonHours: 720,
    dosingPattern: 'repeated',
    seed: 42,
    coupleOrgans: false,
  },
  {
    name: 'apap-low-single-3d',
    compound: APAP,
    doseMgPerKg: doseForMode(APAP, 'low'),
    horizonHours: 72,
    dosingPattern: 'single',
    seed: 42,
    coupleOrgans: false,
  },
  {
    name: 'apap-high-single-3d-coupled',
    compound: APAP,
    doseMgPerKg: doseForMode(APAP, 'high'),
    horizonHours: 72,
    dosingPattern: 'single',
    seed: 42,
    coupleOrgans: true,
  },
]

describe('golden snapshots', () => {
  for (const s of SCENARIOS) {
    it(`matches golden hash: ${s.name}`, { timeout: 120000 }, () => {
      const result = simulate(toRequest(s))
      const summary = summarizeResult(result)
      for (const v of [summary.meanFinalDamage, summary.peakPlasma, summary.fracNecrotic]) {
        expect(Number.isFinite(v)).toBe(true)
      }
      if (process.env.WRITE_FIXTURES === '1') {
        const fixture = writeFixture(s, result)
        const reread = readFixture(s)
        expect(reread.sha256).toBe(fixture.sha256)
        expect(reread.summary).toEqual(fixture.summary)
        return
      }
      const fixture = readFixture(s)
      expect(summary).toEqual(fixture.summary)
      expect(simResultHash(result)).toBe(fixture.sha256)
    })
  }
})
