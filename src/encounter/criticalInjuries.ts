import type { ArmorLocation, CriticalInjury } from './types';

export interface CriticalInjuryDefinition {
  id: string;
  location: ArmorLocation;
  roll: number;
  name: string;
  effect: string;
  quickFix: string;
  treatment: string;
  actionPenalty: number;
  attackPenalty?: CriticalInjury['attackPenalty'];
  deathSavePenalty: number;
  bonusDamage: number;
  headDamageMultiplier?: number;
}

/**
 * Concise mechanical summaries of the core Critical Injury tables.
 * Wording is intentionally abbreviated; source references remain the authority.
 */
export const CRITICAL_INJURIES: readonly CriticalInjuryDefinition[] = [
  {
    id: 'body-dismembered-arm', location: 'body', roll: 2, name: 'Dismembered Arm',
    effect: 'The arm is gone; drop anything held in that hand.', quickFix: 'None', treatment: 'Surgery DV17',
    actionPenalty: 0, deathSavePenalty: 1, bonusDamage: 5,
  },
  {
    id: 'body-dismembered-hand', location: 'body', roll: 3, name: 'Dismembered Hand',
    effect: 'The hand is gone; drop anything held in it.', quickFix: 'None', treatment: 'Surgery DV17',
    actionPenalty: 0, deathSavePenalty: 1, bonusDamage: 5,
  },
  {
    id: 'body-collapsed-lung', location: 'body', roll: 4, name: 'Collapsed Lung',
    effect: 'MOVE −2, minimum 1.', quickFix: 'Paramedic DV15', treatment: 'Surgery DV15',
    actionPenalty: 0, deathSavePenalty: 1, bonusDamage: 5,
  },
  {
    id: 'body-broken-ribs', location: 'body', roll: 5, name: 'Broken Ribs',
    effect: 'After a Turn moving more than 4 m/yd on foot, suffer the injury’s 5 HP bonus damage again.',
    quickFix: 'Paramedic DV13', treatment: 'Paramedic DV15 or Surgery DV13',
    actionPenalty: 0, deathSavePenalty: 0, bonusDamage: 5,
  },
  {
    id: 'body-broken-arm', location: 'body', roll: 6, name: 'Broken Arm',
    effect: 'That arm cannot be used; drop anything held by it.', quickFix: 'Paramedic DV13',
    treatment: 'Paramedic DV15 or Surgery DV13', actionPenalty: 0, deathSavePenalty: 0, bonusDamage: 5,
  },
  {
    id: 'body-foreign-object', location: 'body', roll: 7, name: 'Foreign Object',
    effect: 'After a Turn moving more than 4 m/yd on foot, suffer the injury’s 5 HP bonus damage again.',
    quickFix: 'First Aid or Paramedic DV13', treatment: 'A successful Quick Fix removes the effect permanently',
    actionPenalty: 0, deathSavePenalty: 0, bonusDamage: 5,
  },
  {
    id: 'body-broken-leg', location: 'body', roll: 8, name: 'Broken Leg',
    effect: 'MOVE −4, minimum 1.', quickFix: 'Paramedic DV13', treatment: 'Paramedic DV15 or Surgery DV13',
    actionPenalty: 0, deathSavePenalty: 0, bonusDamage: 5,
  },
  {
    id: 'body-torn-muscle', location: 'body', roll: 9, name: 'Torn Muscle',
    effect: 'Melee attacks suffer −2.', quickFix: 'First Aid or Paramedic DV13',
    treatment: 'A successful Quick Fix removes the effect permanently', actionPenalty: 0,
    attackPenalty: { scope: 'melee', value: 2 }, deathSavePenalty: 0, bonusDamage: 5,
  },
  {
    id: 'body-spinal-injury', location: 'body', roll: 10, name: 'Spinal Injury',
    effect: 'On the next Turn, only a Move Action can be taken.', quickFix: 'Paramedic DV15', treatment: 'Surgery DV15',
    actionPenalty: 0, deathSavePenalty: 1, bonusDamage: 5,
  },
  {
    id: 'body-crushed-fingers', location: 'body', roll: 11, name: 'Crushed Fingers',
    effect: 'Actions involving that hand suffer −4.', quickFix: 'Paramedic DV13', treatment: 'Surgery DV15',
    actionPenalty: 0, deathSavePenalty: 0, bonusDamage: 5,
  },
  {
    id: 'body-dismembered-leg', location: 'body', roll: 12, name: 'Dismembered Leg',
    effect: 'The leg is gone; MOVE −6, minimum 1, and attacks cannot be dodged.', quickFix: 'None', treatment: 'Surgery DV17',
    actionPenalty: 0, deathSavePenalty: 1, bonusDamage: 5,
  },
  {
    id: 'head-lost-eye', location: 'head', roll: 2, name: 'Lost Eye',
    effect: 'Ranged attacks and vision-based Perception checks suffer −4.', quickFix: 'None', treatment: 'Surgery DV17',
    actionPenalty: 0, attackPenalty: { scope: 'ranged', value: 4 }, deathSavePenalty: 1, bonusDamage: 5,
  },
  {
    id: 'head-brain-injury', location: 'head', roll: 3, name: 'Brain Injury',
    effect: 'All actions suffer −2.', quickFix: 'None', treatment: 'Surgery DV17',
    actionPenalty: 2, deathSavePenalty: 1, bonusDamage: 5,
  },
  {
    id: 'head-damaged-eye', location: 'head', roll: 4, name: 'Damaged Eye',
    effect: 'Ranged attacks and vision-based Perception checks suffer −2.', quickFix: 'Paramedic DV15', treatment: 'Surgery DV13',
    actionPenalty: 0, attackPenalty: { scope: 'ranged', value: 2 }, deathSavePenalty: 0, bonusDamage: 5,
  },
  {
    id: 'head-concussion', location: 'head', roll: 5, name: 'Concussion',
    effect: 'All actions suffer −2.', quickFix: 'First Aid or Paramedic DV13',
    treatment: 'A successful Quick Fix removes the effect permanently', actionPenalty: 2, deathSavePenalty: 0, bonusDamage: 5,
  },
  {
    id: 'head-broken-jaw', location: 'head', roll: 6, name: 'Broken Jaw',
    effect: 'Actions involving speech suffer −4.', quickFix: 'Paramedic DV13', treatment: 'Paramedic or Surgery DV13',
    actionPenalty: 0, deathSavePenalty: 0, bonusDamage: 5,
  },
  {
    id: 'head-foreign-object', location: 'head', roll: 7, name: 'Foreign Object',
    effect: 'After a Turn moving more than 4 m/yd on foot, suffer the injury’s 5 HP bonus damage again.',
    quickFix: 'First Aid or Paramedic DV13', treatment: 'A successful Quick Fix removes the effect permanently',
    actionPenalty: 0, deathSavePenalty: 0, bonusDamage: 5,
  },
  {
    id: 'head-whiplash', location: 'head', roll: 8, name: 'Whiplash',
    effect: 'Base Death Save Penalty increases by 1.', quickFix: 'Paramedic DV13', treatment: 'Paramedic or Surgery DV13',
    actionPenalty: 0, deathSavePenalty: 1, bonusDamage: 5,
  },
  {
    id: 'head-cracked-skull', location: 'head', roll: 9, name: 'Cracked Skull',
    effect: 'Aimed head shots multiply damage through SP by 3 instead of 2.', quickFix: 'Paramedic DV15',
    treatment: 'Paramedic or Surgery DV15', actionPenalty: 0, deathSavePenalty: 1, bonusDamage: 5, headDamageMultiplier: 3,
  },
  {
    id: 'head-damaged-ear', location: 'head', roll: 10, name: 'Damaged Ear',
    effect: 'After moving more than 4 m/yd on foot, no Move Action is available next Turn; hearing Perception suffers −2.',
    quickFix: 'Paramedic DV13', treatment: 'Surgery DV13', actionPenalty: 0, deathSavePenalty: 0, bonusDamage: 5,
  },
  {
    id: 'head-crushed-windpipe', location: 'head', roll: 11, name: 'Crushed Windpipe',
    effect: 'The character cannot speak.', quickFix: 'None', treatment: 'Surgery DV15',
    actionPenalty: 0, deathSavePenalty: 1, bonusDamage: 5,
  },
  {
    id: 'head-lost-ear', location: 'head', roll: 12, name: 'Lost Ear',
    effect: 'The ear is gone. After moving more than 4 m/yd on foot, no Move Action is available next Turn; hearing Perception suffers −4.',
    quickFix: 'None', treatment: 'Surgery DV17', actionPenalty: 0, deathSavePenalty: 1, bonusDamage: 5,
  },
] as const;

export function criticalInjuriesFor(location: ArmorLocation): readonly CriticalInjuryDefinition[] {
  return CRITICAL_INJURIES.filter((injury) => injury.location === location);
}

export function createCriticalInjury(definition: CriticalInjuryDefinition, id: string): CriticalInjury {
  return {
    id,
    definitionId: definition.id,
    location: definition.location,
    roll: definition.roll,
    name: definition.name,
    penalty: definition.actionPenalty,
    attackPenalty: definition.attackPenalty ?? null,
    deathSavePenalty: definition.deathSavePenalty,
    bonusDamage: definition.bonusDamage,
    headDamageMultiplier: definition.headDamageMultiplier ?? null,
    effect: definition.effect,
    quickFix: definition.quickFix,
    treatment: definition.treatment,
    notes: '',
  };
}

export function findCriticalInjury(location: ArmorLocation, roll: number): CriticalInjuryDefinition | undefined {
  return CRITICAL_INJURIES.find((injury) => injury.location === location && injury.roll === roll);
}
