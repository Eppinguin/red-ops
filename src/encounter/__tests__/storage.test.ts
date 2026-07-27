import { describe, expect, it } from 'vitest';
import { createEmptyEncounter } from '../model';
import type { GeneratedNpcView } from '../../engine/types';
import { DEFAULT_OPTIONS } from '../../engine/types';
import { addNpcToActiveEncounter, parseEncounterImport } from '../storage';

describe('encounter import', () => {
  it('reads an encounter produced by the matching export action', () => {
    const source = createEmptyEncounter('Night Market Ambush');
    const imported = parseEncounterImport(JSON.stringify(source));

    expect(imported.name).toBe('Night Market Ambush');
    expect(imported.id).toBe(source.id);
    expect(imported.combatants).toEqual([]);
  });

  it('rejects unrelated JSON instead of turning it into an empty encounter', () => {
    expect(() => parseEncounterImport('{"version":2,"encounters":[]}'))
      .toThrow('The file is not a Red Ops encounter export.');
  });
});

describe('active encounter additions', () => {
  it('adds a generated NPC to the selected encounter without creating another encounter', () => {
    const first = createEmptyEncounter('First');
    const active = createEmptyEncounter('Active');
    const view = {
      npc: {
        name: 'Nova', surname: 'Vex', stats: new Map(), skills: new Map(),
        armor: [], weapons: [], inventory: new Map(),
      },
      combat: { attacks: [], initiative: 5, deathSave: 4 },
      hp: { current: 25, max: 25, seriouslyWounded: 13, painEditor: false },
      stats: [],
      skills: [],
      options: DEFAULT_OPTIONS,
    } as unknown as GeneratedNpcView;

    const workspace = addNpcToActiveEncounter({
      version: 2,
      activeEncounterId: active.id,
      encounters: [first, active],
    }, view);

    expect(workspace.encounters).toHaveLength(2);
    expect(workspace.encounters[0]?.combatants).toHaveLength(0);
    expect(workspace.encounters[1]?.combatants[0]?.name).toBe('Nova Vex');
    expect(workspace.encounters[1]?.lastEvent).toBe('Added Nova Vex');
  });
});
