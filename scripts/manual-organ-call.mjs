// Manual smoke test for POST /api/organ. Requires `npm run dev` running.
// Usage: node scripts/manual-organ-call.mjs [--state safe|moderate|crisis]
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

function pickState() {
  const flag = process.argv.indexOf('--state')
  if (flag === -1) return STATES.default
  const name = process.argv[flag + 1]
  if (name === 'safe' || name === 'moderate' || name === 'crisis') return STATES[name]
  console.log(`Unknown --state "${name ?? '(missing)'}". Use safe, moderate, or crisis.`)
  process.exit(1)
}

const state = pickState()

const response = await fetch('http://localhost:5173/api/organ', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ organ: 'liver', state }),
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
