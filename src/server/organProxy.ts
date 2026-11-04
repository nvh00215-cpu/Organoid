/// <reference types="node" />
// Server-only: imported by vite.config.ts (dev middleware). Never import
// this module from client code; it handles the model API key.
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import { z } from 'zod'
import { buildLiverPrompt } from '../swarm/LiverAgent.ts'
import { NarrativeContextSchema, buildSystemPrompt } from '../swarm/orchestrator.ts'
import { buildHeartPrompt, buildKidneyPrompt } from '../swarm/organPrompts.ts'
import { HeartVitalsSchema, KidneyVitalsSchema } from '../swarm/organVitals.ts'
import { SystemStateSchema } from '../swarm/types.ts'

const OrganRequestSchema = z.discriminatedUnion('organ', [
  z.object({ organ: z.literal('liver'), state: SystemStateSchema }),
  z.object({ organ: z.literal('kidney'), state: KidneyVitalsSchema }),
  z.object({ organ: z.literal('heart'), state: HeartVitalsSchema }),
])

export interface OrganProxyOptions {
  readonly apiKey: string
  readonly baseUrl: string
  readonly model: string
}

const MAX_BODY_BYTES = 65536
const MAX_TEXT_CHARS = 4000
const UPSTREAM_TIMEOUT_MS = 25000
const MAX_OUTPUT_TOKENS = 1000
const REASONING_EFFORT = 'minimal'

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

function readBody(req: IncomingMessage, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > maxBytes) {
        reject(new Error('body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

/** Tolerant extraction of model text from an OpenAI-compatible payload. */
function extractText(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null
  const root = payload as Record<string, unknown>
  if (typeof root.output_text === 'string' && root.output_text.length > 0) {
    return root.output_text
  }
  if (typeof root.text === 'string' && root.text.length > 0) {
    return root.text
  }
  const output = root.output
  if (!Array.isArray(output)) return null
  let combined = ''
  for (const item of output) {
    if (typeof item !== 'object' || item === null) continue
    const record = item as Record<string, unknown>
    const content = record.content
    const blocks: unknown[] = Array.isArray(content) ? content : [record]
    for (const block of blocks) {
      if (typeof block !== 'object' || block === null) continue
      const b = block as Record<string, unknown>
      const text = b.output_text ?? b.text
      if (typeof text === 'string' && text.length > 0) combined += text
    }
  }
  return combined.length > 0 ? combined : null
}

async function callModel(options: OrganProxyOptions, prompt: string): Promise<string> {
  const response = await fetch(`${options.baseUrl}/responses`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${options.apiKey}`,
    },
    body: JSON.stringify({
      model: options.model,
      input: prompt,
      reasoning: { effort: REASONING_EFFORT },
      max_output_tokens: MAX_OUTPUT_TOKENS,
    }),
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  })
  if (!response.ok) {
    throw new Error(`upstream status ${response.status}`)
  }
  const payload: unknown = await response.json()
  const text = extractText(payload)
  if (text === null) {
    throw new Error('unparseable model response')
  }
  return text
}

async function handleOrganRequest(
  req: IncomingMessage,
  res: ServerResponse,
  options: OrganProxyOptions,
): Promise<void> {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed' })
    return
  }
  if (options.apiKey === '') {
    sendJson(res, 500, { error: 'Model API key is not configured' })
    return
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(await readBody(req, MAX_BODY_BYTES)) as unknown
  } catch {
    sendJson(res, 400, { error: 'Invalid JSON body' })
    return
  }
  const request = OrganRequestSchema.safeParse(parsed)
  if (!request.success) {
    sendJson(res, 400, { error: 'Invalid organ request' })
    return
  }
  let prompt: string
  if (request.data.organ === 'liver') {
    prompt = buildLiverPrompt(request.data.state)
  } else if (request.data.organ === 'kidney') {
    prompt = buildKidneyPrompt(request.data.state)
  } else {
    prompt = buildHeartPrompt(request.data.state)
  }
  try {
    const text = await callModel(options, prompt)
    sendJson(res, 200, { text })
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (message === 'unparseable model response') {
      sendJson(res, 502, { error: 'Model returned an unparseable response' })
    } else {
      sendJson(res, 502, { error: 'Model call failed' })
    }
  }
}

async function handleNarrativeRequest(
  req: IncomingMessage,
  res: ServerResponse,
  options: OrganProxyOptions,
): Promise<void> {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed' })
    return
  }
  if (options.apiKey === '') {
    sendJson(res, 500, { error: 'Model API key is not configured' })
    return
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(await readBody(req, MAX_BODY_BYTES)) as unknown
  } catch {
    sendJson(res, 400, { error: 'Invalid JSON body' })
    return
  }
  const request = NarrativeContextSchema.safeParse(parsed)
  if (!request.success) {
    sendJson(res, 400, { error: 'Invalid narrative request' })
    return
  }
  try {
    const text = await callModel(options, buildSystemPrompt(request.data))
    if (text.length > MAX_TEXT_CHARS) {
      sendJson(res, 502, { error: 'Model returned an unparseable response' })
      return
    }
    sendJson(res, 200, { text })
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (message === 'unparseable model response') {
      sendJson(res, 502, { error: 'Model returned an unparseable response' })
    } else {
      sendJson(res, 502, { error: 'Model call failed' })
    }
  }
}

export function organProxyPlugin(options: OrganProxyOptions): Plugin {
  return {
    name: 'organ-proxy',
    configureServer(server) {
      server.middlewares.use('/api/organ', (req, res) => {
        void handleOrganRequest(req, res, options).catch(() => {
          if (!res.headersSent) {
            sendJson(res, 500, { error: 'Organ proxy failed' })
          }
        })
      })
      server.middlewares.use('/api/narrative', (req, res) => {
        void handleNarrativeRequest(req, res, options).catch(() => {
          if (!res.headersSent) {
            sendJson(res, 500, { error: 'Organ proxy failed' })
          }
        })
      })
    },
  }
}
