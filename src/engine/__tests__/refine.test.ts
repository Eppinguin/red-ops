import { describe, expect, it } from 'vitest';
import { applyNpcCommand, mergeNpcSection } from '../refine';
import type { Item, Npc } from '../types';

function item(name: string, type: Item['type']): Item {
  return {
    id: name,
    creationTime: 0,
    name,
    type,
    price: 0,
    beautiful_name: null,
    beautiful_names_by_skill: {},
    beautiful_names_by_quality: {},
    default_hidden: false,
    modifier_applying_priority: 0,
    unique_tags: [],
    tags: [],
    modifiers: [],
    quality: null,
    container_capacity: 0,
    size_in_container: 0,
    required_containers: [],
    max_equipped_items: 0,
    armor_class: null,
    armor_locations: [],
    damage: null,
    rate_of_fire: null,
    magazine: null,
    ammo_types: [],
    skill: null,
    max_humanity_loss: 0,
    must_be_paired: false,
    paired_container: false,
    required_cyberware: [],
    required_condition: [],
    possible_names: [],
  };
}

function npc(): Npc {
  const meatbody = item('Meatbody', 'cyberware');
  return {
    sex: true,
    nationality: 'en_US',
    age: 30,
    name: 'Current',
    surname: 'NPC',
    role: 'solo',
    lifepath: {},
    description: '',
    stats: new Map([['BODY', 4], ['REF', 5]]),
    skills: new Map([['Handgun', { skill: { name: 'Handgun', link: 'REF', type: 'ranged_weapon' }, level: 4 }]]),
    cyberware: { item: meatbody, children: [] },
    armor: [],
    weapons: [item('Old Weapon', 'weapon')],
    inventory: new Map([
      ['equipment', { item: item('Agent', 'equipment'), amount: 1 }],
      ['ammo', { item: item('Old Ammo', 'ammo'), amount: 10 }],
    ]),
    traumaTeamStatus: 'NONE',
  };
}

describe('NPC refinement', () => {
  it('rerolls weapons and ammunition while retaining unrelated inventory', () => {
    const current = npc();
    const candidate = npc();
    candidate.weapons = [item('New Weapon', 'weapon')];
    candidate.inventory = new Map([
      ['new-ammo', { item: item('New Ammo', 'ammo'), amount: 20 }],
      ['new-equipment', { item: item('Discarded Gear', 'equipment'), amount: 1 }],
    ]);

    const merged = mergeNpcSection(current, candidate, 'weapons');
    expect(merged.weapons[0]?.name).toBe('New Weapon');
    expect([...merged.inventory.values()].map((entry) => entry.item.name)).toEqual(['Agent', 'New Ammo']);
    expect(current.weapons[0]?.name).toBe('Old Weapon');
  });

  it('applies clamped command edits without mutating the source NPC', () => {
    const current = npc();
    const changed = applyNpcCommand(current, { type: 'set-stat', stat: 'BODY', value: 99 });
    const skillChanged = applyNpcCommand(current, { type: 'set-skill', skill: 'Handgun', value: -2 });

    expect(changed.stats.get('BODY')).toBe(10);
    expect(current.stats.get('BODY')).toBe(4);
    expect(skillChanged.skills.get('Handgun')?.level).toBe(0);
  });
});
