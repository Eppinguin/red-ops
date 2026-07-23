import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeFoundryDocument } from '../lib/foundry-normalize.mjs';

const config = {
  projectId: 22820629,
  repository: 'cyberpunk-red-team/fvtt-cyberpunk-red-core',
  includedDocumentTypes: ['weapon', 'armor', 'cyberware', 'gear'],
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
