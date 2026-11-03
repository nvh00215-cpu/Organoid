import type { CompoundId, CustomOverrides, DoseMode, DosingPattern } from '../model/types'
import { parseHorizonDays } from '../model/horizon'

interface DosePanelProps {
  compoundId: CompoundId
  custom: CustomOverrides
  doseMode: DoseMode
  doseMgPerKg: number
  weightKg: number
  horizonDaysText: string
  dosingPattern: DosingPattern
  coupleOrgans: boolean
  running: boolean
  onCompound: (id: CompoundId) => void
  onCustom: (next: CustomOverrides) => void
  onDoseMode: (mode: DoseMode) => void
  onDose: (mgPerKg: number) => void
  onWeight: (kg: number) => void
  onHorizonDaysText: (raw: string) => void
  onDosingPattern: (pattern: DosingPattern) => void
  onCoupleOrgans: (on: boolean) => void
  onRun: () => void
  onReset: () => void
}

export function DosePanel({
  compoundId,
  custom,
  doseMode,
  doseMgPerKg,
  weightKg,
  horizonDaysText,
  dosingPattern,
  coupleOrgans,
  running,
  onCompound,
  onCustom,
  onDoseMode,
  onDose,
  onWeight,
  onHorizonDaysText,
  onDosingPattern,
  onCoupleOrgans,
  onRun,
  onReset,
}: DosePanelProps) {
  const horizon = parseHorizonDays(horizonDaysText)
  const runDisabled = running || !horizon.ok

  return (
    <section className="card">
      <div className="card-title">
        <span className="icon-chip">◎</span>
        Dose Protocol
      </div>

      <div className="field">
        <label>Compound</label>
        <div className="chips">
          {(
            [
              ['acetaminophen', 'Acetaminophen'],
              ['ibuprofen', 'Ibuprofen'],
              ['custom', 'Custom'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={compoundId === id ? 'chip active' : 'chip'}
              onClick={() => onCompound(id)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {compoundId === 'custom' && (
        <>
          <div className="field">
            <label>Name</label>
            <input
              type="text"
              value={custom.name}
              onChange={(e) => onCustom({ ...custom, name: e.target.value })}
            />
          </div>
          <div className="field">
            <label>Half-life ({custom.halfLifeHours.toFixed(1)} h)</label>
            <input
              type="range"
              min={1}
              max={12}
              step={0.1}
              value={custom.halfLifeHours}
              onChange={(e) =>
                onCustom({ ...custom, halfLifeHours: Number(e.target.value) })
              }
            />
          </div>
          <div className="field">
            <label>CYP strength ({custom.cypStrength.toFixed(2)})</label>
            <input
              type="range"
              min={0.1}
              max={2.5}
              step={0.05}
              value={custom.cypStrength}
              onChange={(e) =>
                onCustom({ ...custom, cypStrength: Number(e.target.value) })
              }
            />
          </div>
          <div className="field">
            <label>Metabolite threshold ({custom.metaboliteThreshold.toFixed(2)})</label>
            <input
              type="range"
              min={0.08}
              max={1.2}
              step={0.02}
              value={custom.metaboliteThreshold}
              onChange={(e) =>
                onCustom({ ...custom, metaboliteThreshold: Number(e.target.value) })
              }
            />
          </div>
        </>
      )}

      <div className="field">
        <label>Weight ({weightKg} kg)</label>
        <input
          type="range"
          min={40}
          max={120}
          step={1}
          value={weightKg}
          onChange={(e) => onWeight(Number(e.target.value))}
        />
      </div>

      <div className="field">
        <label>Dose mode</label>
        <div className="segmented">
          {(
            [
              ['low', 'Low'],
              ['therapeutic', 'Therapeutic'],
              ['high', 'High'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`seg${id === 'high' ? ' danger' : ''}${doseMode === id ? ' active' : ''}`}
              onClick={() => onDoseMode(id)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <label>Exact dose ({doseMgPerKg.toFixed(1)} mg/kg)</label>
        <input
          type="range"
          min={1}
          max={250}
          step={0.5}
          value={doseMgPerKg}
          onChange={(e) => onDose(Number(e.target.value))}
        />
        <div className="range-meta">
          <span>250 mg/kg</span>
        </div>
      </div>

      <div className="field">
        <label>Dosing pattern</label>
        <div className="segmented">
          <button
            type="button"
            className={dosingPattern === 'single' ? 'seg active' : 'seg'}
            onClick={() => onDosingPattern('single')}
          >
            Single dose
          </button>
          <button
            type="button"
            className={dosingPattern === 'repeated' ? 'seg active' : 'seg'}
            onClick={() => onDosingPattern('repeated')}
          >
            Repeated daily dose
          </button>
        </div>
      </div>

      <div className="field">
        <label htmlFor="horizon-days">Horizon (days)</label>
        <input
          id="horizon-days"
          type="number"
          min={1}
          max={30}
          step={1}
          inputMode="numeric"
          value={horizonDaysText}
          onChange={(e) => onHorizonDaysText(e.target.value)}
          aria-invalid={!horizon.ok}
        />
        {!horizon.ok && <p className="field-error">{horizon.error}</p>}
      </div>

      <label className="check-row">
        <input
          type="checkbox"
          checked={coupleOrgans}
          onChange={(e) => onCoupleOrgans(e.target.checked)}
        />
        Couple kidney and heart clearance into plasma
      </label>
      <p className="note">
        Off keeps the original liver curve. On, that clearance lowers plasma and can soften liver injury.
      </p>

      <div className="actions">
        <button type="button" className="btn-primary" onClick={onRun} disabled={runDisabled}>
          {running ? 'Simulating…' : 'Run Simulation'}
        </button>
        <button type="button" className="btn-ghost" onClick={onReset}>
          Reset
        </button>
      </div>

      <div className="legend">
        <div className="legend-title">Zonation (inside every lobule)</div>
        <div>
          <span className="swatch" style={{ background: '#f3c4b8' }} />
          Z1 periportal — high O₂, lower CYP
        </div>
        <div>
          <span className="swatch" style={{ background: '#e8a054' }} />
          Z2 midzonal
        </div>
        <div>
          <span className="swatch" style={{ background: '#5c2a32' }} />
          Z3 pericentral — acute injury first
        </div>
        <div className="legend-title" style={{ marginTop: 8 }}>
          Tissue read
        </div>
        <div>
          <span className="swatch" style={{ background: '#1a080a' }} />
          Solid dark — acute necrosis (localized wave)
        </div>
        <div>
          <span className="swatch hatch" />
          Hatch / brown — chronic load (diffuse)
        </div>
      </div>
    </section>
  )
}
