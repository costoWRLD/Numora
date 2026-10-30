export const APP_KNOWLEDGE_VERSION = 1

const appGuide = [
  {
    id: 'overview',
    source: 'Numora overview',
    text: 'Numora is an on-device personal finance ledger for anyone who wants to track spending and recorded income: students, freelancers, households and small traders. Approved receipt expenses, manually entered expenses and classified M-Pesa entries are kept on this computer. The app does not send receipt images or chat questions to a cloud AI service. Ledger figures come from saved entries; they do not include transactions the user has not recorded.',
  },
  {
    id: 'receipts',
    source: 'Receipt scanning guide',
    text: 'On Receipts, add one or more JPG, PNG or WebP receipt photos and choose Review & analyze. Numora runs local OCR, then shows editable merchant, date, currency, total and item suggestions. Compare each field with the image, correct mistakes, and choose Save expense. An image is not added to the ledger before approval. If the scan is poor, use Retry / edit OCR. OCR confidence is only a signal and does not guarantee accuracy.',
  },
  {
    id: 'mpesa',
    source: 'M-Pesa guide',
    text: 'On Receipts, switch to the M-Pesa input mode, paste confirmation messages and choose Organize messages locally. Review the parsed counterparty, amount, fee, date and transaction type. Classify each entry as a business expense, business income, loan given, loan repayment, transfer or unclassified before saving. A received payment is not automatically a sale; classify its real purpose. Receipt and M-Pesa expense entries can be matched to avoid counting the same purchase twice.',
  },
  {
    id: 'transactions',
    source: 'Transactions guide',
    text: 'Transactions lists saved receipt expenses, M-Pesa entries, manually entered expenses and manually entered income. Search by words, or filter by category, merchant or counterparty, date range, amount and currency. Use Add expense for a purchase without a receipt and Add income for money received outside an M-Pesa message. Income types include Sales, Salary, Freelance, Refund, Gift and Other. Export the ledger as CSV.',
  },
  {
    id: 'reports',
    source: 'Reports guide',
    text: 'Reports summarizes saved records for a selected date range and currency. It shows income, expenses, net cash flow, spending over time, spending by category, and comparison with the immediately previous period. Reports can be exported as CSV, PDF or Word. Net cash flow means recorded income minus recorded expenses; it is not business profit. Totals exclude undated records and do not include missing or unrecorded transactions.',
  },
  {
    id: 'inventory',
    source: 'Inventory and profit guide',
    text: 'Inventory is optional. Create an item, record stock received, and record quantities sold to track remaining quantity and cost of goods sold. Receipt lines can be linked to stock. Inventory gross profit is sales revenue minus recorded cost of the items sold. A complete business profit figure requires all stock, sales, expenses and other costs to be recorded; Numora cannot infer missing stock or sales.',
  },
  {
    id: 'categories',
    source: 'Categories guide',
    text: 'Categories lets a user save a private merchant-to-category rule. When a future receipt has the same merchant name, Numora can suggest that category. A rule does not change entries that were already reviewed and saved.',
  },
  {
    id: 'ask-numora',
    source: 'Ask Numora guide',
    text: 'Ask Numora is the local chat page. Chat history stays in the local workspace. Qwen can answer general questions and explain app workflows. Local retrieval searches this guide, approved receipt OCR and item lines, saved transaction details, inventory items and movements, and merchant category rules. For personal financial totals, Numora queries saved records and calculates the figures in application code; the language model only turns verified results into a sentence. Ask about a date range, merchant, category, forecast, or a saved receipt. Predictions are estimates, not guarantees.',
  },
  {
    id: 'settings-privacy',
    source: 'Settings and privacy guide',
    text: 'Settings controls the default receipt currency and the starting page. Local AI model files may need a one-time download; the app does not download large models automatically on every launch. Once required model files are installed, receipt OCR, embeddings, chat and ledger calculations run locally. Model setup requires an internet connection; using the local app does not.',
  },
]

function splitText(text, maxChars = 850, overlap = 120) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxChars) return [normalized]
  const chunks = []
  let start = 0
  while (start < normalized.length) {
    let end = Math.min(normalized.length, start + maxChars)
    if (end < normalized.length) {
      const boundary = normalized.lastIndexOf('. ', end)
      if (boundary > start + Math.floor(maxChars * 0.55)) end = boundary + 1
    }
    chunks.push(normalized.slice(start, end).trim())
    if (end >= normalized.length) break
    start = Math.max(start + 1, end - overlap)
  }
  return chunks
}

export function buildRagDocuments(entries = [], { inventory = {}, categoryRules = [] } = {}) {
  const sources = [...appGuide]
  for (const entry of entries) {
    const type = entry.sourceType || 'receipt'
    if (!['mpesa', 'manual_income', 'manual_expense', 'inventory'].includes(type) && !entry.merchant) continue
    const title = type === 'mpesa'
      ? `M-Pesa ${entry.ledgerRole || 'transaction'} · ${entry.counterparty || 'Unknown'} · ${entry.date || 'undated'}`
      : type === 'manual_income'
        ? `Income · ${entry.counterparty || entry.merchant || 'Unknown source'} · ${entry.date || 'undated'}`
        : type === 'manual_expense'
          ? `Manual expense · ${entry.merchant || 'Unknown merchant'} · ${entry.date || 'undated'}`
          : `Receipt · ${entry.merchant || 'Unknown merchant'} · ${entry.date || 'undated'}`
    const detailLines = [
      `Record type: ${type === 'mpesa' ? `M-Pesa ${entry.ledgerRole || ''}` : type === 'manual_income' ? 'income' : 'expense'}`,
      `Merchant or counterparty: ${entry.merchant || entry.counterparty || 'Unknown'}`,
      `Date: ${entry.date || 'undated'}`,
      `Saved amount: ${entry.currency || (type === 'mpesa' ? 'KES' : 'unknown')} ${entry.amount || 'unknown'}`,
      `Category: ${entry.category || 'Uncategorised'}`,
      entry.paymentMethod ? `Payment method: ${entry.paymentMethod}` : '',
      entry.fee ? `M-Pesa fee: KES ${entry.fee}` : '',
      entry.notes ? `User note: ${entry.notes}` : '',
      entry.transactionId ? `Transaction ID: ${entry.transactionId}` : '',
      Array.isArray(entry.items) && entry.items.length
        ? `Receipt items: ${entry.items.map((item) => `${item.description} · ${entry.currency || ''} ${item.amount}${item.sourceLine ? ` · OCR line: ${item.sourceLine}` : ''}`).join('; ')}`
        : '',
      entry.rawText ? `Receipt OCR text (unverified; may contain recognition errors): ${String(entry.rawText).slice(0, 16000)}` : '',
      entry.sourceMessage ? `Original M-Pesa message: ${entry.sourceMessage}` : '',
    ].filter(Boolean)
    sources.push({ id: `record-${entry.id || `${type}-${title}`}`, source: title, text: detailLines.join('\n') })
  }

  for (const item of inventory.items || []) {
    const source = `Inventory item · ${item.name || 'Unnamed item'}`
    sources.push({
      id: `inventory-item-${item.id || item.name}`,
      source,
      text: [
        `Inventory item: ${item.name || 'Unnamed item'}`,
        `Quantity on hand: ${item.quantityOnHand ?? 'unknown'} ${item.unit || 'units'}`,
        `Currency: ${item.currency || 'unknown'}`,
        `Average unit cost: ${item.averageUnitCost ?? 'unknown'}`,
      ].join('\n'),
    })
  }
  for (const movement of (inventory.movements || []).slice(-200)) {
    const source = `Inventory ${movement.type || 'movement'} · ${movement.itemName || 'item'} · ${movement.date || 'undated'}`
    sources.push({
      id: `inventory-movement-${movement.id || source}`,
      source,
      text: [
        `Inventory movement: ${movement.type || 'unknown'}`,
        `Item: ${movement.itemName || 'unknown'}`,
        `Date: ${movement.date || 'undated'}`,
        `Quantity: ${movement.quantity ?? 'unknown'}`,
        movement.revenue ? `Recorded sales revenue: ${movement.currency || ''} ${movement.revenue}` : '',
        movement.totalCost ? `Recorded stock cost: ${movement.currency || ''} ${movement.totalCost}` : '',
        movement.grossProfit ? `Recorded gross profit: ${movement.currency || ''} ${movement.grossProfit}` : '',
        movement.note ? `User note: ${movement.note}` : '',
      ].filter(Boolean).join('\n'),
    })
  }
  for (const rule of categoryRules) {
    const source = `Merchant category rule · ${rule.merchant || 'merchant'}`
    sources.push({ id: `category-rule-${rule.merchant}`, source, text: `Merchant: ${rule.merchant || 'unknown'}\nSuggested category: ${rule.category || 'Uncategorised'}` })
  }

  return sources.flatMap((source) => splitText(source.text).map((content, index) => ({
    id: `${source.id}-${index}`,
    source: source.source,
    content: `Source: ${source.source}\n${content}`,
  })))
}
