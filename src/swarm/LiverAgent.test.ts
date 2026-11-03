import { describe, expect, it } from 'vitest'
import { LIMITS } from './clamp'
import { buildLiverPrompt } from './LiverAgent'
import { buildHeartPrompt, buildKidneyPrompt } from './organPrompts'
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

  it('builds kidney prompts with persona, rubric and readings', () => {
    const prompt = buildKidneyPrompt({
      tick: 10,
      tHours: 5,
      medullaMean: 4,
      damageMean: 0.1,
      injuryFrac: 0.08,
      cortexMean: 2,
    })
    expect(prompt).toContain('You are the Kidney in a simulated patient')
    expect(prompt).toContain('first person')
    expect(prompt).toContain('CRITICAL if medulla is over 7.2')
    expect(prompt).toContain('HIGH if medulla is over 3.6')
    expect(prompt).toContain('MODERATE if medulla is over 2')
    expect(prompt).toContain('always omit "action"')
    expect(prompt).toContain('tick=10')
    expect(prompt).toContain('medullaMean=4.00')
    expect(prompt).toContain('Reply with JSON only')
  })

  it('builds heart prompts with persona, rubric and readings', () => {
    const prompt = buildHeartPrompt({ tick: 10, tHours: 5, herg: 0.5, damage: 0.1 })
    expect(prompt).toContain('You are the Heart in a simulated patient')
    expect(prompt).toContain('first person')
    expect(prompt).toContain('CRITICAL if damage is over 0.4')
    expect(prompt).toContain('HIGH if damage is over 0.2')
    expect(prompt).toContain('MODERATE if damage is over 0.08')
    expect(prompt).toContain('always omit "action"')
    expect(prompt).toContain('tick=10')
    expect(prompt).toContain('herg=0.500')
    expect(prompt).toContain('Reply with JSON only')
  })

  it('matches the blessed liver prompt byte for byte', () => {
    const expected = [
      'You are the Liver in a simulated patient. Describe your own situation from the readings below.',
      'Style rules: first person ("I"), 1-2 sentences, plain English a non-expert understands.',
      'Mention at most 2 numbers, copied exactly from the readings and rounded to whole numbers with units (for example "glutathione is down to 30%"). Say what you are doing about it.',
      'Never use raw field names and never dump key=value pairs.',
      'Distress rubric (GSH = glutathione percent, necrosis = necrotic fraction in percent): CRITICAL if GSH is under 15 or necrosis is over 25; HIGH if GSH is under 30 or necrosis is over 15; MODERATE if GSH is under 60 or necrosis is over 5 or toxin or chronic load is elevated; otherwise LOW.',
      'Allowed actions (optional, only when distress is HIGH or CRITICAL): kGSyn: 0.02 to 0.6, kDetox: 0.5 to 8, kMClear: 0.02 to 1.5, kPhase2Vmax: 0.5 to 10. Omit "action" otherwise. Pick the one that fits and stay inside its range.',
      'Use ONLY the numbers below. Do not invent, estimate, or alter any simulation numbers.',
      'Engine readings (exact): tick=40 tHours=20.0 gshPct=30.0 necroticFraction=0.200 plasma=5.000 toxinOutput=0.200 exposureIndex=1.500 meanChronicLoad=0.100',
      'Reply with JSON only: {"message": string (1-280 chars), "distress": "LOW"|"MODERATE"|"HIGH"|"CRITICAL", "action": {"param": "kGSyn"|"kDetox"|"kMClear"|"kPhase2Vmax", "value": number} or omit "action".',
    ].join('\n')
    expect(buildLiverPrompt(testState())).toBe(expected)
  })
})
