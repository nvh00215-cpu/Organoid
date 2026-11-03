import { describe, expect, it } from 'vitest'
import { COMPOUNDS, doseForMode } from '../model/compounds'
import { GRID_COUNT } from '../model/types'
import type { SimRequest, SimResult } from '../model/types'
import { LIMITS, clampAction } from './clamp'
import { SwarmEngine, setParam, summarize } from './engine'
import { MockLiverAgent, buildLiverPrompt, parseOrganReply } from './LiverAgent'
import { OrganReplySchema, SystemStateSchema, WHITELISTED_PARAMS } from './types'

function overdoseRequest(): SimRequest {
  const compound = COMPOUNDS.acetaminophen
  return {
    compound,
    doseMgPerKg: doseForMode(compound, 'high'),
    weightKg: 70,
    horizonHours: 72,
    dosingPattern: 'single',
    seed: 42,
  }
}

function expectFiniteNonNegative(values: number[]): void {
  for (const v of values) {
    expect(Number.isFinite(v)).toBe(true)
    expect(v).toBeGreaterThanOrEqual(0)
  }
}

function expectUnitRange(values: number[]): void {
  for (const v of values) {
    expect(Number.isFinite(v)).toBe(true)
    expect(v).toBeGreaterThanOrEqual(0)
    expect(v).toBeLessThanOrEqual(1)
  }
}

function checkFrameArray(name: string, arr: Float32Array, unit: boolean): void {
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i]
    if (!Number.isFinite(v) || v < 0 || (unit && v > 1)) {
      throw new Error(`${name}[${i}] out of range: ${v}`)
    }
  }
}

/** Full output-range audit for one SimResult. */
function checkResultInRange(r: SimResult): void {
  expect(r.frames.length).toBe(r.series.length)
  expect(r.frames[0].damage.length).toBe(GRID_COUNT)
  expect(r.frames[0].zoneDamage.length).toBe(GRID_COUNT * 3)
  expectFiniteNonNegative([
    r.peakZone3Metabolite,
    r.timeAboveThresholdHours,
    r.timeChronicHighHours,
    r.kidneyPeakMedulla,
    r.kidneyClearance,
    r.heartClearance,
    r.brainClearance,
    r.brainPeakConc,
    r.metaboliteOutput,
    r.exposureIndex,
  ])
  expectUnitRange([
    r.fracNecrotic,
    r.meanFinalDamage,
    r.maxFinalDamage,
    r.meanChronicLoad,
    r.meanFinalGsh,
    r.kidneyMeanDamage,
    r.kidneyPeakMeanDamage,
    r.kidneyFracInjured,
    r.heartPeakHerg,
    r.heartPeakDamage,
    r.heartFinalDamage,
    r.brainPeakDamage,
    r.brainFinalDamage,
    r.meanFinalZoneDamage[0],
    r.meanFinalZoneDamage[1],
    r.meanFinalZoneDamage[2],
  ])
  let prevExposure = 0
  for (let k = 0; k < r.frames.length; k++) {
    const f = r.frames[k]
    const p = r.series[k]
    checkFrameArray(`frames[${k}].damage`, f.damage, true)
    checkFrameArray(`frames[${k}].zoneDamage`, f.zoneDamage, true)
    checkFrameArray(`frames[${k}].chronicLoad`, f.chronicLoad, true)
    checkFrameArray(`frames[${k}].kidneyCortex`, f.kidneyCortex, false)
    checkFrameArray(`frames[${k}].kidneyMedulla`, f.kidneyMedulla, false)
    checkFrameArray(`frames[${k}].kidneyDamage`, f.kidneyDamage, true)
    expectFiniteNonNegative([
      f.heartHerg,
      f.heartDamage,
      f.brainConc,
      f.brainDamage,
      p.plasma,
      p.zone1C,
      p.zone3C,
      p.zone1M,
      p.zone3M,
      p.exposureFold,
      p.kidneyMedulla,
      p.brainConc,
      p.exposureIndex,
    ])
    expectUnitRange([
      f.heartHerg,
      f.heartDamage,
      f.brainDamage,
      p.zone1D,
      p.zone3D,
      p.meanDamage,
      p.meanChronic,
      p.kidneyDamage,
      p.heartHerg,
      p.heartDamage,
      p.brainDamage,
      p.meanGsh,
      p.zone3Gsh,
    ])
    expect(p.exposureIndex).toBeGreaterThanOrEqual(prevExposure - 1e-9)
    prevExposure = p.exposureIndex
  }
}

describe('organ swarm', () => {
  it('summarizes an overdose run within range', () => {
    const engine = new SwarmEngine(overdoseRequest())
    engine.runToEnd()
    const result = engine.getResult()
    checkResultInRange(result)
    const state = engine.summarize()
    SystemStateSchema.parse(state)
    expect(state.tick).toBe(result.frames.length - 1)
    // Overdose must actually injure the liver: GSH depleted or necrosis present.
    expect(state.gshPct < 100 || state.necroticFraction > 0).toBe(true)
    // Frame index clamps to the valid range.
    expect(summarize(result, 0).tick).toBe(0)
    expect(summarize(result, 1000000).tick).toBe(result.frames.length - 1)
  })

  it('pipes a mock reply through zod + clamp + setParam', async () => {
    const engine = new SwarmEngine(overdoseRequest())
    const before = engine.getRequest()
    const gshBefore = before.compound.kGSyn
    expect(engine.runUntil(40)).toBe(40)
    const state = engine.summarize()
    expect(buildLiverPrompt(state)).toContain(`tick=${state.tick}`)
    const agent = new MockLiverAgent()
    const reply = parseOrganReply(await agent.respond(state))
    const action = reply.action ?? { param: 'kGSyn' as const, value: LIMITS.kGSyn.max }
    const clamped = clampAction(action.param, action.value)
    const applied = engine.setParam(clamped.param, clamped.value)
    expect(applied.appliedValue).toBe(clamped.value)
    engine.runToEnd()
    checkResultInRange(engine.getResult())
    SystemStateSchema.parse(engine.summarize())
    // The original request object is never mutated.
    expect(before.compound.kGSyn).toBe(gshBefore)
  })

  it('clamps extreme values and rejects invalid input', () => {
    const req = overdoseRequest()
    expect(clampAction('kGSyn', 999)).toEqual({ param: 'kGSyn', value: LIMITS.kGSyn.max, clamped: true })
    expect(clampAction('kDetox', -5)).toEqual({ param: 'kDetox', value: LIMITS.kDetox.min, clamped: true })
    expect(clampAction('kMClear', 0.5)).toEqual({ param: 'kMClear', value: 0.5, clamped: false })
    const out = setParam(req, 'kPhase2Vmax', 1e9)
    expect(out.appliedValue).toBe(LIMITS.kPhase2Vmax.max)
    expect(out.clamped).toBe(true)
    expect(out.request.compound.kPhase2Vmax).toBe(LIMITS.kPhase2Vmax.max)
    expect(req.compound.kPhase2Vmax).toBe(COMPOUNDS.acetaminophen.kPhase2Vmax)
    expect(() => setParam(req, 'kCyp', 1)).toThrow()
    expect(() => setParam(req, 'doseMgPerKg', 1)).toThrow()
    expect(() => clampAction('kGSyn', Number.NaN)).toThrow()
    expect(() => OrganReplySchema.parse({ message: 'x'.repeat(281), distress: 'LOW' })).toThrow()
    expect(() => OrganReplySchema.parse({ message: '', distress: 'LOW' })).toThrow()
    expect(() => OrganReplySchema.parse({ message: 'ok', distress: 'PANIC' })).toThrow()
  })

  it('runs every whitelisted param at min and max with finite outputs', { timeout: 120000 }, () => {
    for (const param of WHITELISTED_PARAMS) {
      for (const bound of [LIMITS[param].min, LIMITS[param].max]) {
        const engine = new SwarmEngine(overdoseRequest())
        const applied = engine.setParam(param, bound)
        engine.runToEnd()
        expect(applied.appliedValue).toBe(bound)
        expect(applied.clamped).toBe(false)
        checkResultInRange(engine.getResult())
        SystemStateSchema.parse(engine.summarize())
      }
    }
  })
})
