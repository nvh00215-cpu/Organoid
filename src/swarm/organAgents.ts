import { RealOrganAgent } from './RealOrganAgent'
import type { RealOrganAgentOptions } from './RealOrganAgent'
import { buildHeartPrompt, buildKidneyPrompt } from './organPrompts'
import {
  HeartVitalsSchema,
  KidneyVitalsSchema,
  heartFallbackDistress,
  kidneyFallbackDistress,
} from './organVitals'
import type { HeartVitals, KidneyVitals } from './organVitals'

export class KidneyAgent extends RealOrganAgent<KidneyVitals> {
  constructor(options: RealOrganAgentOptions = {}) {
    super({
      organ: 'kidney',
      parseVitals: (value: unknown) => KidneyVitalsSchema.parse(value),
      buildPrompt: buildKidneyPrompt,
      fallbackDistress: kidneyFallbackDistress,
      fallbackMessage: 'Kidney agent unreachable; holding current parameters.',
      endpoint: options.endpoint,
      maxCalls: options.maxCalls,
      timeoutMs: options.timeoutMs,
      budget: options.budget,
    })
  }
}

export class HeartAgent extends RealOrganAgent<HeartVitals> {
  constructor(options: RealOrganAgentOptions = {}) {
    super({
      organ: 'heart',
      parseVitals: (value: unknown) => HeartVitalsSchema.parse(value),
      buildPrompt: buildHeartPrompt,
      fallbackDistress: heartFallbackDistress,
      fallbackMessage: 'Heart agent unreachable; holding current parameters.',
      endpoint: options.endpoint,
      maxCalls: options.maxCalls,
      timeoutMs: options.timeoutMs,
      budget: options.budget,
    })
  }
}
