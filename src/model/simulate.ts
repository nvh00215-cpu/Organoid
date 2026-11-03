import type { SimRequest, SimResult } from './types'
import { buildResult, createSimState, stepSim } from './simRunner'

export { frameStrideHours } from './simRunner'

export function simulate(request: SimRequest): SimResult {
  const state = createSimState(request)
  stepSim(state, state.totalSteps)
  return buildResult(state)
}
