import { describe, expect, it } from 'vitest'
import { HERG_THRESHOLD } from '../model/heart'
import { MEDULLA_THRESHOLD } from '../model/kidney'
import { GRID_COUNT } from '../model/types'
import type { ChartPoint, SimFrame, SimResult } from '../model/types'
import {
  HEART_HERG_THRESHOLD,
  KIDNEY_MEDULLA_THRESHOLD,
  heartFallbackDistress,
  kidneyFallbackDistress,
  summarizeHeart,
  summarizeKidney,
} from './organVitals'
import type { HeartVitals, KidneyVitals } from './organVitals'

function kidneyVitals(overrides: Partial<KidneyVitals> = {}): KidneyVitals {
  return {
    tick: 10,
    tHours: 5,
    medullaMean: 0.5,
    damageMean: 0.01,
    injuryFrac: 0,
    cortexMean: 1,
    ...overrides,
  }
}

function heartVitals(overrides: Partial<HeartVitals> = {}): HeartVitals {
  return { tick: 10, tHours: 5, herg: 0.05, damage: 0.01, ...overrides }
}

function fakeResult(): SimResult {
  const kidneyCortex = new Float32Array(GRID_COUNT).fill(2)
  const kidneyMedulla = new Float32Array(GRID_COUNT).fill(4)
  const kidneyDamage = new Float32Array(GRID_COUNT)
  for (let i = 0; i < 100; i++) kidneyDamage[i] = 0.8
  const frame: SimFrame = {
    t: 10,
    damage: new Float32Array(GRID_COUNT),
    zoneDamage: new Float32Array(GRID_COUNT * 3),
    chronicLoad: new Float32Array(GRID_COUNT),
    kidneyCortex,
    kidneyMedulla,
    kidneyDamage,
    heartHerg: 0.5,
    heartDamage: 0.1,
    brainConc: 0,
    brainDamage: 0,
  }
  const point: ChartPoint = {
    t: 10,
    plasma: 1,
    zone1C: 0,
    zone3C: 0,
    zone1M: 0,
    zone3M: 0,
    zone1D: 0,
    zone3D: 0,
    meanDamage: 0,
    meanChronic: 0,
    exposureFold: 0,
    kidneyMedulla: 4,
    kidneyDamage: 0.1,
    heartHerg: 0.5,
    heartDamage: 0.1,
    brainConc: 0,
    brainDamage: 0,
    meanGsh: 1,
    zone3Gsh: 1,
    exposureIndex: 0,
  }
  return { frames: [frame], series: [point] } as SimResult
}

describe('organ vitals', () => {
  it('mirrors model thresholds exactly', () => {
    expect(KIDNEY_MEDULLA_THRESHOLD).toBe(MEDULLA_THRESHOLD)
    expect(HEART_HERG_THRESHOLD).toBe(HERG_THRESHOLD)
  })

  it('summarizes kidney vitals from frames and series', () => {
    const v = summarizeKidney(fakeResult(), 0)
    expect(v.tick).toBe(0)
    expect(v.tHours).toBe(10)
    expect(v.medullaMean).toBe(4)
    expect(v.damageMean).toBe(0.1)
    expect(v.injuryFrac).toBe(100 / GRID_COUNT)
    expect(v.cortexMean).toBe(2)
    expect(summarizeKidney(fakeResult(), 999).tick).toBe(0)
  })

  it('summarizes heart vitals from frames', () => {
    const v = summarizeHeart(fakeResult(), 0)
    expect(v.tick).toBe(0)
    expect(v.tHours).toBe(10)
    expect(v.herg).toBe(0.5)
    expect(v.damage).toBe(0.1)
    expect(summarizeHeart(fakeResult(), 999).tick).toBe(0)
  })

  it('classifies kidney fallback distress on documented bands', () => {
    expect(kidneyFallbackDistress(kidneyVitals({ medullaMean: 8 }))).toBe('CRITICAL')
    expect(kidneyFallbackDistress(kidneyVitals({ injuryFrac: 0.3 }))).toBe('CRITICAL')
    expect(kidneyFallbackDistress(kidneyVitals({ medullaMean: 4 }))).toBe('HIGH')
    expect(kidneyFallbackDistress(kidneyVitals({ injuryFrac: 0.2 }))).toBe('HIGH')
    expect(kidneyFallbackDistress(kidneyVitals({ medullaMean: 2.5 }))).toBe('MODERATE')
    expect(kidneyFallbackDistress(kidneyVitals({ injuryFrac: 0.1 }))).toBe('MODERATE')
    expect(kidneyFallbackDistress(kidneyVitals({ damageMean: 0.2 }))).toBe('MODERATE')
    expect(kidneyFallbackDistress(kidneyVitals({}))).toBe('LOW')
  })

  it('classifies heart fallback distress on documented bands', () => {
    expect(heartFallbackDistress(heartVitals({ damage: 0.5 }))).toBe('CRITICAL')
    expect(heartFallbackDistress(heartVitals({ herg: 0.8 }))).toBe('CRITICAL')
    expect(heartFallbackDistress(heartVitals({ damage: 0.3 }))).toBe('HIGH')
    expect(heartFallbackDistress(heartVitals({ herg: 0.6 }))).toBe('HIGH')
    expect(heartFallbackDistress(heartVitals({ damage: 0.1 }))).toBe('MODERATE')
    expect(heartFallbackDistress(heartVitals({ herg: 0.4 }))).toBe('MODERATE')
    expect(heartFallbackDistress(heartVitals({}))).toBe('LOW')
  })
})
