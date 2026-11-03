import { MockLiverAgent, buildLiverPrompt } from './LiverAgent'
import { RealOrganAgent } from './RealOrganAgent'
import type { RealOrganAgentOptions } from './RealOrganAgent'
import { SystemStateSchema } from './types'
import type { SystemState } from './types'

export type { UsageEntry, UsageReport } from './RealOrganAgent'

export type RealLiverAgentOptions = RealOrganAgentOptions

/** LLM-backed liver agent. Sends engine numbers through the local proxy. */
export class RealLiverAgent extends RealOrganAgent<SystemState> {
  constructor(options: RealLiverAgentOptions = {}) {
    super({
      organ: 'liver',
      parseVitals: (value: unknown) => SystemStateSchema.parse(value),
      buildPrompt: buildLiverPrompt,
      fallbackDistress: (vitals: SystemState) => new MockLiverAgent().respond(vitals).distress,
      fallbackMessage: 'Liver agent unreachable; holding current parameters.',
      endpoint: options.endpoint,
      maxCalls: options.maxCalls,
      timeoutMs: options.timeoutMs,
      budget: options.budget,
    })
  }
}
