import { useState } from 'react'
import type { StartupModelStatus } from './LaunchScreen'
import BrandMark from './BrandMark'

export type WorkspacePreferences = { defaultCurrency: 'KES' | 'USD'; startPage: 'dashboard' | 'receipts' }

function CheckMark() {
  return <svg aria-hidden="true" viewBox="0 0 16 16"><path d="m3 8 3.1 3.1L13 4.5" /></svg>
}

type FirstRunSetupProps = {
  storageDirectory: string
  models: StartupModelStatus[]
  isSaving: boolean
  error: string
  onSave: (preferences: WorkspacePreferences) => void
}

export default function FirstRunSetup({ storageDirectory, models, isSaving, error, onSave }: FirstRunSetupProps) {
  const [defaultCurrency, setDefaultCurrency] = useState<WorkspacePreferences['defaultCurrency']>('KES')
  const [startPage, setStartPage] = useState<WorkspacePreferences['startPage']>('dashboard')
  const installedCount = models.filter((model) => model.installed).length

  return <main className="setup-screen" aria-labelledby="setup-title">
    <div className="setup-shell">
      <div className="setup-brand"><span className="brand-mark"><BrandMark /></span><span>numora</span><span className="setup-brand-label">FIRST-TIME SETUP</span></div>
      <header className="setup-heading"><span className="section-kicker">YOUR WORKSPACE · 01 OF 01</span><h1 id="setup-title">Make Numora yours.</h1><p>Set a couple of defaults. You can change them later, and your approved records stay on this computer.</p></header>
      <form className="setup-card" onSubmit={(event) => { event.preventDefault(); onSave({ defaultCurrency, startPage }) }}>
        <section className="setup-section" aria-labelledby="currency-title">
          <div className="setup-section-heading"><span className="setup-step">01</span><div><h2 id="currency-title">Default currency</h2><p>Used when OCR cannot identify a receipt currency. Clearly printed currency can still be reviewed per receipt.</p></div></div>
          <div className="setup-choice-row" role="radiogroup" aria-label="Default currency">
            {(['KES', 'USD'] as const).map((currency) => <button key={currency} className={`setup-choice${defaultCurrency === currency ? ' is-selected' : ''}`} type="button" role="radio" aria-checked={defaultCurrency === currency} onClick={() => setDefaultCurrency(currency)}><strong>{currency}</strong><span>{currency === 'KES' ? 'Kenyan shilling' : 'US dollar'}</span><i aria-hidden="true">{defaultCurrency === currency && <CheckMark />}</i></button>)}
          </div>
        </section>
        <section className="setup-section" aria-labelledby="start-page-title">
          <div className="setup-section-heading"><span className="setup-step">02</span><div><h2 id="start-page-title">Choose your first screen</h2><p>This is used until Numora has a saved last page. You can always return to the dashboard or receipts.</p></div></div>
          <div className="setup-choice-row" role="radiogroup" aria-label="Start page">
            {([['dashboard', 'Dashboard', 'Your latest activity and ledger overview'], ['receipts', 'Receipts', 'Add a receipt or paste M-Pesa messages']] as const).map(([page, title, description]) => <button key={page} className={`setup-choice setup-page-choice${startPage === page ? ' is-selected' : ''}`} type="button" role="radio" aria-checked={startPage === page} onClick={() => setStartPage(page)}><strong>{title}</strong><span>{description}</span><i aria-hidden="true">{startPage === page && <CheckMark />}</i></button>)}
          </div>
        </section>
        <section className="setup-section setup-storage" aria-labelledby="storage-title">
          <div className="setup-section-heading"><span className="setup-step">03</span><div><h2 id="storage-title">Local storage</h2><p>This development build uses the project data folder. A custom folder picker will be available with the packaged desktop app.</p></div></div>
          <div className="setup-path"><span className="setup-path-icon" aria-hidden="true">⌂</span><span><small>RECOMMENDED LOCAL FOLDER</small><code title={storageDirectory}>{storageDirectory || 'Project data folder'}</code></span><b>ON THIS DEVICE</b></div>
        </section>
        <section className="setup-model-status" aria-label="Local AI model readiness"><span className="setup-model-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 3v4m0 10v4M3 12h4m10 0h4M5.6 5.6l2.8 2.8m7.2 7.2 2.8 2.8m0-12.8-2.8 2.8m-7.2 7.2-2.8 2.8" /></svg></span><span><strong>Local AI files checked · {installedCount} of {models.length || 0} ready</strong><small>The configured receipt OCR and chat models are prepared one at a time during startup when installed. Missing models are never downloaded automatically.</small></span></section>
        {error && <p className="setup-error" role="alert">{error}</p>}
        <div className="setup-actions"><span>Preferences are saved locally and can be changed in Settings.</span><button className="launch-primary" type="submit" disabled={isSaving}>{isSaving ? 'Saving preferences…' : 'Save and open Numora'} <span>→</span></button></div>
      </form>
      <footer className="setup-footer"><span>NUMORA <i>·</i> PRIVATE LOCAL WORKSPACE</span><span>No account required</span></footer>
    </div>
  </main>
}
