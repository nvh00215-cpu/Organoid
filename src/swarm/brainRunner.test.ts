/// <reference types="node" />

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { COMPOUNDS, doseForMode } from '../model/compounds'
import type { SimRequest } from '../model/types'
import { OrganRequestSchema } from '../server/organProxy'
import { brainFallbackDistress, summarizeBrain } from './organVitals'
import { SwarmRunner } from './runner'
import type { OrganTranscriptEntry, SystemTranscriptEntry, TranscriptEntry } from './runner'

const HERE = dirname(fileURLToPath(import.meta.url))

interface OffBaseline {
  request: SimRequest
  transcript: TranscriptEntry[]
  usage: { calls: number; approxTokens: number }
  narrativeBodies: unknown[]
}

function loadBaseline(): OffBaseline {
  const raw = readFileSync(join(HERE, '__fixtures__', 'runner-off-baseline.json'), 'utf8')
  return JSON.parse(raw) as OffBaseline
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

describe('BrainRunner', () => {
  it('matches the recorded off-mode baseline with includeBrain false', { timeout: 60000 }, async () => {
    const baseline = loadBaseline()
    const bodies: unknown[] = []
    stubSwarmFetch(() => ({ message: 'Steady.', distress: 'LOW' }), 'Stub narrative.', (b) =>
      bodies.push(b),
    )
    const runner = new SwarmRunner(lowSingle3d(), { checkpointEvery: 20, includeBrain: false })
    const run = await runner.run()
    expect(run.request).toStrictEqual(baseline.request)
    expect(run.transcript).toStrictEqual(baseline.transcript)
    expect(run.usage).toStrictEqual(baseline.usage)
    expect(bodies).toStrictEqual(baseline.narrativeBodies)
  })

  it('matches the recorded off-mode baseline with the option omitted', { timeout: 60000 }, async () => {
    const baseline = loadBaseline()
    const bodies: unknown[] = []
    stubSwarmFetch(() => ({ message: 'Steady.', distress: 'LOW' }), 'Stub narrative.', (b) =>
      bodies.push(b),
    )
    const runner = new SwarmRunner(lowSingle3d(), { checkpointEvery: 20 })
    const run = await runner.run()
    expect(run.transcript).toStrictEqual(baseline.transcript)
    expect(run.usage).toStrictEqual(baseline.usage)
    expect(bodies).toStrictEqual(baseline.narrativeBodies)
  })

  it('adds one advisory brain entry per checkpoint when on', { timeout: 60000 }, async () => {
    const baseline = loadBaseline()
    const bodies: unknown[] = []
    stubSwarmFetch(() => ({ message: 'Steady.', distress: 'LOW' }), 'Stub narrative.', (b) =>
      bodies.push(b),
    )
    const runner = new SwarmRunner(lowSingle3d(), { checkpointEvery: 20, includeBrain: true })
    const run = await runner.run()
    const systems = run.transcript.filter((e): e is SystemTranscriptEntry => e.kind === 'system')
    expect(systems).toHaveLength(
      baseline.transcript.filter((e) => e.kind === 'system').length,
    )
    const organsByTick = new Map<number, OrganTranscriptEntry[]>()
    for (const entry of run.transcript) {
      if (entry.kind !== 'organ') continue
      const list = organsByTick.get(entry.tick) ?? []
      list.push(entry)
      organsByTick.set(entry.tick, list)
    }
    expect(organsByTick.size).toBe(systems.length)
    for (const [, entries] of organsByTick) {
      expect(entries.map((e) => e.organ)).toEqual(['liver', 'kidney', 'heart', 'brain'])
      const brain = entries[3]
      expect(brain.message).toBe('Steady.')
      expect(brain.distress).toBe('LOW')
      expect(brain.action).toBeNull()
      expect(brain.applied).toBe(false)
      expect(brain.clamped).toBe(false)
    }
    expect(run.usage.calls).toBe(baseline.usage.calls + systems.length)
    for (const body of bodies) {
      expect(body).toMatchObject({ brain: 'LOW' })
    }
  })

  it('applies brain efflux actions and rejects other params', { timeout: 60000 }, async () => {
    stubSwarmFetch((organ) =>
      organ === 'brain'
        ? { message: 'Tuning.', distress: 'HIGH', action: { param: 'kBrainEfflux', value: 99 } }
        : { message: 'Steady.', distress: 'LOW' },
    )
    const runner = new SwarmRunner(lowSingle3d(), { checkpointEvery: 1000, includeBrain: true })
    const run = await runner.run()
    const brains = run.transcript.filter(
      (e): e is OrganTranscriptEntry => e.kind === 'organ' && e.organ === 'brain',
    )
    expect(brains).toHaveLength(1)
    // 99 clamps to the 2.0 bound, then to one 0.1 rate step above neutral.
    expect(brains[0].action).toEqual({ param: 'kBrainEfflux', value: 1 + 0.1 })
    expect(brains[0].applied).toBe(true)
    expect(brains[0].clamped).toBe(true)
    expect(brains[0].requested).toBe(99)
    stubSwarmFetch((organ) =>
      organ === 'brain'
        ? { message: 'Trying.', distress: 'HIGH', action: { param: 'kDetox', value: 5 } }
        : { message: 'Steady.', distress: 'LOW' },
    )
    const runner2 = new SwarmRunner(lowSingle3d(), { checkpointEvery: 1000, includeBrain: true })
    const run2 = await runner2.run()
    const brains2 = run2.transcript.filter(
      (e): e is OrganTranscriptEntry => e.kind === 'organ' && e.organ === 'brain',
    )
    expect(brains2).toHaveLength(1)
    expect(brains2[0].action).toBeNull()
    expect(brains2[0].applied).toBe(false)
    expect(brains2[0].clamped).toBe(false)
    expect(brains2[0].requested).toBeUndefined()
    expect('requested' in brains2[0]).toBe(false)
  })

  it('uses deterministic fallback distress when the brain call fails', { timeout: 60000 }, async () => {
    stubSwarmFetch(() => null)
    const runner = new SwarmRunner(lowSingle3d(), { checkpointEvery: 1000, includeBrain: true })
    const run = await runner.run()
    const brains = run.transcript.filter(
      (e): e is OrganTranscriptEntry => e.kind === 'organ' && e.organ === 'brain',
    )
    expect(brains).toHaveLength(1)
    expect(brains[0].message).toBe('Brain agent unreachable; holding current parameters.')
    expect(brains[0].action).toBeNull()
    expect(brains[0].applied).toBe(false)
    const result = runner.getResult()
    const expected = brainFallbackDistress(summarizeBrain(result, result.frames.length - 1))
    expect(brains[0].distress).toBe(expected)
  })

  it('keeps the final narrative live when the brain is on', { timeout: 60000 }, async () => {
    stubSwarmFetch(() => ({ message: 'ok', distress: 'LOW' }), 'Stub narrative.')
    const runner = new SwarmRunner(lowSingle3d(), { checkpointEvery: 5, includeBrain: true })
    const run = await runner.run()
    const systems = run.transcript.filter((e): e is SystemTranscriptEntry => e.kind === 'system')
    expect(systems.length).toBeGreaterThan(2)
    expect(systems[systems.length - 1]?.narrative).toBe('Stub narrative.')
    expect(run.usage.calls).toBeLessThanOrEqual(120)
    expect(run.usage.calls).toBeGreaterThan(111)
  })

  it('validates proxy brain requests with BrainVitalsSchema', () => {
    const valid = {
      tick: 40,
      tHours: 20,
      conc: 0.9,
      damage: 0.05,
      peakConc: 0.95,
      peakDamage: 0.06,
    }
    expect(OrganRequestSchema.safeParse({ organ: 'brain', state: valid }).success).toBe(true)
    expect(
      OrganRequestSchema.safeParse({ organ: 'brain', state: { ...valid, conc: Number.NaN } })
        .success,
    ).toBe(false)
    expect(
      OrganRequestSchema.safeParse({ organ: 'brain', state: { ...valid, peakDamage: 2 } }).success,
    ).toBe(false)
    expect(
      OrganRequestSchema.safeParse({
        organ: 'liver',
        state: {
          tick: 40,
          tHours: 20,
          gshPct: 30,
          necroticFraction: 0.2,
          plasma: 5,
          toxinOutput: 0.2,
          exposureIndex: 1.5,
          meanChronicLoad: 0.1,
        },
      }).success,
    ).toBe(true)
  })
})
