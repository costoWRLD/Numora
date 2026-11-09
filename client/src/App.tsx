import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type FormEvent, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { gsap } from 'gsap'
import './App.css'
import './NumoraRefresh.css'
import BrandMark from './BrandMark'
import ImagePreparation, { type ImageFocusArea, type ImagePreparationHandle } from './ImagePreparation'
import LaunchScreen, { type PendingReceiptReview, type StartupModelPreparation, type StartupModelStatus, type StartupStorageStatus } from './LaunchScreen'
import FirstRunSetup, { type WorkspacePreferences } from './FirstRunSetup'
import ProcessingAnimation, { type ProcessingStage } from './ProcessingAnimation'
import { loadReceiptQueue, saveReceiptQueue } from './receiptQueueStore'
import { downloadReportDocx, downloadReportPdf, type ReportExportModel } from './reportExport'

const MAX_FILE_SIZE = 15 * 1024 * 1024
const ACCEPTED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const CATEGORIES = ['Uncategorised', 'Stock', 'Transport', 'Food', 'Rent', 'Utilities', 'Supplies', 'Other'] as const
const INCOME_CATEGORIES = ['Sales', 'Salary', 'Freelance', 'Refund', 'Gift', 'Other'] as const

type ReceiptFields = {
  merchant: string
  date: string
  amount: string
  currency: string
  paymentMethod: string
  category: string
  notes: string
}

type FieldEvidence = {
  lines: string[]
  averageConfidence: number | null
  note: string
  source?: 'rule' | 'default' | 'ocr' | 'manual' | 'model'
}

type EvidenceByField = Record<keyof ReceiptFields, FieldEvidence>

type ReceiptLineItem = {
  description: string
  amount: string
  sourceLine: string
  confidence: number | null
}

type MerchantCategoryRule = { merchant: string; category: string }

type MpesaTransaction = {
  transactionId: string
  date: string
  time: string
  direction: 'outgoing' | 'incoming' | 'reversal' | 'unknown'
  transactionType: 'send_money' | 'paybill' | 'buy_goods' | 'withdrawal' | 'deposit' | 'airtime' | 'receive_money' | 'reversal' | 'unknown'
  counterparty: string
  amount: string
  fee: string
  balance: string
  reference: string
  category: string
  ledgerRole: 'expense' | 'income' | 'transfer' | 'loan_given' | 'loan_repayment' | 'unclassified'
  sourceMessage: string
  duplicate?: boolean
}

type SavedMpesaTransaction = MpesaTransaction & { id: string; savedAt: string; sourceType: 'mpesa'; matchedReceiptId?: string }

type ModelInterpretation = { used: boolean; model: string; backend: string; error?: string; note?: string; itemsFromOcr?: boolean }

type ScanResult = {
  reviewId: string
  ocrModel?: string
  ocrBackend?: string
  fields: ReceiptFields
  fieldEvidence: EvidenceByField
  items: ReceiptLineItem[]
  rawText: string
  ocrQuality: {
    averageConfidence: number | null
    scoredBlocks: number
    blockCount: number
    lowConfidenceCount: number
    receiptScore: number
    retryRecommended: boolean
    retryAttempted: boolean
    retrySelected: boolean
    reasons: string[]
    focusAreas?: ImageFocusArea[]
    retryError?: string
  }
  financialChecks: {
    checks: Array<{ label: string; calculated: string; printed: string; difference: string; matches: boolean }>
    conflicts: Array<{ label: string; calculated: string; printed: string; difference: string; matches: boolean }>
    requiresConfirmation: boolean
  }
  financialReference: { subtotal: number | null; tax: number | null; total: number | null; tip: number | null }
  modelInterpretation: ModelInterpretation
  deepRead?: { attempted: boolean; selected: boolean; model: string; note: string }
  elapsedMs: number
}

type ImageQuality = {
  width: number
  height: number
  warnings: string[]
}

type ReceiptQueueStatus = 'queued' | 'processing' | 'needs-review' | 'saved' | 'failed' | 'duplicate'
type ReceiptQueueItem = { id: string; file: File; status: ReceiptQueueStatus; message?: string; thumbnail?: string; retryable?: boolean; merchant?: string; scanResult?: ScanResult; draftFields?: ReceiptFields; draftItems?: ReceiptLineItem[]; draftFinancialReviewConfirmed?: boolean; draftRememberCategoryRule?: boolean }
type ScanStage = ProcessingStage
type ScanProgress = { jobId: string; stage: ScanStage; message: string; itemName?: string; itemIndex?: number; itemTotal?: number; previousStage?: ScanStage; uncertain?: boolean }

type SavedReceipt = ReceiptFields & { id: string; savedAt: string; imageName?: string; sourceFileName?: string; sourceType?: 'manual_expense'; items: ReceiptLineItem[]; matchedTransactionId?: string }
type SavedManualIncome = { id: string; savedAt: string; sourceType: 'manual_income'; ledgerRole: 'income'; merchant: string; counterparty: string; date: string; amount: string; currency: string; category: string; paymentMethod: string; notes: string; items: [] }
type TransactionDetail = { kind: 'receipt'; entry: SavedReceipt } | { kind: 'income'; entry: SavedManualIncome } | { kind: 'mpesa'; entry: SavedMpesaTransaction }
type LedgerReport = { from: string; to: string; undatedCount: number; totals: Array<{ currency: string; expenses: string; income: string; cashResult: string; inventorySales: string; costOfGoodsSold: string; grossProfit: string; profitIncome: string; profitExpenses: string; businessProfit: string }>; receiptCount: number; classifiedMpesaCount: number; unclassifiedMpesaCount: number; receivables: Array<{ counterparty: string; amount: string; currency: string }> }
type LedgerChatMessage = { id: string; role: 'user' | 'assistant'; content: string; createdAt: string; kind?: string; period?: { from: string; to: string }; interpreter?: string; sources?: string[] }

function chatMessageAttribution(message: LedgerChatMessage) {
  if (message.interpreter?.includes('currency calculation')) return 'Calculated locally using the exchange rate you supplied.'
  if (message.interpreter?.includes('Built-in local conversation')) return 'Answered locally.'
  if (message.interpreter?.includes('RAG response')) {
    const device = message.interpreter.includes('GPU (Vulkan)') ? 'GPU (Vulkan)' : message.interpreter.includes('GPU (Metal)') ? 'GPU (Metal)' : 'CPU'
    const method = message.interpreter.includes('EmbeddingGemma') ? 'semantic retrieval' : 'local text matching'
    const model = message.interpreter.split(' local RAG response')[0]
    return `${model} answered on ${device} using ${method} from local sources.`
  }
  if (message.interpreter?.includes('conversational response')) {
    const device = message.interpreter.includes('GPU (Vulkan)') ? 'GPU (Vulkan)' : message.interpreter.includes('GPU (Metal)') ? 'GPU (Metal)' : 'CPU'
    const model = message.interpreter.split(' local conversational response')[0]
    return `${model} replied locally on ${device}.`
  }
  if (message.interpreter?.includes('app guidance response')) return `Answered locally using Numora’s app guide on ${message.interpreter.includes('GPU (Vulkan)') ? 'GPU (Vulkan)' : message.interpreter.includes('GPU (Metal)') ? 'GPU (Metal)' : 'CPU'}.`
  if (message.interpreter === 'Local language model unavailable') return 'The local chat model did not start. Ledger calculations can still use saved records.'
  if (message.interpreter?.includes('wording + verified local ledger calculation')) {
    const device = message.interpreter.includes('GPU (Vulkan)') ? 'GPU (Vulkan)' : message.interpreter.includes('GPU (Metal)') ? 'GPU (Metal)' : 'CPU'
    const period = message.period ? ` · ${message.period.from} to ${message.period.to}` : ''
    const model = message.interpreter.split(' wording + verified local ledger calculation')[0]
    return `${model} phrased the answer on ${device}; figures were calculated from saved records${period}.`
  }
  if (message.kind === 'forecast') return 'Estimate calculated from recent saved expenses.'
  const period = message.period ? `Based on saved records · ${message.period.from} to ${message.period.to}` : ''
  const method = message.interpreter?.startsWith('Qwen') ? 'Qwen interpreted the question; ledger data supplied the figures.' : 'Local query rules; ledger data supplied the figures.'
  return [period, method].filter(Boolean).join(' · ')
}

function isConversationalChatPrompt(question: string) {
  const normalized = question.trim().toLowerCase().replace(/[.!?,]+$/g, '').replace(/\s+/g, ' ')
  return /^(hi|hello|hey|howdy|sasa|niaje|good morning|good afternoon|good evening|how are you|thanks|thank you|thank you numora|what can you do)$/.test(normalized)
}
function isSpendingForecastPrompt(question: string) {
  const normalized = question.trim().toLowerCase()
  return /\b(next|coming|upcoming) month\b/.test(normalized) && /\b(spend|spending|expense|expenses|cost|outgoings?)\b/.test(normalized)
    || /\b(forecast|predict|prediction|estimate|estimated|likely|probably|might|expect)\b/.test(normalized) && /\b(spend|spending|expense|expenses|cost|outgoings?)\b/.test(normalized)
}
type LedgerConversation = { id: string; title: string; createdAt: string; updatedAt: string; messages: LedgerChatMessage[] }
type InventoryItem = { id: string; name: string; unit: string; currency: 'KES' | 'USD'; quantityOnHand: string; averageUnitCost: string; createdAt: string }
type InventoryMovement = { id: string; itemId: string; itemName: string; type: 'stock-in' | 'sale'; date: string; quantity: string; currency: string; unitCost?: string; unitPrice?: string; totalCost?: string; costOfGoodsSold?: string; revenue?: string; grossProfit?: string; note?: string; sourceReceiptId?: string; sourceItemIndex?: number; sourceItemDescription?: string; sourceLineAmount?: number; matchedMpesaId?: string }
type InventorySummary = { currency: string; sales: string; costOfGoodsSold: string; grossProfit: string }
type RagStatus = { model: string; modelInstalled: boolean; modelBytes: number; indexedChunks: number; setup: { status: 'not-ready' | 'downloading' | 'indexing' | 'ready' | 'error'; stage: string; progress: number; error: string } }
type AppPreferences = WorkspacePreferences & { defaultChatModel?: string; defaultInterpretationModel?: string; defaultOcrModel?: 'auto' | 'easyocr' | 'lightonocr3' }
type ManagedModel = StartupModelStatus & { description?: string; bytes?: number; files?: Array<{ name: string; exists?: boolean; bytes?: number }> }
type ModelDownloadProgress = { status: 'idle' | 'downloading' | 'complete' | 'error' | 'cancelled'; modelId: string; stage: string; progress: number; downloaded: number; total: number; error: string }
type PersonalMemoryFact = { key: string; text: string; updatedAt: string }
type PersonalMemory = { displayName: string; facts: PersonalMemoryFact[] }
type BootstrapPayload = { status: string; storage: StartupStorageStatus; models: ManagedModel[]; pendingReviews: PendingReceiptReview[]; modelLoaded: boolean; modelInitialization: string; preferences?: AppPreferences; firstRun?: boolean; storageDirectory?: string; rag?: RagStatus; personalMemory?: PersonalMemory }
type LedgerStreamingAnswer = { conversationId: string; messageId: string; text: string }
type WorkspacePage = 'dashboard' | 'receipts' | 'expenses' | 'inventory' | 'reports' | 'ask' | 'categories' | 'settings'

const WORKSPACE_NAV: Array<{ id: WorkspacePage; label: string; description: string; icon: string }> = [
  { id: 'dashboard', label: 'Dashboard', description: 'Money at a glance', icon: 'grid' },
  { id: 'ask', label: 'Ask Numora', description: 'Ask about your money', icon: 'chat' },
  { id: 'receipts', label: 'Receipts', description: 'Add or read a receipt', icon: 'receipt' },
  { id: 'expenses', label: 'Transactions', description: 'Money in and out', icon: 'wallet' },
  { id: 'inventory', label: 'Inventory', description: 'Things you buy and sell', icon: 'box' },
  { id: 'reports', label: 'Reports', description: 'See spending patterns', icon: 'chart' },
  { id: 'categories', label: 'Categories', description: 'Group your spending', icon: 'tag' },
]
function NavIcon({ name }: { name: string }) {
  const paths: Record<string, string> = {
    grid: 'M3.5 3.5h7v7h-7zM13.5 3.5h7v7h-7zM3.5 13.5h7v7h-7zM13.5 13.5h7v7h-7z',
    receipt: 'M6 3.5h12v17l-2.5-1.7-3.5 1.9-3.5-1.9L6 20.5zM9 8h6M9 11.5h6M9 15h4',
    wallet: 'M4 6.5h15a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3h13M15 12h6M16.5 12h.01',
    box: 'm12 3 8.5 4.5v9L12 21l-8.5-4.5v-9zM3.5 7.5 12 12l8.5-4.5M12 12v9M8 5.4l8.5 4.5',
    chart: 'M3.5 20.5h17M6 17v-5M11 17V5M16 17V9M20 17v-2',
    tag: 'm3 12 8.5-8.5H20v8.5L11.5 20.5zM16 8h.01',
    chat: 'M20.5 11.5a7.8 7.8 0 0 1-8.2 7.8 8.2 8.2 0 0 1-3.8-.9L3 20l1.6-4.8a7.8 7.8 0 1 1 15.9-3.7zM8 10h8M8 13.5h5',
    settings: 'M12 8.2a3.8 3.8 0 1 0 0 7.6 3.8 3.8 0 0 0 0-7.6ZM19.4 13.6a7.8 7.8 0 0 0 0-1.2l1.4-1.1-1.4-2.5-1.7.6a7.4 7.4 0 0 0-1-.6L16.4 7h-2.9l-.3 1.8a7.4 7.4 0 0 0-1.1.6l-1.7-.6L9 11.3l1.4 1.1a7.8 7.8 0 0 0 0 1.2L9 14.7l1.4 2.5 1.7-.6a7.4 7.4 0 0 0 1.1.6l.3 1.8h2.9l.3-1.8a7.4 7.4 0 0 0 1-.6l1.7.6 1.4-2.5z',
    search: 'm20 20-4.5-4.5M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z',
    plus: 'M12 5v14M5 12h14',
    arrow: 'M5 12h14m-6-6 6 6-6 6',
    sparkle: 'M7 3H5a2 2 0 0 0-2 2v2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 8h10M7 12h10M7 16h6',
    menu: 'M4 6h16M4 12h16M4 18h16',
    sidebar: 'M4.5 4.5h15v15h-15zM9 4.5v15',
    copy: 'M8 8h11.5v12H8zM4.5 16V4h11',
  }
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d={paths[name] || paths.grid} /></svg>
}

function formatFileSize(bytes: number) {
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`
}

function localServiceError(cause: unknown, fallback: string) {
  const message = cause instanceof Error ? cause.message : ''
  if (/Unexpected end of JSON input|Failed to execute 'json'|Failed to fetch|NetworkError/i.test(message)) {
    return 'Numora could not reach its local service. Start or restart the API server, then try again.'
  }
  return message || fallback
}

type ReportPeriod = 'this-month' | 'last-month'
type ReportsPreset = 'this-month' | 'last-month' | '3-months' | '6-months' | 'year' | 'all' | 'custom'

function getReportRange(period: ReportPeriod, now = new Date()) {
  const start = period === 'this-month'
    ? new Date(now.getFullYear(), now.getMonth(), 1)
    : new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const end = period === 'this-month'
    ? new Date(now.getFullYear(), now.getMonth() + 1, 0)
    : new Date(now.getFullYear(), now.getMonth(), 0)
  const toIso = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  return { from: toIso(start), to: toIso(end) }
}

function localDateString(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function scanNeedsCarefulReview(scan: ScanResult) {
  return Boolean(scan.ocrQuality?.retryRecommended || scan.financialChecks?.requiresConfirmation
    || !scan.fields?.merchant || !scan.fields?.date || !scan.fields?.amount
    || scan.fields?.currency === 'Uncategorised')
}

async function inspectImage(file: File): Promise<ImageQuality> {
  const bitmap = await createImageBitmap(file)
  try {
    const canvas = document.createElement('canvas')
    const scale = Math.min(1, 640 / Math.max(bitmap.width, bitmap.height))
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('Could not inspect this image in the browser.')
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const { data, width, height } = context.getImageData(0, 0, canvas.width, canvas.height)
    const luminance = new Float32Array(width * height)
    let sum = 0
    for (let i = 0, pixel = 0; i < data.length; i += 4, pixel += 1) {
      const value = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
      luminance[pixel] = value
      sum += value
    }
    const mean = sum / luminance.length
    let variance = 0
    for (const value of luminance) variance += (value - mean) ** 2
    const contrast = Math.sqrt(variance / luminance.length)

    // Laplacian variance is a lightweight blur indicator. It is a heuristic,
    // so it only warns and never prevents the user from trying OCR.
    let laplacianSum = 0
    let laplacianSquared = 0
    let samples = 0
    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) {
        const i = y * width + x
        const laplacian = luminance[i - width] + luminance[i - 1] - 4 * luminance[i] + luminance[i + 1] + luminance[i + width]
        laplacianSum += laplacian
        laplacianSquared += laplacian * laplacian
        samples += 1
      }
    }
    const laplacianMean = laplacianSum / Math.max(1, samples)
    const sharpness = laplacianSquared / Math.max(1, samples) - laplacianMean ** 2
    const warnings: string[] = []
    if (Math.min(bitmap.width, bitmap.height) < 450 || Math.max(bitmap.width, bitmap.height) < 900) {
      warnings.push('This image has limited resolution. A closer, higher-resolution photo may read better.')
    }
    if (mean < 55) warnings.push('The image looks quite dark. Add more even light and retake it if possible.')
    else if (mean > 232) warnings.push('The image looks very bright. Reduce glare or exposure if possible.')
    if (contrast < 28) warnings.push('The image has low contrast. Make sure the receipt text stands out from the paper.')
    if (sharpness < 35) warnings.push('The image may be blurry. Hold the camera steady and focus on the receipt.')
    return { width: bitmap.width, height: bitmap.height, warnings }
  } finally {
    bitmap.close()
  }
}

function App() {
  const inputRef = useRef<HTMLInputElement>(null)
  const expenseSearchRef = useRef<HTMLInputElement>(null)
  const imagePreparationRef = useRef<ImagePreparationHandle>(null)
  const activeScanRef = useRef<{ jobId: string; controller: AbortController; queueItemId: string | null } | null>(null)
  const [activePage, setActivePage] = useState<WorkspacePage>(() => {
    try {
      const previous = localStorage.getItem('numora:last-page')
      return WORKSPACE_NAV.some((item) => item.id === previous) || previous === 'settings' ? previous as WorkspacePage : 'dashboard'
    } catch { return 'dashboard' }
  })
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try { return localStorage.getItem('numora:sidebar-collapsed') === 'true' } catch { return false }
  })
  const [showLaunchScreen, setShowLaunchScreen] = useState(true)
  const [showFirstRunSetup, setShowFirstRunSetup] = useState(false)
  const [firstRun, setFirstRun] = useState(false)
  const [setupSaving, setSetupSaving] = useState(false)
  const [setupError, setSetupError] = useState('')
  const [storageDirectory, setStorageDirectory] = useState('')
  const [storageDirectoryDraft, setStorageDirectoryDraft] = useState('')
  const [storageChangeBusy, setStorageChangeBusy] = useState(false)
  const [storageChangeMessage, setStorageChangeMessage] = useState('')
  const [defaultCurrency, setDefaultCurrency] = useState<'KES' | 'USD'>('KES')
  const [settingsCurrency, setSettingsCurrency] = useState<'KES' | 'USD'>('KES')
  const [settingsStartPage, setSettingsStartPage] = useState<'dashboard' | 'receipts'>('dashboard')
  const [appearance, setAppearance] = useState<'light' | 'dark'>(() => {
    try { return localStorage.getItem('numora:appearance') === 'dark' ? 'dark' : 'light' } catch { return 'light' }
  })
  const [settingsChatModel, setSettingsChatModel] = useState('auto')
  const [settingsInterpretationModel, setSettingsInterpretationModel] = useState('auto')
  const [settingsOcrModel, setSettingsOcrModel] = useState<'auto' | 'easyocr' | 'lightonocr3'>('auto')
  const [personalMemory, setPersonalMemory] = useState<PersonalMemory>({ displayName: '', facts: [] })
  const [personalMemoryDraft, setPersonalMemoryDraft] = useState('')
  const [personalMemoryFactDraft, setPersonalMemoryFactDraft] = useState('')
  const [showPersonalMemory, setShowPersonalMemory] = useState(false)
  const [personalMemorySaving, setPersonalMemorySaving] = useState(false)
  const [personalMemoryMessage, setPersonalMemoryMessage] = useState('')
  const [chatModelChoice, setChatModelChoice] = useState('auto')
  const [settingsSavedMessage, setSettingsSavedMessage] = useState('')
  const [settingsSaving, setSettingsSaving] = useState(false)
  const [isBootChecking, setIsBootChecking] = useState(true)
  const [bootMessage, setBootMessage] = useState('Loading local preferences…')
  const [bootError, setBootError] = useState('')
  const [startupModels, setStartupModels] = useState<ManagedModel[]>([])
  const [startupModelPreparation, setStartupModelPreparation] = useState<StartupModelPreparation>({ status: 'idle', stage: 'Waiting for local model preparation.', modelId: '', modelName: '', backend: '', progress: 0, error: '', activeTask: '', models: { ocr: { status: 'idle', modelName: '', backend: '', progress: 0, error: '' }, chat: { status: 'idle', modelName: '', backend: '', progress: 0, error: '' } } })
  const [modelDownload, setModelDownload] = useState<ModelDownloadProgress>({ status: 'idle', modelId: '', stage: '', progress: 0, downloaded: 0, total: 0, error: '' })
  const [modelBrowseBusy, setModelBrowseBusy] = useState(false)
  const [modelManagerBusy, setModelManagerBusy] = useState(false)
  const [modelManagerMessage, setModelManagerMessage] = useState('')
  const [localModelPath, setLocalModelPath] = useState('')
  const [ragStatus, setRagStatus] = useState<RagStatus | null>(null)
  const [ragSetupBusy, setRagSetupBusy] = useState(false)
  const [pendingReviews, setPendingReviews] = useState<PendingReceiptReview[]>([])
  const [expenseSearch, setExpenseSearch] = useState('')
  const [expenseCategoryFilter, setExpenseCategoryFilter] = useState('')
  const [expenseMerchantFilter, setExpenseMerchantFilter] = useState('')
  const [expenseDateFrom, setExpenseDateFrom] = useState('')
  const [expenseDateTo, setExpenseDateTo] = useState('')
  const [expenseAmountMin, setExpenseAmountMin] = useState('')
  const [expenseAmountMax, setExpenseAmountMax] = useState('')
  const [expenseCurrencyFilter, setExpenseCurrencyFilter] = useState('')
  const [showManualExpenseForm, setShowManualExpenseForm] = useState(false)
  const [manualExpense, setManualExpense] = useState({ merchant: '', date: localDateString(), amount: '', currency: 'KES', category: 'Uncategorised', paymentMethod: 'Cash', notes: '' })
  const [manualExpenseError, setManualExpenseError] = useState('')
  const [manualExpenseNotice, setManualExpenseNotice] = useState('')
  const [isSavingManualExpense, setIsSavingManualExpense] = useState(false)
  const [showManualIncomeForm, setShowManualIncomeForm] = useState(false)
  const [manualIncome, setManualIncome] = useState({ source: '', date: localDateString(), amount: '', currency: 'KES', category: 'Sales', paymentMethod: 'Cash', notes: '' })
  const [manualIncomeError, setManualIncomeError] = useState('')
  const [manualIncomeNotice, setManualIncomeNotice] = useState('')
  const [isSavingManualIncome, setIsSavingManualIncome] = useState(false)
  const [savedReceiptConfirmation, setSavedReceiptConfirmation] = useState<SavedReceipt | null>(null)
  const [savedReceiptQueueId, setSavedReceiptQueueId] = useState<string | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [isDragging, setIsDragging] = useState(false)
  const [receiptQueue, setReceiptQueue] = useState<ReceiptQueueItem[]>([])
  const [receiptQueueReady, setReceiptQueueReady] = useState(false)
  const [receiptQueueStorageError, setReceiptQueueStorageError] = useState('')
  const [receiptQueueFilter, setReceiptQueueFilter] = useState<'all' | 'processing' | 'needs-review' | 'saved' | 'failed'>('all')
  const [receiptQueueSearch, setReceiptQueueSearch] = useState('')
  const [activeQueueId, setActiveQueueId] = useState<string | null>(null)
  const activeQueueIdRef = useRef<string | null>(null)
  const [receiptScreen, setReceiptScreen] = useState<'import' | 'review' | 'saved'>('import')
  const [receiptInputMode, setReceiptInputMode] = useState<'images' | 'mpesa'>('images')
  const [queueBatchMessage, setQueueBatchMessage] = useState('')
  const [isScanning, setIsScanning] = useState(false)
  const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null)
  const [isDeepReading, setIsDeepReading] = useState(false)
  const [deepReadError, setDeepReadError] = useState('')
  const [scan, setScan] = useState<ScanResult | null>(null)
  const [fields, setFields] = useState<ReceiptFields | null>(null)
  const [items, setItems] = useState<ReceiptLineItem[]>([])
  const [saved, setSaved] = useState<SavedReceipt[]>([])
  const [savedMpesa, setSavedMpesa] = useState<SavedMpesaTransaction[]>([])
  const [savedManualIncome, setSavedManualIncome] = useState<SavedManualIncome[]>([])
  const [selectedTransaction, setSelectedTransaction] = useState<TransactionDetail | null>(null)
  useEffect(() => {
    if (!selectedTransaction) return
    const closeOnEscape = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape') setSelectedTransaction(null) }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [selectedTransaction])
  const [ledgerReport, setLedgerReport] = useState<LedgerReport | null>(null)
  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([])
  const [inventoryMovements, setInventoryMovements] = useState<InventoryMovement[]>([])
  const [inventoryReport, setInventoryReport] = useState<InventorySummary[]>([])
  const [inventoryError, setInventoryError] = useState('')
  const [inventoryNotice, setInventoryNotice] = useState('')
  const [inventoryName, setInventoryName] = useState('')
  const [inventoryUnit, setInventoryUnit] = useState('unit')
  const [inventoryCurrency, setInventoryCurrency] = useState<'KES' | 'USD'>('KES')
  const [inventoryAction, setInventoryAction] = useState<'stock-in' | 'sale'>('stock-in')
  const [inventoryItemId, setInventoryItemId] = useState('')
  const [inventoryQuantity, setInventoryQuantity] = useState('')
  const [inventoryUnitValue, setInventoryUnitValue] = useState('')
  const [inventoryDate, setInventoryDate] = useState(() => localDateString())
  const [inventoryNote, setInventoryNote] = useState('')
  const [stockReceiptId, setStockReceiptId] = useState('')
  const [stockReceiptLineIndex, setStockReceiptLineIndex] = useState('')
  const [stockReceiptItemId, setStockReceiptItemId] = useState('')
  const [stockReceiptQuantity, setStockReceiptQuantity] = useState('1')
  const [stockReceiptDate, setStockReceiptDate] = useState(() => localDateString())
  const [isSavingInventory, setIsSavingInventory] = useState(false)
  const [reportPeriod, setReportPeriod] = useState<ReportPeriod>('this-month')
  const [reportsPreset, setReportsPreset] = useState<ReportsPreset>('this-month')
  const [reportsFrom, setReportsFrom] = useState(() => getReportRange('this-month').from)
  const [reportsTo, setReportsTo] = useState(() => getReportRange('this-month').to)
  const [reportGrouping, setReportGrouping] = useState<'weekly' | 'monthly'>('weekly')
  const [reportCurrency, setReportCurrency] = useState('')
  const [reportsLoading, setReportsLoading] = useState(false)
  const [reportError, setReportError] = useState('')
  const [ledgerConversations, setLedgerConversations] = useState<LedgerConversation[]>([])
  const [activeLedgerChatId, setActiveLedgerChatId] = useState('')
  const [ledgerChatDraft, setLedgerChatDraft] = useState('')
  const [ledgerChatError, setLedgerChatError] = useState('')
  const [ledgerChatsLoading, setLedgerChatsLoading] = useState(false)
  const [ledgerChatSending, setLedgerChatSending] = useState(false)
  const [ledgerSendingQuestion, setLedgerSendingQuestion] = useState('')
  const [ledgerSendingConversationId, setLedgerSendingConversationId] = useState('')
  const [ledgerStreamingAnswer, setLedgerStreamingAnswer] = useState<LedgerStreamingAnswer | null>(null)
  const [ledgerChatDeletingId, setLedgerChatDeletingId] = useState('')
  const [copiedChatMessageId, setCopiedChatMessageId] = useState('')
  const [chatHistoryCollapsed, setChatHistoryCollapsed] = useState(() => {
    try { return localStorage.getItem('numora:chat-history-collapsed') === 'true' } catch { return false }
  })
  const [chatHistoryResizing, setChatHistoryResizing] = useState(false)
  const [chatHistoryWidth, setChatHistoryWidth] = useState(() => {
    try {
      const savedWidth = Number(localStorage.getItem('numora:chat-history-width'))
      return Number.isFinite(savedWidth) && savedWidth >= 200 ? Math.min(420, savedWidth) : 260
    } catch { return 260 }
  })
  const chatHistoryResizeRef = useRef<{ pointerId: number; startX: number; startWidth: number } | null>(null)
  const ledgerChatMessagesRef = useRef<HTMLDivElement>(null)
  const workspaceMainRef = useRef<HTMLElement>(null)
  function resizeChatHistoryTo(width: number) {
    setChatHistoryWidth(Math.min(420, Math.max(200, Math.round(width))))
  }
  function startChatHistoryResize(event: ReactPointerEvent<HTMLDivElement>) {
    if (window.matchMedia('(max-width: 760px)').matches) return
    event.preventDefault()
    chatHistoryResizeRef.current = { pointerId: event.pointerId, startX: event.clientX, startWidth: chatHistoryWidth }
    event.currentTarget.setPointerCapture(event.pointerId)
    setChatHistoryResizing(true)
  }
  function moveChatHistoryResize(event: ReactPointerEvent<HTMLDivElement>) {
    const resize = chatHistoryResizeRef.current
    if (!resize || !event.currentTarget.hasPointerCapture(resize.pointerId)) return
    resizeChatHistoryTo(resize.startWidth + event.clientX - resize.startX)
  }
  function finishChatHistoryResize(event: ReactPointerEvent<HTMLDivElement>) {
    const pointerId = chatHistoryResizeRef.current?.pointerId
    if (pointerId !== undefined && event.currentTarget.hasPointerCapture(pointerId)) event.currentTarget.releasePointerCapture(pointerId)
    chatHistoryResizeRef.current = null
    setChatHistoryResizing(false)
  }
  function handleChatHistoryResizeKey(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight' || event.key === 'Home' || event.key === 'End') event.preventDefault()
    if (event.key === 'ArrowLeft') resizeChatHistoryTo(chatHistoryWidth - (event.shiftKey ? 40 : 20))
    if (event.key === 'ArrowRight') resizeChatHistoryTo(chatHistoryWidth + (event.shiftKey ? 40 : 20))
    if (event.key === 'Home') resizeChatHistoryTo(200)
    if (event.key === 'End') resizeChatHistoryTo(420)
  }
  const [matchingTransactionId, setMatchingTransactionId] = useState('')
  const [matchMessage, setMatchMessage] = useState('')
  const [exportMessage, setExportMessage] = useState('')
  const [mpesaText, setMpesaText] = useState('')
  const [mpesaRows, setMpesaRows] = useState<MpesaTransaction[]>([])
  const [mpesaError, setMpesaError] = useState('')
  const [mpesaNotice, setMpesaNotice] = useState('')
  const [isParsingMpesa, setIsParsingMpesa] = useState(false)
  const [isSavingMpesa, setIsSavingMpesa] = useState(false)
  const [categoryRules, setCategoryRules] = useState<MerchantCategoryRule[]>([])
  const [ruleMerchant, setRuleMerchant] = useState('')
  const [ruleCategory, setRuleCategory] = useState('Food')
  const [isSavingRule, setIsSavingRule] = useState(false)
  const [ruleMessage, setRuleMessage] = useState('')
  const [serverReady, setServerReady] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [financialReviewConfirmed, setFinancialReviewConfirmed] = useState(false)
  const [rememberCategoryRule, setRememberCategoryRule] = useState(false)
  const [notice, setNotice] = useState('')
  const [imageQuality, setImageQuality] = useState<ImageQuality | null>(null)
  const [isCheckingQuality, setIsCheckingQuality] = useState(false)

  async function prepareStartupChatModel() {
    setStartupModelPreparation({ status: 'preparing', stage: 'Preparing local models…', modelId: '', modelName: '', backend: '', progress: 0, error: '', activeTask: '', models: { ocr: { status: 'idle', modelName: '', backend: '', progress: 0, error: '' }, chat: { status: 'idle', modelName: '', backend: '', progress: 0, error: '' } } })
    setBootMessage('Preparing receipt OCR and chat models…')
    try {
      const started = await fetch('/api/models/prepare', { method: 'POST', signal: AbortSignal.timeout(10000) })
      if (!started.ok) throw new Error(`Could not start local model preparation (${started.status}).`)
      const initial = await started.json() as { preparation: StartupModelPreparation }
      setStartupModelPreparation(initial.preparation)
      const deadline = Date.now() + 5 * 60 * 1000
      while (Date.now() < deadline) {
        if (initial.preparation.status !== 'preparing') {
          setBootMessage(initial.preparation.stage)
          return initial.preparation
        }
        await new Promise((resolve) => window.setTimeout(resolve, 500))
        const response = await fetch('/api/models/prepare', { cache: 'no-store', signal: AbortSignal.timeout(10000) })
        if (!response.ok) throw new Error(`Could not check local model readiness (${response.status}).`)
        const next = (await response.json() as { preparation: StartupModelPreparation }).preparation
        setStartupModelPreparation(next)
        setBootMessage(next.stage)
        if (next.status !== 'preparing') return next
      }
      const timeoutState: StartupModelPreparation = { status: 'timeout', stage: 'Model startup is taking longer than expected. Opening Numora while preparation continues in the background.', modelId: '', modelName: '', backend: '', progress: 0, error: '', activeTask: '', models: { ocr: { status: 'idle', modelName: '', backend: '', progress: 0, error: '' }, chat: { status: 'idle', modelName: '', backend: '', progress: 0, error: '' } } }
      setStartupModelPreparation(timeoutState)
      setBootMessage(timeoutState.stage)
      return timeoutState
    } catch (cause) {
      const error = cause instanceof Error ? cause.message : 'The local models could not be prepared.'
      const errorState: StartupModelPreparation = { status: 'error', stage: 'Local models could not be prepared. Numora will still open.', modelId: '', modelName: '', backend: '', progress: 0, error, activeTask: '', models: { ocr: { status: 'idle', modelName: '', backend: '', progress: 0, error }, chat: { status: 'idle', modelName: '', backend: '', progress: 0, error } } }
      setStartupModelPreparation(errorState)
      setBootMessage(errorState.stage)
      return errorState
    }
  }

  async function initializeWorkspace() {
    setIsBootChecking(true)
    setBootError('')
    setBootMessage('Connecting to the local Numora service…')
    try {
      const response = await fetch('/api/bootstrap', { cache: 'no-store', signal: AbortSignal.timeout(6000) })
      if (!response.ok) throw new Error(`Local startup check returned ${response.status}.`)
      const result = await response.json() as BootstrapPayload
      setBootMessage('Checking your local ledger and installed model files…')
      setServerReady(true)
      setStartupModels(Array.isArray(result.models) ? result.models : [])
      setRagStatus(result.rag || null)
      setPendingReviews(Array.isArray(result.pendingReviews) ? result.pendingReviews : [])
      const loadedPersonalMemory: PersonalMemory = { displayName: String(result.personalMemory?.displayName || ''), facts: Array.isArray(result.personalMemory?.facts) ? result.personalMemory.facts : [] }
      setPersonalMemory(loadedPersonalMemory)
      setPersonalMemoryDraft(loadedPersonalMemory.displayName)
      setFirstRun(Boolean(result.firstRun))
      setStorageDirectory(String(result.storageDirectory || ''))
      setStorageDirectoryDraft(String(result.storageDirectory || ''))
      if (result.preferences?.defaultCurrency === 'USD' || result.preferences?.defaultCurrency === 'KES') {
        setDefaultCurrency(result.preferences.defaultCurrency)
        setSettingsCurrency(result.preferences.defaultCurrency)
      }
      if (result.preferences?.startPage === 'receipts' || result.preferences?.startPage === 'dashboard') setSettingsStartPage(result.preferences.startPage)
      setSettingsChatModel(result.preferences?.defaultChatModel || 'auto')
      setChatModelChoice('auto')
      setSettingsInterpretationModel(result.preferences?.defaultInterpretationModel || 'auto')
      setSettingsOcrModel(result.preferences?.defaultOcrModel || 'auto')
      if (result.preferences?.startPage && !localStorage.getItem('numora:last-page')) setActivePage(result.preferences.startPage)
      const startupModelPromise = prepareStartupChatModel()
      const [receiptsResponse, mpesaResponse, incomeResponse, rulesResponse] = await Promise.allSettled([
        fetch('/api/receipts'), fetch('/api/mpesa'), fetch('/api/income'), fetch('/api/category-rules'),
      ])
      if (receiptsResponse.status === 'fulfilled' && receiptsResponse.value.ok) {
        const data = await receiptsResponse.value.json()
        setSaved(Array.isArray(data.receipts) ? data.receipts as SavedReceipt[] : [])
      }
      if (mpesaResponse.status === 'fulfilled' && mpesaResponse.value.ok) {
        const data = await mpesaResponse.value.json()
        setSavedMpesa(Array.isArray(data.transactions) ? data.transactions as SavedMpesaTransaction[] : [])
      }
      if (incomeResponse.status === 'fulfilled' && incomeResponse.value.ok) {
        const data = await incomeResponse.value.json()
        setSavedManualIncome(Array.isArray(data.incomes) ? data.incomes as SavedManualIncome[] : [])
      }
      if (rulesResponse.status === 'fulfilled' && rulesResponse.value.ok) {
        const data = await rulesResponse.value.json()
        setCategoryRules(Array.isArray(data.rules) ? data.rules as MerchantCategoryRule[] : [])
      }
      await Promise.all([refreshLedgerReport(), refreshInventory(), startupModelPromise])
    } catch (cause) {
      setServerReady(false)
      setBootError(cause instanceof Error ? cause.message : 'The local Numora service could not be reached.')
      setBootMessage('Your local service is unavailable.')
    } finally {
      setIsBootChecking(false)
    }
  }

  async function setupLocalKnowledge() {
    if (ragSetupBusy || !serverReady) return
    setRagSetupBusy(true)
    try {
      const response = await fetch('/api/rag/setup', { method: 'POST' })
      if (!response.ok) throw new Error('Could not start local knowledge setup.')
      setRagStatus(await response.json() as RagStatus)
      const deadline = Date.now() + 15 * 60 * 1000
      while (Date.now() < deadline) {
        await new Promise((resolve) => window.setTimeout(resolve, 900))
        const statusResponse = await fetch('/api/rag/status', { cache: 'no-store' })
        if (!statusResponse.ok) throw new Error('Could not read local knowledge setup status.')
        const nextStatus = await statusResponse.json() as RagStatus
        setRagStatus(nextStatus)
        if (nextStatus.modelInstalled) {
          setStartupModels((models) => models.map((model) => model.id === 'rag-embedding' ? { ...model, installed: true } : model))
        }
        if (nextStatus.setup.status === 'ready' || nextStatus.setup.status === 'error') break
      }
    } catch (cause) {
      setRagStatus((current) => current ? { ...current, setup: { ...current.setup, status: 'error', stage: 'Local knowledge setup failed', error: cause instanceof Error ? cause.message : 'Could not set up local knowledge search.' } } : current)
    } finally {
      setRagSetupBusy(false)
    }
  }

  async function resumePendingReceipt(reviewId: string) {
    setBootError('')
    setBootMessage('Restoring your unfinished receipt review…')
    try {
      const [reviewResponse, imageResponse] = await Promise.all([
        fetch(`/api/receipts/pending/${encodeURIComponent(reviewId)}`),
        fetch(`/api/receipts/pending/${encodeURIComponent(reviewId)}/image`),
      ])
      if (!reviewResponse.ok || !imageResponse.ok) throw new Error('This receipt review could not be restored. Try reading the image again.')
      const restored = await reviewResponse.json() as ScanResult
      const pendingReview = pendingReviews.find((review) => review.reviewId === reviewId)
      const blob = await imageResponse.blob()
      const restoredFile = new File([blob], pendingReview?.originalName || 'receipt-image', { type: blob.type || 'image/jpeg', lastModified: Date.now() })
      let savedEdits: { fields?: ReceiptFields; items?: ReceiptLineItem[] } = {}
      try { savedEdits = JSON.parse(localStorage.getItem(`numora:receipt-review:${reviewId}`) || '{}') } catch {}
      setFile(restoredFile)
      setScan(restored)
      setFields(savedEdits.fields || restored.fields)
      setItems(Array.isArray(savedEdits.items) ? savedEdits.items : restored.items)
      setFinancialReviewConfirmed(false)
      setPendingReviews((current) => current.some((review) => review.reviewId === reviewId) ? current : [...current, { reviewId, originalName: pendingReview?.originalName || 'Receipt image', createdAt: pendingReview?.createdAt || new Date().toISOString(), merchant: restored.fields.merchant, date: restored.fields.date, amount: restored.fields.amount, currency: restored.fields.currency }])
      setError('')
      setNotice('Unfinished receipt review restored. Check the fields before saving.')
      setActivePage('receipts')
      setShowLaunchScreen(false)
    } catch (cause) {
      setBootError(cause instanceof Error ? cause.message : 'Could not restore this receipt review.')
    }
  }

  async function saveFirstRunSetup(preferences: WorkspacePreferences) {
    setSetupSaving(true)
    setSetupError('')
    try {
      const response = await fetch('/api/preferences', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(preferences) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Could not save your workspace preferences.')
      setDefaultCurrency(preferences.defaultCurrency)
      setSettingsCurrency(preferences.defaultCurrency)
      setSettingsStartPage(preferences.startPage)
      setStorageDirectory(String(result.storageDirectory || storageDirectory))
      setStorageDirectoryDraft(String(result.storageDirectory || storageDirectory))
      setSettingsChatModel(result.preferences?.defaultChatModel || 'auto')
      setChatModelChoice('auto')
      setSettingsInterpretationModel(result.preferences?.defaultInterpretationModel || 'auto')
      setSettingsOcrModel(result.preferences?.defaultOcrModel || 'auto')
      setFirstRun(false)
      setActivePage(preferences.startPage)
      try { localStorage.setItem('numora:last-page', preferences.startPage) } catch {}
      setShowFirstRunSetup(false)
      setShowLaunchScreen(false)
    } catch (cause) {
      setSetupError(cause instanceof Error ? cause.message : 'Could not save your workspace preferences.')
    } finally {
      setSetupSaving(false)
    }
  }

  async function saveWorkspacePreferences(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSettingsSaving(true)
    setSettingsSavedMessage('')
    try {
      const response = await fetch('/api/preferences', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ defaultCurrency: settingsCurrency, startPage: settingsStartPage, defaultChatModel: settingsChatModel, defaultInterpretationModel: settingsInterpretationModel, defaultOcrModel: settingsOcrModel }) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Could not save these preferences.')
      setDefaultCurrency(settingsCurrency)
      setSettingsChatModel(result.preferences.defaultChatModel || 'auto')
      setChatModelChoice('auto')
      setSettingsInterpretationModel(result.preferences.defaultInterpretationModel || 'auto')
      setSettingsOcrModel(result.preferences.defaultOcrModel || 'auto')
      setSettingsSavedMessage('Preferences saved on this device.')
    } catch (cause) {
      setSettingsSavedMessage(cause instanceof Error ? cause.message : 'Could not save these preferences.')
    } finally {
      setSettingsSaving(false)
    }
  }

  async function savePersonalMemory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const fact = personalMemoryFactDraft.trim()
    if (!personalMemoryDraft.trim() && !fact) return
    setPersonalMemorySaving(true)
    setPersonalMemoryMessage('')
    try {
      const response = await fetch('/api/personal-memory', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ displayName: personalMemoryDraft.trim() || personalMemory.displayName, ...(fact ? { fact } : {}) }) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Could not save this local memory.')
      const nextMemory = result.personalMemory as PersonalMemory
      setPersonalMemory(nextMemory)
      setPersonalMemoryDraft(nextMemory.displayName)
      setPersonalMemoryFactDraft('')
      setPersonalMemoryMessage(result.message || 'Saved on this device.')
    } catch (cause) {
      setPersonalMemoryMessage(cause instanceof Error ? cause.message : 'Could not save this local memory.')
    } finally { setPersonalMemorySaving(false) }
  }

  async function clearPersonalMemory() {
    setPersonalMemorySaving(true)
    setPersonalMemoryMessage('')
    try {
      const response = await fetch('/api/personal-memory', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ displayName: '' }) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Could not clear this local memory.')
      setPersonalMemory(result.personalMemory as PersonalMemory)
      setPersonalMemoryDraft('')
      setPersonalMemoryMessage(result.message || 'Numora has forgotten the saved name.')
    } catch (cause) {
      setPersonalMemoryMessage(cause instanceof Error ? cause.message : 'Could not clear this local memory.')
    } finally { setPersonalMemorySaving(false) }
  }

  async function removePersonalMemoryFact(key: string) {
    setPersonalMemorySaving(true)
    setPersonalMemoryMessage('')
    try {
      const response = await fetch('/api/personal-memory', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ removeFactKey: key }) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Could not remove this memory.')
      setPersonalMemory(result.personalMemory as PersonalMemory)
      setPersonalMemoryMessage(result.message || 'That memory was removed.')
    } catch (cause) {
      setPersonalMemoryMessage(cause instanceof Error ? cause.message : 'Could not remove this memory.')
    } finally { setPersonalMemorySaving(false) }
  }

  async function clearAllPersonalMemory() {
    setPersonalMemorySaving(true)
    setPersonalMemoryMessage('')
    try {
      const response = await fetch('/api/personal-memory', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clearAll: true }) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Could not clear personal memory.')
      const nextMemory = result.personalMemory as PersonalMemory
      setPersonalMemory(nextMemory)
      setPersonalMemoryDraft('')
      setPersonalMemoryMessage(result.message || 'All memories were cleared from this device.')
    } catch (cause) {
      setPersonalMemoryMessage(cause instanceof Error ? cause.message : 'Could not clear personal memory.')
    } finally { setPersonalMemorySaving(false) }
  }

  async function refreshModelCatalog() {
    const response = await fetch('/api/models', { cache: 'no-store' })
    const result = await response.json()
    if (!response.ok) throw new Error(result.error || 'Could not load model status.')
    setStartupModels(Array.isArray(result.models) ? result.models as ManagedModel[] : [])
    if (result.preferences) {
      setSettingsChatModel(result.preferences.defaultChatModel || 'auto')
      setSettingsInterpretationModel(result.preferences.defaultInterpretationModel || 'auto')
      setSettingsOcrModel(result.preferences.defaultOcrModel || 'auto')
    }
  }

  async function startModelDownload(modelId: string) {
    setModelManagerBusy(true)
    setModelManagerMessage('')
    try {
      const response = await fetch('/api/models/download', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ modelId }) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Could not start the download.')
      setModelDownload({ status: 'downloading', modelId, stage: 'Starting download…', progress: 0, downloaded: 0, total: 0, error: '' })
    } catch (cause) {
      setModelManagerMessage(cause instanceof Error ? cause.message : 'Could not start the download.')
    } finally { setModelManagerBusy(false) }
  }

  async function browseModelLibrary() {
    setModelBrowseBusy(true)
    setModelManagerMessage('')
    try {
      const response = await fetch('/api/models/browse', { method: 'POST' })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'The QVAC model library could not be reached.')
      await refreshModelCatalog()
      setModelManagerMessage(`${result.models?.length || 0} compatible small chat models found in the QVAC library.`)
    } catch (cause) {
      setModelManagerMessage(cause instanceof Error ? cause.message : 'The model library could not be reached.')
    } finally { setModelBrowseBusy(false) }
  }

  async function cancelModelDownload() {
    try {
      const response = await fetch('/api/models/download/cancel', { method: 'POST' })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Could not cancel this download.')
      setModelDownload(result.download as ModelDownloadProgress)
    } catch (cause) {
      setModelManagerMessage(cause instanceof Error ? cause.message : 'Could not cancel this download.')
    }
  }

  async function addLocalChatModel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setModelManagerBusy(true)
    setModelManagerMessage('')
    try {
      const response = await fetch('/api/models/import-chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: localModelPath }) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Could not add that model.')
      setModelManagerMessage(`${result.model.name} is available in the chat model menu.`)
      setLocalModelPath('')
      await refreshModelCatalog()
    } catch (cause) {
      setModelManagerMessage(cause instanceof Error ? cause.message : 'Could not add that model.')
    } finally { setModelManagerBusy(false) }
  }

  async function changeStorageDirectory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setStorageChangeBusy(true)
    setStorageChangeMessage('Copying the current workspace…')
    try {
      const response = await fetch('/api/storage/change', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ directory: storageDirectoryDraft }) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Could not switch workspace folders.')
      setStorageDirectory(String(result.storageDirectory || storageDirectoryDraft))
      setStorageDirectoryDraft(String(result.storageDirectory || storageDirectoryDraft))
      setStorageChangeMessage(result.message || 'Workspace folder updated.')
    } catch (cause) {
      setStorageChangeMessage(cause instanceof Error ? cause.message : 'Could not switch workspace folders.')
    } finally { setStorageChangeBusy(false) }
  }

  async function chooseStorageDirectory() {
    try {
      const directory = await window.numoraDesktop?.selectWorkspaceDirectory()
      if (directory) {
        setStorageDirectoryDraft(directory)
        setStorageChangeMessage('')
      }
    } catch (cause) {
      setStorageChangeMessage(cause instanceof Error ? cause.message : 'Could not open the folder picker.')
    }
  }

  async function refreshLedgerReport(period: ReportPeriod = reportPeriod) {
    try {
      const range = getReportRange(period)
      const response = await fetch(`/api/reports/summary?from=${range.from}&to=${range.to}`)
      if (!response.ok) return
      const result = await response.json()
      setLedgerReport(result.report as LedgerReport)
    } catch { /* report stays unavailable until the local server responds */ }
  }

  async function loadReportsRange(from = reportsFrom, to = reportsTo) {
    if (!from || !to || from > to) return
    setReportsLoading(true)
    setReportError('')
    try {
      const response = await fetch(`/api/reports/summary?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Could not refresh this report period.')
      setLedgerReport(result.report as LedgerReport)
    } catch (cause) {
      setReportError(localServiceError(cause, 'Could not refresh this report period.'))
    } finally {
      setReportsLoading(false)
    }
  }

  function chooseReportsPreset(preset: ReportsPreset) {
    setReportsPreset(preset)
    if (preset === 'custom') return
    if (preset === 'all' || preset === 'year' || preset === '6-months') setReportGrouping('monthly')
    else setReportGrouping('weekly')
    const today = new Date()
    const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1)
    let fromDate = firstOfMonth
    let toDate = today
    if (preset === 'this-month') fromDate = firstOfMonth
    if (preset === 'last-month') {
      const range = getReportRange('last-month', today)
      setReportsFrom(range.from); setReportsTo(range.to); return
    }
    if (preset === '3-months') fromDate = new Date(today.getFullYear(), today.getMonth() - 2, 1)
    if (preset === '6-months') fromDate = new Date(today.getFullYear(), today.getMonth() - 5, 1)
    if (preset === 'year') fromDate = new Date(today.getFullYear(), 0, 1)
    if (preset === 'all') {
      const datedEntries = [...saved.map((entry) => entry.date), ...savedMpesa.map((entry) => entry.date)].filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)).sort()
      fromDate = datedEntries.length ? new Date(`${datedEntries[0]}T00:00:00`) : firstOfMonth
    }
    const from = localDateString(fromDate)
    const to = localDateString(toDate)
    setReportsFrom(from); setReportsTo(to)
  }

  function exportReportsCsv() {
    const rows: string[][] = [
      ['date', 'record_type', 'merchant_or_counterparty', 'category', 'ledger_treatment', 'payment_method', 'amount', 'currency', 'transaction_id', 'fee', 'notes'],
      ...saved.filter((entry) => entry.date >= reportsFrom && entry.date <= reportsTo).map((entry) => [entry.date, entry.sourceType === 'manual_expense' ? 'manual_expense' : 'receipt', entry.merchant, entry.category, 'expense', entry.paymentMethod, entry.amount, entry.currency, '', '', entry.notes || '']),
      ...savedManualIncome.filter((entry) => entry.date >= reportsFrom && entry.date <= reportsTo).map((entry) => [entry.date, 'manual_income', entry.counterparty, entry.category, 'income', entry.paymentMethod, entry.amount, entry.currency, '', '', entry.notes]),
      ...savedMpesa.filter((entry) => entry.date >= reportsFrom && entry.date <= reportsTo).map((entry) => [entry.date, 'mpesa', entry.counterparty, entry.category, entry.ledgerRole, 'M-Pesa', entry.amount, 'KES', entry.transactionId, entry.fee || '', entry.sourceMessage]),
      ...inventoryMovements.filter((entry) => entry.date >= reportsFrom && entry.date <= reportsTo).map((entry) => [entry.date, entry.type === 'sale' ? 'inventory_sale' : 'stock_in', entry.itemName, 'Inventory', entry.type, 'Inventory', entry.type === 'sale' ? entry.revenue || '0.00' : entry.totalCost || '0.00', entry.currency, entry.id, '', entry.note || '']),
    ]
    const csvCell = (value: unknown) => {
      let text = String(value ?? '')
      if (/^[\s]*[=+@\-\t\r]/.test(text)) text = `'${text}`
      return `"${text.replaceAll('"', '""')}"`
    }
    const blob = new Blob([`\uFEFF${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}`], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `numora-report-${reportsFrom}-to-${reportsTo}.csv`
    anchor.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    setExportMessage(`Exported ${rows.length - 1} records from ${reportsFrom} to ${reportsTo}.`)
  }

  async function refreshInventory(period: ReportPeriod = reportPeriod) {
    try {
      const range = getReportRange(period)
      const response = await fetch(`/api/inventory?from=${range.from}&to=${range.to}`)
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Could not read inventory records.')
      setInventoryItems(Array.isArray(result.items) ? result.items : [])
      setInventoryMovements(Array.isArray(result.movements) ? [...result.movements].reverse() : [])
      setInventoryReport(Array.isArray(result.report) ? result.report : [])
      setInventoryItemId((current) => current || result.items?.[0]?.id || '')
      setInventoryError('')
    } catch (cause) {
      setInventoryError(cause instanceof Error ? cause.message : 'Could not read inventory records.')
    }
  }

  async function createInventoryItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setIsSavingInventory(true)
    setInventoryError('')
    setInventoryNotice('')
    try {
      const response = await fetch('/api/inventory', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'create-item', name: inventoryName, unit: inventoryUnit, currency: inventoryCurrency }) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Could not create this inventory item.')
      setInventoryName('')
      setInventoryItemId(result.item.id)
      await refreshInventory()
      setInventoryNotice(`${result.item.name} added to local inventory.`)
    } catch (cause) {
      setInventoryError(cause instanceof Error ? cause.message : 'Could not create this inventory item.')
    } finally {
      setIsSavingInventory(false)
    }
  }

  async function saveInventoryMovement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!inventoryItemId) return
    setIsSavingInventory(true)
    setInventoryError('')
    setInventoryNotice('')
    try {
      const payload = { action: inventoryAction, itemId: inventoryItemId, quantity: inventoryQuantity, date: inventoryDate, note: inventoryNote, ...(inventoryAction === 'stock-in' ? { unitCost: inventoryUnitValue } : { unitPrice: inventoryUnitValue }) }
      const response = await fetch('/api/inventory', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Could not save this inventory movement.')
      setInventoryQuantity('')
      setInventoryUnitValue('')
      setInventoryNote('')
      await refreshInventory()
      setInventoryNotice(inventoryAction === 'stock-in' ? 'Stock received and average cost updated.' : `Sale recorded. Gross profit: ${result.movement.currency} ${result.movement.grossProfit}.`)
    } catch (cause) {
      setInventoryError(cause instanceof Error ? cause.message : 'Could not save this inventory movement.')
    } finally {
      setIsSavingInventory(false)
    }
  }

  async function receiveStockFromReceipt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!stockReceiptId || stockReceiptLineIndex === '' || !stockReceiptItemId) return
    setIsSavingInventory(true)
    setInventoryError('')
    setInventoryNotice('')
    try {
      const response = await fetch('/api/inventory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'receipt-stock-in', sourceReceiptId: stockReceiptId, sourceItemIndex: Number(stockReceiptLineIndex), itemId: stockReceiptItemId, quantity: stockReceiptQuantity, date: stockReceiptDate }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Could not receive this receipt line into inventory.')
      setStockReceiptLineIndex('')
      await refreshInventory()
      setInventoryNotice(`${result.movement.sourceItemDescription} received into stock from the saved receipt. Unit cost was calculated from the printed line total.`)
    } catch (cause) {
      setInventoryError(cause instanceof Error ? cause.message : 'Could not receive this receipt line into inventory.')
    } finally {
      setIsSavingInventory(false)
    }
  }

  async function updateInventorySaleMatch(movementId: string, transactionId: string) {
    setIsSavingInventory(true)
    setInventoryError('')
    setInventoryNotice('')
    try {
      const response = await fetch('/api/inventory/match-sale', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ movementId, transactionId: transactionId || null }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Could not update the sale match.')
      await refreshInventory()
      setInventoryNotice(transactionId ? 'Inventory sale matched to its M-Pesa income entry.' : 'M-Pesa sale match removed.')
    } catch (cause) {
      setInventoryError(cause instanceof Error ? cause.message : 'Could not update the sale match.')
    } finally {
      setIsSavingInventory(false)
    }
  }

  async function loadLedgerConversations() {
    setLedgerChatsLoading(true)
    setLedgerChatError('')
    try {
      const response = await fetch('/api/ledger/chats', { cache: 'no-store' })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Could not load local chat history.')
      const conversations = Array.isArray(result.conversations) ? result.conversations as LedgerConversation[] : []
      setLedgerConversations(conversations)
      const savedActiveId = (() => { try { return localStorage.getItem('numora:active-ledger-chat') || '' } catch { return '' } })()
      setActiveLedgerChatId((current) => conversations.some((chat) => chat.id === current) ? current : conversations.some((chat) => chat.id === savedActiveId) ? savedActiveId : conversations[0]?.id || '')
    } catch (cause) {
      setLedgerChatError(localServiceError(cause, 'Could not load local chat history.'))
    } finally { setLedgerChatsLoading(false) }
  }

  async function createLedgerConversation() {
    setLedgerChatError('')
    try {
      const response = await fetch('/api/ledger/chats', { method: 'POST' })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Could not create a new chat.')
      const conversation = result.conversation as LedgerConversation
      setLedgerConversations((current) => [conversation, ...current])
      setActiveLedgerChatId(conversation.id)
      try { localStorage.setItem('numora:active-ledger-chat', conversation.id) } catch {}
      setLedgerChatDraft('')
      setLedgerChatError('')
    } catch (cause) {
      setLedgerChatError(localServiceError(cause, 'Could not create a new chat.'))
    }
  }

  async function sendLedgerChatMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const question = ledgerChatDraft.trim()
    if (!question || ledgerChatSending) return
    setLedgerChatSending(true)
    setLedgerSendingQuestion(question)
    setLedgerSendingConversationId(activeLedgerChatId)
    setLedgerChatDraft('')
    setLedgerChatError('')
    try {
      let chatId = activeLedgerChatId
      if (!chatId) {
        const createResponse = await fetch('/api/ledger/chats', { method: 'POST' })
        const created = await createResponse.json()
        if (!createResponse.ok) throw new Error(created.error || 'Could not create a new chat.')
        chatId = String(created.conversation.id)
        setActiveLedgerChatId(chatId)
        setLedgerSendingConversationId(chatId)
        try { localStorage.setItem('numora:active-ledger-chat', chatId) } catch {}
      }
      const response = await fetch(`/api/ledger/chats/${encodeURIComponent(chatId)}/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question, modelId: chatModelChoice }) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Could not ask the local ledger.')
      if (result.personalMemory && typeof result.personalMemory.displayName === 'string') {
        setPersonalMemory(result.personalMemory as PersonalMemory)
        setPersonalMemoryDraft(String(result.personalMemory.displayName || ''))
      }
      const conversation = result.conversation as LedgerConversation
      setLedgerConversations((current) => [conversation, ...current.filter((chat) => chat.id !== conversation.id)].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)))
      setActiveLedgerChatId(conversation.id)
      setLedgerChatDraft('')
      const answer = conversation.messages[conversation.messages.length - 1]
      if (answer?.role === 'assistant') await revealLedgerAnswer(conversation.id, answer.id, answer.content)
    } catch (cause) {
      setLedgerChatDraft(question)
      setLedgerChatError(localServiceError(cause, 'Could not ask the local ledger.'))
    } finally { setLedgerStreamingAnswer(null); setLedgerChatSending(false); setLedgerSendingQuestion(''); setLedgerSendingConversationId('') }
  }

  async function revealLedgerAnswer(conversationId: string, messageId: string, content: string) {
    const words = content.match(/\S+\s*/g) || [content]
    const batchSize = Math.max(1, Math.ceil(words.length / 110))
    let visible = ''
    setLedgerStreamingAnswer({ conversationId, messageId, text: '' })
    for (let index = 0; index < words.length; index += batchSize) {
      visible += words.slice(index, index + batchSize).join('')
      setLedgerStreamingAnswer({ conversationId, messageId, text: visible })
      await new Promise<void>((resolve) => window.setTimeout(resolve, 24))
    }
  }

  async function copyLedgerChatMessage(messageId: string, content: string) {
    try {
      await navigator.clipboard.writeText(content)
      setCopiedChatMessageId(messageId)
      window.setTimeout(() => setCopiedChatMessageId((current) => current === messageId ? '' : current), 1600)
    } catch {
      setLedgerChatError('Could not copy that message. Check clipboard permissions and try again.')
    }
  }

  async function deleteLedgerConversation(conversationId: string) {
    setLedgerChatDeletingId(conversationId)
    setLedgerChatError('')
    try {
      const response = await fetch(`/api/ledger/chats/${encodeURIComponent(conversationId)}`, { method: 'DELETE' })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Could not delete this chat.')
      const remaining = ledgerConversations.filter((chat) => chat.id !== conversationId)
      setLedgerConversations(remaining)
      if (activeLedgerChatId === conversationId) {
        const nextId = remaining[0]?.id || ''
        setActiveLedgerChatId(nextId)
        try { nextId ? localStorage.setItem('numora:active-ledger-chat', nextId) : localStorage.removeItem('numora:active-ledger-chat') } catch {}
      }
    } catch (cause) {
      setLedgerChatError(localServiceError(cause, 'Could not delete this chat.'))
    } finally { setLedgerChatDeletingId('') }
  }

  function openLedgerChat(question = '') {
    if (question) setLedgerChatDraft(question)
    setActivePage('ask')
  }

  async function updateReceiptMatch(transactionId: string, receiptId: string) {
    setMatchingTransactionId(transactionId)
    setMatchMessage('')
    try {
      const response = await fetch('/api/ledger/match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactionId, receiptId: receiptId || null }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Could not update this match.')
      const [receiptsResponse, mpesaResponse] = await Promise.all([fetch('/api/receipts'), fetch('/api/mpesa')])
      if (receiptsResponse.ok) setSaved((await receiptsResponse.json()).receipts || [])
      if (mpesaResponse.ok) setSavedMpesa((await mpesaResponse.json()).transactions || [])
      await refreshLedgerReport()
      setMatchMessage(receiptId ? 'Entries matched. The receipt and M-Pesa payment will count once in reports; any M-Pesa fee remains included.' : 'Match removed. The M-Pesa entry will count separately again.')
    } catch (cause) {
      setMatchMessage(cause instanceof Error ? cause.message : 'Could not update this match.')
    } finally {
      setMatchingTransactionId('')
    }
  }

  function exportLedgerCsv() {
    const headers = ['date', 'record_type', 'merchant_or_counterparty', 'category', 'ledger_treatment', 'payment_method', 'amount', 'currency', 'transaction_id', 'fee', 'matched_record_id', 'notes']
    const rows = [
      ...saved.map((receipt) => [
        receipt.date, receipt.sourceType === 'manual_expense' ? 'manual_expense' : 'receipt', receipt.merchant, receipt.category, 'expense', receipt.paymentMethod,
        receipt.amount, receipt.currency, '', '', receipt.matchedTransactionId || '', receipt.notes || '',
      ]),
      ...savedMpesa.map((transaction) => [
        transaction.date, 'mpesa', transaction.counterparty, transaction.category, transaction.ledgerRole,
        'M-Pesa', transaction.amount, 'KES', transaction.transactionId, transaction.fee || '', transaction.matchedReceiptId || '', '',
      ]),
      ...savedManualIncome.map((income) => [income.date, 'manual_income', income.counterparty, income.category, 'income', income.paymentMethod, income.amount, income.currency, '', '', '', income.notes]),
    ]
    const csvCell = (value: unknown) => {
      let text = String(value ?? '')
      if (/^[\s]*[=+@\-\t\r]/.test(text)) text = `'${text}`
      return `"${text.replaceAll('"', '""')}"`
    }
    const csv = [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n')
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `numora-ledger-${new Date().toISOString().slice(0, 10)}.csv`
    anchor.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    setExportMessage(`Exported ${rows.length} local ${rows.length === 1 ? 'record' : 'records'} to CSV.`)
  }

  useEffect(() => {
    if (!file) {
      setPreviewUrl(null)
      setImageQuality(null)
      setIsCheckingQuality(false)
      return
    }
    const url = URL.createObjectURL(file)
    setPreviewUrl(url)
    setIsCheckingQuality(true)
    setImageQuality(null)
    let cancelled = false
    inspectImage(file).then((result) => {
      if (!cancelled) setImageQuality(result)
    }).catch(() => {
      if (!cancelled) setImageQuality({ width: 0, height: 0, warnings: ['Image quality could not be checked. You can still try reading it.'] })
    }).finally(() => {
      if (!cancelled) setIsCheckingQuality(false)
    })
    return () => URL.revokeObjectURL(url)
  }, [file])

  useEffect(() => {
    const checkService = () => fetch('/api/health', { cache: 'no-store' }).then((response) => setServerReady(response.ok)).catch(() => setServerReady(false))
    void checkService()
    void initializeWorkspace()
    const timer = window.setInterval(checkService, 2000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (modelDownload.status !== 'downloading') return
    let cancelled = false
    const poll = async () => {
      try {
        const response = await fetch('/api/models/download', { cache: 'no-store' })
        const next = await response.json() as ModelDownloadProgress
        if (cancelled) return
        setModelDownload(next)
        if (['complete', 'error', 'cancelled'].includes(next.status)) {
          if (next.status === 'complete') {
            setModelManagerMessage(next.stage || 'Model is ready to use.')
            void refreshModelCatalog().catch((cause) => setModelManagerMessage(cause instanceof Error ? cause.message : 'Model installed, but status refresh failed.'))
          } else if (next.status === 'error') setModelManagerMessage(next.error || 'Model download failed.')
        }
      } catch { /* Keep the last progress state visible while the service reconnects. */ }
    }
    void poll()
    const timer = window.setInterval(() => void poll(), 750)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [modelDownload.status])

  useEffect(() => {
    let cancelled = false
    loadReceiptQueue().then((entries) => {
      if (cancelled) return
      const restored = entries.map((entry) => {
        const interrupted = entry.status === 'processing'
        return {
          ...entry,
          status: interrupted ? 'failed' as const : entry.status,
          message: interrupted ? 'The previous session ended during OCR. Check recovered reviews, then retry if needed.' : entry.message,
          retryable: interrupted ? true : entry.retryable,
          thumbnail: entry.status === 'saved' ? undefined : URL.createObjectURL(entry.file),
        }
      })
      setReceiptQueue(restored as ReceiptQueueItem[])
      if (restored.length) setQueueBatchMessage(`${restored.length} receipt import${restored.length === 1 ? '' : 's'} restored from this device.`)
    }).catch((cause) => {
      if (!cancelled) setReceiptQueueStorageError(cause instanceof Error ? cause.message : 'Could not restore the local receipt import queue.')
    }).finally(() => { if (!cancelled) setReceiptQueueReady(true) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!receiptQueueReady || receiptQueueStorageError) return
    saveReceiptQueue(receiptQueue).then(() => setReceiptQueueStorageError('')).catch((cause) => {
      setReceiptQueueStorageError(cause instanceof Error ? cause.message : 'Could not preserve the local receipt import queue.')
    })
  }, [receiptQueue, receiptQueueReady, receiptQueueStorageError])

  useEffect(() => {
    try { localStorage.setItem('numora:last-page', activePage) } catch {}
  }, [activePage])

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = appearance
    try { localStorage.setItem('numora:appearance', appearance) } catch {}
  }, [appearance])

  useLayoutEffect(() => {
    window.scrollTo(0, 0)
    const root = workspaceMainRef.current
    const page = root?.querySelector<HTMLElement>('.page-content')
    if (!root || !page || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const context = gsap.context(() => {
      const heading = page.querySelector('.page-heading')
      const sections = page.querySelectorAll(':scope > .dashboard-period, :scope > .dashboard-summary, :scope > .dashboard-grid, :scope > .ledger-chat-layout, :scope > .content-card, :scope > .report-period, :scope > .report-visual-grid, :scope > .receipt-mode-switch, :scope > .mpesa-card, :scope > .workspace-grid')
      const timeline = gsap.timeline({ defaults: { ease: 'power2.out' } })
      // Keep ledger data readable throughout navigation; motion should never
      // make transaction rows or filters look disabled while they enter.
      if (heading) timeline.from(heading, { y: 10, autoAlpha: 0, duration: 0.28 })
      if (sections.length) timeline.from(sections, { y: 12, autoAlpha: 0, duration: 0.32, stagger: 0.045 }, heading ? '-=0.1' : 0)
      if (activePage === 'dashboard') {
        const bars = page.querySelectorAll('.dashboard-income-bar, .dashboard-expense-bar')
        if (bars.length) timeline.from(bars, { scaleY: 0, transformOrigin: '50% 100%', duration: 0.5, stagger: 0.035 }, '<+=0.08')
      }
      if (activePage === 'reports') {
        const categoryBars = page.querySelectorAll('.report-category-track i')
        if (categoryBars.length) timeline.from(categoryBars, { scaleX: 0, transformOrigin: 'left center', duration: 0.46, stagger: 0.05 }, '<+=0.08')
      }
    }, root)
    return () => context.revert()
  }, [activePage])

  useEffect(() => {
    if (activePage === 'ask') void loadLedgerConversations()
  }, [activePage])

  useEffect(() => {
    if (activeLedgerChatId) {
      try { localStorage.setItem('numora:active-ledger-chat', activeLedgerChatId) } catch {}
    }
  }, [activeLedgerChatId])

  useEffect(() => {
    try { localStorage.setItem('numora:chat-history-collapsed', String(chatHistoryCollapsed)) } catch {}
  }, [chatHistoryCollapsed])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try { localStorage.setItem('numora:chat-history-width', String(chatHistoryWidth)) } catch {}
    }, 140)
    return () => window.clearTimeout(timer)
  }, [chatHistoryWidth])

  useEffect(() => {
    if (ledgerStreamingAnswer && ledgerStreamingAnswer.conversationId !== activeLedgerChatId) return
    ledgerChatMessagesRef.current?.scrollTo({ top: ledgerChatMessagesRef.current.scrollHeight, behavior: ledgerStreamingAnswer ? 'auto' : 'smooth' })
  }, [activeLedgerChatId, ledgerConversations, ledgerChatSending, ledgerStreamingAnswer?.text])

  useEffect(() => {
    if (activePage === 'reports') void loadReportsRange(reportsFrom, reportsTo)
  }, [activePage, reportsFrom, reportsTo])

  useEffect(() => {
    if (!scan || !fields) return
    try { localStorage.setItem(`numora:receipt-review:${scan.reviewId}`, JSON.stringify({ fields, items })) } catch {}
  }, [scan?.reviewId, fields, items])

  useEffect(() => { activeQueueIdRef.current = activeQueueId }, [activeQueueId])

  useEffect(() => {
    if (!activeQueueId || !scan || !fields) return
    setReceiptQueue((current) => current.map((entry) => entry.id === activeQueueId ? {
      ...entry,
      draftFields: fields,
      draftItems: items,
      draftFinancialReviewConfirmed: financialReviewConfirmed,
      draftRememberCategoryRule: rememberCategoryRule,
    } : entry))
  }, [activeQueueId, scan?.reviewId, fields, items, financialReviewConfirmed, rememberCategoryRule])

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const typing = target?.matches('input, textarea, select, [contenteditable="true"]')
      if (event.ctrlKey && !event.shiftKey && event.key.toLowerCase() === 'o' && !typing) {
        event.preventDefault()
        setActivePage('receipts')
        setReceiptScreen('import')
        setReceiptInputMode('images')
        window.setTimeout(() => inputRef.current?.click(), 0)
      }
      if (event.ctrlKey && !event.shiftKey && event.key.toLowerCase() === 'f') {
        event.preventDefault()
        setActivePage('expenses')
        window.setTimeout(() => expenseSearchRef.current?.focus(), 0)
      }
      if (event.ctrlKey && event.key === ',') {
        event.preventDefault()
        setActivePage('settings')
      }
    }
    window.addEventListener('keydown', handleShortcut)
    return () => window.removeEventListener('keydown', handleShortcut)
  }, [])

  function discardPendingScan() {
    if (scan) {
      const reviewId = scan.reviewId
      setPendingReviews((current) => current.filter((review) => review.reviewId !== reviewId))
      fetch('/api/receipts/cancel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reviewId }) }).catch(() => {})
    }
  }

  function addReceiptFiles(files?: FileList | File[]) {
    setError('')
    setNotice('')
    const candidates = Array.from(files || [])
    if (!candidates.length) return
    const existingNames = new Set([...receiptQueue.map((item) => item.file.name.toLocaleLowerCase()), ...saved.flatMap((item) => [item.sourceFileName, item.imageName].filter(Boolean).map((name) => String(name).toLocaleLowerCase()))])
    const added = candidates.map((candidate) => {
        const id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
        const extensionSupported = /\.(jpe?g|png|webp)$/i.test(candidate.name)
        const supported = ACCEPTED_TYPES.has(candidate.type) || (!candidate.type && extensionSupported)
        const message = !supported ? 'Unsupported file type. Choose a JPG, PNG, or WebP image.' : candidate.size > MAX_FILE_SIZE ? 'Image is larger than 15 MB. Choose a smaller photo.' : undefined
        const duplicate = !message && existingNames.has(candidate.name.toLocaleLowerCase())
        existingNames.add(candidate.name.toLocaleLowerCase())
        const thumbnail = supported && !message ? URL.createObjectURL(candidate) : undefined
        return { id, file: candidate, status: message ? 'failed' as const : duplicate ? 'duplicate' as const : 'queued' as const, message: message || (duplicate ? 'A receipt with this filename may already be saved or queued. Review before importing it again.' : undefined), thumbnail, retryable: false }
    })
    setReceiptQueue((current) => [...current, ...added])
    if (!file && !scan && !fields) {
      const first = added.find((item) => item.status === 'queued')
      if (first) { setFile(first.file); setActiveQueueId(first.id) }
    }
    if (inputRef.current) inputRef.current.value = ''
  }

  function openQueuedReceipt(item: ReceiptQueueItem) {
    if (item.status === 'duplicate') return
    if (item.id === activeQueueId) return
    setActiveQueueId(item.id)
    setFile(item.file)
    if (item.scanResult) {
      setScan(item.scanResult)
      setFields(item.draftFields || item.scanResult.fields)
      setItems(item.draftItems || (Array.isArray(item.scanResult.items) ? item.scanResult.items : []))
      setError('')
      setFinancialReviewConfirmed(Boolean(item.draftFinancialReviewConfirmed))
      setRememberCategoryRule(Boolean(item.draftRememberCategoryRule))
      return
    }
    setScan(null)
    setFields(null)
    setItems([])
    setError('')
    setFinancialReviewConfirmed(false)
    setRememberCategoryRule(false)
    setReceiptQueue((current) => current.map((entry) => entry.id === item.id && entry.status === 'failed' ? { ...entry, status: 'queued', message: 'Ready to retry.', retryable: false } : entry))
  }

  function beginReceiptAnalysis() {
    const selected = receiptQueue.find((item) => item.id === activeQueueId && item.status !== 'saved')
      || receiptQueue.find((item) => item.status === 'queued' || item.status === 'needs-review' || (item.status === 'failed' && item.retryable))
    setReceiptInputMode('images')
    setReceiptScreen('review')
    if (selected && selected.id !== activeQueueId) openQueuedReceipt(selected)
    else if (file && !scan) void scanReceipt()
  }

  function allowPossibleDuplicate(itemId: string) {
    const item = receiptQueue.find((entry) => entry.id === itemId)
    if (!item) return
    setReceiptQueue((current) => current.map((entry) => entry.id === itemId ? { ...entry, status: 'queued', message: 'Duplicate warning acknowledged. Review the image before saving.' } : entry))
    openQueuedReceipt({ ...item, status: 'queued' })
  }

  function createScanJob(itemName: string, itemIndex?: number, itemTotal?: number, queueItemId: string | null = null) {
    const jobId = window.crypto.randomUUID()
    const controller = new AbortController()
    activeScanRef.current = { jobId, controller, queueItemId }
    setScanProgress({ jobId, stage: 'preparing', message: 'Preparing the receipt image locally.', itemName, itemIndex, itemTotal })
    return { jobId, controller }
  }

  async function watchScanJob(jobId: string, signal: AbortSignal) {
    while (!signal.aborted) {
      try {
        const response = await fetch(`/api/receipts/scan-status?id=${encodeURIComponent(jobId)}`, { cache: 'no-store', signal })
        if (response.ok) {
          const status = await response.json() as { stage?: ScanStage; message?: string; error?: string }
          setScanProgress((current) => current?.jobId === jobId ? { ...current, stage: status.stage || current.stage, ...(status.stage === 'failed' || status.stage === 'cancelled' ? { previousStage: current.stage } : {}), message: status.message || current.message } : current)
          if (['ready', 'failed', 'cancelled'].includes(String(status.stage))) return
        }
      } catch (cause) {
        if ((cause as Error)?.name === 'AbortError') return
      }
      await new Promise((resolve) => window.setTimeout(resolve, 450))
    }
  }

  function cancelReceiptProcessing() {
    const active = activeScanRef.current
    if (!active) return
    setScanProgress((current) => current?.jobId === active.jobId ? { ...current, previousStage: current.stage, stage: 'cancelled', message: 'Cancelled. Your imported image is still in the local queue.' } : current)
    void fetch('/api/receipts/scan-cancel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jobId: active.jobId }) }).catch(() => {})
    active.controller.abort()
    activeScanRef.current = null
  }

  async function submitScan(fileToScan: File, job: { jobId: string; controller: AbortController }, requestFile = fileToScan) {
    const { signal } = job.controller
    const mime = requestFile.type || ({ jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' } as Record<string, string>)[requestFile.name.toLowerCase().split('.').pop() || '']
    if (!mime) throw new Error('Choose a JPG, PNG, or WebP image.')
    const scanRequest = fetch('/api/receipts/scan', {
      method: 'POST',
      headers: { 'Content-Type': mime, 'X-File-Name': encodeURIComponent(fileToScan.name), 'X-Scan-Job-ID': job.jobId },
      body: requestFile,
      signal,
    })
    const watcher = watchScanJob(job.jobId, signal)
    const response = await scanRequest
    await watcher
    const result = await response.json() as ScanResult & { error?: string }
    if (!response.ok) throw new Error(result.error || 'Local receipt reading failed.')
    return result as ScanResult
  }

  function removeQueuedReceipt(itemId: string) {
    const item = receiptQueue.find((entry) => entry.id === itemId)
    if (item?.thumbnail) URL.revokeObjectURL(item.thumbnail)
    if (item?.scanResult && item.id !== activeQueueId) {
      fetch('/api/receipts/cancel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reviewId: item.scanResult.reviewId }) }).catch(() => {})
      setPendingReviews((current) => current.filter((review) => review.reviewId !== item.scanResult?.reviewId))
      try { localStorage.removeItem(`numora:receipt-review:${item.scanResult.reviewId}`) } catch {}
    }
    setReceiptQueue((current) => current.filter((entry) => entry.id !== itemId))
    if (activeQueueId === itemId && !scan) {
      setActiveQueueId(null)
      setFile(null)
      setReceiptScreen('import')
    }
    if (activeQueueId === itemId && scan) {
      try { localStorage.removeItem(`numora:receipt-review:${scan.reviewId}`) } catch {}
      discardPendingScan()
      setActiveQueueId(null)
      setFile(null)
      setScan(null)
      setFields(null)
      setItems([])
      setReceiptScreen('import')
    }
  }

  function clearImage() {
    if (scan) {
      try { localStorage.removeItem(`numora:receipt-review:${scan.reviewId}`) } catch {}
    }
    discardPendingScan()
    setFile(null)
    if (activeQueueId) setReceiptQueue((current) => current.map((item) => item.id === activeQueueId && item.status === 'needs-review' ? { ...item, status: 'queued', message: 'Review cleared. Ready to read again.', scanResult: undefined, merchant: undefined } : item))
    setActiveQueueId(null)
    setReceiptScreen('import')
    setScan(null)
    setFields(null)
    setItems([])
    setError('')
    setFinancialReviewConfirmed(false)
    setRememberCategoryRule(false)
    if (inputRef.current) inputRef.current.value = ''
  }

  async function scanReceipt() {
    if (!file) return
    const fileToScan = file
    const queueItemId = activeQueueId
    const itemIndex = queueItemId ? receiptQueue.findIndex((item) => item.id === queueItemId) + 1 : undefined
    const queueTotal = queueItemId ? receiptQueue.length : undefined
    const job = createScanJob(fileToScan.name, itemIndex, queueTotal, queueItemId)
    setIsScanning(true)
    if (queueItemId) setReceiptQueue((current) => current.map((item) => item.id === queueItemId ? { ...item, status: 'processing', message: 'Reading this receipt locally…' } : item))
    setError('')
    setNotice('')
    setFinancialReviewConfirmed(false)
    try {
      const preparedFile = await imagePreparationRef.current?.prepare()
      if (job.controller.signal.aborted) throw new DOMException('Receipt reading cancelled.', 'AbortError')
      if (!preparedFile) throw new Error('The image preparation step is not ready yet.')
      const firstResult = await submitScan(fileToScan, job, preparedFile)
      const originalMime = fileToScan.type || ({ jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' } as Record<string, string>)[fileToScan.name.toLowerCase().split('.').pop() || '']
      const originalResponse = await fetch('/api/receipts/original', {
        method: 'POST',
        headers: { 'Content-Type': originalMime || preparedFile.type, 'X-Review-ID': firstResult.reviewId },
        body: fileToScan,
        signal: job.controller.signal,
      })
      if (!originalResponse.ok) {
        await fetch('/api/receipts/cancel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reviewId: firstResult.reviewId }) }).catch(() => {})
        const originalResult = await originalResponse.json().catch(() => ({}))
        throw new Error(originalResult.error || 'Could not keep the original receipt image for saving.')
      }
      let result = firstResult as ScanResult
      if (result.ocrQuality?.retryRecommended && !result.ocrModel?.includes('EasyOCR')) {
        try {
          setScanProgress((current) => current?.jobId === job.jobId ? { ...current, stage: 'checking', message: 'Checking the OCR result and comparing a focused reread.' } : current)
          const focusCrops = await imagePreparationRef.current?.prepareFocusedCrops(result.ocrQuality.focusAreas || [])
          let retryBody: BodyInit
          let retryContentType: string
          if (focusCrops?.length) {
            retryBody = JSON.stringify({ crops: focusCrops })
            retryContentType = 'application/json'
          } else {
            const contrastFile = await imagePreparationRef.current?.prepareContrast()
            if (!contrastFile) throw new Error('Could not prepare the retry image.')
            retryBody = contrastFile
            retryContentType = contrastFile.type
          }
          const retryResponse = await fetch('/api/receipts/retry', {
            method: 'POST',
            headers: { 'Content-Type': retryContentType, 'X-Review-ID': result.reviewId },
            body: retryBody,
            signal: job.controller.signal,
          })
          const retryResult = await retryResponse.json()
          if (!retryResponse.ok) throw new Error(retryResult.error || 'The contrast retry could not run.')
          result = retryResult as ScanResult
        } catch (retryCause) {
          if (job.controller.signal.aborted || (retryCause instanceof Error && retryCause.name === 'AbortError')) throw retryCause
          result = { ...result, ocrQuality: { ...result.ocrQuality, retryAttempted: true, retrySelected: false, retryError: retryCause instanceof Error ? retryCause.message : 'The contrast retry could not run.' } }
        }
      }
      setPendingReviews((current) => {
        const next = { reviewId: result.reviewId, originalName: file.name, createdAt: new Date().toISOString(), merchant: result.fields.merchant, date: result.fields.date, amount: result.fields.amount, currency: result.fields.currency }
        return [...current.filter((review) => review.reviewId !== result.reviewId), next]
      })
      if (queueItemId) setReceiptQueue((current) => current.map((item) => item.id === queueItemId ? { ...item, status: 'needs-review', message: 'OCR complete. Review the extracted fields before saving.', merchant: result.fields.merchant, scanResult: result, retryable: false, draftFields: undefined, draftItems: undefined, draftFinancialReviewConfirmed: false, draftRememberCategoryRule: false } : item))
      const stillSelected = !queueItemId || activeQueueIdRef.current === queueItemId
      if (!stillSelected) return
      setScan(result as ScanResult)
      const extractedFields = result.fields as ReceiptFields
      const currencyEvidence = result.fieldEvidence?.currency
      setFields(extractedFields.currency === 'Uncategorised' && !currencyEvidence?.lines?.length
        ? { ...extractedFields, currency: defaultCurrency }
        : extractedFields)
      setItems(Array.isArray(result.items) ? result.items : [])
      setScanProgress((current) => current?.jobId === job.jobId ? { ...current, stage: 'ready', uncertain: scanNeedsCarefulReview(result), message: 'Receipt reading is complete. Review the suggestions before saving.' } : current)
    } catch (cause) {
      const cancelled = job.controller.signal.aborted || (cause instanceof Error && cause.name === 'AbortError')
      if (cancelled) {
        if (queueItemId) setReceiptQueue((current) => current.map((item) => item.id === queueItemId ? { ...item, status: 'queued', message: 'Cancelled. The image is still available to retry.' } : item))
        setNotice('Reading cancelled. Your imported image is still in the local queue.')
        setScanProgress((current) => current?.jobId === job.jobId ? { ...current, previousStage: current.stage, stage: 'cancelled', message: 'Cancelled. Your imported image is still in the local queue.' } : current)
      } else {
        const message = cause instanceof Error ? cause.message : 'Could not read this receipt locally.'
        if (queueItemId) setReceiptQueue((current) => current.map((item) => item.id === queueItemId ? { ...item, status: 'failed', message, retryable: true } : item))
        if (!queueItemId || activeQueueIdRef.current === queueItemId) setError(message)
        setScanProgress((current) => current?.jobId === job.jobId ? { ...current, previousStage: current.stage, stage: 'failed', message } : current)
      }
    } finally {
      if (activeScanRef.current?.jobId === job.jobId) activeScanRef.current = null
      setIsScanning(false)
    }
  }

  async function runSlowerAccuracyRead() {
    if (!scan) return
    setIsDeepReading(true)
    setDeepReadError('')
    try {
      const response = await fetch('/api/receipts/deep-read', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Review-ID': scan.reviewId }, body: '{}' })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'The LightOnOCR accuracy reread could not run.')
      const updated = result as ScanResult
      setScan(updated)
      if (activeQueueId) setReceiptQueue((current) => current.map((item) => item.id === activeQueueId ? { ...item, scanResult: updated, merchant: updated.fields.merchant } : item))
      setFields(updated.fields)
      setItems(Array.isArray(updated.items) ? updated.items : [])
      setFinancialReviewConfirmed(false)
    } catch (cause) {
      setDeepReadError(cause instanceof Error ? cause.message : 'The LightOnOCR accuracy reread could not run.')
    } finally {
      setIsDeepReading(false)
    }
  }

  function updateField(key: keyof ReceiptFields, value: string) {
    if (key === 'amount') setFinancialReviewConfirmed(false)
    if (key === 'merchant') {
      const normalize = (merchant: string) => merchant.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ')
      const matchingRule = categoryRules.find((rule) => normalize(rule.merchant) === normalize(value))
      setFields((current) => current ? { ...current, merchant: value, ...(matchingRule ? { category: matchingRule.category } : {}) } : current)
      setScan((current) => current ? { ...current, fieldEvidence: { ...current.fieldEvidence, category: matchingRule
        ? { lines: [], averageConfidence: null, note: `Suggested by your local merchant rule for ${matchingRule.merchant}.`, source: 'rule' }
        : { lines: [], averageConfidence: null, note: 'Merchant was edited and no saved rule matches the new name. Check this category.', source: 'default' } } } : current)
      return
    }
    setFields((current) => current ? { ...current, [key]: value } : current)
    if (key === 'category') {
      if (value === 'Uncategorised') setRememberCategoryRule(false)
      setScan((current) => current ? { ...current, fieldEvidence: { ...current.fieldEvidence, category: { lines: [], averageConfidence: null, note: 'Category selected manually during review.', source: 'manual' } } } : current)
    }
  }

  async function saveCategoryRule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!ruleMerchant.trim()) return
    setError('')
    setIsSavingRule(true)
    try {
      const response = await fetch('/api/category-rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ merchant: ruleMerchant, category: ruleCategory }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Could not save this merchant rule locally.')
      setCategoryRules(result.rules as MerchantCategoryRule[])
      setRuleMerchant('')
      setRuleMessage('Rule saved locally. It will apply to future scans with this merchant name.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save this merchant rule locally.')
    } finally {
      setIsSavingRule(false)
    }
  }

  async function removeCategoryRule(merchant: string) {
    setError('')
    try {
      const response = await fetch('/api/category-rules', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ merchant }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Could not remove this merchant rule.')
      setCategoryRules(result.rules as MerchantCategoryRule[])
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not remove this merchant rule.')
    }
  }

  async function parseMpesaMessages() {
    setMpesaError('')
    setMpesaNotice('')
    setIsParsingMpesa(true)
    setMpesaRows([])
    try {
      const response = await fetch('/api/mpesa/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: mpesaText }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'QVAC could not organize these messages.')
      setMpesaRows(Array.isArray(result.transactions) ? result.transactions as MpesaTransaction[] : [])
      setMpesaNotice(String(result.note || ''))
    } catch (cause) {
      setMpesaError(cause instanceof Error ? cause.message : 'Could not parse these M-Pesa messages locally.')
    } finally {
      setIsParsingMpesa(false)
    }
  }

  function updateMpesaRow(index: number, key: 'transactionId' | 'date' | 'time' | 'direction' | 'transactionType' | 'counterparty' | 'amount' | 'fee' | 'balance' | 'reference' | 'category' | 'ledgerRole', value: string) {
    setMpesaRows((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, [key]: value, ...(key === 'transactionId' ? { duplicate: false } : {}) } : row))
  }

  function removeMpesaRow(index: number) {
    setMpesaRows((current) => current.filter((_, rowIndex) => rowIndex !== index))
  }

  async function saveMpesaTransactions() {
    setMpesaError('')
    setIsSavingMpesa(true)
    try {
      const response = await fetch('/api/mpesa/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactions: mpesaRows }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Could not save M-Pesa transactions locally.')
      const transactions = Array.isArray(result.transactions) ? result.transactions as SavedMpesaTransaction[] : []
      setSavedMpesa((current) => [...transactions, ...current])
      void refreshLedgerReport()
      setMpesaRows([])
      setMpesaText('')
      setMpesaNotice(`${transactions.length} M-Pesa ${transactions.length === 1 ? 'transaction' : 'transactions'} saved to the local ledger.`)
    } catch (cause) {
      setMpesaError(cause instanceof Error ? cause.message : 'Could not save these M-Pesa transactions locally.')
    } finally {
      setIsSavingMpesa(false)
    }
  }

  function updateItem(index: number, key: 'description' | 'amount', value: string) {
    setFinancialReviewConfirmed(false)
    setItems((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, [key]: value } : item))
  }

  function addItem() {
    setFinancialReviewConfirmed(false)
    setItems((current) => [...current, { description: '', amount: '', sourceLine: '', confidence: null }])
  }

  function removeItem(index: number) {
    setFinancialReviewConfirmed(false)
    setItems((current) => current.filter((_, itemIndex) => itemIndex !== index))
  }

  async function saveReceipt() {
    if (!scan || !fields) return
    setError('')
    setNotice('')
    setIsSaving(true)
    try {
      const response = await fetch('/api/receipts/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviewId: scan.reviewId, fields, items, financialReviewConfirmed, rememberCategoryRule }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Could not save this expense locally.')
      try { localStorage.removeItem(`numora:receipt-review:${scan.reviewId}`) } catch {}
      setSaved((current) => [result.receipt as SavedReceipt, ...current])
      if (activeQueueId) setReceiptQueue((current) => current.map((item) => item.id === activeQueueId ? { ...item, status: 'saved', message: 'Approved expense saved locally.', scanResult: undefined } : item))
      setSavedReceiptConfirmation(result.receipt as SavedReceipt)
      setSavedReceiptQueueId(activeQueueId)
      setPendingReviews((current) => current.filter((review) => review.reviewId !== scan.reviewId))
      void refreshLedgerReport()
      if (Array.isArray(result.categoryRules)) setCategoryRules(result.categoryRules as MerchantCategoryRule[])
      setNotice('')
      setScan(null)
      setFields(null)
      setItems([])
      setFinancialReviewConfirmed(false)
      setRememberCategoryRule(false)
      setFile(null)
      setPreviewUrl(null)
      setActiveQueueId(null)
      setReceiptScreen('saved')
      if (inputRef.current) inputRef.current.value = ''
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save this expense locally.')
    } finally {
      setIsSaving(false)
    }
  }

  async function saveManualExpense(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setManualExpenseError('')
    setManualExpenseNotice('')
    setIsSavingManualExpense(true)
    try {
      const response = await fetch('/api/expenses/manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(manualExpense),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Could not save this expense locally.')
      setSaved((current) => [result.expense as SavedReceipt, ...current])
      setManualExpenseNotice('Expense saved to your local ledger.')
      setManualExpense({ merchant: '', date: localDateString(), amount: '', currency: 'KES', category: 'Uncategorised', paymentMethod: 'Cash', notes: '' })
      setShowManualExpenseForm(false)
      void refreshLedgerReport()
    } catch (cause) {
      setManualExpenseError(cause instanceof Error ? cause.message : 'Could not save this expense locally.')
    } finally {
      setIsSavingManualExpense(false)
    }
  }

  async function saveManualIncome(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setManualIncomeError('')
    setManualIncomeNotice('')
    setIsSavingManualIncome(true)
    try {
      const response = await fetch('/api/income/manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(manualIncome),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Could not save this income locally.')
      setSavedManualIncome((current) => [result.income as SavedManualIncome, ...current])
      setManualIncomeNotice('Income saved to your local ledger.')
      setManualIncome({ source: '', date: localDateString(), amount: '', currency: 'KES', category: 'Sales', paymentMethod: 'Cash', notes: '' })
      setShowManualIncomeForm(false)
      void refreshLedgerReport()
    } catch (cause) {
      setManualIncomeError(cause instanceof Error ? cause.message : 'Could not save this income locally.')
    } finally {
      setIsSavingManualIncome(false)
    }
  }

  function showNextReceiptAfterSave() {
    const nextReview = receiptQueue.find((item) => item.id !== savedReceiptQueueId && (['queued', 'needs-review'].includes(item.status) || (item.status === 'failed' && item.retryable)))
    setSavedReceiptConfirmation(null)
    setSavedReceiptQueueId(null)
    setNotice('')
    setError('')
    if (nextReview) {
      openQueuedReceipt(nextReview)
      return
    }
    setReceiptScreen('import')
    setReceiptInputMode('images')
  }

  const stage = fields ? 3 : scan ? 2 : file ? 2 : 1
  const selectedReceiptIsProcessing = isScanning && Boolean(activeQueueId && receiptQueue.find((item) => item.id === activeQueueId)?.status === 'processing')
  const receiptScanSweepActive = isScanning && activeScanRef.current?.queueItemId === activeQueueId && !['ready', 'failed', 'cancelled'].includes(scanProgress?.stage || '')
  const itemsComplete = items.every((item) => item.description.trim() && Number.isFinite(Number(item.amount.replace(/,/g, ''))) && Number(item.amount.replace(/,/g, '')) > 0)
  const itemTotalCents = items.reduce((sum, item) => {
    const amount = Number(item.amount.replace(/,/g, ''))
    return sum + (Number.isFinite(amount) ? Math.round(amount * 100) : 0)
  }, 0)
  const itemTotal = itemTotalCents / 100
  const reviewedItemsMismatch = Boolean(items.length && scan?.financialReference?.subtotal !== null && scan?.financialReference?.subtotal !== undefined
    && Math.abs(itemTotalCents - Math.round(scan.financialReference.subtotal * 100)) > 3)
  const requiresFinancialConfirmation = Boolean(scan?.financialChecks?.requiresConfirmation || reviewedItemsMismatch)
  function renderEvidence(key: keyof ReceiptFields) {
    const evidence = scan?.fieldEvidence?.[key]
    if (!evidence) return null
    return <details className={`field-evidence${evidence.lines.length ? '' : ' has-no-source'}`}>
      <summary>{evidence.lines.length ? 'View source' : 'Source details'}</summary>
      <span className="field-evidence-label">{evidence.source === 'rule' ? 'Local merchant rule' : evidence.source === 'model' ? 'Local AI suggestion' : evidence.source === 'manual' ? 'Selected in review' : evidence.lines.length ? 'OCR source' : 'No OCR source'}</span>
      {evidence.lines.length
        ? <span className="field-evidence-lines">{evidence.lines.map((line, index) => <q key={`${index}-${line}`}>{line}</q>)}</span>
        : <span>{evidence.note}</span>}
      {evidence.lines.length > 0 && evidence.averageConfidence !== null && <span className="field-evidence-confidence">Line confidence {Math.round(evidence.averageConfidence * 100)}%</span>}
    </details>
  }

  const availableChatModels = startupModels.filter((model) => model.installed && (model.role.startsWith('Chat') || model.role.includes('interpretation')))
  const installedModel = (id: string) => startupModels.find((model) => model.id === id && model.installed)
  const formatModelSize = (bytes = 0) => bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / 1024 ** 2))} MB`
  const pageLabels: Record<WorkspacePage, string> = { dashboard: 'Dashboard', receipts: 'Receipts', expenses: 'Transactions', inventory: 'Inventory', reports: 'Reports', ask: 'Ask Numora', categories: 'Categories', settings: 'Settings' }
  const activeLedgerConversation = ledgerConversations.find((chat) => chat.id === activeLedgerChatId)
  const periodLabel = ledgerReport ? `${ledgerReport.from} – ${ledgerReport.to}` : 'Local ledger overview'
  const needsAttentionCount = new Set([...pendingReviews.map((review) => review.reviewId), ...(scan ? [scan.reviewId] : [])]).size + (ledgerReport?.unclassifiedMpesaCount ?? 0)
  const visibleReceiptQueue = receiptQueue.filter((item) => {
    const matchesFilter = receiptQueueFilter === 'all'
      || (receiptQueueFilter === 'failed' && item.status === 'failed')
      || item.status === receiptQueueFilter
    return matchesFilter && `${item.file.name} ${item.merchant || ''}`.toLocaleLowerCase().includes(receiptQueueSearch.toLocaleLowerCase())
  })
  const queueCounts = {
    all: receiptQueue.length,
    processing: receiptQueue.filter((item) => item.status === 'processing').length,
    'needs-review': receiptQueue.filter((item) => item.status === 'needs-review').length,
    saved: receiptQueue.filter((item) => item.status === 'saved').length,
    failed: receiptQueue.filter((item) => item.status === 'failed').length,
  }
  const recentActivity = [
    ...saved.map((receipt) => ({ id: receipt.id, title: receipt.merchant || 'Unnamed merchant', date: receipt.date, detail: receipt.category || 'Uncategorised', amount: receipt.amount, currency: receipt.currency, kind: 'Receipt', direction: 'out', savedAt: receipt.savedAt })),
    ...savedManualIncome.map((income) => ({ id: income.id, title: income.counterparty, date: income.date, detail: income.category || 'Income', amount: income.amount, currency: income.currency, kind: 'Income', direction: 'in', savedAt: income.savedAt })),
    ...savedMpesa.map((transaction) => ({ id: transaction.id, title: transaction.counterparty || transaction.transactionType.replaceAll('_', ' '), date: transaction.date, detail: transaction.ledgerRole.replaceAll('_', ' '), amount: transaction.amount, currency: 'KES', kind: 'M-Pesa', direction: ['income', 'loan_repayment'].includes(transaction.ledgerRole) ? 'in' : ['expense', 'loan_given'].includes(transaction.ledgerRole) ? 'out' : 'neutral', savedAt: transaction.savedAt })),
  ].sort((a, b) => b.date.localeCompare(a.date) || b.savedAt.localeCompare(a.savedAt)).slice(0, 5)
  const expenseSearchTerm = expenseSearch.trim().toLocaleLowerCase()
  const matchesExpenseFilters = (record: { merchant: string; category: string; date: string; amount: string; currency: string; searchable: string }) => {
    const amount = Number(String(record.amount).replace(/,/g, ''))
    return (!expenseSearchTerm || record.searchable.toLocaleLowerCase().includes(expenseSearchTerm))
      && (!expenseCategoryFilter || record.category === expenseCategoryFilter)
      && (!expenseMerchantFilter || record.merchant === expenseMerchantFilter)
      && (!expenseDateFrom || Boolean(record.date && record.date >= expenseDateFrom))
      && (!expenseDateTo || Boolean(record.date && record.date <= expenseDateTo))
      && (!expenseAmountMin || (Number.isFinite(amount) && amount >= Number(expenseAmountMin)))
      && (!expenseAmountMax || (Number.isFinite(amount) && amount <= Number(expenseAmountMax)))
      && (!expenseCurrencyFilter || record.currency.toUpperCase() === expenseCurrencyFilter)
  }
  const filteredReceipts = saved.filter((receipt) => matchesExpenseFilters({
    merchant: receipt.merchant,
    category: receipt.category,
    date: receipt.date,
    amount: receipt.amount,
    currency: receipt.currency,
    searchable: `${receipt.merchant} ${receipt.category} ${receipt.date} ${receipt.amount} ${receipt.currency} ${receipt.paymentMethod} ${receipt.notes}`,
  }))
  const filteredMpesa = savedMpesa.filter((transaction) => matchesExpenseFilters({
    merchant: transaction.counterparty,
    category: transaction.category,
    date: transaction.date,
    amount: transaction.amount,
    currency: 'KES',
    searchable: `${transaction.counterparty} ${transaction.transactionId} ${transaction.date} ${transaction.amount} ${transaction.ledgerRole} ${transaction.category} KES`,
  }))
  const filteredManualIncome = savedManualIncome.filter((income) => matchesExpenseFilters({
    merchant: income.counterparty,
    category: income.category,
    date: income.date,
    amount: income.amount,
    currency: income.currency,
    searchable: `${income.counterparty} ${income.category} ${income.date} ${income.amount} ${income.currency} ${income.paymentMethod} ${income.notes} income`,
  }))
  const expenseMerchants = [...new Set([...saved.map((receipt) => receipt.merchant), ...savedMpesa.map((transaction) => transaction.counterparty), ...savedManualIncome.map((income) => income.counterparty)].filter(Boolean))].sort((a, b) => a.localeCompare(b))
  const expenseCategories = [...new Set([...CATEGORIES, ...INCOME_CATEGORIES, ...saved.map((receipt) => receipt.category), ...savedMpesa.map((transaction) => transaction.category), ...savedManualIncome.map((income) => income.category)])].sort((a, b) => a.localeCompare(b))
  const expenseDateRangeLabel = expenseDateFrom || expenseDateTo
    ? `${expenseDateFrom || 'Any date'} – ${expenseDateTo || 'Any date'}`
    : 'All dates'
  const hasExpenseFilters = Boolean(expenseSearch || expenseCategoryFilter || expenseMerchantFilter || expenseDateFrom || expenseDateTo || expenseAmountMin || expenseAmountMax || expenseCurrencyFilter)
  const reportCurrencyOptions = [...new Set([...saved.map((entry) => entry.currency.toUpperCase()), ...savedManualIncome.map((entry) => entry.currency.toUpperCase()), ...inventoryMovements.map((entry) => entry.currency.toUpperCase()), ...(savedMpesa.length ? ['KES'] : [])])].sort()
  const activeReportCurrency = reportCurrency || (reportCurrencyOptions.includes(defaultCurrency) ? defaultCurrency : reportCurrencyOptions[0] || defaultCurrency)
  const reportExpenseEntries = [
    ...saved.map((entry) => ({ date: entry.date, currency: entry.currency.toUpperCase(), category: entry.category || 'Uncategorised', amountCents: Math.round(Number(String(entry.amount).replace(/,/g, '')) * 100), type: 'expense' as const })),
    ...savedMpesa.filter((entry) => entry.ledgerRole === 'expense').map((entry) => ({ date: entry.date, currency: 'KES', category: entry.category || 'Uncategorised', amountCents: Math.round((Number(entry.matchedReceiptId ? 0 : entry.amount) + Number(entry.fee || 0)) * 100), type: 'expense' as const })),
  ].filter((entry) => /^\d{4}-\d{2}-\d{2}$/.test(entry.date) && Number.isFinite(entry.amountCents) && entry.amountCents > 0)
  const inventoryMatchedIncomeIds = new Set(inventoryMovements.filter((entry) => entry.type === 'sale' && entry.matchedMpesaId).map((entry) => entry.matchedMpesaId))
  const reportIncomeEntries = [
    ...savedManualIncome.map((entry) => ({ date: entry.date, currency: entry.currency.toUpperCase(), category: entry.category, amountCents: Math.round(Number(entry.amount) * 100), type: 'income' as const })),
    ...savedMpesa.filter((entry) => entry.ledgerRole === 'income' && !inventoryMatchedIncomeIds.has(entry.id)).map((entry) => ({ date: entry.date, currency: 'KES', category: entry.category || 'Uncategorised', amountCents: Math.round(Number(entry.amount) * 100), type: 'income' as const })),
    ...inventoryMovements.filter((entry) => entry.type === 'sale').map((entry) => ({ date: entry.date, currency: entry.currency.toUpperCase(), category: 'Inventory sales', amountCents: Math.round(Number(entry.revenue || 0) * 100), type: 'income' as const })),
  ].filter((entry) => /^\d{4}-\d{2}-\d{2}$/.test(entry.date) && Number.isFinite(entry.amountCents) && entry.amountCents > 0)
  const reportStartDate = reportsFrom ? new Date(`${reportsFrom}T00:00:00`) : new Date()
  const reportEndDate = reportsTo ? new Date(`${reportsTo}T00:00:00`) : new Date()
  const reportPeriodDayCount = Math.max(1, Math.floor((reportEndDate.getTime() - reportStartDate.getTime()) / 86400000) + 1)
  let reportComparisonStart = new Date(reportStartDate); reportComparisonStart.setDate(reportComparisonStart.getDate() - reportPeriodDayCount)
  let reportComparisonEnd = new Date(reportStartDate); reportComparisonEnd.setDate(reportComparisonEnd.getDate() - 1)
  if (reportsPreset === 'this-month') {
    reportComparisonStart = new Date(reportStartDate.getFullYear(), reportStartDate.getMonth() - 1, 1)
    const previousMonthLastDay = new Date(reportStartDate.getFullYear(), reportStartDate.getMonth(), 0).getDate()
    reportComparisonEnd = new Date(reportComparisonStart.getFullYear(), reportComparisonStart.getMonth(), Math.min(reportEndDate.getDate(), previousMonthLastDay))
  } else if (reportsPreset === 'last-month') {
    reportComparisonStart = new Date(reportStartDate.getFullYear(), reportStartDate.getMonth() - 1, 1)
    reportComparisonEnd = new Date(reportStartDate.getFullYear(), reportStartDate.getMonth(), 0)
  } else if (reportsPreset === '3-months' || reportsPreset === '6-months') {
    const months = reportsPreset === '3-months' ? 3 : 6
    reportComparisonStart = new Date(reportStartDate.getFullYear(), reportStartDate.getMonth() - months, 1)
  } else if (reportsPreset === 'year') {
    reportComparisonStart = new Date(reportStartDate.getFullYear() - 1, 0, 1)
    reportComparisonEnd = new Date(reportEndDate.getFullYear() - 1, reportEndDate.getMonth(), reportEndDate.getDate())
  }
  const reportDateString = (date: Date) => localDateString(date)
  const currentReportExpenses = reportExpenseEntries.filter((entry) => entry.currency === activeReportCurrency && entry.date >= reportsFrom && entry.date <= reportsTo)
  const currentReportIncome = reportIncomeEntries.filter((entry) => entry.currency === activeReportCurrency && entry.date >= reportsFrom && entry.date <= reportsTo)
  const previousPeriodFrom = reportDateString(reportComparisonStart)
  const previousPeriodTo = reportDateString(reportComparisonEnd)
  const previousReportExpenseCents = reportExpenseEntries.filter((entry) => entry.currency === activeReportCurrency && entry.date >= previousPeriodFrom && entry.date <= previousPeriodTo).reduce((sum, entry) => sum + entry.amountCents, 0)
  const currentReportExpenseCents = currentReportExpenses.reduce((sum, entry) => sum + entry.amountCents, 0)
  const currentReportIncomeCents = currentReportIncome.reduce((sum, entry) => sum + entry.amountCents, 0)
  const reportCategoryTotals = [...currentReportExpenses.reduce((totals, entry) => totals.set(entry.category, (totals.get(entry.category) || 0) + entry.amountCents), new Map<string, number>()).entries()].map(([category, amountCents]) => ({ category, amountCents })).sort((a, b) => b.amountCents - a.amountCents)
  const reportBucketStarts: Date[] = []
  if (reportGrouping === 'weekly') {
    for (let cursor = new Date(reportStartDate); cursor <= reportEndDate; cursor.setDate(cursor.getDate() + 7)) reportBucketStarts.push(new Date(cursor))
  } else {
    for (let cursor = new Date(reportStartDate.getFullYear(), reportStartDate.getMonth(), 1); cursor <= reportEndDate; cursor.setMonth(cursor.getMonth() + 1)) reportBucketStarts.push(new Date(cursor))
  }
  const reportSeries = reportBucketStarts.map((start, index) => {
    const end = reportGrouping === 'weekly' ? new Date(Math.min(reportEndDate.getTime(), start.getTime() + 6 * 86400000)) : new Date(Math.min(reportEndDate.getTime(), new Date(start.getFullYear(), start.getMonth() + 1, 0).getTime()))
    const from = reportGrouping === 'weekly' ? reportDateString(start) : `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-01`
    const to = reportDateString(end)
    const expenses = currentReportExpenses.filter((entry) => reportGrouping === 'weekly' ? entry.date >= reportDateString(start) && entry.date <= to : entry.date.startsWith(`${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}`)).reduce((sum, entry) => sum + entry.amountCents, 0)
    const income = currentReportIncome.filter((entry) => reportGrouping === 'weekly' ? entry.date >= reportDateString(start) && entry.date <= to : entry.date.startsWith(`${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}`)).reduce((sum, entry) => sum + entry.amountCents, 0)
    const label = reportGrouping === 'monthly' ? start.toLocaleDateString(undefined, { month: 'short' }) : `${start.toLocaleDateString(undefined, { month: 'short' })} ${start.getDate()}–${end.getDate()}`
    return { index, from, to, expenses, income, label }
  })
  const reportSeriesMax = Math.max(1, ...reportSeries.flatMap((bucket) => [bucket.expenses, bucket.income]))
  const dashboardRange = getReportRange(reportPeriod)
  const dashboardStart = new Date(`${dashboardRange.from}T00:00:00`)
  const dashboardEnd = new Date(`${dashboardRange.to}T00:00:00`)
  const dashboardEntries = [
    ...reportExpenseEntries.map((entry) => ({ ...entry, direction: 'out' as const })),
    ...reportIncomeEntries.map((entry) => ({ ...entry, direction: 'in' as const })),
    ...savedMpesa.filter((entry) => entry.ledgerRole === 'loan_given').map((entry) => ({ date: entry.date, currency: 'KES', amountCents: Math.round(Number(entry.amount) * 100), direction: 'out' as const })),
    ...savedMpesa.filter((entry) => entry.ledgerRole === 'loan_repayment').map((entry) => ({ date: entry.date, currency: 'KES', amountCents: Math.round(Number(entry.amount) * 100), direction: 'in' as const })),
  ].filter((entry) => entry.currency === activeReportCurrency && /^\d{4}-\d{2}-\d{2}$/.test(entry.date) && entry.date >= dashboardRange.from && entry.date <= dashboardRange.to && Number.isFinite(entry.amountCents) && entry.amountCents > 0)
  const dashboardSeries: Array<{ from: string; to: string; label: string; expenses: number; income: number }> = []
  for (let cursor = new Date(dashboardStart); cursor <= dashboardEnd; cursor.setDate(cursor.getDate() + 7)) {
    const start = new Date(cursor)
    const end = new Date(Math.min(dashboardEnd.getTime(), start.getTime() + 6 * 86400000))
    const from = localDateString(start)
    const to = localDateString(end)
    const bucket = dashboardEntries.filter((entry) => entry.date >= from && entry.date <= to)
    dashboardSeries.push({
      from,
      to,
      label: `${start.toLocaleDateString(undefined, { month: 'short' })} ${start.getDate()}–${end.getDate()}`,
      expenses: bucket.filter((entry) => entry.direction === 'out').reduce((sum, entry) => sum + entry.amountCents, 0),
      income: bucket.filter((entry) => entry.direction === 'in').reduce((sum, entry) => sum + entry.amountCents, 0),
    })
  }
  const dashboardSeriesMax = Math.max(1, ...dashboardSeries.flatMap((bucket) => [bucket.expenses, bucket.income]))
  const dashboardIncomeTotal = dashboardSeries.reduce((sum, bucket) => sum + bucket.income, 0)
  const dashboardExpenseTotal = dashboardSeries.reduce((sum, bucket) => sum + bucket.expenses, 0)
  const dashboardAxisLabel = (cents: number) => { const amount = cents / 100; return amount >= 1000 ? `${(amount / 1000).toFixed(amount >= 10000 ? 0 : 1)}k` : amount >= 10 ? `${Math.round(amount)}` : amount.toFixed(2).replace(/\.?0+$/, '') }
  const dashboardMoney = (cents: number) => `${activeReportCurrency} ${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  const dashboardChartWidth = Math.max(460, dashboardSeries.length * 104)
  const reportCategoryMax = Math.max(1, ...reportCategoryTotals.map((entry) => entry.amountCents))
  const reportMoney = (cents: number) => `${activeReportCurrency} ${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  const reportExpenseChange = previousReportExpenseCents > 0 ? ((currentReportExpenseCents - previousReportExpenseCents) / previousReportExpenseCents) * 100 : null
  const buildReportExportModel = (): ReportExportModel => ({
    from: reportsFrom,
    to: reportsTo,
    currency: activeReportCurrency,
    totals: {
      expenses: (currentReportExpenseCents / 100).toFixed(2),
      income: (currentReportIncomeCents / 100).toFixed(2),
      net: ((currentReportIncomeCents - currentReportExpenseCents) / 100).toFixed(2),
    },
    comparison: {
      previousPeriod: (previousReportExpenseCents / 100).toFixed(2),
      change: reportExpenseChange === null ? 'Not available' : `${reportExpenseChange > 0 ? '+' : ''}${reportExpenseChange.toFixed(1)}%`,
    },
    categories: reportCategoryTotals.map((entry) => ({
      name: entry.category,
      amount: (entry.amountCents / 100).toFixed(2),
      share: `${currentReportExpenseCents ? Math.round(entry.amountCents / currentReportExpenseCents * 100) : 0}%`,
    })),
    trends: reportSeries.map((entry) => ({ period: entry.label, income: (entry.income / 100).toFixed(2), expenses: (entry.expenses / 100).toFixed(2) })),
    records: [
      ...saved.filter((entry) => entry.date >= reportsFrom && entry.date <= reportsTo && entry.currency.toUpperCase() === activeReportCurrency).map((entry) => ({ date: entry.date, type: 'Expense', name: entry.merchant, category: entry.category, amount: entry.amount, currency: entry.currency, notes: entry.notes })),
      ...savedManualIncome.filter((entry) => entry.date >= reportsFrom && entry.date <= reportsTo && entry.currency.toUpperCase() === activeReportCurrency).map((entry) => ({ date: entry.date, type: 'Income', name: entry.counterparty, category: entry.category, amount: entry.amount, currency: entry.currency, notes: entry.notes })),
      ...savedMpesa.filter((entry) => entry.date >= reportsFrom && entry.date <= reportsTo && activeReportCurrency === 'KES').map((entry) => {
        const matchedInventorySale = entry.ledgerRole === 'income' && inventoryMatchedIncomeIds.has(entry.id)
        const matchedReceiptExpense = entry.ledgerRole === 'expense' && Boolean(entry.matchedReceiptId)
        return { date: entry.date, type: `M-Pesa ${entry.ledgerRole.replaceAll('_', ' ')}${matchedInventorySale || matchedReceiptExpense ? ' (matched)' : ''}`, name: entry.counterparty, category: entry.category, amount: entry.amount, currency: 'KES', notes: `${entry.transactionId}${matchedInventorySale ? ' · counted via inventory sale' : matchedReceiptExpense ? ' · receipt covers this expense; fee remains in totals' : ''}` }
      }),
      ...inventoryMovements.filter((entry) => entry.type === 'sale' && entry.date >= reportsFrom && entry.date <= reportsTo && entry.currency.toUpperCase() === activeReportCurrency).map((entry) => ({ date: entry.date, type: 'Inventory sale', name: entry.itemName, category: 'Sales', amount: entry.revenue || '0.00', currency: entry.currency, notes: `${entry.quantity} sold · gross profit is not shown in this report` })),
    ].sort((a, b) => a.date.localeCompare(b.date)),
  })
  const stockSourceReceipt = saved.find((receipt) => receipt.id === stockReceiptId)
  const stockSourceLines = stockSourceReceipt?.items || []
  const stockSourceCurrency = stockSourceReceipt?.currency.toUpperCase()
  const stockSourceInventoryItems = inventoryItems.filter((item) => !stockSourceCurrency || item.currency === stockSourceCurrency)

  return (
    <div className={`app-shell product-shell${sidebarCollapsed ? ' sidebar-is-collapsed' : ''}`}>
      {showFirstRunSetup && <FirstRunSetup storageDirectory={storageDirectory} models={startupModels} isSaving={setupSaving} error={setupError} onSave={(preferences) => void saveFirstRunSetup(preferences)} />}
      {showLaunchScreen && !showFirstRunSetup && <LaunchScreen isChecking={isBootChecking} serverOnline={serverReady} message={bootMessage} error={bootError} modelPreparation={startupModelPreparation} pendingReviews={pendingReviews} onContinue={() => { if (firstRun && serverReady) setShowFirstRunSetup(true); else setShowLaunchScreen(false) }} onResumeReview={(reviewId) => void resumePendingReceipt(reviewId)} />}
      <aside id="workspace-navigation" className="sidebar" aria-hidden={showLaunchScreen} inert={showLaunchScreen}>
        <a className="brand" href="#top" onClick={(event) => { event.preventDefault(); setActivePage('dashboard') }} aria-label="Numora dashboard"><span className="brand-mark"><BrandMark /></span><span>numora</span></a>
        <div className="workspace-switcher"><span className="workspace-avatar">N</span><span><strong>My workspace</strong><small>Local account</small></span><span className="switcher-chevron">⌄</span></div>
        <span className="sidebar-label">WORKSPACE</span>
        <nav className="sidebar-nav" aria-label="Main navigation">
          {WORKSPACE_NAV.map((item) => <button key={item.id} type="button" className={`sidebar-nav-item nav-item-${item.id}${activePage === item.id ? ' is-active' : ''}`} aria-label={`${item.label}. ${item.description}`} title={`${item.label}: ${item.description}`} aria-current={activePage === item.id ? 'page' : undefined} onClick={() => setActivePage(item.id)}><NavIcon name={item.icon} /><span className="sidebar-item-copy"><span>{item.label}</span><small>{item.description}</small></span>{item.id === 'receipts' && saved.length > 0 && <small className="sidebar-count" aria-label={`${saved.length} saved receipts`}>{saved.length}</small>}</button>)}
        </nav>
        <div className="sidebar-spacer" />
        <div className={`sidebar-service${serverReady ? ' is-ready' : ''}`}><span className="service-orbit"><NavIcon name="sparkle" /></span><span><strong>{serverReady ? 'Local AI ready' : 'Local service offline'}</strong><small>{serverReady ? 'QVAC is running on this device' : 'Start the Numora API server'}</small></span><i /></div>
        <button type="button" className={`sidebar-nav-item sidebar-settings${activePage === 'settings' ? ' is-active' : ''}`} aria-label="Settings. Models and preferences" title="Settings: Models and preferences" aria-current={activePage === 'settings' ? 'page' : undefined} onClick={() => setActivePage('settings')}><NavIcon name="settings" /><span className="sidebar-item-copy"><span>Settings</span><small>Models and preferences</small></span></button>
        <div className="sidebar-user"><span className="user-avatar">C</span><span><strong>Local user</strong><small>Private workspace</small></span><span className="user-menu">•••</span></div>
      </aside>

      <div className="workspace-frame" aria-hidden={showLaunchScreen} inert={showLaunchScreen}>
        <header className="topbar">
          <button className="sidebar-toggle" type="button" aria-controls="workspace-navigation" aria-label={sidebarCollapsed ? 'Show navigation sidebar' : 'Hide navigation sidebar'} aria-expanded={!sidebarCollapsed} title={sidebarCollapsed ? 'Show navigation sidebar' : 'Hide navigation sidebar'} onClick={() => setSidebarCollapsed((collapsed) => { const next = !collapsed; try { localStorage.setItem('numora:sidebar-collapsed', String(next)) } catch {} return next })}><NavIcon name="sidebar" /></button>
          <div className="breadcrumbs"><span>Numora</span><span>/</span><strong>{pageLabels[activePage]}</strong></div>
          <div className="topbar-actions">
            <label className="global-search"><NavIcon name="search" /><input value={expenseSearch} onChange={(event) => setExpenseSearch(event.target.value)} onFocus={() => activePage !== 'expenses' && setActivePage('expenses')} placeholder="Search financial records" aria-label="Search financial records" /><kbd>Ctrl F</kbd></label>
            <span className={`offline-indicator${serverReady ? ' is-online' : ''}`} title={serverReady ? 'Local processing service connected' : 'Local processing service is unavailable'}><span />{serverReady ? 'Local AI ready' : 'Service offline'}</span>
            <button className="topbar-add" type="button" onClick={() => { setActivePage('receipts'); setReceiptScreen('import'); setReceiptInputMode('images'); window.setTimeout(() => inputRef.current?.click(), 0) }}><NavIcon name="plus" /><span>Add receipt</span><kbd>Ctrl O</kbd></button>
          </div>
        </header>

      <main id="top" className={`workspace-main${activePage === 'ask' ? ' is-chat-page' : ''}`} ref={workspaceMainRef}>
        {activePage === 'dashboard' && <div className="page-content dashboard-page">
          <section className="page-heading dashboard-heading"><div><span className="section-kicker">YOUR MONEY, AT A GLANCE</span><h1>Dashboard</h1><p>A simple snapshot of what you earned and spent.</p></div><button className="primary-button heading-action" type="button" onClick={() => { setActivePage('receipts'); setReceiptScreen('import'); setReceiptInputMode('images'); window.setTimeout(() => inputRef.current?.click(), 0) }}><NavIcon name="plus" /> Add receipt</button></section>
          <div className="dashboard-period"><span>Period</span><div className="period-switch" role="group" aria-label="Dashboard reporting period"><button type="button" className={reportPeriod === 'this-month' ? 'is-active' : ''} aria-pressed={reportPeriod === 'this-month'} onClick={() => { setReportPeriod('this-month'); void refreshLedgerReport('this-month') }}>This month</button><button type="button" className={reportPeriod === 'last-month' ? 'is-active' : ''} aria-pressed={reportPeriod === 'last-month'} onClick={() => { setReportPeriod('last-month'); void refreshLedgerReport('last-month') }}>Last month</button></div><strong>{periodLabel}</strong>{needsAttentionCount > 0 && <button type="button" className="dashboard-attention-link" onClick={() => setActivePage('receipts')}>{needsAttentionCount} need review</button>}</div>
          <section className="dashboard-summary" aria-label="Income, expenses, and net for selected period">
            {(['income', 'expenses', 'cashResult'] as const).map((metric) => <button type="button" className={`dashboard-summary-card ${metric === 'cashResult' ? 'is-net' : ''}`} key={metric} onClick={() => setActivePage('reports')}>
              <span>{metric === 'cashResult' ? 'Net' : metric === 'income' ? 'Income' : 'Expenses'}</span>
              <strong>{ledgerReport?.totals.length ? ledgerReport.totals.map((total) => `${total.currency} ${total[metric]}`).join(' · ') : `${defaultCurrency} 0.00`}</strong>
            </button>)}
          </section>
          <section className="dashboard-grid dashboard-transactions-grid" aria-label="Transaction activity and recent ledger entries">
            <article className="content-card dashboard-chart-card">
              <div className="dashboard-chart-heading"><div><span className="section-kicker">MONEY MOVEMENT</span><h2>Cash in and out</h2><p>{dashboardRange.from} to {dashboardRange.to} · weekly totals · loans included</p></div><label className="dashboard-chart-currency">Currency<select aria-label="Chart currency" value={activeReportCurrency} onChange={(event) => setReportCurrency(event.target.value)}>{[...new Set([...reportCurrencyOptions, activeReportCurrency])].map((currency) => <option key={currency} value={currency}>{currency}</option>)}</select></label></div>
              <div className="dashboard-chart-legend"><span><i className="dashboard-income-dot" />Money in <strong>{dashboardMoney(dashboardIncomeTotal)}</strong></span><span><i className="dashboard-expense-dot" />Money out <strong>{dashboardMoney(dashboardExpenseTotal)}</strong></span></div>
              {dashboardEntries.length ? <div className="dashboard-chart-scroll"><svg className="dashboard-transaction-chart" role="img" aria-label={`Weekly money in and money out, ${activeReportCurrency}, ${dashboardRange.from} to ${dashboardRange.to}`} viewBox={`0 0 ${dashboardChartWidth} 218`} width={dashboardChartWidth}>
                <line className="chart-gridline" x1="40" y1="50" x2={dashboardChartWidth} y2="50" /><line className="chart-gridline" x1="40" y1="106" x2={dashboardChartWidth} y2="106" /><line className="chart-baseline" x1="40" y1="162" x2={dashboardChartWidth} y2="162" />
                <text className="dashboard-axis-label" x="0" y="53">{dashboardAxisLabel(dashboardSeriesMax)}</text><text className="dashboard-axis-label" x="0" y="109">{dashboardAxisLabel(dashboardSeriesMax / 2)}</text><text className="dashboard-axis-label" x="0" y="165">0</text>
                {dashboardSeries.map((bucket, index) => { const x = index * 104 + 22; const incomeHeight = bucket.income ? Math.max(3, Math.round((bucket.income / dashboardSeriesMax) * 112)) : 0; const expenseHeight = bucket.expenses ? Math.max(3, Math.round((bucket.expenses / dashboardSeriesMax) * 112)) : 0; return <g key={`${bucket.from}-${bucket.to}`}><rect className="dashboard-income-bar" x={x + 18} y={162 - incomeHeight} width="24" height={incomeHeight} rx="5"><title>{bucket.label}: money in {dashboardMoney(bucket.income)}</title></rect><rect className="dashboard-expense-bar" x={x + 49} y={162 - expenseHeight} width="24" height={expenseHeight} rx="5"><title>{bucket.label}: money out {dashboardMoney(bucket.expenses)}</title></rect><text className="dashboard-chart-label" x={x + 45} y="192" textAnchor="middle">{bucket.label}</text></g>})}
              </svg></div> : <div className="dashboard-chart-empty"><strong>No dated transactions yet</strong><span>Saved income and expenses in {activeReportCurrency} will appear here.</span></div>}
            </article>
            <article className="content-card recent-card dashboard-recent-card"><div className="content-card-heading"><div><span className="section-kicker">LATEST ACTIVITY</span><h2>Recent transactions</h2></div><button type="button" className="text-action" onClick={() => setActivePage('expenses')}>View all <NavIcon name="arrow" /></button></div>
              {recentActivity.length ? <><div className="recent-activity-columns" aria-hidden="true"><span>Date</span><span /><span>Activity</span><span>Amount</span></div><div className="activity-list">{recentActivity.map((entry) => <div className={`activity-row is-${entry.direction}`} key={`${entry.kind}-${entry.id}`}><span className="activity-date">{entry.date ? new Date(`${entry.date}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—'}</span><span className={`activity-type ${entry.direction === 'in' ? 'income-type' : entry.direction === 'out' ? 'expense-type' : 'neutral-type'}`}>{entry.direction === 'in' ? '↗' : entry.direction === 'out' ? '↘' : '·'}</span><span className="activity-copy"><strong>{entry.title}</strong><small>{entry.detail} · {entry.kind}</small></span><span className="activity-amount"><strong>{entry.direction === 'in' ? '+' : entry.direction === 'out' ? '−' : ''}{entry.currency} {entry.amount}</strong></span></div>)}</div></> : <div className="empty-state"><span className="empty-icon"><NavIcon name="receipt" /></span><strong>Your ledger starts with one entry</strong><p>Import a receipt or organize an M-Pesa message. Your records stay on this device.</p><button type="button" className="text-action" onClick={() => setActivePage('receipts')}>Get started <NavIcon name="arrow" /></button></div>}
            </article>
          </section>
          <div className="dashboard-chat-link"><span className="assistant-emblem"><NavIcon name="sparkle" /></span><div><strong>Want to ask about your money?</strong><span>Ask Numora about a day, merchant, category, or spending trend.</span></div><button type="button" className="secondary-action" onClick={() => openLedgerChat('How much did I spend last month?')}>Ask Numora <NavIcon name="arrow" /></button></div>
        </div>}

      {activePage === 'receipts' && <div className={`page-content receipts-page${receiptScreen === 'review' && receiptInputMode === 'images' ? ' is-reviewing' : ''}`}>
          <section className="page-heading"><div><span className="section-kicker">{receiptScreen === 'saved' ? 'LOCAL LEDGER' : 'RECEIPTS'}</span><h1>{receiptInputMode === 'mpesa' ? 'M-Pesa messages' : receiptScreen === 'review' ? 'Review receipt' : receiptScreen === 'saved' ? 'Expense saved' : 'Receipts'}</h1><p>{receiptInputMode === 'mpesa' ? 'Organize local transaction messages and confirm how they affect your ledger.' : receiptScreen === 'review' ? 'Check the receipt and confirm its details before saving.' : receiptScreen === 'saved' ? 'The receipt and confirmed expense are stored locally.' : 'Upload receipt photos, review the extracted details, then save them to your ledger.'}</p></div>{receiptScreen !== 'saved' && <span className="privacy-pill"><NavIcon name="settings" /> Stored on this device</span>}</section>
          {receiptScreen === 'import' && <div className="receipt-mode-switch" role="tablist" aria-label="Choose a local import type"><button type="button" role="tab" aria-selected={receiptInputMode === 'images'} className={receiptInputMode === 'images' ? 'is-active' : ''} onClick={() => setReceiptInputMode('images')}><NavIcon name="receipt" /><span><strong>Receipt photos</strong><small>Upload and review images</small></span></button><button type="button" role="tab" aria-selected={receiptInputMode === 'mpesa'} className={receiptInputMode === 'mpesa' ? 'is-active' : ''} onClick={() => setReceiptInputMode('mpesa')}><span className="mode-mpesa-mark">M</span><span><strong>M-Pesa messages</strong><small>Paste and classify confirmations</small></span></button></div>}
        {receiptInputMode === 'mpesa' && <section className="mpesa-card" aria-labelledby="mpesa-title">
          <div className="saved-header"><div><span className="section-kicker">LOCAL TRANSACTION INPUT</span><h2 id="mpesa-title">Paste M-Pesa messages</h2></div><span className="local-tag"><span /> QVAC · LOCAL</span></div>
          <p className="mpesa-intro">Paste transaction confirmation messages below. Put a blank line between messages. Standard Safaricom confirmations are read with local rules; Qwen handles other formats. Review every editable row before saving.</p>
          <form onSubmit={(event) => { event.preventDefault(); void parseMpesaMessages() }}>
            <label className="mpesa-message-label" htmlFor="mpesa-message-input">M-Pesa SMS messages</label>
            <textarea id="mpesa-message-input" className="mpesa-message-input" value={mpesaText} onChange={(event) => { setMpesaText(event.target.value); setMpesaRows([]); setMpesaError(''); setMpesaNotice('') }} placeholder={'QHJ1ABC2DE Confirmed. Ksh1,250.00 sent to ...\n\nQHJ1XYZ8LM Confirmed. You bought goods ...'} maxLength={20000} />
            <div className="mpesa-form-footer"><span>Up to 20 messages · Stored only on this computer</span><button className="primary-button mpesa-parse-button" type="submit" disabled={!serverReady || isParsingMpesa || !mpesaText.trim()}>{isParsingMpesa ? 'QVAC is organizing messages locally…' : 'Organize messages locally'}</button></div>
          </form>
          {mpesaError && <p className="error-message" role="alert">{mpesaError}</p>}
          {mpesaNotice && <p className="success-message" role="status">{mpesaNotice}</p>}
          {mpesaRows.length > 0 && <section className="mpesa-review" aria-label="Review M-Pesa transactions">
            <div className="line-items-heading"><div><h3>Review {mpesaRows.length} transaction{mpesaRows.length === 1 ? '' : 's'}</h3><p>Confirm the amount, direction, date, and counterparty before saving.</p></div></div>
            <div className="mpesa-transaction-list">{mpesaRows.map((row, index) => <article className={`mpesa-transaction${row.duplicate ? ' is-duplicate' : ''}`} key={`${row.transactionId}-${index}`}>
              <div className="mpesa-transaction-heading"><strong>{row.transactionId || `Transaction ${index + 1}`}</strong>{row.duplicate && <span className="mpesa-duplicate-note">Already in ledger</span>}<button type="button" className="remove-item-button" onClick={() => removeMpesaRow(index)}>Remove</button></div>
              <div className="mpesa-fields">
                <label>Transaction ID<input value={row.transactionId} onChange={(event) => updateMpesaRow(index, 'transactionId', event.target.value)} /></label>
                <label>Date<input type="date" value={row.date} onChange={(event) => updateMpesaRow(index, 'date', event.target.value)} /></label>
                <label>Time<input value={row.time} onChange={(event) => updateMpesaRow(index, 'time', event.target.value)} placeholder="Optional" /></label>
                <label>Direction<select value={row.direction} onChange={(event) => updateMpesaRow(index, 'direction', event.target.value)}><option value="outgoing">Outgoing</option><option value="incoming">Incoming</option><option value="reversal">Reversal</option><option value="unknown">Unknown</option></select></label>
                <label>Transaction type<select value={row.transactionType} onChange={(event) => updateMpesaRow(index, 'transactionType', event.target.value)}><option value="send_money">Send money</option><option value="paybill">Paybill</option><option value="buy_goods">Buy goods</option><option value="withdrawal">Withdrawal</option><option value="deposit">Deposit</option><option value="airtime">Airtime</option><option value="receive_money">Receive money</option><option value="reversal">Reversal</option><option value="unknown">Unknown</option></select></label>
                <label>Person or business<input value={row.counterparty} onChange={(event) => updateMpesaRow(index, 'counterparty', event.target.value)} placeholder="Unknown" /></label>
                <label>Amount (KES)<input inputMode="decimal" value={row.amount} onChange={(event) => updateMpesaRow(index, 'amount', event.target.value)} /></label>
                <label>Fee (KES)<input inputMode="decimal" value={row.fee} onChange={(event) => updateMpesaRow(index, 'fee', event.target.value)} placeholder="Not shown" /></label>
                <label>New balance (KES)<input inputMode="decimal" value={row.balance} onChange={(event) => updateMpesaRow(index, 'balance', event.target.value)} placeholder="Not shown" /></label>
                <label>Category<select value={row.category} onChange={(event) => updateMpesaRow(index, 'category', event.target.value)}>{CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}</select></label>
                <label className="mpesa-ledger-role">Ledger treatment<select value={row.ledgerRole || 'unclassified'} onChange={(event) => updateMpesaRow(index, 'ledgerRole', event.target.value)}><option value="unclassified">Choose…</option><option value="expense">Business expense</option><option value="income">Business income / sale</option><option value="loan_given">Loan given (someone owes me)</option><option value="loan_repayment">Loan repayment received</option><option value="transfer">Transfer / receipt already recorded</option></select><small>Choose how this affects reports. Mark a payment as a transfer if its receipt is already recorded, so it is not counted twice.</small></label>
                <label className="mpesa-reference-field">Reference<input value={row.reference} onChange={(event) => updateMpesaRow(index, 'reference', event.target.value)} placeholder="Optional" /></label>
              </div>
              <details className="source-text"><summary>Original M-Pesa message</summary><pre>{row.sourceMessage}</pre></details>
            </article>)}</div>
            <button className="primary-button mpesa-save-button" type="button" onClick={() => void saveMpesaTransactions()} disabled={isSavingMpesa || mpesaRows.some((row) => row.duplicate || !row.ledgerRole || row.ledgerRole === 'unclassified')}>{isSavingMpesa ? 'Saving locally…' : `Approve and add ${mpesaRows.length} to ledger`}</button>
            {mpesaRows.some((row) => !row.ledgerRole || row.ledgerRole === 'unclassified') && <p className="mpesa-duplicate-note">Choose a ledger treatment for each message before saving. Incoming M-Pesa money is not automatically treated as sales.</p>}
            {mpesaRows.some((row) => row.duplicate) && <p className="mpesa-duplicate-note">Remove the already-saved transaction before saving the remaining rows.</p>}
          </section>}
        </section>}
        {receiptScreen === 'saved' && savedReceiptConfirmation && <section className="receipt-saved-confirmation" role="status" aria-live="polite">
          <div className="saved-confirmation-heading"><span className="saved-checkmark" aria-hidden="true"><svg viewBox="0 0 16 16"><path d="m3 8 3.1 3.1L13 4.5" /></svg></span><div><h2>Expense saved</h2><p>The receipt and confirmed expense are stored locally.</p></div></div>
          <dl className="saved-confirmation-details"><div><dt>Merchant</dt><dd>{savedReceiptConfirmation.merchant || 'Unnamed merchant'}</dd></div><div><dt>Date</dt><dd>{savedReceiptConfirmation.date || '—'}</dd></div><div><dt>Total</dt><dd>{savedReceiptConfirmation.currency} {savedReceiptConfirmation.amount}</dd></div><div><dt>Category</dt><dd>{savedReceiptConfirmation.category}</dd></div></dl>
          {notice && <p className="saved-rule-note">{notice}</p>}
          <div className="saved-confirmation-actions"><button type="button" className="secondary-action" onClick={() => { setExpenseSearch(savedReceiptConfirmation.merchant); setActivePage('expenses'); setReceiptScreen('import'); setSavedReceiptConfirmation(null) }}>View expense details</button><button type="button" className="primary-button" onClick={() => { showNextReceiptAfterSave(); if (!receiptQueue.some((item) => item.id !== savedReceiptQueueId && (['queued', 'needs-review'].includes(item.status) || (item.status === 'failed' && item.retryable)))) window.setTimeout(() => inputRef.current?.click(), 0) }}>Review next / import another</button></div>
        </section>}
        {receiptInputMode === 'images' && receiptScreen !== 'saved' && <div className={`workspace-grid receipt-workspace${receiptScreen === 'review' ? ' is-reviewing' : ''}`}>
          <section className="upload-card" aria-labelledby="upload-title">
            {receiptScreen === 'review' && <div className="receipt-review-bar"><button type="button" className="receipt-back-button" onClick={() => setReceiptScreen('import')}><NavIcon name="arrow" /> Back to imports</button><span>{receiptQueue.filter((item) => item.status !== 'saved').length} images in this batch</span><button type="button" className="add-more-files" onClick={() => inputRef.current?.click()}>＋ Add images</button></div>}
            <div className="receipt-image-column">
            <div className="card-heading">
              <div><span className="section-kicker">IMAGE INPUT</span><h2 id="upload-title">Receipt photo</h2></div>
              <span className="step-count">{receiptScreen === 'review' ? 'IMAGE REVIEW' : `STEP ${stage} / 3`}</span>
            </div>

            <input ref={inputRef} className="file-input" type="file" multiple accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" aria-label="Choose one or more receipt images" onChange={(event) => addReceiptFiles(event.target.files || undefined)} />

            {file && previewUrl ? (
              <div className="preview-wrap">
                <img className="receipt-preview" src={previewUrl} alt="Selected receipt preview" />
                <div className="preview-shade" />
                {receiptScanSweepActive && <div className="preview-scan-overlay" aria-hidden="true"><span className="preview-scan-sweep" /><span className="preview-scan-label"><i /> Reading locally</span></div>}
                <div className="preview-caption">
                  <span className="image-check" aria-hidden="true"><svg viewBox="0 0 16 16"><path d="m3 8 3.1 3.1L13 4.5" /></svg></span>
                  <div className="preview-file-info"><strong>{file.name}</strong><span>{formatFileSize(file.size)} · {scan ? `Read in ${(scan.elapsedMs / 1000).toFixed(1)}s` : 'Ready to read locally'}</span></div>
                  <button className="remove-button" type="button" onClick={clearImage} aria-label="Remove selected image"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 5h12M8 5V3.5h4V5m-6 0 .7 11h6.6L14 5M8.5 8v5m3-5v5" /></svg></button>
                </div>
              </div>
            ) : (
              <button className={`dropzone${isDragging ? ' is-dragging' : ''}`} type="button" onClick={() => inputRef.current?.click()} onDragOver={(event) => { event.preventDefault(); setIsDragging(true) }} onDragLeave={() => setIsDragging(false)} onDrop={(event) => { event.preventDefault(); setIsDragging(false); addReceiptFiles(event.dataTransfer.files) }}>
                <span className="upload-icon" aria-hidden="true"><svg viewBox="0 0 32 32"><path d="M16 21V7m0 0-5 5m5-5 5 5M7 19v6a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-6" /></svg></span>
                <span className="drop-title">Drop one or more receipt images here</span>
                <span className="drop-subtitle">or <span className="browse-link">choose from this device</span></span>
                <span className="file-hint">JPG, PNG or WebP · up to 15 MB each</span>
              </button>
            )}

            {file && receiptScreen === 'import' && <button type="button" className="add-more-files" onClick={() => inputRef.current?.click()}>＋ Add more receipts</button>}

            {receiptScreen === 'review' && <div className="receipt-filmstrip" aria-label="Receipt images in this batch">{receiptQueue.map((item, index) => <button key={item.id} type="button" className={`receipt-filmstrip-item${item.id === activeQueueId ? ' is-active' : ''} status-${item.status}`} aria-label={`${item.file.name}, ${item.status}${item.id === activeQueueId ? ', selected' : ''}`} aria-pressed={item.id === activeQueueId} onClick={() => openQueuedReceipt(item)} disabled={item.status === 'duplicate' || item.status === 'saved'}><span className="filmstrip-preview">{item.thumbnail ? <img src={item.thumbnail} alt="" /> : <span>▤</span>}<i className="filmstrip-status-icon" aria-hidden="true">{item.status === 'saved' || item.status === 'needs-review' ? <svg viewBox="0 0 16 16"><path d="m3 8 3.1 3.1L13 4.5" /></svg> : item.status === 'processing' ? <span className="filmstrip-spinner" /> : index + 1}</i></span><span className="filmstrip-name" title={item.file.name}>{item.merchant || item.file.name}</span><small>{item.status === 'needs-review' ? 'Ready to review' : item.status === 'processing' ? 'Reading' : item.status === 'saved' ? 'Saved' : item.status === 'failed' ? 'Retry needed' : 'Not analyzed'}</small></button>)}</div>}

            {receiptScreen === 'import' && <section className="receipt-queue" aria-labelledby="receipt-queue-title">
              <div className="receipt-queue-heading"><div><span className="section-kicker">IMPORT QUEUE</span><h3 id="receipt-queue-title">Receipt files <small>{receiptQueue.length}</small></h3></div><div className="queue-tools"><label className="queue-search"><NavIcon name="search" /><input value={receiptQueueSearch} onChange={(event) => setReceiptQueueSearch(event.target.value)} placeholder="Search filename or merchant" aria-label="Search receipt filenames or merchants" /></label><button type="button" className="queue-process-button" onClick={beginReceiptAnalysis} disabled={!serverReady || !receiptQueue.some((item) => item.status === 'queued' || item.status === 'needs-review' || (item.status === 'failed' && item.retryable))}>Review &amp; analyze</button></div></div>
              <div className="queue-filters" role="tablist" aria-label="Filter imported receipts">{([['all', 'All'], ['processing', 'Processing'], ['needs-review', 'Needs review'], ['saved', 'Saved'], ['failed', 'Failed']] as const).map(([filter, label]) => <button key={filter} type="button" role="tab" aria-selected={receiptQueueFilter === filter} className={receiptQueueFilter === filter ? 'is-active' : ''} onClick={() => setReceiptQueueFilter(filter)}>{label}<span>{queueCounts[filter]}</span></button>)}</div>
              {visibleReceiptQueue.length ? <div className="receipt-queue-list">{visibleReceiptQueue.map((item) => <article className={`receipt-queue-row status-${item.status}`} key={item.id}>
                {item.thumbnail ? <img src={item.thumbnail} alt="" className="queue-thumbnail" /> : <span className="queue-thumbnail queue-file-icon" aria-hidden="true">▤</span>}
                <div className="queue-file-copy"><strong title={item.file.name}>{item.file.name}</strong><span>{formatFileSize(item.file.size)} · {item.status === 'needs-review' ? 'OCR complete' : item.status === 'saved' ? 'Saved to ledger' : item.status === 'processing' ? 'Reading locally…' : item.status === 'failed' ? item.message || 'Could not process this file' : item.status === 'duplicate' ? 'Possible duplicate' : 'Waiting in queue'}</span>{item.message && item.status !== 'failed' && item.status !== 'duplicate' && <small>{item.message}</small>}</div>
                <span className={`queue-status-pill status-${item.status}`}>{item.status === 'needs-review' ? 'NEEDS REVIEW' : item.status.replace('-', ' ').toUpperCase()}</span>
                {item.status === 'duplicate' ? <button type="button" className="queue-row-action" onClick={() => allowPossibleDuplicate(item.id)}>Import anyway</button> : item.status === 'queued' || item.status === 'needs-review' || (item.status === 'failed' && item.retryable) ? <button type="button" className="queue-row-action" onClick={() => openQueuedReceipt(item)}>{item.status === 'needs-review' && item.id === activeQueueId ? 'Review open' : item.status === 'failed' ? 'Retry' : item.status === 'needs-review' ? 'Open review' : 'Prepare'}</button> : null}
                <button type="button" className="queue-remove" aria-label={`Remove ${item.file.name} from import queue only`} title={item.status === 'saved' ? 'Remove from this list; the saved ledger entry remains.' : 'Remove from import queue'} onClick={() => removeQueuedReceipt(item.id)} disabled={isScanning && item.id === activeQueueId}>×</button>
              </article>)}</div> : <p className="queue-empty">{receiptQueue.length ? 'No receipt files match this filter.' : 'Imported receipt images will appear here. You can add several at once.'}</p>}
              {queueBatchMessage && <p className="queue-guidance" role="status" aria-live="polite">{queueBatchMessage}</p>}
              {receiptQueueStorageError && <p className="queue-storage-warning" role="alert">{receiptQueueStorageError} Queue files may not survive closing this app.</p>}
              {scan && fields && receiptQueue.some((item) => item.status === 'queued') && <p className="queue-guidance">Save or clear the open receipt review before starting the next batch.</p>}
              {receiptQueue.some((item) => item.status === 'queued') && <p className="queue-guidance">Review receipts one at a time. Select an image to analyze it locally, then check its suggestions before saving. Images that need rotation or perspective adjustment can be opened first.</p>}
            </section>}

            {scanProgress && (isScanning || !file || scanProgress.itemName === file.name) && <ProcessingAnimation stage={scanProgress.stage} message={scanProgress.message} itemName={scanProgress.itemName || file?.name || 'Receipt image'} itemIndex={scanProgress.itemIndex} itemTotal={scanProgress.itemTotal} uncertain={scanProgress.uncertain} onCancel={isScanning ? cancelReceiptProcessing : undefined} cancelDisabled={!activeScanRef.current} />}

            {file && !scan && <div className={`quality-check${imageQuality?.warnings.length ? ' has-warnings' : ''}`} role="status" aria-live="polite">
              <strong>{isCheckingQuality ? 'Checking photo quality…' : imageQuality?.warnings.length ? 'Photo may be difficult to read' : 'Photo quality check passed'}</strong>
              {imageQuality && <span>{imageQuality.width > 0 ? `${imageQuality.width} × ${imageQuality.height} pixels` : 'Basic image checks are unavailable'}</span>}
              {imageQuality?.warnings.map((warning) => <span key={warning}>{warning}</span>)}
            </div>}
            {file && !scan && <ImagePreparation key={`${file.name}-${file.lastModified}`} ref={imagePreparationRef} file={file} />}

            {file && !scan && <button className="primary-button scan-button" type="button" onClick={() => { setReceiptScreen('review'); void scanReceipt() }} disabled={isScanning || isCheckingQuality || !serverReady}>{isScanning ? 'Preparing and reading locally…' : isCheckingQuality ? 'Checking photo…' : serverReady ? (receiptScreen === 'review' ? 'Analyze this receipt' : 'Analyze receipt') : 'Starting local OCR…'}</button>}
            </div>

            {fields && scan && (
              <section className="review-panel" aria-labelledby="review-title">
                <div className="review-heading"><div><span className="section-kicker">STEP 2 · CHECK THE RESULTS</span><h2 id="review-title">Review extracted details</h2></div><span className="local-tag"><span /> LOCAL AI</span></div>
                <p className="review-hint">These are suggestions from the receipt image. Correct anything that looks wrong before saving.</p>
                {requiresFinancialConfirmation && <div className="receipt-total-warning" role="alert"><strong>Receipt totals need your attention.</strong><label className="financial-ack"><input type="checkbox" checked={financialReviewConfirmed} onChange={(event) => setFinancialReviewConfirmed(event.target.checked)} /><span>I checked the receipt amounts and confirm this expense.</span></label></div>}
                <details className="scan-details">
                  <summary>Scan details and totals check</summary>
                {scan.ocrQuality && <div className={`ocr-quality${scan.ocrQuality.retryRecommended || (scan.ocrQuality.averageConfidence !== null && scan.ocrQuality.averageConfidence < 0.68) ? ' is-low' : ''}`} role="status">
                  <strong>{scan.ocrQuality.averageConfidence === null ? 'QVAC did not provide line confidence scores' : `Average text-line confidence: ${Math.round(scan.ocrQuality.averageConfidence * 100)}%`}</strong>
                  <span>{scan.ocrQuality.blockCount} text lines · {scan.ocrQuality.lowConfidenceCount} low-confidence lines</span>
                  {scan.ocrQuality.retryAttempted && <span>{scan.ocrQuality.retryError ? `Contrast retry unavailable: ${scan.ocrQuality.retryError}` : scan.ocrQuality.retrySelected ? 'The contrast-adjusted pass scored better and is shown below.' : 'The contrast-adjusted pass did not score better; the first pass is shown.'}</span>}
                  {scan.ocrQuality.retryRecommended && scan.ocrQuality.reasons.map((reason) => <span key={reason}>{reason}</span>)}
                  {(scan.ocrQuality.retryRecommended || (scan.ocrQuality.averageConfidence !== null && scan.ocrQuality.averageConfidence < 0.68)) && <span>Still uncertain—check the values against the image and the text read below.</span>}
                  <span className="ocr-quality-caveat">Confidence is a signal from OCR, not a guarantee that the recognized text is correct.</span>
                </div>}
                {scan.modelInterpretation && <div className={`model-interpretation${scan.modelInterpretation.used ? '' : scan.modelInterpretation.model === 'Not needed' ? '' : ' has-warning'}`} role="status">
                  <strong>{scan.modelInterpretation.used ? `${scan.modelInterpretation.model} interpreted the OCR text locally` : scan.modelInterpretation.model === 'Not needed' ? 'Fast local extraction used' : 'Local language model unavailable; using OCR-based suggestions'}</strong>
                  <span>{`${scan.ocrModel || 'QVAC OCR'} ran on ${scan.ocrBackend || 'CPU'}. `}{scan.modelInterpretation.used ? `Text interpretation ran on ${scan.modelInterpretation.backend}. ${scan.modelInterpretation.itemsFromOcr ? 'OCR-based item rows were kept because the model missed some rows. ' : ''}Verify all fields against the receipt.` : scan.modelInterpretation.note || scan.modelInterpretation.error || 'Check the OCR suggestions carefully.'}</span>
                  <span>The model organizes OCR text; it cannot recover characters OCR failed to read.</span>
                </div>}
                <div className={`financial-checks${requiresFinancialConfirmation ? ' has-conflicts' : ''}`} role="status">
                  <strong>{requiresFinancialConfirmation ? 'Check the receipt totals and items' : scan.financialChecks?.checks.length ? 'Receipt arithmetic checks out' : 'Receipt totals could not be cross-checked'}</strong>
                  {scan.financialChecks?.checks.length || reviewedItemsMismatch ? <ul>{scan.financialChecks?.checks.map((check) => <li key={check.label} className={check.matches ? 'check-match' : 'check-conflict'}>
                    <span>{check.label}</span><span>{fields.currency} {check.calculated} calculated · {fields.currency} {check.printed} printed{!check.matches ? ` · difference ${fields.currency} ${check.difference}` : ' · match'}</span>
                  </li>)}{reviewedItemsMismatch && <li className="check-conflict"><span>Reviewed item sum vs printed subtotal</span><span>{fields.currency} {itemTotal.toFixed(2)} reviewed · {fields.currency} {scan.financialReference.subtotal?.toFixed(2)} printed · check the difference</span></li>}</ul> : <span>Check the printed total against the receipt before approving.</span>}
                  {items.length > 0 && scan.financialReference?.subtotal == null && <span>Reviewed items cannot be compared because OCR did not identify a receipt subtotal.</span>}
                  {scan.deepRead?.attempted && <span>{scan.deepRead.note}</span>}
                  {deepReadError && <span className="error-message" role="alert">{deepReadError}</span>}
                </div>
                <details className="source-text"><summary>View text read from receipt</summary><pre>{scan.rawText || 'No readable text was found.'}</pre></details>
                </details>
                <section className="receipt-store-info" aria-labelledby="store-info-title">
                  <div className="receipt-section-heading"><h3 id="store-info-title">Store information</h3></div>
                  <div className="review-fields">
                    <label>Merchant<input value={fields.merchant} onChange={(event) => updateField('merchant', event.target.value)} placeholder="Merchant name" />{renderEvidence('merchant')}</label>
                    <div className="field-row"><label>Date<input type="date" value={fields.date} onChange={(event) => updateField('date', event.target.value)} />{renderEvidence('date')}</label><label>Payment method<select value={fields.paymentMethod} onChange={(event) => updateField('paymentMethod', event.target.value)}><option value="Unknown">Choose…</option><option>M-Pesa</option><option>Cash</option><option>Card</option><option>Bank</option><option>Other</option></select>{renderEvidence('paymentMethod')}</label></div>
                  </div>
                </section>
                <section className="line-items-review" aria-labelledby="line-items-title">
                  <div className="line-items-heading"><div><h3 id="line-items-title">Items</h3><p>Review item names and prices.</p></div><button className="add-item-button" type="button" onClick={addItem}>Add item</button></div>
                  {items.length ? <>
                    <div className="line-item-list">{items.map((item, index) => <div className="line-item-row" key={`${index}-${item.sourceLine}`}>
                      <label><span className="line-item-label">Item {index + 1}</span><input value={item.description} maxLength={120} onChange={(event) => updateItem(index, 'description', event.target.value)} placeholder="Item name" />
                        {item.sourceLine ? <details className="line-item-source"><summary>View source line</summary><q>{item.sourceLine}</q>{item.confidence !== null && <small>Line confidence {Math.round(item.confidence * 100)}%</small>}</details> : <span className="line-item-source is-manual">Added manually</span>}
                      </label>
                      <label><span className="line-item-label">Price · {fields.currency}</span><input inputMode="decimal" value={item.amount} onChange={(event) => updateItem(index, 'amount', event.target.value)} placeholder="0.00" /></label>
                      <button className="remove-item-button" type="button" aria-label={`Remove item ${index + 1}`} onClick={() => removeItem(index)}>Remove</button>
                    </div>)}</div>
                    <div className="line-item-total"><span>Reviewed item sum</span><strong>{fields.currency} {itemTotal.toFixed(2)}</strong></div>
                    {!itemsComplete && <p className="line-item-validation">Enter a name and positive price for each row, or remove incomplete rows.</p>}
                  </> : <p className="no-line-items">No item rows were identified. You can add them manually or continue with the receipt total.</p>}
                </section>
                <section className="receipt-expense-details" aria-labelledby="expense-details-title">
                  <div className="receipt-section-heading"><h3 id="expense-details-title">Expense details</h3></div>
                  <div className="review-fields">
                    <div className="field-row"><label>Total amount<input inputMode="decimal" value={fields.amount} onChange={(event) => updateField('amount', event.target.value)} placeholder="0.00" />{renderEvidence('amount')}</label><label>Currency<select value={fields.currency} onChange={(event) => updateField('currency', event.target.value)}><option>KES</option><option>USD</option><option>Other</option><option>Uncategorised</option></select>{renderEvidence('currency')}</label></div>
                    <label>Category<select value={fields.category} onChange={(event) => updateField('category', event.target.value)}>{CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}</select>{renderEvidence('category')}</label>
                    <label>Notes<textarea rows={2} value={fields.notes} onChange={(event) => updateField('notes', event.target.value)} placeholder="Optional note" />{renderEvidence('notes')}</label>
                  </div>
                </section>
                <label className="remember-rule"><input type="checkbox" checked={rememberCategoryRule} disabled={!fields.merchant.trim() || fields.category === 'Uncategorised'} onChange={(event) => setRememberCategoryRule(event.target.checked)} /><span>Remember <strong>{fields.category}</strong> for future receipts from <strong>{fields.merchant || 'this merchant'}</strong>.</span></label>
                <div className="receipt-review-actions"><button className="secondary-action" type="button" onClick={() => void runSlowerAccuracyRead()} disabled={isDeepReading || isSaving}>{isDeepReading ? 'Retrying OCR locally…' : 'Retry / edit OCR'}</button><button className="primary-button save-button" type="button" onClick={saveReceipt} disabled={isSaving || isDeepReading || !itemsComplete || Boolean(requiresFinancialConfirmation && !financialReviewConfirmed)}>{isSaving ? 'Saving on this device…' : 'Save expense'}</button></div>
              </section>
            )}

            {receiptScreen === 'review' && !(fields && scan) && <section className="review-panel review-skeleton-panel" aria-label="Receipt details loading" aria-live="polite"><div className="review-heading"><div><span className="section-kicker">LOCAL OCR · QVAC + QWEN</span><h2>{selectedReceiptIsProcessing ? 'Reading receipt details' : isScanning ? 'Waiting for local OCR' : error ? 'Could not read this receipt' : 'Ready to analyze'}</h2></div><span className="skeleton-status-dot" /></div><p className="review-hint">{selectedReceiptIsProcessing ? 'The image stays on this device. We’ll show editable fields here as soon as its analysis finishes.' : isScanning ? `${scanProgress?.itemName || 'Another receipt'} is finishing first. This image’s details will stay here until its local read begins.` : error || 'Select Analyze this receipt to read the image locally.'}</p><div className="receipt-skeleton-block"><div className="skeleton-heading-line" /><div className="skeleton-field-grid"><span /><span /><span /><span /></div></div><div className="receipt-skeleton-block"><div className="skeleton-heading-line short" /><div className="skeleton-item-row"><span /><i /></div><div className="skeleton-item-row"><span /><i /></div><div className="skeleton-item-row"><span /><i /></div></div>{!isScanning && !error && file && <button className="primary-button" type="button" onClick={scanReceipt} disabled={isCheckingQuality || !serverReady}>{isCheckingQuality ? 'Checking image…' : 'Analyze this receipt'}</button>}{error && <button className="secondary-action" type="button" onClick={scanReceipt} disabled={isScanning || !serverReady}>Retry analysis</button>}</section>}

            {error && <p className="error-message" role="alert">{error}</p>}
            {notice && <p className="success-message" role="status">{notice}</p>}
            <div className="privacy-note"><svg viewBox="0 0 20 20" aria-hidden="true"><rect x="4.5" y="8.5" width="11" height="8" rx="2" /><path d="M7 8.5V6a3 3 0 0 1 6 0v2.5" /></svg><p><strong>Local processing.</strong> The image is read by QVAC on this computer. It is saved to the ledger only after you approve it.</p></div>
          </section>

        </div>}
        </div>}

        {activePage === 'expenses' && <div className="page-content expenses-page">
          <section className="page-heading"><div><span className="section-kicker">TRANSACTION REGISTER · {saved.length + savedMpesa.length + savedManualIncome.length} RECORDS</span><h1>Transactions</h1><p className="expense-date-range">{expenseDateRangeLabel}</p></div><div className="expense-heading-actions"><button type="button" className="export-ledger-button" onClick={exportLedgerCsv} disabled={!saved.length && !savedMpesa.length && !savedManualIncome.length} title="Download all saved ledger records as a CSV file">Export CSV</button><button type="button" className="secondary-action" onClick={() => { setShowManualExpenseForm(false); setShowManualIncomeForm((value) => !value); setManualIncomeError(''); setManualIncomeNotice('') }}><NavIcon name="plus" /> Add income</button><button type="button" className="primary-button" onClick={() => { setShowManualIncomeForm(false); setShowManualExpenseForm((value) => !value); setManualExpenseError(''); setManualExpenseNotice('') }}><NavIcon name="plus" /> Add expense</button></div></section>
          <section className="content-card expense-register">
            <div className="expense-filter-panel">
              <label className="register-search expense-filter-search"><NavIcon name="search" /><input ref={expenseSearchRef} value={expenseSearch} onChange={(event) => setExpenseSearch(event.target.value)} placeholder="Search financial records" /><kbd>Ctrl F</kbd></label>
              <label className="expense-filter-category">Category<select value={expenseCategoryFilter} onChange={(event) => setExpenseCategoryFilter(event.target.value)}><option value="">All categories</option>{expenseCategories.map((category) => <option key={category} value={category}>{category}</option>)}</select></label>
              <label className="expense-filter-merchant">Merchant<select value={expenseMerchantFilter} onChange={(event) => setExpenseMerchantFilter(event.target.value)}><option value="">All merchants</option>{expenseMerchants.map((merchant) => <option key={merchant} value={merchant}>{merchant}</option>)}</select></label>
              <label className="expense-filter-date-from">Date from<input type="date" value={expenseDateFrom} onChange={(event) => setExpenseDateFrom(event.target.value)} /></label>
              <label className="expense-filter-date-to">Date to<input type="date" value={expenseDateTo} onChange={(event) => setExpenseDateTo(event.target.value)} /></label>
              <label className="expense-filter-min">Min amount<input inputMode="decimal" type="number" min="0" step="0.01" value={expenseAmountMin} onChange={(event) => setExpenseAmountMin(event.target.value)} placeholder="0.00" /></label>
              <label className="expense-filter-max">Max amount<input inputMode="decimal" type="number" min="0" step="0.01" value={expenseAmountMax} onChange={(event) => setExpenseAmountMax(event.target.value)} placeholder="Any" /></label>
              <label className="expense-filter-currency">Currency<select value={expenseCurrencyFilter} onChange={(event) => setExpenseCurrencyFilter(event.target.value)}><option value="">All currencies</option><option value="KES">KES</option><option value="USD">USD</option><option value="OTHER">Other</option></select></label>
              {hasExpenseFilters && <button type="button" className="clear-expense-filters expense-filter-clear" onClick={() => { setExpenseSearch(''); setExpenseCategoryFilter(''); setExpenseMerchantFilter(''); setExpenseDateFrom(''); setExpenseDateTo(''); setExpenseAmountMin(''); setExpenseAmountMax(''); setExpenseCurrencyFilter('') }}>Clear filters</button>}
            </div>
            {manualExpenseNotice && <p className="success-message expense-form-feedback" role="status">{manualExpenseNotice}</p>}
            {manualExpenseError && <p className="error-message expense-form-feedback" role="alert">{manualExpenseError}</p>}
            {manualIncomeNotice && <p className="success-message expense-form-feedback" role="status">{manualIncomeNotice}</p>}
            {manualIncomeError && <p className="error-message expense-form-feedback" role="alert">{manualIncomeError}</p>}
            {showManualExpenseForm && <form className="manual-expense-form" onSubmit={(event) => void saveManualExpense(event)}>
              <div className="manual-expense-heading"><div><span className="section-kicker">MANUAL ENTRY</span><h2>Add an expense</h2></div><button type="button" className="text-action" onClick={() => setShowManualExpenseForm(false)}>Cancel</button></div>
              <label>Merchant or payee<input required maxLength={160} value={manualExpense.merchant} onChange={(event) => setManualExpense((current) => ({ ...current, merchant: event.target.value }))} placeholder="e.g. Market or supplier" /></label>
              <label>Date<input required type="date" value={manualExpense.date} onChange={(event) => setManualExpense((current) => ({ ...current, date: event.target.value }))} /></label>
              <label>Amount<input required type="number" min="0.01" step="0.01" value={manualExpense.amount} onChange={(event) => setManualExpense((current) => ({ ...current, amount: event.target.value }))} placeholder="0.00" /></label>
              <label>Currency<select value={manualExpense.currency} onChange={(event) => setManualExpense((current) => ({ ...current, currency: event.target.value }))}><option>KES</option><option>USD</option><option>Other</option></select></label>
              <label>Category<select value={manualExpense.category} onChange={(event) => setManualExpense((current) => ({ ...current, category: event.target.value }))}>{CATEGORIES.map((category) => <option key={category}>{category}</option>)}</select></label>
              <label>Payment method<select value={manualExpense.paymentMethod} onChange={(event) => setManualExpense((current) => ({ ...current, paymentMethod: event.target.value }))}><option>Cash</option><option>M-Pesa</option><option>Card</option><option>Bank</option><option>Other</option></select></label>
              <label className="manual-expense-notes">Notes<textarea maxLength={1000} rows={2} value={manualExpense.notes} onChange={(event) => setManualExpense((current) => ({ ...current, notes: event.target.value }))} placeholder="Optional details" /></label>
              <button type="submit" className="primary-button manual-expense-submit" disabled={!serverReady || isSavingManualExpense}>{isSavingManualExpense ? 'Saving locally…' : 'Save expense'}</button>
            </form>}
            {showManualIncomeForm && <form className="manual-expense-form" onSubmit={(event) => void saveManualIncome(event)}>
              <div className="manual-expense-heading"><div><span className="section-kicker">MANUAL ENTRY</span><h2>Add income</h2></div><button type="button" className="text-action" onClick={() => setShowManualIncomeForm(false)}>Cancel</button></div>
              <label>Received from<input required maxLength={160} value={manualIncome.source} onChange={(event) => setManualIncome((current) => ({ ...current, source: event.target.value }))} placeholder="e.g. Client, employer, or buyer" /></label>
              <label>Date received<input required type="date" value={manualIncome.date} onChange={(event) => setManualIncome((current) => ({ ...current, date: event.target.value }))} /></label>
              <label>Amount<input required type="number" min="0.01" step="0.01" value={manualIncome.amount} onChange={(event) => setManualIncome((current) => ({ ...current, amount: event.target.value }))} placeholder="0.00" /></label>
              <label>Currency<select value={manualIncome.currency} onChange={(event) => setManualIncome((current) => ({ ...current, currency: event.target.value }))}><option>KES</option><option>USD</option><option>Other</option></select></label>
              <label>Income type<select value={manualIncome.category} onChange={(event) => setManualIncome((current) => ({ ...current, category: event.target.value }))}>{INCOME_CATEGORIES.map((category) => <option key={category}>{category}</option>)}</select></label>
              <label>Received by<select value={manualIncome.paymentMethod} onChange={(event) => setManualIncome((current) => ({ ...current, paymentMethod: event.target.value }))}><option>Cash</option><option>M-Pesa</option><option>Card</option><option>Bank</option><option>Other</option></select></label>
              <label className="manual-expense-notes">Notes<textarea maxLength={1000} rows={2} value={manualIncome.notes} onChange={(event) => setManualIncome((current) => ({ ...current, notes: event.target.value }))} placeholder="Optional details" /></label>
              <button type="submit" className="primary-button manual-expense-submit" disabled={!serverReady || isSavingManualIncome}>{isSavingManualIncome ? 'Saving locally…' : 'Save income'}</button>
            </form>}
            {exportMessage && <p className="export-feedback" role="status">{exportMessage}</p>}
            {matchMessage && <p className={`match-feedback${matchMessage.startsWith('Entries matched') || matchMessage.startsWith('Match removed') ? ' is-success' : ' is-error'}`} role="status">{matchMessage}</p>}
            {filteredReceipts.length + filteredMpesa.length + filteredManualIncome.length ? <div className="transaction-table-wrap"><table className="transaction-table"><thead><tr><th>Date</th><th>Merchant / counterparty</th><th>Category / type</th><th>Source</th><th>Receipt match</th><th className="amount-column">Amount</th></tr></thead><tbody>
              {filteredReceipts.map((receipt) => <tr key={`receipt-${receipt.id}`}><td>{receipt.date || '—'}</td><td><button type="button" className="transaction-detail-trigger" onClick={() => setSelectedTransaction({ kind: 'receipt', entry: receipt })} aria-label={`View details for ${receipt.merchant || 'unnamed merchant'}`}><strong>{receipt.merchant || 'Unnamed merchant'}</strong><small>{receipt.paymentMethod} · View details</small></button></td><td>{receipt.category} <small>expense</small></td><td><span className="source-badge"><NavIcon name="receipt" /> {receipt.sourceType === 'manual_expense' ? 'Manual' : 'Receipt'}</span></td><td>{receipt.matchedTransactionId ? <span className="matched-label">Matched to M-Pesa</span> : '—'}</td><td className="amount-column"><strong>{receipt.currency} {receipt.amount}</strong></td></tr>)}
              {filteredManualIncome.map((income) => <tr key={`income-${income.id}`}><td>{income.date}</td><td><button type="button" className="transaction-detail-trigger" onClick={() => setSelectedTransaction({ kind: 'income', entry: income })} aria-label={`View details for income from ${income.counterparty}`}><strong>{income.counterparty}</strong><small>{income.paymentMethod} · View details</small></button></td><td>{income.category} <small>income</small></td><td><span className="source-badge">Manual income</span></td><td>—</td><td className="amount-column"><strong className="income-amount">+ {income.currency} {income.amount}</strong></td></tr>)}
              {filteredMpesa.map((transaction) => {
                const candidates = saved.filter((receipt) => receipt.currency.toUpperCase() === 'KES' && receipt.amount === transaction.amount && (!receipt.matchedTransactionId || receipt.matchedTransactionId === transaction.id))
                return <tr key={`mpesa-${transaction.id}`}><td>{transaction.date || '—'}</td><td><button type="button" className="transaction-detail-trigger" onClick={() => setSelectedTransaction({ kind: 'mpesa', entry: transaction })} aria-label={`View details for M-Pesa transaction ${transaction.transactionId}`}><strong>{transaction.counterparty || transaction.transactionType.replaceAll('_', ' ')}</strong><small>{transaction.transactionId} · View details</small></button></td><td>{transaction.category} <small>{transaction.ledgerRole.replaceAll('_', ' ')}</small></td><td><span className="source-badge mpesa-badge">M-Pesa</span></td><td>{transaction.ledgerRole === 'expense' ? <select className="receipt-match-select" aria-label={`Match ${transaction.transactionId} to a receipt`} value={transaction.matchedReceiptId || ''} onChange={(event) => void updateReceiptMatch(transaction.id, event.target.value)} disabled={matchingTransactionId === transaction.id}><option value="">{candidates.length ? 'No match' : transaction.matchedReceiptId ? 'Matched receipt unavailable' : 'No exact match'}</option>{candidates.map((receipt) => <option value={receipt.id} key={receipt.id}>{receipt.merchant} · {receipt.date || 'No date'} · {receipt.currency} {receipt.amount}</option>)}</select> : '—'}</td><td className="amount-column"><strong>KES {transaction.amount}</strong></td></tr>
              })}
            </tbody></table></div> : <div className="empty-state"><span className="empty-icon"><NavIcon name="wallet" /></span><strong>{hasExpenseFilters ? 'No matching transactions' : 'No saved transactions yet'}</strong><p>{hasExpenseFilters ? 'Adjust your search or filters to see more records.' : 'Saved receipts, manual expenses, income, and classified M-Pesa records will appear here.'}</p>{hasExpenseFilters && <button className="text-action" type="button" onClick={() => { setExpenseSearch(''); setExpenseCategoryFilter(''); setExpenseMerchantFilter(''); setExpenseDateFrom(''); setExpenseDateTo(''); setExpenseAmountMin(''); setExpenseAmountMax(''); setExpenseCurrencyFilter('') }}>Clear filters</button>}</div>}
          </section>
          <p className="page-footnote">Amounts remain in their original currencies. Match a M-Pesa expense to a receipt with the same KES amount to prevent double counting. Matches can be removed at any time.</p>
        </div>}

        {activePage === 'inventory' && <div className="page-content inventory-page">
          <section className="page-heading"><div><span className="section-kicker">STOCK · SALES · COST OF GOODS</span><h1>Inventory</h1><p>Track stock and record item sales. Numora calculates cost of goods sold using weighted-average cost.</p></div><span className="privacy-pill"><NavIcon name="box" /> Stored on this device</span></section>
          <div className="inventory-period"><span>Gross profit period</span><strong>{ledgerReport ? `${ledgerReport.from} – ${ledgerReport.to}` : 'Selected reporting period'}</strong><div className="period-switch" role="group" aria-label="Inventory reporting period"><button type="button" className={reportPeriod === 'this-month' ? 'is-active' : ''} aria-pressed={reportPeriod === 'this-month'} onClick={() => { setReportPeriod('this-month'); void refreshLedgerReport('this-month'); void refreshInventory('this-month') }}>This month</button><button type="button" className={reportPeriod === 'last-month' ? 'is-active' : ''} aria-pressed={reportPeriod === 'last-month'} onClick={() => { setReportPeriod('last-month'); void refreshLedgerReport('last-month'); void refreshInventory('last-month') }}>Last month</button></div></div>
          {inventoryError && <p className="error-message" role="alert">{inventoryError}</p>}{inventoryNotice && <p className="success-message" role="status">{inventoryNotice}</p>}
          {inventoryReport.length ? <section className="inventory-summary-grid">{inventoryReport.map((summary) => <article className="content-card inventory-summary-card" key={summary.currency}><span>{summary.currency} · INVENTORY SALES</span><strong>{summary.sales}</strong><div><span>Cost of goods sold</span><b>{summary.costOfGoodsSold}</b></div><div className="inventory-profit"><span>Gross profit</span><b>{summary.grossProfit}</b></div></article>)}</section> : <section className="content-card inventory-empty-summary"><span className="section-kicker">NO INVENTORY SALES IN THIS PERIOD</span><p>Record item sales below to calculate gross sales, cost of goods sold, and gross profit.</p></section>}
          <section className="content-card receipt-stock-card"><div className="content-card-heading"><div><span className="section-kicker">REVIEWED RECEIPT SOURCE</span><h2>Receive stock from a saved receipt</h2></div></div><p className="inventory-help">Choose the printed receipt line and confirm its quantity. Numora uses the line total to calculate unit cost and prevents the same line from being received twice.</p>
            {saved.some((receipt) => receipt.items?.length) ? <form className="receipt-stock-form" onSubmit={(event) => void receiveStockFromReceipt(event)}>
              <label>Saved receipt<select value={stockReceiptId} onChange={(event) => { const receipt = saved.find((entry) => entry.id === event.target.value); setStockReceiptId(event.target.value); setStockReceiptLineIndex(''); setStockReceiptItemId(''); setStockReceiptDate(receipt?.date || localDateString()) }} required><option value="">Choose a receipt</option>{saved.filter((receipt) => receipt.items?.length).map((receipt) => <option value={receipt.id} key={receipt.id}>{receipt.merchant} · {receipt.date || 'No date'} · {receipt.currency} {receipt.amount}</option>)}</select></label>
              <label>Receipt line<select value={stockReceiptLineIndex} onChange={(event) => setStockReceiptLineIndex(event.target.value)} required disabled={!stockSourceReceipt}><option value="">Choose a line</option>{stockSourceLines.map((line, index) => { const alreadyReceived = inventoryMovements.some((movement) => movement.sourceReceiptId === stockReceiptId && movement.sourceItemIndex === index); return <option value={index} key={`${index}-${line.description}`} disabled={alreadyReceived}>{line.description} · {stockSourceReceipt?.currency} {line.amount}{alreadyReceived ? ' · already received' : ''}</option> })}</select></label>
              <label>Inventory item<select value={stockReceiptItemId} onChange={(event) => setStockReceiptItemId(event.target.value)} required disabled={!stockSourceReceipt || !stockSourceInventoryItems.length}><option value="">Choose a matching currency item</option>{stockSourceInventoryItems.map((item) => <option value={item.id} key={item.id}>{item.name} · {item.currency}</option>)}</select></label>
              <label>Quantity on receipt<input type="number" min="0.001" step="0.001" value={stockReceiptQuantity} onChange={(event) => setStockReceiptQuantity(event.target.value)} required /></label>
              <label>Purchase date<input type="date" value={stockReceiptDate} onChange={(event) => setStockReceiptDate(event.target.value)} required /></label>
              <button className="secondary-action" type="submit" disabled={!serverReady || isSavingInventory || !stockReceiptId || stockReceiptLineIndex === '' || !stockReceiptItemId}>{isSavingInventory ? 'Saving locally…' : 'Confirm stock from receipt'}</button>
              {stockSourceReceipt && !stockSourceInventoryItems.length && <p className="inline-empty">Create an inventory item in {stockSourceReceipt.currency} before receiving this receipt line.</p>}
            </form> : <div className="inline-empty">Save a receipt with line items first. Its lines will appear here for reviewed stock receiving.</div>}
          </section>
          <section className="inventory-workbench">
            <article className="content-card inventory-form-card"><div className="content-card-heading"><div><span className="section-kicker">STOCK MOVEMENT</span><h2>Receive stock or record a sale</h2></div></div><p className="inventory-help">Stock received updates your weighted-average unit cost. Sales reduce stock and calculate cost of goods sold from that average.</p>
              <form className="inventory-movement-form" onSubmit={(event) => void saveInventoryMovement(event)}>
                <label>Movement<select value={inventoryAction} onChange={(event) => setInventoryAction(event.target.value as 'stock-in' | 'sale')}><option value="stock-in">Receive stock</option><option value="sale">Record a sale</option></select></label>
                <label>Inventory item<select value={inventoryItemId} onChange={(event) => setInventoryItemId(event.target.value)} required disabled={!inventoryItems.length}><option value="">Choose an item</option>{inventoryItems.map((item) => <option value={item.id} key={item.id}>{item.name} · {item.quantityOnHand} {item.unit}</option>)}</select></label>
                <label>Quantity<input type="number" min="0.001" step="0.001" value={inventoryQuantity} onChange={(event) => setInventoryQuantity(event.target.value)} placeholder="e.g. 5" required /></label>
                <label>{inventoryAction === 'stock-in' ? 'Unit cost' : 'Sale price'} ({inventoryItems.find((item) => item.id === inventoryItemId)?.currency || inventoryCurrency})<input type="number" min="0" step="0.01" value={inventoryUnitValue} onChange={(event) => setInventoryUnitValue(event.target.value)} placeholder="0.00" required /></label>
                <label>Date<input type="date" value={inventoryDate} onChange={(event) => setInventoryDate(event.target.value)} required /></label>
                <label className="inventory-note-field">Note <span>Optional</span><input maxLength={240} value={inventoryNote} onChange={(event) => setInventoryNote(event.target.value)} placeholder="Supplier, customer, or short reference" /></label>
                <button className="primary-button" type="submit" disabled={!serverReady || isSavingInventory || !inventoryItems.length}>{isSavingInventory ? 'Saving locally…' : inventoryAction === 'stock-in' ? 'Save stock received' : 'Record item sale'}</button>
              </form>
            </article>
            <article className="content-card inventory-form-card"><div className="content-card-heading"><div><span className="section-kicker">ITEM CATALOGUE</span><h2>Add an inventory item</h2></div></div><p className="inventory-help">Start with items you buy and resell. Set the unit that matches how you count them.</p><form className="inventory-new-item-form" onSubmit={(event) => void createInventoryItem(event)}><label>Item name<input maxLength={120} value={inventoryName} onChange={(event) => setInventoryName(event.target.value)} placeholder="e.g. 2L cooking oil" required /></label><div><label>Unit<input maxLength={30} value={inventoryUnit} onChange={(event) => setInventoryUnit(event.target.value)} placeholder="piece, kg, litre" required /></label><label>Currency<select value={inventoryCurrency} onChange={(event) => setInventoryCurrency(event.target.value as 'KES' | 'USD')}><option value="KES">KES</option><option value="USD">USD</option></select></label></div><button className="secondary-action" type="submit" disabled={!serverReady || isSavingInventory}>{isSavingInventory ? 'Saving…' : 'Add item'}</button></form></article>
          </section>
          <section className="content-card inventory-catalogue"><div className="content-card-heading"><div><span className="section-kicker">LOCAL STOCK POSITION</span><h2>Items on hand</h2></div><span className="record-count">{inventoryItems.length} items</span></div>{inventoryItems.length ? <div className="transaction-table-wrap"><table className="transaction-table"><thead><tr><th>Item</th><th>On hand</th><th>Average unit cost</th><th>Currency</th></tr></thead><tbody>{inventoryItems.map((item) => <tr key={item.id}><td><strong>{item.name}</strong></td><td>{item.quantityOnHand} {item.unit}</td><td>{item.averageUnitCost}</td><td>{item.currency}</td></tr>)}</tbody></table></div> : <div className="empty-state"><span className="empty-icon"><NavIcon name="box" /></span><strong>Your inventory starts with an item</strong><p>Add an item above, then record stock received and sales to see the remaining quantity and cost.</p></div>}</section>
          <section className="content-card inventory-catalogue"><div className="content-card-heading"><div><span className="section-kicker">INVENTORY ACTIVITY</span><h2>Recent stock movements</h2></div></div>{inventoryMovements.length ? <div className="transaction-table-wrap"><table className="transaction-table"><thead><tr><th>Date</th><th>Item</th><th>Movement</th><th>Quantity</th><th>Unit value</th><th className="amount-column">Total / gross profit</th><th>M-Pesa match</th></tr></thead><tbody>{inventoryMovements.slice(0, 12).map((movement) => {
            const candidates = movement.type === 'sale' && movement.currency === 'KES'
              ? savedMpesa.filter((transaction) => transaction.ledgerRole === 'income'
                && transaction.amount === movement.revenue
                && (!inventoryMovements.some((other) => other.id !== movement.id && other.matchedMpesaId === transaction.id) || movement.matchedMpesaId === transaction.id))
              : []
            return <tr key={movement.id}><td>{movement.date}</td><td><strong>{movement.itemName}</strong><small>{movement.note || '—'}</small></td><td>{movement.type === 'sale' ? 'Sale' : 'Stock received'}</td><td>{movement.quantity}</td><td>{movement.currency} {movement.type === 'sale' ? movement.unitPrice : movement.unitCost}</td><td className="amount-column"><strong>{movement.type === 'sale' ? `${movement.currency} ${movement.grossProfit} gross profit` : `${movement.currency} ${movement.totalCost} cost`}</strong><small>{movement.type === 'sale' ? `COGS ${movement.currency} ${movement.costOfGoodsSold}` : 'Inventory cost added'}</small></td><td>{movement.type === 'sale' ? <select className="receipt-match-select" aria-label={`Match inventory sale ${movement.itemName} to M-Pesa income`} value={movement.matchedMpesaId || ''} onChange={(event) => void updateInventorySaleMatch(movement.id, event.target.value)} disabled={isSavingInventory}><option value="">{candidates.length ? 'No payment match' : movement.matchedMpesaId ? 'Matched payment unavailable' : 'No exact KES match'}</option>{candidates.map((transaction) => <option value={transaction.id} key={transaction.id}>{transaction.counterparty} · {transaction.date || 'No date'} · {transaction.transactionId} · KES {transaction.amount}</option>)}</select> : movement.sourceReceiptId ? <span className="matched-label">Receipt line linked</span> : '—'}</td></tr>
          })}</tbody></table></div> : <div className="empty-state"><span className="empty-icon"><NavIcon name="chart" /></span><strong>No stock movements yet</strong><p>Stock receipts and sales you record will be listed here.</p></div>}</section>
          <p className="page-footnote">Sale matches require the same KES currency and exact amount, and each M-Pesa entry can match only one inventory sale. The Reports page uses these links to avoid counting a matched sale twice in its profit estimate.</p>
        </div>}

        {activePage === 'reports' && <div className="page-content reports-page">
          <section className="page-heading"><div><span className="section-kicker">YOUR SAVED LEDGER · LOCAL CALCULATIONS</span><h1>Reports</h1><p>See where money goes and how spending changes over time.</p></div><div className="report-heading-actions"><label className="report-currency-select">Currency<select value={activeReportCurrency} onChange={(event) => setReportCurrency(event.target.value)}>{reportCurrencyOptions.map((currency) => <option key={currency} value={currency}>{currency}</option>)}</select></label><button type="button" className="secondary-action" onClick={() => void exportReportsCsv()} disabled={!saved.length && !savedMpesa.length && !savedManualIncome.length}>Export CSV</button><button type="button" className="secondary-action" onClick={() => { downloadReportPdf(buildReportExportModel()); setExportMessage(`Downloaded PDF report for ${reportsFrom} to ${reportsTo}.`) }} disabled={!saved.length && !savedMpesa.length && !savedManualIncome.length && !inventoryMovements.length}>Export PDF</button><button type="button" className="secondary-action" onClick={() => { downloadReportDocx(buildReportExportModel()); setExportMessage(`Downloaded Word report for ${reportsFrom} to ${reportsTo}.`) }} disabled={!saved.length && !savedMpesa.length && !savedManualIncome.length && !inventoryMovements.length}>Export Word</button></div></section>
          <section className="content-card report-controls" aria-label="Choose reporting period">
            <div className="report-preset-switch" role="group" aria-label="Quick report periods">{([['this-month', 'This month'], ['last-month', 'Last month'], ['3-months', '3M'], ['6-months', '6M'], ['year', 'Year'], ['all', 'All'], ['custom', 'Custom']] as const).map(([preset, label]) => <button type="button" key={preset} className={reportsPreset === preset ? 'is-active' : ''} aria-pressed={reportsPreset === preset} onClick={() => chooseReportsPreset(preset)}>{label}</button>)}</div>
            <div className="report-date-controls"><label>From<input type="date" value={reportsFrom} onChange={(event) => { setReportsPreset('custom'); setReportsFrom(event.target.value) }} /></label><span>to</span><label>To<input type="date" value={reportsTo} onChange={(event) => { setReportsPreset('custom'); setReportsTo(event.target.value) }} /></label><button type="button" className="secondary-action" onClick={() => void loadReportsRange()} disabled={reportsLoading || !reportsFrom || !reportsTo || reportsFrom > reportsTo}>{reportsLoading ? 'Updating…' : 'Apply'}</button></div>
          </section>
          {reportError && <p className="error-message" role="alert">{reportError}</p>}
          <section className="report-summary-cards" aria-label="Period totals"><article className="content-card report-summary-card"><span>Income</span><strong>{reportMoney(currentReportIncomeCents)}</strong></article><article className="content-card report-summary-card"><span>Expenses</span><strong>{reportMoney(currentReportExpenseCents)}</strong></article><article className="content-card report-summary-card"><span>Net · income minus expenses</span><strong className={currentReportIncomeCents - currentReportExpenseCents >= 0 ? 'is-positive' : 'is-negative'}>{reportMoney(currentReportIncomeCents - currentReportExpenseCents)}</strong></article></section>
          <section className="report-visual-grid">
            <article className="content-card report-chart-card"><div className="report-chart-heading"><div><h2>Spending over time</h2><p>Income and expenses · {reportsFrom} to {reportsTo}</p></div><div className="report-granularity" role="group" aria-label="Chart grouping"><button type="button" className={reportGrouping === 'weekly' ? 'is-active' : ''} aria-pressed={reportGrouping === 'weekly'} onClick={() => setReportGrouping('weekly')}>Weekly</button><button type="button" className={reportGrouping === 'monthly' ? 'is-active' : ''} aria-pressed={reportGrouping === 'monthly'} onClick={() => setReportGrouping('monthly')}>Monthly</button></div></div>
              <div className="report-chart-legend"><span><i className="income-dot" />Income</span><span><i className="expense-dot" />Expenses</span></div>
              {reportSeries.some((bucket) => bucket.expenses || bucket.income) ? <div className="report-chart-scroll"><svg className="report-bar-chart" role="img" aria-label={`${reportGrouping === 'weekly' ? 'Weekly' : 'Monthly'} income and expense totals in ${activeReportCurrency}`} viewBox={`0 0 ${Math.max(360, reportSeries.length * 76)} 178`} width={Math.max(360, reportSeries.length * 76)}>
                <line x1="0" y1="126" x2={Math.max(360, reportSeries.length * 76)} y2="126" />
                {reportSeries.map((bucket) => { const x = bucket.index * 76 + 8; const expenseHeight = Math.max(bucket.expenses ? 3 : 0, Math.round((bucket.expenses / reportSeriesMax) * 94)); const incomeHeight = Math.max(bucket.income ? 3 : 0, Math.round((bucket.income / reportSeriesMax) * 94)); return <g key={`${bucket.from}-${bucket.to}`}><rect className="income-bar" x={x + 25} y={126 - incomeHeight} width="18" height={incomeHeight} rx="3"><title>{bucket.label}: income {reportMoney(bucket.income)}</title></rect><rect className="expense-bar" x={x + 47} y={126 - expenseHeight} width="18" height={expenseHeight} rx="3"><title>{bucket.label}: expenses {reportMoney(bucket.expenses)}</title></rect><text x={x + 39} y="150" textAnchor="middle">{bucket.label}</text></g>})}
              </svg></div> : <div className="report-chart-empty">No dated expense or income records in this period.</div>}
            </article>
            <article className="content-card report-chart-card report-category-card"><div className="report-chart-heading"><div><h2>Spending by category</h2><p>Expenses in the selected period</p></div></div>
              {reportCategoryTotals.length ? <div className="report-category-list">{reportCategoryTotals.map((entry, index) => <div className="report-category-row" key={entry.category}><div className="report-category-label"><span className={`report-category-dot tone-${index % 6}`} /><strong>{entry.category}</strong><span>{reportMoney(entry.amountCents)}</span><small>{currentReportExpenseCents ? Math.round(entry.amountCents / currentReportExpenseCents * 100) : 0}%</small></div><div className="report-category-track"><i className={`tone-${index % 6}`} style={{ width: `${Math.max(1, entry.amountCents / reportCategoryMax * 100)}%` }} /></div></div>)}</div> : <div className="report-chart-empty">No categorized spending in this period yet.</div>}
            </article>
          </section>
          <section className="content-card report-comparison"><div><span className="section-kicker">PERIOD COMPARISON</span><h2>Spending compared with the previous period</h2><p>{reportsFrom} – {reportsTo} compared with {previousPeriodFrom} – {previousPeriodTo}</p></div><div className="comparison-values"><div><span>Selected period</span><strong>{reportMoney(currentReportExpenseCents)}</strong></div><div><span>Previous period</span><strong>{reportMoney(previousReportExpenseCents)}</strong></div><div className={reportExpenseChange === null ? 'comparison-change' : reportExpenseChange > 0 ? 'comparison-change is-up' : 'comparison-change is-down'}><span>Change</span><strong>{reportExpenseChange === null ? '—' : `${reportExpenseChange > 0 ? '+' : ''}${reportExpenseChange.toFixed(1)}%`}</strong></div></div></section>
          {ledgerReport && <details className="content-card report-details"><summary>Profit, loans, and calculation details</summary><div className="report-metric-grid">{ledgerReport.totals.map((totals) => <article className="content-card report-currency" key={totals.currency}><div className="report-currency-heading"><span>{totals.currency}</span><small>Detailed ledger totals</small></div><div className="report-line"><span>Inventory sales</span><strong>{totals.inventorySales}</strong></div><div className="report-line"><span>Cost of goods sold</span><strong>{totals.costOfGoodsSold}</strong></div><div className="report-line"><span>Inventory gross profit</span><strong>{totals.grossProfit}</strong></div><div className="report-line report-net"><span>Recorded profit estimate</span><strong>{totals.businessProfit}</strong></div></article>)}</div><div className="report-extra-details"><article><h3>People who owe you</h3>{ledgerReport.receivables.length ? ledgerReport.receivables.map((debt) => <div className="receivable-row" key={debt.counterparty}><span>{debt.counterparty}</span><strong>{debt.currency} {debt.amount}</strong></div>) : <p>No open loan balances recorded.</p>}</article><article><h3>How to read these numbers</h3><p>Reports use saved, dated ledger entries. Matched M-Pesa payments are excluded from expense totals to avoid counting a receipt twice. Profit estimates use inventory sales and costs recorded in Numora. {ledgerReport.unclassifiedMpesaCount} unclassified M-Pesa entries and {ledgerReport.undatedCount} undated entries are excluded.</p></article></div></details>}
        </div>}

        {activePage === 'ask' && <div className="page-content ledger-chat-page">
          <section className="page-heading ask-page-heading"><div><span className="section-kicker">PRIVATE · ON THIS DEVICE</span><h1>Ask Numora</h1><p>Ask about your ledger, or share a useful preference or personal detail for Numora to remember locally.</p></div><div className="ask-page-actions"><button className="secondary-action" type="button" onClick={() => { setPersonalMemoryDraft(personalMemory.displayName); setPersonalMemoryFactDraft(''); setPersonalMemoryMessage(''); setShowPersonalMemory(true) }}>{personalMemory.displayName ? `Memory · ${personalMemory.displayName}` : `Personal memory${personalMemory.facts.length ? ` · ${personalMemory.facts.length}` : ''}`}</button><button className="primary-button heading-action" type="button" onClick={() => void createLedgerConversation()}><NavIcon name="plus" /> New chat</button></div></section>
          <div className={`ledger-chat-layout${chatHistoryCollapsed ? ' is-history-collapsed' : ''}${chatHistoryResizing ? ' is-resizing' : ''}`} style={{ '--chat-history-width': `${chatHistoryWidth}px` } as CSSProperties}>
            <aside id="ledger-chat-history" className="content-card ledger-chat-history" aria-label="Saved conversations" hidden={chatHistoryCollapsed}><div className="chat-history-heading"><strong>Conversations</strong><span>{ledgerConversations.length}</span></div>
              {ledgerChatsLoading ? <p className="chat-history-empty">Loading your saved chats…</p> : ledgerConversations.length ? <div className="chat-conversation-list">{ledgerConversations.map((chat) => <div className={`chat-conversation-row${chat.id === activeLedgerChatId ? ' is-active' : ''}`} key={chat.id}><button type="button" className="chat-conversation-select" onClick={() => { setActiveLedgerChatId(chat.id); setLedgerChatError('') }}><strong>{chat.title}</strong><small>{chat.messages.find((message) => message.role === 'user')?.content || 'New conversation'}</small><time>{new Date(chat.updatedAt).toLocaleDateString()}</time></button><button type="button" className="chat-delete-button" aria-label={`Delete ${chat.title}`} title="Delete conversation" disabled={ledgerChatDeletingId === chat.id} onClick={() => void deleteLedgerConversation(chat.id)}>×</button></div>)}</div> : <p className="chat-history-empty">Your saved conversations will appear here.</p>}
            </aside>
            <div className="chat-history-resize-handle" role="separator" aria-orientation="vertical" aria-label="Resize conversation history" aria-valuemin={200} aria-valuemax={420} aria-valuenow={chatHistoryWidth} aria-valuetext={`${chatHistoryWidth} pixels wide. Use left and right arrow keys to resize.`} tabIndex={chatHistoryCollapsed ? -1 : 0} hidden={chatHistoryCollapsed} onPointerDown={startChatHistoryResize} onPointerMove={moveChatHistoryResize} onPointerUp={finishChatHistoryResize} onPointerCancel={finishChatHistoryResize} onKeyDown={handleChatHistoryResizeKey}><span /></div>
            <section className="content-card ledger-chat-panel" aria-label="Chat with Numora">
              <header className="ledger-chat-panel-heading"><div className="chat-panel-title"><button type="button" className="chat-history-toggle" aria-controls="ledger-chat-history" aria-expanded={!chatHistoryCollapsed} onClick={() => setChatHistoryCollapsed((collapsed) => !collapsed)} title={chatHistoryCollapsed ? 'Show saved conversations' : 'Hide saved conversations'}><NavIcon name="sidebar" /><span>{chatHistoryCollapsed ? 'Show history' : 'Hide history'}</span></button><div className="chat-panel-heading-copy"><h2>{activeLedgerConversation?.title || 'New conversation'}</h2><p>Chat runs locally. Ledger answers use your saved records.</p></div></div><span className="chat-local-pill"><i /> Local</span></header>
              <div className="ledger-chat-messages" ref={ledgerChatMessagesRef} aria-live="polite">
                {activeLedgerConversation?.messages.length ? activeLedgerConversation.messages.map((message) => {
                  const streaming = ledgerStreamingAnswer?.conversationId === activeLedgerChatId && ledgerStreamingAnswer.messageId === message.id
                  const messageContent = streaming ? ledgerStreamingAnswer?.text || '' : message.content
                  return <article className={`ledger-chat-message is-${message.role}${streaming ? ' is-streaming' : ''}`} key={message.id}><span className="ledger-message-avatar">{message.role === 'user' ? 'Y' : <NavIcon name="sparkle" />}</span><div className="ledger-message-body"><strong>{message.role === 'user' ? 'You' : 'Numora'}</strong><p>{messageContent}{streaming && <span className="ledger-stream-caret" aria-hidden="true" />}</p>{message.role === 'user' ? <div className="ledger-user-message-tools"><time dateTime={message.createdAt} title={new Date(message.createdAt).toLocaleString()}>{new Date(message.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</time><button type="button" aria-label={copiedChatMessageId === message.id ? 'Message copied' : 'Copy your message'} onClick={() => void copyLedgerChatMessage(message.id, message.content)}>{copiedChatMessageId === message.id ? 'Copied' : <><NavIcon name="copy" /> Copy</>}</button></div> : <><small>{chatMessageAttribution(message)}</small>{message.sources?.length ? <small className="ledger-message-sources">Sources: {message.sources.join(" · ")}</small> : null}</>}</div></article>
                }) : !ledgerChatsLoading && <div className="ledger-chat-welcome"><span className="assistant-emblem"><NavIcon name="sparkle" /></span><h2>What would you like to know?</h2><p>Answers are calculated from your saved ledger. Estimates need enough dated expense history.</p><div className="ledger-chat-suggestions"><button type="button" onClick={() => setLedgerChatDraft('How much did I spend last month?')}>How much did I spend last month?</button><button type="button" onClick={() => setLedgerChatDraft('What might I spend next month?')}>Estimate next month’s spending</button><button type="button" onClick={() => setLedgerChatDraft('Show my spending by category this month')}>Show my spending by category</button><button type="button" onClick={() => setLedgerChatDraft('Who owes me?')}>Who owes me?</button></div></div>}
                {ledgerChatSending && ledgerSendingConversationId === activeLedgerChatId && <>{ledgerStreamingAnswer?.conversationId !== activeLedgerChatId && <article className="ledger-chat-message is-user is-pending"><span className="ledger-message-avatar">Y</span><div className="ledger-message-body"><strong>You</strong><p>{ledgerSendingQuestion}</p></div></article>}{ledgerStreamingAnswer?.conversationId !== activeLedgerChatId && <article className="ledger-chat-message is-assistant is-pending" role="status" aria-live="polite"><span className="ledger-message-avatar"><NavIcon name="sparkle" /></span><div className="ledger-message-body"><strong>Numora <span className="thinking-label">is working</span></strong><p className="thinking-copy">{isConversationalChatPrompt(ledgerSendingQuestion) ? 'Starting the local chat model and preparing a reply' : isSpendingForecastPrompt(ledgerSendingQuestion) ? 'Reviewing recent spending and estimating a range' : 'Interpreting your question and checking saved ledger records'}<span className="thinking-dots" aria-hidden="true"><i /><i /><i /></span></p><small>All processing stays on this device.</small></div></article>}</>}
              </div>
              {ledgerChatError && <p className="chat-error" role="alert">{ledgerChatError}</p>}
              <form className="ledger-chat-composer" onSubmit={(event) => void sendLedgerChatMessage(event)}><textarea aria-label="Message Numora about your ledger" rows={1} value={ledgerChatDraft} onChange={(event) => setLedgerChatDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit() } }} placeholder="Ask Numora anything about your ledger…" maxLength={500} disabled={!serverReady || ledgerChatSending} /><div className="ledger-chat-composer-actions"><label className="chat-model-picker"><span>Model</span><select aria-label="Choose a chat model" value={chatModelChoice} onChange={(event) => setChatModelChoice(event.target.value)} disabled={!serverReady || ledgerChatSending}><option value="auto">Default{settingsChatModel === 'auto' ? ' · Automatic' : ` · ${startupModels.find((model) => model.id === settingsChatModel)?.name || 'Settings model'}`}</option>{availableChatModels.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}</select></label><span className="chat-composer-hint">Shift + Enter for a new line</span><button className="primary-button" type="submit" aria-label={!ledgerChatSending ? 'Send message' : ledgerStreamingAnswer?.conversationId === activeLedgerChatId ? 'Numora is writing a reply' : 'Numora is checking your ledger'} disabled={!serverReady || ledgerChatSending || !ledgerChatDraft.trim()}>{ledgerChatSending ? <span className="send-thinking-dots" aria-hidden="true"><i /><i /><i /></span> : <>Send <NavIcon name="arrow" /></>}</button></div></form>
              <p className="ledger-chat-privacy"><NavIcon name="settings" /> Private on this device · Ledger answers use saved records.</p>
            </section>
          </div>
        </div>}

        {activePage === 'categories' && <div className="page-content categories-page">
        <section className="page-heading categories-heading"><div><span className="section-kicker">PERSONALISE YOUR LEDGER</span><h1>Categories</h1><p>Set a default category for a merchant. Numora will use it to suggest a category on future receipts.</p></div><span className="record-count">{categoryRules.length} {categoryRules.length === 1 ? 'merchant rule' : 'merchant rules'}</span></section>
        <section className="content-card category-rules" aria-labelledby="rules-title">
          <div className="content-card-heading"><div><h2 id="rules-title">Merchant rules</h2><p>Rules are saved on this device and do not change receipts you already reviewed.</p></div></div>
          <form className="rule-form" onSubmit={saveCategoryRule}>
            <label>Merchant<input value={ruleMerchant} onChange={(event) => { setRuleMerchant(event.target.value); setRuleMessage('') }} maxLength={160} placeholder="e.g. The Daily Grind" required /></label>
            <label>Category<select value={ruleCategory} onChange={(event) => setRuleCategory(event.target.value)}>{CATEGORIES.filter((category) => category !== 'Uncategorised').map((category) => <option key={category}>{category}</option>)}</select></label>
            <button className="add-item-button" type="submit" disabled={isSavingRule || !serverReady}>{isSavingRule ? 'Saving…' : 'Save rule'}</button>
          </form>
          {ruleMessage && <p className="rule-message" role="status">{ruleMessage}</p>}
          {categoryRules.length > 0 ? <div className="rule-list">{categoryRules.map((rule) => <div className="rule-row" key={rule.merchant}><div><strong>{rule.merchant}</strong><span>{rule.category}</span></div><button type="button" onClick={() => { setRuleMerchant(rule.merchant); setRuleCategory(rule.category); setRuleMessage('') }}>Edit</button><button type="button" className="remove-item-button" onClick={() => void removeCategoryRule(rule.merchant)}>Remove</button></div>)}</div> : <p className="no-line-items">No merchant rules yet. Add a merchant above and choose the category Numora should suggest next time.</p>}
        </section></div>}

        {activePage === 'settings' && <div className="page-content settings-page">
          <section className="page-heading"><div><span className="section-kicker">YOUR WORKSPACE</span><h1>Settings</h1><p>Choose where your records live and which local models Numora uses.</p></div></section>
          <div className="settings-grid">
            <section className="content-card settings-card">
              <div className="settings-card-title"><span className="settings-icon"><NavIcon name="settings" /></span><div><span className="section-kicker">PREFERENCES</span><h2>Workspace defaults</h2></div></div>
              <p>Set the fallback currency, opening page, and default local models.</p>
              <form className="preferences-form" onSubmit={(event) => void saveWorkspacePreferences(event)}>
                <label>Default currency<select value={settingsCurrency} onChange={(event) => setSettingsCurrency(event.target.value as 'KES' | 'USD')}><option value="KES">KES · Kenyan shilling</option><option value="USD">USD · US dollar</option></select></label>
                <label>Start page<select value={settingsStartPage} onChange={(event) => setSettingsStartPage(event.target.value as 'dashboard' | 'receipts')}><option value="dashboard">Dashboard</option><option value="receipts">Receipts</option></select></label>
                <label>Default chat model<select value={settingsChatModel} onChange={(event) => setSettingsChatModel(event.target.value)}><option value="auto">Automatic · recommended for this device</option>{availableChatModels.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}</select></label>
                <label>Receipt interpretation model<select value={settingsInterpretationModel} onChange={(event) => setSettingsInterpretationModel(event.target.value)}><option value="auto">Automatic · use the best installed model</option>{availableChatModels.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}</select></label>
                <label>Default receipt OCR<select value={settingsOcrModel} onChange={(event) => setSettingsOcrModel(event.target.value as 'auto' | 'easyocr' | 'lightonocr3')}><option value="auto">Automatic · fast scan, deeper retry when needed</option><option value="easyocr" disabled={!installedModel('easyocr')}>QVAC EasyOCR Latin{installedModel('easyocr') ? '' : ' · download first'}</option><option value="lightonocr3" disabled={!installedModel('lightonocr3')}>LightOnOCR-3{installedModel('lightonocr3') ? '' : ' · download first'}</option></select></label>
                <button className="add-item-button" type="submit" disabled={settingsSaving || !serverReady}>{settingsSaving ? 'Saving…' : 'Save defaults'}</button>
              </form>
              <div className="appearance-setting">
                <div className="appearance-setting-copy"><strong>Appearance</strong><small>Choose a comfortable look for every Numora page.</small></div>
                <div className="appearance-switch" role="group" aria-label="Choose light or dark appearance">
                  <button type="button" className={appearance === 'light' ? 'is-active' : ''} aria-pressed={appearance === 'light'} onClick={() => setAppearance('light')}>
                    <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="3.4" /><path d="M10 1.8v2m0 12.4v2M1.8 10h2m12.4 0h2M4.2 4.2l1.4 1.4m8.8 8.8 1.4 1.4m0-11.6-1.4 1.4m-8.8 8.8-1.4 1.4" /></svg>
                    <span>Light</span>
                  </button>
                  <button type="button" className={appearance === 'dark' ? 'is-active' : ''} aria-pressed={appearance === 'dark'} onClick={() => setAppearance('dark')}>
                    <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M16.8 12.4A7.2 7.2 0 0 1 7.6 3.2a7.3 7.3 0 1 0 9.2 9.2Z" /></svg>
                    <span>Dark</span>
                  </button>
                </div>
              </div>
              {settingsSavedMessage && <p className="rule-message" role="status">{settingsSavedMessage}</p>}
            </section>

            <section className="content-card settings-card settings-privacy-card">
              <div className="settings-card-title"><span className="settings-icon"><NavIcon name="receipt" /></span><div><span className="section-kicker">PRIVATE STORAGE</span><h2>Workspace folder</h2></div></div>
              <p>Move your ledger to a folder with enough space. Numora copies the current workspace and keeps the old folder as a backup. This path is saved in your Windows user settings, so it stays separate from the app’s install folder.</p>
              <form className="storage-folder-form" onSubmit={(event) => void changeStorageDirectory(event)}>
                <label>Current folder<div className="storage-folder-input-row"><input value={storageDirectoryDraft} onChange={(event) => { setStorageDirectoryDraft(event.target.value); setStorageChangeMessage('') }} placeholder="C:\\Users\\you\\Documents\\Numora" spellCheck={false} required />{window.numoraDesktop?.selectWorkspaceDirectory && <button className="secondary-button" type="button" onClick={() => void chooseStorageDirectory()} disabled={storageChangeBusy}>Browse…</button>}</div></label>
                <button className="add-item-button" type="submit" disabled={!serverReady || storageChangeBusy || !storageDirectoryDraft.trim() || storageDirectoryDraft === storageDirectory}>{storageChangeBusy ? 'Copying workspace…' : 'Copy workspace to folder'}</button>
              </form>
              {storageChangeMessage && <p className="rule-message" role="status">{storageChangeMessage}</p>}
              <div className="settings-callout"><NavIcon name="settings" /><span>Receipt images, saved entries, chat history, personal memory, reports, and merchant rules are copied together. The previous folder is not deleted.</span></div>
            </section>

            <section className="content-card settings-card settings-models-card">
              <div className="settings-card-title"><span className="settings-icon"><NavIcon name="sparkle" /></span><div><span className="section-kicker">LOCAL AI LIBRARY</span><h2>Models</h2></div><span className={'settings-status-pill' + (serverReady ? ' is-ready' : '')}><i />{serverReady ? 'On this device' : 'Service offline'}</span></div>
              <p>Choose a task to see compatible models. Downloads are optional, stay on this device, and show their progress below.</p>
              <div className="model-library-toolbar"><span>{startupModels.filter((model) => model.id !== 'rag-embedding').length} supported models</span><button type="button" className="secondary-button" onClick={() => void browseModelLibrary()} disabled={!serverReady || modelBrowseBusy || modelDownload.status === 'downloading'}>{modelBrowseBusy ? 'Searching QVAC…' : 'Browse QVAC chat models'}</button></div>
              {modelBrowseBusy && <p className="model-library-note" role="status">Starting the local QVAC worker and checking the model library. Its first start can take up to 90 seconds; internet is used for browsing and downloads only.</p>}
              {modelDownload.status === 'downloading' && <div className="model-download-progress" role="status"><div><strong>{modelDownload.stage || 'Downloading model'}</strong><span>{modelDownload.progress}%{modelDownload.total ? ` · ${formatModelSize(modelDownload.downloaded)} of ${formatModelSize(modelDownload.total)}` : ''}</span></div><progress max={100} value={modelDownload.progress} /><button type="button" className="remove-item-button" onClick={() => void cancelModelDownload()}>Cancel</button></div>}
              <div className="model-library-list">{startupModels.filter((model) => model.id !== 'rag-embedding').map((model) => <article className="model-library-item" key={model.id}><div className="model-library-copy"><strong>{model.name}</strong><span>{model.role}{model.bytes ? ` · ${formatModelSize(model.bytes)}` : ''}</span><p>{model.description || (model.role.includes('OCR') ? 'Receipt image text recognition.' : 'Local model available for Numora chat and receipt interpretation.')}</p></div><div className="model-library-action">{model.installed ? <span className="model-installed-badge"><i />Installed</span> : <button type="button" className="add-item-button" onClick={() => void startModelDownload(model.id)} disabled={!serverReady || modelManagerBusy || modelDownload.status === 'downloading' || !model.bytes}>{modelManagerBusy && modelDownload.modelId === model.id ? 'Starting…' : `Download · ${model.bytes ? formatModelSize(model.bytes) : 'Unavailable'}`}</button>}</div></article>)}</div>
              {modelManagerMessage && <p className="rule-message" role="status">{modelManagerMessage}</p>}
              {modelDownload.status === 'error' && modelDownload.error && <p className="settings-error" role="alert">{modelDownload.error}</p>}
              <form className="local-model-form" onSubmit={(event) => void addLocalChatModel(event)}><label>Add a local chat model path<input value={localModelPath} onChange={(event) => setLocalModelPath(event.target.value)} placeholder="C:\\Models\\assistant.gguf" spellCheck={false} /></label><button type="submit" className="secondary-button" disabled={!serverReady || modelManagerBusy || !localModelPath.trim()}>Load local GGUF</button><small>Use the full path to a GGUF chat model file. Numora checks the file and adds it to the chat model menu.</small></form>
              <div className="settings-callout"><NavIcon name="settings" /><span>Models use the Windows Local AppData folder rather than the install directory. Your configured receipt OCR and chat models are prepared one at a time during startup when installed. Downloads remain optional and are never automatic; active engines are swapped as needed to protect available memory.</span></div>
            </section>

            <section className="content-card settings-card settings-ai-card">
              <div className="settings-card-title"><span className="settings-icon"><NavIcon name="chat" /></span><div><span className="section-kicker">APP KNOWLEDGE</span><h2>Ask Numora search</h2></div></div>
              <p>Build a small local index so chat can find app help and details from saved records. Exact financial totals still come from ledger calculations.</p>
              <div className="settings-rag-panel"><div><strong>Knowledge search</strong><span>{ragStatus?.setup.status === 'ready' ? 'Ready · ' + ragStatus.indexedChunks + ' local passages' : ragStatus?.setup.status === 'downloading' || ragStatus?.setup.status === 'indexing' ? ragStatus.setup.stage + (ragStatus.setup.status === 'downloading' ? ' · ' + ragStatus.setup.progress + '%' : '') : ragStatus?.modelInstalled ? ragStatus.indexedChunks + ' passages indexed' : 'Not set up yet'}</span></div>
                <p>Embeddings run on CPU and are not needed for spending arithmetic.</p><button className="add-item-button" type="button" onClick={() => void setupLocalKnowledge()} disabled={!serverReady || ragSetupBusy}>{ragSetupBusy ? ragStatus?.setup.stage || 'Setting up…' : ragStatus?.setup.status === 'ready' ? 'Refresh local index' : ragStatus?.modelInstalled ? 'Build local index' : 'Set up knowledge search'}</button>{ragStatus?.setup.status === 'error' && <p className="settings-error" role="alert">{ragStatus.setup.error}</p>}</div>
            </section>
          </div>
        </div>}
      </main>

      {selectedTransaction && <div className="transaction-detail-backdrop" onClick={(event) => { if (event.target === event.currentTarget) setSelectedTransaction(null) }}>
        <section className="transaction-detail-dialog" role="dialog" aria-modal="true" aria-labelledby="transaction-detail-title">
          <div className="transaction-detail-heading"><div><span className="section-kicker">TRANSACTION DETAILS</span><h2 id="transaction-detail-title">{selectedTransaction.kind === 'receipt' ? selectedTransaction.entry.merchant || 'Receipt' : selectedTransaction.kind === 'income' ? selectedTransaction.entry.counterparty || 'Income' : selectedTransaction.entry.counterparty || selectedTransaction.entry.transactionType.replaceAll('_', ' ')}</h2></div><button type="button" className="transaction-detail-close" autoFocus onClick={() => setSelectedTransaction(null)} aria-label="Close transaction details">×</button></div>
          <div className="transaction-detail-summary"><strong>{selectedTransaction.kind === 'income' ? '+' : ''}{selectedTransaction.kind === 'mpesa' ? 'KES' : selectedTransaction.entry.currency} {selectedTransaction.entry.amount}</strong><span>{selectedTransaction.kind === 'receipt' ? selectedTransaction.entry.category : selectedTransaction.kind === 'income' ? selectedTransaction.entry.category : selectedTransaction.entry.ledgerRole.replaceAll('_', ' ')}</span></div>
          <dl className="transaction-detail-meta">
            <div><dt>Date</dt><dd>{selectedTransaction.entry.date || 'No date saved'}</dd></div>
            <div><dt>{selectedTransaction.kind === 'mpesa' ? 'Type' : 'Payment method'}</dt><dd>{selectedTransaction.kind === 'mpesa' ? selectedTransaction.entry.transactionType.replaceAll('_', ' ') : selectedTransaction.entry.paymentMethod}</dd></div>
            {selectedTransaction.kind === 'mpesa' && <div><dt>Reference</dt><dd>{selectedTransaction.entry.transactionId}</dd></div>}
          </dl>
          {selectedTransaction.kind === 'receipt' ? <section className="transaction-detail-items"><div className="transaction-detail-items-heading"><h3>Items on this receipt</h3><span>{selectedTransaction.entry.items?.length || 0}</span></div>{selectedTransaction.entry.items?.length ? <ul>{selectedTransaction.entry.items.map((item, index) => <li key={`${index}-${item.description}`}><span>{item.description || 'Unnamed item'}</span><strong>{selectedTransaction.entry.currency} {item.amount || '—'}</strong></li>)}</ul> : <p>No item details were saved for this transaction.</p>}</section> : selectedTransaction.kind === 'income' ? <p className="transaction-detail-notes">{selectedTransaction.entry.notes || 'No additional details were saved.'}</p> : <details className="transaction-detail-source"><summary>Original M-Pesa message</summary><p>{selectedTransaction.entry.sourceMessage || 'No source message was saved.'}</p></details>}
          {selectedTransaction.kind === 'receipt' && selectedTransaction.entry.notes && <p className="transaction-detail-notes">{selectedTransaction.entry.notes}</p>}
        </section>
      </div>}

      {showPersonalMemory && <div className="personal-memory-backdrop" onClick={(event) => { if (event.target === event.currentTarget) setShowPersonalMemory(false) }}>
        <section className="personal-memory-dialog" role="dialog" aria-modal="true" aria-labelledby="personal-memory-title">
          <div className="transaction-detail-heading"><div><span className="section-kicker">ASK NUMORA · PERSONAL MEMORY</span><h2 id="personal-memory-title">What should Numora remember?</h2></div><button type="button" className="transaction-detail-close" autoFocus onClick={() => setShowPersonalMemory(false)} aria-label="Close personal memory">×</button></div>
          <p className="personal-memory-description">Numora can remember useful details and preferences you share, then use them when relevant. You can say “Remember that I prefer short answers” in chat. These memories stay in this workspace on this device; they do not retrain the model.</p>
          <form onSubmit={(event) => void savePersonalMemory(event)}>
            <label>Name to remember<input autoComplete="name" maxLength={48} value={personalMemoryDraft} onChange={(event) => { setPersonalMemoryDraft(event.target.value); setPersonalMemoryMessage('') }} placeholder="e.g. Amina" /></label>
            <label>Useful detail or preference<input maxLength={240} value={personalMemoryFactDraft} onChange={(event) => { setPersonalMemoryFactDraft(event.target.value); setPersonalMemoryMessage('') }} placeholder="e.g. I run a grocery shop in Nairobi" /></label>
            <small>Numora can also pick up stable preferences or personal context you share naturally in chat. It does not save transaction details as personal memories.</small>
            {personalMemory.facts.length > 0 && <div className="personal-memory-list" aria-label="Saved memories">{personalMemory.facts.map((fact) => <div className="personal-memory-row" key={fact.key}><span>{fact.text}</span><button type="button" className="text-action" onClick={() => void removePersonalMemoryFact(fact.key)} disabled={personalMemorySaving} aria-label={`Forget memory: ${fact.text}`} title="Forget this memory">Forget</button></div>)}</div>}
            {personalMemoryMessage && <p className="personal-memory-feedback" role="status">{personalMemoryMessage}</p>}
            <div className="personal-memory-actions"><button type="button" className="text-action" onClick={() => void clearPersonalMemory()} disabled={personalMemorySaving || !personalMemory.displayName}>Forget saved name</button><button type="button" className="text-action" onClick={() => void clearAllPersonalMemory()} disabled={personalMemorySaving || (!personalMemory.displayName && !personalMemory.facts.length)}>Clear all</button><button type="button" className="secondary-action" onClick={() => setShowPersonalMemory(false)}>Close</button><button type="submit" className="primary-button" disabled={personalMemorySaving || (!personalMemoryDraft.trim() && !personalMemoryFactDraft.trim())}>{personalMemorySaving ? 'Saving…' : 'Save memory'}</button></div>
          </form>
        </section>
      </div>}

      <footer className={`footer${activePage === 'ask' ? ' footer-chat-hidden' : ''}`}><span>NUMORA <span className="footer-dot">·</span> PRIVATE PERSONAL LEDGER</span><span>Works offline <span className="footer-dot">·</span> Your money stays yours</span></footer>
      </div>
    </div>
  )
}

export default App
