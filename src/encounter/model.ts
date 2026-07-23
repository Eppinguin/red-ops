import type { GeneratedNpcView, InventoryEntry, Item } from '../engine/types';
import { createCriticalInjury, findCriticalInjury } from './criticalInjuries';
import {
  defaultRangeBand,
  inferRangeProfile,
  isRangeBandId,
  isRangeProfileId,
  rangeDv,
} from './rangeDvs';
import type { RangeBandId } from './rangeDvs';
import type {
  ArmorLocation,
  AttackRollResult,
  DamageRollResult,
  DamageResult,
  EncounterAction,
  EncounterAttack,
  EncounterCombatant,
  EncounterCore,
  EncounterState,
  ExplodingD10Result,
} from './types';

const MAX_UNDO = 40;

function id(prefix: string): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function now(): string {
  return new Date().toISOString();
}

export function createEmptyEncounter(name = 'New encounter'): EncounterState {
  const timestamp = now();
  return {
    version: 1,
    id: id('encounter'),
    name,
    brief: '',
    round: 1,
    activeCombatantId: null,
    combatants: [],
    updatedAt: timestamp,
    past: [],
    lastEvent: null,
  };
}

function cloneCombatant(combatant: EncounterCombatant): EncounterCombatant {
  const { npcView, ...mutable } = combatant;
  return { ...structuredClone(mutable), npcView };
}

function cloneCore(core: EncounterCore): EncounterCore {
  return {
    ...core,
    combatants: core.combatants.map(cloneCombatant),
  };
}

function coreOf(state: EncounterState): EncounterCore {
  const { past: _past, lastEvent: _lastEvent, ...core } = state;
  return cloneCore(core);
}

function withHistory(state: EncounterState, label: string): EncounterState {
  return {
    ...state,
    past: [...state.past, { label, createdAt: now(), core: coreOf(state) }].slice(-MAX_UNDO),
  };
}

export function sortCombatants(combatants: readonly EncounterCombatant[]): EncounterCombatant[] {
  return [...combatants].sort((left, right) => {
    const leftInitiative = left.initiative ?? Number.NEGATIVE_INFINITY;
    const rightInitiative = right.initiative ?? Number.NEGATIVE_INFINITY;
    return rightInitiative - leftInitiative || left.createdAt.localeCompare(right.createdAt) || left.name.localeCompare(right.name);
  });
}

export function isSeriouslyWounded(combatant: EncounterCombatant): boolean {
  return !combatant.painEditor
    && combatant.currentHp !== null
    && combatant.currentHp > 0
    && combatant.seriouslyWoundedAt !== null
    && combatant.currentHp <= combatant.seriouslyWoundedAt;
}

export function combatantPenalty(combatant: EncounterCombatant): number {
  const serious = isSeriouslyWounded(combatant) ? 2 : 0;
  const conditions = combatant.conditions.reduce((sum, condition) => sum + Math.max(0, condition.penalty), 0);
  const criticals = combatant.criticalInjuries.reduce((sum, injury) => sum + Math.max(0, injury.penalty), 0);
  return serious + conditions + criticals;
}

export function canDodgeRanged(combatant: EncounterCombatant): boolean {
  return combatant.reflex !== null && combatant.reflex >= 8 && combatant.evasionBase !== null;
}

export function effectiveEvasionBase(combatant: EncounterCombatant): number | null {
  return combatant.evasionBase === null ? null : combatant.evasionBase - combatantPenalty(combatant);
}

function attackScope(attack: EncounterAttack): 'ranged' | 'melee' {
  const value = `${attack.skill} ${attack.name}`.toLowerCase();
  return /brawling|martial|melee|knife|sword|club|baton|axe|hammer|chainsaw/.test(value) ? 'melee' : 'ranged';
}

export function attackPenalty(combatant: EncounterCombatant, attack: EncounterAttack): number {
  const base = combatantPenalty(combatant);
  const scope = attackScope(attack);
  const scoped = combatant.criticalInjuries.reduce((sum, injury) => {
    if (!injury.attackPenalty || injury.attackPenalty.scope !== scope) return sum;
    return sum + Math.max(0, injury.attackPenalty.value);
  }, 0);
  return base + scoped;
}

export function deathSaveTarget(combatant: EncounterCombatant): number | null {
  if (combatant.deathSaveBase === null) return null;
  const criticalPenalty = combatant.criticalInjuries.reduce((sum, injury) => sum + Math.max(0, injury.deathSavePenalty), 0);
  return Math.max(0, combatant.deathSaveBase - combatant.deathSaveFailures - criticalPenalty);
}

function bodyAndHeadArmor(view: GeneratedNpcView): Record<ArmorLocation, { current: number; max: number }> {
  const head = view.npc.armor.find((armor) => /helmet|head/i.test(armor.name));
  const body = view.npc.armor.find((armor) => armor !== head) ?? view.npc.armor[0];
  const bodySp = body?.armor_class ?? 0;
  const headSp = head?.armor_class ?? 0;
  return {
    body: { current: bodySp, max: bodySp },
    head: { current: headSp, max: headSp },
  };
}

function ammoInventory(view: GeneratedNpcView): InventoryEntry[] {
  return [...view.npc.inventory.values()].filter((entry) => entry.item.type === 'ammo' && entry.amount > 0);
}

function reserveForAttack(view: GeneratedNpcView, weapon: Item | undefined): number | null {
  if (!weapon?.magazine) return null;
  const compatible = new Set(weapon.ammo_types.map((value) => value.toLowerCase()));
  const total = ammoInventory(view)
    .filter((entry) => compatible.size === 0 || [...compatible].some((type) => entry.item.name.toLowerCase().includes(type)))
    .reduce((sum, entry) => sum + entry.amount, 0);
  return Math.max(0, total - weapon.magazine);
}

function viewStat(view: GeneratedNpcView, name: string): number | null {
  return view.stats.find((stat) => stat.name === name)?.total ?? null;
}

function viewSkill(view: GeneratedNpcView, name: string): number | null {
  return view.skills.find((skill) => skill.name.toLowerCase() === name.toLowerCase())?.total ?? null;
}

function attacksFromNpc(view: GeneratedNpcView): EncounterAttack[] {
  return view.combat.attacks.map((attack, index) => {
    const weapon = view.npc.weapons.find((candidate) => candidate.name === attack.name)
      ?? view.npc.weapons[index];
    const magazine = attack.magazine;
    const rangeProfile = inferRangeProfile(attack.name, attack.skill ?? '', weapon?.tags ?? []);
    return {
      id: id('attack'),
      name: attack.name,
      skill: attack.skill ?? 'Attack',
      base: attack.attackBase,
      damage: attack.damage,
      rateOfFire: attack.rateOfFire,
      autofireBase: attack.autofireBase,
      rangeProfile,
      selectedRangeBand: defaultRangeBand(rangeProfile),
      ammo: {
        current: magazine,
        max: magazine,
        reserve: reserveForAttack(view, weapon),
      },
      notes: '',
    };
  });
}

export function combatantFromNpc(view: GeneratedNpcView): EncounterCombatant {
  const timestamp = now();
  const primary = view.combat.attacks[0];
  return {
    id: id('npc'),
    kind: 'npc',
    side: 'enemy',
    name: `${view.npc.name} ${view.npc.surname}`,
    initiative: null,
    initiativeBase: view.combat.initiative,
    currentHp: view.hp.current,
    maxHp: view.hp.max,
    seriouslyWoundedAt: view.hp.seriouslyWounded,
    painEditor: view.hp.painEditor,
    armor: bodyAndHeadArmor(view),
    conditions: [],
    criticalInjuries: [],
    attacks: attacksFromNpc(view),
    cover: null,
    heldAction: null,
    deathSaveBase: view.combat.deathSave,
    deathSaveFailures: 0,
    reflex: viewStat(view, 'REF'),
    evasionBase: viewSkill(view, 'Evasion'),
    tactics: primary
      ? `Open with ${primary.name} at ${primary.skill ?? 'its attack skill'} +${primary.attackBase ?? '—'}. Use cover and reposition when seriously wounded.`
      : 'Use the strongest available skill and seek cover when pressured.',
    notes: '',
    npcView: structuredClone(view),
    statBlock: null,
    createdAt: timestamp,
  };
}

export function createPcCombatant(input: {
  name: string;
  initiative?: number | null;
  initiativeBase?: number | null;
  maxHp?: number | null;
  bodySp?: number;
  headSp?: number;
}): EncounterCombatant {
  const maxHp = input.maxHp && input.maxHp > 0 ? Math.trunc(input.maxHp) : null;
  return {
    id: id('pc'),
    kind: 'pc',
    side: 'player',
    name: input.name.trim() || 'Player character',
    initiative: input.initiative ?? null,
    initiativeBase: input.initiativeBase ?? null,
    currentHp: maxHp,
    maxHp,
    seriouslyWoundedAt: maxHp === null ? null : Math.ceil(maxHp / 2),
    painEditor: false,
    armor: {
      body: { current: Math.max(0, Math.trunc(input.bodySp ?? 0)), max: Math.max(0, Math.trunc(input.bodySp ?? 0)) },
      head: { current: Math.max(0, Math.trunc(input.headSp ?? 0)), max: Math.max(0, Math.trunc(input.headSp ?? 0)) },
    },
    conditions: [],
    criticalInjuries: [],
    attacks: [],
    cover: null,
    heldAction: null,
    deathSaveBase: null,
    deathSaveFailures: 0,
    reflex: null,
    evasionBase: null,
    tactics: '',
    notes: '',
    npcView: null,
    statBlock: null,
    createdAt: now(),
  };
}

export function calculateDamage(combatant: EncounterCombatant, location: ArmorLocation, rawDamage: number): DamageResult {
  const damage = Math.max(0, Math.trunc(rawDamage));
  const armorBefore = combatant.armor[location].current;
  const penetrates = damage > armorBefore;
  const penetratingDamage = penetrates ? Math.max(0, damage - armorBefore) : 0;
  const headMultiplier = location === 'head'
    ? Math.max(2, ...combatant.criticalInjuries.map((injury) => injury.headDamageMultiplier ?? 0))
    : 1;
  const hpDamage = location === 'head' ? penetratingDamage * headMultiplier : penetratingDamage;
  const armorAfter = penetrates ? Math.max(0, armorBefore - 1) : armorBefore;
  const hpBefore = combatant.currentHp;
  const hpAfter = hpBefore === null ? null : Math.max(0, hpBefore - hpDamage);
  const preview = { ...combatant, currentHp: hpAfter };
  return {
    location,
    rawDamage: damage,
    armorBefore,
    armorAfter,
    hpDamage,
    hpBefore,
    hpAfter,
    seriouslyWounded: isSeriouslyWounded(preview),
    defeated: hpAfter !== null && hpAfter <= 0,
    headMultiplier,
  };
}

function updateCombatant(state: EncounterState, combatantId: string, transform: (combatant: EncounterCombatant) => EncounterCombatant): EncounterState {
  return {
    ...state,
    combatants: state.combatants.map((combatant) => combatant.id === combatantId ? transform(combatant) : combatant),
  };
}

function randomD10(): number {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return (values[0]! % 10) + 1;
}

function boundedD10(value: number): number {
  return Math.max(1, Math.min(10, Math.trunc(value)));
}

/**
 * Cyberpunk RED d10 checks explode once: a natural 10 adds one more d10 and a
 * natural 1 subtracts one more d10. The additional die never explodes again.
 */
export function rollExplodingD10(die = randomD10(), suppliedExtraDie?: number): ExplodingD10Result {
  const primary = boundedD10(die);
  if (primary !== 10 && primary !== 1) return { die: primary, extraDie: null, dieTotal: primary };
  const extraDie = boundedD10(suppliedExtraDie ?? randomD10());
  return {
    die: primary,
    extraDie,
    dieTotal: primary === 10 ? primary + extraDie : primary - extraDie,
  };
}

function formatExplodingRoll(result: ExplodingD10Result): string {
  if (result.extraDie === null) return String(result.die);
  return result.die === 10
    ? `${result.die} + ${result.extraDie}`
    : `${result.die} − ${result.extraDie}`;
}

function randomDie(sides: number): number {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return (values[0]! % sides) + 1;
}

export function rollDamageFormula(formula: string, suppliedDice?: readonly number[]): DamageRollResult {
  const normalized = formula.trim().replace(/\s+/g, '');
  const match = normalized.match(/^(\d+)d(\d+)([+-]\d+)?$/i);
  if (!match) throw new Error(`Unsupported damage formula: ${formula}`);
  const count = Math.max(1, Math.min(30, Number(match[1])));
  const sides = Math.max(2, Math.min(100, Number(match[2])));
  const modifier = Number(match[3] ?? 0);
  const dice = Array.from({ length: count }, (_, index) => {
    const supplied = suppliedDice?.[index];
    return supplied === undefined ? randomDie(sides) : Math.max(1, Math.min(sides, Math.trunc(supplied)));
  });
  return {
    attackId: '',
    formula: normalized,
    dice,
    modifier,
    total: dice.reduce((sum, die) => sum + die, modifier),
    critical: sides === 6 && dice.filter((die) => die === 6).length >= 2,
  };
}

function rollAttack(combatant: EncounterCombatant, attackId: string, die: number, extraDie?: number): { combatant: EncounterCombatant; result: AttackRollResult } {
  let result: AttackRollResult | null = null;
  const roll = rollExplodingD10(die, extraDie);
  const attacks = combatant.attacks.map((attack) => {
    const penalty = attackPenalty(combatant, attack);
    if (attack.id !== attackId) return attack;
    const hasAmmo = attack.ammo.current === null || attack.ammo.current > 0;
    const ammoSpent = attack.ammo.current !== null && hasAmmo;
    const current = ammoSpent ? Math.max(0, attack.ammo.current! - 1) : attack.ammo.current;
    result = {
      attackId,
      die: roll.die,
      extraDie: roll.extraDie,
      dieTotal: roll.dieTotal,
      base: attack.base,
      penalty,
      total: attack.base === null ? null : attack.base - penalty + roll.dieTotal,
      ammoSpent,
    };
    return { ...attack, ammo: { ...attack.ammo, current } };
  });
  if (!result) throw new Error('Unknown attack.');
  return { combatant: { ...combatant, attacks }, result };
}

export function encounterReducer(state: EncounterState, action: EncounterAction): EncounterState {
  if (action.type === 'undo') {
    const previous = state.past.at(-1);
    if (!previous) return state;
    return {
      ...cloneCore(previous.core),
      past: state.past.slice(0, -1),
      lastEvent: `Undid: ${previous.label}`,
    };
  }

  if (action.type === 'rename') return { ...state, name: action.name, updatedAt: now() };

  if (action.type === 'set-brief') return { ...state, brief: action.brief, updatedAt: now() };

  if (action.type === 'rename-combatant') {
    const name = action.name.trim();
    if (!name) return state;
    return {
      ...withHistory(state, `Renamed combatant to ${name}`),
      combatants: state.combatants.map((combatant) => combatant.id === action.combatantId ? { ...combatant, name } : combatant),
      updatedAt: now(),
      lastEvent: `Renamed combatant to ${name}`,
    };
  }

  if (action.type === 'set-combatant-side') {
    return {
      ...withHistory(state, `Changed combatant disposition to ${action.side}`),
      combatants: state.combatants.map((combatant) => combatant.id === action.combatantId ? { ...combatant, side: action.side } : combatant),
      updatedAt: now(),
      lastEvent: `Changed combatant disposition to ${action.side}`,
    };
  }

  if (action.type === 'set-active') {
    return { ...state, activeCombatantId: action.combatantId, updatedAt: now(), lastEvent: null };
  }

  if (action.type === 'set-attack-range') {
    return {
      ...updateCombatant(state, action.combatantId, (combatant) => ({
        ...combatant,
        attacks: combatant.attacks.map((attack) => attack.id === action.attackId
          ? { ...attack, selectedRangeBand: action.rangeBand }
          : attack),
      })),
      updatedAt: now(),
    };
  }

  const label = (() => {
    switch (action.type) {
      case 'add-combatant': return `Added ${action.combatant.name}`;
      case 'add-combatants': return action.source
        ? `Added ${action.combatants.length} combatants from ${action.source}`
        : `Added ${action.combatants.length} combatants`;
      case 'apply-random-encounter': return `Added random encounter: ${action.source}`;
      case 'remove-combatant': return 'Removed combatant';
      case 'advance-turn': return action.direction === 1 ? 'Advanced turn' : 'Moved turn back';
      case 'set-initiative': return 'Changed initiative';
      case 'roll-initiative': return `Rolled initiative for ${action.scope}`;
      case 'set-hp': return 'Changed HP';
      case 'set-armor': return `Changed ${action.location} armor`;
      case 'apply-damage': return `Applied ${action.damage} damage`;
      case 'heal': return `Healed ${action.amount} HP`;
      case 'add-condition': return `Added ${action.condition.name}`;
      case 'remove-condition': return 'Removed condition';
      case 'add-critical': return `Added critical injury: ${action.injury.name}`;
      case 'roll-critical': return `Rolled ${action.location} critical injury`;
      case 'remove-critical': return 'Removed critical injury';
      case 'set-cover': return 'Changed cover';
      case 'damage-cover': return `Damaged cover for ${action.damage}`;
      case 'set-held-action': return 'Changed held action';
      case 'set-notes': return 'Changed notes';
      case 'set-tactics': return 'Changed tactics';
      case 'set-attack-ammo': return 'Changed ammunition';
      case 'set-ranged-defense': return 'Changed ranged defense';
      case 'roll-attack': return 'Rolled attack';
      case 'resolve-ranged-attack': return 'Resolved ranged attack';
      case 'roll-damage': return 'Rolled damage';
      case 'roll-check': return `Rolled ${action.label}`;
      case 'reload-attack': return 'Reloaded weapon';
      case 'roll-death-save': return 'Rolled death save';
      case 'reset-rounds': return 'Reset round counter';
      case 'clear': return 'Cleared encounter';
    }
  })();

  let next = withHistory(state, label);
  let event = label;

  switch (action.type) {
    case 'add-combatant':
      next = { ...next, combatants: [...next.combatants, structuredClone(action.combatant)] };
      break;
    case 'add-combatants':
      next = { ...next, combatants: [...next.combatants, ...action.combatants.map((combatant) => structuredClone(combatant))] };
      break;
    case 'apply-random-encounter':
      next = {
        ...next,
        brief: next.brief.trim() ? `${next.brief.trim()}\n\n${action.brief}` : action.brief,
        combatants: [...next.combatants, ...action.combatants.map((combatant) => structuredClone(combatant))],
      };
      break;
    case 'remove-combatant': {
      const combatants = next.combatants.filter((combatant) => combatant.id !== action.combatantId);
      next = { ...next, combatants, activeCombatantId: next.activeCombatantId === action.combatantId ? null : next.activeCombatantId };
      break;
    }
    case 'advance-turn': {
      const ordered = sortCombatants(next.combatants);
      if (!ordered.length) break;
      const currentIndex = ordered.findIndex((combatant) => combatant.id === next.activeCombatantId);
      const fallback = action.direction === 1 ? -1 : 0;
      const index = currentIndex < 0 ? fallback : currentIndex;
      let target = index + action.direction;
      let round = next.round;
      if (target >= ordered.length) {
        target = 0;
        round += 1;
      } else if (target < 0) {
        target = ordered.length - 1;
        round = Math.max(1, round - 1);
      }
      next = { ...next, activeCombatantId: ordered[target]!.id, round };
      event = `Round ${round} · ${ordered[target]!.name}`;
      break;
    }
    case 'set-initiative':
      next = updateCombatant(next, action.combatantId, (combatant) => ({ ...combatant, initiative: action.initiative }));
      break;
    case 'roll-initiative':
      next = {
        ...next,
        combatants: next.combatants.map((combatant) => {
          if (action.scope === 'npcs' && combatant.kind !== 'npc') return combatant;
          if (combatant.initiativeBase === null) return combatant;
          const roll = rollExplodingD10(action.rolls?.[combatant.id] ?? randomD10(), action.extraRolls?.[combatant.id]);
          return { ...combatant, initiative: combatant.initiativeBase + roll.dieTotal };
        }),
      };
      event = `Rolled initiative for ${action.scope === 'npcs' ? 'NPCs' : 'all combatants'} with RED critical d10s`;
      break;
    case 'set-hp':
      next = updateCombatant(next, action.combatantId, (combatant) => {
        const maxHp = action.max === undefined ? combatant.maxHp : action.max;
        const current = action.current === null || maxHp === null ? action.current : Math.max(0, Math.min(action.current, maxHp));
        return { ...combatant, currentHp: current, maxHp, seriouslyWoundedAt: maxHp === null ? null : Math.ceil(maxHp / 2) };
      });
      break;
    case 'set-armor':
      next = updateCombatant(next, action.combatantId, (combatant) => ({
        ...combatant,
        armor: {
          ...combatant.armor,
          [action.location]: {
            current: Math.max(0, Math.trunc(action.current)),
            max: Math.max(0, Math.trunc(action.max ?? combatant.armor[action.location].max)),
          },
        },
      }));
      break;
    case 'apply-damage':
      next = updateCombatant(next, action.combatantId, (combatant) => {
        const result = calculateDamage(combatant, action.location, action.damage);
        event = `${combatant.name}: ${result.hpDamage} HP, ${result.location} SP ${result.armorBefore}→${result.armorAfter}`;
        return {
          ...combatant,
          currentHp: result.hpAfter,
          deathSaveFailures: result.hpBefore === 0 && result.hpDamage > 0
            ? combatant.deathSaveFailures + 1
            : combatant.deathSaveFailures,
          armor: { ...combatant.armor, [action.location]: { ...combatant.armor[action.location], current: result.armorAfter } },
        };
      });
      break;
    case 'heal':
      next = updateCombatant(next, action.combatantId, (combatant) => ({
        ...combatant,
        currentHp: combatant.currentHp === null || combatant.maxHp === null
          ? combatant.currentHp
          : Math.min(combatant.maxHp, combatant.currentHp + Math.max(0, Math.trunc(action.amount))),
      }));
      break;
    case 'add-condition':
      next = updateCombatant(next, action.combatantId, (combatant) => ({ ...combatant, conditions: [...combatant.conditions, action.condition] }));
      break;
    case 'remove-condition':
      next = updateCombatant(next, action.combatantId, (combatant) => ({ ...combatant, conditions: combatant.conditions.filter((condition) => condition.id !== action.conditionId) }));
      break;
    case 'add-critical':
      next = updateCombatant(next, action.combatantId, (combatant) => {
        const alreadyPresent = action.injury.definitionId
          && combatant.criticalInjuries.some((injury) => injury.definitionId === action.injury.definitionId);
        if (alreadyPresent) {
          event = `${combatant.name} already has ${action.injury.name}`;
          return combatant;
        }
        const bonusDamage = action.applyBonusDamage ? Math.max(0, action.injury.bonusDamage ?? 5) : 0;
        event = `${combatant.name}: ${action.injury.name}${bonusDamage ? ` · ${bonusDamage} direct HP` : ''}`;
        return {
          ...combatant,
          currentHp: combatant.currentHp === null ? null : Math.max(0, combatant.currentHp - bonusDamage),
          criticalInjuries: [...combatant.criticalInjuries, action.injury],
        };
      });
      break;
    case 'roll-critical':
      next = updateCombatant(next, action.combatantId, (combatant) => {
        const existing = new Set(combatant.criticalInjuries.map((injury) => injury.definitionId).filter(Boolean));
        let rolled = action.roll ?? randomDie(6) + randomDie(6);
        let definition = findCriticalInjury(action.location, rolled);
        for (let attempt = 0; definition && existing.has(definition.id) && attempt < 30; attempt += 1) {
          rolled = randomDie(6) + randomDie(6);
          definition = findCriticalInjury(action.location, rolled);
        }
        if (!definition) return combatant;
        const injury = createCriticalInjury(definition, id('critical'));
        const bonusDamage = action.applyBonusDamage === false ? 0 : definition.bonusDamage;
        event = `${combatant.name}: ${action.location} critical ${rolled} · ${definition.name}${bonusDamage ? ` · ${bonusDamage} direct HP` : ''}`;
        return {
          ...combatant,
          currentHp: combatant.currentHp === null ? null : Math.max(0, combatant.currentHp - bonusDamage),
          criticalInjuries: [...combatant.criticalInjuries, injury],
        };
      });
      break;
    case 'remove-critical':
      next = updateCombatant(next, action.combatantId, (combatant) => ({ ...combatant, criticalInjuries: combatant.criticalInjuries.filter((injury) => injury.id !== action.injuryId) }));
      break;
    case 'set-cover':
      next = updateCombatant(next, action.combatantId, (combatant) => ({ ...combatant, cover: action.cover }));
      break;
    case 'damage-cover':
      next = updateCombatant(next, action.combatantId, (combatant) => ({
        ...combatant,
        cover: combatant.cover ? { ...combatant.cover, currentHp: Math.max(0, combatant.cover.currentHp - Math.max(0, Math.trunc(action.damage))) } : null,
      }));
      break;
    case 'set-held-action':
      next = updateCombatant(next, action.combatantId, (combatant) => ({ ...combatant, heldAction: action.heldAction }));
      break;
    case 'set-notes':
      next = updateCombatant(next, action.combatantId, (combatant) => ({ ...combatant, notes: action.notes }));
      break;
    case 'set-tactics':
      next = updateCombatant(next, action.combatantId, (combatant) => ({ ...combatant, tactics: action.tactics }));
      break;
    case 'set-attack-ammo':
      next = updateCombatant(next, action.combatantId, (combatant) => ({
        ...combatant,
        attacks: combatant.attacks.map((attack) => attack.id === action.attackId ? {
          ...attack,
          ammo: {
            ...attack.ammo,
            current: action.current,
            reserve: action.reserve === undefined ? attack.ammo.reserve : action.reserve,
          },
        } : attack),
      }));
      break;
    case 'set-ranged-defense':
      next = updateCombatant(next, action.combatantId, (combatant) => ({
        ...combatant,
        reflex: action.reflex === null ? null : Math.max(0, Math.trunc(action.reflex)),
        evasionBase: action.evasionBase === null ? null : Math.trunc(action.evasionBase),
      }));
      break;
    case 'resolve-ranged-attack': {
      const attacker = next.combatants.find((candidate) => candidate.id === action.combatantId);
      const target = action.targetId
        ? next.combatants.find((candidate) => candidate.id === action.targetId) ?? null
        : null;
      const attack = attacker?.attacks.find((candidate) => candidate.id === action.attackId);
      if (!attacker || !attack) break;
      if (attack.ammo.current === 0) {
        event = `${attacker.name} · ${attack.name}: empty`;
        break;
      }

      const rolled = rollAttack(attacker, attack.id, action.attackDie ?? randomD10(), action.attackExtraDie);
      const selectedRangeBand = action.rangeBand ?? attack.selectedRangeBand ?? defaultRangeBand(attack.rangeProfile);
      const updatedAttacker = {
        ...rolled.combatant,
        attacks: rolled.combatant.attacks.map((candidate) => candidate.id === attack.id
          ? { ...candidate, selectedRangeBand }
          : candidate),
      };
      next = updateCombatant(next, attacker.id, () => updatedAttacker);

      const attackTotal = rolled.result.total;
      let defenseValue: number | null = null;
      let defenseText = 'unresolved defense';

      if (action.defenseMode === 'dodge' && target && canDodgeRanged(target)) {
        const defenseBase = effectiveEvasionBase(target)!;
        const defenseRoll = rollExplodingD10(action.defenseDie ?? randomD10(), action.defenseExtraDie);
        defenseValue = defenseBase + defenseRoll.dieTotal;
        defenseText = `${target.name} Dodge ${defenseValue} (${formatExplodingRoll(defenseRoll)} + ${defenseBase})`;
      } else {
        defenseValue = rangeDv(attack.rangeProfile, selectedRangeBand);
        const bandLabel = selectedRangeBand ?? 'range not selected';
        defenseText = defenseValue === null
          ? `range DV unavailable at ${bandLabel}`
          : `DV ${defenseValue} at ${bandLabel}`;
      }

      const outcome = attackTotal === null || defenseValue === null
        ? 'UNRESOLVED'
        : attackTotal > defenseValue ? 'HIT' : 'MISS';
      event = `${attacker.name} · ${attack.name} ${attackTotal ?? '—'} (${formatExplodingRoll(rolled.result)} + ${rolled.result.base ?? '—'}${rolled.result.penalty ? ` − ${rolled.result.penalty}` : ''}) vs ${defenseText} · ${outcome}`;
      break;
    }
    case 'roll-attack':
      next = updateCombatant(next, action.combatantId, (combatant) => {
        const attack = combatant.attacks.find((candidate) => candidate.id === action.attackId);
        if (!attack) throw new Error('Unknown attack.');
        if (attack.ammo.current === 0) {
          event = `${combatant.name} · ${attack.name}: empty`;
          return combatant;
        }
        const rolled = rollAttack(combatant, action.attackId, action.die ?? randomD10(), action.extraDie);
        event = `${combatant.name} · ${attack.skill} ${rolled.result.total === null ? '—' : rolled.result.total} (${formatExplodingRoll(rolled.result)} + ${rolled.result.base ?? '—'}${rolled.result.penalty ? ` − ${rolled.result.penalty}` : ''})`;
        return rolled.combatant;
      });
      break;
    case 'roll-damage':
      next = updateCombatant(next, action.combatantId, (combatant) => {
        const attack = combatant.attacks.find((candidate) => candidate.id === action.attackId);
        if (!attack?.damage) {
          event = `${combatant.name}: no damage formula for this attack`;
          return combatant;
        }
        try {
          const result = { ...rollDamageFormula(attack.damage, action.dice), attackId: attack.id };
          const dice = result.dice.join(', ');
          event = `${combatant.name} · ${attack.name} damage ${result.total} [${dice}]${result.modifier ? ` ${result.modifier >= 0 ? '+' : ''}${result.modifier}` : ''}${result.critical ? ' · CRITICAL INJURY' : ''}`;
        } catch {
          event = `${combatant.name} · ${attack.name}: unsupported damage formula ${attack.damage}`;
        }
        return combatant;
      });
      break;
    case 'roll-check': {
      const combatant = next.combatants.find((candidate) => candidate.id === action.combatantId);
      if (!combatant) break;
      const roll = rollExplodingD10(action.die ?? randomD10(), action.extraDie);
      const base = Math.trunc(action.base);
      event = `${combatant.name} · ${action.label} ${base + roll.dieTotal} (${formatExplodingRoll(roll)} + ${base})`;
      break;
    }
    case 'reload-attack':
      next = updateCombatant(next, action.combatantId, (combatant) => ({
        ...combatant,
        attacks: combatant.attacks.map((attack) => {
          if (attack.id !== action.attackId || attack.ammo.current === null || attack.ammo.max === null) return attack;
          const needed = Math.max(0, attack.ammo.max - attack.ammo.current);
          if (needed === 0) {
            event = `${combatant.name} · ${attack.name}: already loaded`;
            return attack;
          }
          if (attack.ammo.reserve === null) {
            event = `${combatant.name} · ${attack.name}: reloaded to ${attack.ammo.max}`;
            return { ...attack, ammo: { ...attack.ammo, current: attack.ammo.max } };
          }
          const loaded = Math.min(needed, attack.ammo.reserve);
          event = loaded > 0
            ? `${combatant.name} · ${attack.name}: reloaded ${loaded} (${attack.ammo.current + loaded}/${attack.ammo.max})`
            : `${combatant.name} · ${attack.name}: no reserve ammunition`;
          return { ...attack, ammo: { ...attack.ammo, current: attack.ammo.current + loaded, reserve: attack.ammo.reserve - loaded } };
        }),
      }));
      break;
    case 'roll-death-save':
      next = updateCombatant(next, action.combatantId, (combatant) => {
        const criticalPenalty = combatant.criticalInjuries.reduce((sum, injury) => sum + Math.max(0, injury.deathSavePenalty), 0);
        const die = action.die ?? randomD10();
        const total = die + combatant.deathSaveFailures + criticalPenalty;
        const success = combatant.deathSaveBase !== null && die !== 10 && total < combatant.deathSaveBase;
        event = `${combatant.name} death save: ${total} vs BODY ${combatant.deathSaveBase ?? '—'} · ${success ? 'success' : 'dead'}`;
        if (success) return { ...combatant, deathSaveFailures: combatant.deathSaveFailures + 1 };
        const alreadyDead = combatant.conditions.some((condition) => condition.name.toLowerCase() === 'dead');
        return {
          ...combatant,
          conditions: alreadyDead ? combatant.conditions : [...combatant.conditions, { id: id('condition'), name: 'Dead', penalty: 0, notes: 'Failed Death Save' }],
        };
      });
      break;
    case 'reset-rounds':
      next = { ...next, round: 1, activeCombatantId: null };
      break;
    case 'clear': {
      const empty = createEmptyEncounter(next.name);
      next = { ...empty, id: next.id, past: next.past };
      break;
    }
  }

  return { ...next, updatedAt: now(), lastEvent: event };
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function normalizeAttack(value: unknown): EncounterAttack {
  const raw = value && typeof value === 'object' ? value as Partial<EncounterAttack> : {};
  const name = typeof raw.name === 'string' ? raw.name : 'Attack';
  const skill = typeof raw.skill === 'string' ? raw.skill : 'Attack';
  const inferredProfile = inferRangeProfile(name, skill);
  const rangeProfile = isRangeProfileId(raw.rangeProfile) ? raw.rangeProfile : inferredProfile;
  const requestedBand = isRangeBandId(raw.selectedRangeBand) ? raw.selectedRangeBand : null;
  const selectedRangeBand = requestedBand && rangeDv(rangeProfile, requestedBand) !== null
    ? requestedBand
    : defaultRangeBand(rangeProfile);
  const autofireMatch = typeof raw.notes === 'string' ? raw.notes.match(/Autofire\s*\+?(-?\d+)/i) : null;
  const ammo = raw.ammo && typeof raw.ammo === 'object' ? raw.ammo : { current: null, max: null, reserve: null };
  return {
    id: typeof raw.id === 'string' ? raw.id : id('attack'),
    name,
    skill,
    base: finiteOrNull(raw.base),
    damage: typeof raw.damage === 'string' ? raw.damage : null,
    rateOfFire: finiteOrNull(raw.rateOfFire),
    autofireBase: finiteOrNull(raw.autofireBase) ?? (autofireMatch ? Number(autofireMatch[1]) : null),
    rangeProfile,
    selectedRangeBand,
    ammo: {
      current: finiteOrNull(ammo.current),
      max: finiteOrNull(ammo.max),
      reserve: finiteOrNull(ammo.reserve),
    },
    notes: typeof raw.notes === 'string' && !/^Autofire\s*\+?-?\d+$/i.test(raw.notes.trim()) ? raw.notes : '',
  };
}

function normalizeCombatant(value: unknown): EncounterCombatant {
  const raw = value && typeof value === 'object' ? value as Partial<EncounterCombatant> : {};
  const npcView = raw.npcView ?? null;
  const fallbackReflex = npcView ? viewStat(npcView, 'REF') : null;
  const fallbackEvasion = npcView ? viewSkill(npcView, 'Evasion') : null;
  const armor = raw.armor && typeof raw.armor === 'object' ? raw.armor : null;
  const body = armor?.body;
  const head = armor?.head;
  return {
    id: typeof raw.id === 'string' ? raw.id : id('combatant'),
    kind: raw.kind === 'pc' ? 'pc' : 'npc',
    side: raw.side === 'player' || raw.side === 'ally' || raw.side === 'neutral' ? raw.side : 'enemy',
    name: typeof raw.name === 'string' ? raw.name : 'Combatant',
    initiative: finiteOrNull(raw.initiative),
    initiativeBase: finiteOrNull(raw.initiativeBase),
    currentHp: finiteOrNull(raw.currentHp),
    maxHp: finiteOrNull(raw.maxHp),
    seriouslyWoundedAt: finiteOrNull(raw.seriouslyWoundedAt),
    painEditor: Boolean(raw.painEditor),
    armor: {
      body: { current: finiteOrNull(body?.current) ?? 0, max: finiteOrNull(body?.max) ?? finiteOrNull(body?.current) ?? 0 },
      head: { current: finiteOrNull(head?.current) ?? 0, max: finiteOrNull(head?.max) ?? finiteOrNull(head?.current) ?? 0 },
    },
    conditions: Array.isArray(raw.conditions) ? raw.conditions : [],
    criticalInjuries: Array.isArray(raw.criticalInjuries) ? raw.criticalInjuries : [],
    attacks: Array.isArray(raw.attacks) ? raw.attacks.map(normalizeAttack) : [],
    cover: raw.cover ?? null,
    heldAction: raw.heldAction ?? null,
    deathSaveBase: finiteOrNull(raw.deathSaveBase),
    deathSaveFailures: finiteOrNull(raw.deathSaveFailures) ?? 0,
    reflex: finiteOrNull(raw.reflex) ?? fallbackReflex,
    evasionBase: finiteOrNull(raw.evasionBase) ?? fallbackEvasion,
    tactics: typeof raw.tactics === 'string' ? raw.tactics : '',
    notes: typeof raw.notes === 'string' ? raw.notes : '',
    npcView,
    statBlock: raw.statBlock && typeof raw.statBlock === 'object' ? raw.statBlock : null,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : now(),
  };
}

export function normalizeEncounter(value: unknown): EncounterState {
  if (!value || typeof value !== 'object') return createEmptyEncounter();
  const raw = value as Partial<EncounterState>;
  if (raw.version !== 1 || !Array.isArray(raw.combatants)) return createEmptyEncounter();
  return {
    version: 1,
    id: typeof raw.id === 'string' ? raw.id : id('encounter'),
    name: typeof raw.name === 'string' ? raw.name : 'Encounter',
    brief: typeof raw.brief === 'string' ? raw.brief : '',
    round: typeof raw.round === 'number' && raw.round >= 1 ? Math.trunc(raw.round) : 1,
    activeCombatantId: typeof raw.activeCombatantId === 'string' ? raw.activeCombatantId : null,
    combatants: raw.combatants.map(normalizeCombatant),
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : now(),
    past: Array.isArray(raw.past) ? raw.past.slice(-MAX_UNDO) : [],
    lastEvent: typeof raw.lastEvent === 'string' ? raw.lastEvent : null,
  };
}
