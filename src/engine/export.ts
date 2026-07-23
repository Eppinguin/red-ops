import type { GeneratedNpcView, InventoryNode, Item } from './types';

function serializeItem(item: Item): Record<string, unknown> {
  return {
    name: item.name,
    type: item.type,
    price: item.price,
    quality: item.quality,
    armorClass: item.armor_class,
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
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
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
