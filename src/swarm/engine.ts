import { GRID_COUNT, GSH0, NECROTIC } from '../model/types'
import type { SimRequest, SimResult } from '../model/types'
import { simulate } from '../model/simulate'
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
 * Thin stateful wrapper over the deterministic simulate() core.
 * Holds the current request + result; summarize() reads, setParam() re-runs.
 */
export class SwarmEngine {
  private currentRequest: SimRequest
  private currentResult: SimResult
  private frameIndex: number

  constructor(request: SimRequest) {
    this.currentRequest = request
    this.currentResult = simulate(request)
    this.frameIndex = this.currentResult.frames.length - 1
  }

  getRequest(): SimRequest {
    return this.currentRequest
  }

  getResult(): SimResult {
    return this.currentResult
  }

  summarize(): SystemState {
    return summarize(this.currentResult, this.frameIndex)
  }

  summarizeAt(frameIndex: number): SystemState {
    return summarize(this.currentResult, frameIndex)
  }

  setParam(param: string, value: number): { appliedValue: number; clamped: boolean } {
    const next = setParam(this.currentRequest, param, value)
    this.currentRequest = next.request
    this.currentResult = simulate(next.request)
    this.frameIndex = this.currentResult.frames.length - 1
    return { appliedValue: next.appliedValue, clamped: next.clamped }
  }
}
