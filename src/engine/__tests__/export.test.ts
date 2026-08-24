import { describe, expect, it } from 'vitest';
import { createMarkdownExport, createNativeExport, parseNativeExport } from '../export';
import type { GeneratedNpcView } from '../types';
import { DEFAULT_OPTIONS } from '../types';

function minimalView(): GeneratedNpcView {
  return {
    npc: {
      name: 'Test', surname: 'Operative', sex: true, nationality: 'en_US', age: 30,
      role: 'solo', lifepath: {}, description: '', stats: new Map(), skills: new Map(),
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

  it('retains validation diagnostics for native round-tripping', () => {
    const source = minimalView();
    source.validation = [{
      code: 'catalog.unresolved',
      severity: 'info',
      subject: 'Test item',
      message: 'Test item has no canonical reference entry.',
    }];

    const serialized = JSON.stringify(createNativeExport(source));
    const imported = parseNativeExport(serialized);

    expect(imported.validation).toEqual(source.validation);
  });

  it('round-trips a complete native NPC for import', () => {
    const source = minimalView();
    source.npc.stats.set('BODY', 4);
    const serialized = JSON.stringify(createNativeExport(source));
    const imported = parseNativeExport(serialized);

    expect(imported.npc.name).toBe('Test');
    expect(imported.npc.stats).toBeInstanceOf(Map);
    expect(imported.npc.stats.get('BODY')).toBe(4);
    expect(imported.options.model_api_key).toBeNull();
  });

  it('rejects JSON that is not a portable native export', () => {
    expect(() => parseNativeExport('{"schemaVersion":2,"npc":{}}'))
      .toThrow('The file is not a supported Red Ops native NPC export.');
  });
});

describe('Markdown export', () => {
  it('does not expose internal validation diagnostics', () => {
    const source = minimalView();
    source.validation = [{
      code: 'catalog.unresolved',
      severity: 'info',
      subject: 'Test item',
      message: 'Internal catalog diagnostic.',
    }];

    const markdown = createMarkdownExport(source);

    expect(markdown).not.toContain('## Validation');
    expect(markdown).not.toContain('Internal catalog diagnostic.');
  });
});
