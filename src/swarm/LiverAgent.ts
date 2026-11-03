import { LIMITS } from './clamp.ts'
import { OrganReplySchema, SystemStateSchema, WHITELISTED_PARAMS } from './types.ts'
import type { OrganReply, SystemState } from './types.ts'

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
  const actions = WHITELISTED_PARAMS.map((param) => {
    const limits = LIMITS[param]
    return `${param}: ${limits.min} to ${limits.max}`
  }).join(', ')
  return [
    'You are the Liver in a simulated patient. Describe your own situation from the readings below.',
    'Style rules: first person ("I"), 1-2 sentences, plain English a non-expert understands.',
    'Mention at most 2 numbers, copied exactly from the readings and rounded to whole numbers with units (for example "glutathione is down to 30%"). Say what you are doing about it.',
    'Never use raw field names and never dump key=value pairs.',
    'Distress rubric (GSH = glutathione percent, necrosis = necrotic fraction in percent): CRITICAL if GSH is under 15 or necrosis is over 25; HIGH if GSH is under 30 or necrosis is over 15; MODERATE if GSH is under 60 or necrosis is over 5 or toxin or chronic load is elevated; otherwise LOW.',
    `Allowed actions (optional, only when distress is HIGH or CRITICAL): ${actions}. Omit "action" otherwise. Pick the one that fits and stay inside its range.`,
    'Use ONLY the numbers below. Do not invent, estimate, or alter any simulation numbers.',
    `Engine readings (exact): tick=${s.tick} tHours=${s.tHours.toFixed(1)} gshPct=${s.gshPct.toFixed(1)} necroticFraction=${s.necroticFraction.toFixed(3)} plasma=${s.plasma.toFixed(3)} toxinOutput=${s.toxinOutput.toFixed(3)} exposureIndex=${s.exposureIndex.toFixed(3)} meanChronicLoad=${s.meanChronicLoad.toFixed(3)}`,
    'Reply with JSON only: {"message": string (1-280 chars), "distress": "LOW"|"MODERATE"|"HIGH"|"CRITICAL", "action": {"param": "kGSyn"|"kDetox"|"kMClear"|"kPhase2Vmax", "value": number} or omit "action".',
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
