import type { ChartPoint } from '../model/types'

interface OrganGaugeProps {
  name: string
  caption: string
  value: number
  valueLabel: string
  threshold: number
  damage: number
  series: ChartPoint[]
  valueKey: 'heartHerg' | 'brainConc' | 'kidneyMedulla'
  damageKey: 'heartDamage' | 'brainDamage' | 'kidneyDamage'
}

export function OrganGauge({
  name,
  caption,
  value,
  valueLabel,
  threshold,
  damage,
  series,
  valueKey,
  damageKey,
}: OrganGaugeProps) {
  const radius = 68
  const circ = 2 * Math.PI * radius
  const span = Math.max(threshold * 1.35, value, 0.01)
  const filled = Math.min(1, value / span)
  const mark = Math.min(1, threshold / span)
  const hot = value >= threshold || damage > 0.08

  return (
    <div className="organ-panel">
      <div className="gauge-block">
        <svg viewBox="0 0 180 180" width="220" height="220" role="img" aria-label={`${name} gauge`}>
          <circle cx="90" cy="90" r={radius} fill="none" stroke="#e5e9f0" strokeWidth="12" />
          <circle
            cx="90"
            cy="90"
            r={radius}
            fill="none"
            stroke={hot ? '#ef4444' : '#2f6fed'}
            strokeWidth="12"
            strokeLinecap="round"
            strokeDasharray={`${(filled * circ).toFixed(2)} ${circ.toFixed(2)}`}
            transform="rotate(-90 90 90)"
          />
          <circle cx={90 + radius * Math.sin(mark * 2 * Math.PI)} cy={90 - radius * Math.cos(mark * 2 * Math.PI)} r="4" fill="#111318" />
          <text x="90" y="84" textAnchor="middle" fontSize="28" fill="#111318">
            {value.toFixed(2)}
          </text>
          <text x="90" y="106" textAnchor="middle" fontSize="11" fill="#6b7280">
            {valueLabel}
          </text>
        </svg>
        <p className="gauge-read">
          Threshold {threshold.toFixed(2)} · Damage {(damage * 100).toFixed(0)}%
        </p>
        <p className="note">{caption}</p>
      </div>
      <OrganTrace
        series={series}
        valueKey={valueKey}
        damageKey={damageKey}
        threshold={threshold}
        valueLabel={valueLabel}
      />
    </div>
  )
}

function OrganTrace({
  series,
  valueKey,
  damageKey,
  threshold,
  valueLabel,
}: {
  series: ChartPoint[]
  valueKey: OrganGaugeProps['valueKey']
  damageKey: OrganGaugeProps['damageKey']
  threshold: number
  valueLabel: string
}) {
  const w = 520
  const h = 280
  const pad = { l: 36, r: 12, t: 16, b: 28 }
  if (series.length < 2) return <p className="muted">Run a simulation to plot this organ.</p>
  const tMax = series[series.length - 1].t || 1
  const yMax = Math.max(threshold * 1.2, ...series.map((p) => p[valueKey]), 0.05)
  const x = (t: number) => pad.l + (t / tMax) * (w - pad.l - pad.r)
  const y = (v: number) => pad.t + (h - pad.t - pad.b) * (1 - v / yMax)
  const line = (key: typeof valueKey | typeof damageKey, scale = 1) =>
    series
      .map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(p.t).toFixed(1)} ${y(p[key] * scale).toFixed(1)}`)
      .join(' ')

  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height="280" role="img" aria-label={`${valueLabel} over time`}>
      <line x1={pad.l} x2={w - pad.r} y1={y(threshold)} y2={y(threshold)} stroke="#ef4444" strokeDasharray="4 4" />
      <path d={line(valueKey)} fill="none" stroke="#2f6fed" strokeWidth="2" />
      <path d={line(damageKey, yMax)} fill="none" stroke="#111318" strokeWidth="1.5" />
      <text x={pad.l} y={h - 8} fontSize="11" fill="#2f6fed">
        {valueLabel}
      </text>
      <text x={w - pad.r} y={h - 8} fontSize="11" fill="#111318" textAnchor="end">
        Damage
      </text>
    </svg>
  )
}
