import { frameStrideHours } from '../model/simRunner'
import { GRID_COUNT, NECROTIC } from '../model/types'
import type { SimRequest, SimResult } from '../model/types'
import { judgeSystem } from '../model/systemVerdict'
import { judge } from '../model/verdict'
import { CallBudget, DEFAULT_MAX_CALLS, DEFAULT_RESERVE_CALLS } from './budget'
import { canonicalResult } from './canonical'
import { SwarmEngine, summarize } from './engine'
import { narrateSystem } from './orchestrator'
import { BrainAgent, HeartAgent, KidneyAgent } from './organAgents'
import { summarizeBrain, summarizeHeart, summarizeKidney } from './organVitals'
import { RealLiverAgent } from './RealLiverAgent'
import { BRAIN_SETTABLE_PARAMS, WHITELISTED_PARAMS } from './types'
import type { AgentAction, AgentReply, Distress, SettableParam } from './types'

export interface OrganTranscriptEntry {
  readonly kind: 'organ'
  readonly tick: number
  readonly tHours: number
  readonly organ: 'liver' | 'kidney' | 'heart' | 'brain'
  readonly distress: Distress
  readonly message: string
  readonly action: AgentAction | null
  readonly applied: boolean
  readonly clamped: boolean
  /** Pre-clamp requested value. Brain entries with a recorded action only. */
  readonly requested?: number
}

export interface SystemTranscriptEntry {
  readonly kind: 'system'
  readonly tick: number
  readonly tHours: number
  readonly label: string
  readonly narrative: string
}

export type TranscriptEntry = OrganTranscriptEntry | SystemTranscriptEntry

export interface SwarmRunResult {
  readonly request: SimRequest
  readonly transcript: readonly TranscriptEntry[]
  readonly finalResult: unknown
  readonly usage: { readonly calls: number; readonly approxTokens: number }
}

export interface SwarmRunnerOptions {
  readonly checkpointEvery?: number
  readonly budget?: CallBudget
  readonly endpoint?: string
  readonly narrativeEndpoint?: string
  readonly timeoutMs?: number
  readonly includeBrain?: boolean
}

const NECROSIS_TRIGGER_BANDS = [0.05, 0.15, 0.25]

function necrosisBand(result: SimResult): number {
  const frame = result.frames[result.frames.length - 1]
  let necrotic = 0
  for (let i = 0; i < GRID_COUNT; i++) {
    if (frame.damage[i] > NECROTIC) necrotic++
  }
  const frac = necrotic / GRID_COUNT
  let band = 0
  for (let b = 0; b < NECROSIS_TRIGGER_BANDS.length; b++) {
    if (frac >= NECROSIS_TRIGGER_BANDS[b]) band = b + 1
  }
  return band
}

export class SwarmRunner {
  private readonly engine: SwarmEngine
  private readonly liver: RealLiverAgent
  private readonly kidney: KidneyAgent
  private readonly heart: HeartAgent
  private readonly brain: BrainAgent
  private readonly includeBrain: boolean
  private readonly budget: CallBudget
  private readonly checkpointEvery: number
  private readonly narrativeEndpoint: string
  private readonly timeoutMs: number

  constructor(request: SimRequest, options: SwarmRunnerOptions = {}) {
    this.engine = new SwarmEngine(request)
    this.includeBrain = options.includeBrain === true
    this.budget =
      options.budget ??
      new CallBudget(
        DEFAULT_MAX_CALLS,
        this.includeBrain ? DEFAULT_RESERVE_CALLS + 1 : DEFAULT_RESERVE_CALLS,
      )
    const agentOptions = {
      endpoint: options.endpoint,
      timeoutMs: options.timeoutMs,
      budget: this.budget,
    }
    this.liver = new RealLiverAgent(agentOptions)
    this.kidney = new KidneyAgent(agentOptions)
    this.heart = new HeartAgent(agentOptions)
    this.brain = new BrainAgent(agentOptions)
    const stride = frameStrideHours(request.horizonHours)
    const estimatedFrames = Math.floor(request.horizonHours / stride) + 2
    this.checkpointEvery = Math.max(
      1,
      Math.floor(options.checkpointEvery ?? Math.round(estimatedFrames / 12)),
    )
    this.narrativeEndpoint = options.narrativeEndpoint ?? '/api/narrative'
    this.timeoutMs = options.timeoutMs ?? 30000
  }

  getResult(): SimResult {
    return this.engine.getResult()
  }

  async run(): Promise<SwarmRunResult> {
    const transcript: TranscriptEntry[] = []
    let framesSinceCheckpoint = 0
    let lastBand = 0
    for (;;) {
      const before = this.engine.getFrameCount()
      this.engine.runUntil(before)
      const result = this.engine.getResult()
      const done = this.engine.isDone()
      if (this.engine.getFrameCount() > before) {
        framesSinceCheckpoint += 1
      }
      const band = necrosisBand(result)
      const crossed = band > lastBand
      lastBand = Math.max(lastBand, band)
      if (done || framesSinceCheckpoint >= this.checkpointEvery || crossed) {
        if (done) {
          this.budget.releaseReserve()
        }
        await this.checkpoint(transcript)
        framesSinceCheckpoint = 0
      }
      if (done) break
    }
    return {
      request: this.engine.getRequest(),
      transcript,
      finalResult: canonicalResult(this.engine.getResult()),
      usage: { calls: this.budget.getCalls(), approxTokens: this.budget.getApproxTokens() },
    }
  }

  private async checkpoint(transcript: TranscriptEntry[]): Promise<void> {
    const result = this.engine.getResult()
    const idx = result.frames.length - 1
    const frame = result.frames[idx]
    const [liverReply, kidneyReply, heartReply, brainReply] = await Promise.all([
      this.liver.respond(summarize(result, idx)),
      this.kidney.respond(summarizeKidney(result, idx)),
      this.heart.respond(summarizeHeart(result, idx)),
      ...(this.includeBrain
        ? [this.brain.respond(summarizeBrain(result, idx, this.engine.getCompound().kBrainEfflux ?? 1))]
        : []),
    ])
    this.recordOrgan(transcript, idx, frame.t, 'liver', liverReply, WHITELISTED_PARAMS)
    this.recordOrgan(transcript, idx, frame.t, 'kidney', kidneyReply, [])
    this.recordOrgan(transcript, idx, frame.t, 'heart', heartReply, [])
    if (this.includeBrain && brainReply !== undefined) {
      this.recordOrgan(transcript, idx, frame.t, 'brain', brainReply, BRAIN_SETTABLE_PARAMS)
    }
    const label = judgeSystem(result, judge(result)).headline
    const narrative = await narrateSystem(
      {
        label,
        tHours: frame.t,
        liver: liverReply.distress,
        kidney: kidneyReply.distress,
        heart: heartReply.distress,
        ...(this.includeBrain && brainReply !== undefined ? { brain: brainReply.distress } : null),
      },
      { endpoint: this.narrativeEndpoint, timeoutMs: this.timeoutMs, budget: this.budget },
    )
    transcript.push({ kind: 'system', tick: idx, tHours: frame.t, label, narrative })
  }

  private recordOrgan(
    transcript: TranscriptEntry[],
    tick: number,
    tHours: number,
    organ: 'liver' | 'kidney' | 'heart' | 'brain',
    reply: AgentReply,
    allowedParams: readonly SettableParam[],
  ): void {
    let applied = false
    let clamped = false
    const allowedAction = reply.action
    const allowed =
      allowedAction !== undefined && allowedParams.includes(allowedAction.param)
    const requestedValue = reply.requestedAction?.value ?? reply.action?.value
    let appliedAction: AgentAction | null = null
    if (allowed && allowedAction !== undefined) {
      const action: AgentAction = allowedAction
      try {
        const requested = reply.requestedAction
        const out = this.engine.setParam(action.param, action.value)
        applied = true
        appliedAction = { param: action.param, value: out.appliedValue }
        clamped =
          out.clamped ||
          (requested !== undefined &&
            (requested.param !== action.param ||
              requested.value !== action.value))
      } catch {
        applied = false
      }
    }
    transcript.push({
      kind: 'organ',
      tick,
      tHours,
      organ,
      distress: reply.distress,
      message: reply.message,
      action: !allowed
        ? organ === 'brain'
          ? null
          : (reply.action ?? null)
        : applied && appliedAction !== null
          ? appliedAction
          : (reply.action ?? null),
      ...(organ === 'brain' && allowed && requestedValue !== undefined
        ? { requested: requestedValue }
        : null),
      applied,
      clamped,
    })
  }
}

export function replayTranscript(
  request: SimRequest,
  transcript: readonly TranscriptEntry[],
): SimResult {
  const engine = new SwarmEngine(request)
  for (const entry of transcript) {
    if (entry.kind !== 'organ' || entry.action === null || !entry.applied) continue
    engine.runUntil(entry.tick)
    engine.setParam(entry.action.param, entry.action.value)
  }
  engine.runToEnd()
  return engine.getResult()
}
