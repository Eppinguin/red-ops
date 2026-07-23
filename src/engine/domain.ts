import type {
  Catalog,
  FoundryInventoryNode,
  FoundryItem,
  GenerationRules,
  InventoryEntry,
  InventoryNode,
  Item,
  ItemData,
  ItemQuality,
  ModifierData,
  Npc,
  Rank,
  RankData,
  Role,
  RoleData,
  Skill,
  StatName,
  StatSkillValue,
} from './types';
import { STAT_NAMES } from './types';
import { clamp, getAllowedItems, NumpyRandom } from './random';

const PYTHON_DEFAULT_ITEM_ID = 'python-item-default';
const PYTHON_DEFAULT_CREATION_TIME = 0;
let clonedItemSequence = 0;

export function resetItemSequence(): void {
  clonedItemSequence = 0;
}

export function createItem(data: ItemData = {}): Item {
  return {
    name: data.name ?? 'Empty item',
    type: data.type ?? 'junk',
    price: data.price ?? 0,
    default_hidden: data.default_hidden ?? false,
    modifier_applying_priority: data.modifier_applying_priority ?? 0,
    unique_tags: [...(data.unique_tags ?? [])],
    tags: [...(data.tags ?? [])],
    modifiers: (data.modifiers ?? []).map((modifier) => ({
      name: modifier.name,
      simple: modifier.simple ?? 0,
      complicated: [...(modifier.complicated ?? [])],
    })),
    quality: data.quality ?? null,
    container_capacity: data.container_capacity ?? 0,
    size_in_container: data.size_in_container ?? 0,
    required_containers: [...(data.required_containers ?? [])],
    max_equipped_items: data.max_equipped_items ?? 0,
    armor_class: data.armor_class ?? null,
    damage: data.damage ?? null,
    rate_of_fire: data.rate_of_fire ?? null,
    magazine: data.magazine ?? null,
    ammo_types: [...(data.ammo_types ?? [])].sort(),
    skill: data.skill ?? null,
    max_humanity_loss: data.max_humanity_loss ?? 0,
    must_be_paired: data.must_be_paired ?? false,
    paired_container: data.paired_container ?? false,
    required_cyberware: [...(data.required_cyberware ?? [])],
    required_condition: [...(data.required_condition ?? [])],
    possible_names: [...(data.possible_names ?? [])].sort(),
    // The upstream dataclass evaluates these defaults at class definition time,
    // so non-cloned items intentionally share them. Clones receive fresh values.
    id: PYTHON_DEFAULT_ITEM_ID,
    creationTime: PYTHON_DEFAULT_CREATION_TIME,
  };
}

export function cloneItem(item: Item, changes: Partial<Item> = {}): Item {
  clonedItemSequence += 1;
  return {
    ...item,
    unique_tags: [...item.unique_tags],
    tags: [...item.tags],
    modifiers: item.modifiers.map((modifier) => ({ ...modifier, complicated: [...(modifier.complicated ?? [])] })),
    required_containers: [...item.required_containers],
    ammo_types: [...item.ammo_types],
    required_cyberware: [...item.required_cyberware],
    required_condition: [...item.required_condition],
    possible_names: [...item.possible_names],
    ...changes,
    id: `python-clone-${clonedItemSequence}`,
    creationTime: clonedItemSequence,
  };
}

export function copyItem(item: Item): Item {
  return {
    ...item,
    unique_tags: [...item.unique_tags],
    tags: [...item.tags],
    modifiers: item.modifiers.map((modifier) => ({ ...modifier, complicated: [...(modifier.complicated ?? [])] })),
    required_containers: [...item.required_containers],
    ammo_types: [...item.ammo_types],
    required_cyberware: [...item.required_cyberware],
    required_condition: [...item.required_condition],
    possible_names: [...item.possible_names],
  };
}

export function itemEqualityKey(item: Item): string {
  return JSON.stringify([
    item.name,
    item.type,
    item.price,
    item.default_hidden,
    item.modifier_applying_priority,
  ]);
}

export function containsAnyUniqueTag(first: Item, second: Item): boolean {
  return first.unique_tags.some((tag) => second.unique_tags.includes(tag));
}

export function getAllTags(item: Item): string[] {
  return [...item.unique_tags, ...item.tags];
}

/** Python compares strings lexicographically by Unicode code point, without locale collation. */
export function pythonStringCompare(first: string, second: string): number {
  if (first === second) return 0;
  return first < second ? -1 : 1;
}

export function priceCategory(price: number): string {
  if (price <= 10) return 'cheap';
  if (price <= 20) return 'everyday';
  if (price <= 50) return 'costly';
  if (price <= 100) return 'premium';
  if (price <= 500) return 'expensive';
  if (price <= 1000) return 'very_expensive';
  if (price <= 5000) return 'luxury';
  return 'super_luxury';
}

export function priceCategoryValue(price: number): number {
  if (price <= 10) return 0;
  if (price <= 20) return 1;
  if (price <= 50) return 2;
  if (price <= 100) return 3;
  if (price <= 500) return 4;
  if (price <= 1000) return 5;
  if (price <= 5000) return 6;
  return 7;
}

export function defaultPriceForCategory(category: number): number {
  return [10, 20, 50, 100, 500, 1000, 5000, 10000][category] ?? 10000;
}

export function itemToString(item: Item, short = false): string {
  let info = '';
  const pieces: string[] = [];
  if (item.price > 0) pieces.push(short ? `${item.price}eb` : `${item.price}eb (${priceCategory(item.price)})`);
  if (!short) {
    if (item.armor_class) pieces.push(`SP=${item.armor_class}/${item.armor_class}`);
    if (item.quality) pieces.push(item.quality);
    if (item.damage) pieces.push(`Damage=${item.damage}`);
    if (item.rate_of_fire) pieces.push(`ROF=${item.rate_of_fire}`);
    if (item.magazine) pieces.push(`Mag=/${item.magazine} ()`);
  }
  if (pieces.length) info = ` [${pieces.join(', ')}]`;
  return `${item.name}${info}`;
}

export function itemToFoundry(item: Item): FoundryItem {
  return { name: item.name, quality: item.quality };
}

export function createInventoryNode(item: Item): InventoryNode {
  return { item, children: [] };
}

export function copyInventoryNode(node: InventoryNode): InventoryNode {
  return { item: copyItem(node.item), children: node.children.map(copyInventoryNode) };
}

export function traverseInventory(node: InventoryNode): InventoryNode[] {
  return [node, ...node.children.flatMap(traverseInventory)];
}

export function inventoryNodeToFoundry(node: InventoryNode): FoundryInventoryNode {
  return { item: itemToFoundry(node.item), children: node.children.map(inventoryNodeToFoundry) };
}

export function inventoryNodeToString(node: InventoryNode, offset: number): string {
  if (node.item.default_hidden && node.children.length === 0) return '';
  let result = `${'    '.repeat(offset)}${itemToString(node.item, true)}`;
  if (node.item.container_capacity !== 0 && node.item.container_capacity < 100) {
    const used = node.children.reduce((sum, child) => sum + child.item.size_in_container, 0);
    result += ` [${used}/${node.item.container_capacity}]`;
  }
  result += '\n';
  for (const child of node.children) result += inventoryNodeToString(child, offset + 1);
  return result;
}

function evaluateRequiredCondition(lines: readonly string[], npc: Npc): boolean {
  if (lines.length === 0) return true;
  const source = lines.join('\n');
  const match = source.match(/get_stat_or_skill_value\(["']([^"']+)["']\)\.get_total\(\)\s*(>=|<=|<|>|==)\s*(-?\d+)/);
  if (!match) throw new Error(`Unsupported upstream required_condition: ${source}`);
  const [, name, operator, rawExpected] = match;
  const actual = getStatOrSkillValue(npc, name!).value + getStatOrSkillValue(npc, name!).totalModifier;
  const expected = Number(rawExpected);
  switch (operator) {
    case '>=': return actual >= expected;
    case '<=': return actual <= expected;
    case '>': return actual > expected;
    case '<': return actual < expected;
    case '==': return actual === expected;
    default: return false;
  }
}

export function canAddChild(
  node: InventoryNode,
  child: Item,
  npc: Npc,
  maxAllowedContainerNormalizedIndex = 1,
): string | null {
  const allowed = getAllowedItems(child.required_containers, maxAllowedContainerNormalizedIndex);
  if (!allowed.includes(node.item.name)) return `Can't add ${child.name} to ${node.item.name}`;
  const used = node.children.reduce((sum, entry) => sum + entry.item.size_in_container, 0);
  if (used + child.size_in_container > node.item.container_capacity) return `The container is full: ${node.item.name}`;
  if (!evaluateRequiredCondition(child.required_condition, npc)) return `The required condition isn't fulfilled`;
  return null;
}

export function addChild(
  node: InventoryNode,
  child: Item,
  npc: Npc,
  maxAllowedContainerNormalizedIndex = 1,
): InventoryNode | null {
  if (canAddChild(node, child, npc, maxAllowedContainerNormalizedIndex)) return null;
  const added = createInventoryNode(cloneItem(child));
  node.children.push(added);
  return added;
}

function applyComplicatedModifier(
  modifier: ModifierData,
  startValue: number,
  currentModifier: number,
): number {
  const source = (modifier.complicated ?? []).join('\n');
  const fixed = source.match(/new_value\s*=\s*(-?\d+)\s*[\r\n]+new_modifier\s*=\s*new_value\s*-\s*start_value/);
  if (fixed) return Number(fixed[1]) - startValue;
  const capped = source.match(/new_value\s*=\s*min\(start_value\s*\+\s*current_modifier\s*\+\s*(-?\d+),\s*(-?\d+)\)/);
  if (capped) return Math.min(startValue + currentModifier + Number(capped[1]), Number(capped[2])) - startValue;
  throw new Error(`Unsupported upstream complicated modifier: ${source}`);
}

export function applyModifier(
  modifier: ModifierData,
  name: string,
  startValue: number,
  currentModifier: number,
): number {
  if (name.toLowerCase() !== modifier.name.toLowerCase()) return currentModifier;
  if ((modifier.complicated ?? []).length > 0) return applyComplicatedModifier(modifier, startValue, currentModifier);
  return currentModifier + (modifier.simple ?? 0);
}

export function getAllItems(npc: Npc): Item[] {
  return [
    ...traverseInventory(npc.cyberware).map((node) => node.item),
    ...[...npc.inventory.values()].map((entry) => entry.item),
    ...npc.armor,
    ...npc.weapons,
  ];
}

export function getStatOrSkillValue(npc: Npc, name: string): StatSkillValue {
  let startValue: number;
  if ((STAT_NAMES as readonly string[]).includes(name) && npc.stats.has(name as StatName)) {
    startValue = npc.stats.get(name as StatName)!;
  } else {
    const skill = npc.skills.get(name);
    if (!skill) throw new Error(`Unknown stat or skill: ${name}`);
    startValue = skill.level;
  }

  const equipped = getAllItems(npc).sort((a, b) =>
    b.modifier_applying_priority - a.modifier_applying_priority || b.creationTime - a.creationTime,
  );
  let totalModifier = 0;
  const modifiers: StatSkillValue['modifiers'] = [];
  for (const item of equipped) {
    for (const modifier of item.modifiers) {
      const next = applyModifier(modifier, name, startValue, totalModifier);
      if (next !== totalModifier) modifiers.push({ itemName: item.name, value: next - totalModifier });
      totalModifier = next;
    }
  }
  return { value: startValue, totalModifier, modifiers };
}

export function getSkillTotalValue(npc: Npc, skillName: string): number {
  const entry = npc.skills.get(skillName);
  if (!entry) throw new Error(`Unknown skill: ${skillName}`);
  const stat = getStatOrSkillValue(npc, entry.skill.link);
  const skill = getStatOrSkillValue(npc, skillName);
  return stat.value + stat.totalModifier + skill.value + skill.totalModifier;
}

export function addInventoryItem(npc: Npc, item: Item, amount: number): void {
  const key = itemEqualityKey(item);
  const existing = npc.inventory.get(key);
  npc.inventory.set(key, { item: existing?.item ?? item, amount: (existing?.amount ?? 0) + amount });
}

export function setInventoryItem(npc: Npc, item: Item, amount: number): void {
  npc.inventory.set(itemEqualityKey(item), { item, amount });
}

export function findInventoryEntry(npc: Npc, item: Item): InventoryEntry | undefined {
  return npc.inventory.get(itemEqualityKey(item));
}

export function createNpc(meatbody: Item): Npc {
  return {
    sex: false,
    nationality: null,
    age: 0,
    name: '',
    surname: '',
    description: '',
    stats: new Map(),
    skills: new Map(),
    cyberware: createInventoryNode(meatbody),
    armor: [],
    weapons: [],
    inventory: new Map(),
    traumaTeamStatus: 'NONE',
  };
}

const zeroDistribution = { mean: 0, standard_deviation: 0 };

export function hydrateRank(data: RankData, rankNumber: number): Rank {
  return {
    name: data.name,
    rankNumber,
    min_items_quality: data.min_items_quality ?? 'poor',
    items_budget: { ...(data.items_budget ?? {}) },
    items_num_budget: { ...(data.items_num_budget ?? {}) },
    stats_budget: data.stats_budget ?? zeroDistribution,
    skills_budget: data.skills_budget ?? zeroDistribution,
    pocket_money: data.pocket_money ?? zeroDistribution,
    trauma_team_status_weights: [...(data.trauma_team_status_weights ?? [])],
    container_selection: data.container_selection ?? zeroDistribution,
  };
}

export function hydrateRole(data: RoleData): Role {
  return {
    name: data.name,
    skills: { ...(data.skills ?? {}) },
    preferred_cyberware: [...(data.preferred_cyberware ?? [])],
    preferred_primary_weapons: [...(data.preferred_primary_weapons ?? [])].sort(),
    preferred_secondary_weapons: [...(data.preferred_secondary_weapons ?? [])].sort(),
    preferred_ammo: [...(data.preferred_ammo ?? [])],
    preferred_armor_class: data.preferred_armor_class ?? 11,
    preferred_drugs: [...(data.preferred_drugs ?? [])],
    preferred_equipment: [...(data.preferred_equipment ?? [])],
    min_empathy: data.min_empathy ?? 0,
    martial_arts_probability: data.martial_arts_probability ?? 0,
  };
}

export function distributionValue(
  random: NumpyRandom,
  distribution: { mean: number; standard_deviation: number } | undefined,
): number {
  return random.normal(distribution?.mean ?? 0, distribution?.standard_deviation ?? 0);
}

export function resolveRank(catalog: Catalog, rank: string): Rank {
  const numeric = /^\d+$/.test(rank);
  const rankNumber = numeric ? Number(rank) : catalog.ranks.findIndex((entry) => entry.name === rank);
  const data = catalog.ranks[rankNumber];
  if (!data) throw new Error(`Unknown rank: ${rank}`);
  return hydrateRank(data, rankNumber);
}

export function resolveRole(catalog: Catalog, role: string): Role {
  const data = catalog.roles.find((entry) => entry.name === role);
  if (!data) throw new Error(`Unknown role: ${role}`);
  return hydrateRole(data);
}

export function normalisedContainerSelection(random: NumpyRandom, rank: Rank): number {
  return clamp(distributionValue(random, rank.container_selection), 0, 1);
}

export function qualityOptions(minimum: ItemQuality): ItemQuality[] {
  if (minimum === 'excellent') return ['excellent'];
  if (minimum === 'standard') return ['standard', 'excellent'];
  return ['poor', 'standard', 'excellent'];
}

export function skillToString(npc: Npc, skill: Skill): string {
  const linked = getStatOrSkillValue(npc, skill.link);
  const value = getStatOrSkillValue(npc, skill.name);
  let result = `[${linked.value + linked.totalModifier}(${skill.link})`;
  if (value.value > 0) result += `${value.value >= 0 ? '+' : ''}${value.value}`;
  for (const modifier of value.modifiers) result += `${modifier.value >= 0 ? '+' : ''}${modifier.value}(${modifier.itemName})`;
  result += `=${linked.value + linked.totalModifier + value.value + value.totalModifier}] ${skill.name}`;
  return result;
}

export function generationRulesFromOptions(options: GenerationRules): GenerationRules {
  return { ...options };
}
