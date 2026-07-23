import { describe, expect, it } from 'vitest';
import { toFoundryNpc } from '../format';
import { generateNpc } from '../generator';
import type { Catalog, GenerateOptions } from '../types';
import { DEFAULT_OPTIONS } from '../types';

const zero = { mean: 0, standard_deviation: 0 };

const catalog: Catalog = {
  ranks: [{
    name: 'private',
    min_items_quality: 'poor',
    items_budget: {
      armor: zero, weapon: zero, cyberware: zero, ammo: zero,
      equipment: zero, drug: zero, junk: zero,
    },
    items_num_budget: { equipment: zero, drug: zero, junk: zero },
    stats_budget: { mean: 40, standard_deviation: 0 },
    skills_budget: { mean: 2, standard_deviation: 0 },
    pocket_money: zero,
    trauma_team_status_weights: [],
    container_selection: zero,
  }],
  roles: [{
    name: 'civilian',
    skills: { Brawling: 2 },
    preferred_cyberware: [],
    preferred_primary_weapons: [],
    preferred_secondary_weapons: [],
    preferred_ammo: ['Basic'],
    preferred_armor_class: 11,
    preferred_drugs: [],
    preferred_equipment: [],
    min_empathy: 0,
    martial_arts_probability: 0,
  }],
  stats: { streetrat_stats: { civilian: [[4, 4, 4, 4, 4, 4, 4, 4, 4, 4]] } },
  skills: {
    Brawling: { link: 'DEX', type: 'fighting' },
    MartialArts: { link: 'DEX', type: 'fighting' },
  },
  weaponSkills: { Brawling: 'Brawling' },
  nationalityWeights: { populations: { US: 1 } },
  descriptionPrompt: 'Describe the NPC.',
  ammo: { Basic: { price: 1, types: ['Grenades'] } },
  armor: [],
  drugs: [],
  equipment: [],
  junk: [],
  weapons: [],
  cyberware: [{ name: 'Meatbody', type: 'cyberware', default_hidden: true, container_capacity: 999 }],
};

const options: GenerateOptions = {
  ...DEFAULT_OPTIONS,
  rank: 'private',
  role: 'civilian',
  nationality: 'en_US',
  seed: 101,
  allow_non_basic_ammo: false,
  allow_grenades: false,
  allow_armor: false,
  allow_cyberware: false,
  allow_borgware: false,
  allow_drugs: false,
  allow_equipment: false,
  allow_money: false,
  allow_junk: false,
  allow_melee_weapon: true,
  allow_ranged_weapon: false,
  allow_martial_arts: false,
};

describe('generateNpc', () => {
  it('is deterministic for a fixed seed and options', async () => {
    const first = await generateNpc(catalog, options);
    const second = await generateNpc(catalog, options);

    expect(toFoundryNpc(first)).toEqual(toFoundryNpc(second));
    expect(first.npc.stats.get('BODY')).toBe(4);
    expect(first.npc.weapons.some((item) => item.name === 'Brawling')).toBe(true);
  });
});
