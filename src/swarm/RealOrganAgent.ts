import { clampAction } from './clamp'
import type { CallBudget } from './budget'
import type { OrganAgent } from './LiverAgent'
import { OrganReplySchema } from './types'
import type { AgentReply, Distress } from './types'

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

export interface RealOrganAgentOptions {
  readonly endpoint?: string
  readonly maxCalls?: number
  readonly timeoutMs?: number
  readonly budget?: CallBudget
}

export interface OrganAgentDeps<V> extends RealOrganAgentOptions {
  readonly organ: string
  readonly parseVitals: (value: unknown) => V
  readonly buildPrompt: (vitals: V) => string
  readonly fallbackDistress: (vitals: V) => Distress
  readonly fallbackMessage: string
}

const DEFAULT_ENDPOINT = '/api/organ'
const DEFAULT_MAX_CALLS = 60
const DEFAULT_TIMEOUT_MS = 30000
const MAX_TEXT_CHARS = 4000

/** Documented heuristic: no tokenizer dependency. */
function approxTokensFor(promptChars: number, completionChars: number): number {
  return Math.ceil((promptChars + completionChars) / 4)
}

/** Generic LLM-backed organ agent. Sends engine numbers through the local proxy. */
export class RealOrganAgent<V> implements OrganAgent<V> {
  readonly organ: string
  private readonly parseVitals: (value: unknown) => V
  private readonly buildPrompt: (vitals: V) => string
  private readonly fallbackDistress: (vitals: V) => Distress
  private readonly fallbackMessage: string
  private readonly endpoint: string
  private readonly maxCalls: number
  private readonly timeoutMs: number
  private readonly budget?: CallBudget
  private calls = 0
  private approxTokens = 0
  private readonly entries: UsageEntry[] = []

  constructor(deps: OrganAgentDeps<V>) {
    this.organ = deps.organ
    this.parseVitals = deps.parseVitals
    this.buildPrompt = deps.buildPrompt
    this.fallbackDistress = deps.fallbackDistress
    this.fallbackMessage = deps.fallbackMessage
    this.endpoint = deps.endpoint ?? DEFAULT_ENDPOINT
    this.maxCalls = deps.maxCalls ?? DEFAULT_MAX_CALLS
    this.timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.budget = deps.budget
  }

  getUsage(): UsageReport {
    return { calls: this.calls, approxTokens: this.approxTokens, entries: this.entries }
  }

  async respond(state: V): Promise<AgentReply> {
    const valid = this.parseVitals(state)
    const prompt = this.buildPrompt(valid)
    const first = await this.attempt(valid, prompt)
    if (first !== null) return first
    const second = await this.attempt(valid, prompt)
    if (second !== null) return second
    return { message: this.fallbackMessage, distress: this.fallbackDistress(valid) }
  }

  private allowsCall(): boolean {
    if (this.budget !== undefined) {
      if (!this.budget.tryReserve()) return false
      this.calls += 1
      return true
    }
    if (this.calls >= this.maxCalls) return false
    this.calls += 1
    return true
  }

  /** One POST + parse + validate round. Null on any failure; usage logged. */
  private async attempt(vitals: V, prompt: string): Promise<AgentReply | null> {
    if (!this.allowsCall()) return null
    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ organ: this.organ, state: vitals }),
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
      const original = reply.data.action
      const clamped = clampAction(original.param, original.value)
      if (!clamped.clamped) return reply.data
      return {
        ...reply.data,
        action: { param: clamped.param, value: clamped.value },
        requestedAction: original,
      }
    } catch {
      return null
    }
  }

  private recordUsage(promptChars: number, completionChars: number): void {
    const approx = approxTokensFor(promptChars, completionChars)
    this.approxTokens += approx
    this.entries.push({ promptChars, completionChars, approxTokens: approx })
    this.budget?.recordTokens(approx)
  }
}
