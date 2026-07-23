import type { GeneratedNpcView } from './engine/types';

const DATABASE = 'red-ops-npc-library';
const STORE = 'npcs';
const VERSION = 1;

export interface SavedNpcRecord {
  id: string;
  label: string;
  savedAt: string;
  view: GeneratedNpcView;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.'));
  });
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE)) {
        const store = database.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('savedAt', 'savedAt');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Unable to open the local NPC library.'));
  });
}

async function transact<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE, mode);
    const completed = new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed.'));
      transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction was aborted.'));
    });
    const result = await requestResult(action(transaction.objectStore(STORE)));
    await completed;
    return result;
  } finally {
    database.close();
  }
}

function sanitizedView(view: GeneratedNpcView): GeneratedNpcView {
  const clone = structuredClone(view);
  return {
    ...clone,
    options: { ...clone.options, model_api_key: null },
    revisions: Array.isArray(clone.revisions) ? clone.revisions : [],
  };
}

function normalizeRecord(record: SavedNpcRecord): SavedNpcRecord {
  return { ...record, view: sanitizedView(record.view) };
}

export async function saveNpc(view: GeneratedNpcView): Promise<SavedNpcRecord> {
  const savedAt = new Date().toISOString();
  const record: SavedNpcRecord = {
    id: typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${crypto.getRandomValues(new Uint32Array(1))[0]}`,
    label: `${view.npc.name} ${view.npc.surname}`,
    savedAt,
    view: sanitizedView(view),
  };
  await transact('readwrite', (store) => store.put(record));
  return record;
}

export async function listSavedNpcs(): Promise<SavedNpcRecord[]> {
  const records = await transact('readonly', (store) => store.getAll()) as SavedNpcRecord[];
  return records.map(normalizeRecord).sort((left, right) => right.savedAt.localeCompare(left.savedAt));
}

export async function deleteSavedNpc(id: string): Promise<void> {
  await transact('readwrite', (store) => store.delete(id));
}
