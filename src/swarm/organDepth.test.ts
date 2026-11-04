import { describe, expect, it } from 'vitest'
import { COMPOUNDS, customToCompound, DEFAULT_CUSTOM, doseForMode } from '../model/compounds'
import { heartQtLoad, heartWashoutIndex } from '../model/heart'
import { kidneyCorticalLoad, kidneyRecoveryIndex } from '../model/kidney'
import { simulate } from '../model/simulate'
import type { DosingPattern, SimRequest, SimResult } from '../model/types'
import { judge } from '../model/verdict'
import { simResultHash } from './canonical'
import { buildHeartPrompt, buildKidneyPrompt } from './organPrompts'
import {
  HeartVitalsSchema,
  KidneyVitalsSchema,
  heartFallbackDistress,
  kidneyFallbackDistress,
  summarizeHeart,
  summarizeKidney,
} from './organVitals'
import type { HeartVitals, KidneyVitals } from './organVitals'

function req(
  doseMgPerKg: number,
  horizonHours: number,
  dosingPattern: DosingPattern,
  compound = COMPOUNDS.acetaminophen,
): SimRequest {
  return {
    compound,
    doseMgPerKg,
    weightKg: 70,
    horizonHours,
    dosingPattern,
    seed: 42,
    coupleOrgans: false,
  }
}

function ladder(): SimResult[] {
  const apap = COMPOUNDS.acetaminophen
  return [0, 0.4, 1, 2, 4.8].map((mult) =>
    simulate(req(apap.typicalDoseMgPerKg * mult, 72, 'single')),
  )
}

/** Pairwise non-decreasing with room for floating-point noise at plateaus. */
function expectNonDecreasing(values: number[]): void {
  for (let i = 1; i < values.length; i++) {
    expect(values[i], `ladder[${i}]`).toBeGreaterThanOrEqual(values[i - 1] - 1e-9)
  }
}

/** Pairwise non-increasing with room for floating-point noise at plateaus. */
function expectNonIncreasing(values: number[]): void {
  for (let i = 1; i < values.length; i++) {
    expect(values[i], `ladder[${i}]`).toBeLessThanOrEqual(values[i - 1] + 1e-9)
  }
}

function expectFinite(values: number[]): void {
  for (const v of values) {
    expect(Number.isFinite(v)).toBe(true)
  }
}

describe('kidney depth', () => {
  it('cortical load rises with dose and stays bounded', { timeout: 120000 }, () => {
    const runs = ladder()
    const loads = runs.map((r) => kidneyCorticalLoad(r).load)
    const norms = runs.map((r) => kidneyCorticalLoad(r).loadNorm)
    expectNonDecreasing(loads)
    expectNonDecreasing(norms)
    expectFinite([...loads, ...norms])
    for (const v of loads) expect(v).toBeGreaterThanOrEqual(0)
    for (const v of norms) {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(1)
    }
    expect(loads[0]).toBe(0)
    expect(loads[loads.length - 1]).toBeGreaterThan(0)
  })

  it('recovery index falls with dose and is exact at the edges', { timeout: 120000 }, () => {
    const runs = ladder()
    const recs = runs.map((r) => kidneyRecoveryIndex(r))
    expectNonIncreasing(recs)
    expectFinite(recs)
    for (const v of recs) {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(1)
    }
    expect(recs[0]).toBe(1)
    const high = recs[recs.length - 1]
    expect(high).toBeGreaterThan(0)
    expect(high).toBeLessThan(1)
    expect(kidneyRecoveryIndex(runs[runs.length - 1], 0)).toBe(1)
  })

  it('prefix at the final tick equals the full-run value', { timeout: 120000 }, () => {
    const apap = COMPOUNDS.acetaminophen
    const result = simulate(req(doseForMode(apap, 'high'), 72, 'single'))
    const last = result.frames.length - 1
    expect(kidneyCorticalLoad(result, last)).toEqual(kidneyCorticalLoad(result))
    expect(kidneyRecoveryIndex(result, last)).toBe(kidneyRecoveryIndex(result))
    expect(kidneyCorticalLoad(result, 10 * last)).toEqual(kidneyCorticalLoad(result))
    expect(kidneyRecoveryIndex(result, -5)).toBe(kidneyRecoveryIndex(result, 0))
  })
})

describe('heart depth', () => {
  it('QT load rises with dose and stays bounded', { timeout: 120000 }, () => {
    const runs = ladder()
    const loads = runs.map((r) => heartQtLoad(r).load)
    const norms = runs.map((r) => heartQtLoad(r).loadNorm)
    const fracs = runs.map((r) => heartQtLoad(r).timeFrac)
    expectNonDecreasing(loads)
    expectNonDecreasing(norms)
    expectNonDecreasing(fracs)
    expectFinite([...loads, ...norms, ...fracs])
    for (const v of loads) expect(v).toBeGreaterThanOrEqual(0)
    for (const v of [...norms, ...fracs]) {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(1)
    }
    expect(loads[0]).toBe(0)
    expect(fracs[0]).toBe(0)
    expect(loads[loads.length - 1]).toBeGreaterThan(0)
    const lastFrac = fracs[fracs.length - 1]
    expect(lastFrac).toBeGreaterThan(0)
    expect(lastFrac).toBeLessThan(1)
  })

  it('washout is exact at peak and interior under slow clearance', { timeout: 120000 }, () => {
    const runs = ladder()
    const washes = runs.map((r) => heartWashoutIndex(r))
    expectNonIncreasing(washes)
    expectFinite(washes)
    for (const v of washes) {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(1)
    }
    expect(washes[0]).toBe(1)
    expect(washes[washes.length - 1]).toBeLessThan(1)
    const high = runs[runs.length - 1]
    let peakTick = 0
    for (let k = 1; k < high.frames.length; k++) {
      if (high.frames[k].heartHerg > high.frames[peakTick].heartHerg) peakTick = k
    }
    expect(heartWashoutIndex(high, peakTick)).toBe(0)
    const slow = simulate(
      req(240, 72, 'single', customToCompound({ ...DEFAULT_CUSTOM, halfLifeHours: 48 })),
    )
    const slowWash = heartWashoutIndex(slow)
    expect(slowWash).toBeGreaterThan(0)
    expect(slowWash).toBeLessThan(1)
    expect(slowWash).toBeLessThan(washes[washes.length - 1])
  })

  it('prefix at the final tick equals the full-run value', { timeout: 120000 }, () => {
    const apap = COMPOUNDS.acetaminophen
    const result = simulate(req(doseForMode(apap, 'high'), 72, 'single'))
    const last = result.frames.length - 1
    expect(heartQtLoad(result, last)).toEqual(heartQtLoad(result))
    expect(heartWashoutIndex(result, last)).toBe(heartWashoutIndex(result))
    expect(heartQtLoad(result, 10 * last)).toEqual(heartQtLoad(result))
    expect(heartWashoutIndex(result, -5)).toBe(heartWashoutIndex(result, 0))
  })
})

describe('depth plumbing', () => {
  it('is deterministic and never mutates the result', { timeout: 120000 }, () => {
    const apap = COMPOUNDS.acetaminophen
    const r = req(doseForMode(apap, 'high'), 72, 'single')
    const a = simulate(r)
    const b = simulate(req(doseForMode(apap, 'high'), 72, 'single'))
    const before = simResultHash(a)
    expect(kidneyCorticalLoad(a)).toEqual(kidneyCorticalLoad(b))
    expect(kidneyRecoveryIndex(a)).toBe(kidneyRecoveryIndex(b))
    expect(heartQtLoad(a)).toEqual(heartQtLoad(b))
    expect(heartWashoutIndex(a)).toBe(heartWashoutIndex(b))
    expect(simResultHash(a)).toBe(before)
    expect(judge(a).label).toBe(judge(b).label)
  })

  it('summaries validate and prompts show the new numbers', { timeout: 120000 }, () => {
    const apap = COMPOUNDS.acetaminophen
    const result = simulate(req(doseForMode(apap, 'high'), 72, 'single'))
    const last = result.frames.length - 1
    const kidney = summarizeKidney(result, last)
    const heart = summarizeHeart(result, last)
    expect(KidneyVitalsSchema.safeParse(kidney).success).toBe(true)
    expect(HeartVitalsSchema.safeParse(heart).success).toBe(true)
    expect(buildKidneyPrompt(kidney)).toContain(`corticalLoad=${kidney.corticalLoadNorm.toFixed(3)}`)
    expect(buildKidneyPrompt(kidney)).toContain(`recovery=${kidney.recoveryIndex.toFixed(3)}`)
    expect(buildHeartPrompt(heart)).toContain(`qtLoad=${heart.qtLoadNorm.toFixed(3)}`)
    expect(buildHeartPrompt(heart)).toContain(`qtTimeFrac=${heart.qtTimeFrac.toFixed(3)}`)
    expect(buildHeartPrompt(heart)).toContain(`washout=${heart.washoutIndex.toFixed(3)}`)
  })

  it('depth fields never change distress classification', () => {
    const kidneyBases: KidneyVitals[] = [
      { tick: 10, tHours: 5, medullaMean: 0.5, damageMean: 0.01, injuryFrac: 0, cortexMean: 1, corticalLoadNorm: 0, recoveryIndex: 1 },
      { tick: 10, tHours: 5, medullaMean: 2.5, damageMean: 0.01, injuryFrac: 0, cortexMean: 1, corticalLoadNorm: 0, recoveryIndex: 1 },
      { tick: 10, tHours: 5, medullaMean: 4, damageMean: 0.01, injuryFrac: 0.2, cortexMean: 1, corticalLoadNorm: 0, recoveryIndex: 1 },
      { tick: 10, tHours: 5, medullaMean: 8, damageMean: 0.01, injuryFrac: 0, cortexMean: 1, corticalLoadNorm: 0, recoveryIndex: 1 },
    ]
    for (const base of kidneyBases) {
      const expected = kidneyFallbackDistress(base)
      for (const corticalLoadNorm of [0, 0.5, 1]) {
        for (const recoveryIndex of [0, 0.5, 1]) {
          expect(kidneyFallbackDistress({ ...base, corticalLoadNorm, recoveryIndex })).toBe(expected)
        }
      }
    }
    const heartBases: HeartVitals[] = [
      { tick: 10, tHours: 5, herg: 0.05, damage: 0.01, qtLoadNorm: 0, qtTimeFrac: 0, washoutIndex: 1 },
      { tick: 10, tHours: 5, herg: 0.4, damage: 0.01, qtLoadNorm: 0, qtTimeFrac: 0, washoutIndex: 1 },
      { tick: 10, tHours: 5, herg: 0.6, damage: 0.01, qtLoadNorm: 0, qtTimeFrac: 0, washoutIndex: 1 },
      { tick: 10, tHours: 5, herg: 0.8, damage: 0.01, qtLoadNorm: 0, qtTimeFrac: 0, washoutIndex: 1 },
    ]
    for (const base of heartBases) {
      const expected = heartFallbackDistress(base)
      for (const qtLoadNorm of [0, 0.5, 1]) {
        for (const qtTimeFrac of [0, 0.5, 1]) {
          for (const washoutIndex of [0, 0.5, 1]) {
            expect(
              heartFallbackDistress({ ...base, qtLoadNorm, qtTimeFrac, washoutIndex }),
            ).toBe(expected)
          }
        }
      }
    }
  })
})
