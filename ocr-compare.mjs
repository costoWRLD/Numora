import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(fileURLToPath(import.meta.url))
process.env.HOME = root
process.env.USERPROFILE = root
// QVAC can take longer than the SDK default to start its first native worker.
process.env.QVAC_RPC_INIT_TIMEOUT_MS = process.env.QVAC_RPC_INIT_TIMEOUT_MS || '120000'

const { loadModel, unloadModel, ocr, OCR_LATIN, OCR_DOCTR } = await import('@qvac/sdk')
const { mkdir, writeFile } = await import('node:fs/promises')
const [,, ...images] = process.argv

if (!images.length) {
  console.error('Usage: node .\\ocr-compare.mjs <receipt-image> [another-image]')
  process.exit(2)
}

const backendDevice = process.env.NUMORA_OCR_DEVICE || 'cpu'
const cases = [
  {
    name: `EasyOCR (${backendDevice}, no contrast retry)`,
    source: OCR_LATIN,
    config: { langList: ['en'], magRatio: 1.0, canvasSize: 1280, defaultRotationAngles: [], contrastRetry: false, lowConfidenceThreshold: 0.5, recognizerBatchSize: 1, backendDevice },
  },
  ...(process.env.NUMORA_COMPARE_ALL === '1' ? [
    {
      name: `EasyOCR (${backendDevice}, contrast retry)`,
      source: OCR_LATIN,
      config: { langList: ['en'], magRatio: 1.0, canvasSize: 1280, defaultRotationAngles: [], contrastRetry: true, lowConfidenceThreshold: 0.5, recognizerBatchSize: 1, backendDevice },
    },
    { name: `DocTR (${backendDevice})`, source: OCR_DOCTR, config: { pipelineType: 'doctr', backendDevice } },
  ] : []),
]
const report = []

for (const imagePath of images) {
  console.log(`\n\n========== IMAGE: ${path.resolve(imagePath)} ==========`)
  for (const testCase of cases) {
    let modelId
    let loadMs = null
    let inferenceMs = null
    try {
      console.log(`\n--- ${testCase.name} ---`)
      const loadStarted = performance.now()
      modelId = await loadModel({ modelSrc: testCase.source, modelConfig: testCase.config })
      loadMs = Math.round(performance.now() - loadStarted)
      console.log(`Model load: ${(loadMs / 1000).toFixed(1)}s`)
      const startedAt = Date.now()
      const result = ocr({ modelId, image: path.resolve(imagePath), options: { paragraph: false } })
      const blocks = await result.blocks
      inferenceMs = Date.now() - startedAt
      console.log(`Inference: ${(inferenceMs / 1000).toFixed(1)}s; blocks: ${blocks.length}`)
      const item = { image: path.resolve(imagePath), model: testCase.name, loadMs, inferenceMs, blockCount: blocks.length, blocks: blocks.map((block) => ({ text: block.text, confidence: block.confidence ?? null, bbox: block.bbox ?? null })) }
      report.push(item)
      for (const block of blocks) {
        const confidence = block.confidence === undefined ? '' : ` [${block.confidence.toFixed(2)}]`
        console.log(`${block.text}${confidence}`)
      }
    } catch (error) {
      report.push({ image: path.resolve(imagePath), model: testCase.name, loadMs, inferenceMs, error: String(error?.message || error) })
      console.error(`FAILED: ${error.stack || error}`)
    } finally {
      if (modelId) await unloadModel({ modelId, clearStorage: false }).catch((error) => console.error('Unload failed:', error.message))
    }
  }
}

const reportPath = path.join(root, '.cache', 'ocr-eval', 'ocr-alternatives.json')
await mkdir(path.dirname(reportPath), { recursive: true })
await writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8')
console.log(`\nSaved OCR comparison to ${reportPath}`)
