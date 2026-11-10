import { describe, expect, it } from 'vitest'
import { judgeSystem } from '../model/systemVerdict'
import type { SimResult } from '../model/types'
import type { Verdict } from '../model/verdict'
import { brainFallbackDistress } from './organVitals'

const SAFE_LIVER: Verdict = {
  kind: 'Safe',
  label: 'SAFE',
  headline: 'Below injury thresholds',
  detail: 'synthetic test fixture',
  pathway: 'none',
}

/** Minimal engine result: every organ clear except the brain peak under test. */
function syntheticBrainResult(peakDamage: number): SimResult {
  return {
    brainPeakDamage: peakDamage,
    kidneyPeakMeanDamage: 0,
    kidneyFracInjured: 0,
    kidneyPeakMedulla: 0,
    heartPeakDamage: 0,
  } as SimResult
}

describe('brain fallback agrees with the engine verdict', () => {
  const cases: [number, string, string][] = [
    [0.079, 'BRAIN CLEAR', 'LOW'],
    [0.081, 'NEURO RISK', 'HIGH'],
    [0.749, 'NEURO RISK', 'HIGH'],
    [0.751, 'NEURO FAILURE', 'CRITICAL'],
  ]
  for (const [peakDamage, label, distress] of cases) {
    it(`peakDamage ${peakDamage} -> ${label} / ${distress}`, () => {
      const verdict = judgeSystem(syntheticBrainResult(peakDamage), SAFE_LIVER)
      expect(verdict.flags.find((f) => f.organ === 'brain')?.label).toBe(label)
      expect(
        brainFallbackDistress({
          tick: 0,
          tHours: 0,
          conc: 0.1,
          damage: peakDamage,
          peakConc: 0.1,
          peakDamage,
        }),
      ).toBe(distress)
    })
  }
})
