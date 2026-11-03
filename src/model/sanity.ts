import { COMPOUNDS, DEFAULT_CUSTOM, customToCompound, doseForMode } from './compounds.ts'
import { simulate } from './simulate.ts'
import { judge } from './verdict.ts'
import type { DosingPattern } from './types.ts'

function run(
  label: string,
  compound: (typeof COMPOUNDS)['acetaminophen'],
  mode: 'low' | 'therapeutic' | 'high',
  opts?: { dose?: number; days?: number; pattern?: DosingPattern; couple?: boolean },
) {
  const dose = opts?.dose ?? doseForMode(compound, mode)
  const days = opts?.days ?? 3
  const pattern = opts?.pattern ?? 'single'
  const result = simulate({
    compound,
    doseMgPerKg: dose,
    weightKg: 70,
    horizonHours: days * 24,
    dosingPattern: pattern,
    seed: 42,
    coupleOrgans: opts?.couple === true,
  })
  const v = judge(result)
  const [z1, , z3] = result.meanFinalZoneDamage
  let minD = 1
  let maxD = 0
  const last = result.frames[result.frames.length - 1].damage
  for (let i = 0; i < last.length; i++) {
    minD = Math.min(minD, last[i])
    maxD = Math.max(maxD, last[i])
  }
  console.log(
    `${label}\n  dose=${dose.toFixed(1)} mg/kg  ${pattern}  ${days}d  verdict=${v.kind}/${v.label}  necrotic=${(result.fracNecrotic * 100).toFixed(1)}%  chronic=${result.meanChronicLoad.toFixed(3)}  Z1=${z1.toFixed(3)} Z3=${z3.toFixed(3)}  fail=${result.failureType}  d=[${minD.toFixed(3)}, ${maxD.toFixed(3)}]\n  kidney d=${result.kidneyPeakMeanDamage.toFixed(3)} med=${result.kidneyPeakMedulla.toFixed(2)} frac=${(result.kidneyFracInjured * 100).toFixed(1)}%  heart herg=${result.heartPeakHerg.toFixed(2)} d=${result.heartPeakDamage.toFixed(3)}  brain c=${result.brainPeakConc.toFixed(2)} d=${result.brainPeakDamage.toFixed(3)}\n`,
  )
}

run('1 APAP therapeutic single 3d', COMPOUNDS.acetaminophen, 'therapeutic')
run('2 APAP high single 3d', COMPOUNDS.acetaminophen, 'high')
run('2c APAP high coupled 3d', COMPOUNDS.acetaminophen, 'high', { couple: true })

const tiny = customToCompound({ ...DEFAULT_CUSTOM, cypStrength: 0.2, metaboliteThreshold: 1.1 })
run('3 custom tiny / high threshold', tiny, 'low', { dose: 4 })

const huge = customToCompound({ ...DEFAULT_CUSTOM, cypStrength: 2.2, metaboliteThreshold: 0.12 })
run('4 custom huge / low threshold', huge, 'high')

run('5a APAP therapeutic repeated 30d', COMPOUNDS.acetaminophen, 'therapeutic', {
  pattern: 'repeated',
  days: 30,
})
run('5b APAP 32 mg/kg repeated 30d', COMPOUNDS.acetaminophen, 'therapeutic', {
  dose: 32,
  pattern: 'repeated',
  days: 30,
})
