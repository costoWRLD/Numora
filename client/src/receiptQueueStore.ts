export type PersistedReceiptQueueEntry = {
  id: string
  file: File
  status: 'queued' | 'processing' | 'needs-review' | 'saved' | 'failed' | 'duplicate'
  message?: string
  retryable?: boolean
  merchant?: string
  scanResult?: unknown
}

const DATABASE_NAME = 'numora-private-workspace'
const DATABASE_VERSION = 1
const STORE_NAME = 'receipt-imports'

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) return reject(new Error('This browser does not support local import recovery.'))
    const request = window.indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(STORE_NAME)) database.createObjectStore(STORE_NAME, { keyPath: 'id' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('Could not open local receipt recovery storage.'))
  })
}

export async function loadReceiptQueue(): Promise<PersistedReceiptQueueEntry[]> {
  const database = await openDatabase()
  try {
    return await new Promise((resolve, reject) => {
      const request = database.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAll()
      request.onsuccess = () => resolve((request.result || []) as PersistedReceiptQueueEntry[])
      request.onerror = () => reject(request.error || new Error('Could not restore the local import queue.'))
    })
  } finally {
    database.close()
  }
}

export async function saveReceiptQueue(entries: PersistedReceiptQueueEntry[]): Promise<void> {
  const database = await openDatabase()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite')
      const store = transaction.objectStore(STORE_NAME)
      store.clear()
      for (const entry of entries) {
        const { thumbnail: _thumbnail, ...persisted } = entry as PersistedReceiptQueueEntry & { thumbnail?: string }
        store.put(persisted)
      }
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error || new Error('Could not save the local import queue.'))
      transaction.onabort = () => reject(transaction.error || new Error('Local import queue save was interrupted.'))
    })
  } finally {
    database.close()
  }
}
