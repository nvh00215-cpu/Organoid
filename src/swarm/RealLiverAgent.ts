import { clampAction } from './clamp'
import { buildLiverPrompt, MockLiverAgent } from './LiverAgent'
import type { OrganAgent } from './LiverAgent'
import { OrganReplySchema, SystemStateSchema } from './types'
import type { OrganReply, SystemState } from './types'

export interface UsageEntry {
  readonly promptChars: number
  readonly completionChars: number
  readonly approxTokens: number
}

export interface UsageReport {
  readonly calls: number
  readonly approxTokens: number
  readonly entries: readonly UsageEntry[]
}

export interface RealLiverAgentOptions {
  readonly endpoint?: string
  readonly maxCalls?: number
  readonly timeoutMs?: number
}

const DEFAULT_ENDPOINT = '/api/organ'
const DEFAULT_MAX_CALLS = 60
const DEFAULT_TIMEOUT_MS = 30000
const MAX_TEXT_CHARS = 4000

/** Documented heuristic: no tokenizer dependency. */
function approxTokensFor(promptChars: number, completionChars: number): number {
  return Math.ceil((promptChars + completionChars) / 4)
}

/** Deterministic no-action fallback: mock distress level, fixed message. */
function fallbackReply(state: SystemState): OrganReply {
  const mock = new MockLiverAgent().respond(state)
  return {
    message: 'Liver agent unreachable; holding current parameters.',
    distress: mock.distress,
  }
}

/** LLM-backed liver agent. Sends engine numbers through the local proxy. */
export class RealLiverAgent implements OrganAgent {
  readonly organ = 'liver'
  private readonly endpoint: string
  private readonly maxCalls: number
  private readonly timeoutMs: number
  private calls = 0
  private approxTokens = 0
  private readonly entries: UsageEntry[] = []

  constructor(options: RealLiverAgentOptions = {}) {
    this.endpoint = options.endpoint ?? DEFAULT_ENDPOINT
    this.maxCalls = options.maxCalls ?? DEFAULT_MAX_CALLS
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  }

  getUsage(): UsageReport {
    return { calls: this.calls, approxTokens: this.approxTokens, entries: this.entries }
  }

  async respond(state: SystemState): Promise<OrganReply> {
    const valid = SystemStateSchema.parse(state)
    if (this.calls >= this.maxCalls) {
      return fallbackReply(valid)
    }
    const prompt = buildLiverPrompt(valid)
    const first = await this.attempt(valid, prompt)
    if (first !== null) return first
    const second = await this.attempt(valid, prompt)
    if (second !== null) return second
    return fallbackReply(valid)
  }

  /** One POST + parse + validate round. Null on any failure; usage logged. */
  private async attempt(state: SystemState, prompt: string): Promise<OrganReply | null> {
    this.calls += 1
    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ organ: 'liver', state }),
        signal: AbortSignal.timeout(this.timeoutMs),
      })
      if (!response.ok) return null
      const envelope: unknown = await response.json()
      if (typeof envelope !== 'object' || envelope === null) return null
      const text = (envelope as Record<string, unknown>).text
      if (typeof text !== 'string' || text.length === 0 || text.length > MAX_TEXT_CHARS) {
        return null
      }
      this.recordUsage(prompt.length, text.length)
      let data: unknown
      try {
        data = JSON.parse(text) as unknown
      } catch {
        return null
      }
      const reply = OrganReplySchema.safeParse(data)
      if (!reply.success) return null
      if (reply.data.action === undefined) return reply.data
      const clamped = clampAction(reply.data.action.param, reply.data.action.value)
      return { ...reply.data, action: { param: clamped.param, value: clamped.value } }
    } catch {
      return null
    }
  }

  private recordUsage(promptChars: number, completionChars: number): void {
    const approx = approxTokensFor(promptChars, completionChars)
    this.approxTokens += approx
    this.entries.push({ promptChars, completionChars, approxTokens: approx })
  }
}
