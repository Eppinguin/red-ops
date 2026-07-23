import { describe, expect, it } from 'vitest';
import { createEmptyEncounter } from '../model';
import { parseEncounterImport } from '../storage';

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
