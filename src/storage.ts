import type { GeneratedNpcView, InventoryNode, Item, Npc, Role } from './engine/types';
import { DEFAULT_OPTIONS } from './engine/types';

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

function normalizeItem(item: Item): Item {
  return {
    ...item,
    beautiful_name: item.beautiful_name ?? null,
    beautiful_names_by_skill: { ...(item.beautiful_names_by_skill ?? {}) },
    beautiful_names_by_quality: { ...(item.beautiful_names_by_quality ?? {}) },
    armor_locations: [...(item.armor_locations ?? [])],
  };
}

function normalizeInventoryNode(node: InventoryNode): InventoryNode {
  return {
    ...node,
    item: normalizeItem(node.item),
    children: node.children.map(normalizeInventoryNode),
  };
}

function normalizeNpc(npc: Npc, role: Role): Npc {
  return {
    ...npc,
    role: npc.role ?? role.name,
    lifepath: structuredClone(npc.lifepath ?? {}),
    cyberware: normalizeInventoryNode(npc.cyberware),
    armor: npc.armor.map(normalizeItem),
    weapons: npc.weapons.map(normalizeItem),
    inventory: new Map([...npc.inventory].map(([key, entry]) => [
      key,
      { ...entry, item: normalizeItem(entry.item) },
    ])),
  };
}

export function normalizeSavedNpcView(view: GeneratedNpcView): GeneratedNpcView {
  const clone = structuredClone(view);
  const role = {
    ...clone.role,
    preferred_armor: {
      head: [...(clone.role.preferred_armor?.head ?? [])],
      body: [...(clone.role.preferred_armor?.body ?? [])],
    },
  };
  return {
    ...clone,
    role,
    npc: normalizeNpc(clone.npc, role),
    options: {
      ...DEFAULT_OPTIONS,
      ...clone.options,
      forbidden_skills: [...(clone.options.forbidden_skills ?? [])],
      model_api_key: null,
    },
    revisions: Array.isArray(clone.revisions) ? clone.revisions : [],
  };
}

function normalizeRecord(record: SavedNpcRecord): SavedNpcRecord {
  return { ...record, view: normalizeSavedNpcView(record.view) };
}

export async function saveNpc(view: GeneratedNpcView): Promise<SavedNpcRecord> {
  const savedAt = new Date().toISOString();
  const record: SavedNpcRecord = {
    id: typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${crypto.getRandomValues(new Uint32Array(1))[0]}`,
    label: `${view.npc.name} ${view.npc.surname}`,
    savedAt,
    view: normalizeSavedNpcView(view),
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
