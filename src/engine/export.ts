import type { GeneratedNpcView, InventoryNode, Item } from './types';

const PORTABLE_MAP = '__redOpsMap';

function portableReplacer(_key: string, value: unknown): unknown {
  return value instanceof Map ? { [PORTABLE_MAP]: [...value.entries()] } : value;
}

function portableReviver(_key: string, value: unknown): unknown {
  if (!value || typeof value !== 'object' || !(PORTABLE_MAP in value)) return value;
  const entries = (value as { [PORTABLE_MAP]?: unknown })[PORTABLE_MAP];
  if (!Array.isArray(entries)) throw new Error('The native NPC file contains an invalid map.');
  return new Map(entries as Array<[unknown, unknown]>);
}

function portableView(view: GeneratedNpcView): unknown {
  return JSON.parse(JSON.stringify({
    ...view,
    options: { ...view.options, model_api_key: null },
  }, portableReplacer));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function assertGeneratedNpcView(value: unknown): asserts value is GeneratedNpcView {
  if (!isRecord(value)
    || !isRecord(value.npc)
    || !isRecord(value.rank)
    || !isRecord(value.role)
    || !isRecord(value.options)
    || typeof value.seed !== 'number'
    || typeof value.command !== 'string'
    || typeof value.text !== 'string'
    || !isRecord(value.combat)
    || !Array.isArray(value.stats)
    || !Array.isArray(value.skills)
    || !Array.isArray(value.validation)
    || !Array.isArray(value.itemExplanations)
    || !Array.isArray(value.revisions)
    || !(value.npc.stats instanceof Map)
    || !(value.npc.skills instanceof Map)
    || !(value.npc.inventory instanceof Map)
    || !isRecord(value.npc.cyberware)
    || !Array.isArray(value.npc.cyberware.children)
    || !Array.isArray(value.npc.armor)
    || !Array.isArray(value.npc.weapons)) {
    throw new Error('The file does not contain a complete Red Ops NPC.');
  }
}

function serializeItem(item: Item): Record<string, unknown> {
  return {
    name: item.name,
    beautifulName: item.beautiful_name,
    type: item.type,
    price: item.price,
    quality: item.quality,
    armorClass: item.armor_class,
    armorLocations: item.armor_locations,
    damage: item.damage,
    rateOfFire: item.rate_of_fire,
    magazine: item.magazine,
    ammoTypes: item.ammo_types,
    skill: item.skill,
    tags: item.tags,
    uniqueTags: item.unique_tags,
  };
}

function serializeNode(node: InventoryNode): Record<string, unknown> {
  return {
    item: serializeItem(node.item),
    installed: node.children.map(serializeNode),
  };
}

export function createNativeExport(view: GeneratedNpcView): Record<string, unknown> {
  return {
    schemaVersion: 3,
    generatedAt: new Date().toISOString(),
    portableView: portableView(view),
    generator: {
      seed: view.seed,
      rank: view.rank.name,
      role: view.role.name,
      options: { ...view.options, model_api_key: null },
      command: view.command,
    },
    npc: {
      name: view.npc.name,
      surname: view.npc.surname,
      sex: view.npc.sex,
      nationality: view.npc.nationality,
      age: view.npc.age,
      lifepath: view.npc.lifepath,
      description: view.profileSummary,
      traumaTeamStatus: view.npc.traumaTeamStatus,
      stats: Object.fromEntries(view.npc.stats),
      skills: Object.fromEntries([...view.npc.skills].map(([name, entry]) => [name, {
        level: entry.level,
        linkedStat: entry.skill.link,
        type: entry.skill.type,
      }])),
      cyberware: serializeNode(view.npc.cyberware),
      armor: view.npc.armor.map(serializeItem),
      weapons: view.npc.weapons.map(serializeItem),
      inventory: [...view.npc.inventory.values()].map((entry) => ({ amount: entry.amount, item: serializeItem(entry.item) })),
    },
    combat: view.combat,
    validation: view.validation,
    explanations: view.itemExplanations,
    revisions: view.revisions,
  };
}

export function parseNativeExport(text: string): GeneratedNpcView {
  const parsed: unknown = JSON.parse(text, portableReviver);
  if (!isRecord(parsed) || parsed.schemaVersion !== 3 || !('portableView' in parsed)) {
    throw new Error('The file is not a supported Red Ops native NPC export.');
  }
  const view = parsed.portableView;
  assertGeneratedNpcView(view);
  return view;
}

export function createMarkdownExport(view: GeneratedNpcView): string {
  const lines = [
    `# ${view.npc.name} ${view.npc.surname}`,
    '',
    `**${view.rank.name} ${view.role.name} · ${view.npc.nationality} · Age ${view.npc.age} · Seed ${view.seed}**`,
    '',
    view.profileSummary,
    '',
    '## Combat summary',
    '',
    `- HP: ${view.combat.hitPoints}`,
    `- Seriously Wounded: ${view.combat.seriouslyWounded ?? 'suppressed by Pain Editor'}`,
    `- Initiative: +${view.combat.initiative}`,
    `- Death Save: ${view.combat.deathSave}`,
    ...view.combat.armor.map((armor) => `- ${armor.name}: SP ${armor.stoppingPower ?? '—'}`),
    '',
    '## Attacks',
    '',
    ...view.combat.attacks.map((attack) => `- **${attack.name}** — ${attack.skill ?? 'Unmapped'} ${attack.attackBase ?? '—'}, ${attack.damage ?? '—'}, ROF ${attack.rateOfFire ?? '—'}, MAG ${attack.magazine ?? '—'}`),
    '',
    '## Stats',
    '',
    `| Stat | Base | Modifier | Total |`,
    `| --- | ---: | ---: | ---: |`,
    ...view.stats.map((stat) => `| ${stat.name} | ${stat.base} | ${stat.modifier} | ${stat.total} |`),
    '',
    '## Strongest skills',
    '',
    ...[...view.skills].sort((a, b) => b.total - a.total).slice(0, 12).map((skill) => `- ${skill.name}: ${skill.total}`),
    '',
    '## Validation',
    '',
    ...(view.validation.length ? view.validation.map((issue) => `- **${issue.severity.toUpperCase()}** ${issue.message}`) : ['- No issues detected.']),
    '',
    ...(view.revisions.length ? [
      '## Revisions',
      '',
      ...view.revisions.map((revision) => `- ${revision.section}${revision.seed !== undefined ? ` · seed ${revision.seed}` : ''}${revision.command ? ` · ${revision.command}` : ''}`),
      '',
    ] : []),
    '## Full generator output',
    '',
    '```text',
    view.text.trimEnd(),
    '```',
    '',
  ];
  return lines.join('\n');
}
