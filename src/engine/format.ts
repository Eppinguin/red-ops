import {
  getAllItems,
  getAllTags,
  getSkillTotalValue,
  getStatOrSkillValue,
  inventoryNodeToFoundry,
  inventoryNodeToString,
  itemToFoundry,
  itemToString,
  pythonStringCompare,
  skillToString,
  traverseInventory,
} from './domain';
import { weaponAttackValues, weaponSkillName, type GeneratedCore } from './generator';
import type { CatalogEntry } from '../content/types';
import { createCombatSummary, createItemExplanations, createProfileSummary, validateGeneratedNpc } from './enrich';
import type {
  Catalog,
  FoundryNpc,
  GeneratedNpcView,
  InventoryEntry,
  Item,
  ItemType,
  StatName,
} from './types';
import { SKILL_TYPES } from './types';

class TableView {
  private readonly columns: string[][];
  private readonly parts: string[][] = [];

  constructor(numColumns = 3, private readonly indent = 4) {
    if (numColumns < 1) throw new Error('numColumns must be at least 1');
    this.columns = Array.from({ length: numColumns }, () => []);
  }

  add(part: string[], header?: string, columnNumber?: number): void {
    if (part.length === 0) return;
    if (columnNumber !== undefined && columnNumber < this.columns.length) {
      if (header) this.columns[columnNumber]!.push(header);
      this.columns[columnNumber]!.push(...part);
    } else {
      this.parts.push(header ? [header, ...part] : part);
    }
  }

  toString(): string {
    const sortedParts = [...this.parts].sort((a, b) => b.length - a.length);
    const columns = this.columns.map((column) => [...column]);
    for (const part of sortedParts) {
      let minimumIndex = 0;
      for (let index = 1; index < columns.length; index += 1) {
        if (columns[index]!.length < columns[minimumIndex]!.length) minimumIndex = index;
      }
      columns[minimumIndex]!.push(...part);
    }
    const populated = columns.filter((column) => column.length > 0);
    if (!populated.length) return '';
    const vertical = Math.max(...populated.map((column) => column.length));
    const widths = populated.map((column) => Math.max(...column.map((value) => value.length)));
    let result = '';
    for (let row = 0; row < vertical; row += 1) {
      for (let column = 0; column < populated.length; column += 1) {
        result += (populated[column]![row] ?? '').padEnd(widths[column]! + this.indent, ' ');
      }
      result += '\n';
    }
    return result;
  }
}

function pythonTitle(value: string): string {
  return value.replace(/[A-Za-z]+/g, (word) => word[0]!.toUpperCase() + word.slice(1).toLowerCase());
}

function wrapLine(line: string, width: number, indent: string): string {
  if (!line) return '';
  const words = line.split(/\s+/);
  const lines: string[] = [];
  let current = indent;
  for (const word of words) {
    if (current.trim() && current.length + 1 + word.length > width) {
      lines.push(current);
      current = `${indent}${word}`;
    } else {
      current += `${current.trim() ? ' ' : ''}${word}`;
    }
  }
  lines.push(current);
  return lines.join('\n');
}

function statDisplay(core: GeneratedCore, stat: StatName): string {
  const value = getStatOrSkillValue(core.npc, stat);
  let result = `    [${value.value}`;
  for (const modifier of value.modifiers) result += `${modifier.value >= 0 ? '+' : ''}${modifier.value}(${modifier.itemName})`;
  if (value.totalModifier !== 0) result += `=${value.value + value.totalModifier}`;
  return `${result}] ${stat}`;
}

function findTaggedItem(items: Item[], tag: string): Item | null {
  return items.find((item) => item.unique_tags.includes(tag)) ?? null;
}

function weaponDisplay(core: GeneratedCore, item: Item, catalog: Catalog): string {
  const { skill, autofire } = weaponAttackValues(core.npc, item, catalog);
  const prefix = autofire ? `[${skill}(S)/${autofire}(A)]` : `[${skill}]`;
  const copy = { ...item, name: `${prefix} ${item.name}` };
  return itemToString(copy);
}

function getInventoryPart(
  entries: InventoryEntry[],
  types: ItemType[],
): string[] {
  return entries
    .filter((entry) => types.includes(entry.item.type))
    .sort((a, b) => b.item.price * b.amount - a.item.price * a.amount)
    .map((entry) => `    ${entry.amount !== 0 ? `[${entry.amount}] ` : ''}${itemToString(entry.item)}`);
}

export function formatNpcText(core: GeneratedCore, catalog: Catalog): string {
  const { npc, options } = core;
  const allItems = getAllItems(npc);
  const statValues = new Map([...npc.stats.keys()].map((stat) => [stat, getStatOrSkillValue(npc, stat)]));
  let result = `${npc.name} ${npc.surname} (${npc.nationality}, ${npc.age} yo)\n`;
  if (npc.description) {
    result += `\n${npc.description.split('\n').map((line) => wrapLine(line, 116, '    ')).join('\n')}\n\n`;
  }
  result += `Has items total worth of ${allItems.reduce((sum, item) => sum + item.price, 0)}eb\n\n`;

  const body = statValues.get('BODY')!;
  const will = statValues.get('WILL')!;
  const hp = 10 + 5 * Math.ceil(0.5 * ((body.value + body.totalModifier) + (will.value + will.totalModifier)));
  const painEditor = traverseInventory(npc.cyberware).some((node) => node.item.name === 'Pain Editor');
  const reflex = statValues.get('REF')!;
  const reflexProcessor = traverseInventory(npc.cyberware).some((node) => node.item.name === 'Reflex Co-Processor');
  const canEvade = reflex.value + reflex.totalModifier >= 8 || reflexProcessor;
  const conditions = [
    `    HP: ${hp}/${hp} (Seriously Wounded: ${painEditor ? 'No, Pain Editor' : Math.ceil(hp / 2)})`,
    `    TraumaTeam status: ${npc.traumaTeamStatus}`,
    `    Can evade bullets: ${canEvade ? 'True' : 'False'}${canEvade ? ` (${reflex.value + reflex.totalModifier >= 8 ? 'REF >= 8' : 'Reflex Co-Processor'})` : ''}`,
  ];
  const conditionSpecs: Array<[string, string, string]> = [
    ['No intangible obscurement penalties', 'ImprovedVision', ''],
    ['Has flashes of light protection', 'LightFlashesProtection', ''],
    ['Has ears protection', 'EarsProtection', ''],
    ['Has breath protection', 'AirProtection', ''],
  ];
  for (const [label, tag] of conditionSpecs) {
    const item = findTaggedItem(allItems, tag);
    conditions.push(`    ${label}: ${item ? 'True' : 'False'}${item ? ` (${item.name})` : ''}`);
  }

  const statsConditions = new TableView(options.flat ? 1 : 4);
  statsConditions.add(conditions, 'Conditions:', 1);
  statsConditions.add([...npc.stats.keys()].map((stat) => statDisplay(core, stat)), 'Stats:', 0);
  statsConditions.add(allItems.filter((item) => getAllTags(item).includes('Action')).map((item) => `    ${item.name}`), 'Actions:', 2);
  statsConditions.add(allItems.filter((item) => getAllTags(item).includes('Ability')).map((item) => `    ${item.name}`), 'Abilities:', 3);
  result += `${statsConditions.toString()}\n`;

  result += 'Skills:\n';
  const skillsTable = new TableView(options.flat ? 1 : 3);
  for (const type of SKILL_TYPES) {
    const skills = [...npc.skills.values()].filter((entry) => entry.skill.type === type);
    if (!skills.length) continue;
    skillsTable.add([
      pythonTitle(type),
      ...skills.map((entry) => `    ${skillToString(npc, entry.skill)}`),
    ]);
  }
  result += `    ${skillsTable.toString().replace(/\n/g, '\n    ')}\n`;

  if (npc.cyberware.children.length) {
    result += 'Cyberware:\n';
    const cyberwareTable = new TableView(options.flat ? 1 : 3);
    for (const child of npc.cyberware.children) cyberwareTable.add(inventoryNodeToString(child, 0).replace(/\n$/, '').split('\n'));
    result += `    ${cyberwareTable.toString().replace(/\n/g, '\n    ')}\n`;
  }

  if (npc.armor.length || npc.weapons.length) {
    const equipment = new TableView(options.flat ? 1 : 2);
    if (npc.armor.length) equipment.add(npc.armor.map((item) => `    ${itemToString(item)}`), 'Armor:', 0);
    if (npc.weapons.length) {
      const melee = npc.weapons.filter((item) => getAllTags(item).includes('MeleeWeapon')).map((item) => `    ${weaponDisplay(core, item, catalog)}`);
      const ranged = npc.weapons.filter((item) => getAllTags(item).includes('RangedWeapon')).map((item) => `    ${weaponDisplay(core, item, catalog)}`);
      if (ranged.length) equipment.add(ranged, 'Ranged weapons:', 1);
      if (melee.length) equipment.add(melee, 'Melee weapons:', 1);
    }
    result += `${equipment.toString()}\n`;
  }

  if (npc.inventory.size) {
    result += 'Inventory:\n';
    const inventoryTable = new TableView(options.flat ? 1 : 3);
    const entries = [...npc.inventory.values()];
    inventoryTable.add(getInventoryPart(entries, ['ammo']), 'Ammo', 0);
    inventoryTable.add(getInventoryPart(entries, ['equipment', 'drug']), 'Equipment / Drugs', 1);
    inventoryTable.add(getInventoryPart(entries, ['junk']), 'Junk', 2);
    result += `    ${inventoryTable.toString().replace(/\n/g, '\n    ')}\n`;
  }
  return result;
}

export function toFoundryNpc(core: GeneratedCore): FoundryNpc {
  const { npc } = core;
  return {
    sex: npc.sex,
    nationality: npc.nationality,
    age: npc.age,
    name: npc.name,
    surname: npc.surname,
    description: npc.description,
    stats: Object.fromEntries(npc.stats) as FoundryNpc['stats'],
    skills: Object.fromEntries([...npc.skills].map(([name, entry]) => [name, entry.level])),
    cyberware: npc.cyberware ? inventoryNodeToFoundry(npc.cyberware) : null,
    armor: npc.armor.map(itemToFoundry),
    weapons: npc.weapons.map(itemToFoundry),
    inventory: [...npc.inventory.values()]
      .sort((a, b) => pythonStringCompare(a.item.name, b.item.name))
      .map((entry) => ({ item: itemToFoundry(entry.item), amount: entry.amount })),
    trauma_team_status: npc.traumaTeamStatus,
  };
}

function commandLine(core: GeneratedCore): string {
  const options = core.options;
  const bool = (name: string, value: boolean) => value ? `--${name}` : `--no-${name}`;
  return [
    `--rank=${options.rank}`,
    `--role=${options.role}`,
    `--nationality=${options.nationality}`,
    bool('allow-non-basic-ammo', options.allow_non_basic_ammo),
    bool('allow-grenades', options.allow_grenades),
    bool('allow-armor', options.allow_armor),
    bool('allow-cyberware', options.allow_cyberware),
    bool('allow-borgware', options.allow_borgware),
    bool('allow-drugs', options.allow_drugs),
    bool('allow-equipment', options.allow_equipment),
    bool('allow-money', options.allow_money),
    bool('allow-junk', options.allow_junk),
    bool('allow-melee-weapon', options.allow_melee_weapon),
    bool('allow-ranged-weapon', options.allow_ranged_weapon),
    bool('allow-martial-arts', options.allow_martial_arts),
    `--seed=${core.seed}`,
    options.model_id ? `--model-id=${options.model_id}` : '--no-model-id',
    options.model_api_key ? '--model-api-key=\"$MODEL_API_KEY\"' : '--no-model-api-key',
    options.model_base_url ? `--model-base-url=${options.model_base_url}` : '--no-model-base-url',
    `--model-language=${options.model_language}`,
    bool('flat', options.flat),
    '--no-foundry-json',
    '--log-level=INFO',
  ].join(' ');
}

export function createGeneratedView(
  core: GeneratedCore,
  catalog: Catalog,
  referenceEntries: readonly CatalogEntry[] = [],
  revisions: GeneratedNpcView['revisions'] = [],
): GeneratedNpcView {
  const allItems = getAllItems(core.npc);
  const stats = [...core.npc.stats].map(([name]) => {
    const value = getStatOrSkillValue(core.npc, name);
    return { name, base: value.value, modifier: value.totalModifier, total: value.value + value.totalModifier, sources: value.modifiers };
  });
  const body = stats.find((stat) => stat.name === 'BODY')!.total;
  const will = stats.find((stat) => stat.name === 'WILL')!.total;
  const maxHp = 10 + 5 * Math.ceil(0.5 * (body + will));
  const painEditor = traverseInventory(core.npc.cyberware).some((node) => node.item.name === 'Pain Editor');
  const ref = stats.find((stat) => stat.name === 'REF')!.total;
  const reflexProcessor = traverseInventory(core.npc.cyberware).some((node) => node.item.name === 'Reflex Co-Processor');
  const tagged = (tag: string) => findTaggedItem(allItems, tag)?.name ?? null;

  return {
    npc: core.npc,
    rank: core.rank,
    role: core.role,
    options: { ...core.options, model_api_key: null },
    seed: core.seed,
    command: commandLine(core),
    text: formatNpcText(core, catalog),
    foundry: toFoundryNpc(core),
    totalPrice: allItems.reduce((sum, item) => sum + item.price, 0),
    stats,
    skills: [...core.npc.skills.values()].map((entry) => {
      const value = getStatOrSkillValue(core.npc, entry.skill.name);
      return {
        name: entry.skill.name,
        type: entry.skill.type,
        link: entry.skill.link,
        base: value.value,
        modifier: value.totalModifier,
        total: getSkillTotalValue(core.npc, entry.skill.name),
        display: skillToString(core.npc, entry.skill),
      };
    }),
    hp: { current: maxHp, max: maxHp, seriouslyWounded: painEditor ? null : Math.ceil(maxHp / 2), painEditor },
    conditions: [
      { label: 'Can evade bullets', value: ref >= 8 || reflexProcessor, source: ref >= 8 ? 'REF >= 8' : reflexProcessor ? 'Reflex Co-Processor' : null },
      { label: 'No intangible obscurement penalties', value: Boolean(tagged('ImprovedVision')), source: tagged('ImprovedVision') },
      { label: 'Flashes of light protection', value: Boolean(tagged('LightFlashesProtection')), source: tagged('LightFlashesProtection') },
      { label: 'Ears protection', value: Boolean(tagged('EarsProtection')), source: tagged('EarsProtection') },
      { label: 'Breath protection', value: Boolean(tagged('AirProtection')), source: tagged('AirProtection') },
    ],
    actions: allItems.filter((item) => getAllTags(item).includes('Action')).map((item) => item.name),
    abilities: allItems.filter((item) => getAllTags(item).includes('Ability')).map((item) => item.name),
    profileSummary: createProfileSummary(core),
    combat: createCombatSummary(core, catalog),
    validation: validateGeneratedNpc(core, catalog, referenceEntries),
    itemExplanations: createItemExplanations(core, catalog, referenceEntries),
    revisions,
  };
}

export function describeWeapon(item: Item, core: GeneratedCore, catalog: Catalog): string {
  const name = weaponSkillName(item, catalog);
  const values = weaponAttackValues(core.npc, item, catalog);
  return `${name ?? 'Unknown'} ${values.skill ?? '—'}${values.autofire ? ` / Autofire ${values.autofire}` : ''}`;
}
