import type { CatalogEntry } from '../content/types';
import { createGeneratedView } from './format';
import type { GeneratedCore } from './generator';
import { createItem, createNpc, resolveRank, resolveRole } from './domain';
import type { Catalog, GenerateOptions, GeneratedNpcView, Npc } from './types';
import { DEFAULT_OPTIONS, STAT_NAMES } from './types';

function validRank(catalog: Catalog, requested: string): string {
  if (catalog.ranks.some((rank) => rank.name === requested)) return requested;
  const fallback = catalog.ranks[0]?.name;
  if (!fallback) throw new Error('The NPC catalog contains no ranks.');
  return fallback;
}

function validRole(catalog: Catalog, requested: string): string {
  if (catalog.roles.some((role) => role.name === requested)) return requested;
  const fallback = catalog.roles[0]?.name;
  if (!fallback) throw new Error('The NPC catalog contains no roles.');
  return fallback;
}

function manualRevision(command: string): GeneratedNpcView['revisions'][number] {
  return {
    section: 'edit',
    command,
    createdAt: new Date().toISOString(),
  };
}

function assertManualNpc(npc: Npc): void {
  for (const stat of STAT_NAMES) {
    const value = npc.stats.get(stat);
    if (!Number.isFinite(value)) throw new Error(`Manual NPC is missing a valid ${stat} stat.`);
  }
  if (!(npc.skills instanceof Map)) throw new Error('Manual NPC skills must be a Map.');
  if (!(npc.inventory instanceof Map)) throw new Error('Manual NPC inventory must be a Map.');
  if (!npc.cyberware || !Array.isArray(npc.cyberware.children)) throw new Error('Manual NPC cyberware tree is invalid.');
  if (!Array.isArray(npc.armor) || !Array.isArray(npc.weapons)) throw new Error('Manual NPC equipment lists are invalid.');
}

export function createBlankManualView(
  catalog: Catalog,
  referenceEntries: readonly CatalogEntry[] = [],
  baseOptions: GenerateOptions = DEFAULT_OPTIONS,
): GeneratedNpcView {
  const rankName = validRank(catalog, baseOptions.rank);
  const roleName = validRole(catalog, baseOptions.role);
  const rank = resolveRank(catalog, rankName);
  const role = resolveRole(catalog, roleName);
  const meatbodyData = catalog.cyberware.find((entry) => entry.name === 'Meatbody');
  if (!meatbodyData) throw new Error('Meatbody cyberware root is missing from the catalog.');

  const npc = createNpc(createItem(meatbodyData));
  npc.name = 'New';
  npc.surname = 'Operative';
  npc.age = 30;
  npc.sex = true;
  npc.nationality = baseOptions.nationality;
  npc.role = role.name;

  for (const stat of STAT_NAMES) npc.stats.set(stat, 5);

  const placeholderSkills = new Set(Object.keys(catalog.skillSpecializations));
  for (const [name, data] of Object.entries(catalog.skills)) {
    if (placeholderSkills.has(name)) continue;
    npc.skills.set(name, {
      skill: { name, link: data.link, type: data.type },
      level: 0,
    });
  }

  const options: GenerateOptions = {
    ...DEFAULT_OPTIONS,
    ...baseOptions,
    rank: rank.name,
    role: role.name,
    nationality: npc.nationality,
    seed: 0,
    allow_description: false,
    model_api_key: null,
  };
  const core: GeneratedCore = {
    npc,
    rank,
    role,
    options,
    seed: 0,
    warning: null,
  };
  return createGeneratedView(core, catalog, referenceEntries, [manualRevision('manual NPC created')]);
}

function rebuildManualNpc(
  current: GeneratedNpcView,
  npc: Npc,
  rankName: string,
  roleName: string,
  catalog: Catalog,
  referenceEntries: readonly CatalogEntry[],
  revisions: GeneratedNpcView['revisions'],
): GeneratedNpcView {
  const nextNpc = structuredClone(npc);
  assertManualNpc(nextNpc);
  const rank = resolveRank(catalog, validRank(catalog, rankName));
  const role = resolveRole(catalog, validRole(catalog, roleName));
  nextNpc.role = role.name;

  const core: GeneratedCore = {
    npc: nextNpc,
    rank,
    role,
    options: {
      ...current.options,
      rank: rank.name,
      role: role.name,
      nationality: nextNpc.nationality,
      model_api_key: null,
    },
    seed: current.seed,
    warning: null,
  };

  return createGeneratedView(core, catalog, referenceEntries, revisions);
}

/**
 * Recalculate the complete derived NPC view without adding a history entry.
 * Inline editing uses this for live previews while the user is still drafting.
 */
export function previewManualNpcView(
  current: GeneratedNpcView,
  npc: Npc,
  rankName: string,
  roleName: string,
  catalog: Catalog,
  referenceEntries: readonly CatalogEntry[] = [],
): GeneratedNpcView {
  return rebuildManualNpc(
    current,
    npc,
    rankName,
    roleName,
    catalog,
    referenceEntries,
    current.revisions,
  );
}

export function rebuildManualNpcView(
  current: GeneratedNpcView,
  npc: Npc,
  rankName: string,
  roleName: string,
  catalog: Catalog,
  referenceEntries: readonly CatalogEntry[] = [],
): GeneratedNpcView {
  return rebuildManualNpc(
    current,
    npc,
    rankName,
    roleName,
    catalog,
    referenceEntries,
    [
      ...current.revisions,
      manualRevision('manual edit'),
    ],
  );
}
