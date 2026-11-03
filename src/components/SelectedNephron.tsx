import { GRID_COLS } from '../model/types'
import { MEDULLA_THRESHOLD } from '../model/kidney'
import { damageToCss } from '../model/color'

interface SelectedNephronProps {
  index: number
  cortex: number
  medulla: number
  damage: number
}

function hexPath(cx: number, cy: number, size: number): string {
  const pts: string[] = []
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * (60 * i)
    pts.push(`${cx + size * Math.cos(a)},${cy + size * Math.sin(a)}`)
  }
  return pts.join(' ')
}

export function SelectedNephron({ index, cortex, medulla, damage }: SelectedNephronProps) {
  const col = index % GRID_COLS
  const row = Math.floor(index / GRID_COLS)
  const cortexSignal = Math.min(1, cortex / Math.max(MEDULLA_THRESHOLD, 0.01))
  return (
    <aside className="inset">
      <h3>
        Selected nephron · ({col}, {row})
      </h3>
      <svg viewBox="0 0 160 150" width="180" height="168">
        <polygon points={hexPath(80, 78, 64)} fill={damageToCss(cortexSignal)} stroke="#fff" strokeWidth="1" />
        <polygon points={hexPath(80, 78, 28)} fill={damageToCss(damage)} stroke="#fff" strokeWidth="1" />
        <text x="80" y="18" textAnchor="middle" fontSize="10" fill="#6b7280">
          Cortex
        </text>
        <text x="80" y="82" textAnchor="middle" fontSize="9" fill="#111318">
          Medulla
        </text>
      </svg>
      <p>
        Both regions sit inside this nephron. Cortex {cortex.toFixed(2)} · Medulla {medulla.toFixed(2)} ·
        threshold {MEDULLA_THRESHOLD.toFixed(1)} · damage {(damage * 100).toFixed(0)}%
      </p>
    </aside>
  )
}
