import { afterEach, describe, expect, it, vi } from 'vitest'
import { COMPOUNDS, doseForMode } from '../model/compounds'
import { simulate } from '../model/simulate'
import type { SimRequest } from '../model/types'
import { simResultHash } from './canonical'
import { SwarmRunner } from './runner'
import type { OrganTranscriptEntry } from './runner'

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

function stubSwarmFetch(replyFor: (organ: string) => unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown, init?: { body?: unknown }) => {
      const endpoint = String(url)
      if (endpoint.endsWith('/api/narrative')) {
        return { ok: true, json: async () => ({ text: 'Stub narrative.' }) }
      }
      const body = JSON.parse(String(init?.body)) as { organ: string }
      const reply = replyFor(body.organ)
      return { ok: true, json: async () => ({ text: JSON.stringify(reply) }) }
    }),
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('liver allow-list gate', () => {
  it('falls back on an out-of-whitelist param, unchanged from the restore point', { timeout: 60000 }, async () => {
    stubSwarmFetch((organ) =>
      organ === 'liver'
        ? { message: 'Boosting.', distress: 'HIGH', action: { param: 'kNope', value: 5 } }
        : { message: 'Steady.', distress: 'LOW' },
    )
    const runner = new SwarmRunner(lowSingle3d(), { checkpointEvery: 1000 })
    const run = await runner.run()
    const livers = run.transcript.filter(
      (e): e is OrganTranscriptEntry => e.kind === 'organ' && e.organ === 'liver',
    )
    expect(livers).toHaveLength(1)
    expect(livers[0].message).toContain('unreachable')
    expect(livers[0].action).toBeNull()
    expect(livers[0].applied).toBe(false)
    expect(livers[0].clamped).toBe(false)
  })

  it('rejects a liver reply that names the brain-only param', { timeout: 60000 }, async () => {
    stubSwarmFetch((organ) =>
      organ === 'liver'
        ? { message: 'Tuning brain.', distress: 'HIGH', action: { param: 'kBrainEfflux', value: 1.5 } }
        : { message: 'Steady.', distress: 'LOW' },
    )
    const request = lowSingle3d()
    const runner = new SwarmRunner(request, { checkpointEvery: 1000 })
    const run = await runner.run()
    const livers = run.transcript.filter(
      (e): e is OrganTranscriptEntry => e.kind === 'organ' && e.organ === 'liver',
    )
    expect(livers).toHaveLength(1)
    expect(livers[0].message).toBe('Tuning brain.')
    expect(livers[0].action).toEqual({ param: 'kBrainEfflux', value: 1.5 })
    expect(livers[0].applied).toBe(false)
    expect(livers[0].clamped).toBe(false)
    expect('requested' in livers[0]).toBe(false)
    expect(simResultHash(runner.getResult())).toBe(simResultHash(simulate(request)))
  })
})
