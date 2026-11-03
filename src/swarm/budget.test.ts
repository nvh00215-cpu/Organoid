import { afterEach, describe, expect, it, vi } from 'vitest'
import { CallBudget } from './budget'
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

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('CallBudget', () => {
  it('blocks reservations at the cap', () => {
    const budget = new CallBudget(2, 0)
    expect(budget.tryReserve()).toBe(true)
    expect(budget.tryReserve()).toBe(true)
    expect(budget.tryReserve()).toBe(false)
    expect(budget.getCalls()).toBe(2)
  })

  it('holds a reserve until released', () => {
    const budget = new CallBudget(4, 2)
    expect(budget.tryReserve()).toBe(true)
    expect(budget.tryReserve()).toBe(true)
    expect(budget.tryReserve()).toBe(false)
    budget.releaseReserve()
    expect(budget.tryReserve()).toBe(true)
    expect(budget.tryReserve()).toBe(true)
    expect(budget.tryReserve()).toBe(false)
    expect(budget.getMaxCalls()).toBe(4)
  })

  it('shares one cap across agents', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ text: JSON.stringify({ message: 'ok', distress: 'LOW' }) }),
      })),
    )
    const budget = new CallBudget(2, 0)
    const a = new RealLiverAgent({ budget })
    const b = new RealLiverAgent({ budget })
    await a.respond(testState())
    await b.respond(testState())
    expect(budget.getCalls()).toBe(2)
    expect(a.getUsage().calls).toBe(1)
    expect(budget.getApproxTokens()).toBeGreaterThan(0)
    const capped = await a.respond(testState())
    expect(capped.message).toBe('Liver agent unreachable; holding current parameters.')
    expect(budget.getCalls()).toBe(2)
    expect(a.getUsage().calls).toBe(1)
  })
})
