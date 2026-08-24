import { describe, expect, it } from 'vitest';
import { CRITICAL_INJURIES, createCriticalInjury } from '../criticalInjuries';
import {
  attackPenalty,
  calculateDamage,
  canDodgeRanged,
  combatantPenalty,
  createEmptyEncounter,
  createPcCombatant,
  effectCheckModifier,
  encounterReducer,
  isSeriouslyWounded,
  normalizeEncounter,
  rollExplodingD10,
  rollDamageFormula,
  sortCombatants,
} from '../model';
import { inferRangeProfile, rangeDv } from '../rangeDvs';
import type { EncounterAttack } from '../types';

function attack(overrides: Partial<EncounterAttack> = {}): EncounterAttack {
  return {
    id: 'attack-1',
    name: 'Heavy Pistol',
    skill: 'Handgun',
    base: 13,
    damage: '3d6',
    rateOfFire: 2,
    autofireBase: null,
    rangeProfile: 'pistol',
    selectedRangeBand: '0-6m',
    ammo: { current: 8, max: 8, reserve: 16 },
    notes: '',
    ...overrides,
  };
}

describe('encounter model', () => {
  it('keeps a stable initiative order', () => {
    const a = { ...createPcCombatant({ name: 'A' }), initiative: 12, createdAt: '2026-01-01' };
    const b = { ...createPcCombatant({ name: 'B' }), initiative: 18, createdAt: '2026-01-02' };
    const c = { ...createPcCombatant({ name: 'C' }), initiative: 12, createdAt: '2026-01-03' };
    expect(sortCombatants([a, b, c]).map((entry) => entry.name)).toEqual(['B', 'A', 'C']);
  });

  it('renames and removes an individual combatant without affecting the rest of the roster', () => {
    let state = createEmptyEncounter();
    const first = createPcCombatant({ name: 'Tiger Claw 1' });
    const second = createPcCombatant({ name: 'Tiger Claw 2' });
    state = encounterReducer(state, { type: 'add-combatant', combatant: first });
    state = encounterReducer(state, { type: 'add-combatant', combatant: second });
    state = encounterReducer(state, { type: 'rename-combatant', combatantId: first.id, name: 'Side A Leader' });
    expect(state.combatants.map((combatant) => combatant.name)).toEqual(['Side A Leader', 'Tiger Claw 2']);
    state = encounterReducer(state, { type: 'remove-combatant', combatantId: second.id });
    expect(state.combatants.map((combatant) => combatant.name)).toEqual(['Side A Leader']);
  });

  it('applies armor before HP and ablates only on penetration', () => {
    const combatant = createPcCombatant({ name: 'PC', maxHp: 40, bodySp: 11 });
    expect(calculateDamage(combatant, 'body', 10)).toMatchObject({ hpDamage: 0, armorAfter: 11, hpAfter: 40 });
    expect(calculateDamage(combatant, 'body', 15)).toMatchObject({ hpDamage: 4, armorAfter: 10, hpAfter: 36 });
    expect(calculateDamage(combatant, 'head', 10)).toMatchObject({ hpDamage: 20, armorAfter: 0, hpAfter: 20, headMultiplier: 2 });
  });

  it('marks seriously wounded and applies the action penalty', () => {
    const combatant = { ...createPcCombatant({ name: 'PC', maxHp: 40 }), currentHp: 20 };
    expect(isSeriouslyWounded(combatant)).toBe(true);
    expect(combatantPenalty(combatant)).toBe(2);
  });

  it('rolls damage formulas separately from attack rolls and detects double sixes', () => {
    expect(rollDamageFormula('3d6+2', [6, 6, 1])).toMatchObject({
      formula: '3d6+2',
      dice: [6, 6, 1],
      modifier: 2,
      total: 15,
      critical: true,
    });
    expect(() => rollDamageFormula('special')).toThrow(/Unsupported damage formula/);
  });

  it('applies the RED critical d10 exactly once', () => {
    expect(rollExplodingD10(10, 7)).toEqual({ die: 10, extraDie: 7, dieTotal: 17 });
    expect(rollExplodingD10(1, 7)).toEqual({ die: 1, extraDie: 7, dieTotal: -6 });
    expect(rollExplodingD10(10, 10)).toEqual({ die: 10, extraDie: 10, dieTotal: 20 });
    expect(rollExplodingD10(6, 10)).toEqual({ die: 6, extraDie: null, dieTotal: 6 });
  });

  it('uses critical d10s for initiative and attack checks', () => {
    let state = createEmptyEncounter();
    const pc = {
      ...createPcCombatant({ name: 'PC', initiativeBase: 8 }),
      attacks: [attack({ ammo: { current: 1, max: 8, reserve: 8 } })],
    };
    state = encounterReducer(state, { type: 'add-combatant', combatant: pc });
    state = encounterReducer(state, {
      type: 'roll-initiative',
      scope: 'all',
      rolls: { [pc.id]: 10 },
      extraRolls: { [pc.id]: 4 },
    });
    expect(state.combatants[0]!.initiative).toBe(22);
    state = encounterReducer(state, { type: 'roll-attack', combatantId: pc.id, attackId: pc.attacks[0]!.id, die: 1, extraDie: 6 });
    expect(state.lastEvent).toContain('8');
    expect(state.lastEvent).toContain('1 − 6');
    expect(state.combatants[0]!.attacks[0]!.ammo.current).toBe(0);
  });

  it('reloads an empty weapon from reserve ammunition', () => {
    let state = createEmptyEncounter();
    const pc = {
      ...createPcCombatant({ name: 'PC' }),
      attacks: [attack({ ammo: { current: 0, max: 8, reserve: 3 } })],
    };
    state = encounterReducer(state, { type: 'add-combatant', combatant: pc });
    state = encounterReducer(state, { type: 'reload-attack', combatantId: pc.id, attackId: pc.attacks[0]!.id });
    expect(state.combatants[0]!.attacks[0]!.ammo).toEqual({ current: 3, max: 8, reserve: 0 });
    expect(state.lastEvent).toContain('reloaded 3');
  });

  it('applies predefined critical injury effects and direct bonus damage', () => {
    let state = createEmptyEncounter();
    const pc = createPcCombatant({ name: 'PC', maxHp: 40 });
    state = encounterReducer(state, { type: 'add-combatant', combatant: pc });
    state = encounterReducer(state, { type: 'roll-critical', combatantId: pc.id, location: 'body', roll: 4 });
    const changed = state.combatants[0]!;
    expect(changed.currentHp).toBe(35);
    expect(changed.criticalInjuries[0]).toMatchObject({ name: 'Collapsed Lung', deathSavePenalty: 1, bonusDamage: 5 });
  });

  it('uses scoped critical penalties for attack rolls', () => {
    const rangedDefinition = CRITICAL_INJURIES.find((injury) => injury.id === 'head-lost-eye')!;
    const meleeDefinition = CRITICAL_INJURIES.find((injury) => injury.id === 'body-torn-muscle')!;
    const combatant = {
      ...createPcCombatant({ name: 'PC', maxHp: 40 }),
      attacks: [attack(), attack({ id: 'attack-2', name: 'Brawling', skill: 'Brawling', damage: '2d6', ammo: { current: null, max: null, reserve: null } })],
      criticalInjuries: [createCriticalInjury(rangedDefinition, 'ranged'), createCriticalInjury(meleeDefinition, 'melee')],
    };
    expect(attackPenalty(combatant, combatant.attacks[0]!)).toBe(4);
    expect(attackPenalty(combatant, combatant.attacks[1]!)).toBe(2);
  });

  it('uses the Cracked Skull head multiplier', () => {
    const definition = CRITICAL_INJURIES.find((injury) => injury.id === 'head-cracked-skull')!;
    const combatant = {
      ...createPcCombatant({ name: 'PC', maxHp: 40 }),
      criticalInjuries: [createCriticalInjury(definition, 'cracked-skull')],
    };
    expect(calculateDamage(combatant, 'head', 10)).toMatchObject({ hpDamage: 30, hpAfter: 10, headMultiplier: 3 });
  });

  it('advances active turn without removing rows and supports undo', () => {
    let state = createEmptyEncounter();
    const first = { ...createPcCombatant({ name: 'First' }), initiative: 20 };
    const second = { ...createPcCombatant({ name: 'Second' }), initiative: 10 };
    state = encounterReducer(state, { type: 'add-combatant', combatant: first });
    state = encounterReducer(state, { type: 'add-combatant', combatant: second });
    state = encounterReducer(state, { type: 'advance-turn', direction: 1 });
    expect(state.activeCombatantId).toBe(first.id);
    expect(state.combatants).toHaveLength(2);
    const damaged = encounterReducer(state, { type: 'apply-damage', combatantId: first.id, location: 'body', damage: 5 });
    expect(damaged.past.length).toBeGreaterThan(state.past.length);
    expect(encounterReducer(damaged, { type: 'undo' }).combatants).toEqual(state.combatants);
  });

  it('maps ranged weapons to their table rows and returns only valid DVs', () => {
    expect(inferRangeProfile('Militech Mini-Gat (SMG)', 'Handgun')).toBe('smg');
    expect(inferRangeProfile('Assault Rifle', 'Shoulder Arms')).toBe('assault-rifle');
    expect(rangeDv('pistol', '0-6m')).toBe(13);
    expect(rangeDv('pistol', '201-400m')).toBeNull();
  });

  it('resolves a ranged attack against the selected range-table DV', () => {
    let state = createEmptyEncounter();
    const attacker = {
      ...createPcCombatant({ name: 'Attacker' }),
      attacks: [attack({ ammo: { current: 2, max: 8, reserve: 8 }, selectedRangeBand: '7-12m' })],
    };
    state = encounterReducer(state, { type: 'add-combatant', combatant: attacker });
    state = encounterReducer(state, {
      type: 'resolve-ranged-attack',
      combatantId: attacker.id,
      attackId: attacker.attacks[0]!.id,
      targetId: null,
      defenseMode: 'range-dv',
      rangeBand: '7-12m',
      attackDie: 3,
    });
    expect(state.lastEvent).toContain('vs DV 15');
    expect(state.lastEvent).toContain('HIT');
    expect(state.combatants[0]!.attacks[0]!.ammo.current).toBe(1);
  });

  it('allows REF 8+ defenders to replace the table DV with an Evasion roll', () => {
    let state = createEmptyEncounter();
    const attacker = {
      ...createPcCombatant({ name: 'Attacker' }),
      attacks: [attack({ ammo: { current: 2, max: 8, reserve: 8 } })],
    };
    const defender = { ...createPcCombatant({ name: 'Defender' }), reflex: 8, evasionBase: 12 };
    expect(canDodgeRanged(defender)).toBe(true);
    state = encounterReducer(state, { type: 'add-combatant', combatant: attacker });
    state = encounterReducer(state, { type: 'add-combatant', combatant: defender });
    state = encounterReducer(state, {
      type: 'resolve-ranged-attack',
      combatantId: attacker.id,
      attackId: attacker.attacks[0]!.id,
      targetId: defender.id,
      defenseMode: 'dodge',
      rangeBand: '0-6m',
      attackDie: 7,
      defenseDie: 6,
    });
    expect(state.lastEvent).toContain('Dodge 18');
    expect(state.lastEvent).toContain('HIT');
  });

  it('does not allow a REF 7 defender to use ranged dodge', () => {
    const defender = { ...createPcCombatant({ name: 'Defender' }), reflex: 7, evasionBase: 14 };
    expect(canDodgeRanged(defender)).toBe(false);
  });

  it('uses a drug dose, applies its Foundry modifier, and resolves the secondary save', () => {
    let state = createEmptyEncounter();
    const pc = {
      ...createPcCombatant({ name: 'User' }),
      reflex: 7,
      evasionBase: 12,
      itemActions: [{ id: 'synthcoke', name: 'Synthcoke', itemType: 'drug', remaining: 1, max: 1 }],
    };
    state = encounterReducer(state, { type: 'add-combatant', combatant: pc });
    state = encounterReducer(state, {
      type: 'use-item-action',
      combatantId: pc.id,
      actionId: 'synthcoke',
      condition: {
        id: 'synth-primary',
        name: 'Synthcoke · primary',
        penalty: 0,
        notes: '+1 REF',
        sourceActionId: 'synthcoke',
        phase: 'primary',
        secondaryDv: 15,
        modifiers: [{ key: 'system.stats.ref.value', value: 1 }],
      },
    });
    expect(state.combatants[0]!.itemActions[0]!.remaining).toBe(0);
    expect(effectCheckModifier(state.combatants[0]!, 'REF')).toBe(1);
    expect(canDodgeRanged(state.combatants[0]!)).toBe(true);

    state = encounterReducer(state, {
      type: 'reset-item-action',
      combatantId: pc.id,
      actionId: 'synthcoke',
    });
    expect(state.combatants[0]!.itemActions[0]!.remaining).toBe(1);
    expect(state.combatants[0]!.conditions.map((condition) => condition.id)).toEqual(['synth-primary']);
    expect(state.lastEvent).toContain('doses reset to 1');

    state = encounterReducer(state, {
      type: 'resolve-item-secondary',
      combatantId: pc.id,
      conditionId: 'synth-primary',
      base: 10,
      dv: 15,
      die: 4,
      failureCondition: {
        id: 'synth-secondary',
        name: 'Synthcoke · secondary',
        penalty: 0,
        notes: '-2 REF',
        sourceActionId: 'synthcoke',
        phase: 'secondary',
        modifiers: [{ key: 'system.stats.ref.value', value: -2 }],
      },
    });
    expect(state.lastEvent).toContain('FAILED');
    expect(state.combatants[0]!.conditions.map((condition) => condition.id)).toEqual(['synth-secondary']);
    expect(effectCheckModifier(state.combatants[0]!, 'REF')).toBe(-2);
  });

  it('treats Foundry pain suppression as ignoring Seriously Wounded', () => {
    const combatant = {
      ...createPcCombatant({ name: 'Black Lace user', maxHp: 40 }),
      currentHp: 10,
      conditions: [{
        id: 'black-lace',
        name: 'Black Lace · primary',
        penalty: 0,
        notes: 'Pain suppression',
        modifiers: [{ key: 'bonuses.hasPainSuppression', value: 1 }],
      }],
    };
    expect(isSeriouslyWounded(combatant)).toBe(false);
    expect(combatantPenalty(combatant)).toBe(0);
  });

  it('requires the attacker to beat the defense and remembers the selected range', () => {
    let state = createEmptyEncounter();
    const attacker = {
      ...createPcCombatant({ name: 'Attacker' }),
      attacks: [attack({ base: 12, ammo: { current: 2, max: 8, reserve: 8 } })],
    };
    state = encounterReducer(state, { type: 'add-combatant', combatant: attacker });
    state = encounterReducer(state, {
      type: 'resolve-ranged-attack',
      combatantId: attacker.id,
      attackId: attacker.attacks[0]!.id,
      targetId: null,
      defenseMode: 'range-dv',
      rangeBand: '7-12m',
      attackDie: 3,
    });
    expect(state.lastEvent).toContain('15');
    expect(state.lastEvent).toContain('MISS');
    expect(state.combatants[0]!.attacks[0]!.selectedRangeBand).toBe('7-12m');
  });

  it('adds a prepared random encounter atomically and preserves existing scene notes', () => {
    let state = createEmptyEncounter('Warehouse');
    state = encounterReducer(state, { type: 'set-brief', brief: 'Existing stakeout notes.' });
    const ganger = {
      ...createPcCombatant({ name: 'Road Ganger', maxHp: 25, bodySp: 4, headSp: 4 }),
      kind: 'npc' as const,
      side: 'enemy' as const,
    };
    state = encounterReducer(state, {
      type: 'apply-random-encounter',
      combatants: [ganger],
      brief: 'Daytime encounter 58: Nomads.',
      source: '58 Nomads',
    });
    expect(state.combatants).toHaveLength(1);
    expect(state.combatants[0]?.name).toBe('Road Ganger');
    expect(state.brief).toBe('Existing stakeout notes.\n\nDaytime encounter 58: Nomads.');
    expect(state.lastEvent).toContain('58 Nomads');
    expect(state.past).toHaveLength(1);
  });

  it('migrates saved attacks that predate range profiles and ranged-defense fields', () => {
    const oldCombatant = createPcCombatant({ name: 'Legacy' });
    const normalized = normalizeEncounter({
      ...createEmptyEncounter('Legacy encounter'),
      combatants: [{
        ...oldCombatant,
        reflex: undefined,
        evasionBase: undefined,
        attacks: [{
          id: 'old-attack',
          name: 'Assault Rifle',
          skill: 'Shoulder Arms',
          base: 14,
          damage: '5d6',
          rateOfFire: 1,
          ammo: { current: 25, max: 25, reserve: 50 },
          notes: 'Autofire +12',
        }],
      }],
    });
    expect(normalized.combatants[0]!.attacks[0]).toMatchObject({
      rangeProfile: 'assault-rifle',
      selectedRangeBand: '0-6m',
      autofireBase: 12,
    });
    expect(normalized.combatants[0]!.reflex).toBeNull();
    expect(normalized.combatants[0]!.evasionBase).toBeNull();
  });

});
