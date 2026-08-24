import { afterEach, describe, expect, it, vi } from 'vitest';
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
    preferred_armor: { head: [], body: [] },
    preferred_drugs: [],
    preferred_equipment: [],
    min_empathy: 0,
    martial_arts_probability: 0,
  }],
  stats: { streetrat_stats: { civilian: [[4, 4, 4, 4, 4, 4, 4, 4, 4, 4]] } },
  skills: {
    Brawling: { link: 'DEX', type: 'fighting' },
  },
  skillSpecializations: { MartialArts: [] },
  weaponSkills: { Brawling: 'Brawling' },
  nationalityWeights: { populations: { US: 1 } },
  descriptionPrompt: 'Describe the NPC.',
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
  allow_lifepath: false,
};

afterEach(() => vi.unstubAllGlobals());

describe('generateNpc', () => {
  it('is deterministic for a fixed seed and options', async () => {
    const first = await generateNpc(catalog, options);
    const second = await generateNpc(catalog, options);

    expect(toFoundryNpc(first)).toEqual(toFoundryNpc(second));
    expect(first.npc.stats.get('BODY')).toBe(4);
    expect(first.npc.weapons.some((item) => item.name === 'Unarmed')).toBe(true);
  });

  it('represents pocket money as an Eddies inventory stack', async () => {
    const moneyCatalog = structuredClone(catalog);
    moneyCatalog.ranks[0]!.pocket_money = { mean: 42, standard_deviation: 0 };

    const result = await generateNpc(moneyCatalog, { ...options, allow_money: true });
    const eddies = [...result.npc.inventory.values()].find((entry) => entry.item.name === 'Eddies');

    expect(eddies).toMatchObject({
      amount: 42,
      item: { name: 'Eddies', type: 'junk', price: 1 },
    });
  });

  it('generates descriptions from Ollama without requiring an API key', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: 'A watchful solo in a weathered coat.' } }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await generateNpc(catalog, {
      ...options,
      allow_description: true,
      model_id: 'llama3.2',
      model_api_key: null,
      model_base_url: 'http://localhost:11434/v1',
    });

    expect(result.npc.description).toBe('A watchful solo in a weathered coat.');
    expect(result.warning).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:11434/v1/chat/completions',
      expect.objectContaining({
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  });

  it('omits undefined reference fields and repairs a base URL missing slashes', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: 'Ready.' } }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    await generateNpc(catalog, {
      ...options,
      allow_description: true,
      model_id: 'gemma4:26b',
      model_base_url: 'http:192.168.178.60:11434/v1',
    }, undefined, [{
      id: 'unarmed',
      type: 'weapon',
      name: 'Unarmed',
      aliases: [],
      summary: 'An unarmed strike.',
      mechanics: { kind: 'weapon', ammoTypes: [] },
      tags: [],
      provenance: [],
    }]);

    expect(fetchMock).toHaveBeenCalledWith(
      'http://192.168.178.60:11434/v1/chat/completions',
      expect.any(Object),
    );
    const request = JSON.parse((fetchMock.mock.calls[0]?.[1] as RequestInit).body as string) as {
      messages: Array<{ content: string }>;
    };
    const context = JSON.parse(request.messages[1]!.content) as {
      reference_context: Array<Record<string, unknown>>;
    };
    expect(context.reference_context[0]).toMatchObject({ name: 'Unarmed', summary: 'An unarmed strike.' });
    expect(context.reference_context[0]).not.toHaveProperty('usage');
    expect(context.reference_context[0]).not.toHaveProperty('price');
    expect(context.reference_context[0]).not.toHaveProperty('source');
  });

  it('returns actionable feedback when AI description settings are incomplete', async () => {
    const result = await generateNpc(catalog, {
      ...options,
      allow_description: true,
      model_id: 'llama3.2',
      model_api_key: null,
      model_base_url: null,
    });

    expect(result.warning).toBe('AI description was not generated: Enter an OpenAI-compatible base URL in the AI description settings.');
  });
});
