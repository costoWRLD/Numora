# Numora

**Your private money tracker, running on your computer.** Numora helps people keep track of everyday spending and income using receipt photos, manually entered transactions, and pasted M-Pesa confirmations. Its local AI can read receipts and help you ask questions about the records you have saved.

- **Download the Windows app:** [Latest Numora release](https://github.com/costoWRLD/Numora/releases/latest)
- **Current release:** v1.0.1
- **Source code:** [GitHub repository](https://github.com/costoWRLD/Numora)
- **Platform:** Windows x64 desktop installer

## What Numora does

- **Reads receipts:** Import JPG, PNG, or WebP photos (up to 15 MB each). Numora extracts the merchant, date, totals, currency, payment method, category, and item lines. Rotate, crop, and correct perspective where needed. Review the suggestions against the receipt before saving; scanning never saves an expense automatically.
- **Organizes M-Pesa messages:** Paste up to 20 transaction confirmations at a time. Numora extracts the amount, date, counterparty, transaction ID, fee, and other available details. Review each transaction and label it as an expense, income, transfer, loan, or another supported type before it enters the ledger.
- **Keeps a transaction register:** Add expenses and income manually, search records, filter them by date, merchant, category, currency, or amount, and match a receipt to its M-Pesa payment to avoid counting the same purchase twice.
- **Shows reports:** View spending over time and by category, compare periods, and export saved records or reports to CSV, PDF, or Word (`.docx`). Amounts stay in their original currencies; Numora does not convert currencies automatically.
- **Tracks optional inventory:** Create an item list, record stock received and item sales, and see quantities and weighted-average costs. Gross-profit estimates depend on the stock costs and sales that you record in Numora.
- **Answers questions:** Ask Numora about saved spending, income, categories, merchants, dates, loans, and inventory. The model helps interpret and phrase the question; totals are calculated from saved ledger records. Optional local knowledge search can index app help and saved records for chat.
- **Keeps local preferences:** Choose a default currency, theme, startup page, AI models, storage folder, and optional personal chat memories. Chat history, category rules, and inventory stay in the local workspace.

## How receipt and message processing works

1. Add a receipt photo or paste M-Pesa messages.
2. Numora processes the input on this device. Receipt OCR reads the image; M-Pesa confirmations are parsed locally, with a local language model available for unfamiliar formats.
3. Check the extracted fields and item lines against the original receipt or message. Correct anything that is wrong.
4. Confirm the transaction type and category, then save it to the local ledger.
5. Reports and Ask Numora use the saved records. Missing, undated, unclassified, or unconfirmed information can affect totals.

## Local AI and QVAC

Numora integrates the **QVAC SDK (`@qvac/sdk` 0.22.0)** in its local Node service. See [`server.mjs`](server.mjs) for the QVAC OCR, model, embedding, and inference code.

The app supports these local AI tasks:

| Task | Model or runtime | What it does |
| --- | --- | --- |
| Fast receipt OCR | QVAC EasyOCR Latin detector and recognizer | Reads printed Latin-script receipt text and returns positioned text with confidence information. |
| Detailed OCR reread | LightOnOCR-3 0.8B, Q4_K_M, plus its Q8_0 vision projector | Re-reads difficult receipts when the fast scan is incomplete or inconsistent. Both model files are required. |
| Chat and receipt interpretation | Qwen2.5 3B Instruct, Q4_K_M | Handles local conversation and helps organize difficult OCR text into fields. The GGUF file is about 1.93 GB. |
| Lower-memory chat choices | Llama 3.2 1B Instruct, Qwen3 0.6B Instruct, or Qwen3 1.7B Instruct | Smaller local chat alternatives available from the model library. Smaller models use less storage but may be less capable. |
| Optional local knowledge search | EmbeddingGemma 300M, Q4_0 | Builds a local index to find relevant app guidance and saved-record context for chat. |

The default OCR flow uses QVAC EasyOCR first and may retry with LightOnOCR-3 when the scan needs more work. Qwen can help interpret OCR text, but it cannot reliably recover characters that OCR failed to read. Totals checks, source text, and manual review help catch mistakes; they do not guarantee OCR is correct.

On app startup, Numora attempts to prepare installed OCR and chat models and shows progress. **It does not download missing models automatically.** Download or import models from Settings. Vulkan GPU acceleration is used when available, with CPU fallback; speed and whether a model fits depend on the computer’s available memory and drivers. A model’s file size is not the amount of RAM it needs while running.

Model weights are not included in the installer. The installer and source code do not contain your receipts, ledger, or downloaded model files. Review the model cards and their terms before redistributing model weights: [Qwen2.5 GGUF model files](https://huggingface.co/bartowski/Qwen2.5-3B-Instruct-GGUF) · [LightOnOCR-3 GGUF model files](https://huggingface.co/mradermacher/LightOnOCR-3-0.8B-GGUF).

## Install the desktop app

1. Open [GitHub Releases](https://github.com/costoWRLD/Numora/releases/latest) and download `Numora-Setup-<version>.exe`.
2. Run the installer and choose where to install Numora.
3. Launch Numora. On the first run, choose your workspace preferences.
4. Open **Settings → Local AI** to download or import the OCR and chat models you want to use. Model downloads need an internet connection. Once the required models are on the device, Numora’s AI processing and ledger features can work offline.

The published Windows installer is currently unsigned. Windows may show a publisher or SmartScreen warning when it is opened.

## Development setup (Windows)

### Requirements

- Windows x64
- Git
- Node.js 24 (the desktop build bundles Node.js 24.19.0)
- Internet access to install dependencies and download models

### Install dependencies

Open PowerShell in a folder where you want the project, then run:

```powershell
git clone https://github.com/costoWRLD/Numora.git
cd Numora
npm.cmd ci
npm.cmd ci --prefix client
```

Use `npm.cmd` in PowerShell to avoid the Windows script-execution policy error associated with `npm.ps1`.

### Run the browser development version

Open two terminals in the project folder. In the first terminal, start the local API and QVAC service:

```powershell
npm.cmd run dev:server
```

In the second terminal, start the Vite interface:

```powershell
npm.cmd run dev:ui
```

Open the local URL printed by Vite, usually `http://localhost:5173`. The API listens on `127.0.0.1:4318` by default. Keep the server terminal open while using the browser app.

### Run or build the Electron desktop app

Run the development desktop window:

```powershell
npm.cmd run desktop:dev
```

Build the Windows installer:

```powershell
npm.cmd run build:desktop
```

The installer is written to `release/Numora-Setup-<version>.exe`. The first build may download Electron packaging dependencies. The installer includes the app and runtime, not AI weights or user records.

## Data, privacy, and storage

- Receipt images, transactions, inventory, preferences, chat history, local memories, and the optional knowledge index are stored in the Numora workspace on your device.
- The default packaged-app workspace is `%LOCALAPPDATA%\Numora\data`. The downloaded QVAC models are stored separately under `%LOCALAPPDATA%\Numora\.qvac\models`.
- You can copy the workspace to another folder from Settings. In development, workspace data and model downloads are kept in the project’s ignored `data/` and `.qvac/` folders.
- The local API binds to `127.0.0.1`; receipt images, M-Pesa text, and saved ledger records are not sent to a Numora cloud service. Internet access is used for dependency/model downloads and model-library browsing.
- There is no cloud sync or automatic bank connection. Back up your workspace folder yourself; back up downloaded model files separately if you want to avoid downloading them again.

## What Numora does not do

- It does not connect to bank accounts, send payments, or automatically import messages from an M-Pesa app. M-Pesa messages are pasted by the user.
- It does not use WDK or a cryptocurrency wallet. It records and organizes transactions; it does not move money.
- It cannot know about transactions, stock, debts, or business activity that have not been entered and confirmed. Inventory and gross-profit figures depend on the records you maintain.
- OCR can misread blurred, handwritten, folded, or unusual receipts. Check suggested values against the image before saving.

## Project structure

- [`client/`](client/) — React, TypeScript, and Vite user interface.
- [`server.mjs`](server.mjs) — local HTTP API, QVAC integration, OCR, chat, model management, ledger, and local storage.
- [`desktop/`](desktop/) — Electron main process, secure preload bridge, and animated startup screen.
- [`shared/`](shared/) — shared application types.
- [`build/`](build/) — Windows app and installer artwork.
- `data/` and `.qvac/` — local workspace and model cache; ignored by Git.

## Versioning and releases

Numora uses `MAJOR.MINOR.PATCH` versions:

- **Patch** (`1.0.2`): compatible bug fixes.
- **Minor** (`1.1.0`): compatible new features.
- **Major** (`2.0.0`): changes that break compatibility.

Each public version is published as a GitHub Release with a matching Windows installer. See [all releases](https://github.com/costoWRLD/Numora/releases).

## License and third-party models

The root package metadata currently declares the ISC license. QVAC, application dependencies, and AI models have their own terms. Model weights are downloaded separately and are not redistributed in the installer; check each upstream model card before using or sharing model files.