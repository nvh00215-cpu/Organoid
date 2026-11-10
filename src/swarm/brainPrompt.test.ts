import { describe, expect, it } from 'vitest'
import {
  BRAIN_PERSONA,
  BRAIN_RUBRIC,
  JSON_CONTRACT_LINE,
  NO_ACTION_LINE,
  NO_INVENT_LINE,
  buildBrainPrompt,
} from './organPrompts'
import { BRAIN_BANDS, BRAIN_NEURO_THRESHOLD } from './organVitals'
import type { BrainVitals } from './organVitals'

function brainVitals(): BrainVitals {
  return { tick: 40, tHours: 20, conc: 0.9, damage: 0.05, peakConc: 0.95, peakDamage: 0.06 }
}

describe('brain prompt', () => {
  it('uses persona, rubric, readings and the advisory contract', () => {
    const prompt = buildBrainPrompt(brainVitals())
    expect(prompt).toContain(BRAIN_PERSONA)
    expect(prompt).toContain(BRAIN_RUBRIC)
    expect(prompt).toContain(String(BRAIN_BANDS.criticalPeakDamage))
    expect(prompt).toContain(String(BRAIN_BANDS.highPeakDamage))
    expect(prompt).toContain(String(BRAIN_NEURO_THRESHOLD))
    expect(prompt).toContain('kBrainEfflux')
    expect(prompt).toContain('0.5 to 2')
    expect(prompt).toContain('slowly')
    expect(prompt).toContain('0.1 per checkpoint')
    expect(prompt).not.toContain(NO_ACTION_LINE)
    expect(prompt).toContain(NO_INVENT_LINE)
    expect(prompt).toContain('"param": "kBrainEfflux"')
    expect(prompt).not.toContain(JSON_CONTRACT_LINE)
    expect(prompt).toContain('conc=0.900')
    expect(prompt).toContain('damage=0.050')
    expect(prompt).toContain('peakConc=0.950')
    expect(prompt).toContain('peakDamage=0.060')
  })

  it('rejects invalid vitals instead of prompting', () => {
    expect(() => buildBrainPrompt({ tick: 0 } as unknown as BrainVitals)).toThrow()
  })
})
