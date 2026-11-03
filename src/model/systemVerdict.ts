import { MEDULLA_THRESHOLD } from './kidney'
import type { Verdict } from './verdict'
import type { SimResult } from './types'

export interface OrganFlag {
  organ: 'liver' | 'kidney' | 'heart' | 'brain'
  label: string
  detail: string
  hot: boolean
}

export interface SystemVerdict {
  headline: string
  flags: OrganFlag[]
}

export function judgeSystem(result: SimResult, liver: Verdict): SystemVerdict {
  const liverHot = liver.kind !== 'Safe'
  const renalFail = result.kidneyPeakMeanDamage > 0.7 || result.kidneyFracInjured > 0.55
  const renal =
    renalFail || result.kidneyPeakMeanDamage > 0.12 || result.kidneyPeakMedulla > MEDULLA_THRESHOLD
  const cardiacFail = result.heartPeakDamage > 0.4
  const cardiac = cardiacFail || result.heartPeakDamage > 0.08
  const neuroFail = result.brainPeakDamage > 0.75
  const neuro = neuroFail || result.brainPeakDamage > 0.08

  const flags: OrganFlag[] = [
    {
      organ: 'liver',
      label: liver.label,
      detail: liver.headline,
      hot: liverHot,
    },
    {
      organ: 'kidney',
      label: renalFail ? 'RENAL FAILURE' : renal ? 'RENAL RISK' : 'KIDNEY CLEAR',
      detail: renal
        ? 'Medullary concentration crossed the nephrotoxicity line. Injured nephrons congest their neighbors.'
        : 'Cortex filtrate stayed below the medullary injury line.',
      hot: renal,
    },
    {
      organ: 'heart',
      label: cardiacFail ? 'CARDIAC FAILURE' : cardiac ? 'CARDIAC RISK' : 'HEART CLEAR',
      detail: cardiac
        ? 'Plasma fold pushed hERG blockade over the QT-risk line and cardiac injury accumulated.'
        : 'hERG blockade stayed under the injury line.',
      hot: cardiac,
    },
    {
      organ: 'brain',
      label: neuroFail ? 'NEURO FAILURE' : neuro ? 'NEURO RISK' : 'BRAIN CLEAR',
      detail: neuro
        ? 'Drug crossed the blood–brain barrier and brain concentration exceeded the neurotoxicity line.'
        : 'Barrier-limited brain concentration stayed under the injury line.',
      hot: neuro,
    },
  ]

  const hot = flags.filter((f) => f.hot).map((f) => f.label)
  return {
    headline: hot.length > 0 ? hot.join(' · ') : 'NO ORGAN THRESHOLD CROSSED',
    flags,
  }
}
