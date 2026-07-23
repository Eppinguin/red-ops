import type { EncounterCondition } from './types';

export interface ConditionDefinition {
  id: string;
  name: string;
  description: string;
  defaultPenalty: number;
}

/**
 * Concise tracker guidance. These summaries are intentionally operational:
 * they tell the GM what to remember without reproducing full rules text.
 */
export const CONDITION_DEFINITIONS: readonly ConditionDefinition[] = [
  {
    id: 'prone',
    name: 'Prone',
    description: 'The combatant is on the ground. Track the positional modifiers and the movement needed to stand.',
    defaultPenalty: 0,
  },
  {
    id: 'grappled',
    name: 'Grappled',
    description: 'The combatant is being held. Track the grappler, escape requirement, and any movement or action restrictions.',
    defaultPenalty: 0,
  },
  {
    id: 'on-fire',
    name: 'On Fire',
    description: 'The combatant is burning. Record the fire damage and apply it at the appropriate recurring timing until extinguished.',
    defaultPenalty: 0,
  },
  {
    id: 'stunned',
    name: 'Stunned',
    description: 'The combatant has limited or no actions. Record the source and when the effect ends.',
    defaultPenalty: 0,
  },
  {
    id: 'suppressed',
    name: 'Suppressed',
    description: 'The combatant is affected by suppressive fire. Resolve the required movement or cover response before normal actions.',
    defaultPenalty: 0,
  },
  {
    id: 'dead',
    name: 'Dead',
    description: 'The combatant failed a Death Save and can no longer act.',
    defaultPenalty: 0,
  },
] as const;

const AUTOMATIC_DESCRIPTIONS: Readonly<Record<string, string>> = {
  'seriously wounded': 'At or below the Seriously Wounded threshold. Applies −2 to actions unless ignored by an applicable effect such as Pain Editor.',
  'mortally wounded': 'At 0 HP. Track Death Saves and further damage while the combatant remains in this state.',
  holding: 'The combatant has readied an action and is waiting for its recorded trigger.',
  cover: 'The combatant is protected by tracked cover. Cover HP is recorded separately from armor and character HP.',
  clear: 'No tracked conditions, critical injuries, held action, cover, or wound-state warning.',
};

export function findConditionDefinition(name: string): ConditionDefinition | undefined {
  const normalized = name.trim().toLowerCase();
  return CONDITION_DEFINITIONS.find((condition) => condition.name.toLowerCase() === normalized || condition.id === normalized);
}

export function conditionDescription(condition: Pick<EncounterCondition, 'name' | 'notes' | 'penalty'>): string {
  const definition = findConditionDefinition(condition.name);
  const notes = condition.notes?.trim();
  const base = definition?.description;
  const detail = notes && base && notes !== base
    ? `${base} ${notes}`
    : notes || base || 'Custom tracked condition. Add an effect description in the stat-block inspector.';
  return condition.penalty > 0 ? `${detail} Tracked action penalty: −${condition.penalty}.` : detail;
}

export function automaticStatusDescription(name: keyof typeof AUTOMATIC_DESCRIPTIONS | string): string {
  return AUTOMATIC_DESCRIPTIONS[name.toLowerCase()] ?? 'Tracked encounter status.';
}

export function createCondition(definition: ConditionDefinition, id: string): EncounterCondition {
  return {
    id,
    name: definition.name,
    penalty: definition.defaultPenalty,
    notes: definition.description,
  };
}
