import { OrganReplySchema, SystemStateSchema } from './types'
import type { OrganReply, SystemState } from './types'

/**
 * Organ agent interface. The mock below is synchronous; a real LLM-backed
 * agent implements the same interface and returns a promise.
 */
export interface OrganAgent {
  readonly organ: string
  respond(state: SystemState): OrganReply | Promise<OrganReply>
}

/** Build the LLM prompt from validated engine numbers. No network calls. */
export function buildLiverPrompt(state: SystemState): string {
  const s = SystemStateSchema.parse(state)
  return [
    'You are the Liver agent in a digital-human toxicity simulation.',
    'Use ONLY the numbers below. Do not invent, estimate, or alter any simulation numbers.',
    `tick=${s.tick} tHours=${s.tHours.toFixed(1)} gshPct=${s.gshPct.toFixed(1)} necroticFraction=${s.necroticFraction.toFixed(3)} plasma=${s.plasma.toFixed(3)} toxinOutput=${s.toxinOutput.toFixed(3)} exposureIndex=${s.exposureIndex.toFixed(3)} meanChronicLoad=${s.meanChronicLoad.toFixed(3)}`,
    'Reply with JSON only: {"message": string (1-280 chars), "distress": "LOW"|"MODERATE"|"HIGH"|"CRITICAL", "action": {"param": "kGSyn"|"kDetox"|"kMClear"|"kPhase2Vmax", "value": number} or omit "action".',
    'The action requests a bounded engine-parameter tweak; out-of-range values are clamped.',
  ].join('\n')
}

/** Validate an agent reply; throws on any schema violation. */
export function parseOrganReply(data: unknown): OrganReply {
  return OrganReplySchema.parse(data)
}

/** Deterministic mock agent keyed by distress thresholds. No network calls. */
export class MockLiverAgent implements OrganAgent {
  readonly organ = 'liver'

  respond(state: SystemState): OrganReply {
    const s = SystemStateSchema.parse(state)
    if (s.gshPct < 25 || s.necroticFraction > 0.3) {
      return {
        message: `Critical centrilobular injury at t=${s.tHours.toFixed(1)}h: GSH ${s.gshPct.toFixed(0)}%, necrotic ${(s.necroticFraction * 100).toFixed(0)}%. Requesting GSH synthesis support.`,
        distress: 'CRITICAL',
        action: { param: 'kGSyn', value: 0.45 },
      }
    }
    if (s.gshPct < 45 || s.necroticFraction > 0.15) {
      return {
        message: `High pericentral stress at t=${s.tHours.toFixed(1)}h: GSH ${s.gshPct.toFixed(0)}%, necrotic ${(s.necroticFraction * 100).toFixed(0)}%. Requesting detox support.`,
        distress: 'HIGH',
        action: { param: 'kDetox', value: 5 },
      }
    }
    if (s.toxinOutput > 0.12 || s.meanChronicLoad > 0.35) {
      return {
        message: `Moderate load at t=${s.tHours.toFixed(1)}h: toxin ${s.toxinOutput.toFixed(2)}, chronic ${s.meanChronicLoad.toFixed(2)}. Requesting metabolite clearance support.`,
        distress: 'MODERATE',
        action: { param: 'kMClear', value: 0.5 },
      }
    }
    return {
      message: `Liver nominal at t=${s.tHours.toFixed(1)}h: GSH ${s.gshPct.toFixed(0)}%, necrotic ${(s.necroticFraction * 100).toFixed(1)}%. Holding.`,
      distress: 'LOW',
    }
  }
}
