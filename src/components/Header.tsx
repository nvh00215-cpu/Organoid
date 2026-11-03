interface HeaderProps {
  onExport: () => void
  canExport: boolean
}

export function Header({ onExport, canExport }: HeaderProps) {
  return (
    <header className="header">
      <div className="brand">
        <div className="brand-mark" aria-hidden>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
            <path
              d="M12 3c2.8 2.2 4 4.6 4 7.2 0 3.4-2 6.2-4 8.8-2-2.6-4-5.4-4-8.8C8 7.6 9.2 5.2 12 3Z"
              stroke="currentColor"
              strokeWidth="1.5"
            />
            <path d="M9 11.5h6" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </div>
        <div>
          <h1>Digital Liver</h1>
          <p>Liver, kidney, heart, and brain on one plasma</p>
        </div>
      </div>
      <div className="header-actions">
        <button type="button" className="btn-primary" onClick={onExport} disabled={!canExport}>
          Export Report
          <span aria-hidden>→</span>
        </button>
      </div>
    </header>
  )
}
