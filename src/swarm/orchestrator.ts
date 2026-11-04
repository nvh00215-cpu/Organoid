import { z } from 'zod'
import type { CallBudget } from './budget.ts'
import { DistressSchema } from './types.ts'

/** Separator joining hot organ labels in a system headline (see judgeSystem). */
export const SYSTEM_HEADLINE_SEPARATOR = ' · '

/** Headline when no organ threshold is crossed (see judgeSystem). */
export const SYSTEM_HEADLINE_EMPTY = 'NO ORGAN THRESHOLD CROSSED'

/**
 * Every organ label judgeSystem() can place in a headline. Copied from
 * src/model/verdict.ts (hot liver labels) and src/model/systemVerdict.ts
 * (hot kidney/heart/brain labels); no exported const exists there.
 * Pinned by orchestrator.test.ts. Clear/safe labels are excluded on
 * purpose: they appear only when the organ is not hot.
 */
export const SYSTEM_ORGAN_LABELS = [
  'ACUTE + CHRONIC FAILURE',
  'LIVER FAILURE',
  'CHRONIC LIVER FAILURE',
  'TOXIC',
  'CHRONIC DEGENERATION',
  'CAUTION',
  'RENAL FAILURE',
  'RENAL RISK',
  'CARDIAC FAILURE',
  'CARDIAC RISK',
  'NEURO FAILURE',
  'NEURO RISK',
] as const

/** True only for exact systemVerdict() headline output. */
export function isSystemHeadline(value: string): boolean {
  if (value === SYSTEM_HEADLINE_EMPTY) return true
  const parts = value.split(SYSTEM_HEADLINE_SEPARATOR)
  return (
    parts.length <= 4 &&
    parts.every((part) => (SYSTEM_ORGAN_LABELS as readonly string[]).includes(part))
  )
}

export const SystemHeadlineSchema = z
  .string()
  .refine(isSystemHeadline, 'Not a system verdict headline')

export const NarrativeContextSchema = z.object({
  label: SystemHeadlineSchema,
  tHours: z.number().finite().nonnegative(),
  liver: DistressSchema,
  kidney: DistressSchema,
  heart: DistressSchema,
})
export type NarrativeContext = z.infer<typeof NarrativeContextSchema>

export interface NarrateOptions {
  readonly endpoint?: string
  readonly timeoutMs?: number
  readonly budget?: CallBudget
}

const DEFAULT_NARRATIVE_ENDPOINT = '/api/narrative'
const DEFAULT_TIMEOUT_MS = 30000
const MAX_NARRATIVE_CHARS = 280

export function buildSystemPrompt(context: NarrativeContext): string {
  const c = NarrativeContextSchema.parse(context)
  return [
    'You are the narrator of a simulated patient. Write ONE plain-English sentence (at most 280 characters) describing the situation.',
    `The overall status is "${c.label}" at hour ${c.tHours.toFixed(1)}. Organ distress: liver ${c.liver}, kidney ${c.kidney}, heart ${c.heart}.`,
    'Do not change the status label and do not invent measurements. Reply with the sentence only, no JSON.',
  ].join('\n')
}

export function templateNarrative(context: NarrativeContext): string {
  const c = NarrativeContextSchema.parse(context)
  return `${c.label} at hour ${c.tHours.toFixed(1)}: liver ${c.liver}, kidney ${c.kidney}, heart ${c.heart}.`
}

export async function narrateSystem(
  context: NarrativeContext,
  options: NarrateOptions = {},
): Promise<string> {
  const valid = NarrativeContextSchema.parse(context)
  if (options.budget !== undefined && !options.budget.tryReserve()) {
    return templateNarrative(valid)
  }
  const prompt = buildSystemPrompt(valid)
  try {
    const response = await fetch(options.endpoint ?? DEFAULT_NARRATIVE_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(valid),
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    })
    if (!response.ok) return templateNarrative(valid)
    const envelope: unknown = await response.json()
    if (typeof envelope !== 'object' || envelope === null) return templateNarrative(valid)
    const text = (envelope as Record<string, unknown>).text
    if (typeof text !== 'string' || text.length === 0 || text.length > MAX_NARRATIVE_CHARS) {
      return templateNarrative(valid)
    }
    options.budget?.recordTokens(Math.ceil((prompt.length + text.length) / 4))
    return text
  } catch {
    return templateNarrative(valid)
  }
}
