/// <reference types="node" />

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { COMPOUNDS, doseForMode } from '../model/compounds'
import { simulate } from '../model/simulate'
import type { CompoundParams, SimRequest } from '../model/types'
import { canonicalResult, simResultHash } from './canonical'
import { LIMITS, RATE_LIMITS } from './clamp'
import { SwarmEngine } from './engine'
import { BrainVitalsSchema } from './organVitals'
import { SwarmRunner, replayTranscript } from './runner'
import type { OrganTranscriptEntry, TranscriptEntry } from './runner'

const HERE = dirname(fileURLToPath(import.meta.url))

interface BrainOnBaseline {
  request: SimRequest
  transcript: TranscriptEntry[]
  usage: { calls: number; approxTokens: number }
  narrativeBodies: unknown[]
  resultHash: string
  brainPeaks: {
    brainPeakConc: number
    brainPeakDamage: number
    brainFinalDamage: number
    brainClearance: number
  }
}

function baselinePath(): string {
  return join(HERE, '__fixtures__', 'runner-brain-on-baseline.json')
}

function loadBaseline(): BrainOnBaseline {
  return JSON.parse(readFileSync(baselinePath(), 'utf8')) as BrainOnBaseline
}

function lowSingle3d(): SimRequest {
  const compound = COMPOUNDS.acetaminophen
  return {
    compound,
    doseMgPerKg: doseForMode(compound, 'low'),
    weightKg: 70,
    horizonHours: 72,
    dosingPattern: 'single',
    seed: 42,
    coupleOrgans: false,
  }
}

function highSingle3d(): SimRequest {
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

function withEfflux(request: SimRequest, efflux: number): SimRequest {
  const compound: CompoundParams = { ...request.compound, kBrainEfflux: efflux }
  return { ...request, compound }
}

function stubSwarmFetch(
  replyFor: (organ: string) => unknown,
  narrativeText = 'Stub narrative.',
  onNarrative?: (body: unknown) => void,
): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown, init?: { body?: unknown }) => {
      const endpoint = String(url)
      if (endpoint.endsWith('/api/narrative')) {
        if (init?.body !== undefined) onNarrative?.(JSON.parse(String(init.body)) as unknown)
        return { ok: true, json: async () => ({ text: narrativeText }) }
      }
      const body = JSON.parse(String(init?.body)) as { organ: string }
      const reply = replyFor(body.organ)
      const text = typeof reply === 'string' ? reply : JSON.stringify(reply)
      return { ok: true, json: async () => ({ text }) }
    }),
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('brain efflux action', () => {
  it('pins the illustrative bounds and rate', () => {
    expect(LIMITS.kBrainEfflux).toEqual({ min: 0.5, max: 2 })
    expect(RATE_LIMITS.kBrainEfflux).toBe(0.1)
  })

  it('accepts efflux in range and rejects out-of-range vitals', () => {
    const valid = {
      tick: 40,
      tHours: 20,
      conc: 0.9,
      damage: 0.05,
      peakConc: 0.95,
      peakDamage: 0.06,
    }
    expect(BrainVitalsSchema.safeParse(valid).success).toBe(true)
    expect(BrainVitalsSchema.safeParse({ ...valid, efflux: 1.5 }).success).toBe(true)
    expect(BrainVitalsSchema.safeParse({ ...valid, efflux: 99 }).success).toBe(false)
    expect(BrainVitalsSchema.safeParse({ ...valid, efflux: -1 }).success).toBe(false)
    expect(BrainVitalsSchema.safeParse({ ...valid, efflux: Number.NaN }).success).toBe(false)
  })

  it('reproduces the exact trajectory at the neutral default', { timeout: 60000 }, () => {
    const implicit = simulate(highSingle3d())
    const explicit = simulate(withEfflux(highSingle3d(), 1))
    expect(simResultHash(explicit)).toBe(simResultHash(implicit))
    expect(implicit.brainPeakDamage).toBeGreaterThan(0)
  })

  it('matches the recorded brain-on baseline with no actions', { timeout: 60000 }, async () => {
    const baseline = loadBaseline()
    const bodies: unknown[] = []
    stubSwarmFetch(() => ({ message: 'Steady.', distress: 'LOW' }), 'Stub narrative.', (b) =>
      bodies.push(b),
    )
    const runner = new SwarmRunner(lowSingle3d(), { checkpointEvery: 20, includeBrain: true })
    const run = await runner.run()
    expect(run.request).toStrictEqual(baseline.request)
    expect(run.transcript).toStrictEqual(baseline.transcript)
    expect(run.usage.calls).toBe(baseline.usage.calls)
    // Token estimate grows: the brain prompt now carries the action line and
    // readings. Call count, transcript, bodies and engine hash stay identical.
    expect(run.usage.approxTokens).toBeGreaterThan(baseline.usage.approxTokens)
    expect(bodies).toStrictEqual(baseline.narrativeBodies)
    const live = runner.getResult()
    expect(simResultHash(live)).toBe(baseline.resultHash)
    expect({
      brainPeakConc: live.brainPeakConc,
      brainPeakDamage: live.brainPeakDamage,
      brainFinalDamage: live.brainFinalDamage,
      brainClearance: live.brainClearance,
    }).toEqual(baseline.brainPeaks)
  })

  it('keeps the baseline fixture free of secrets and absolute paths', () => {
    const text = readFileSync(baselinePath(), 'utf8')
    const lowered = text.toLowerCase()
    for (const word of [
      'model_api_key',
      'meta_model',
      'meta_base_url',
      'bearer',
      'authorization',
      'output_text',
    ]) {
      expect(lowered).not.toContain(word)
    }
    for (const pat of ['C:\\', 'C:/', '/Users/', '/home/']) {
      expect(text).not.toContain(pat)
    }
  })

  it('clamps efflux at both bounds', () => {
    const up = new SwarmEngine(lowSingle3d())
    let v = 1
    for (let i = 0; i < 20; i++) v = up.setParam('kBrainEfflux', 99).appliedValue
    expect(v).toBe(2)
    expect(v).toBeLessThanOrEqual(LIMITS.kBrainEfflux.max)
    const down = new SwarmEngine(lowSingle3d())
    v = 1
    for (let i = 0; i < 20; i++) v = down.setParam('kBrainEfflux', -5).appliedValue
    expect(v).toBe(0.5)
    expect(v).toBeGreaterThanOrEqual(LIMITS.kBrainEfflux.min)
    const fresh = new SwarmEngine(lowSingle3d())
    expect(fresh.setParam('kBrainEfflux', 1.05)).toEqual({ appliedValue: 1.05, clamped: false })
    expect(fresh.setParam('kBrainEfflux', 99).clamped).toBe(true)
  })

  it('rate-limits each step around the current value', () => {
    const engine = new SwarmEngine(lowSingle3d())
    const step = RATE_LIMITS.kBrainEfflux ?? 0.1
    const first = engine.setParam('kBrainEfflux', 1.5)
    expect(first.appliedValue).toBe(1 + step)
    expect(first.clamped).toBe(true)
    const second = engine.setParam('kBrainEfflux', 1.5)
    expect(second.appliedValue).toBeCloseTo(1 + 2 * step, 12)
    expect(second.appliedValue).toBeGreaterThan(first.appliedValue)
    expect(second.clamped).toBe(true)
    const rest = engine.setParam('kBrainEfflux', second.appliedValue)
    expect(rest.appliedValue).toBe(second.appliedValue)
    expect(rest.clamped).toBe(false)
  })

  it('rejects unknown params in the engine and the runner', { timeout: 60000 }, async () => {
    const engine = new SwarmEngine(lowSingle3d())
    expect(() => engine.setParam('kNope', 1)).toThrow('not a whitelisted parameter')
    stubSwarmFetch((organ) =>
      organ === 'brain'
        ? { message: 'Trying.', distress: 'HIGH', action: { param: 'kDetox', value: 5 } }
        : { message: 'Steady.', distress: 'LOW' },
    )
    const runner = new SwarmRunner(lowSingle3d(), { checkpointEvery: 1000, includeBrain: true })
    const run = await runner.run()
    const brains = run.transcript.filter(
      (e): e is OrganTranscriptEntry => e.kind === 'organ' && e.organ === 'brain',
    )
    expect(brains).toHaveLength(1)
    expect(brains[0].action).toBeNull()
    expect(brains[0].applied).toBe(false)
    expect(brains[0].clamped).toBe(false)
    expect('requested' in brains[0]).toBe(false)
  })

  it('never raises brain peaks with higher efflux on a fixed seed', { timeout: 120000 }, () => {
    const base = highSingle3d()
    const low = simulate(withEfflux(base, 0.5))
    const mid = simulate(base)
    const high = simulate(withEfflux(base, 2))
    expect(mid.brainPeakDamage).toBeGreaterThan(0)
    expect(high.brainPeakConc).toBeLessThanOrEqual(mid.brainPeakConc)
    expect(mid.brainPeakConc).toBeLessThanOrEqual(low.brainPeakConc)
    expect(high.brainPeakDamage).toBeLessThanOrEqual(mid.brainPeakDamage)
    expect(mid.brainPeakDamage).toBeLessThanOrEqual(low.brainPeakDamage)
  })

  it('stays finite at both efflux bounds', { timeout: 120000 }, () => {
    for (const efflux of [LIMITS.kBrainEfflux.min, LIMITS.kBrainEfflux.max]) {
      const result = simulate(withEfflux(highSingle3d(), efflux))
      for (const field of [result.brainPeakConc, result.brainPeakDamage, result.brainFinalDamage]) {
        expect(Number.isFinite(field)).toBe(true)
      }
      for (let i = 0; i < result.frames.length; i += 10) {
        expect(Number.isFinite(result.frames[i].brainConc)).toBe(true)
        expect(Number.isFinite(result.frames[i].brainDamage)).toBe(true)
      }
    }
    const engine = new SwarmEngine(highSingle3d())
    const out = engine.setParam('kBrainEfflux', LIMITS.kBrainEfflux.min)
    expect(out.appliedValue).toBe(0.9)
    expect(out.clamped).toBe(true)
    engine.runToEnd()
    expect(Number.isFinite(engine.getResult().brainPeakDamage)).toBe(true)
  })

  it('records requested versus applied through the rate clamp', { timeout: 60000 }, async () => {
    stubSwarmFetch((organ) =>
      organ === 'brain'
        ? { message: 'Tuning.', distress: 'HIGH', action: { param: 'kBrainEfflux', value: 1.5 } }
        : { message: 'Steady.', distress: 'LOW' },
    )
    const runner = new SwarmRunner(lowSingle3d(), { checkpointEvery: 1000, includeBrain: true })
    const run = await runner.run()
    const brains = run.transcript.filter(
      (e): e is OrganTranscriptEntry => e.kind === 'organ' && e.organ === 'brain',
    )
    expect(brains).toHaveLength(1)
    expect(brains[0].action).toEqual({
      param: 'kBrainEfflux',
      value: 1 + (RATE_LIMITS.kBrainEfflux ?? 0.1),
    })
    expect(brains[0].applied).toBe(true)
    expect(brains[0].clamped).toBe(true)
    expect(brains[0].requested).toBe(1.5)
  })

  it('replays exactly with a brain action in the transcript', { timeout: 60000 }, async () => {
    stubSwarmFetch((organ) =>
      organ === 'brain'
        ? { message: 'Tuning.', distress: 'HIGH', action: { param: 'kBrainEfflux', value: 1.05 } }
        : { message: 'Steady.', distress: 'LOW' },
    )
    const request = lowSingle3d()
    const runner = new SwarmRunner(request, { checkpointEvery: 20, includeBrain: true })
    const run = await runner.run()
    const applied = run.transcript.filter(
      (e): e is OrganTranscriptEntry => e.kind === 'organ' && e.organ === 'brain' && e.applied,
    )
    expect(applied.length).toBeGreaterThan(0)
    const replayed = replayTranscript(request, run.transcript)
    expect(canonicalResult(replayed)).toEqual(run.finalResult)
  })

  it('resumes deterministically with a mid-run brain action', { timeout: 120000 }, () => {
    const request = highSingle3d()
    const clean = simulate(request)
    const n = 40
    expect(n).toBeLessThan(clean.frames.length - 1)
    const engine = new SwarmEngine(highSingle3d())
    expect(engine.runUntil(n)).toBe(n)
    const out = engine.setParam('kBrainEfflux', 1.1)
    expect(out.appliedValue).toBe(1.1)
    expect(out.clamped).toBe(false)
    engine.runToEnd()
    const modified = engine.getResult()
    for (let i = 0; i <= n; i++) {
      expect(modified.frames[i].brainConc).toBe(clean.frames[i].brainConc)
      expect(modified.frames[i].brainDamage).toBe(clean.frames[i].brainDamage)
    }
    for (let i = 0; i < clean.frames.length; i++) {
      expect(modified.series[i].plasma).toBe(clean.series[i].plasma)
    }
    expect(modified.frames[n + 1].brainConc).not.toBe(clean.frames[n + 1].brainConc)
    expect(simResultHash(modified)).not.toBe(simResultHash(clean))
  })
})
