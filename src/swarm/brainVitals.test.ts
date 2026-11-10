import { describe, expect, it } from 'vitest'
import { NEURO_THRESHOLD } from '../model/brain'
import { GRID_COUNT } from '../model/types'
import type { SimFrame, SimResult } from '../model/types'
import { DistressSchema } from './types'
import {
  BRAIN_BANDS,
  BRAIN_NEURO_THRESHOLD,
  BrainVitalsSchema,
  brainFallbackDistress,
  summarizeBrain,
} from './organVitals'
import type { BrainVitals } from './organVitals'

function brainVitals(overrides: Partial<BrainVitals> = {}): BrainVitals {
  return {
    tick: 10,
    tHours: 5,
    conc: 0.1,
    damage: 0.01,
    peakConc: 0.1,
    peakDamage: 0.01,
    ...overrides,
  }
}

function brainResult(concs: number[], damages: number[]): SimResult {
  const frames: SimFrame[] = concs.map((conc, i) => ({
    t: i,
    damage: new Float32Array(GRID_COUNT),
    zoneDamage: new Float32Array(GRID_COUNT * 3),
    chronicLoad: new Float32Array(GRID_COUNT),
    kidneyCortex: new Float32Array(GRID_COUNT),
    kidneyMedulla: new Float32Array(GRID_COUNT),
    kidneyDamage: new Float32Array(GRID_COUNT),
    heartHerg: 0,
    heartDamage: 0,
    brainConc: conc,
    brainDamage: damages[i],
  }))
  return { frames, series: frames.map((f) => ({ t: f.t })) } as unknown as SimResult
}

describe('brain vitals', () => {
  it('mirrors the engine neuro threshold and verdict cutoffs exactly', () => {
    expect(BRAIN_NEURO_THRESHOLD).toBe(NEURO_THRESHOLD)
    expect(BRAIN_BANDS.criticalPeakDamage).toBe(0.75)
    expect(BRAIN_BANDS.highPeakDamage).toBe(0.08)
  })

  it('accepts valid vitals and rejects NaN, negative or out-of-range values', () => {
    expect(BrainVitalsSchema.safeParse(brainVitals({})).success).toBe(true)
    for (const bad of [
      brainVitals({ conc: Number.NaN }),
      brainVitals({ conc: -0.5 }),
      brainVitals({ damage: Number.NaN }),
      brainVitals({ damage: -0.1 }),
      brainVitals({ damage: 1.5 }),
      brainVitals({ peakConc: Number.NaN }),
      brainVitals({ peakConc: -1 }),
      brainVitals({ peakDamage: Number.NaN }),
      brainVitals({ peakDamage: 2 }),
      brainVitals({ tHours: Number.NaN }),
      brainVitals({ tick: -1 }),
    ]) {
      expect(BrainVitalsSchema.safeParse(bad).success).toBe(false)
    }
  })

  it('summarizes brain vitals from engine frames with running peaks', () => {
    const result = brainResult([0.2, 0.9, 0.5], [0.01, 0.05, 0.03])
    const mid = summarizeBrain(result, 1)
    expect(mid.tick).toBe(1)
    expect(mid.tHours).toBe(1)
    expect(mid.conc).toBe(0.9)
    expect(mid.damage).toBe(0.05)
    expect(mid.peakConc).toBe(0.9)
    expect(mid.peakDamage).toBe(0.05)
    const last = summarizeBrain(result, 2)
    expect(last.conc).toBe(0.5)
    expect(last.damage).toBe(0.03)
    expect(last.peakConc).toBe(0.9)
    expect(last.peakDamage).toBe(0.05)
    expect(summarizeBrain(result, 999).tick).toBe(2)
    expect(summarizeBrain(result, -5).tick).toBe(0)
  })

  it('classifies fallback distress at the engine threshold boundaries', () => {
    const cases: [BrainVitals, string][] = [
      [brainVitals({ peakDamage: 0.079 }), 'LOW'],
      [brainVitals({ peakDamage: 0.081 }), 'HIGH'],
      [brainVitals({ peakDamage: 0.749 }), 'HIGH'],
      [brainVitals({ peakDamage: 0.751 }), 'CRITICAL'],
      [brainVitals({ conc: 0.849 }), 'LOW'],
      [brainVitals({ conc: 0.851 }), 'MODERATE'],
      [brainVitals({}), 'LOW'],
    ]
    for (const [vitals, expected] of cases) {
      const distress = brainFallbackDistress(vitals)
      expect(distress).toBe(expected)
      expect(DistressSchema.safeParse(distress).success).toBe(true)
    }
  })
})
