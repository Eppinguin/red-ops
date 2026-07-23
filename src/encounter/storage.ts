import { createEmptyEncounter, normalizeEncounter } from './model';
import type { EncounterState, EncounterWorkspace } from './types';

const WORKSPACE_KEY = 'red-ops.encounter-workspace.v2';
const LEGACY_KEY = 'red-ops.active-encounter.v1';

function replacer(_key: string, value: unknown): unknown {
  return value instanceof Map ? { __redOpsMap: [...value.entries()] } : value;
}

function reviver(_key: string, value: unknown): unknown {
  if (value && typeof value === 'object' && '__redOpsMap' in value) {
    const entries = (value as { __redOpsMap?: unknown }).__redOpsMap;
    return Array.isArray(entries) ? new Map(entries as Array<[unknown, unknown]>) : value;
  }
  return value;
}

function withoutHistory(state: EncounterState): EncounterState {
  return { ...state, past: [], lastEvent: null };
}

function normalizeWorkspace(value: unknown): EncounterWorkspace {
  if (!value || typeof value !== 'object') return createEncounterWorkspace();
  const raw = value as Partial<EncounterWorkspace>;
  const encounters = Array.isArray(raw.encounters)
    ? raw.encounters.map(normalizeEncounter)
    : [];
  if (!encounters.length) return createEncounterWorkspace();
  const requestedId = typeof raw.activeEncounterId === 'string' ? raw.activeEncounterId : '';
  const activeEncounterId = encounters.some((encounter) => encounter.id === requestedId)
    ? requestedId
    : encounters[0]!.id;
  return { version: 2, activeEncounterId, encounters };
}

export function createEncounterWorkspace(): EncounterWorkspace {
  const encounter = createEmptyEncounter();
  return { version: 2, activeEncounterId: encounter.id, encounters: [encounter] };
}

export function loadEncounterWorkspace(): EncounterWorkspace {
  try {
    const current = localStorage.getItem(WORKSPACE_KEY);
    if (current) return normalizeWorkspace(JSON.parse(current, reviver));

    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy) {
      const encounter = normalizeEncounter(JSON.parse(legacy, reviver));
      return { version: 2, activeEncounterId: encounter.id, encounters: [encounter] };
    }
  } catch {
    // Fall through to a clean in-memory workspace.
  }
  return createEncounterWorkspace();
}

export function persistEncounterWorkspace(workspace: EncounterWorkspace): void {
  try {
    const safeWorkspace: EncounterWorkspace = {
      version: 2,
      activeEncounterId: workspace.activeEncounterId,
      encounters: workspace.encounters.map(withoutHistory),
    };
    localStorage.setItem(WORKSPACE_KEY, JSON.stringify(safeWorkspace, replacer));
  } catch {
    // The tracker remains usable in memory when browser storage is unavailable.
  }
}

export function parseEncounterImport(text: string): EncounterState {
  const value: unknown = JSON.parse(text, reviver);
  if (!value || typeof value !== 'object') {
    throw new Error('The file does not contain an encounter.');
  }
  const raw = value as Partial<EncounterState>;
  if (raw.version !== 1 || !Array.isArray(raw.combatants)) {
    throw new Error('The file is not a Red Ops encounter export.');
  }
  return normalizeEncounter(raw);
}

/** Backward-compatible helpers for code importing the original single-encounter API. */
export function loadEncounter(): EncounterState {
  const workspace = loadEncounterWorkspace();
  return workspace.encounters.find((encounter) => encounter.id === workspace.activeEncounterId)
    ?? workspace.encounters[0]
    ?? createEmptyEncounter();
}

export function persistEncounter(state: EncounterState): void {
  persistEncounterWorkspace({ version: 2, activeEncounterId: state.id, encounters: [state] });
}
