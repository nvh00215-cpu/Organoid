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
import type {
  ChartPoint,
  CompoundParams,
  DosingPattern,
  FailureType,
  SimFrame,
  SimRequest,
  SimResult,
} from './types'
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

/**
 * All simulation state in one plain structure. Config fields are fixed at
 * creation; compound/bolus/typical may be replaced between steps via
 * setSimParams, never mutated in place. nbrs is a shared immutable table.
 */
export interface SimState {
  readonly request: SimRequest
  compound: CompoundParams
  readonly dosingPattern: DosingPattern
  readonly coupleOrgans: boolean
  readonly stride: number
  readonly totalSteps: number
  bolus: number
  typical: number
  readonly perfusion: Float32Array
  readonly nbrs: number[][]
  step: number
  readonly lobules: [ZoneState, ZoneState, ZoneState][]
  readonly chronic: Float32Array
  readonly emaM: Float32Array
  readonly kidneyCortex: Float32Array
  readonly kidneyMedulla: Float32Array
  readonly kidneyDamage: Float32Array
  readonly damages: Float32Array
  readonly stress: Float32Array
  readonly kidneyStress: Float32Array
  plasma: number
  heartDamage: number
  heartHerg: number
  brainConc: number
  brainDamage: number
  kidneyClearance: number
  heartClearance: number
  brainClearance: number
  metaboliteOutput: number
  kidneyPeakMedulla: number
  kidneyPeakMeanDamage: number
  heartPeakHerg: number
  heartPeakDamage: number
  brainPeakConc: number
  brainPeakDamage: number
  lastKidneyMean: number
  lastKidneyMedulla: number
  exposureIndex: number
  peakZone3Metabolite: number
  timeAbove: number
  timeChronicHigh: number
  consecutiveChronicHigh: number
  failedAt: number | null
  failureType: FailureType
  lastSample: number
  readonly frames: SimFrame[]
  readonly series: ChartPoint[]
}

export function createSimState(request: SimRequest): SimState {
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

  const plasma = initialPlasma(doseMgPerKg, compound)
  const damages = new Float32Array(GRID_COUNT)
  const frames: SimFrame[] = []
  const series: ChartPoint[] = []
  const stress = new Float32Array(GRID_COUNT)
  const kidneyStress = new Float32Array(GRID_COUNT)
  const heartDamage = 0
  const heartHerg = hergBlock(exposureFold(plasma, typical), compound.heartScale)
  const brainConc = 0
  const brainDamage = 0
  const kidneyClearance = 0
  const heartClearance = 0
  const brainClearance = 0
  const metaboliteOutput = 0
  const kidneyPeakMedulla = 0
  const kidneyPeakMeanDamage = 0
  const heartPeakHerg = heartHerg
  const heartPeakDamage = 0
  const brainPeakConc = 0
  const brainPeakDamage = 0
  const lastKidneyMean = 0
  const lastKidneyMedulla = 0
  const exposureIndex = 0

  const peakZone3Metabolite = 0
  const timeAbove = 0
  const timeChronicHigh = 0
  const consecutiveChronicHigh = 0
  const failedAt: number | null = null
  const failureType: FailureType = null
  const stride = frameStrideHours(horizonHours)
  const lastSample = -stride

  const state: SimState = {
    request,
    compound,
    dosingPattern,
    coupleOrgans,
    stride,
    totalSteps: Math.round(horizonHours / DT),
    bolus,
    typical,
    perfusion,
    nbrs,
    step: 0,
    lobules,
    chronic,
    emaM,
    kidneyCortex,
    kidneyMedulla,
    kidneyDamage,
    damages,
    stress,
    kidneyStress,
    plasma,
    heartDamage,
    heartHerg,
    brainConc,
    brainDamage,
    kidneyClearance,
    heartClearance,
    brainClearance,
    metaboliteOutput,
    kidneyPeakMedulla,
    kidneyPeakMeanDamage,
    heartPeakHerg,
    heartPeakDamage,
    brainPeakConc,
    brainPeakDamage,
    lastKidneyMean,
    lastKidneyMedulla,
    exposureIndex,
    peakZone3Metabolite,
    timeAbove,
    timeChronicHigh,
    consecutiveChronicHigh,
    failedAt,
    failureType,
    lastSample,
    frames,
    series,
  }
  snapshotSim(state, 0)
  return state
}

export function snapshotSim(state: SimState, t: number): void {
  const lobules = state.lobules
  const damages = state.damages
  const chronic = state.chronic
  const kidneyCortex = state.kidneyCortex
  const kidneyMedulla = state.kidneyMedulla
  const kidneyDamage = state.kidneyDamage
  const plasma = state.plasma
  const typical = state.typical
  const heartHerg = state.heartHerg
  const heartDamage = state.heartDamage
  const brainConc = state.brainConc
  const brainDamage = state.brainDamage
  const lastKidneyMean = state.lastKidneyMean
  const lastKidneyMedulla = state.lastKidneyMedulla
  const exposureIndex = state.exposureIndex
  const frames = state.frames
  const series = state.series
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

function stepOnce(state: SimState): void {
  const compound = state.compound
  const dosingPattern = state.dosingPattern
  const perfusion = state.perfusion
  const nbrs = state.nbrs
  const lobules = state.lobules
  const chronic = state.chronic
  const emaM = state.emaM
  const kidneyCortex = state.kidneyCortex
  const kidneyMedulla = state.kidneyMedulla
  const kidneyDamage = state.kidneyDamage
  const damages = state.damages
  const stress = state.stress
  const kidneyStress = state.kidneyStress
  const bolus = state.bolus
  const typical = state.typical
  const coupleOrgans = state.coupleOrgans
  const stride = state.stride
  const steps = state.totalSteps
  let plasma = state.plasma
  let heartDamage = state.heartDamage
  let heartHerg = state.heartHerg
  let brainConc = state.brainConc
  let brainDamage = state.brainDamage
  let kidneyClearance = state.kidneyClearance
  let heartClearance = state.heartClearance
  let brainClearance = state.brainClearance
  let metaboliteOutput = state.metaboliteOutput
  let kidneyPeakMedulla = state.kidneyPeakMedulla
  let kidneyPeakMeanDamage = state.kidneyPeakMeanDamage
  let heartPeakHerg = state.heartPeakHerg
  let heartPeakDamage = state.heartPeakDamage
  let brainPeakConc = state.brainPeakConc
  let brainPeakDamage = state.brainPeakDamage
  let lastKidneyMean = state.lastKidneyMean
  let lastKidneyMedulla = state.lastKidneyMedulla
  let exposureIndex = state.exposureIndex
  let peakZone3Metabolite = state.peakZone3Metabolite
  let timeAbove = state.timeAbove
  let timeChronicHigh = state.timeChronicHigh
  let consecutiveChronicHigh = state.consecutiveChronicHigh
  let failedAt = state.failedAt
  let failureType = state.failureType
  let lastSample = state.lastSample
  const s = state.step + 1
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

  // Persist step results to state (snapshotSim reads from state).
  state.plasma = plasma
  state.heartDamage = heartDamage
  state.heartHerg = heartHerg
  state.brainConc = brainConc
  state.brainDamage = brainDamage
  state.kidneyClearance = kidneyClearance
  state.heartClearance = heartClearance
  state.brainClearance = brainClearance
  state.metaboliteOutput = metaboliteOutput
  state.kidneyPeakMedulla = kidneyPeakMedulla
  state.kidneyPeakMeanDamage = kidneyPeakMeanDamage
  state.heartPeakHerg = heartPeakHerg
  state.heartPeakDamage = heartPeakDamage
  state.brainPeakConc = brainPeakConc
  state.brainPeakDamage = brainPeakDamage
  state.lastKidneyMean = lastKidneyMean
  state.lastKidneyMedulla = lastKidneyMedulla
  state.exposureIndex = exposureIndex
  state.peakZone3Metabolite = peakZone3Metabolite
  state.timeAbove = timeAbove
  state.timeChronicHigh = timeChronicHigh
  state.consecutiveChronicHigh = consecutiveChronicHigh
  state.failedAt = failedAt
  state.failureType = failureType
  state.lastSample = lastSample

  if (t - lastSample >= stride - 1e-9 || s === steps || failedAt !== null) {
    snapshotSim(state, t)
    lastSample = t
    state.lastSample = t
  }

  state.step = s
}

export interface StepSimParams {
  compound: CompoundParams
}

export function stepSim(state: SimState, nSteps: number, params?: StepSimParams): SimState {
  if (params !== undefined) {
    setSimParams(state, params.compound)
  }
  for (let k = 0; k < nSteps; k++) {
    if (state.step >= state.totalSteps || state.failedAt !== null) break
    stepOnce(state)
  }
  return state
}

export function setSimParams(state: SimState, compound: CompoundParams): void {
  state.compound = compound
  state.typical = typicalPlasma(compound)
  state.bolus = bolusDelta(state.request.doseMgPerKg, compound)
}

export function cloneSimState(state: SimState): SimState {
  return {
    request: state.request,
    compound: state.compound,
    dosingPattern: state.dosingPattern,
    coupleOrgans: state.coupleOrgans,
    stride: state.stride,
    totalSteps: state.totalSteps,
    bolus: state.bolus,
    typical: state.typical,
    perfusion: state.perfusion.slice(),
    nbrs: state.nbrs,
    step: state.step,
    lobules: state.lobules.map(
      (z): [ZoneState, ZoneState, ZoneState] => [{ ...z[0] }, { ...z[1] }, { ...z[2] }],
    ),
    chronic: state.chronic.slice(),
    emaM: state.emaM.slice(),
    kidneyCortex: state.kidneyCortex.slice(),
    kidneyMedulla: state.kidneyMedulla.slice(),
    kidneyDamage: state.kidneyDamage.slice(),
    damages: state.damages.slice(),
    stress: state.stress.slice(),
    kidneyStress: state.kidneyStress.slice(),
    plasma: state.plasma,
    heartDamage: state.heartDamage,
    heartHerg: state.heartHerg,
    brainConc: state.brainConc,
    brainDamage: state.brainDamage,
    kidneyClearance: state.kidneyClearance,
    heartClearance: state.heartClearance,
    brainClearance: state.brainClearance,
    metaboliteOutput: state.metaboliteOutput,
    kidneyPeakMedulla: state.kidneyPeakMedulla,
    kidneyPeakMeanDamage: state.kidneyPeakMeanDamage,
    heartPeakHerg: state.heartPeakHerg,
    heartPeakDamage: state.heartPeakDamage,
    brainPeakConc: state.brainPeakConc,
    brainPeakDamage: state.brainPeakDamage,
    lastKidneyMean: state.lastKidneyMean,
    lastKidneyMedulla: state.lastKidneyMedulla,
    exposureIndex: state.exposureIndex,
    peakZone3Metabolite: state.peakZone3Metabolite,
    timeAbove: state.timeAbove,
    timeChronicHigh: state.timeChronicHigh,
    consecutiveChronicHigh: state.consecutiveChronicHigh,
    failedAt: state.failedAt,
    failureType: state.failureType,
    lastSample: state.lastSample,
    frames: state.frames.map((f) => ({
      ...f,
      damage: f.damage.slice(),
      zoneDamage: f.zoneDamage.slice(),
      chronicLoad: f.chronicLoad.slice(),
      kidneyCortex: f.kidneyCortex.slice(),
      kidneyMedulla: f.kidneyMedulla.slice(),
      kidneyDamage: f.kidneyDamage.slice(),
    })),
    series: state.series.map((p) => ({ ...p })),
  }
}

export function buildResult(state: SimState): SimResult {
  const request = state.request
  const perfusion = state.perfusion
  const frames = state.frames
  const series = state.series
  const lobules = state.lobules
  const peakZone3Metabolite = state.peakZone3Metabolite
  const timeAbove = state.timeAbove
  const timeChronicHigh = state.timeChronicHigh
  const failedAt = state.failedAt
  const failureType = state.failureType
  const coupleOrgans = state.coupleOrgans
  const lastKidneyMean = state.lastKidneyMean
  const kidneyPeakMeanDamage = state.kidneyPeakMeanDamage
  const kidneyPeakMedulla = state.kidneyPeakMedulla
  const kidneyClearance = state.kidneyClearance
  const heartPeakHerg = state.heartPeakHerg
  const heartPeakDamage = state.heartPeakDamage
  const heartDamage = state.heartDamage
  const heartClearance = state.heartClearance
  const brainPeakConc = state.brainPeakConc
  const brainPeakDamage = state.brainPeakDamage
  const brainDamage = state.brainDamage
  const brainClearance = state.brainClearance
  const metaboliteOutput = state.metaboliteOutput
  const exposureIndex = state.exposureIndex
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
