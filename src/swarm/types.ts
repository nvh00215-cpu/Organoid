import { z } from 'zod'

/** Engine parameters an organ agent is allowed to tweak. */
export const WHITELISTED_PARAMS = ['kGSyn', 'kDetox', 'kMClear', 'kPhase2Vmax'] as const

export const WhitelistedParamSchema = z.enum(WHITELISTED_PARAMS)
export type WhitelistedParam = z.infer<typeof WhitelistedParamSchema>

export const DistressSchema = z.enum(['LOW', 'MODERATE', 'HIGH', 'CRITICAL'])
export type Distress = z.infer<typeof DistressSchema>

export const ActionSchema = z.object({
  param: WhitelistedParamSchema,
  value: z.number().finite(),
})
export type AgentAction = z.infer<typeof ActionSchema>

export const OrganReplySchema = z.object({
  message: z.string().min(1).max(280),
  distress: DistressSchema,
  action: ActionSchema.optional(),
})
export type OrganReply = z.infer<typeof OrganReplySchema>

/**
 * Small JSON snapshot of the liver's current state. Every number is derived
 * from engine output by summarize(); agents must never invent these values.
 */
export const SystemStateSchema = z.object({
  tick: z.number().int().nonnegative(),
  tHours: z.number().finite().nonnegative(),
  /** Grand-mean GSH as a percentage of the healthy mean (0..100). */
  gshPct: z.number().finite().min(0).max(100),
  necroticFraction: z.number().finite().min(0).max(1),
  plasma: z.number().finite().nonnegative(),
  /** Mean Zone-3 metabolite at this tick (toxin output). */
  toxinOutput: z.number().finite().nonnegative(),
  /** Time-integral of mean Zone-3 metabolite up to this tick (conc·h). */
  exposureIndex: z.number().finite().nonnegative(),
  meanChronicLoad: z.number().finite().min(0).max(1),
})
export type SystemState = z.infer<typeof SystemStateSchema>
