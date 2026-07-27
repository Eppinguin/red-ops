import { describe, expect, it } from 'vitest';
import { buildGeneratorCatalog, findCatalogEntry, mergeReferenceEntries } from '../catalog';
import type { CatalogEntry } from '../types';
import type { Catalog } from '../../engine/types';

function weaponEntry(source: 'generator' | 'foundry', overrides: Partial<CatalogEntry> = {}): CatalogEntry {
  return {
    id: 'weapon.heavy-pistol.standard',
    type: 'weapon',
    name: 'Heavy Pistol',
    aliases: [],
    summary: source === 'foundry' ? 'A concise synchronized description.' : 'Generator fallback.',
    mechanics: {
      kind: 'weapon',
      damage: source === 'generator' ? '3d6' : '4d6',
      rateOfFire: 2,
      magazine: 8,
      skill: 'Handgun',
      ammoTypes: ['Medium Pistol'],
      quality: 'standard',
      concealability: source === 'foundry' ? 'Pocket' : undefined,
    },
    price: source === 'generator' ? { amount: 100, category: 'Premium' } : { amount: 500, category: 'Expensive' },
    tags: [],
    ...(source === 'generator' ? {
      generator: { generatorName: 'Heavy Pistol', generatorType: 'weapon', eligible: true, quality: 'standard' },
    } : {
      foundry: { projectId: 22820629, ref: 'v0.92.4', pack: 'core/weapons' },
    }),
    provenance: [{ source, field: 'document' }],
    ...overrides,
  };
}

describe('canonical reference catalog', () => {
  it('enriches missing fields without silently replacing generator balance data', () => {
    const { entries, conflicts } = mergeReferenceEntries([weaponEntry('generator')], [weaponEntry('foundry')]);
    const merged = entries[0]!;

    expect(merged.summary).toBe('A concise synchronized description.');
    expect(merged.mechanics).toMatchObject({ damage: '3d6', concealability: 'Pocket' });
    expect(merged.price).toEqual({ amount: 100, category: 'Expensive' });
    expect(conflicts.map((conflict) => conflict.field)).toContain('mechanics.damage');
    expect(conflicts.map((conflict) => conflict.field)).toContain('price.amount');
  });

  it('resolves generated quality suffixes and display prefixes', () => {
    const entry = weaponEntry('generator');
    expect(findCatalogEntry([entry], { name: 'Heavy Pistol (Standard)', type: 'weapon' })).toBe(entry);
  });


  it('enriches an unqualified generator weapon from the standard Foundry record', () => {
    const generator = weaponEntry('generator', {
      id: 'weapon.heavy-pistol',
      mechanics: { kind: 'weapon', damage: '3d6', rateOfFire: 2, magazine: 8, skill: 'Handgun', ammoTypes: ['Medium Pistol'], quality: null },
      generator: { generatorName: 'Heavy Pistol', generatorType: 'weapon', eligible: true, quality: null },
    });
    const standard = weaponEntry('foundry');
    const poor = weaponEntry('foundry', {
      id: 'weapon.heavy-pistol.poor',
      mechanics: { kind: 'weapon', damage: '3d6', rateOfFire: 2, magazine: 8, skill: 'Handgun', ammoTypes: ['Medium Pistol'], quality: 'poor' },
    });
    const { entries } = mergeReferenceEntries([generator], [poor, standard]);

    expect(entries.find((entry) => entry.id === generator.id)?.summary).toBe('A concise synchronized description.');
    expect(findCatalogEntry(entries, { name: 'Heavy Pistol', type: 'weapon', quality: 'poor' })?.id).toBe('weapon.heavy-pistol.poor');
  });
  it('supports explicit mappings when source names differ', () => {
    const generator = weaponEntry('generator', { id: 'weapon.custom-sidearm', name: 'Custom Sidearm' });
    const foundry = weaponEntry('foundry', { id: 'weapon.heavy-pistol.standard', name: 'Heavy Pistol' });
    const { entries } = mergeReferenceEntries([generator], [foundry], [{
      generatorId: 'weapon.custom-sidearm',
      foundryId: 'weapon.heavy-pistol.standard',
      aliases: ['Heavy Sidearm'],
    }]);

    const merged = entries.find((entry) => entry.id === 'weapon.custom-sidearm');
    expect(merged?.summary).toBe('A concise synchronized description.');
    expect(merged?.aliases).toContain('Heavy Sidearm');
  });

  it('keeps the generator summary when Foundry has only a generated fallback label', () => {
    const generator = weaponEntry('generator');
    const foundry = weaponEntry('foundry', {
      summary: 'Heavy Pistol is a weapon entry from the Cyberpunk RED Foundry compendium.',
    });
    const { entries } = mergeReferenceEntries([generator], [foundry]);
    expect(entries[0]?.summary).toBe('Generator fallback.');
  });

  it('uses structured armor locations from the current generator schema', () => {
    const catalog = {
      armor: [{
        name: 'Medium Armorjack (Head)',
        type: 'armor',
        armor_class: 12,
        armor_locations: ['Head'],
      }],
      weapons: [],
      cyberware: [],
      equipment: [],
      drugs: [],
      junk: [],
      skills: {},
      ammo: {},
    } as unknown as Catalog;

    expect(buildGeneratorCatalog(catalog)[0]?.mechanics).toMatchObject({
      kind: 'armor',
      stoppingPower: 12,
      locations: ['head'],
    });
  });

});
