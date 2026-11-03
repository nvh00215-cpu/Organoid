import { describe, expect, it } from 'vitest'
import { COMPOUNDS, doseForMode } from '../model/compounds'
import { simulate } from '../model/simulate'
import { buildResult, createSimState, stepSim } from '../model/simRunner'
import type { ChartPoint, SimFrame, SimRequest, SimResult } from '../model/types'
import { simResultHash } from './canonical'
import { LIMITS } from './clamp'
import { SwarmEngine } from './engine'

function apapHighSingle3d(): SimRequest {
  const compound = COMPOUNDS.acetaminophen
  return {
    compound,
    doseMgPerKg: doseForMode(compound, 'high'),
    weightKg: 70,
    horizonHours: 72,
    dosingPattern: 'single',
    seed: 42,
    coupleOrgans: false,
  }
}

function chronicFailureRun(): SimRequest {
  const compound = COMPOUNDS.acetaminophen
  return {
    compound,
    doseMgPerKg: 32,
    weightKg: 70,
    horizonHours: 720,
    dosingPattern: 'repeated',
    seed: 42,
    coupleOrgans: false,
  }
}

function coupledRun(): SimRequest {
  const compound = COMPOUNDS.acetaminophen
  return {
    compound,
    doseMgPerKg: doseForMode(compound, 'high'),
    weightKg: 70,
    horizonHours: 72,
    dosingPattern: 'single',
    seed: 42,
    coupleOrgans: true,
  }
}

function repeatedRun(): SimRequest {
  const compound = COMPOUNDS.acetaminophen
  return {
    compound,
    doseMgPerKg: doseForMode(compound, 'therapeutic'),
    weightKg: 70,
    horizonHours: 96,
    dosingPattern: 'repeated',
    seed: 42,
    coupleOrgans: false,
  }
}

function runSegmented(request: SimRequest, segmentSize: number): SimResult {
  const state = createSimState(request)
  while (state.step < state.totalSteps && state.failedAt === null) {
    stepSim(state, segmentSize)
  }
  return buildResult(state)
}

function arraysEqual(a: Float32Array, b: Float32Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

function framesEqual(a: SimFrame, b: SimFrame): boolean {
  return (
    a.t === b.t &&
    arraysEqual(a.damage, b.damage) &&
    arraysEqual(a.zoneDamage, b.zoneDamage) &&
    arraysEqual(a.chronicLoad, b.chronicLoad) &&
    arraysEqual(a.kidneyCortex, b.kidneyCortex) &&
    arraysEqual(a.kidneyMedulla, b.kidneyMedulla) &&
    arraysEqual(a.kidneyDamage, b.kidneyDamage) &&
    a.heartHerg === b.heartHerg &&
    a.heartDamage === b.heartDamage &&
    a.brainConc === b.brainConc &&
    a.brainDamage === b.brainDamage
  )
}

function pointsEqual(a: ChartPoint, b: ChartPoint): boolean {
  return (
    a.t === b.t &&
    a.plasma === b.plasma &&
    a.zone1C === b.zone1C &&
    a.zone3C === b.zone3C &&
    a.zone1M === b.zone1M &&
    a.zone3M === b.zone3M &&
    a.zone1D === b.zone1D &&
    a.zone3D === b.zone3D &&
    a.meanDamage === b.meanDamage &&
    a.meanChronic === b.meanChronic &&
    a.meanGsh === b.meanGsh &&
    a.zone3Gsh === b.zone3Gsh &&
    a.exposureIndex === b.exposureIndex &&
    a.exposureFold === b.exposureFold &&
    a.kidneyMedulla === b.kidneyMedulla &&
    a.kidneyDamage === b.kidneyDamage &&
    a.heartHerg === b.heartHerg &&
    a.heartDamage === b.heartDamage &&
    a.brainConc === b.brainConc &&
    a.brainDamage === b.brainDamage
  )
}

function prefixEqual(a: SimResult, b: SimResult, lastIndex: number): boolean {
  for (let i = 0; i <= lastIndex; i++) {
    if (!framesEqual(a.frames[i], b.frames[i])) return false
    if (!pointsEqual(a.series[i], b.series[i])) return false
  }
  return true
}

describe('segment identity', () => {
  const cases: [string, () => SimRequest][] = [
    ['apap high single 3d', apapHighSingle3d],
    ['chronic failure run', chronicFailureRun],
    ['coupled organs run', coupledRun],
  ]
  for (const [name, makeRequest] of cases) {
    it(`1-step vs 50-step vs all-at-once: ${name}`, { timeout: 180000 }, () => {
      const reference = simResultHash(simulate(makeRequest()))
      expect(simResultHash(runSegmented(makeRequest(), 1))).toBe(reference)
      expect(simResultHash(runSegmented(makeRequest(), 50))).toBe(reference)
    })
  }
})

describe('mid-run setParam', () => {
  it('applies from the current tick forward only', { timeout: 120000 }, () => {
    const clean = simulate(apapHighSingle3d())
    const n = 40
    expect(n).toBeLessThan(clean.frames.length - 1)
    const engine = new SwarmEngine(apapHighSingle3d())
    expect(engine.runUntil(n)).toBe(n)
    const applied = engine.setParam('kGSyn', LIMITS.kGSyn.max)
    expect(applied.appliedValue).toBe(LIMITS.kGSyn.max)
    expect(applied.clamped).toBe(false)
    engine.runToEnd()
    const modified = engine.getResult()
    expect(prefixEqual(modified, clean, n)).toBe(true)
    const lastModified = modified.frames[modified.frames.length - 1]
    const lastClean = clean.frames[clean.frames.length - 1]
    expect(framesEqual(lastModified, lastClean)).toBe(false)
    expect(simResultHash(modified)).not.toBe(simResultHash(clean))
  })

  it('leaves scheduled dosing untouched', { timeout: 120000 }, () => {
    const clean = simulate(repeatedRun())
    let n = 0
    while (n + 1 < clean.frames.length && clean.frames[n + 1].t <= 20) n++
    expect(n).toBeGreaterThan(0)
    const engine = new SwarmEngine(repeatedRun())
    expect(engine.runUntil(n)).toBe(n)
    engine.setParam('kGSyn', LIMITS.kGSyn.max)
    engine.runToEnd()
    const modified = engine.getResult()
    expect(modified.frames.length).toBe(clean.frames.length)
    expect(prefixEqual(modified, clean, n)).toBe(true)
    for (let i = 0; i < clean.frames.length; i++) {
      expect(modified.series[i].plasma).toBe(clean.series[i].plasma)
      expect(modified.series[i].exposureFold).toBe(clean.series[i].exposureFold)
    }
    let diverged = false
    for (let i = n + 1; i < clean.frames.length; i++) {
      if (modified.series[i].meanGsh !== clean.series[i].meanGsh) diverged = true
    }
    expect(diverged).toBe(true)
  })
})

describe('fork independence', () => {
  it('diverged branches match clean runs and share history', { timeout: 120000 }, () => {
    const n = 40
    const engine = new SwarmEngine(apapHighSingle3d())
    expect(engine.runUntil(n)).toBe(n)
    const forked = engine.fork()
    engine.setParam('kGSyn', LIMITS.kGSyn.max)
    forked.setParam('kGSyn', LIMITS.kGSyn.min)
    engine.runToEnd()
    forked.runToEnd()
    const a = engine.getResult()
    const b = forked.getResult()

    const cleanA = new SwarmEngine(apapHighSingle3d())
    cleanA.runUntil(n)
    cleanA.setParam('kGSyn', LIMITS.kGSyn.max)
    cleanA.runToEnd()
    const cleanB = new SwarmEngine(apapHighSingle3d())
    cleanB.runUntil(n)
    cleanB.setParam('kGSyn', LIMITS.kGSyn.min)
    cleanB.runToEnd()

    expect(simResultHash(a)).toBe(simResultHash(cleanA.getResult()))
    expect(simResultHash(b)).toBe(simResultHash(cleanB.getResult()))
    expect(simResultHash(a)).not.toBe(simResultHash(b))
    expect(prefixEqual(a, b, n)).toBe(true)
  })
})
