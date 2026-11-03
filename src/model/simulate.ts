import {
  ACUTE_FAIL_FRAC,
  CHRONIC_FAIL_HOLD_H,
  CHRONIC_FAIL_LOAD,
  DT,
  GRID_COLS,
  GRID_COUNT,
  GRID_ROWS,
  NECROTIC,
} from './types'
import type { ChartPoint, FailureType, SimFrame, SimRequest, SimResult } from './types'
import { buildNeighborTable, buildPerfusion } from './grid'
import {
  aggregateDamage,
  freshZones,
  meanMetabolite,
  stepChronicLoad,
  stepLobule,
} from './lobuleOde'
import type { ZoneState } from './lobuleOde'
import { stepBrain } from './brain'
import { hergBlock, stepHeart } from './heart'
import { stepKidney } from './kidney'
import { bolusDelta, initialPlasma, injectIfDue } from './plasma'
import { exposureFold, stepCoupledPlasma, typicalPlasma } from './systemicPlasma'

let neighborCache: number[][] | null = null

function neighbors(): number[][] {
  neighborCache ??= buildNeighborTable()
  return neighborCache
}

/** Fewer stored frames on long horizons; dt itself stays fixed. */
export function frameStrideHours(horizonHours: number): number {
  if (horizonHours <= 96) return 0.5
  if (horizonHours <= 336) return 2
  return 6
}

export function simulate(request: SimRequest): SimResult {
  const { compound, doseMgPerKg, horizonHours, dosingPattern, seed } = request
  const coupleOrgans = request.coupleOrgans === true
  const perfusion = buildPerfusion(seed)
  const nbrs = neighbors()
  const lobules: [ZoneState, ZoneState, ZoneState][] = Array.from(
    { length: GRID_COUNT },
    () => freshZones(),
  )
  const chronic = new Float32Array(GRID_COUNT)
  const emaM = new Float32Array(GRID_COUNT)
  const kidneyCortex = new Float32Array(GRID_COUNT)
  const kidneyMedulla = new Float32Array(GRID_COUNT)
  const kidneyDamage = new Float32Array(GRID_COUNT)
  const bolus = bolusDelta(doseMgPerKg, compound)
  const typical = typicalPlasma(compound)

  let plasma = initialPlasma(doseMgPerKg, compound)
  const damages = new Float32Array(GRID_COUNT)
  const frames: SimFrame[] = []
  const series: ChartPoint[] = []
  const stress = new Float32Array(GRID_COUNT)
  const kidneyStress = new Float32Array(GRID_COUNT)
  let heartDamage = 0
  let heartHerg = hergBlock(exposureFold(plasma, typical), compound.heartScale)
  let brainConc = 0
  let brainDamage = 0
  let kidneyClearance = 0
  let heartClearance = 0
  let brainClearance = 0
  let metaboliteOutput = 0
  let kidneyPeakMedulla = 0
  let kidneyPeakMeanDamage = 0
  let heartPeakHerg = heartHerg
  let heartPeakDamage = 0
  let brainPeakConc = 0
  let brainPeakDamage = 0
  let lastKidneyMean = 0
  let lastKidneyMedulla = 0
  let exposureIndex = 0

  let peakZone3Metabolite = 0
  let timeAbove = 0
  let timeChronicHigh = 0
  let consecutiveChronicHigh = 0
  let failedAt: number | null = null
  let failureType: FailureType = null
  const stride = frameStrideHours(horizonHours)
  let lastSample = -stride

  const snapshot = (t: number) => {
    const damage = new Float32Array(GRID_COUNT)
    const zoneDamage = new Float32Array(GRID_COUNT * 3)
    const chronicLoad = new Float32Array(GRID_COUNT)
    const kCortex = new Float32Array(GRID_COUNT)
    const kMedulla = new Float32Array(GRID_COUNT)
    const kDamage = new Float32Array(GRID_COUNT)
    let c1 = 0
    let c3 = 0
    let m1 = 0
    let m3 = 0
    let d1 = 0
    let d3 = 0
    let meanD = 0
    let meanC = 0
    let gSum = 0
    let g3 = 0
    for (let i = 0; i < GRID_COUNT; i++) {
      const z = lobules[i]
      const d = damages[i]
      damage[i] = d
      chronicLoad[i] = chronic[i]
      kCortex[i] = kidneyCortex[i]
      kMedulla[i] = kidneyMedulla[i]
      kDamage[i] = kidneyDamage[i]
      zoneDamage[i * 3] = z[0].d
      zoneDamage[i * 3 + 1] = z[1].d
      zoneDamage[i * 3 + 2] = z[2].d
      c1 += z[0].c
      c3 += z[2].c
      m1 += z[0].m
      m3 += z[2].m
      d1 += z[0].d
      d3 += z[2].d
      meanD += d
      meanC += chronic[i]
      gSum += z[0].g + z[1].g + z[2].g
      g3 += z[2].g
    }
    const n = GRID_COUNT
    const foldNow = exposureFold(plasma, typical)
    frames.push({
      t,
      damage,
      zoneDamage,
      chronicLoad,
      kidneyCortex: kCortex,
      kidneyMedulla: kMedulla,
      kidneyDamage: kDamage,
      heartHerg,
      heartDamage,
      brainConc,
      brainDamage,
    })
    series.push({
      t,
      plasma,
      zone1C: c1 / n,
      zone3C: c3 / n,
      zone1M: m1 / n,
      zone3M: m3 / n,
      zone1D: d1 / n,
      zone3D: d3 / n,
      meanDamage: meanD / n,
      meanChronic: meanC / n,
      meanGsh: gSum / (n * 3),
      zone3Gsh: g3 / n,
      exposureIndex,
      exposureFold: foldNow,
      kidneyMedulla: lastKidneyMedulla,
      kidneyDamage: lastKidneyMean,
      heartHerg,
      heartDamage,
      brainConc,
      brainDamage,
    })
  }

  snapshot(0)

  const steps = Math.round(horizonHours / DT)
  for (let s = 1; s <= steps; s++) {
    const t = s * DT
    plasma = injectIfDue(plasma, t, DT, dosingPattern, bolus)
    for (let i = 0; i < GRID_COUNT; i++) {
      const list = nbrs[i]
      let acc = 0
      for (const j of list) acc += Math.max(0, damages[j] - 0.4)
      stress[i] = compound.kNeighbor * (acc / Math.max(1, list.length))
    }

    let meanM3 = 0
    let meanL = 0
    let necrotic = 0
    for (let i = 0; i < GRID_COUNT; i++) {
      const z = lobules[i]
      const instantM = meanMetabolite(z)
      const nextC = stepChronicLoad(chronic[i], emaM[i], instantM, DT)
      chronic[i] = nextC.load
      emaM[i] = nextC.emaM
      const inlet = perfusion[i] * plasma
      stepLobule(z, inlet, stress[i], perfusion[i], chronic[i], compound, DT)
      damages[i] = aggregateDamage(z)
      meanM3 += z[2].m
      meanL += chronic[i]
      if (damages[i] > NECROTIC) necrotic++
    }
    meanM3 /= GRID_COUNT
    meanL /= GRID_COUNT
    exposureIndex += meanM3 * DT
    const fracN = necrotic / GRID_COUNT
    if (meanM3 > peakZone3Metabolite) peakZone3Metabolite = meanM3
    if (meanM3 > compound.metaboliteThreshold) timeAbove += DT

    const fold = exposureFold(plasma, typical)
    const kidney = stepKidney(
      kidneyCortex,
      kidneyMedulla,
      kidneyDamage,
      perfusion,
      nbrs,
      kidneyStress,
      fold,
      compound.kidneyScale,
      DT,
    )
    const heart = stepHeart(heartDamage, fold, compound.heartScale, DT)
    const brain = stepBrain(brainConc, brainDamage, fold, compound.brainScale, DT)
    heartDamage = heart.damage
    heartHerg = heart.herg
    brainConc = brain.conc
    brainDamage = brain.damage
    kidneyClearance = kidney.clearanceRate
    heartClearance = heart.clearanceRate
    brainClearance = brain.clearanceRate
    metaboliteOutput = meanM3 + kidney.metaboliteOutput
    lastKidneyMean = kidney.meanDamage
    lastKidneyMedulla = kidney.meanMedulla
    if (kidney.meanMedulla > kidneyPeakMedulla) kidneyPeakMedulla = kidney.meanMedulla
    if (kidney.meanDamage > kidneyPeakMeanDamage) kidneyPeakMeanDamage = kidney.meanDamage
    if (heart.herg > heartPeakHerg) heartPeakHerg = heart.herg
    if (heart.damage > heartPeakDamage) heartPeakDamage = heart.damage
    if (brain.conc > brainPeakConc) brainPeakConc = brain.conc
    if (brain.damage > brainPeakDamage) brainPeakDamage = brain.damage

    if (meanL > CHRONIC_FAIL_LOAD) {
      consecutiveChronicHigh += DT
      timeChronicHigh += DT
    } else {
      consecutiveChronicHigh = 0
    }

    const acuteHit = fracN > ACUTE_FAIL_FRAC
    const chronicHit = consecutiveChronicHigh >= CHRONIC_FAIL_HOLD_H
    if (acuteHit || chronicHit) {
      failedAt = t
      failureType = acuteHit && chronicHit ? 'both' : acuteHit ? 'acute' : 'chronic'
    }

    const extraClearance = coupleOrgans
      ? kidney.clearanceRate + heart.clearanceRate + brain.clearanceRate
      : 0
    plasma = stepCoupledPlasma(plasma, compound, DT, extraClearance)

    if (t - lastSample >= stride - 1e-9 || s === steps || failedAt !== null) {
      snapshot(t)
      lastSample = t
    }

    if (failedAt !== null) break
  }

  const last = frames[frames.length - 1]
  let necrotic = 0
  let hottest = 0
  let hottestD = -1
  let kidneyHottest = 0
  let kidneyHottestD = -1
  let meanFinal = 0
  let meanL = 0
  let kidneyInjured = 0
  let gFinal = 0
  const meanZ: [number, number, number] = [0, 0, 0]
  for (let i = 0; i < GRID_COUNT; i++) {
    const d = last.damage[i]
    const kd = last.kidneyDamage[i]
    meanFinal += d
    meanL += last.chronicLoad[i]
    gFinal += lobules[i][0].g + lobules[i][1].g + lobules[i][2].g
    if (d > NECROTIC) necrotic++
    if (kd > NECROTIC) kidneyInjured++
    if (d > hottestD) {
      hottestD = d
      hottest = i
    }
    if (kd > kidneyHottestD) {
      kidneyHottestD = kd
      kidneyHottest = i
    }
    meanZ[0] += last.zoneDamage[i * 3]
    meanZ[1] += last.zoneDamage[i * 3 + 1]
    meanZ[2] += last.zoneDamage[i * 3 + 2]
  }
  meanFinal /= GRID_COUNT
  meanL /= GRID_COUNT
  meanZ[0] /= GRID_COUNT
  meanZ[1] /= GRID_COUNT
  meanZ[2] /= GRID_COUNT
  const meanFinalGsh = gFinal / (GRID_COUNT * 3)

  return {
    request,
    cols: GRID_COLS,
    rows: GRID_ROWS,
    perfusion,
    frames,
    series,
    peakZone3Metabolite,
    timeAboveThresholdHours: timeAbove,
    fracNecrotic: necrotic / GRID_COUNT,
    meanFinalDamage: meanFinal,
    maxFinalDamage: hottestD,
    meanFinalZoneDamage: meanZ,
    meanChronicLoad: meanL,
    timeChronicHighHours: timeChronicHigh,
    hottestIndex: hottest,
    failedAt,
    failureType,
    dt: DT,
    coupleOrgans,
    kidneyMeanDamage: lastKidneyMean,
    kidneyPeakMeanDamage,
    kidneyFracInjured: kidneyInjured / GRID_COUNT,
    kidneyPeakMedulla,
    kidneyHottestIndex: kidneyHottest,
    kidneyClearance,
    heartPeakHerg,
    heartPeakDamage,
    heartFinalDamage: heartDamage,
    heartClearance,
    brainPeakConc,
    brainPeakDamage,
    brainFinalDamage: brainDamage,
    brainClearance,
    metaboliteOutput,
    meanFinalGsh,
    exposureIndex,
  }
}
