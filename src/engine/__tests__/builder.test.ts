import { describe, expect, it } from 'vitest';
import { createBlankManualView, previewManualNpcView, rebuildManualNpcView } from '../builder';
import type { Catalog } from '../types';
import { STAT_NAMES } from '../types';

const catalog: Catalog = {
  ranks: [{ name: 'private' }],
  roles: [{ name: 'civilian' }],
  stats: { streetrat_stats: { civilian: [[5, 5, 5, 5, 5, 5, 5, 5, 5, 5]] } },
  skills: {
    Brawling: { link: 'DEX', type: 'fighting' },
    Handgun: { link: 'REF', type: 'ranged_weapon' },
  },
  skillSpecializations: {},
  weaponSkills: {},
  nationalityWeights: { populations: { US: 1 } },
  descriptionPrompt: '',
  lifepath: {
    cultural_origins: [],
    friend_relationship: [],
    enemy: [],
    enemy_cause: [],
    enemy_resources: [],
    sweet_revenge: [],
    tragic_love_affair: [],
    personality: [],
    clothing_style: [],
    hairstyle: [],
    affectation: [],
    value_most: [],
    feel_about_people: [],
    valued_person: [],
    valued_possession: [],
    family_background: [],
    childhood_environment: [],
    family_crisis: [],
    life_goal: [],
  },
  ammo: {},
  armor: [],
  drugs: [],
  equipment: [],
  junk: [],
  weapons: [],
  cyberware: [{ name: 'Meatbody', type: 'cyberware', default_hidden: true, container_capacity: 999 }],
};

describe('manual NPC builder', () => {
  it('creates a usable blank NPC without random generation', () => {
    const view = createBlankManualView(catalog);

    expect(view.npc.name).toBe('New');
    expect(view.rank.name).toBe('private');
    expect(view.role.name).toBe('civilian');
    expect(view.npc.weapons).toEqual([]);
    expect(view.npc.inventory.size).toBe(0);
    expect(view.npc.skills.get('Brawling')?.level).toBe(0);
    expect(STAT_NAMES.map((stat) => view.npc.stats.get(stat))).toEqual(STAT_NAMES.map(() => 5));
    expect(view.revisions.at(-1)?.command).toBe('manual NPC created');
  });

  it('recalculates derived values after full manual edits', () => {
    const current = createBlankManualView(catalog);
    const npc = structuredClone(current.npc);
    npc.name = 'Morgan';
    npc.surname = 'Black';
    npc.description = 'Manually authored operative.';
    npc.stats.set('BODY', 8);
    npc.skills.get('Handgun')!.level = 6;

    const rebuilt = rebuildManualNpcView(current, npc, 'private', 'civilian', catalog);

    expect(rebuilt.npc.name).toBe('Morgan');
    expect(rebuilt.profileSummary).toBe('Manually authored operative.');
    expect(rebuilt.stats.find((stat) => stat.name === 'BODY')?.base).toBe(8);
    expect(rebuilt.skills.find((skill) => skill.name === 'Handgun')?.base).toBe(6);
    expect(rebuilt.combat.hitPoints).toBe(45);
    expect(rebuilt.revisions.at(-1)?.command).toBe('manual edit');
  });

  it('recalculates inline previews without adding revision entries', () => {
    const current = createBlankManualView(catalog);
    const npc = structuredClone(current.npc);
    npc.stats.set('BODY', 7);

    const preview = previewManualNpcView(current, npc, 'private', 'civilian', catalog);

    expect(preview.stats.find((stat) => stat.name === 'BODY')?.base).toBe(7);
    expect(preview.combat.hitPoints).toBe(40);
    expect(preview.revisions).toEqual(current.revisions);
  });
});
