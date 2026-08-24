import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeFoundryDocument } from '../lib/foundry-normalize.mjs';

const config = {
  projectId: 22820629,
  repository: 'cyberpunk-red-team/fvtt-cyberpunk-red-core',
  includedDocumentTypes: ['weapon', 'armor', 'cyberware', 'drug', 'gear'],
};

test('normalizes the current Foundry weapon schema', () => {
  const entry = normalizeFoundryDocument({
    config,
    ref: 'v0.92.4',
    repositoryPath: 'src/packs/core/weapons/weapon.heavy.pistol.yaml',
    document: {
      _id: 'Y433cjlB1uVHPysk',
      img: 'systems/cyberpunk-red-core/icons/compendium/weapons/heavyPistol.svg',
      name: 'Heavy Pistol',
      type: 'weapon',
      system: {
        ammoVariety: ['heavyPistol'],
        brand: '',
        concealable: { concealable: true, isConcealed: false },
        damage: '3d6',
        description: { value: '<p>A concealable, heavy pistol.</p>' },
        handsReq: 1,
        installedItems: { allowedTypes: ['itemUpgrade', 'ammo'], slots: 3 },
        magazine: { max: 8, value: 0 },
        price: { market: 100 },
        quality: 'standard',
        rof: 2,
        source: { book: 'Core', page: 341 },
        weaponSkill: 'Handgun',
      },
    },
  });

  assert.ok(entry);
  assert.equal(entry.id, 'weapon.heavy-pistol.standard');
  assert.equal(entry.summary, 'A concealable, heavy pistol.');
  assert.equal(entry.mechanics.magazine, 8);
  assert.equal(entry.mechanics.concealability, 'Concealable');
  assert.equal(entry.mechanics.hands, 1);
  assert.deepEqual(entry.mechanics.ammoTypes, ['heavyPistol']);
  assert.deepEqual(entry.source, { book: 'Core', page: '341' });
});

test('rejects unsupported document types', () => {
  const entry = normalizeFoundryDocument({
    config,
    ref: 'v0.92.4',
    repositoryPath: 'src/packs/core/netarch/example.yaml',
    document: { name: 'Example', type: 'netarch', system: {} },
  });
  assert.equal(entry, null);
});

test('preserves structured drug use, phases, DV, duration, and active-effect changes', () => {
  const entry = normalizeFoundryDocument({
    config,
    ref: 'v0.92.4',
    repositoryPath: 'src/packs/core/drugs/drug.synthcoke.yaml',
    document: {
      _id: 'CyYpPh89G7IYyryM',
      name: 'Synthcoke',
      type: 'drug',
      system: {
        consumed: 'Synthcoke Primary',
        usage: 'snorted',
        description: { value: '<p><strong>Primary Effect</strong></p><p>Dose lasts 4 hours.</p><ul><li>+1 REF</li></ul><p><strong>Secondary Effect (DV15)</strong></p><ul><li>-2 REF</li></ul>' },
      },
    },
    linkedEffects: [{
      _id: 'primary',
      name: 'Synthcoke Primary',
      changes: [{ key: 'system.stats.ref.value', mode: 2, value: '1' }],
    }, {
      _id: 'addiction',
      name: 'Synthcoke Addiciton',
      changes: [{ key: 'system.stats.ref.value', mode: 2, value: '-2' }],
    }],
  });

  assert.ok(entry);
  assert.equal(entry.mechanics.kind, 'drug');
  assert.equal(entry.mechanics.usage, 'snorted');
  assert.equal(entry.mechanics.duration, '4 hours');
  assert.equal(entry.mechanics.secondaryDv, 15);
  assert.match(entry.mechanics.primaryEffect, /\+1 REF/);
  assert.match(entry.mechanics.secondaryEffect, /-2 REF/);
  assert.deepEqual(entry.mechanics.activeEffects.map((effect) => effect.phase), ['primary', 'secondary']);
  assert.equal(entry.mechanics.activeEffects[0].changes[0].key, 'system.stats.ref.value');
});
