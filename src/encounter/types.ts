import type { GeneratedNpcView } from '../engine/types';
import type { RangeBandId, RangeProfileId } from './rangeDvs';

export type CombatantKind = 'npc' | 'pc';
export type CombatantSide = 'enemy' | 'player' | 'ally' | 'neutral';
export type ArmorLocation = 'body' | 'head';
export type AttackPenaltyScope = 'all' | 'ranged' | 'melee';
export type RangedDefenseMode = 'range-dv' | 'dodge';

export interface EncounterArmor {
  current: number;
  max: number;
}

export interface EncounterAttack {
  id: string;
  name: string;
  skill: string;
  base: number | null;
  damage: string | null;
  rateOfFire: number | null;
  autofireBase: number | null;
  rangeProfile: RangeProfileId | null;
  selectedRangeBand: RangeBandId | null;
  ammo: {
    current: number | null;
    max: number | null;
    reserve: number | null;
  };
  notes: string;
}

export interface EncounterCondition {
  id: string;
  name: string;
  penalty: number;
  notes: string;
  duration?: string;
  sourceActionId?: string;
  phase?: 'primary' | 'secondary';
  secondaryDv?: number;
  secondaryEffect?: string;
  modifiers?: Array<{ key: string; value: number }>;
}

export interface EncounterItemAction {
  id: string;
  name: string;
  itemType: string;
  remaining: number | null;
  max: number | null;
}

export interface CriticalInjury {
  id: string;
  definitionId?: string;
  location?: ArmorLocation;
  roll?: number;
  name: string;
  /** Penalty to every action. Scoped attack penalties are stored separately. */
  penalty: number;
  attackPenalty?: {
    scope: Exclude<AttackPenaltyScope, 'all'>;
    value: number;
  } | null;
  deathSavePenalty: number;
  bonusDamage?: number;
  headDamageMultiplier?: number | null;
  effect?: string;
  quickFix?: string;
  treatment?: string;
  notes: string;
}

export interface EncounterCover {
  name: string;
  currentHp: number;
  maxHp: number;
}

export interface HeldAction {
  action: string;
  trigger: string;
}

export type OfficialNpcTier = 'mook' | 'lieutenant' | 'mini-boss' | 'boss';

export interface EncounterStatValue {
  name: string;
  base: number;
  /** Value after permanent loadout penalties already printed in the source stat block. */
  effective: number;
  note?: string;
}

export interface EncounterSkillValue {
  name: string;
  base: number;
  /** Value after permanent loadout penalties already printed in the source stat block. */
  effective: number;
  note?: string;
}

export interface EncounterStatBlock {
  kind: 'official';
  templateId: string;
  templateName: string;
  tier: OfficialNpcTier;
  /** Some official simplified stat blocks use one combined value instead of a full STAT line. */
  combatNumber?: number;
  source: {
    label: string;
    page: string;
  };
  stats: EncounterStatValue[];
  skills: EncounterSkillValue[];
  armorName: string;
  gear: string[];
  cyberware: string[];
  programs: string[];
  specialRules: string[];
  modifications: string[];
  sourceWarnings: string[];
}

export interface EncounterCombatant {
  id: string;
  kind: CombatantKind;
  side: CombatantSide;
  /** Optional encounter-local team/faction label, e.g. "Side A" in a turf war. */
  teamLabel?: string;
  name: string;
  initiative: number | null;
  initiativeBase: number | null;
  currentHp: number | null;
  maxHp: number | null;
  seriouslyWoundedAt: number | null;
  painEditor: boolean;
  armor: Record<ArmorLocation, EncounterArmor>;
  conditions: EncounterCondition[];
  criticalInjuries: CriticalInjury[];
  attacks: EncounterAttack[];
  /** Carried items tagged as actions, with encounter-local dose/use tracking. */
  itemActions: EncounterItemAction[];
  cover: EncounterCover | null;
  heldAction: HeldAction | null;
  deathSaveBase: number | null;
  deathSaveFailures: number;
  /** REF determines whether this combatant may choose to dodge a ranged attack. */
  reflex: number | null;
  /** Total DEX + Evasion base before temporary encounter penalties. */
  evasionBase: number | null;
  tactics: string;
  notes: string;
  npcView: GeneratedNpcView | null;
  /** Normalized source stat block for official encounter-table NPCs. */
  statBlock: EncounterStatBlock | null;
  createdAt: string;
}

export interface EncounterCore {
  version: 1;
  id: string;
  name: string;
  /** Persistent scene setup, motives, and non-combat resolution notes. */
  brief: string;
  round: number;
  activeCombatantId: string | null;
  combatants: EncounterCombatant[];
  updatedAt: string;
}

export interface EncounterSnapshot {
  label: string;
  createdAt: string;
  core: EncounterCore;
}

export interface EncounterState extends EncounterCore {
  past: EncounterSnapshot[];
  lastEvent: string | null;
}

export interface EncounterWorkspace {
  version: 2;
  activeEncounterId: string;
  encounters: EncounterState[];
}

export interface DamageResult {
  location: ArmorLocation;
  rawDamage: number;
  armorBefore: number;
  armorAfter: number;
  hpDamage: number;
  hpBefore: number | null;
  hpAfter: number | null;
  seriouslyWounded: boolean;
  defeated: boolean;
  headMultiplier: number;
}

export interface AttackRollResult {
  attackId: string;
  /** The first d10 result. */
  die: number;
  /** One additional d10, only when the first die is 10 or 1. */
  extraDie: number | null;
  /** First die plus or minus the one permitted additional die. */
  dieTotal: number;
  base: number | null;
  penalty: number;
  total: number | null;
  ammoSpent: boolean;
}

export interface ExplodingD10Result {
  die: number;
  extraDie: number | null;
  dieTotal: number;
}

export interface DamageRollResult {
  attackId: string;
  formula: string;
  dice: number[];
  modifier: number;
  total: number;
  critical: boolean;
}

export type EncounterAction =
  | { type: 'rename'; name: string }
  | { type: 'set-brief'; brief: string }
  | { type: 'rename-combatant'; combatantId: string; name: string }
  | { type: 'set-combatant-side'; combatantId: string; side: CombatantSide }
  | { type: 'add-combatant'; combatant: EncounterCombatant }
  | { type: 'add-combatants'; combatants: EncounterCombatant[]; source?: string }
  | { type: 'apply-random-encounter'; combatants: EncounterCombatant[]; brief: string; source: string }
  | { type: 'remove-combatant'; combatantId: string }
  | { type: 'set-active'; combatantId: string | null }
  | { type: 'advance-turn'; direction: 1 | -1 }
  | { type: 'set-initiative'; combatantId: string; initiative: number | null }
  | { type: 'roll-initiative'; scope: 'npcs' | 'all'; rolls?: Record<string, number>; extraRolls?: Record<string, number> }
  | { type: 'set-hp'; combatantId: string; current: number | null; max?: number | null }
  | { type: 'set-armor'; combatantId: string; location: ArmorLocation; current: number; max?: number }
  | { type: 'apply-damage'; combatantId: string; location: ArmorLocation; damage: number }
  | { type: 'heal'; combatantId: string; amount: number }
  | { type: 'add-condition'; combatantId: string; condition: EncounterCondition }
  | { type: 'remove-condition'; combatantId: string; conditionId: string }
  | { type: 'use-item-action'; combatantId: string; actionId: string; condition?: EncounterCondition }
  | { type: 'reset-item-action'; combatantId: string; actionId: string }
  | {
      type: 'resolve-item-secondary';
      combatantId: string;
      conditionId: string;
      base: number;
      dv: number;
      failureCondition?: EncounterCondition;
      die?: number;
      extraDie?: number;
    }
  | { type: 'add-critical'; combatantId: string; injury: CriticalInjury; applyBonusDamage?: boolean }
  | { type: 'roll-critical'; combatantId: string; location: ArmorLocation; roll?: number; applyBonusDamage?: boolean }
  | { type: 'remove-critical'; combatantId: string; injuryId: string }
  | { type: 'set-cover'; combatantId: string; cover: EncounterCover | null }
  | { type: 'damage-cover'; combatantId: string; damage: number }
  | { type: 'set-held-action'; combatantId: string; heldAction: HeldAction | null }
  | { type: 'set-notes'; combatantId: string; notes: string }
  | { type: 'set-tactics'; combatantId: string; tactics: string }
  | { type: 'set-attack-ammo'; combatantId: string; attackId: string; current: number | null; reserve?: number | null }
  | { type: 'set-attack-range'; combatantId: string; attackId: string; rangeBand: RangeBandId | null }
  | { type: 'set-ranged-defense'; combatantId: string; reflex: number | null; evasionBase: number | null }
  | { type: 'roll-attack'; combatantId: string; attackId: string; die?: number; extraDie?: number }
  | {
      type: 'resolve-ranged-attack';
      combatantId: string;
      attackId: string;
      targetId: string | null;
      defenseMode: RangedDefenseMode;
      rangeBand: RangeBandId | null;
      attackDie?: number;
      attackExtraDie?: number;
      defenseDie?: number;
      defenseExtraDie?: number;
    }
  | { type: 'roll-damage'; combatantId: string; attackId: string; dice?: number[] }
  | { type: 'roll-check'; combatantId: string; label: string; base: number; die?: number; extraDie?: number }
  | { type: 'reload-attack'; combatantId: string; attackId: string }
  | { type: 'roll-death-save'; combatantId: string; die?: number }
  | { type: 'reset-rounds' }
  | { type: 'clear' }
  | { type: 'undo' };
