import type { CatalogEntry } from '../content/types';
import { createGeneratedView } from './format';
import type { GeneratedCore } from './generator';
import type {
  Catalog,
  GeneratedNpcView,
  GenerationRevision,
  Npc,
  NpcCommand,
  NpcSection,
} from './types';

function cloneNpc(npc: Npc): Npc {
  return structuredClone(npc);
}

export function mergeNpcSection(current: Npc, candidate: Npc, section: NpcSection): Npc {
  const next = cloneNpc(current);
  if (section === 'identity') {
    next.sex = candidate.sex;
    next.nationality = candidate.nationality;
    next.age = candidate.age;
    next.name = candidate.name;
    next.surname = candidate.surname;
    next.description = '';
  } else if (section === 'description') {
    next.description = candidate.description;
  } else if (section === 'stats') {
    next.stats = structuredClone(candidate.stats);
  } else if (section === 'skills') {
    next.skills = structuredClone(candidate.skills);
  } else if (section === 'cyberware') {
    next.cyberware = structuredClone(candidate.cyberware);
  } else if (section === 'weapons') {
    next.weapons = structuredClone(candidate.weapons);
    const retained = [...next.inventory].filter(([, entry]) => entry.item.type !== 'ammo');
    const ammo = [...candidate.inventory].filter(([, entry]) => entry.item.type === 'ammo');
    next.inventory = new Map([...retained, ...structuredClone(ammo)]);
  } else if (section === 'armor') {
    next.armor = structuredClone(candidate.armor);
  } else if (section === 'inventory') {
    next.inventory = structuredClone(candidate.inventory);
  } else {
    next.cyberware = structuredClone(candidate.cyberware);
    next.armor = structuredClone(candidate.armor);
    next.weapons = structuredClone(candidate.weapons);
    next.inventory = structuredClone(candidate.inventory);
    next.traumaTeamStatus = candidate.traumaTeamStatus;
  }
  return next;
}

export function applyNpcCommand(current: Npc, command: NpcCommand): Npc {
  const next = cloneNpc(current);
  if (command.type === 'set-stat') {
    next.stats.set(command.stat, Math.max(1, Math.min(10, Math.trunc(command.value))));
    return next;
  }
  const entry = next.skills.get(command.skill);
  if (!entry) throw new Error(`Unknown skill: ${command.skill}`);
  entry.level = Math.max(0, Math.min(10, Math.trunc(command.value)));
  return next;
}

function revision(section: NpcSection | 'edit', details: Pick<GenerationRevision, 'seed' | 'command'>): GenerationRevision {
  return {
    section,
    ...details,
    createdAt: new Date().toISOString(),
  };
}

export function createRerolledView(
  current: GeneratedNpcView,
  candidate: GeneratedCore,
  section: NpcSection,
  catalog: Catalog,
  referenceEntries: readonly CatalogEntry[],
): GeneratedNpcView {
  const core: GeneratedCore = {
    npc: mergeNpcSection(current.npc, candidate.npc, section),
    rank: current.rank,
    role: current.role,
    options: { ...current.options, model_api_key: null },
    seed: current.seed,
    warning: candidate.warning,
  };
  return createGeneratedView(core, catalog, referenceEntries, [
    ...current.revisions,
    revision(section, { seed: candidate.seed }),
  ]);
}

export function createEditedView(
  current: GeneratedNpcView,
  command: NpcCommand,
  catalog: Catalog,
  referenceEntries: readonly CatalogEntry[],
): GeneratedNpcView {
  const core: GeneratedCore = {
    npc: applyNpcCommand(current.npc, command),
    rank: current.rank,
    role: current.role,
    options: { ...current.options, model_api_key: null },
    seed: current.seed,
    warning: null,
  };
  const label = command.type === 'set-stat'
    ? `${command.stat}=${command.value}`
    : `${command.skill}=${command.value}`;
  return createGeneratedView(core, catalog, referenceEntries, [
    ...current.revisions,
    revision('edit', { command: label }),
  ]);
}
