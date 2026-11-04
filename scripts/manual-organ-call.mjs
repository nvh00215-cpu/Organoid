// Manual smoke test for POST /api/organ. Requires `npm run dev` running.
// Usage: node scripts/manual-organ-call.mjs [--state safe|moderate|crisis] [--organ liver|kidney|heart]
//        node scripts/manual-organ-call.mjs --narrative [--state safe|moderate|crisis]
// Prints only the status and the model reply text or error message.
// It never prints keys, headers, or environment values.
const STATES = {
  default: {
    tick: 40,
    tHours: 20.0,
    gshPct: 30.0,
    necroticFraction: 0.2,
    plasma: 5.0,
    toxinOutput: 0.2,
    exposureIndex: 1.5,
    meanChronicLoad: 0.1,
  },
  safe: {
    tick: 10,
    tHours: 5.0,
    gshPct: 85.0,
    necroticFraction: 0.0,
    plasma: 8.0,
    toxinOutput: 0.03,
    exposureIndex: 0.2,
    meanChronicLoad: 0.05,
  },
  moderate: {
    tick: 40,
    tHours: 20.0,
    gshPct: 45.0,
    necroticFraction: 0.08,
    plasma: 5.0,
    toxinOutput: 0.15,
    exposureIndex: 1.2,
    meanChronicLoad: 0.2,
  },
  crisis: {
    tick: 60,
    tHours: 30.0,
    gshPct: 10.0,
    necroticFraction: 0.3,
    plasma: 12.0,
    toxinOutput: 0.5,
    exposureIndex: 4.0,
    meanChronicLoad: 0.4,
  },
}

function pickStateName() {
  const flag = process.argv.indexOf('--state')
  if (flag === -1) return 'default'
  const name = process.argv[flag + 1]
  if (name === 'safe' || name === 'moderate' || name === 'crisis') return name
  console.log(`Unknown --state "${name ?? '(missing)'}". Use safe, moderate, or crisis.`)
  process.exit(1)
}

const stateName = pickStateName()
const state = STATES[stateName]

const VITALS = {
  kidney: { tick: 40, tHours: 20.0, medullaMean: 4.2, damageMean: 0.15, injuryFrac: 0.1, cortexMean: 2.1, corticalLoadNorm: 0.1, recoveryIndex: 0.9 },
  heart: { tick: 40, tHours: 20.0, herg: 0.45, damage: 0.12, qtLoadNorm: 0.2, qtTimeFrac: 0.3, washoutIndex: 0.8 },
}

const NARRATIVES = {
  default: { label: 'RENAL RISK', tHours: 20.0, liver: 'HIGH', kidney: 'MODERATE', heart: 'LOW' },
  safe: { label: 'NO ORGAN THRESHOLD CROSSED', tHours: 5.0, liver: 'LOW', kidney: 'LOW', heart: 'LOW' },
  moderate: { label: 'RENAL RISK', tHours: 20.0, liver: 'HIGH', kidney: 'MODERATE', heart: 'LOW' },
  crisis: { label: 'LIVER FAILURE', tHours: 30.0, liver: 'CRITICAL', kidney: 'HIGH', heart: 'MODERATE' },
}

function pickMode() {
  const organFlag = process.argv.indexOf('--organ')
  const narrative = process.argv.includes('--narrative')
  if (narrative && organFlag !== -1) {
    console.log('Use either --narrative or --organ, not both.')
    process.exit(1)
  }
  if (narrative) return { kind: 'narrative' }
  if (organFlag === -1) return { kind: 'organ', organ: 'liver' }
  const organ = process.argv[organFlag + 1]
  if (organ === 'liver' || organ === 'kidney' || organ === 'heart') return { kind: 'organ', organ }
  console.log(`Unknown --organ "${organ ?? '(missing)'}". Use liver, kidney, or heart.`)
  process.exit(1)
}

const mode = pickMode()
const url =
  mode.kind === 'narrative'
    ? 'http://localhost:5173/api/narrative'
    : 'http://localhost:5173/api/organ'
const payload =
  mode.kind === 'narrative'
    ? NARRATIVES[stateName]
    : mode.organ === 'liver'
      ? { organ: 'liver', state }
      : { organ: mode.organ, state: VITALS[mode.organ] }

const response = await fetch(url, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(payload),
  signal: AbortSignal.timeout(60000),
})
console.log(`status: ${response.status}`)
const body = await response.json()
if (response.ok) {
  console.log('reply text:')
  console.log(body.text)
} else {
  console.log(`error: ${body.error ?? 'unknown'}`)
  process.exitCode = 1
}
