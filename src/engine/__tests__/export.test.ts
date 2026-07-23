import { describe, expect, it } from 'vitest';
import { createNativeExport } from '../export';
import type { GeneratedNpcView } from '../types';
import { DEFAULT_OPTIONS } from '../types';

function minimalView(): GeneratedNpcView {
  return {
    npc: {
      name: 'Test', surname: 'Operative', sex: true, nationality: 'en_US', age: 30,
      description: '', stats: new Map(), skills: new Map(),
      cyberware: { item: {} as never, children: [] }, armor: [], weapons: [], inventory: new Map(), traumaTeamStatus: 'NONE',
    },
    rank: { name: 'private' } as never,
    role: { name: 'solo' } as never,
    options: { ...DEFAULT_OPTIONS, model_api_key: 'secret-key' },
    seed: 101,
    command: '--model-api-key="$MODEL_API_KEY"',
    text: '',
    foundry: {} as never,
    totalPrice: 0,
    stats: [], skills: [],
    hp: { current: 20, max: 20, seriouslyWounded: 10, painEditor: false },
    conditions: [], actions: [], abilities: [],
    profileSummary: 'Test profile.',
    combat: { initiative: 4, deathSave: 4, hitPoints: 20, seriouslyWounded: 10, armor: [], attacks: [] },
    validation: [], itemExplanations: [], revisions: [],
  };
}

describe('native export', () => {
  it('never serializes the in-memory AI API key', () => {
    const serialized = JSON.stringify(createNativeExport(minimalView()));
    expect(serialized).not.toContain('secret-key');
    expect(serialized).toContain('"model_api_key":null');
  });
});
