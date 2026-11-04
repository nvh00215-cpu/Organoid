import { frameStrideHours } from '../model/simRunner'
import { GRID_COUNT, NECROTIC } from '../model/types'
import type { SimRequest, SimResult } from '../model/types'
import { judgeSystem } from '../model/systemVerdict'
import { judge } from '../model/verdict'
import { CallBudget } from './budget'
import { canonicalResult } from './canonical'
import { SwarmEngine, summarize } from './engine'
import { narrateSystem } from './orchestrator'
import { HeartAgent, KidneyAgent } from './organAgents'
import { summarizeHeart, summarizeKidney } from './organVitals'
import { RealLiverAgent } from './RealLiverAgent'
import type { AgentAction, AgentReply, Distress } from './types'

export interface OrganTranscriptEntry {
  readonly kind: 'organ'
  readonly tick: number
  readonly tHours: number
  readonly organ: 'liver' | 'kidney' | 'heart'
  readonly distress: Distress
  readonly message: string
  readonly action: AgentAction | null
  readonly applied: boolean
  readonly clamped: boolean
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
  private readonly budget: CallBudget
  private readonly checkpointEvery: number
  private readonly narrativeEndpoint: string
  private readonly timeoutMs: number

  constructor(request: SimRequest, options: SwarmRunnerOptions = {}) {
    this.engine = new SwarmEngine(request)
    this.budget = options.budget ?? new CallBudget()
    const agentOptions = {
      endpoint: options.endpoint,
      timeoutMs: options.timeoutMs,
      budget: this.budget,
    }
    this.liver = new RealLiverAgent(agentOptions)
    this.kidney = new KidneyAgent(agentOptions)
    this.heart = new HeartAgent(agentOptions)
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
    const [liverReply, kidneyReply, heartReply] = await Promise.all([
      this.liver.respond(summarize(result, idx)),
      this.kidney.respond(summarizeKidney(result, idx)),
      this.heart.respond(summarizeHeart(result, idx)),
    ])
    this.recordOrgan(transcript, idx, frame.t, 'liver', liverReply, true)
    this.recordOrgan(transcript, idx, frame.t, 'kidney', kidneyReply, false)
    this.recordOrgan(transcript, idx, frame.t, 'heart', heartReply, false)
    const label = judgeSystem(result, judge(result)).headline
    const narrative = await narrateSystem(
      {
        label,
        tHours: frame.t,
        liver: liverReply.distress,
        kidney: kidneyReply.distress,
        heart: heartReply.distress,
      },
      { endpoint: this.narrativeEndpoint, timeoutMs: this.timeoutMs, budget: this.budget },
    )
    transcript.push({ kind: 'system', tick: idx, tHours: frame.t, label, narrative })
  }

  private recordOrgan(
    transcript: TranscriptEntry[],
    tick: number,
    tHours: number,
    organ: 'liver' | 'kidney' | 'heart',
    reply: AgentReply,
    canAct: boolean,
  ): void {
    let applied = false
    let clamped = false
    if (canAct && reply.action !== undefined) {
      const action = reply.action
      try {
        const requested = reply.requestedAction
        const out = this.engine.setParam(action.param, action.value)
        applied = true
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
      action: reply.action ?? null,
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
