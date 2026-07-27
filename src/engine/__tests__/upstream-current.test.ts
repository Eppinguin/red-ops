import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import manifest from '../../../upstream-manifest.json';
import { generateNpc, weaponAttackValues } from '../generator';
import { createGeneratedView } from '../format';
import type { Catalog, ItemData, NationalityWeights } from '../types';
import { DEFAULT_OPTIONS } from '../types';

function loadBundledCatalog(): Catalog {
  const values = new Map<string, unknown>();
  for (const path of manifest.paths) {
    const content = readFileSync(resolve('public/upstream', path), 'utf8');
    values.set(path, path.endsWith('.json') ? JSON.parse(content) : content.trim());
  }
  const cyberware = manifest.paths
    .filter((path) => path.includes('/cyberware/') && path.endsWith('.json'))
    .flatMap((path) => values.get(path) as ItemData[]);
  return {
    ranks: values.get('configs/ranks.json') as Catalog['ranks'],
    roles: values.get('configs/roles.json') as Catalog['roles'],
    stats: values.get('configs/stats.json') as Catalog['stats'],
    skills: values.get('configs/skills.json') as Catalog['skills'],
    skillSpecializations: values.get('configs/skill_specializations.json') as Catalog['skillSpecializations'],
    weaponSkills: values.get('configs/weapon_skills.json') as Catalog['weaponSkills'],
    nationalityWeights: values.get('configs/nationality_weights.json') as NationalityWeights,
    descriptionPrompt: values.get('configs/description_prompt.md') as string,
    lifepath: values.get('configs/lifepath.json') as Catalog['lifepath'],
    ammo: values.get('configs/items/ammo.json') as Catalog['ammo'],
    armor: values.get('configs/items/armor.json') as ItemData[],
    drugs: values.get('configs/items/drugs.json') as ItemData[],
    equipment: values.get('configs/items/equipment.json') as ItemData[],
    junk: values.get('configs/items/junk.json') as ItemData[],
    weapons: values.get('configs/items/weapon.json') as ItemData[],
    cyberware,
  };
}

describe('current pinned upstream generator', () => {
  it('generates a complete deterministic NPC from the vendored candidate config', async () => {
    const catalog = loadBundledCatalog();
    const options = {
      ...DEFAULT_OPTIONS,
      seed: 42,
      nationality: 'en_US',
      allow_description: false,
    };
    const first = await generateNpc(catalog, options);
    const second = await generateNpc(catalog, options);

    expect(first.npc).toEqual(second.npc);
    expect({
      sex: first.npc.sex,
      age: first.npc.age,
      stats: Object.fromEntries(first.npc.stats),
      armor: first.npc.armor.map((item) => item.name),
      weapons: first.npc.weapons.map((item) => ({
        name: item.name,
        quality: item.quality,
        beautifulName: item.beautiful_name,
      })),
      ammo: [...first.npc.inventory.values()]
        .filter((entry) => entry.item.type === 'ammo')
        .map((entry) => [entry.item.name, entry.amount]),
    }).toEqual({
      sex: false,
      age: 36,
      stats: {
        INT: 7, REF: 7, DEX: 6, TECH: 5, COOL: 6,
        WILL: 7, LUCK: 7, MOVE: 6, BODY: 6, EMP: 5,
      },
      armor: ['Medium Armorjack (Head)', 'Medium Armorjack (Body)'],
      weapons: [
        { name: 'Baseball Bat', quality: 'excellent', beautifulName: null },
        { name: 'Unarmed', quality: null, beautifulName: null },
        { name: 'SMG', quality: 'standard', beautifulName: 'Militech "Mini-Gat"' },
      ],
      ammo: [
        ['Grenade (Armor-Piercing)', 1],
        ['Medium Pistol (Basic)', 60],
      ],
    });
    expect(first.npc.role).toBe('solo');
    expect(first.npc.lifepath).toMatchObject({
      cultural_origin: 'United States',
      language: 'English',
      personality: 'Shy and secretive',
      clothing_style: 'Asia Pop (Bright, Costume-like, Youthful)',
      friends: [],
      enemies: [{
        enemy: 'Ex-friend',
        cause: 'Accused the other of cowardice or another major personal flaw.',
        wronged_party: 'You',
        resources: 'An entire gang.',
        reaction: "Set them up for a crime or other transgression they didn't commit.",
      }],
      tragic_love_affairs: [],
      life_goal: 'Cause pain and suffering to anyone who crosses you.',
    });
    expect(first.npc.weapons.some((item) => item.name === 'Unarmed')).toBe(true);
    expect(weaponAttackValues(
      first.npc,
      first.npc.weapons.find((item) => item.name === 'Unarmed')!,
      catalog,
    ).skill).toBe(6);
    expect(first.npc.skills.has('MartialArts')).toBe(false);
    expect([...first.npc.inventory.values()]
      .filter((entry) => entry.item.type === 'ammo')
      .every((entry) => entry.amount > 0)).toBe(true);
  });

  it('supports every upstream role with the current schemas', async () => {
    const catalog = loadBundledCatalog();
    for (const [index, role] of catalog.roles.entries()) {
      const result = await generateNpc(catalog, {
        ...DEFAULT_OPTIONS,
        seed: 1_000 + index,
        nationality: 'en_US',
        role: role.name,
        allow_description: false,
      });
      expect(result.npc.role).toBe(role.name);
      expect(result.npc.stats.size).toBe(10);
      expect(result.npc.weapons.length).toBeGreaterThan(0);
    }
  });

  it('removes forbidden skills, including specializations selected through role placeholders', async () => {
    const catalog = loadBundledCatalog();
    const forbiddenSkills = [
      'PlayInstrument',
      ...catalog.skillSpecializations.PlayInstrument!,
      ...catalog.skillSpecializations.MartialArts!,
    ];
    const result = await generateNpc(catalog, {
      ...DEFAULT_OPTIONS,
      seed: 18,
      nationality: 'en_US',
      role: 'rockerboy',
      forbidden_skills: forbiddenSkills,
    });

    expect([...result.npc.skills.keys()].some((name) =>
      name.startsWith('PlayInstrument') || name.startsWith('MartialArts'),
    )).toBe(false);
    const command = createGeneratedView(result, catalog).command;
    expect(command.match(/--forbidden-skills/g)).toHaveLength(1);
    expect(command).toContain(
      `--forbidden-skills ${forbiddenSkills.map((skill) => `'${skill}'`).join(' ')}`,
    );
  });
});
