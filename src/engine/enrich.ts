import { findCatalogEntry } from '../content/catalog';
import type { CatalogEntry } from '../content/types';
import {
  getAllItems,
  getAllTags,
  getSkillTotalValue,
  getStatOrSkillValue,
  traverseInventory,
} from './domain';
import { weaponAttackValues, weaponSkillName, type GeneratedCore } from './generator';
import type {
  Catalog,
  CombatSummary,
  GeneratedItemExplanation,
  InventoryNode,
  Item,
  ValidationIssue,
} from './types';

function humanize(value: string): string {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function bestSkill(core: GeneratedCore): { name: string; total: number } | null {
  const values = [...core.npc.skills.values()]
    .map((entry) => ({ name: entry.skill.name, total: getSkillTotalValue(core.npc, entry.skill.name) }))
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  return values[0] ?? null;
}

export function createProfileSummary(core: GeneratedCore): string {
  if (core.npc.description.trim()) return core.npc.description.trim();
  const best = bestSkill(core);
  const visibleCyberware = traverseInventory(core.npc.cyberware)
    .filter((node) => node !== core.npc.cyberware && !node.item.default_hidden);
  const primary = core.npc.weapons.find((weapon) => !getAllTags(weapon).includes('Brawling')) ?? core.npc.weapons[0];
  const sentences = [
    `${core.npc.name} ${core.npc.surname} is a ${humanize(core.rank.name).toLowerCase()} ${humanize(core.role.name).toLowerCase()} from ${core.npc.nationality ?? 'an unspecified background'}.`,
    best ? `Their strongest listed capability is ${best.name} at base ${best.total}.` : '',
    primary ? `Their primary combat option is ${primary.name}${primary.damage ? ` (${primary.damage})` : ''}.` : '',
    visibleCyberware.length
      ? `They carry ${visibleCyberware.length} visible or mechanically relevant cyberware component${visibleCyberware.length === 1 ? '' : 's'}.`
      : 'They have no generated cyberware loadout.',
  ].filter(Boolean);
  return sentences.join(' ');
}

export function createCombatSummary(core: GeneratedCore, catalog: Catalog): CombatSummary {
  const body = getStatOrSkillValue(core.npc, 'BODY');
  const will = getStatOrSkillValue(core.npc, 'WILL');
  const ref = getStatOrSkillValue(core.npc, 'REF');
  const bodyTotal = body.value + body.totalModifier;
  const willTotal = will.value + will.totalModifier;
  const hp = 10 + 5 * Math.ceil((bodyTotal + willTotal) / 2);
  const painEditor = traverseInventory(core.npc.cyberware).some((node) => node.item.name === 'Pain Editor');
  return {
    initiative: ref.value + ref.totalModifier,
    deathSave: bodyTotal,
    hitPoints: hp,
    seriouslyWounded: painEditor ? null : Math.ceil(hp / 2),
    armor: core.npc.armor.map((item) => ({ name: item.name, stoppingPower: item.armor_class })),
    attacks: core.npc.weapons.map((item) => {
      const skill = weaponSkillName(item, catalog);
      const values = weaponAttackValues(core.npc, item, catalog);
      return {
        name: item.name,
        skill,
        attackBase: values.skill,
        autofireBase: values.autofire,
        damage: item.damage,
        rateOfFire: item.rate_of_fire,
        magazine: item.magazine,
        ammoTypes: [...item.ammo_types],
        explanation: skill
          ? `${skill} is the associated attack skill; the displayed base includes its linked stat, trained level, and item modifiers.`
          : 'This attack is resolved from the item data and does not have a mapped weapon skill.',
      };
    }),
  };
}

function validateContainer(node: InventoryNode, issues: ValidationIssue[]): void {
  const capacity = node.item.container_capacity;
  if (capacity > 0 && capacity < 100) {
    const used = node.children.reduce((sum, child) => sum + child.item.size_in_container, 0);
    if (used > capacity) {
      issues.push({
        code: 'installation.capacity',
        severity: 'error',
        subject: node.item.name,
        message: `${node.item.name} uses ${used}/${capacity} installation slots.`,
        suggestedAction: 'Remove or relocate an installed option.',
      });
    }
  }
  for (const child of node.children) validateContainer(child, issues);
}

function ammoTypeFromName(name: string): string {
  return name.replace(/\s*\([^)]*\)\s*$/, '').trim();
}

export function validateGeneratedNpc(
  core: GeneratedCore,
  catalog: Catalog,
  referenceEntries: readonly CatalogEntry[],
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const inventoryAmmo = [...core.npc.inventory.values()]
    .filter((entry) => entry.item.type === 'ammo' && entry.amount > 0)
    .map((entry) => ammoTypeFromName(entry.item.name));

  for (const weapon of core.npc.weapons) {
    const skill = weaponSkillName(weapon, catalog);
    if (!skill) {
      issues.push({
        code: 'weapon.skill-mapping',
        severity: 'warning',
        subject: weapon.name,
        message: `${weapon.name} has no mapped attack skill.`,
        suggestedAction: 'Review the weapon-to-skill mapping.',
      });
    } else if (!core.npc.skills.has(skill)) {
      issues.push({
        code: 'weapon.skill-missing',
        severity: 'error',
        subject: weapon.name,
        message: `${weapon.name} requires ${skill}, but the NPC has no ${skill} skill entry.`,
        suggestedAction: `Add ${skill} or replace the weapon.`,
      });
    }
    if (weapon.magazine && weapon.ammo_types.length && !weapon.ammo_types.some((type) => inventoryAmmo.includes(type))) {
      issues.push({
        code: 'weapon.ammo-missing',
        severity: 'warning',
        subject: weapon.name,
        message: `${weapon.name} has no generated compatible ammunition.`,
        suggestedAction: `Add ${weapon.ammo_types.join(' or ')} ammunition.`,
      });
    }
  }

  validateContainer(core.npc.cyberware, issues);

  for (const item of getAllItems(core.npc)) {
    const reference = findCatalogEntry(referenceEntries, { name: item.name, type: item.type, quality: item.quality });
    if (!reference) {
      issues.push({
        code: 'catalog.unresolved',
        severity: 'info',
        subject: item.name,
        message: `${item.name} has no canonical reference entry.`,
        suggestedAction: 'Add a manual alias or update the content synchronization mapping.',
      });
    }
  }

  return issues;
}

function explanationForItem(core: GeneratedCore, catalog: Catalog, item: Item): string {
  if (item.type === 'weapon') {
    const skill = weaponSkillName(item, catalog);
    const total = skill ? weaponAttackValues(core.npc, item, catalog).skill : null;
    const preferred = [...core.role.preferred_primary_weapons, ...core.role.preferred_secondary_weapons].includes(item.name);
    return [
      preferred ? `Preferred by the ${humanize(core.role.name)} profile.` : 'Selected from the permitted weapon budget.',
      skill ? `Uses ${skill}${total !== null ? ` at attack base ${total}` : ''}.` : '',
    ].filter(Boolean).join(' ');
  }
  if (item.type === 'armor') {
    return [...core.role.preferred_armor.head, ...core.role.preferred_armor.body].includes(item.name)
      ? `Selected from the ${humanize(core.role.name)} profile's preferred armor within budget.`
      : 'Selected from the permitted armor budget.';
  }
  if (item.type === 'cyberware') {
    return core.role.preferred_cyberware.includes(item.name)
      ? `Preferred by the ${humanize(core.role.name)} profile and installed within available cyberware capacity.`
      : 'Selected from compatible cyberware that fit the available budget and installation requirements.';
  }
  if (item.type === 'equipment') {
    return core.role.preferred_equipment.includes(item.name)
      ? `Preferred equipment for the ${humanize(core.role.name)} profile.`
      : 'Selected from the role equipment list within budget.';
  }
  if (item.type === 'drug') return 'Generated from the role drug preferences because the NPC has compatible delivery gear.';
  if (item.type === 'ammo') return 'Added to support the ammunition requirements of the generated weapon loadout.';
  return 'Selected from the permitted inventory budget.';
}

export function createItemExplanations(
  core: GeneratedCore,
  catalog: Catalog,
  referenceEntries: readonly CatalogEntry[],
): GeneratedItemExplanation[] {
  const seen = new Set<string>();
  const explanations: GeneratedItemExplanation[] = [];
  for (const item of getAllItems(core.npc)) {
    const key = `${item.type}:${item.name}:${item.quality ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const reference = findCatalogEntry(referenceEntries, { name: item.name, type: item.type, quality: item.quality });
    explanations.push({
      name: item.name,
      type: item.type,
      reason: explanationForItem(core, catalog, item),
      catalogId: reference?.id,
    });
  }
  return explanations.sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name));
}
