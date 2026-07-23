import { allFakers, fakerEN_US, type Faker } from '@faker-js/faker';
import unidecode from 'unidecode-plus';
import type { CatalogEntry } from '../content/types';
import type { Catalog, GenerateOptions, InventoryNode, Item, Npc, Rank, Role } from './types';
import type { NumpyRandom } from './random';
import { pythonRound } from './random';

const NAME_GENERATION_ATTEMPTS = 5;

function fakerForLocale(locale: string): Faker {
  const exact = (allFakers as unknown as Record<string, Faker>)[locale];
  if (exact) return exact;
  const language = locale.split('_')[0]!;
  const related = Object.entries(allFakers as unknown as Record<string, Faker>)
    .find(([key]) => key.startsWith(`${language}_`) || key === language);
  return related?.[1] ?? fakerEN_US;
}

function transliterateNamePart(value: string): string | null {
  // unidecode-plus represents characters missing from its lookup tables as
  // underscores. Do not let those implementation placeholders become a name.
  const transliterated = unidecode(value, { smartSpacing: true })
    .replace(/_+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return /[a-z0-9]/i.test(transliterated) ? transliterated : null;
}

function generatedName(faker: Faker, sex: 'male' | 'female'): { name: string; surname: string } | null {
  const name = transliterateNamePart(faker.person.firstName(sex));
  const surname = transliterateNamePart(faker.person.lastName(sex));
  return name && surname ? { name, surname } : null;
}

export function generateIdentity(
  npc: Npc,
  rank: Rank,
  nationality: string,
  random: NumpyRandom,
  seed: number,
): void {
  npc.sex = random.choice([true, false]);
  npc.nationality = nationality;
  npc.age = pythonRound(random.normal(20 + 5 * rank.rankNumber, 2));

  const faker = fakerForLocale(nationality);
  faker.seed(seed);
  const sex = npc.sex ? 'male' : 'female';
  let identity: { name: string; surname: string } | null = null;
  for (let attempt = 0; attempt < NAME_GENERATION_ATTEMPTS && !identity; attempt += 1) {
    identity = generatedName(faker, sex);
  }

  if (!identity) {
    fakerEN_US.seed(seed);
    identity = generatedName(fakerEN_US, sex);
  }

  // The English Faker data is ASCII, but keep a final invariant at this
  // boundary so a future dependency-data regression still cannot emit blanks.
  npc.name = identity?.name ?? (npc.sex ? 'Alex' : 'Morgan');
  npc.surname = identity?.surname ?? 'Reed';
}

function enumName(value: string | null): string | null {
  return value === null ? null : value.toUpperCase();
}

function serializableModifier(modifier: Item['modifiers'][number]): Record<string, unknown> {
  return {
    name: modifier.name,
    simple: modifier.simple ?? 0,
    complicated: [...(modifier.complicated ?? [])],
  };
}

function serializableItem(item: Item): Record<string, unknown> {
  const value: Record<string, unknown> = {
    name: item.name,
    type: enumName(item.type),
    price: item.price,
    default_hidden: item.default_hidden,
    modifier_applying_priority: item.modifier_applying_priority,
    unique_tags: [...item.unique_tags],
    tags: [...item.tags],
    modifiers: item.modifiers.map(serializableModifier),
    quality: enumName(item.quality),
    container_capacity: item.container_capacity,
    size_in_container: item.size_in_container,
    required_containers: [...item.required_containers],
    max_equipped_items: item.max_equipped_items,
    armor_class: item.armor_class,
    damage: item.damage,
    rate_of_fire: item.rate_of_fire,
    magazine: item.magazine,
    ammo_types: [...item.ammo_types],
    skill: item.skill,
    max_humanity_loss: item.max_humanity_loss,
    must_be_paired: item.must_be_paired,
    paired_container: item.paired_container,
    required_cyberware: [...item.required_cyberware],
    required_condition: [...item.required_condition],
  };
  if (item.possible_names.length > 0) value.possible_names = [...item.possible_names];
  return value;
}

function serializableNode(node: InventoryNode): Record<string, unknown> {
  return { item: serializableItem(node.item), children: node.children.map(serializableNode) };
}

function pythonRepr(value: unknown): string {
  if (value === null) return 'None';
  if (typeof value === 'boolean') return value ? 'True' : 'False';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') {
    return `'${value
      .replace(/\\/g, '\\\\')
      .replace(/'/g, "\\'")
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t')}'`;
  }
  if (Array.isArray(value)) return `[${value.map(pythonRepr).join(', ')}]`;
  if (typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => `${pythonRepr(key)}: ${pythonRepr(item)}`)
      .join(', ')}}`;
  }
  return pythonRepr(String(value));
}

/** Python json.dumps(..., ensure_ascii=False) with its default separators. */
function pythonJsonDumps(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NaN';
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(pythonJsonDumps).join(', ')}]`;
  if (typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => `${JSON.stringify(key)}: ${pythonJsonDumps(item)}`)
      .join(', ')}}`;
  }
  throw new TypeError(`Unsupported JSON value: ${String(value)}`);
}

function serializableRank(rank: Rank): Record<string, unknown> {
  const distributions = (source: Rank['items_budget']) => Object.fromEntries(
    Object.entries(source).map(([key, value]) => [key.toUpperCase(), value]),
  );
  return {
    name: rank.name,
    rank_number: rank.rankNumber,
    min_items_quality: enumName(rank.min_items_quality),
    items_budget: distributions(rank.items_budget),
    items_num_budget: distributions(rank.items_num_budget),
    stats_budget: rank.stats_budget,
    skills_budget: rank.skills_budget,
    pocket_money: rank.pocket_money,
    trauma_team_status_weights: [...rank.trauma_team_status_weights],
    container_selection: rank.container_selection,
  };
}

function serializableRole(role: Role): Record<string, unknown> {
  return {
    name: role.name,
    skills: { ...role.skills },
    preferred_cyberware: [...role.preferred_cyberware],
    preferred_primary_weapons: [...role.preferred_primary_weapons],
    preferred_secondary_weapons: [...role.preferred_secondary_weapons],
    preferred_ammo: [...role.preferred_ammo],
    preferred_armor_class: role.preferred_armor_class,
    preferred_drugs: [...role.preferred_drugs],
    preferred_equipment: [...role.preferred_equipment],
    min_empathy: role.min_empathy,
    martial_arts_probability: role.martial_arts_probability,
  };
}

function serializableRules(options: GenerateOptions): Record<string, boolean> {
  return {
    allow_non_basic_ammo: options.allow_non_basic_ammo,
    allow_grenades: options.allow_grenades,
    allow_armor: options.allow_armor,
    allow_cyberware: options.allow_cyberware,
    allow_borgware: options.allow_borgware,
    allow_drugs: options.allow_drugs,
    allow_equipment: options.allow_equipment,
    allow_money: options.allow_money,
    allow_junk: options.allow_junk,
    allow_melee_weapon: options.allow_melee_weapon,
    allow_ranged_weapon: options.allow_ranged_weapon,
    allow_martial_arts: options.allow_martial_arts,
  };
}

function serializableNpc(npc: Npc): Record<string, unknown> {
  const skills: Record<string, number> = {};
  for (const entry of npc.skills.values()) {
    const key = pythonRepr({
      name: entry.skill.name,
      link: entry.skill.link,
      type: entry.skill.type.toUpperCase(),
    });
    skills[key] = entry.level;
  }

  const inventory: Record<string, number> = {};
  for (const entry of npc.inventory.values()) inventory[pythonRepr(serializableItem(entry.item))] = entry.amount;

  return {
    sex: npc.sex,
    nationality: npc.nationality,
    age: npc.age,
    name: npc.name,
    surname: npc.surname,
    stats: Object.fromEntries(npc.stats),
    skills,
    cyberware: serializableNode(npc.cyberware),
    armor: npc.armor.map(serializableItem),
    weapons: npc.weapons.map(serializableItem),
    inventory,
    trauma_team_status: npc.traumaTeamStatus,
  };
}

function normalizeReferenceName(value: string): string {
  return value
    .replace(/^(Head|Body):\s*/i, '')
    .replace(/\s+\((Poor|Standard|Excellent)\)$/i, '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function referenceContext(npc: Npc, entries: readonly CatalogEntry[]): Array<Record<string, unknown>> {
  if (entries.length === 0) return [];
  const items: Item[] = [];
  const walk = (node: InventoryNode): void => {
    if (!node.item.default_hidden) items.push(node.item);
    for (const child of node.children) walk(child);
  };
  walk(npc.cyberware);
  items.push(...npc.armor, ...npc.weapons, ...[...npc.inventory.values()].map((entry) => entry.item));

  const seen = new Set<string>();
  const result: Array<Record<string, unknown>> = [];
  for (const item of items) {
    const key = `${item.type}:${normalizeReferenceName(item.name)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const reference = entries.find((entry) =>
      entry.type === item.type
      && [entry.name, ...entry.aliases].some((name) => normalizeReferenceName(name) === normalizeReferenceName(item.name)),
    );
    if (!reference) continue;
    result.push({
      name: reference.name,
      type: reference.type,
      summary: reference.summary,
      usage: reference.usage,
      mechanics: reference.mechanics,
      price: reference.price,
      source: reference.source,
    });
  }
  return result;
}

export async function generateAiDescription(
  npc: Npc,
  rank: Rank,
  role: Role,
  nationality: string,
  catalog: Catalog,
  options: GenerateOptions,
  seed: number,
  referenceEntries: readonly CatalogEntry[] = [],
): Promise<string | null> {
  if (!options.model_id || !options.model_api_key || !options.model_base_url) return null;

  const references = referenceContext(npc, referenceEntries);
  const context = {
    npc: serializableNpc(npc),
    npc_template: {
      rank: serializableRank(rank),
      role: serializableRole(role),
      generation_rules: serializableRules(options),
      nationality,
    },
    ...(references.length ? { reference_context: references } : {}),
  };

  const response = await fetch(`${options.model_base_url.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${options.model_api_key}`, 'Content-Type': 'application/json' },
    body: pythonJsonDumps({
      model: options.model_id,
      messages: [
        { role: 'system', content: `${catalog.descriptionPrompt} Write the description in ${options.model_language}.${references.length ? ' Use the supplied reference_context for item facts and do not invent mechanics.' : ''}` },
        { role: 'user', content: pythonJsonDumps(context) },
      ],
      temperature: 0.5,
      seed,
    }),
  });
  if (!response.ok) throw new Error(`AI server returned HTTP ${response.status}`);
  const body = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  return body.choices?.[0]?.message?.content?.trim() || null;
}
