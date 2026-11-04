// Depth golden snapshots: SHA-256 over canonical depth-metrics JSON.
// Compare mode (default): npx vitest run src/swarm/depthGolden.test.ts
// Create missing fixtures once: WRITE_FIXTURES=1 npx vitest run src/swarm/depthGolden.test.ts
// Create-only: existing fixture files are never overwritten, only verified.
// Fixtures live in src/swarm/__fixtures__/ as depth-*.golden.json.
/// <reference types="node" />

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { COMPOUNDS, doseForMode } from '../model/compounds'
import { heartQtLoad, heartWashoutIndex } from '../model/heart'
import { kidneyCorticalLoad, kidneyRecoveryIndex } from '../model/kidney'
import { simulate } from '../model/simulate'
import type { DosingPattern, SimRequest, SimResult } from '../model/types'

const HERE = dirname(fileURLToPath(import.meta.url))
const FIXTURE_DIR = join(HERE, '__fixtures__')

interface DepthScenario {
  name: string
  doseMgPerKg: number
  horizonHours: number
  dosingPattern: DosingPattern
  coupleOrgans: boolean
}

interface DepthMetrics {
  corticalLoad: number
  corticalLoadNorm: number
  kidneyRecovery: number
  qtLoad: number
  qtLoadNorm: number
  qtTimeFrac: number
  washout: number
}

interface DepthFixture {
  scenario: {
    doseMgPerKg: number
    horizonHours: number
    dosingPattern: string
    coupleOrgans: boolean
  }
  sha256: string
  metrics: DepthMetrics
}

function toRequest(s: DepthScenario): SimRequest {
  return {
    compound: COMPOUNDS.acetaminophen,
    doseMgPerKg: s.doseMgPerKg,
    weightKg: 70,
    horizonHours: s.horizonHours,
    dosingPattern: s.dosingPattern,
    seed: 42,
    coupleOrgans: s.coupleOrgans,
  }
}

function depthMetrics(r: SimResult): DepthMetrics {
  const cortical = kidneyCorticalLoad(r)
  const qt = heartQtLoad(r)
  return {
    corticalLoad: cortical.load,
    corticalLoadNorm: cortical.loadNorm,
    kidneyRecovery: kidneyRecoveryIndex(r),
    qtLoad: qt.load,
    qtLoadNorm: qt.loadNorm,
    qtTimeFrac: qt.timeFrac,
    washout: heartWashoutIndex(r),
  }
}

function metricsHash(m: DepthMetrics): string {
  return createHash('sha256').update(JSON.stringify(m), 'utf8').digest('hex')
}

function fixturePath(name: string): string {
  return join(FIXTURE_DIR, `depth-${name}.golden.json`)
}

function writeFixture(s: DepthScenario, m: DepthMetrics): DepthFixture {
  const fixture: DepthFixture = {
    scenario: {
      doseMgPerKg: s.doseMgPerKg,
      horizonHours: s.horizonHours,
      dosingPattern: s.dosingPattern,
      coupleOrgans: s.coupleOrgans,
    },
    sha256: metricsHash(m),
    metrics: m,
  }
  mkdirSync(FIXTURE_DIR, { recursive: true })
  writeFileSync(fixturePath(s.name), JSON.stringify(fixture, null, 2) + '\n', 'utf8')
  return fixture
}

function readFixture(s: DepthScenario): DepthFixture {
  return JSON.parse(readFileSync(fixturePath(s.name), 'utf8')) as DepthFixture
}

const APAP = COMPOUNDS.acetaminophen

const SCENARIOS: DepthScenario[] = [
  {
    name: 'low-single-3d',
    doseMgPerKg: doseForMode(APAP, 'low'),
    horizonHours: 72,
    dosingPattern: 'single',
    coupleOrgans: false,
  },
  {
    name: 'high-single-3d',
    doseMgPerKg: doseForMode(APAP, 'high'),
    horizonHours: 72,
    dosingPattern: 'single',
    coupleOrgans: false,
  },
  {
    name: 'therapeutic-repeated-30d',
    doseMgPerKg: doseForMode(APAP, 'therapeutic'),
    horizonHours: 720,
    dosingPattern: 'repeated',
    coupleOrgans: false,
  },
  {
    name: 'high-repeated-7d',
    doseMgPerKg: doseForMode(APAP, 'high'),
    horizonHours: 168,
    dosingPattern: 'repeated',
    coupleOrgans: false,
  },
]

describe('depth golden snapshots', () => {
  for (const s of SCENARIOS) {
    it(`matches depth golden: ${s.name}`, { timeout: 120000 }, () => {
      const result = simulate(toRequest(s))
      const metrics = depthMetrics(result)
      for (const v of Object.values(metrics)) {
        expect(Number.isFinite(v)).toBe(true)
      }
      if (!existsSync(fixturePath(s.name))) {
        if (process.env.WRITE_FIXTURES !== '1') {
          throw new Error(
            `Missing fixture ${fixturePath(s.name)}. Create with WRITE_FIXTURES=1.`,
          )
        }
        const fixture = writeFixture(s, metrics)
        const reread = readFixture(s)
        expect(reread.sha256).toBe(fixture.sha256)
        expect(reread.metrics).toEqual(fixture.metrics)
        return
      }
      const fixture = readFixture(s)
      expect(metrics).toEqual(fixture.metrics)
      expect(metricsHash(metrics)).toBe(fixture.sha256)
    })
  }
})
