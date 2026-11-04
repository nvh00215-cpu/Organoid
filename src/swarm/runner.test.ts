import { afterEach, describe, expect, it, vi } from 'vitest'
import { COMPOUNDS, doseForMode } from '../model/compounds'
import { simulate } from '../model/simulate'
import { judgeSystem } from '../model/systemVerdict'
import type { SimRequest } from '../model/types'
import { judge } from '../model/verdict'
import { CallBudget } from './budget'
import { canonicalResult, simResultHash } from './canonical'
import { LIMITS } from './clamp'
import { SwarmEngine } from './engine'
import { templateNarrative } from './orchestrator'
import { SwarmRunner, replayTranscript } from './runner'
import type { OrganTranscriptEntry, SystemTranscriptEntry } from './runner'

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

function stubSwarmFetch(
  replyFor: (organ: string) => unknown,
  narrativeText = 'Stub narrative.',
): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown, init?: { body?: unknown }) => {
      const endpoint = String(url)
      if (endpoint.endsWith('/api/narrative')) {
        return { ok: true, json: async () => ({ text: narrativeText }) }
      }
      const body = JSON.parse(String(init?.body)) as { organ: string }
      const reply = replyFor(body.organ)
      if (reply === null) {
        return { ok: false, json: async () => ({}) }
      }
      const text = typeof reply === 'string' ? reply : JSON.stringify(reply)
      return { ok: true, json: async () => ({ text }) }
    }),
  )
}


afterEach(() => {
  vi.unstubAllGlobals()
})

describe('SwarmRunner', () => {
  it('checkpoints on schedule', { timeout: 60000 }, async () => {
    stubSwarmFetch(() => ({ message: 'Steady.', distress: 'LOW' }))
    const total = simulate(lowSingle3d()).frames.length - 1
    const expected: number[] = []
    for (let tick = 20; tick < total; tick += 20) expected.push(tick)
    expected.push(total)
    const runner = new SwarmRunner(lowSingle3d(), { checkpointEvery: 20 })
    const run = await runner.run()
    const organTicks = run.transcript
      .filter((e): e is OrganTranscriptEntry => e.kind === 'organ' && e.organ === 'liver')
      .map((e) => e.tick)
    expect(organTicks).toEqual(expected)
    const systemTicks = run.transcript
      .filter((e): e is SystemTranscriptEntry => e.kind === 'system')
      .map((e) => e.tick)
    expect(systemTicks).toEqual(expected)
    const organs = run.transcript.filter((e) => e.kind === 'organ')
    expect(organs).toHaveLength(systemTicks.length * 3)
  })

  it('calls organ agents in parallel', { timeout: 60000 }, async () => {
    let inFlight = 0
    let maxInFlight = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        inFlight += 1
        maxInFlight = Math.max(maxInFlight, inFlight)
        await Promise.resolve()
        inFlight -= 1
        return {
          ok: true,
          json: async () => ({ text: JSON.stringify({ message: 'ok', distress: 'LOW' }) }),
        }
      }),
    )
    const runner = new SwarmRunner(lowSingle3d(), { checkpointEvery: 1000 })
    await runner.run()
    expect(maxInFlight).toBe(3)
  })

  it('survives invalid replies with fallbacks', { timeout: 60000 }, async () => {
    stubSwarmFetch(() => 'garbage{{{')
    const runner = new SwarmRunner(lowSingle3d(), { checkpointEvery: 1000 })
    const run = await runner.run()
    const organs = run.transcript.filter(
      (e): e is OrganTranscriptEntry => e.kind === 'organ',
    )
    expect(organs).toHaveLength(3)
    for (const entry of organs) {
      expect(entry.action).toBeNull()
      expect(entry.applied).toBe(false)
      expect(entry.message).toContain('unreachable')
    }
    expect(run.transcript.filter((e) => e.kind === 'system')).toHaveLength(1)
    expect(run.usage.calls).toBe(7)
  })

  it('clamps liver actions and ignores kidney/heart actions', { timeout: 60000 }, async () => {
    stubSwarmFetch((organ) => {
      if (organ === 'liver') {
        return { message: 'Boosting.', distress: 'HIGH', action: { param: 'kGSyn', value: 999 } }
      }
      return { message: 'Watching.', distress: 'LOW', action: { param: 'kDetox', value: 999 } }
    })
    const runner = new SwarmRunner(lowSingle3d(), { checkpointEvery: 1000 })
    const run = await runner.run()
    const byOrgan = (name: 'liver' | 'kidney' | 'heart') =>
      run.transcript.find((e): e is OrganTranscriptEntry => e.kind === 'organ' && e.organ === name)
    const liver = byOrgan('liver')
    expect(liver?.applied).toBe(true)
    expect(liver?.clamped).toBe(true)
    expect(liver?.action).toEqual({ param: 'kGSyn', value: LIMITS.kGSyn.max })
    const kidney = byOrgan('kidney')
    expect(kidney?.action).toEqual({ param: 'kDetox', value: LIMITS.kDetox.max })
    expect(kidney?.applied).toBe(false)
    expect(kidney?.clamped).toBe(false)
    const heart = byOrgan('heart')
    expect(heart?.applied).toBe(false)
  })

  it('reserves budget for the final checkpoint', { timeout: 60000 }, async () => {
    stubSwarmFetch(() => ({ message: 'ok', distress: 'LOW' }), 'Stub narrative.')
    const budget = new CallBudget(12, 4)
    const release = vi.spyOn(budget, 'releaseReserve')
    const runner = new SwarmRunner(lowSingle3d(), { checkpointEvery: 10, budget })
    const run = await runner.run()
    expect(release).toHaveBeenCalledTimes(1)
    expect(run.usage.calls).toBe(12)
    const systems = run.transcript.filter(
      (e): e is SystemTranscriptEntry => e.kind === 'system',
    )
    expect(systems.length).toBeGreaterThan(2)
    expect(systems[2]?.narrative).not.toBe('Stub narrative.')
    expect(systems[systems.length - 1]?.narrative).toBe('Stub narrative.')
  })

  it('emits JSON-safe transcripts that replay exactly', { timeout: 60000 }, async () => {
    stubSwarmFetch((organ) =>
      organ === 'liver'
        ? { message: 'Acting.', distress: 'HIGH', action: { param: 'kGSyn', value: 0.5 } }
        : { message: 'Watching.', distress: 'LOW' },
    )
    const request = lowSingle3d()
    const runner = new SwarmRunner(request, { checkpointEvery: 50 })
    const run = await runner.run()
    const json = JSON.stringify(run)
    expect(JSON.parse(json)).toStrictEqual(run)
    const lowered = json.toLowerCase()
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
    const replayed = replayTranscript(request, run.transcript)
    expect(canonicalResult(replayed)).toEqual(run.finalResult)
  })

  it('adds nothing when all agents fall back', { timeout: 60000 }, async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        throw new Error('must not fetch')
      }),
    )
    const request = lowSingle3d()
    const runner = new SwarmRunner(request, { budget: new CallBudget(0, 0) })
    const run = await runner.run()
    expect(run.usage.calls).toBe(0)
    expect(simResultHash(runner.getResult())).toBe(simResultHash(simulate(request)))
    const organsByTick = new Map<number, OrganTranscriptEntry[]>()
    for (const entry of run.transcript) {
      if (entry.kind !== 'organ') continue
      const list = organsByTick.get(entry.tick) ?? []
      list.push(entry)
      organsByTick.set(entry.tick, list)
    }
    for (const entry of run.transcript) {
      if (entry.kind !== 'system') continue
      const entries = organsByTick.get(entry.tick) ?? []
      const distressOf = (organ: 'liver' | 'kidney' | 'heart') =>
        entries.find((e) => e.organ === organ)?.distress ?? 'LOW'
      expect(entry.narrative).toBe(
        templateNarrative({
          label: entry.label,
          tHours: entry.tHours,
          liver: distressOf('liver'),
          kidney: distressOf('kidney'),
          heart: distressOf('heart'),
        }),
      )
    }
  })

  it('keeps the engine label when the narrative contradicts it', { timeout: 60000 }, async () => {
    stubSwarmFetch(
      () => ({ message: 'ok', distress: 'LOW' }),
      'Everything is perfectly healthy, no concerns at all.',
    )
    const NARRATIVE = 'Everything is perfectly healthy, no concerns at all.'
    const request = highSingle3d()
    const runner = new SwarmRunner(request, { checkpointEvery: 1000 })
    const run = await runner.run()
    const systems = run.transcript.filter(
      (e): e is SystemTranscriptEntry => e.kind === 'system',
    )
    // 3 necrosis-band crossings + final checkpoint.
    expect(systems).toHaveLength(4)
    // No actions in this stub, so a fresh engine reproduces runner state.
    for (const entry of systems) {
      const probe = new SwarmEngine(request)
      probe.runUntil(entry.tick)
      const partial = probe.getResult()
      const expected = judgeSystem(partial, judge(partial)).headline
      expect(entry.label).toBe(expected)
      expect(entry.narrative).toBe(NARRATIVE)
      expect(entry.narrative).not.toBe(entry.label)
      expect(entry.label).not.toContain('perfectly healthy')
    }
    const live = runner.getResult()
    const finalHeadline = judgeSystem(live, judge(live)).headline
    expect(systems[systems.length - 1]?.label).toBe(finalHeadline)
  })
})
