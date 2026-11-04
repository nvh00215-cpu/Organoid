import { LIMITS } from './clamp.ts'
import {
  HEART_BANDS,
  HEART_HERG_THRESHOLD,
  KIDNEY_BANDS,
  KIDNEY_MEDULLA_THRESHOLD,
  KidneyVitalsSchema,
} from './organVitals.ts'
import type { HeartVitals, KidneyVitals } from './organVitals.ts'
import { HeartVitalsSchema } from './organVitals.ts'
import { WHITELISTED_PARAMS } from './types.ts'

export const STYLE_RULES_BLOCK: readonly string[] = [
  'Style rules: first person ("I"), 1-2 sentences, plain English a non-expert understands.',
  'Mention at most 2 numbers, copied exactly from the readings and rounded to whole numbers with units (for example "glutathione is down to 30%"). Say what you are doing about it.',
  'Never use raw field names and never dump key=value pairs.',
]

export const NO_INVENT_LINE =
  'Use ONLY the numbers below. Do not invent, estimate, or alter any simulation numbers.'

export const JSON_CONTRACT_LINE =
  'Reply with JSON only: {"message": string (1-280 chars), "distress": "LOW"|"MODERATE"|"HIGH"|"CRITICAL", "action": {"param": "kGSyn"|"kDetox"|"kMClear"|"kPhase2Vmax", "value": number} or omit "action".'

export function actionListBlock(): string {
  const actions = WHITELISTED_PARAMS.map((param) => {
    const limits = LIMITS[param]
    return `${param}: ${limits.min} to ${limits.max}`
  }).join(', ')
  return `Allowed actions (optional, only when distress is HIGH or CRITICAL): ${actions}. Omit "action" otherwise. Pick the one that fits and stay inside its range.`
}

export const NO_ACTION_LINE =
  'No actions are available for this organ; always omit "action". Describe and assess only.'

export const KIDNEY_PERSONA =
  'You are the Kidney in a simulated patient. Describe your own situation from the readings below.'

export const HEART_PERSONA =
  'You are the Heart in a simulated patient. Describe your own situation from the readings below.'

export const KIDNEY_RUBRIC =
  `Distress rubric (medulla = mean medullary level, injury = injured nephron percent): CRITICAL if medulla is over ${KIDNEY_BANDS.criticalMedulla} or injury is over ${KIDNEY_BANDS.criticalInjuryPct} percent; HIGH if medulla is over ${KIDNEY_MEDULLA_THRESHOLD} or injury is over ${KIDNEY_BANDS.highInjuryPct} percent; MODERATE if medulla is over ${KIDNEY_BANDS.moderateMedulla} or injury is over ${KIDNEY_BANDS.moderateInjuryPct} percent or damage is over ${KIDNEY_BANDS.moderateDamage}; otherwise LOW.`

export const HEART_RUBRIC =
  `Distress rubric (hERG = blockade fraction, damage = injury fraction): CRITICAL if damage is over ${HEART_BANDS.criticalDamage} or hERG is over ${HEART_BANDS.criticalHerg}; HIGH if damage is over ${HEART_BANDS.highDamage} or hERG is over ${HEART_BANDS.highHerg}; MODERATE if damage is over ${HEART_BANDS.moderateDamage} or hERG is over ${HEART_HERG_THRESHOLD}; otherwise LOW.`

export function buildKidneyPrompt(vitals: KidneyVitals): string {
  const v = KidneyVitalsSchema.parse(vitals)
  return [
    KIDNEY_PERSONA,
    ...STYLE_RULES_BLOCK,
    KIDNEY_RUBRIC,
    NO_ACTION_LINE,
    NO_INVENT_LINE,
    `Kidney readings (exact): tick=${v.tick} tHours=${v.tHours.toFixed(1)} medullaMean=${v.medullaMean.toFixed(2)} damageMean=${v.damageMean.toFixed(3)} injuryFrac=${v.injuryFrac.toFixed(3)} cortexMean=${v.cortexMean.toFixed(2)} corticalLoad=${v.corticalLoadNorm.toFixed(3)} recovery=${v.recoveryIndex.toFixed(3)}`,
    JSON_CONTRACT_LINE,
  ].join('\n')
}

export function buildHeartPrompt(vitals: HeartVitals): string {
  const v = HeartVitalsSchema.parse(vitals)
  return [
    HEART_PERSONA,
    ...STYLE_RULES_BLOCK,
    HEART_RUBRIC,
    NO_ACTION_LINE,
    NO_INVENT_LINE,
    `Heart readings (exact): tick=${v.tick} tHours=${v.tHours.toFixed(1)} herg=${v.herg.toFixed(3)} damage=${v.damage.toFixed(3)} qtLoad=${v.qtLoadNorm.toFixed(3)} qtTimeFrac=${v.qtTimeFrac.toFixed(3)} washout=${v.washoutIndex.toFixed(3)}`,
    JSON_CONTRACT_LINE,
  ].join('\n')
}
