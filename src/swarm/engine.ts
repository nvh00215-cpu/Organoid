import { GRID_COUNT, GSH0, NECROTIC } from '../model/types'
import type { SimRequest, SimResult } from '../model/types'
import { buildResult, cloneSimState, createSimState, setSimParams, stepSim } from '../model/simRunner'
import type { SimState } from '../model/simRunner'
import { clampAction } from './clamp'
import { WHITELISTED_PARAMS } from './types'
import type { SystemState, WhitelistedParam } from './types'

const MEAN_GSH0 = (GSH0[0] + GSH0[1] + GSH0[2]) / 3

function isWhitelisted(param: string): param is WhitelistedParam {
  return (WHITELISTED_PARAMS as readonly string[]).includes(param)
}

/** Derive the agent-visible state from engine output. Pure; invents nothing. */
export function summarize(result: SimResult, frameIndex: number): SystemState {
  const last = result.frames.length - 1
  const idx = Math.max(0, Math.min(frameIndex, last))
  const frame = result.frames[idx]
  const point = result.series[idx]
  let necrotic = 0
  for (let i = 0; i < GRID_COUNT; i++) {
    if (frame.damage[i] > NECROTIC) necrotic++
  }
  return {
    tick: idx,
    tHours: frame.t,
    gshPct: Math.max(0, Math.min(100, (point.meanGsh / MEAN_GSH0) * 100)),
    necroticFraction: necrotic / GRID_COUNT,
    plasma: point.plasma,
    toxinOutput: point.zone3M,
    exposureIndex: point.exposureIndex,
    meanChronicLoad: point.meanChronic,
  }
}

export interface SetParamResult {
  readonly request: SimRequest
  readonly appliedValue: number
  readonly clamped: boolean
}

/**
 * Apply an agent-requested action: whitelist check, then clamp, then a new
 * request object. The input request is never mutated. Unknown params throw.
 */
export function setParam(request: SimRequest, param: string, value: number): SetParamResult {
  if (!isWhitelisted(param)) {
    throw new Error(`setParam: '${param}' is not a whitelisted parameter`)
  }
  const clamped = clampAction(param, value)
  return {
    request: {
      ...request,
      compound: { ...request.compound, [param]: clamped.value },
    },
    appliedValue: clamped.value,
    clamped: clamped.clamped,
  }
}

/**
 * Live resumable engine over the deterministic simRunner core.
 * Holds simulation state; runUntil/runToEnd advance it, setParam swaps the
 * compound for subsequent steps only, fork branches an independent copy.
 * Note: getResult() views live buffers (frames/series grow as you step).
 */
export class SwarmEngine {
  private sim: SimState

  constructor(request: SimRequest) {
    this.sim = createSimState(request)
  }

  getRequest(): SimRequest {
    return this.sim.request
  }

  getResult(): SimResult {
    return buildResult(this.sim)
  }

  getFrameCount(): number {
    return this.sim.frames.length
  }

  isDone(): boolean {
    return this.sim.step >= this.sim.totalSteps || this.sim.failedAt !== null
  }

  summarize(): SystemState {
    return summarize(this.getResult(), this.sim.frames.length - 1)
  }

  summarizeAt(frameIndex: number): SystemState {
    return summarize(this.getResult(), frameIndex)
  }

  /** Advance until frame tick exists, or the run ends. Returns frames reached. */
  runUntil(tick: number): number {
    const target = Math.max(0, Math.floor(tick))
    while (this.sim.frames.length - 1 < target && !this.isDone()) {
      stepSim(this.sim, 1)
    }
    return this.sim.frames.length - 1
  }

  runToEnd(): void {
    stepSim(this.sim, this.sim.totalSteps - this.sim.step)
  }

  /**
   * Whitelist + clamp, then swap the compound from the current tick forward.
   * Recorded frames are never rewritten. Repeated calls compose.
   */
  setParam(param: string, value: number): { appliedValue: number; clamped: boolean } {
    const current: SimRequest = { ...this.sim.request, compound: this.sim.compound }
    const next = setParam(current, param, value)
    setSimParams(this.sim, next.request.compound)
    return { appliedValue: next.appliedValue, clamped: next.clamped }
  }

  fork(): SwarmEngine {
    const copy = new SwarmEngine(this.sim.request)
    copy.sim = cloneSimState(this.sim)
    return copy
  }
}
