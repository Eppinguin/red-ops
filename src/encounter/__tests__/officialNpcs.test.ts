import { describe, expect, it } from 'vitest';
import { createOfficialCombatant, genericNpcTemplates } from '../officialNpcs';

describe('generic NPC stat blocks', () => {
  it('exposes every core generic NPC without encounter-specific templates', () => {
    expect(genericNpcTemplates().map((template) => template.id)).toEqual([
      'bodyguard',
      'boosterganger',
      'road-ganger',
      'security-operative',
      'netrunner',
      'reclaimer-chief',
      'security-officer',
      'outrider',
      'pyro',
      'cyberpsycho',
    ]);
  });

  it('creates a complete independent combatant from a generic stat block', () => {
    const first = createOfficialCombatant('security-operative', { side: 'neutral' });
    const second = createOfficialCombatant('security-operative', { side: 'neutral' });

    expect(first).toMatchObject({
      name: 'Security Operative',
      side: 'neutral',
      currentHp: 30,
      maxHp: 30,
      statBlock: {
        templateId: 'security-operative',
        templateName: 'Security Operative',
        tier: 'mook',
      },
    });
    expect(first.attacks.map((attack) => attack.name)).toEqual([
      'Poor Quality Assault Rifle',
      'Very Heavy Pistol',
      'Medium Melee Weapon',
    ]);
    expect(first.id).not.toBe(second.id);
    expect(first.attacks[0]?.id).not.toBe(second.attacks[0]?.id);
  });
});
