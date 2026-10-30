import { useLayoutEffect, useRef } from 'react'
import { gsap } from 'gsap'
import BrandMark from './BrandMark'

export type ProcessingStage = 'preparing' | 'reading' | 'structuring' | 'checking' | 'ready' | 'failed' | 'cancelled'

type ProcessingAnimationProps = {
  stage: ProcessingStage
  message: string
  itemName: string
  itemIndex?: number
  itemTotal?: number
  uncertain?: boolean
  onCancel?: () => void
  cancelDisabled?: boolean
}

const STAGES: Array<{ id: ProcessingStage; title: string; detail: string }> = [
  { id: 'preparing', title: 'Prepare', detail: 'Image check' },
  { id: 'reading', title: 'Read', detail: 'Local OCR' },
  { id: 'structuring', title: 'Structure', detail: 'Organize fields' },
  { id: 'checking', title: 'Check', detail: 'Validate values' },
  { id: 'ready', title: 'Review', detail: 'Your approval' },
]

export default function ProcessingAnimation({ stage, message, itemName, itemIndex, itemTotal, uncertain = false, onCancel, cancelDisabled = false }: ProcessingAnimationProps) {
  const rootRef = useRef<HTMLElement>(null)
  const stageTimelineRef = useRef<gsap.core.Timeline | null>(null)
  const contextRef = useRef<gsap.Context | null>(null)
  const reducedMotion = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const currentStage = stage === 'failed' || stage === 'cancelled' ? -1 : STAGES.findIndex((entry) => entry.id === stage)

  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root) return
    const context = gsap.context(() => {
      const outline = root.querySelector<SVGPathElement>('.processing-receipt-outline')
      const outlineLength = outline?.getTotalLength() || 1
      gsap.set(outline, { strokeDasharray: outlineLength, strokeDashoffset: reducedMotion ? 0 : outlineLength, opacity: 1 })
      gsap.set('.processing-ledger-line', { strokeDasharray: 100, strokeDashoffset: reducedMotion ? 0 : 100, opacity: reducedMotion ? 1 : 0.25 })
      gsap.set('.processing-ledger-row', { opacity: reducedMotion ? 1 : 0.45 })
      gsap.set('.processing-marker', { opacity: reducedMotion ? 1 : 0.35 })
      gsap.set('.processing-scan-line', { opacity: reducedMotion ? 0 : 0 })
      gsap.set('.processing-scan-beam', { opacity: 0 })
      gsap.set('.processing-validation-outline', { strokeDasharray: 240, strokeDashoffset: reducedMotion ? 0 : 240, opacity: 0 })
      gsap.set('.processing-complete-mark, .processing-uncertain-mark', { opacity: 0 })
      if (!reducedMotion) {
        gsap.timeline({ defaults: { ease: 'power2.out' } })
          .to(outline, { strokeDashoffset: 0, duration: 0.48 })
          .to('.processing-ledger-line', { strokeDashoffset: 0, opacity: 0.75, duration: 0.22, stagger: 0.07 }, '-=0.08')
          .to('.processing-logo-mark', { opacity: 1, y: 0, duration: 0.3 }, '-=0.12')
      }
    }, root)
    contextRef.current = context
    return () => {
      stageTimelineRef.current?.kill()
      stageTimelineRef.current = null
      context.revert()
      contextRef.current = null
    }
  }, [reducedMotion])

  useLayoutEffect(() => {
    if (!contextRef.current || !rootRef.current) return
    stageTimelineRef.current?.kill()
    const root = rootRef.current
    if (reducedMotion) {
      gsap.set(root.querySelector('.processing-scan-line'), { opacity: 0 })
      gsap.set(root.querySelector('.processing-scan-beam'), { opacity: 0 })
      gsap.set(root.querySelector('.processing-validation-outline'), { opacity: ['checking', 'ready'].includes(stage) ? 1 : 0, strokeDashoffset: 0 })
      gsap.set(root.querySelector('.processing-complete-mark'), { opacity: stage === 'ready' && !uncertain ? 1 : 0 })
      gsap.set(root.querySelector('.processing-uncertain-mark'), { opacity: uncertain || stage === 'failed' || stage === 'cancelled' ? 1 : 0 })
      return
    }
    const context = contextRef.current
    context.add(() => {
      const timeline = gsap.timeline({ defaults: { ease: 'power2.out' } })
      stageTimelineRef.current = timeline
      const line = root.querySelector('.processing-scan-line')
      if (stage === 'preparing' || stage === 'reading') {
        timeline.set('.processing-scan-line', { opacity: 0.95 })
          .set('.processing-scan-beam', { opacity: 0.72 })
          .fromTo(line, { attr: { y1: 50, y2: 50 } }, { attr: { y1: 157, y2: 157 }, duration: 1.55, ease: 'sine.inOut', repeat: -1, yoyo: true }, 0)
          .fromTo('.processing-scan-beam', { attr: { y: 44 } }, { attr: { y: 151 }, duration: 1.55, ease: 'sine.inOut', repeat: -1, yoyo: true }, 0)
      } else if (stage === 'structuring') {
        timeline.set('.processing-scan-line', { opacity: 0 })
          .set('.processing-scan-beam', { opacity: 0 })
          .to('.processing-marker', { attr: { cx: 286 }, opacity: 1, duration: 0.42, stagger: 0.07 })
          .to('.processing-ledger-row', { opacity: 1, duration: 0.28, stagger: 0.06 }, '-=0.18')
      } else if (stage === 'checking') {
        timeline.set('.processing-scan-line', { opacity: 0 })
          .set('.processing-scan-beam', { opacity: 0 })
          .to('.processing-validation-outline', { opacity: 1, strokeDashoffset: 0, duration: 0.42 })
      } else if (stage === 'ready') {
        timeline.set('.processing-scan-line', { opacity: 0 })
          .set('.processing-scan-beam', { opacity: 0 })
          .to('.processing-validation-outline', { opacity: 1, strokeDashoffset: 0, duration: 0.24 })
        if (uncertain) timeline.to('.processing-uncertain-mark', { opacity: 1, scale: 1, duration: 0.2 })
        else timeline.to('.processing-complete-mark', { opacity: 1, scale: 1, duration: 0.2 })
        timeline.to('.processing-artwork', { y: -3, scale: 0.98, duration: 0.3 }, '-=0.05')
      } else {
        timeline.set('.processing-scan-line', { opacity: 0 })
          .set('.processing-scan-beam', { opacity: 0 })
          .to('.processing-uncertain-mark', { opacity: 1, scale: 1, duration: 0.2 })
      }
    })
    return () => {
      stageTimelineRef.current?.kill()
      stageTimelineRef.current = null
    }
  }, [stage, uncertain, reducedMotion])

  const heading = stage === 'ready' ? uncertain ? 'Ready to review carefully' : 'Ready for your review'
    : stage === 'failed' ? 'Receipt reading stopped'
      : stage === 'cancelled' ? 'Reading cancelled'
        : stage === 'preparing' ? 'Preparing your receipt'
          : stage === 'reading' ? 'Reading the receipt'
            : stage === 'structuring' ? 'Organizing the details' : 'Checking the results'

  return <section ref={rootRef} className={`scan-progress-card is-${stage}`} aria-label="Local receipt processing" role="status" aria-live="polite">
    <div className="processing-panel-top"><div className="processing-logo-mark"><span className="processing-brand-glyph"><BrandMark /></span><strong>NUMORA <i>LOCAL PROCESSING</i></strong></div>{onCancel && stage !== 'cancelled' && !['ready', 'failed'].includes(stage) && <button className="scan-cancel-button" type="button" onClick={onCancel} disabled={cancelDisabled}>Cancel</button>}</div>
    <div className="processing-panel-main">
      <div className="processing-artwork" aria-hidden="true">
        <svg className="processing-svg" viewBox="0 0 420 210" role="presentation">
          <defs><linearGradient id="receipt-scan-beam" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#92b99e" stopOpacity="0" /><stop offset=".5" stopColor="#92b99e" stopOpacity=".32" /><stop offset="1" stopColor="#92b99e" stopOpacity="0" /></linearGradient></defs>
          <path className="processing-receipt-outline" d="M91 16 H245 Q250 16 250 22 V177 L242 184 L234 178 L226 184 L218 178 L210 184 L202 178 L194 184 L186 178 L178 184 L170 178 L162 184 L154 178 L146 184 L138 178 L130 184 L122 178 L114 184 L106 178 L98 184 L90 178 V23 Q90 16 97 16 Z" fill="#f6f2e5" stroke="#e5ddc7" strokeWidth="1.7" strokeLinejoin="round" />
          <path d="M111 39 H218" stroke="#b4b19f" strokeWidth="4" strokeLinecap="round" />
          <path d="M111 51 H193" stroke="#c4c0ad" strokeWidth="2" strokeLinecap="round" />
          <g className="processing-receipt-rows" fill="none" stroke="#999b8d" strokeWidth="2.3" strokeLinecap="round">
            <path className="processing-ledger-line" d="M112 82 H220" />
            <path className="processing-ledger-line" d="M112 111 H201" />
            <path className="processing-ledger-line" d="M112 140 H214" />
          </g>
          <g fill="#b28a4d" stroke="#19231f" strokeWidth="1.6">
            <circle className="processing-marker" cx="229" cy="82" r="4" />
            <circle className="processing-marker" cx="211" cy="111" r="4" />
            <circle className="processing-marker" cx="223" cy="140" r="4" />
          </g>
          <rect className="processing-scan-beam" x="101" y="44" width="140" height="12" rx="6" fill="url(#receipt-scan-beam)" />
          <line className="processing-scan-line" x1="101" y1="50" x2="241" y2="50" stroke="#92b99e" strokeWidth="1.5" />
          <rect x="275" y="35" width="111" height="126" rx="7" fill="#20342b" stroke="#4a6758" strokeWidth="1" />
          <path d="M290 53 H371" stroke="#6f8a76" strokeWidth="1.5" strokeLinecap="round" />
          <g className="processing-ledger-row" fill="none" stroke="#9db2a0" strokeWidth="2" strokeLinecap="round">
            <path d="M300 82 H364" />
            <path d="M300 111 H364" />
            <path d="M300 140 H364" />
          </g>
          <rect className="processing-validation-outline" x="275" y="35" width="111" height="126" rx="7" fill="none" stroke="#a7c4a9" strokeWidth="1.5" />
          <path className="processing-complete-mark" d="M330 178 l7 7 14-16" fill="none" stroke="#a7c4a9" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
          <g className="processing-uncertain-mark"><circle cx="344" cy="178" r="10" fill="#9a6a22" /><path d="M344 173 v6 m0 4 v.1" stroke="#fff8e9" strokeWidth="1.8" strokeLinecap="round" /></g>
          <path d="M73 29 l5 5 -5 5 -5-5z M401 159 l4 4 -4 4 -4-4z" fill="#b28a4d" opacity=".8" />
        </svg>
      </div>
      <div className="processing-copy">
        <span className="processing-stage-label">LOCAL RECEIPT WORKFLOW</span>
        <h2>{heading}</h2>
        <p className="processing-status-message">{message}</p>
        <span className="processing-file-name" title={itemName}>{itemName}{itemIndex && itemTotal ? ` · ${itemIndex} of ${itemTotal}` : ''}</span>
      </div>
    </div>
    <ol className="scan-progress-stages">{STAGES.map((entry, index) => <li key={entry.id} className={index < currentStage || stage === 'ready' ? 'is-complete' : index === currentStage ? 'is-current' : ''}><span>{index < currentStage || stage === 'ready' ? '✓' : String(index + 1).padStart(2, '0')}</span><div><strong>{entry.title}</strong><small>{entry.detail}</small></div></li>)}</ol>
    {stage === 'failed' && <p className="scan-progress-recovery">Your imported image is still available. Retry reading it or choose another file. Nothing was saved.</p>}
    {stage === 'cancelled' && <p className="scan-progress-recovery">The image remains in your local queue. QVAC may finish its current local inference before releasing system resources.</p>}
  </section>
}
