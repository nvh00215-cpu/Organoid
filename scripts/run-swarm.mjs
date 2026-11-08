// One swarm run through the live dev proxy, saved for UI replay.
// Live: node scripts/run-swarm.mjs  (requires `npm run dev` on port 5173)
// Dry:  node scripts/run-swarm.mjs --dry  (stubbed agents, no network)
// Writes { request, transcript, summary, usage } and nothing else: no keys,
// no headers, no raw upstream bodies. Prints only counts, the verdict label,
// the file size, and PASS/FAIL. Never prints keys or headers.
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { register } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
register('./swarm-resolve.hook.mjs', import.meta.url)

const DRY = process.argv.includes('--dry')

const FALLBACK_MESSAGES = new Set([
  'Liver agent unreachable; holding current parameters.',
  'Kidney agent unreachable; holding current parameters.',
  'Heart agent unreachable; holding current parameters.',
])

function stubFetch() {
  globalThis.fetch = async (url, init) => {
    const endpoint = String(url)
    if (endpoint.endsWith('/api/narrative')) {
      return { ok: true, json: async () => ({ text: 'Stub narrative.' }) }
    }
    const body = JSON.parse(String(init?.body))
    const text = JSON.stringify({
      message: `Steady ${String(body.organ)}.`,
      distress: 'LOW',
    })
    return { ok: true, json: async () => ({ text }) }
  }
}

function sameKeys(value, expected) {
  if (typeof value !== 'object' || value === null) return false
  const keys = Object.keys(value).sort()
  const want = [...expected].sort()
  return keys.length === want.length && keys.every((k, i) => k === want[i])
}

let swarm
try {
  if (DRY) stubFetch()
  const compounds = await import('../src/model/compounds.ts')
  const runnerMod = await import('../src/swarm/runner.ts')
  const budgetMod = await import('../src/swarm/budget.ts')
  const canonicalMod = await import('../src/swarm/canonical.ts')
  const verdictMod = await import('../src/model/verdict.ts')
  const systemMod = await import('../src/model/systemVerdict.ts')
  const orchMod = await import('../src/swarm/orchestrator.ts')
  swarm = { ...compounds, ...runnerMod, ...budgetMod, ...canonicalMod, ...verdictMod, ...systemMod, ...orchMod }
} catch (err) {
  console.log('Failed to load swarm modules. Requires Node 23.6+ with TS type stripping.')
  console.log(`error: ${err instanceof Error ? err.message : 'unknown'}`)
  process.exit(1)
}

const compound = swarm.COMPOUNDS.acetaminophen
const request = {
  compound,
  doseMgPerKg: swarm.doseForMode(compound, 'high'),
  weightKg: 70,
  horizonHours: 72,
  dosingPattern: 'single',
  seed: 42,
  coupleOrgans: true,
}

const runner = new swarm.SwarmRunner(request, {
  endpoint: 'http://localhost:5173/api/organ',
  narrativeEndpoint: 'http://localhost:5173/api/narrative',
  budget: new swarm.CallBudget(),
  timeoutMs: 30000,
})
const run = await runner.run()
const live = runner.getResult()
const hash = swarm.simResultHash(live)
const verdictLabel = swarm.judgeSystem(live, swarm.judge(live)).headline
const frameCount = live.frames.length

const out = {
  request: run.request,
  transcript: run.transcript,
  summary: { hash, verdictLabel, frameCount },
  usage: run.usage,
}

const outPath = DRY
  ? join(HERE, '.tmp', 'transcript-dry.json')
  : join(HERE, '..', 'public', 'demo', 'transcript-high.json')
mkdirSync(dirname(outPath), { recursive: true })
writeFileSync(outPath, JSON.stringify(out), 'utf8')
const bytes = statSync(outPath).size

const checkpoints = run.transcript.filter((e) => e.kind === 'system').length
console.log(`checkpoints: ${checkpoints}`)
console.log(`calls: ${run.usage.calls}`)
console.log(`approxTokens: ${run.usage.approxTokens}`)
console.log(`verdict: ${verdictLabel}`)

let fallbacks = 0
const organsByTick = new Map()
for (const entry of run.transcript) {
  if (entry.kind !== 'organ') continue
  if (FALLBACK_MESSAGES.has(entry.message)) fallbacks += 1
  const list = organsByTick.get(entry.tick) ?? []
  list.push(entry)
  organsByTick.set(entry.tick, list)
}
for (const entry of run.transcript) {
  if (entry.kind !== 'system') continue
  const sibs = organsByTick.get(entry.tick) ?? []
  const distressOf = (organ) => sibs.find((s) => s.organ === organ)?.distress ?? 'LOW'
  const context = {
    label: entry.label,
    tHours: entry.tHours,
    liver: distressOf('liver'),
    kidney: distressOf('kidney'),
    heart: distressOf('heart'),
  }
  if (entry.narrative === swarm.templateNarrative(context)) fallbacks += 1
}
console.log(`fallbacks: ${fallbacks}`)
console.log(`bytes: ${bytes}`)

let pass = false
try {
  const saved = JSON.parse(readFileSync(outPath, 'utf8'))
  const keysOk =
    sameKeys(saved, ['request', 'transcript', 'summary', 'usage']) &&
    sameKeys(saved.summary, ['hash', 'verdictLabel', 'frameCount'])
  if (keysOk) {
    const replayed = swarm.replayTranscript(saved.request, saved.transcript)
    pass = swarm.simResultHash(replayed) === saved.summary.hash
  }
} catch {
  pass = false
}
console.log(pass ? 'PASS' : 'FAIL')
if (!pass) process.exitCode = 1
