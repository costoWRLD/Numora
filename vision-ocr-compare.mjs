import path from 'node:path'
import { homedir } from 'node:os'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const root = path.dirname(fileURLToPath(import.meta.url))
process.env.HOME = root
process.env.USERPROFILE = root
// QVAC's first Bare worker boot can be slow on this Windows laptop while it
// loads the native inference addons. Keep the longer timeout local to eval.
process.env.QVAC_RPC_INIT_TIMEOUT_MS = process.env.QVAC_RPC_INIT_TIMEOUT_MS || '120000'

const {
  completion,
  loadModel,
  unloadModel,
} = await import('@qvac/sdk')

const screenshotsDir = process.env.NUMORA_EVAL_IMAGES || path.join(homedir(), 'Pictures', 'Screenshots')
const outputDir = path.join(root, '.cache', 'ocr-eval', process.env.NUMORA_DEVICE === 'gpu' ? 'lightonocr-gpu' : 'lightonocr')
const qwenPath = path.join(root, '.qvac', 'models', 'Qwen2.5-3B-Instruct-Q4_K_M.gguf')
const lightOnOcrPath = path.join(root, '.qvac', 'models', 'LightOnOCR-2-1B-ocr-soup-Q4_K_M.gguf')
const projectorPath = path.join(root, '.qvac', 'models', 'mmproj-F16.gguf')
const receipts = [
  { file: 'Screenshot 2026-10-26 020558.png', merchant: 'OAKRIDGE HARDWARE & SUPPLY', date: '2026-10-24', subtotal: 156.16, tax: 13.74, total: 169.90 },
  { file: 'Screenshot 2026-10-26 020711.png', merchant: 'VALLEY PROVISIONS', date: '2026-10-24', subtotal: 31.70, tax: 2.66, total: 34.36 },
  { file: 'Screenshot 2026-10-26 020752.png', merchant: 'SUPER SAVE MART', date: '2026-10-24', subtotal: 65.94, tax: 4.90, total: 64.25 },
  { file: 'Screenshot 2026-10-26 020822.png', merchant: 'COMMUNITY CARE PHARMACY', date: '2026-04-18', subtotal: 33.47, tax: 1.03, total: 34.50 },
  { file: 'Screenshot 2026-10-26 020848.png', merchant: 'METRO MARKET', date: '2026-10-24', subtotal: 36.62, tax: 3.22, total: 39.84 },
  { file: 'Screenshot 2026-10-26 020931.png', merchant: 'EXPRESS GAS & MART', date: '2026-10-24', subtotal: 45.95, tax: 3.91, total: 49.86 },
]

const schema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    merchant: { type: 'string' },
    date: { type: 'string' },
    subtotal: { type: 'string' },
    tax: { type: 'string' },
    total: { type: 'string' },
    currency: { type: 'string' },
    paymentMethod: { type: 'string' },
    items: {
      type: 'array',
      maxItems: 80,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: { description: { type: 'string' }, amount: { type: 'string' } },
        required: ['description', 'amount'],
      },
    },
  },
  required: ['merchant', 'date', 'subtotal', 'tax', 'total', 'currency', 'paymentMethod', 'items'],
}

function parseJson(text) {
  try { return JSON.parse(text) } catch {
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start >= 0 && end > start) return JSON.parse(text.slice(start, end + 1))
    throw new Error('Qwen did not return JSON.')
  }
}

const extractionRules = [
  'Extract the receipt into the requested JSON fields using only the numbered OCR lines below.',
  'Do not guess, repair OCR, or calculate a missing amount. Return blank strings when a value is not readable.',
  'Include every charged purchase row as an item, including rows with only RX, SKU, or product codes. When a row has both a product code and a product description, use the product description. Use the code as the description only when no product name is printed. Exclude only subtotal, discount, tax, total, cash, change, savings, and loyalty rows.',
  'A line that contains only a quantity and unit price, such as 2 @ $1.50, is a continuation of the adjacent named product, not a separate item. Do not count the same total amount twice.',
  'Return the receipt date as ISO YYYY-MM-DD and omit the time. Remove quote marks used to show inches from item descriptions, for example write 3 in paint brush.',
  'Keep printed subtotal, tax, and final total distinct. If a receipt prints a grand total, use it as total.',
  'Choose a currency only when the text supports it. Return the product purchase amount only for each item.',
].join(' ')

let ocrModelId
let qwenModelId
const results = []
const evalReceipts = process.env.NUMORA_EVAL_FILE ? receipts.filter((receipt) => receipt.file === process.env.NUMORA_EVAL_FILE) : receipts
const qwenOnly = process.env.NUMORA_QWEN_ONLY === '1'
const useGpu = process.env.NUMORA_DEVICE === 'gpu'

try {
  await mkdir(outputDir, { recursive: true })
  if (!qwenOnly) {
    console.log(`Loading LightOnOCR Q4_K_M with its matching F16 projector. Output: ${outputDir}`)
    ocrModelId = await loadModel({
      modelSrc: lightOnOcrPath,
      modelType: 'llamacpp-completion',
      modelConfig: {
        ctx_size: 8192,
        predict: 4096,
        temp: 0.1,
        ...(useGpu ? { backend: ['vulkan'], gpu_layers: 4, 'main-gpu': 'integrated' } : { device: 'cpu', gpu_layers: 0 }),
        parallel: 1,
        projectionModelSrc: projectorPath,
      },
      onProgress: ({ percentage, downloaded, total }) => {
        if (Number.isFinite(percentage)) console.log(`LightOnOCR model download: ${percentage.toFixed(0)}% (${(downloaded / 1e6).toFixed(0)}/${(total / 1e6).toFixed(0)} MB)`)
      },
    })
  }

  if (!process.env.NUMORA_SKIP_QWEN) {
    console.log(`Loading the existing Qwen2.5-3B local model on ${useGpu ? 'Vulkan GPU (10 layers)' : 'CPU'} for the second-stage extraction.`)
    qwenModelId = await loadModel({
      modelSrc: qwenPath,
      modelType: 'llamacpp-completion',
      modelConfig: useGpu
        ? { ctx_size: 4096, predict: 1024, temp: 0.1, backend: ['vulkan'], gpu_layers: 10, 'main-gpu': 'integrated', parallel: 1 }
        : { ctx_size: 4096, predict: 1024, temp: 0.1, device: 'cpu', gpu_layers: 0, parallel: 1 },
    })
  }

  for (const [index, receipt] of evalReceipts.entries()) {
    const imagePath = path.join(screenshotsDir, receipt.file)
    console.log(`\n[${index + 1}/${receipts.length}] ${receipt.file}`)
    const textPath = path.join(outputDir, `${path.parse(receipt.file).name}.txt`)
    let rawText = ''
    let ocrMs = null
    try {
      rawText = await readFile(textPath, 'utf8')
      console.log(`Using cached OCR transcript (${rawText.length} characters).`)
    } catch {
      if (qwenOnly) throw new Error(`No cached LightOnOCR transcript found for ${receipt.file}.`)
      const started = performance.now()
      const ocrRun = completion({
        modelId: ocrModelId,
        // LightOnOCR-2 is trained for image-only OCR. Its model card's usage
        // example supplies the image without a text prompt.
        history: [{ role: 'user', content: '', attachments: [{ path: imagePath }] }],
        stream: false,
      })
      const ocrFinal = await ocrRun.final
      ocrMs = Math.round(performance.now() - started)
      rawText = String(ocrFinal.contentText || '').trim()
      console.log(`OCR finished in ${(ocrMs / 1000).toFixed(1)}s (${rawText.length} characters).`)
      await writeFile(textPath, rawText, 'utf8')
    }

    let extracted = null
    let qwenMs = null
    let qwenError = null
    let qwenRaw = ''
    if (qwenModelId && rawText) {
      const lines = rawText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, 120)
      const numbered = lines.map((line, lineIndex) => `${lineIndex + 1}. ${line.slice(0, 350)}`).join('\n')
      const qwenStarted = performance.now()
      try {
        const qwenRun = completion({
          modelId: qwenModelId,
          history: [{ role: 'user', content: `${extractionRules}\n\n${numbered}` }],
          stream: false,
          responseFormat: { type: 'json_schema', json_schema: { name: 'receipt_eval', schema, strict: true } },
        })
        const qwenFinal = await qwenRun.final
        qwenMs = Math.round(performance.now() - qwenStarted)
        qwenRaw = String(qwenFinal.contentText || '').trim()
        await writeFile(path.join(outputDir, `${path.parse(receipt.file).name}.qwen-raw.txt`), qwenRaw, 'utf8')
        extracted = parseJson(qwenRaw)
        console.log(`Qwen extraction finished in ${(qwenMs / 1000).toFixed(1)}s.`)
      } catch (error) {
        qwenMs = Math.round(performance.now() - qwenStarted)
        qwenError = String(error?.message || error)
        console.error(`Qwen extraction failed after ${(qwenMs / 1000).toFixed(1)}s: ${qwenError}`)
      }
    }

    const baselinePath = path.join(root, '.cache', 'ocr-eval', `${receipt.file}.result.json`)
    let baseline = null
    try { baseline = JSON.parse(await readFile(baselinePath, 'utf8')) } catch {}
    let priorEval = null
    try { priorEval = JSON.parse(await readFile(path.join(outputDir, `${path.parse(receipt.file).name}.json`), 'utf8')) } catch {}
    const result = {
      file: receipt.file,
      expected: { merchant: receipt.merchant, date: receipt.date, subtotal: receipt.subtotal, tax: receipt.tax, total: receipt.total },
      lightOnOcr: { rawText, elapsedMs: ocrMs ?? (qwenOnly ? priorEval?.lightOnOcr?.elapsedMs : null) },
      qwen: extracted ? { ...extracted, elapsedMs: qwenMs } : null,
      qwenRaw,
      qwenError,
      previousBaseline: baseline ? {
        merchant: baseline.fields?.merchant,
        date: baseline.fields?.date,
        amount: baseline.fields?.amount,
        items: baseline.items?.map(({ description, amount }) => ({ description, amount })),
        rawText: baseline.rawText,
        ocrMs: baseline.timings?.ocrMs,
        modelMs: baseline.timings?.modelMs,
      } : null,
    }
    results.push(result)
    await writeFile(path.join(outputDir, `${path.parse(receipt.file).name}.json`), JSON.stringify(result, null, 2), 'utf8')
  }
} finally {
  if (qwenModelId) await unloadModel({ modelId: qwenModelId, clearStorage: false }).catch((error) => console.error('Qwen unload failed:', error.message))
  if (ocrModelId) await unloadModel({ modelId: ocrModelId, clearStorage: false }).catch((error) => console.error('LightOnOCR unload failed:', error.message))
}

let finalResults = results
if (qwenOnly || evalReceipts.length < receipts.length) {
  try {
    const previous = JSON.parse(await readFile(path.join(outputDir, 'summary.json'), 'utf8'))
    finalResults = previous.map((item) => results.find((result) => result.file === item.file) || item)
  } catch {}
}
await writeFile(path.join(outputDir, 'summary.json'), JSON.stringify(finalResults, null, 2), 'utf8')
console.log(`\nSaved full comparison to ${path.join(outputDir, 'summary.json')}`)
