import { describe, expect, it } from 'vitest';
import { normalizeSavedNpcView } from '../storage';
import type { GeneratedNpcView } from '../engine/types';

describe('saved NPC normalization', () => {
  it('upgrades records saved before the current upstream schema', () => {
    const legacyItem = {
      id: 'item-1',
      creationTime: 1,
      name: 'Legacy Armor',
      type: 'armor',
    };
    const legacy = {
      options: {
        rank: 'captain',
        role: 'solo',
        allow_armor: false,
      },
      role: {
        name: 'solo',
        preferred_armor_class: 11,
      },
      npc: {
        stats: new Map(),
        skills: new Map(),
        cyberware: {
          item: { ...legacyItem, name: 'Meatbody', type: 'cyberware' },
          children: [],
        },
        armor: [legacyItem],
        weapons: [],
        inventory: new Map([['legacy', { item: legacyItem, amount: 1 }]]),
      },
    } as unknown as GeneratedNpcView;

    const normalized = normalizeSavedNpcView(legacy);

    expect(normalized.options).toMatchObject({
      rank: 'captain',
      role: 'solo',
      allow_armor: false,
      allow_lifepath: true,
      allow_description: false,
      forbidden_skills: [],
      model_api_key: null,
    });
    expect(normalized.role.preferred_armor).toEqual({ head: [], body: [] });
    expect(normalized.npc).toMatchObject({ role: 'solo', lifepath: {} });
    expect(normalized.npc.armor[0]).toMatchObject({
      beautiful_name: null,
      beautiful_names_by_skill: {},
      beautiful_names_by_quality: {},
      armor_locations: [],
    });
    expect(normalized.npc.cyberware.item.armor_locations).toEqual([]);
    expect(normalized.npc.inventory.get('legacy')?.item.armor_locations).toEqual([]);
  });
});
