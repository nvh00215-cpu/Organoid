// Loop golden snapshots: SHA-256 over canonical loop-metrics JSON plus the
// engine headline (which must pass SystemHeadlineSchema).
// Compare mode (default): npx vitest run src/swarm/loopGolden.test.ts
// Create missing fixtures once: WRITE_FIXTURES=1 npx vitest run src/swarm/loopGolden.test.ts
// Create-only: existing fixture files are never overwritten, only verified.
// Fixtures live in src/swarm/__fixtures__/ as loop-*.golden.json.
/// <reference types="node" />

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { COMPOUNDS, doseForMode } from '../model/compounds'
import { simulate } from '../model/simulate'
import { judgeSystem } from '../model/systemVerdict'
import type { DosingPattern, SimRequest, SimResult } from '../model/types'
import { judge } from '../model/verdict'
import { SystemHeadlineSchema } from './orchestrator'

const HERE = dirname(fileURLToPath(import.meta.url))
const FIXTURE_DIR = join(HERE, '__fixtures__')

interface LoopScenario {
  name: string
  doseMgPerKg: number
  horizonHours: number
  dosingPattern: DosingPattern
}

interface LoopMetrics {
  sysMetaboliteFinal: number
  sysMetabolitePeak: number
}

interface LoopFixture {
  scenario: {
    doseMgPerKg: number
    horizonHours: number
    dosingPattern: string
    coupleOrgans: boolean
    metaboliteLoop: boolean
  }
  sha256: string
  metrics: LoopMetrics
  headline: string
}

function toRequest(s: LoopScenario): SimRequest {
  return {
    compound: COMPOUNDS.acetaminophen,
    doseMgPerKg: s.doseMgPerKg,
    weightKg: 70,
    horizonHours: s.horizonHours,
    dosingPattern: s.dosingPattern,
    seed: 42,
    coupleOrgans: false,
    metaboliteLoop: true,
  }
}

function loopMetrics(r: SimResult): LoopMetrics {
  return {
    sysMetaboliteFinal: r.sysMetaboliteFinal,
    sysMetabolitePeak: r.sysMetabolitePeak,
  }
}

function metricsHash(m: LoopMetrics): string {
  return createHash('sha256').update(JSON.stringify(m), 'utf8').digest('hex')
}

function fixturePath(name: string): string {
  return join(FIXTURE_DIR, `loop-${name}.golden.json`)
}

function writeFixture(s: LoopScenario, m: LoopMetrics, headline: string): LoopFixture {
  const fixture: LoopFixture = {
    scenario: {
      doseMgPerKg: s.doseMgPerKg,
      horizonHours: s.horizonHours,
      dosingPattern: s.dosingPattern,
      coupleOrgans: false,
      metaboliteLoop: true,
    },
    sha256: metricsHash(m),
    metrics: m,
    headline,
  }
  mkdirSync(FIXTURE_DIR, { recursive: true })
  writeFileSync(fixturePath(s.name), JSON.stringify(fixture, null, 2) + '\n', 'utf8')
  return fixture
}

function readFixture(s: LoopScenario): LoopFixture {
  return JSON.parse(readFileSync(fixturePath(s.name), 'utf8')) as LoopFixture
}

const APAP = COMPOUNDS.acetaminophen

const SCENARIOS: LoopScenario[] = [
  {
    name: 'low-single-3d',
    doseMgPerKg: doseForMode(APAP, 'low'),
    horizonHours: 72,
    dosingPattern: 'single',
  },
  {
    name: 'high-single-3d',
    doseMgPerKg: doseForMode(APAP, 'high'),
    horizonHours: 72,
    dosingPattern: 'single',
  },
  {
    name: 'therapeutic-repeated-30d',
    doseMgPerKg: doseForMode(APAP, 'therapeutic'),
    horizonHours: 720,
    dosingPattern: 'repeated',
  },
  {
    name: 'high-repeated-30d',
    doseMgPerKg: doseForMode(APAP, 'high'),
    horizonHours: 720,
    dosingPattern: 'repeated',
  },
]

describe('loop golden snapshots', () => {
  for (const s of SCENARIOS) {
    it(`matches loop golden: ${s.name}`, { timeout: 120000 }, () => {
      const result = simulate(toRequest(s))
      const metrics = loopMetrics(result)
      for (const v of Object.values(metrics)) {
        expect(Number.isFinite(v)).toBe(true)
      }
      const headline = judgeSystem(result, judge(result)).headline
      expect(SystemHeadlineSchema.safeParse(headline).success, headline).toBe(true)
      if (!existsSync(fixturePath(s.name))) {
        if (process.env.WRITE_FIXTURES !== '1') {
          throw new Error(
            `Missing fixture ${fixturePath(s.name)}. Create with WRITE_FIXTURES=1.`,
          )
        }
        const fixture = writeFixture(s, metrics, headline)
        const reread = readFixture(s)
        expect(reread.sha256).toBe(fixture.sha256)
        expect(reread.metrics).toEqual(fixture.metrics)
        expect(reread.headline).toBe(fixture.headline)
        return
      }
      const fixture = readFixture(s)
      expect(metrics).toEqual(fixture.metrics)
      expect(metricsHash(metrics)).toBe(fixture.sha256)
      expect(headline).toBe(fixture.headline)
    })
  }
})
