// Golden snapshots: SHA-256 of a canonical exact serialization of SimResult.
// Compare mode (default): npx vitest run src/swarm/golden.test.ts
// Regenerate: WRITE_FIXTURES=1 npx vitest run src/swarm/golden.test.ts
// Fixtures live in src/swarm/__fixtures__/ (hash + small readable summary).
/// <reference types="node" />

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { COMPOUNDS, doseForMode } from '../model/compounds'
import { simulate } from '../model/simulate'
import type {
  CompoundParams,
  DosingPattern,
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

import { simResultHash, summarizeResult } from './canonical'
import type { GoldenSummary } from './canonical'

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

  it('golden hash is sensitive to input changes', { timeout: 120000 }, () => {
    const base = SCENARIOS[0]
    const perturbed = simulate(
      toRequest({ ...base, doseMgPerKg: base.doseMgPerKg * 1.000001 }),
    )
    expect(simResultHash(perturbed)).not.toBe(readFixture(base).sha256)
  })
})
