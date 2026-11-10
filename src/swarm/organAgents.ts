import { RealOrganAgent } from './RealOrganAgent'
import type { RealOrganAgentOptions } from './RealOrganAgent'
import { buildBrainPrompt, buildHeartPrompt, buildKidneyPrompt } from './organPrompts'
import {
  BrainVitalsSchema,
  HeartVitalsSchema,
  KidneyVitalsSchema,
  brainFallbackDistress,
  heartFallbackDistress,
  kidneyFallbackDistress,
} from './organVitals'
import type { BrainVitals, HeartVitals, KidneyVitals } from './organVitals'

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

export class BrainAgent extends RealOrganAgent<BrainVitals> {
  constructor(options: RealOrganAgentOptions = {}) {
    super({
      organ: 'brain',
      parseVitals: (value: unknown) => BrainVitalsSchema.parse(value),
      buildPrompt: buildBrainPrompt,
      fallbackDistress: brainFallbackDistress,
      fallbackMessage: 'Brain agent unreachable; holding current parameters.',
      endpoint: options.endpoint,
      maxCalls: options.maxCalls,
      timeoutMs: options.timeoutMs,
      budget: options.budget,
    })
  }
}
