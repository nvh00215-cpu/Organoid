import { afterEach, describe, expect, it, vi } from 'vitest'
import { COMPOUNDS, doseForMode } from '../model/compounds'
import { simulate } from '../model/simulate'
import { buildResult, createSimState, stepSim } from '../model/simRunner'
import { K_RECIRC as KIDNEY_RECIRC } from '../model/kidney'
import { K_METABOLIC_DECAY, K_RECIRC as LOOP_RECIRC, stepMetabolitePool } from '../model/systemicPlasma'
import type { DosingPattern, SimRequest, SimResult } from '../model/types'
import { canonicalResult, simResultHash } from './canonical'
import { replayTranscript, SwarmRunner } from './runner'

function req(
  doseMgPerKg: number,
  horizonHours: number,
  dosingPattern: DosingPattern,
  metaboliteLoop?: boolean,
): SimRequest {
  return {
    compound: COMPOUNDS.acetaminophen,
    doseMgPerKg,
    weightKg: 70,
    horizonHours,
    dosingPattern,
    seed: 42,
    coupleOrgans: false,
    metaboliteLoop,
  }
}

function runSegmented(request: SimRequest, segmentSize: number): SimResult {
  const state = createSimState(request)
  while (state.step < state.totalSteps && state.failedAt === null) {
    stepSim(state, segmentSize)
  }
  return buildResult(state)
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('metabolite pool step', () => {
  it('holds zero at zero production and is exact at zero renal function', () => {
    expect(stepMetabolitePool(0, 0, 1, 0.1)).toBe(0)
    expect(stepMetabolitePool(0, 0, 0, 0.1)).toBe(0)
    // renalFunction 0 reduces k to exactly K_METABOLIC_DECAY (damage = 1 case).
    expect(stepMetabolitePool(2, 0.5, 0, 0.1)).toBe(2 + 0.1 * (0.5 - K_METABOLIC_DECAY * 2))
  })

  it('keeps the retention mirror in sync and the feedback gain below decay', () => {
    expect(KIDNEY_RECIRC).toBe(LOOP_RECIRC)
    expect(0.02 * KIDNEY_RECIRC).toBeLessThan(K_METABOLIC_DECAY)
  })

  it('eliminates faster at full renal function', () => {
    const healthy = stepMetabolitePool(2, 0.5, 1, 0.1)
    const failed = stepMetabolitePool(2, 0.5, 0, 0.1)
    expect(healthy).toBeLessThan(failed)
    expect(Number.isFinite(healthy)).toBe(true)
    expect(Number.isFinite(failed)).toBe(true)
  })

  it('saturates at P/k and never exceeds max(M0, P/k)', () => {
    const P = 0.6
    const k = K_METABOLIC_DECAY
    const dt = 0.1
    const ceiling = P / k
    let m = 0
    let maxSeen = 0
    for (let i = 0; i < 20000; i++) {
      m = stepMetabolitePool(m, P, 0, dt)
      if (m > maxSeen) maxSeen = m
    }
    expect(maxSeen).toBeLessThanOrEqual(ceiling * (1 + 1e-12))
    expect(Math.abs(m - ceiling) / ceiling).toBeLessThan(1e-9)
    let hot = 20
    let hotMax = 0
    for (let i = 0; i < 20000; i++) {
      hot = stepMetabolitePool(hot, P, 0, dt)
      if (hot > hotMax) hotMax = hot
    }
    expect(hotMax).toBeLessThanOrEqual(20 * (1 + 1e-12))
    expect(Math.abs(hot - ceiling) / ceiling).toBeLessThan(1e-9)
  })
})

describe('metabolite loop', () => {
  it('treats absent, false, and undefined flags identically', { timeout: 120000 }, () => {
    const apap = COMPOUNDS.acetaminophen
    const base: SimRequest = {
      compound: apap,
      doseMgPerKg: doseForMode(apap, 'high'),
      weightKg: 70,
      horizonHours: 72,
      dosingPattern: 'single',
      seed: 42,
      coupleOrgans: false,
    }
    const a = simulate(base)
    const b = simulate({ ...base, metaboliteLoop: false })
    const c = simulate({ ...base, metaboliteLoop: undefined })
    expect(simResultHash(a)).toBe(simResultHash(b))
    expect(simResultHash(a)).toBe(simResultHash(c))
    expect(canonicalResult(b)).toEqual(canonicalResult(a))
    expect(a.sysMetaboliteFinal).toBe(0)
    expect(a.sysMetabolitePeak).toBe(0)
  })

  it('keeps new fields out of the canonical hash', { timeout: 120000 }, () => {
    const apap = COMPOUNDS.acetaminophen
    const r = simulate(req(doseForMode(apap, 'high'), 72, 'single', true))
    expect(r.sysMetabolitePeak).toBeGreaterThan(0)
    const json = JSON.stringify(canonicalResult(r))
    expect(json).not.toContain('sysMetabolite')
    expect(json).not.toContain('metaboliteLoop')
  })

  it('pool grows monotonically with dose and stays finite', { timeout: 180000 }, () => {
    const apap = COMPOUNDS.acetaminophen
    const runs = [0, 0.4, 1, 4.8].map((mult) =>
      simulate(req(apap.typicalDoseMgPerKg * mult, 72, 'single', true)),
    )
    const peaks = runs.map((r) => r.sysMetabolitePeak)
    const finals = runs.map((r) => r.sysMetaboliteFinal)
    for (const v of [...peaks, ...finals]) {
      expect(Number.isFinite(v)).toBe(true)
      expect(v).toBeGreaterThanOrEqual(0)
    }
    for (let i = 1; i < runs.length; i++) {
      expect(peaks[i], `peak[${i}]`).toBeGreaterThanOrEqual(peaks[i - 1] - 1e-9)
      expect(finals[i], `final[${i}]`).toBeGreaterThanOrEqual(finals[i - 1] - 1e-9)
    }
    expect(peaks[0]).toBe(0)
    expect(peaks[peaks.length - 1]).toBeGreaterThan(0)
  })

  it('worst case stays finite, bounded, and below the principled ceiling', { timeout: 180000 }, () => {
    const apap = COMPOUNDS.acetaminophen
    const r = simulate(req(doseForMode(apap, 'high'), 720, 'repeated', true))
    expect(Number.isFinite(r.sysMetaboliteFinal)).toBe(true)
    expect(Number.isFinite(r.sysMetabolitePeak)).toBe(true)
    // Per-step production <= peakZone3M + 0.02 * peakMedulla, and k >= decay,
    // so M <= Pmax / K_METABOLIC_DECAY by the Euler invariant (see docs).
    const cap = (r.peakZone3Metabolite + 0.02 * r.kidneyPeakMedulla) / K_METABOLIC_DECAY
    expect(r.sysMetabolitePeak).toBeLessThanOrEqual(cap * (1 + 1e-9))
    expect(r.sysMetaboliteFinal).toBeLessThanOrEqual(cap * (1 + 1e-9))
    expect(r.kidneyPeakMeanDamage).toBeLessThanOrEqual(1)
    const last = r.frames[r.frames.length - 1]
    for (let i = 0; i < last.kidneyDamage.length; i++) {
      expect(Number.isFinite(last.kidneyDamage[i])).toBe(true)
      expect(last.kidneyDamage[i]).toBeLessThanOrEqual(1)
    }
  })

  it('segment identity holds with the flag on', { timeout: 180000 }, () => {
    const apap = COMPOUNDS.acetaminophen
    const request = req(doseForMode(apap, 'high'), 72, 'single', true)
    const reference = runSegmented(request, 1000000)
    for (const size of [1, 50]) {
      const replayed = runSegmented(request, size)
      expect(simResultHash(replayed)).toBe(simResultHash(reference))
      expect(replayed.sysMetaboliteFinal).toBe(reference.sysMetaboliteFinal)
      expect(replayed.sysMetabolitePeak).toBe(reference.sysMetabolitePeak)
    }
    expect(reference.sysMetabolitePeak).toBeGreaterThan(0)
  })

  it('replay stays exact with the flag on', { timeout: 60000 }, async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: unknown) => {
        if (String(url).endsWith('/api/narrative')) {
          return { ok: true, json: async () => ({ text: 'Stub narrative.' }) }
        }
        return {
          ok: true,
          json: async () => ({
            text: JSON.stringify({ message: 'ok', distress: 'LOW' }),
          }),
        }
      }),
    )
    const apap = COMPOUNDS.acetaminophen
    const request = req(doseForMode(apap, 'low'), 72, 'single', true)
    const runner = new SwarmRunner(request, { checkpointEvery: 50 })
    const run = await runner.run()
    const replayed = replayTranscript(request, run.transcript)
    expect(canonicalResult(replayed)).toEqual(run.finalResult)
    expect(replayed.sysMetabolitePeak).toBe(runner.getResult().sysMetabolitePeak)
  })
})
