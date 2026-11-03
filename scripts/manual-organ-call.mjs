// Manual smoke test for POST /api/organ. Requires `npm run dev` running.
// Usage: node scripts/manual-organ-call.mjs
// Prints only the status and the model reply text or error message.
// It never prints keys, headers, or environment values.
const state = {
  tick: 40,
  tHours: 20.0,
  gshPct: 30.0,
  necroticFraction: 0.2,
  plasma: 5.0,
  toxinOutput: 0.2,
  exposureIndex: 1.5,
  meanChronicLoad: 0.1,
}

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
