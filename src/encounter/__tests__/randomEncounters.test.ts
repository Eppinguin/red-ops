import { describe, expect, it } from 'vitest';
import {
  encounterTableCoverage,
  materializeRandomEncounter,
  rerollRandomEncounterSubroll,
  rollRandomEncounter,
} from '../randomEncounters';

const FULL_TABLE = Array.from({ length: 100 }, (_, index) => index + 1);

describe('official random encounter tables', () => {
  it.each(['daytime', 'evening', 'midnight'] as const)('covers every percentile exactly once for %s', (period: 'daytime' | 'evening' | 'midnight') => {
    expect(encounterTableCoverage(period)).toEqual(FULL_TABLE);
  });

  it('resolves the printed evening percentile overlap deterministically', () => {
    const seventyTwo = rollRandomEncounter({ period: 'evening', zone: 'moderate', partySize: 4, percentile: 72, random: () => 0 });
    const seventyThree = rollRandomEncounter({ period: 'evening', zone: 'moderate', partySize: 4, percentile: 73, random: () => 0 });
    expect(seventyTwo.title).toBe('Solo Team');
    expect(seventyThree.title).toBe('Boostergang');
    expect(seventyThree.warnings.join(' ')).toContain('overlaps percentile 72');
  });

  it('uses the supplied mook stat block when materializing an encounter', () => {
    const result = rollRandomEncounter({ period: 'daytime', zone: 'moderate', partySize: 4, percentile: 58, random: () => 0 });
    const materialized = materializeRandomEncounter(result);
    expect(materialized.unavailable).toEqual([]);
    expect(materialized.combatants).toHaveLength(4);
    expect(materialized.combatants[0]?.statBlock?.templateId).toBe('road-ganger');
    expect(materialized.combatants[0]?.attacks.map((attack) => attack.damage)).toEqual(['4d6', '4d6', '1d6']);
  });

  it('keeps duplicate turf-war factions distinct by team and numbering', () => {
    const result = rollRandomEncounter({ period: 'midnight', zone: 'moderate', partySize: 4, percentile: 75, random: () => 0 });
    expect(result.groups.map((group) => [group.teamLabel, group.label, group.side])).toEqual([
      ['Side A', 'Tyger Claw', 'enemy'],
      ['Side B', 'Tyger Claw', 'neutral'],
    ]);
    const materialized = materializeRandomEncounter(result);
    expect(materialized.combatants.map((combatant) => combatant.name)).toEqual([
      'Side A · Tyger Claw 1',
      'Side A · Tyger Claw 2',
      'Side A · Tyger Claw 3',
      'Side A · Tyger Claw 4',
      'Side B · Tyger Claw 1',
      'Side B · Tyger Claw 2',
      'Side B · Tyger Claw 3',
      'Side B · Tyger Claw 4',
    ]);
    expect(materialized.combatants.map((combatant) => combatant.teamLabel)).toEqual([
      'Side A', 'Side A', 'Side A', 'Side A', 'Side B', 'Side B', 'Side B', 'Side B',
    ]);
  });

  it('rerolls one Turf War side without changing the other side or main percentile result', () => {
    const result = rollRandomEncounter({ period: 'midnight', zone: 'moderate', partySize: 4, percentile: 75, random: () => 0 });
    const sideA = result.groups[0]!;
    const sideB = result.groups[1]!;
    const sideARoll = result.subrolls.find((subroll) => subroll.label === 'Side A faction')!;
    const rerolled = rerollRandomEncounterSubroll(result, sideARoll.id, () => 0.3);

    expect(rerolled.roll).toBe(75);
    expect(rerolled.groups[0]).toMatchObject({ id: sideA.id, teamLabel: 'Side A', label: '6th Street ganger', side: 'enemy', count: 4 });
    expect(rerolled.groups[1]).toEqual(sideB);
    expect(rerolled.subrolls.find((subroll) => subroll.id === sideARoll.id)?.roll).toBe(4);
    expect(rerolled.gmNotes).toContain('Side A roll: 4.');
    expect(rerolled.gmNotes).toContain('Side B roll: 1.');
  });

  it('exposes Major Criminal scene reactions as independently rerollable results', () => {
    const result = rollRandomEncounter({ period: 'midnight', zone: 'moderate', partySize: 4, percentile: 93, random: () => 0.6 });
    const sceneRoll = result.subrolls.find((subroll) => subroll.label === 'Scene reaction')!;
    expect(sceneRoll).toMatchObject({ die: '1d10', roll: 7, outcome: 'warned off' });

    const rerolled = rerollRandomEncounterSubroll(result, sceneRoll.id, () => 0.95);
    expect(rerolled.roll).toBe(93);
    expect(rerolled.subrolls.find((subroll) => subroll.id === sceneRoll.id)).toMatchObject({ roll: 10, outcome: 'marked as witnesses' });
    expect(rerolled.gmNotes.join(' ')).toContain('marked as witnesses');
  });

  it('records fixed modifiers on rerollable arrival timers', () => {
    const result = rollRandomEncounter({ period: 'midnight', zone: 'moderate', partySize: 4, percentile: 100, random: () => 0 });
    expect(result.subrolls[0]).toMatchObject({ label: 'Psycho Squad arrival', die: '1d6', roll: 1, modifier: 1, total: 2, outcome: '2 rounds' });
  });

  it('keeps every recorded secondary result independently rerollable across all tables', () => {
    for (const period of ['daytime', 'evening', 'midnight'] as const) {
      for (const percentile of FULL_TABLE) {
        const result = rollRandomEncounter({ period, zone: 'moderate', partySize: 4, percentile, random: () => 0.2 });
        for (const subroll of result.subrolls) {
          const unchanged = new Map(result.subrolls.filter((candidate) => candidate.id !== subroll.id).map((candidate) => [candidate.id, candidate.roll]));
          const rerolled = rerollRandomEncounterSubroll(result, subroll.id, () => 0.8);
          expect(rerolled.roll).toBe(percentile);
          expect(rerolled.subrolls.find((candidate) => candidate.id === subroll.id)?.roll).toBeGreaterThan(0);
          for (const [id, roll] of unchanged) {
            const retained = rerolled.subrolls.find((candidate) => candidate.id === id);
            if (retained) expect(retained.roll).toBe(roll);
          }
        }
      }
    }
  });

  it('materializes the supplied Trauma Team composition without inventing a full STAT line', () => {
    const result = rollRandomEncounter({ period: 'daytime', zone: 'moderate', partySize: 4, percentile: 42, random: () => 0 });
    const materialized = materializeRandomEncounter(result);
    expect(materialized.unavailable).toEqual([]);
    expect(materialized.combatants).toHaveLength(5);
    expect(materialized.combatants.map((combatant) => combatant.statBlock?.combatNumber)).toEqual([10, 10, 10, 10, 10]);
    expect(materialized.combatants[0]?.statBlock?.stats).toEqual([]);
    expect(materialized.combatants[0]?.initiativeBase).toBeNull();
    expect(materialized.combatants[0]?.deathSaveBase).toBeNull();
    expect(materialized.combatants[0]?.statBlock?.sourceWarnings.join(' ')).toContain('BODY or MOVE');
  });

  it('requires the GM to choose one of the official Automated Turret weapon packages', () => {
    const result = rollRandomEncounter({ period: 'evening', zone: 'moderate', partySize: 4, percentile: 41, random: () => 0.9 });
    const blocked = materializeRandomEncounter(result);
    expect(blocked.unavailable.join(' ')).toContain('select an official weapon package');
    const turret = result.groups.find((group) => group.templateId === 'automated-turret')!;
    turret.selectedLoadoutId = 'assault-rifle';
    const ready = materializeRandomEncounter(result);
    expect(ready.unavailable).toEqual([]);
    expect(ready.combatants.filter((combatant) => combatant.statBlock?.templateId === 'automated-turret')).toHaveLength(2);
    expect(ready.combatants.at(-1)?.attacks[0]).toMatchObject({ name: 'Assault Rifle', base: 14, damage: '5d6' });
  });

  it('uses 1d6 + 1 for Psycho Squad arrival', () => {
    const result = rollRandomEncounter({ period: 'midnight', zone: 'moderate', partySize: 4, percentile: 100, random: () => 0 });
    expect(result.gmNotes).toContain('Psycho Squad estimated arrival: 2 rounds.');
    const psycho = materializeRandomEncounter(result).combatants[0]!;
    expect(psycho.painEditor).toBe(true);
    expect(psycho.statBlock?.cyberware.join(' ')).toContain('Pain Editor');
  });

  it('applies the advisory regional bands when enabled', () => {
    const corporate = rollRandomEncounter({ period: 'daytime', zone: 'corporate', partySize: 4, random: () => 0.999 });
    const combat = rollRandomEncounter({ period: 'daytime', zone: 'combat', partySize: 4, random: () => 0 });
    expect(corporate.roll).toBe(50);
    expect(combat.roll).toBe(51);
    expect(corporate.regionalGuidance).toBe(true);
  });

  it('can keep the selected zone context while rolling the full table', () => {
    const corporate = rollRandomEncounter({ period: 'daytime', zone: 'corporate', partySize: 4, regionalGuidance: false, random: () => 0 });
    expect(corporate.roll).toBe(100);
    expect(corporate.regionalGuidance).toBe(false);
    expect(corporate.gmNotes.join(' ')).toContain('full 01–100 table');
  });
});
