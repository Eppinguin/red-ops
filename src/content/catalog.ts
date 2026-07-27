import { priceCategory } from '../engine/domain';
import type { Catalog, ItemData, ItemQuality, ItemType, SkillData } from '../engine/types';
import { UPSTREAM_COMMIT, UPSTREAM_REPOSITORY } from '../engine/catalog';
import manualMappingFile from './manual-mappings.json';
import type {
  CatalogConflict,
  CatalogEntry,
  CatalogEntryType,
  DataProvenance,
  FoundryReference,
  InstallationData,
  MechanicsSummary,
  ManualCatalogMapping,
  ReferenceCatalogData,
  ReferenceCatalogManifest,
} from './types';

const FOUNDRY_PROJECT_ID = 22820629;
const FOUNDRY_REPOSITORY = 'cyberpunk-red-team/fvtt-cyberpunk-red-core';
const FOUNDRY_REF = 'v0.92.4';

const TYPE_LABELS: Partial<Record<CatalogEntryType, string>> = {
  ammo: 'ammunition',
  armor: 'armor',
  cyberware: 'cyberware',
  drug: 'pharmaceutical',
  equipment: 'gear',
  junk: 'personal item',
  weapon: 'weapon',
  skill: 'skill',
  clothing: 'clothing',
  program: 'program',
  cyberdeck: 'cyberdeck',
  upgrade: 'upgrade',
  role: 'role ability',
  vehicle: 'vehicle',
  criticalInjury: 'critical injury',
};

function slug(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'entry';
}

export function stripGeneratedPrefix(name: string): string {
  return name.replace(/^(Head|Body):\s*/i, '').trim();
}

function splitQuality(name: string, explicit?: ItemQuality | null): { name: string; quality: ItemQuality | null } {
  if (explicit) return { name: stripGeneratedPrefix(name), quality: explicit };
  const match = stripGeneratedPrefix(name).match(/^(.*)\s+\((Poor|Standard|Excellent)\)$/i);
  if (!match) return { name: stripGeneratedPrefix(name), quality: null };
  return { name: match[1]!.trim(), quality: match[2]!.toLowerCase() as ItemQuality };
}

export function normalizeCatalogName(name: string): string {
  return splitQuality(name).name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\b(ammunition|ammo)\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function catalogId(type: CatalogEntryType, name: string, quality?: ItemQuality | null): string {
  return `${type}.${slug(name)}${quality ? `.${quality}` : ''}`;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function generatorProvenance(field: string, originalId: string): DataProvenance {
  return {
    source: 'generator',
    field,
    repository: UPSTREAM_REPOSITORY,
    ref: UPSTREAM_COMMIT,
    originalId,
  };
}

function summarizeItem(item: ItemData): string {
  const name = item.name ?? 'This item';
  switch (item.type) {
    case 'weapon': {
      const details = [
        item.damage ? `${item.damage} damage` : null,
        item.rate_of_fire ? `ROF ${item.rate_of_fire}` : null,
        item.magazine ? `${item.magazine}-round capacity` : null,
      ].filter(Boolean);
      return `${name} is a combat weapon${details.length ? ` with ${details.join(', ')}` : ''}.`;
    }
    case 'armor':
      return `${name} is protective equipment${item.armor_class ? ` providing SP ${item.armor_class}` : ''}.`;
    case 'cyberware': {
      const capacity = item.container_capacity && item.container_capacity < 100
        ? ` It provides ${item.container_capacity} option slot${item.container_capacity === 1 ? '' : 's'}.`
        : '';
      return `${name} is cyberware that can modify an NPC's capabilities or host installed options.${capacity}`;
    }
    case 'drug':
      return `${name} is a consumable pharmaceutical carried as part of the NPC's equipment.`;
    case 'equipment':
      return `${name} is general-purpose gear used for field work, survival, investigation, or combat support.`;
    case 'ammo':
      return `${name} is ammunition consumed by a compatible weapon.`;
    default:
      return `${name} is a generated ${TYPE_LABELS[item.type ?? 'junk'] ?? 'item'} carried by the NPC.`;
  }
}

function itemMechanics(item: ItemData): MechanicsSummary {
  if (item.type === 'weapon') {
    return {
      kind: 'weapon',
      damage: item.damage ?? undefined,
      rateOfFire: item.rate_of_fire ?? undefined,
      magazine: item.magazine ?? undefined,
      skill: item.skill ?? undefined,
      ammoTypes: [...(item.ammo_types ?? [])],
      quality: item.quality ?? null,
    };
  }
  if (item.type === 'armor') {
    const legacyLocation = item.name?.match(/^(Head|Body):/i)?.[1];
    const locations = item.armor_locations?.length
      ? item.armor_locations.map((location) => location.toLowerCase())
      : legacyLocation
        ? [legacyLocation.toLowerCase()]
        : [];
    const penalty = Math.min(0, ...(item.modifiers ?? []).map((modifier) => modifier.simple ?? 0));
    return {
      kind: 'armor',
      stoppingPower: item.armor_class ?? undefined,
      penalty: penalty || undefined,
      locations: unique(locations),
    };
  }
  if (item.type === 'cyberware') {
    return {
      kind: 'cyberware',
      humanityLoss: item.max_humanity_loss || undefined,
      foundational: Boolean(item.container_capacity),
      weapon: item.damage ? {
        kind: 'weapon',
        damage: item.damage,
        rateOfFire: item.rate_of_fire ?? undefined,
        magazine: item.magazine ?? undefined,
        skill: item.skill ?? undefined,
        ammoTypes: [...(item.ammo_types ?? [])],
        quality: item.quality ?? null,
      } : undefined,
      installation: {
        capacity: item.container_capacity || undefined,
        size: item.size_in_container || undefined,
        allowedTypes: [],
        requiredContainers: [...(item.required_containers ?? [])],
        requiredItems: [...(item.required_cyberware ?? [])],
      },
    };
  }
  return {
    kind: 'generic',
    electronic: (item.tags ?? []).some((tag) => /electronic/i.test(tag)),
    installation: item.container_capacity || item.size_in_container || item.required_containers?.length
      ? {
          capacity: item.container_capacity || undefined,
          size: item.size_in_container || undefined,
          allowedTypes: [],
          requiredContainers: [...(item.required_containers ?? [])],
          requiredItems: [...(item.required_cyberware ?? [])],
        }
      : undefined,
  };
}

function generatorItemEntry(item: ItemData, sourceIndex: number): CatalogEntry {
  const type = item.type ?? 'junk';
  const qualityInfo = splitQuality(item.name ?? 'Empty item', item.quality);
  const originalId = `${type}:${sourceIndex}:${item.name ?? 'Empty item'}`;
  const tags = unique([...(item.tags ?? []), ...(item.unique_tags ?? [])]);
  return {
    id: catalogId(type, qualityInfo.name, qualityInfo.quality),
    type,
    name: qualityInfo.name,
    aliases: unique([item.name ?? qualityInfo.name]),
    summary: summarizeItem(item),
    usage: item.required_containers?.length
      ? `Install in: ${item.required_containers.join(', ')}.`
      : undefined,
    mechanics: itemMechanics(item),
    price: item.price !== undefined ? { amount: item.price, category: priceCategory(item.price) } : undefined,
    tags,
    generator: {
      generatorName: item.name ?? qualityInfo.name,
      generatorType: type,
      eligible: true,
      quality: qualityInfo.quality,
    },
    provenance: [
      generatorProvenance('name', originalId),
      generatorProvenance('mechanics', originalId),
      generatorProvenance('price', originalId),
    ],
  };
}

function skillSummary(name: string, skill: SkillData): string {
  return `${name} is a ${skill.type.replaceAll('_', ' ')} skill linked to ${skill.link}. The displayed skill base is the linked stat plus the trained level and applicable modifiers.`;
}

function generatorSkillEntry(name: string, skill: SkillData): CatalogEntry {
  const originalId = `skill:${name}`;
  return {
    id: catalogId('skill', name),
    type: 'skill',
    name,
    aliases: [],
    summary: skillSummary(name, skill),
    mechanics: { kind: 'skill', linkedStat: skill.link, skillType: skill.type },
    tags: [skill.type, skill.link],
    generator: { generatorName: name, generatorType: 'skill', eligible: true },
    provenance: [
      generatorProvenance('name', originalId),
      generatorProvenance('mechanics', originalId),
    ],
  };
}

function generatorAmmoEntries(catalog: Catalog): CatalogEntry[] {
  const ammoTypes = unique(Object.values(catalog.ammo).flatMap((data) => data.types));
  return Object.entries(catalog.ammo).flatMap(([modification, data]) => ammoTypes
    .filter((ammoType) => data.types.includes(ammoType))
    .map((ammoType) => {
      const name = `${ammoType} (${modification})`;
      const price = (ammoType === 'Grenades' || ammoType === 'Rockets') ? data.price * 10 : data.price;
      return {
        id: catalogId('ammo', name),
        type: 'ammo' as const,
        name,
        aliases: [`${modification} ${ammoType}`, `${ammoType} ammunition`],
        summary: `${modification} ${ammoType.toLowerCase()} ammunition for compatible weapons. Generated stacks are priced per individual round or projectile.`,
        mechanics: { kind: 'generic' as const, quantity: 1 },
        price: { amount: price, category: priceCategory(price) },
        tags: [ammoType, modification],
        generator: { generatorName: name, generatorType: 'ammo' as const, eligible: true },
        provenance: [generatorProvenance('mechanics', `ammo:${modification}:${ammoType}`)],
      };
    }));
}

export function buildGeneratorCatalog(catalog: Catalog): CatalogEntry[] {
  const items: ItemData[] = [
    ...catalog.armor,
    ...catalog.weapons,
    ...catalog.cyberware,
    ...catalog.equipment,
    ...catalog.drugs,
    ...catalog.junk,
  ];
  const entries = [
    ...items.map(generatorItemEntry),
    ...Object.entries(catalog.skills).map(([name, skill]) => generatorSkillEntry(name, skill)),
    ...generatorAmmoEntries(catalog),
  ];
  return deduplicateEntries(entries);
}

function stripHtml(value: string): string {
  return value
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function mergeInstallation(generator: InstallationData, foundry: InstallationData) {
  return {
    capacity: generator.capacity ?? foundry.capacity,
    size: generator.size ?? foundry.size,
    allowedTypes: unique([...foundry.allowedTypes, ...generator.allowedTypes]),
    requiredContainers: unique([...foundry.requiredContainers, ...generator.requiredContainers]),
    requiredItems: unique([...foundry.requiredItems, ...generator.requiredItems]),
  };
}

function mergeMechanics(generator: MechanicsSummary, foundry: MechanicsSummary): MechanicsSummary {
  if (generator.kind !== foundry.kind) return generator;
  if (generator.kind === 'weapon' && foundry.kind === 'weapon') {
    return {
      kind: 'weapon',
      damage: generator.damage ?? foundry.damage,
      rateOfFire: generator.rateOfFire ?? foundry.rateOfFire,
      magazine: generator.magazine ?? foundry.magazine,
      skill: generator.skill ?? foundry.skill,
      ammoTypes: unique([...foundry.ammoTypes, ...generator.ammoTypes]),
      quality: generator.quality ?? foundry.quality,
      concealability: generator.concealability ?? foundry.concealability,
      hands: generator.hands ?? foundry.hands,
    };
  }
  if (generator.kind === 'armor' && foundry.kind === 'armor') {
    return {
      kind: 'armor',
      stoppingPower: generator.stoppingPower ?? foundry.stoppingPower,
      penalty: generator.penalty ?? foundry.penalty,
      locations: unique([...foundry.locations, ...generator.locations]),
    };
  }
  if (generator.kind === 'cyberware' && foundry.kind === 'cyberware') {
    const weapon = generator.weapon && foundry.weapon
      ? mergeMechanics(generator.weapon, foundry.weapon)
      : generator.weapon ?? foundry.weapon;
    return {
      kind: 'cyberware',
      humanityLoss: generator.humanityLoss ?? foundry.humanityLoss,
      foundational: generator.foundational || foundry.foundational,
      weapon: weapon?.kind === 'weapon' ? weapon : undefined,
      installation: mergeInstallation(generator.installation, foundry.installation),
    };
  }
  if (generator.kind === 'skill' && foundry.kind === 'skill') {
    return {
      kind: 'skill',
      linkedStat: generator.linkedStat ?? foundry.linkedStat,
      skillType: generator.skillType ?? foundry.skillType,
      multiplier: generator.multiplier ?? foundry.multiplier,
    };
  }
  if (generator.kind === 'generic' && foundry.kind === 'generic') {
    return {
      kind: 'generic',
      electronic: generator.electronic ?? foundry.electronic,
      brand: generator.brand ?? foundry.brand,
      quantity: generator.quantity ?? foundry.quantity,
      installation: generator.installation && foundry.installation
        ? mergeInstallation(generator.installation, foundry.installation)
        : generator.installation ?? foundry.installation,
    };
  }
  return generator;
}

function mergeEntries(generator: CatalogEntry, foundry: CatalogEntry): CatalogEntry {
  const foundrySummary = stripHtml(foundry.summary);
  const generatedFallback = `${foundry.name} is a ${foundry.type} entry from the Cyberpunk RED Foundry compendium.`;
  return {
    ...generator,
    aliases: unique([...generator.aliases, foundry.name, ...foundry.aliases]),
    summary: foundrySummary && foundrySummary !== generatedFallback ? foundrySummary : generator.summary,
    usage: foundry.usage || generator.usage,
    mechanics: mergeMechanics(generator.mechanics, foundry.mechanics),
    price: generator.price || foundry.price ? {
      amount: generator.price?.amount ?? foundry.price?.amount,
      category: foundry.price?.category ?? generator.price?.category,
    } : undefined,
    source: foundry.source ?? generator.source,
    tags: unique([...generator.tags, ...foundry.tags]),
    foundry: foundry.foundry,
    provenance: [...generator.provenance, ...foundry.provenance],
  };
}

function scalarValues(entry: CatalogEntry): Map<string, unknown> {
  const values = new Map<string, unknown>();
  const visit = (value: unknown, path: string): void => {
    if (value === undefined || value === null || value === '') return;
    if (Array.isArray(value)) {
      if (value.length) values.set(path, [...value].map(String).sort());
      return;
    }
    if (typeof value === 'object') {
      for (const [key, child] of Object.entries(value as Record<string, unknown>)) visit(child, path ? `${path}.${key}` : key);
      return;
    }
    values.set(path, value);
  };
  visit(entry.mechanics, 'mechanics');
  visit(entry.price, 'price');
  return values;
}

function comparableEqual(left: unknown, right: unknown): boolean {
  if (Array.isArray(left) && Array.isArray(right)) return JSON.stringify(left) === JSON.stringify(right);
  if (typeof left === 'string' && typeof right === 'string') return left.trim().toLowerCase() === right.trim().toLowerCase();
  return Object.is(left, right);
}

function findConflicts(generator: CatalogEntry, foundry: CatalogEntry): CatalogConflict[] {
  const generatorValues = scalarValues(generator);
  const foundryValues = scalarValues(foundry);
  const conflicts: CatalogConflict[] = [];
  for (const [field, generatorValue] of generatorValues) {
    const foundryValue = foundryValues.get(field);
    if (foundryValue === undefined || comparableEqual(generatorValue, foundryValue)) continue;
    conflicts.push({
      entryId: generator.id,
      field,
      generatorValue,
      foundryValue,
      resolution: field.startsWith('mechanics.') || field === 'price.amount' ? 'generator' : 'foundry',
    });
  }
  return conflicts;
}

function entryQuality(entry: CatalogEntry): ItemQuality | null {
  return entry.generator?.quality
    ?? (entry.mechanics.kind === 'weapon' ? entry.mechanics.quality : null)
    ?? null;
}

function baseMatchKey(entry: CatalogEntry): string {
  return `${entry.type}:${normalizeCatalogName(entry.name)}`;
}

function foundryPreference(entry: CatalogEntry): number {
  const pack = entry.foundry?.pack ?? '';
  if (pack.startsWith('core/')) return 0;
  if (pack.startsWith('black-chrome/')) return 1;
  if (pack.startsWith('dlc/')) return 2;
  return 3;
}

function deduplicateEntries(entries: CatalogEntry[]): CatalogEntry[] {
  const byId = new Map<string, CatalogEntry>();
  for (const entry of entries) {
    const existing = byId.get(entry.id);
    if (!existing) {
      byId.set(entry.id, entry);
      continue;
    }
    byId.set(entry.id, {
      ...existing,
      aliases: unique([...existing.aliases, entry.name, ...entry.aliases]),
      tags: unique([...existing.tags, ...entry.tags]),
      provenance: [...existing.provenance, ...entry.provenance],
    });
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name) || a.type.localeCompare(b.type));
}

function isCatalogEntry(value: unknown): value is CatalogEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<CatalogEntry>;
  return typeof entry.id === 'string'
    && typeof entry.name === 'string'
    && typeof entry.type === 'string'
    && typeof entry.summary === 'string'
    && Array.isArray(entry.tags)
    && Array.isArray(entry.provenance)
    && Boolean(entry.mechanics && typeof entry.mechanics === 'object');
}

async function loadFoundryEntries(): Promise<{ entries: CatalogEntry[]; manifest?: ReferenceCatalogData['manifest']['foundry'] }> {
  try {
    const response = await fetch('/content/foundry/catalog.json', { cache: 'no-cache' });
    if (!response.ok) return { entries: [] };
    const data = await response.json() as Partial<ReferenceCatalogData>;
    const entries = Array.isArray(data.entries) ? data.entries.filter(isCatalogEntry) : [];
    return { entries, manifest: data.manifest?.foundry };
  } catch {
    return { entries: [] };
  }
}

export function mergeReferenceEntries(
  generatorEntries: readonly CatalogEntry[],
  foundryEntries: readonly CatalogEntry[],
  mappings: readonly ManualCatalogMapping[] = manualMappingFile.mappings as ManualCatalogMapping[],
): { entries: CatalogEntry[]; conflicts: CatalogConflict[] } {
  const remaining = new Set(foundryEntries);
  const foundryById = new Map(foundryEntries.map((entry) => [entry.id, entry]));
  const mappingByGeneratorId = new Map(mappings.map((mapping) => [mapping.generatorId, mapping]));
  const foundryGroups = new Map<string, CatalogEntry[]>();
  for (const entry of foundryEntries) {
    const key = baseMatchKey(entry);
    const group = foundryGroups.get(key) ?? [];
    group.push(entry);
    foundryGroups.set(key, group);
  }
  for (const group of foundryGroups.values()) {
    group.sort((left, right) => foundryPreference(left) - foundryPreference(right) || left.id.localeCompare(right.id));
  }

  const conflicts: CatalogConflict[] = [];
  const merged = generatorEntries.map((entry) => {
    const manualMapping = mappingByGeneratorId.get(entry.id);
    const manualMatch = manualMapping ? foundryById.get(manualMapping.foundryId) : undefined;
    const candidates = (foundryGroups.get(baseMatchKey(entry)) ?? []).filter((candidate) => remaining.has(candidate));
    const quality = entryQuality(entry);
    const foundryEntry = manualMatch && remaining.has(manualMatch) ? manualMatch : quality
      ? candidates.find((candidate) => entryQuality(candidate) === quality)
        ?? candidates.find((candidate) => entryQuality(candidate) === null)
      : candidates.find((candidate) => entryQuality(candidate) === 'standard')
        ?? candidates.find((candidate) => entryQuality(candidate) === null)
        ?? (candidates.length === 1 ? candidates[0] : undefined);
    if (!foundryEntry) return entry;
    remaining.delete(foundryEntry);
    conflicts.push(...findConflicts(entry, foundryEntry));
    const result = mergeEntries(entry, foundryEntry);
    return manualMapping?.aliases?.length
      ? { ...result, aliases: unique([...result.aliases, ...manualMapping.aliases]) }
      : result;
  });

  merged.push(...remaining);
  return { entries: deduplicateEntries(merged), conflicts };
}

export async function buildReferenceCatalog(catalog: Catalog): Promise<ReferenceCatalogData> {
  const generatorEntries = buildGeneratorCatalog(catalog);
  const foundry = await loadFoundryEntries();
  const { entries, conflicts } = mergeReferenceEntries(generatorEntries, foundry.entries);
  const manifest: ReferenceCatalogManifest = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    generator: { repository: UPSTREAM_REPOSITORY, commit: UPSTREAM_COMMIT },
    foundry: foundry.manifest ?? {
      projectId: FOUNDRY_PROJECT_ID,
      repository: FOUNDRY_REPOSITORY,
      ref: FOUNDRY_REF,
      itemCount: foundry.entries.length,
    },
    entryCount: entries.length,
    conflictCount: conflicts.length,
  };
  return { manifest, entries, conflicts };
}

export function findCatalogEntry(
  entries: readonly CatalogEntry[],
  input: { name: string; type?: CatalogEntryType | ItemType; quality?: ItemQuality | null },
): CatalogEntry | undefined {
  const requestedQuality = input.quality ?? splitQuality(input.name).quality;
  const normalized = normalizeCatalogName(input.name);
  return entries
    .map((entry) => {
      if (input.type && entry.type !== input.type) return null;
      const names = [entry.name, ...entry.aliases].map(normalizeCatalogName);
      const nameIndex = names.indexOf(normalized);
      if (nameIndex < 0) return null;
      const quality = entryQuality(entry);
      let qualityScore = 0;
      if (requestedQuality) {
        if (quality === requestedQuality) qualityScore = 0;
        else if (quality === null) qualityScore = 1;
        else qualityScore = 5;
      } else if (quality && quality !== 'standard') {
        qualityScore = 2;
      }
      return { entry, score: nameIndex * 10 + qualityScore + foundryPreference(entry) / 100 };
    })
    .filter((candidate): candidate is { entry: CatalogEntry; score: number } => candidate !== null)
    .sort((left, right) => left.score - right.score || left.entry.id.localeCompare(right.entry.id))[0]?.entry;
}

export function foundryReference(pack?: string, documentId?: string, documentType?: string, img?: string): FoundryReference {
  return {
    projectId: FOUNDRY_PROJECT_ID,
    ref: FOUNDRY_REF,
    pack,
    documentId,
    documentType,
    img,
  };
}
