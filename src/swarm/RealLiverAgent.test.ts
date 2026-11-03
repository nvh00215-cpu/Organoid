import { afterEach, describe, expect, it, vi } from 'vitest'
import { LIMITS } from './clamp'
import { RealLiverAgent } from './RealLiverAgent'
import type { SystemState } from './types'

function testState(): SystemState {
  return {
    tick: 40,
    tHours: 20,
    gshPct: 30,
    necroticFraction: 0.2,
    plasma: 5,
    toxinOutput: 0.2,
    exposureIndex: 1.5,
    meanChronicLoad: 0.1,
  }
}

function stubFetch(texts: (string | null)[]): void {
  const queue = [...texts]
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      const text = queue.shift() ?? null
      if (text === null) {
        return { ok: false, json: async () => ({}) }
      }
      return { ok: true, json: async () => ({ text }) }
    }),
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('RealLiverAgent', () => {
  it('returns a validated reply from model JSON', async () => {
    stubFetch([JSON.stringify({ message: 'Holding steady.', distress: 'LOW' })])
    const agent = new RealLiverAgent()
    const reply = await agent.respond(testState())
    expect(reply).toEqual({ message: 'Holding steady.', distress: 'LOW' })
    expect(agent.getUsage().calls).toBe(1)
    expect(agent.getUsage().entries).toHaveLength(1)
  })

  it('retries once after invalid JSON', async () => {
    stubFetch(['not json{{{', JSON.stringify({ message: 'Recovered.', distress: 'MODERATE' })])
    const agent = new RealLiverAgent()
    const reply = await agent.respond(testState())
    expect(reply.message).toBe('Recovered.')
    expect(agent.getUsage().calls).toBe(2)
  })

  it('falls back after two invalid replies', async () => {
    stubFetch(['garbage', 'more garbage'])
    const agent = new RealLiverAgent()
    const reply = await agent.respond(testState())
    expect(reply.action).toBeUndefined()
    expect(reply.message).toBe('Liver agent unreachable; holding current parameters.')
    expect(reply.distress).toBe('HIGH')
    expect(agent.getUsage().calls).toBe(2)
  })

  it('clamps out-of-range actions', async () => {
    stubFetch([
      JSON.stringify({
        message: 'Boosting.',
        distress: 'HIGH',
        action: { param: 'kGSyn', value: 999 },
      }),
    ])
    const agent = new RealLiverAgent()
    const reply = await agent.respond(testState())
    expect(reply.action).toEqual({ param: 'kGSyn', value: LIMITS.kGSyn.max })
  })

  it('rejects over-long messages', async () => {
    const long = JSON.stringify({ message: 'x'.repeat(281), distress: 'LOW' })
    stubFetch([long, long])
    const agent = new RealLiverAgent()
    const reply = await agent.respond(testState())
    expect(reply.action).toBeUndefined()
    expect(agent.getUsage().calls).toBe(2)
  })

  it('stops calling after the cap', async () => {
    stubFetch([JSON.stringify({ message: 'One.', distress: 'LOW' })])
    const agent = new RealLiverAgent({ maxCalls: 1 })
    const first = await agent.respond(testState())
    expect(first.message).toBe('One.')
    const second = await agent.respond(testState())
    expect(second.action).toBeUndefined()
    expect(second.message).toBe('Liver agent unreachable; holding current parameters.')
    expect(agent.getUsage().calls).toBe(1)
  })
})
