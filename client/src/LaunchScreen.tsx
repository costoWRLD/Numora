import { useEffect, useLayoutEffect, useRef } from 'react'
import { gsap } from 'gsap'

export type PendingReceiptReview = { reviewId: string; originalName: string; createdAt: string; merchant: string; date: string; amount: string; currency: string }
export type StartupModelStatus = { id: string; name: string; role: string; installed: boolean; required?: boolean }
export type StartupStorageStatus = { status: 'ready' | 'degraded'; receiptCount: number; transactionCount: number; categoryRuleCount: number; error?: string }
export type StartupModelTask = { status: 'idle' | 'preparing' | 'ready' | 'skipped' | 'error'; modelName: string; backend: string; progress: number; error: string }
export type StartupModelPreparation = { status: 'idle' | 'preparing' | 'ready' | 'partial' | 'skipped' | 'error' | 'timeout'; stage: string; modelId: string; modelName: string; backend: string; progress: number; error: string; activeTask: string; models: { ocr: StartupModelTask; chat: StartupModelTask } }

type LaunchScreenProps = {
  isChecking: boolean
  serverOnline: boolean
  message: string
  error: string
  modelPreparation: StartupModelPreparation
  pendingReviews: PendingReceiptReview[]
  onContinue: () => void
  onResumeReview: (reviewId: string) => void
}

export default function LaunchScreen({ isChecking, serverOnline, message, error, modelPreparation, pendingReviews, onContinue, onResumeReview }: LaunchScreenProps) {
  const screenRef = useRef<HTMLDivElement>(null)
  const scanBeamRef = useRef<HTMLSpanElement>(null)
  const scanTweenRef = useRef<gsap.core.Tween | null>(null)
  const startTimeRef = useRef(Date.now())
  const continuedRef = useRef(false)
  const continueRef = useRef(onContinue)
  const pendingReview = pendingReviews[0]

  useEffect(() => { continueRef.current = onContinue }, [onContinue])

  useLayoutEffect(() => {
    if (!screenRef.current) return
    const context = gsap.context(() => {
      const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      if (prefersReducedMotion) return

      gsap.timeline({ defaults: { ease: 'power3.out' } })
        .fromTo('.launch-logo-frame', { autoAlpha: 0, scale: 0.93, y: 14 }, { autoAlpha: 1, scale: 1, y: 0, duration: 0.72 })
        .fromTo('.launch-copy', { autoAlpha: 0, y: 10 }, { autoAlpha: 1, y: 0, duration: 0.52 }, '-=0.28')
        .fromTo('.launch-status', { autoAlpha: 0, y: 8 }, { autoAlpha: 1, y: 0, duration: 0.42 }, '-=0.12')

      if (scanBeamRef.current) {
        scanTweenRef.current = gsap.fromTo(scanBeamRef.current,
          { top: '9%', autoAlpha: 0.12 },
          { top: '91%', autoAlpha: 0.82, duration: 1.9, ease: 'sine.inOut', repeat: -1, repeatDelay: 0.45, yoyo: false },
        )
      }
    }, screenRef)
    return () => {
      scanTweenRef.current?.kill()
      scanTweenRef.current = null
      context.revert()
    }
  }, [])

  useEffect(() => {
    if (isChecking) {
      startTimeRef.current = Date.now()
      continuedRef.current = false
      scanTweenRef.current?.resume()
      return
    }

    scanTweenRef.current?.pause()
    if (continuedRef.current) return

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const minimumDisplay = 1750
    const alreadyShown = Date.now() - startTimeRef.current
    const modelDidNotStart = modelPreparation.status === 'error' || modelPreparation.status === 'partial' || modelPreparation.status === 'timeout'
    const settleDelay = pendingReview ? 4000 : error || modelDidNotStart ? 900 : 550
    const timer = window.setTimeout(() => {
      if (continuedRef.current) return
      continuedRef.current = true
      if (reducedMotion || !screenRef.current) {
        continueRef.current()
        return
      }
      gsap.timeline({ onComplete: () => continueRef.current() })
        .to('.launch-content', { autoAlpha: 0, y: -8, duration: 0.36, ease: 'power2.in' })
        .to('.launch-screen', { backgroundColor: '#000000', duration: 0.16 }, '<')
    }, Math.max(0, minimumDisplay - alreadyShown) + settleDelay)

    return () => window.clearTimeout(timer)
  }, [isChecking, error, pendingReview, modelPreparation.status])

  const statusTitle = isChecking
    ? (message || 'Preparing your workspace…')
    : modelPreparation.status === 'ready'
      ? modelPreparation.stage
      : modelPreparation.status === 'skipped' || modelPreparation.status === 'partial' || modelPreparation.status === 'error' || modelPreparation.status === 'timeout'
        ? modelPreparation.stage
        : error
          ? 'Opening your workspace'
          : serverOnline
            ? 'Your workspace is ready'
            : 'Opening your saved ledger'
  const statusDetail = isChecking
    ? modelPreparation.status === 'preparing'
      ? 'Preparing receipt OCR and chat one at a time to protect this device’s memory. Model files are never downloaded at startup.'
      : 'Checking your saved workspace and local services.'
    : modelPreparation.status === 'ready'
      ? 'Receipt OCR and chat were prepared in turn. Numora switches the active model when you scan or chat, so both engines do not compete for memory.'
      : modelPreparation.status === 'partial'
        ? `${modelPreparation.error || 'One local model was unavailable.'} Numora will open; install or check models later in Settings.`
      : modelPreparation.status === 'skipped'
        ? 'No local AI models are installed, so nothing was downloaded. You can install models later in Settings.'
        : modelPreparation.status === 'error'
          ? modelPreparation.error || 'The workspace will open. You can check model setup in Settings.'
          : modelPreparation.status === 'timeout'
            ? 'The workspace will open while the model continues loading in the background.'
            : error
              ? 'Your saved pages can still open. Local service details are available in Settings.'
              : serverOnline
                ? 'Your records stay on this device.'
                : 'The dashboard opens even when the local AI service is offline.'

  return <div ref={screenRef} className="launch-screen" role="dialog" aria-modal="true" aria-label="Numora is preparing your workspace">
    <div className="launch-grid-texture" aria-hidden="true" />
    <main className="launch-content">
      <div className="launch-centerpiece">
        <div className="launch-logo-frame" aria-label="Numora">
          <img src="/numora-wordmark.png" alt="Numora" />
          <span ref={scanBeamRef} className="launch-scan-beam" aria-hidden="true" />
        </div>
        <section className="launch-copy" aria-labelledby="launch-title">
          <h1 id="launch-title">Personal expense tracking,<br /><span>offline by design.</span></h1>
          <p>Your private ledger, ready when you are.</p>
        </section>
        <div className="launch-status" role="status" aria-live="polite">
          <span className={`launch-status-dot${isChecking ? ' is-working' : serverOnline ? ' is-ready' : ' is-offline'}`} aria-hidden="true" />
          <div className="launch-status-copy">
            <strong>{statusTitle}</strong>
            <small>{statusDetail}</small>
          </div>
          {isChecking && <span className="launch-progress-track" aria-hidden="true"><i /></span>}
        </div>
        {pendingReview && <div className="launch-resume">
          <span>{pendingReview.merchant || pendingReview.originalName} is waiting in Receipts.</span>
          <button type="button" onClick={() => onResumeReview(pendingReview.reviewId)}>Resume review</button>
        </div>}
      </div>
      <footer className="launch-footer"><span>NUMORA</span><i aria-hidden="true">·</i><span>PRIVATE EXPENSE LEDGER</span></footer>
    </main>
  </div>
}
