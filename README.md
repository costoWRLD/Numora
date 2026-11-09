# Numora

Receipt reading starts with QVAC EasyOCR Latin, a small detector/recognizer pair that returns positioned text boxes and per-box confidence. On the AMD Vega 10, the saved Oakridge receipt took 9.4 seconds for EasyOCR inference on Vulkan; its first model load took another 12.8 seconds. The same run on CPU took about 88 seconds. This is a one-image comparison, not a guarantee for every receipt. If key fields are missing, totals conflict, or confidence is low, Numora tries LightOnOCR-3-0.8B as the accuracy fallback. Qwen is loaded only when local parsing cannot find the key fields/items or totals do not reconcile. Models take turns on the GPU to limit memory use. When QVAC OCR returns positioned boxes, Numora groups adjacent words by their image coordinates before pairing item descriptions and prices.

The M-Pesa input accepts up to 20 pasted transaction SMS messages per batch, separated by blank lines. Standard Safaricom confirmation formats are parsed with local rules; Qwen through QVAC handles formats those rules do not recognize. Extracted fields include transaction ID, date/time, direction, transaction type, counterparty, amount, fee, balance, reference, and category. Before saving, classify each message as business expense, business income, loan given, loan repayment, transfer, or unclassified. This prevents incoming transfers from being assumed to be sales and lets transfers for an already-saved receipt be excluded from totals. Suggestions remain editable and are saved only after approval. Saved transactions share `data/expenses.jsonl` with receipt expenses and are marked with `sourceType: "mpesa"`; transaction IDs are checked to prevent duplicates. The original SMS is retained for later review. Parsing runs locally and does not send messages to a cloud service.

The local ledger question box currently answers common date-filtered questions about spending, tagged business income, cash result, gross profit, recorded business profit estimates, cost of goods sold, and open loans/receivables. It computes totals from saved entries directly, separates currencies, and does not ask a language model to invent arithmetic. Undated entries and unclassified M-Pesa messages are excluded and reported. Recorded business profit uses classified M-Pesa income, inventory sales, recognized COGS, and recorded operating expenses; it is an estimate and excludes records the user has not entered.

The Inventory page keeps a local item catalogue and stock movement history in `data/inventory.json`. Record received quantities and unit costs, then record item sales and prices. Numora updates stock on hand using weighted-average unit cost. A saved receipt line can be manually received into a matching-currency inventory item after the user confirms quantity; its line total determines unit cost, and the line cannot be received twice. An inventory sale can be manually matched to one M-Pesa income record with the same KES amount. The Reports page respects these links to avoid counting matched income twice, and moves linked receipt line costs from expenses into COGS as stock is sold.

On launch, the UI checks the local API, readable ledger data, installed EasyOCR/LightOnOCR-3/Qwen files, and recoverable receipt reviews. Startup only checks model files; models load on demand and are never downloaded automatically during launch. If the API is unavailable, the user can continue to saved workspace views offline. In-progress receipt reviews and their original images are persisted locally until saved or discarded; the last selected workspace page and unsaved review edits are restored in the browser.

On first launch, Numora asks for a fallback receipt currency and a starting page. These preferences are saved in `data/preferences.json` and can be changed in Settings. Explicit receipt currency remains editable during review; the preference is used only when OCR has no currency evidence. This development build stores ledger files in the project `data/` folder. A real custom-folder picker is reserved for the packaged desktop build, where storage paths can be safely changed by the app.

Numora is an offline-first personal finance app for tracking receipts, expenses, and everyday money in one private local ledger. QVAC powers on-device receipt reading and local language-model features.

## Current step: local receipt reading, review, and saving

The React screen accepts one or more JPG, PNG, or WebP images up to 15 MB each. Imports appear in a searchable queue with validation failures, possible same-filename duplicates, and processing/review/saved statuses. The queue and its source files are preserved in the local browser profile with IndexedDB so queued work can resume after a reload. The user can read queued images locally as a batch; each result remains pending until reviewed and approved. Batch reading uses the original frame so it can proceed without asking for per-image crop adjustments; use the single-image preparation controls when a photo needs rotation or perspective correction. Before an individual OCR pass, the user can rotate the image, drag a crop, and adjust four corners. OpenCV.js applies a local perspective transform to flatten the selected quadrilateral before OCR. OpenCV loads only when scanning is requested; no image is sent to a cloud service. QVAC EasyOCR uses local Latin detector/recognizer GGUF weights and the Vulkan backend by default. If its result misses key fields or totals fail arithmetic checks, Numora rereads with local LightOnOCR-3-0.8B Q4_K_M and its matching Q8_0 projector, then chooses the result with stronger field, item, and total checks. Qwen2.5 3B Instruct Q4_K_M organizes text only when deterministic extraction cannot identify core fields/items or totals disagree. Qwen suggestions are validated against OCR source lines and remain editable. Set `QVAC_OCR_BACKEND=cpu` or `QVAC_LLM_BACKEND=cpu` to force either stage to CPU. The review screen reports the OCR model and backend used. EasyOCR weights are cached in `.qvac/models`; LightOnOCR-3 uses `.qvac/models/LightOnOCR-3-0.8B-Q4_K_M.gguf` and `.qvac/models/LightOnOCR-3-0.8B.mmproj-Q8_0.gguf`; Qwen is `.qvac/models/Qwen2.5-3B-Instruct-Q4_K_M.gguf`. Model files are local after their initial download. The user can edit extracted details and line items before saving. Numora checks item sums against printed subtotals and subtotal plus tax (and tip, when present) against printed total; discrepancies require acknowledgment. Merchant-to-category rules are local. The original image and reviewed entry are stored in `data/receipts/` and `data/expenses.jsonl`, both ignored by Git. No entry is saved until approval. Corner placement is manual; automatic receipt-edge detection is not included.

Open two VS Code terminals from the project root. Start the local QVAC service in the first:

```powershell
npm.cmd run dev:server
```

Start the UI in the second terminal:

```powershell
npm.cmd run dev:ui
```

Open the local address Vite prints (usually `http://localhost:5173`). The UI talks only to the API bound to `127.0.0.1`. QVAC EasyOCR uses a 1280px detection canvas and retains its detector/recognizer in memory for subsequent scans. If core fields are missing or confidence is poor, LightOnOCR-3 runs automatically; if EasyOCR found fields but arithmetic does not agree, the review screen offers an optional accuracy reread. In a seven-receipt direct OCR benchmark on this laptop, LightOnOCR-3 took about 12–34 seconds per image on Vulkan. The prior LightOnOCR-2 GPU benchmark averaged about 185 seconds per image on six shared images. Both read the benchmarked totals; the timing is device- and image-dependent and does not establish a general accuracy advantage. The Qwen2.5 3B Instruct Q4_K_M GGUF is about 1.93 GB and stored under `.qvac/models`; after all model weights are cached, the app can work offline.

## Windows desktop app

Install the project dependencies, then build the Windows installer:

```powershell
npm.cmd ci
npm.cmd run build:desktop
```

The installer is written to `release/Numora-Setup-<version>.exe`. It uses a branded setup wizard and creates Start menu and desktop shortcuts. When Numora starts, a short animated screen shows the local workspace starting before opening the app. Numora runs in its own window and starts its API on a free loopback port. The app and API stay on this computer. Ledger files are stored in `%LOCALAPPDATA%\Numora\data`, and model files are stored in `%LOCALAPPDATA%\Numora\.qvac\models`. The installer does not contain AI model weights, local ledger data, or `.env` configuration files; download models in Settings or import local model files before using OCR and open-ended chat. Models load only when needed and are not downloaded automatically at launch. The Windows build includes CPU and Vulkan inference runtimes; it omits CUDA binaries to keep the download smaller.

For desktop development, run `npm.cmd run desktop:dev`. This opens the same UI in an Electron window and uses the project’s ignored `data/` and `.qvac/` folders.

The selected quantized file is from [bartowski's Qwen2.5-3B-Instruct-GGUF repository](https://huggingface.co/bartowski/Qwen2.5-3B-Instruct-GGUF); its model card identifies the original model license as Qwen Research. Review the license for the original Qwen2.5-3B-Instruct model and the quantization repository terms before distributing the app or model materials.

To force both model stages to CPU, stop the server and restart it from PowerShell:

```powershell
$env:QVAC_OCR_BACKEND = 'cpu'
$env:QVAC_LLM_BACKEND = 'cpu'
npm.cmd run dev:server
```

Close that terminal or run `Remove-Item Env:QVAC_OCR_BACKEND,Env:QVAC_LLM_BACKEND -ErrorAction SilentlyContinue` before restarting to use Vulkan with CPU fallback. Speed depends on the GPU, available memory, and graphics driver.

To build the UI:

```powershell
npm.cmd run build:ui
```

The prompt experiment loads the same Qwen2.5 3B model from the local file through QVAC. The model folder is ignored by Git. Run the prompt experiment with:

```powershell
node .\qvac-prompt.mjs
```

## Intended workflow

1. Accept a receipt photo and run QVAC OCR locally.
2. Show editable suggested fields beside the source text.
3. Save only after the trader confirms; preserve the source image in local storage.
4. Classify M-Pesa movements before they affect reports; loan-given and repayment entries build open receivables by counterparty.
5. Compute dated income, expenses, cash result estimates, and receivables from the local ledger. Ask the ledger common questions; amounts are summed from records, not generated by a language model.
6. Match saved receipts to M-Pesa movements so the same purchase is not counted twice; matched payment amounts are excluded from expense totals while M-Pesa fees remain.
7. Extend inventory reporting with edits, reversals, and more complete sales and liability tracking.

## Planned structure

- `client/`: React and Vite interface.
- `server.mjs`: loopback-only Node API. QVAC OCR and local receipt persistence run here.
- `shared/`: TypeScript types shared by the client and server.
- `data/`: local JSON ledger, category rules, preferences, and inventory history, created at first run and kept out of Git.

## Next steps

1. Expand ledger exports to include inventory movements and date/category filters.
2. Add edits and reversals for inventory transactions with an auditable history.
3. Continue measuring the fast OCR and selective LightOnOCR reread on more varied receipts.

Core AI must work without internet after its model has been downloaded. Model and app performance will be measured on the demo laptop; no cloud AI API is part of this design.
