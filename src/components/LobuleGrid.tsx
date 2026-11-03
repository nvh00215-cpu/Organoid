import { useEffect, useRef } from 'react'
import { GRID_COLS, GRID_ROWS } from '../model/types'
import { gridPixelSize, hexCenter, hexCorners } from '../model/grid'
import { tissueFill } from '../model/color'

interface LobuleGridProps {
  damage: Float32Array | null
  chronicLoad: Float32Array | null
  selected: number
  caption: string
  label?: string
  onSelect: (index: number) => void
}

export function LobuleGrid({
  damage,
  chronicLoad,
  selected,
  caption,
  label = 'Tissue lattice',
  onSelect,
}: LobuleGridProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const hitRef = useRef<{ x: number; y: number; i: number }[]>([])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const parent = canvas.parentElement
    if (!parent) return

    const draw = () => {
      const dpr = window.devicePixelRatio || 1
      const cssW = parent.clientWidth
      const cssH = parent.clientHeight
      canvas.width = Math.max(1, Math.floor(cssW * dpr))
      canvas.height = Math.max(1, Math.floor(cssH * dpr))
      canvas.style.width = `${cssW}px`
      canvas.style.height = `${cssH}px`

      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, cssW, cssH)

      const layout = gridPixelSize(1)
      const size = Math.min(cssW / layout.width, cssH / layout.height) * 0.92
      const grid = gridPixelSize(size)
      const ox = (cssW - grid.width) / 2 + size
      const oy = (cssH - grid.height) / 2 + size * 0.7
      const hits: { x: number; y: number; i: number }[] = []

      for (let r = 0; r < GRID_ROWS; r++) {
        for (let c = 0; c < GRID_COLS; c++) {
          const i = r * GRID_COLS + c
          const { x, y } = hexCenter(c, r, size)
          const cx = ox + x
          const cy = oy + y
          hits.push({ x: cx, y: cy, i })
          const acute = damage ? damage[i] : 0.04 + 0.02 * ((c + r) % 3)
          const chronic = chronicLoad ? chronicLoad[i] : 0
          const { fill, hatch } = tissueFill(acute, chronic)
          const pts = hexCorners(cx, cy, size * 0.95)
          ctx.beginPath()
          ctx.moveTo(pts[0].x, pts[0].y)
          for (let k = 1; k < 6; k++) ctx.lineTo(pts[k].x, pts[k].y)
          ctx.closePath()
          ctx.fillStyle = fill
          ctx.fill()
          if (hatch) {
            ctx.save()
            ctx.clip()
            ctx.strokeStyle = 'rgba(90, 48, 18, 0.4)'
            ctx.lineWidth = 1
            const span = size * 1.2
            for (let s = -span; s <= span; s += 3.2) {
              ctx.beginPath()
              ctx.moveTo(cx + s - span * 0.3, cy - span)
              ctx.lineTo(cx + s + span * 0.3, cy + span)
              ctx.stroke()
            }
            ctx.restore()
          }
          if (i === selected) {
            ctx.strokeStyle = '#2f6fed'
            ctx.lineWidth = 1.6
            ctx.stroke()
          } else {
            ctx.strokeStyle = 'rgba(255,255,255,0.35)'
            ctx.lineWidth = 0.4
            ctx.stroke()
          }
        }
      }
      hitRef.current = hits
    }

    draw()
    const observer = new ResizeObserver(draw)
    observer.observe(parent)
    return () => observer.disconnect()
  }, [damage, chronicLoad, selected])

  return (
    <>
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={label}
        onClick={(e) => {
          const canvas = canvasRef.current
          if (!canvas) return
          const rect = canvas.getBoundingClientRect()
          const x = e.clientX - rect.left
          const y = e.clientY - rect.top
          let best = -1
          let bestD = 18
          for (const h of hitRef.current) {
            const d = Math.hypot(h.x - x, h.y - y)
            if (d < bestD) {
              bestD = d
              best = h.i
            }
          }
          if (best >= 0) onSelect(best)
        }}
      />
      <p className="grid-caption">{caption}</p>
    </>
  )
}
