import { describe, expect, it } from 'vitest'
import { LIMITS } from './clamp'
import { buildLiverPrompt } from './LiverAgent'
import { WHITELISTED_PARAMS } from './types'
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

describe('buildLiverPrompt', () => {
  it('states the persona and style rules', () => {
    const prompt = buildLiverPrompt(testState())
    expect(prompt).toContain('You are the Liver in a simulated patient')
    expect(prompt).toContain('first person')
    expect(prompt).toContain('1-2 sentences')
    expect(prompt).toContain('at most 2 numbers')
    expect(prompt).toContain('key=value')
  })

  it('includes the distress rubric thresholds', () => {
    const prompt = buildLiverPrompt(testState())
    expect(prompt).toContain('CRITICAL if GSH is under 15 or necrosis is over 25')
    expect(prompt).toContain('HIGH if GSH is under 30 or necrosis is over 15')
    expect(prompt).toContain('MODERATE if GSH is under 60 or necrosis is over 5')
    expect(prompt).toContain('otherwise LOW')
  })

  it('lists every whitelisted param with its clamp range', () => {
    const prompt = buildLiverPrompt(testState())
    for (const param of WHITELISTED_PARAMS) {
      expect(prompt).toContain(param)
      expect(prompt).toContain(String(LIMITS[param].min))
      expect(prompt).toContain(String(LIMITS[param].max))
    }
    expect(prompt).toContain('only when distress is HIGH or CRITICAL')
  })

  it('keeps the exact readings and JSON contract', () => {
    const s = testState()
    const prompt = buildLiverPrompt(s)
    expect(prompt).toContain(`tick=${s.tick}`)
    expect(prompt).toContain(`gshPct=${s.gshPct.toFixed(1)}`)
    expect(prompt).toContain('Reply with JSON only')
    expect(prompt).toContain('"distress": "LOW"|"MODERATE"|"HIGH"|"CRITICAL"')
    expect(prompt).toContain('Do not invent')
  })

  it('rejects invalid states', () => {
    expect(() => buildLiverPrompt({ ...testState(), gshPct: 101 })).toThrow()
  })
})
