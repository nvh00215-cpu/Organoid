export type DoseMode = 'low' | 'therapeutic' | 'high'

export type CompoundId = 'acetaminophen' | 'ibuprofen' | 'custom'

export type DosingPattern = 'single' | 'repeated'

export type FailureType = 'acute' | 'chronic' | 'both' | null

export type VerdictKind =
  | 'Safe'
  | 'Caution'
  | 'Toxic'
  | 'Chronic'
  | 'AcuteFailure'
  | 'ChronicFailure'
  | 'DualFailure'

export type ZoneIndex = 0 | 1 | 2

export interface CompoundParams {
  id: CompoundId
  name: string
  typicalDoseMgPerKg: number
  lowMultiplier: number
  highMultiplier: number
  halfLifeHours: number
  bioavailability: number
  vdLPerKg: number
  /** Saturable CYP bioactivation Vmax scale (1/h). */
  kCyp: number
  km: number
  kDetox: number
  /** GSH consumption rate; keep below kDetox so therapeutic loads do not empty the reserve. */
  kGUse: number
  kMClear: number
  kGSyn: number
  kDmg: number
  kFlow: number
  kNeighbor: number
  /** Saturable non-toxic (phase II-like) plasma clearance. */
  kPhase2Vmax: number
  kmPhase2: number
  metaboliteThreshold: number
  /** Medullary concentration gain. 1 = reference nephron. */
  kidneyScale: number
  /** hERG blockade gain. 1 = reference cardiac sensitivity. */
  heartScale: number
  /** BloodÃ¢â‚¬â€œbrain barrier permeability gain. */
  brainScale: number
  blurb: string
}

export interface CustomOverrides {
  name: string
  halfLifeHours: number
  cypStrength: number
  metaboliteThreshold: number
  typicalDoseMgPerKg: number
}

export interface SimRequest {
  compound: CompoundParams
  doseMgPerKg: number
  weightKg: number
  horizonHours: number
  dosingPattern: DosingPattern
  seed: number
  /**
   * When true, kidney and heart clearance are subtracted from plasma.
   * Default false keeps the original liver-only plasma trajectory.
   */
  coupleOrgans?: boolean
  /**
   * When true, a systemic metabolite pool is tracked: hepatic + renal
   * metabolite output accumulates, clears renally (reduced by kidney
   * injury), and retained metabolite adds to medullary burden.
   * Default off keeps byte-identical behavior (pool stays 0).
   */
  metaboliteLoop?: boolean
}

export interface ChartPoint {
  t: number
  plasma: number
  zone1C: number
  zone3C: number
  zone1M: number
  zone3M: number
  zone1D: number
  zone3D: number
  meanDamage: number
  meanChronic: number
  exposureFold: number
  kidneyMedulla: number
  kidneyDamage: number
  heartHerg: number
  heartDamage: number
  brainConc: number
  brainDamage: number
  /** Grand-mean GSH across all zones and lobules (0..1). Recorded for agent summaries. */
  meanGsh: number
  /** Mean Zone-3 GSH across lobules (0..1). */
  zone3Gsh: number
  /** Cumulative time-integral of mean Zone-3 metabolite up to t (concÂ·h). */
  exposureIndex: number
}

export interface SimFrame {
  t: number
  /** Aggregated acute (zonation-weighted) damage. */
  damage: Float32Array
  /** Zone damage packed [i*3 + z]. */
  zoneDamage: Float32Array
  /** Diffuse chronic load per lobule. */
  chronicLoad: Float32Array
  kidneyCortex: Float32Array
  kidneyMedulla: Float32Array
  kidneyDamage: Float32Array
  heartHerg: number
  heartDamage: number
  brainConc: number
  brainDamage: number
}

export interface SimResult {
  request: SimRequest
  cols: number
  rows: number
  perfusion: Float32Array
  frames: SimFrame[]
  series: ChartPoint[]
  peakZone3Metabolite: number
  timeAboveThresholdHours: number
  fracNecrotic: number
  meanFinalDamage: number
  maxFinalDamage: number
  meanFinalZoneDamage: [number, number, number]
  meanChronicLoad: number
  timeChronicHighHours: number
  hottestIndex: number
  failedAt: number | null
  failureType: FailureType
  dt: number
  coupleOrgans: boolean
  kidneyMeanDamage: number
  kidneyPeakMeanDamage: number
  kidneyFracInjured: number
  kidneyPeakMedulla: number
  kidneyHottestIndex: number
  kidneyClearance: number
  heartPeakHerg: number
  heartPeakDamage: number
  heartFinalDamage: number
  heartClearance: number
  brainPeakConc: number
  brainPeakDamage: number
  brainFinalDamage: number
  brainClearance: number
  metaboliteOutput: number
  /** Final systemic metabolite pool (0 unless metaboliteLoop is on). Hash-excluded. */
  sysMetaboliteFinal: number
  /** Peak systemic metabolite pool (0 unless metaboliteLoop is on). Hash-excluded. */
  sysMetabolitePeak: number
  /** Grand-mean GSH at end of run (0..1). */
  meanFinalGsh: number
  /** Time-integral of mean Zone-3 metabolite over the run (conc·h). */
  exposureIndex: number
}

export const GRID_COLS = 32
export const GRID_ROWS = 24
export const GRID_COUNT = GRID_COLS * GRID_ROWS

export const OXYGEN = [1.0, 0.7, 0.4] as const
export const CYP = [0.35, 0.7, 1.0] as const
export const GSH0 = [1.0, 0.75, 0.5] as const

export const DT = 0.1
export const ACUTE_FAIL_FRAC = 0.75
export const CHRONIC_FAIL_LOAD = 0.6
export const CHRONIC_FAIL_HOLD_H = 10
export const NECROTIC = 0.5
