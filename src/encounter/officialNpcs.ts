import { findCatalogEntry, normalizeCatalogName } from '../content/catalog';
import type { CatalogEntry, MechanicsSummary } from '../content/types';
import type { StatName } from '../engine/types';
import { defaultRangeBand, inferRangeProfile } from './rangeDvs';
import type {
  CombatantSide,
  EncounterAttack,
  EncounterCombatant,
  EncounterSkillValue,
  EncounterStatBlock,
  EncounterStatValue,
  OfficialNpcTier,
} from './types';

export type OfficialNpcTemplateId =
  | 'bodyguard'
  | 'boosterganger'
  | 'road-ganger'
  | 'security-operative'
  | 'netrunner'
  | 'reclaimer-chief'
  | 'security-officer'
  | 'outrider'
  | 'pyro'
  | 'cyberpsycho'
  | 'trauma-team-doctor'
  | 'trauma-team-medical-assistant'
  | 'trauma-team-pilot'
  | 'trauma-team-security-officer'
  | 'automated-turret';

export interface OfficialWeaponSeed {
  name: string;
  skill: string;
  damage?: string | null;
  attackBase?: number;
  autofireBase?: number | null;
  rateOfFire?: number | null;
  magazine?: number | null;
  reserve?: number | null;
  notes?: string;
}

interface OfficialNpcTemplate {
  id: OfficialNpcTemplateId;
  name: string;
  tier: OfficialNpcTier;
  sourcePage: string;
  sourceLabel?: string;
  combatNumber?: number;
  initiativeBase?: number | null;
  stats: EncounterStatValue[];
  skills: EncounterSkillValue[];
  hp: number;
  seriouslyWoundedAt: number | null;
  deathSave: number | null;
  armor: { name: string; body: number; head: number };
  weapons: OfficialWeaponSeed[];
  gear: string[];
  cyberware: string[];
  programs: string[];
  specialRules: string[];
  sourceWarnings: string[];
  painEditor?: boolean;
}

export interface OfficialNpcPatch {
  name?: string;
  armor?: { name: string; body: number; head?: number } | null;
  replaceWeapons?: Array<{ from: string; to: OfficialWeaponSeed }>;
  removeWeapons?: string[];
  addWeapons?: OfficialWeaponSeed[];
  setSkills?: Record<string, number>;
  removeSkills?: string[];
  addGear?: string[];
  removeGear?: string[];
  addCyberware?: string[];
  removeCyberware?: string[];
  addPrograms?: string[];
  specialRules?: string[];
  modifications?: string[];
  sourceWarnings?: string[];
  painEditor?: boolean;
}

export interface OfficialCombatantOptions {
  name?: string;
  side?: CombatantSide;
  patch?: OfficialNpcPatch;
  referenceEntries?: readonly CatalogEntry[];
  notes?: string;
  tactics?: string;
}

export interface GenericNpcTemplateSummary {
  id: OfficialNpcTemplateId;
  name: string;
  tier: OfficialNpcTier;
  sourceLabel: string;
  sourcePage: string;
}

const GENERIC_NPC_TEMPLATE_IDS = [
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
] as const satisfies readonly OfficialNpcTemplateId[];

function id(prefix: string): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function now(): string {
  return new Date().toISOString();
}

function stat(name: StatName, base: number, effective = base, note?: string): EncounterStatValue {
  return { name, base, effective, note };
}

function parseSkills(value: string): EncounterSkillValue[] {
  return value.split(',').map((part) => part.trim()).filter(Boolean).map((part) => {
    const match = part.match(/^(.*?)(-?\d+)(?:\s*\((-?\d+)\))?$/);
    if (!match) throw new Error(`Could not parse official skill base: ${part}`);
    const base = Number(match[2]);
    const effective = match[3] === undefined ? base : Number(match[3]);
    return { name: match[1]!.trim(), base, effective };
  });
}

const TEMPLATES: Record<OfficialNpcTemplateId, OfficialNpcTemplate> = {
  bodyguard: {
    id: 'bodyguard', name: 'Bodyguard', tier: 'mook', sourcePage: '412',
    stats: [stat('WILL', 3), stat('REF', 6), stat('DEX', 5), stat('TECH', 2), stat('COOL', 4), stat('INT', 4), stat('LUCK', 0), stat('MOVE', 4), stat('BODY', 6), stat('EMP', 3)],
    skills: parseSkills('Athletics 9, Brawling 11, Concentration 6, Conversation 5, Drive Land Vehicle 10, Education 5, Endurance 9, Evasion 7, First Aid 4, Handgun 10, Human Perception 5, Interrogation 6, Language (Native) 5, Language (Streetslang) 5, Local Expert (Your Home) 5, Perception 9, Persuasion 6, Resist Torture/Drug 8, Shoulder Arms 10, Stealth 7'),
    hp: 35, seriouslyWoundedAt: 18, deathSave: 6,
    armor: { name: 'Kevlar', body: 7, head: 7 },
    weapons: [
      { name: 'Poor Quality Shotgun', skill: 'Shoulder Arms', damage: '5d6', reserve: 25 },
      { name: 'Very Heavy Pistol', skill: 'Handgun', damage: '4d6', reserve: 25 },
    ],
    gear: ['Slug Ammo x25', 'Very Heavy Pistol Ammo x25', 'Radio Communicator'], cyberware: [], programs: [], specialRules: [], sourceWarnings: [],
  },
  boosterganger: {
    id: 'boosterganger', name: 'Boosterganger', tier: 'mook', sourcePage: '412',
    stats: [stat('WILL', 2), stat('REF', 6), stat('DEX', 5), stat('TECH', 2), stat('COOL', 4), stat('INT', 2), stat('LUCK', 0), stat('MOVE', 4), stat('BODY', 2), stat('EMP', 3)],
    skills: parseSkills('Athletics 9, Brawling 9, Conceal/Reveal Object 4, Concentration 4, Conversation 5, Drive Land Vehicle 10, Education 4, Endurance 6, Evasion 7, First Aid 4, Handgun 12, Human Perception 5, Interrogation 6, Language (Native) 4, Language (Streetslang) 4, Local Expert (Your Home) 4, Melee Weapon 11, Perception 6, Persuasion 6, Resist Torture/Drugs 4, Stealth 7'),
    hp: 20, seriouslyWoundedAt: 10, deathSave: 2,
    armor: { name: 'Leather', body: 4, head: 4 },
    weapons: [
      { name: 'Poor Quality Very Heavy Pistol', skill: 'Handgun', damage: '4d6', reserve: 30 },
      { name: 'Rippers', skill: 'Melee Weapon', damage: '2d6' },
    ],
    gear: ['Very Heavy Pistol Ammo x30', 'Disposable Cellphone'], cyberware: ['Rippers', 'Techhair'], programs: [], specialRules: [], sourceWarnings: [],
  },
  'road-ganger': {
    id: 'road-ganger', name: 'Road Ganger', tier: 'mook', sourcePage: '413',
    stats: [stat('WILL', 4), stat('REF', 6), stat('DEX', 4), stat('TECH', 4), stat('COOL', 3), stat('INT', 3), stat('LUCK', 0), stat('MOVE', 3), stat('BODY', 3), stat('EMP', 3)],
    skills: parseSkills('Archery 10, Athletics 10, Brawling 6, Concentration 5, Conversation 6, Drive Land Vehicle 12, Education 6, Endurance 5, Evasion 6, First Aid 6, Handgun 10, Human Perception 5, Land Vehicle Tech 10, Language (Native) 6, Language (Streetslang) 6, Local Expert (Your Home) 6, Melee Weapon 8, Perception 6, Persuasion 5, Stealth 8, Tracking 8, Wilderness Survival 8'),
    hp: 25, seriouslyWoundedAt: 13, deathSave: 3,
    armor: { name: 'Leather', body: 4, head: 4 },
    weapons: [
      { name: 'Crossbow', skill: 'Archery', damage: '4d6', reserve: 20 },
      { name: 'Very Heavy Pistol', skill: 'Handgun', damage: '4d6', reserve: 20 },
      { name: 'Light Melee Weapon', skill: 'Melee Weapon', damage: '1d6' },
    ],
    gear: ['Very Heavy Pistol Ammo x20', 'Arrow Ammo x20', 'Rope', 'Flashlight'], cyberware: ['Neural Link (Interface Plugs)'], programs: [], specialRules: [], sourceWarnings: [],
  },
  'security-operative': {
    id: 'security-operative', name: 'Security Operative', tier: 'mook', sourcePage: '413',
    stats: [stat('WILL', 3), stat('REF', 7), stat('DEX', 4), stat('TECH', 2), stat('COOL', 2), stat('INT', 3), stat('LUCK', 0), stat('MOVE', 3), stat('BODY', 5), stat('EMP', 3)],
    skills: parseSkills('Athletics 8, Autofire 10, Brawling 6, Concentration 7, Conversation 5, Education 5, Evasion 6, First Aid 4, Handgun 10, Human Perception 5, Interrogation 6, Language (Native) 5, Language (Streetslang) 5, Local Expert (Your Home) 5, Melee Weapon 6, Perception 5, Persuasion 4, Resist Torture/Drugs 5, Shoulder Arms 10, Stealth 6'),
    hp: 30, seriouslyWoundedAt: 15, deathSave: 5,
    armor: { name: 'Kevlar', body: 7, head: 7 },
    weapons: [
      { name: 'Poor Quality Assault Rifle', skill: 'Shoulder Arms', damage: '5d6', autofireBase: 10, reserve: 40 },
      { name: 'Very Heavy Pistol', skill: 'Handgun', damage: '4d6', reserve: 20 },
      { name: 'Medium Melee Weapon', skill: 'Melee Weapon', damage: '2d6' },
    ],
    gear: ['Rifle Ammo x40', 'Very Heavy Pistol Ammo x20', 'Radio Communicator'], cyberware: [], programs: [], specialRules: [], sourceWarnings: [],
  },
  netrunner: {
    id: 'netrunner', name: 'Netrunner', tier: 'lieutenant', sourcePage: '414',
    stats: [stat('WILL', 7), stat('REF', 5), stat('DEX', 4), stat('TECH', 7), stat('COOL', 4), stat('INT', 5), stat('LUCK', 0), stat('MOVE', 5), stat('BODY', 3), stat('EMP', 4)],
    skills: parseSkills('Interface 4, Athletics 9, Basic Tech 13, Brawling 6, Conceal/Reveal Object 11, Concentration 9, Conversation 6, Cryptography 11, Deduction 11, Education 11, Electronics/Security Tech 11, Evasion 6, First Aid 9, Forgery 13, Handgun 10, Human Perception 6, Language (Native) 9, Language (Streetslang) 9, Local Expert (Your Home) 13, Library Search 9, Perception 11, Persuasion 6, Pick Lock 11, Resist Torture/Drugs 7, Stealth 8'),
    hp: 30, seriouslyWoundedAt: 15, deathSave: 3,
    armor: { name: 'Bodyweight Suit', body: 11, head: 11 },
    weapons: [{ name: 'Very Heavy Pistol', skill: 'Handgun', damage: '4d6', reserve: 50 }],
    gear: ['Very Heavy Pistol Ammo x50', 'Flashlight', 'Virtuality Goggles'], cyberware: ['Neural Link (Interface Plugs)'],
    programs: ['Banhammer', 'DeckKRASH', 'Eraser', 'Hellbolt', 'Shield', 'Sword', 'Worm'], specialRules: [], sourceWarnings: [],
  },
  'reclaimer-chief': {
    id: 'reclaimer-chief', name: 'Reclaimer Chief', tier: 'lieutenant', sourcePage: '414',
    stats: [stat('WILL', 3), stat('REF', 6), stat('DEX', 6), stat('TECH', 5), stat('COOL', 4), stat('INT', 5), stat('LUCK', 0), stat('MOVE', 4), stat('BODY', 6), stat('EMP', 4)],
    skills: parseSkills('Athletics 12, Basic Tech 9, Brawling 8, Concentration 7, Conversation 6, Deduction 7, Drive Land Vehicle 10, Education 5, Electronics/Security Tech 9, Endurance 11, Evasion 8, First Aid 7, Handgun 10, Human Perception 6, Land Vehicle Tech 7, Language (Native) 5, Language (Streetslang) 5, Local Expert (Your Home) 5, Melee Weapon 10, Paramedic 7, Perception 8, Persuasion 6, Pick Lock 7, Resist Torture/Drugs 10, Shoulder Arms 10, Stealth 10, Weaponstech 9, Wilderness Survival 7'),
    hp: 40, seriouslyWoundedAt: 20, deathSave: 6,
    armor: { name: 'Light Armorjack', body: 11, head: 11 },
    weapons: [
      { name: 'Shotgun', skill: 'Shoulder Arms', damage: '5d6', reserve: 25 },
      { name: 'Heavy Pistol', skill: 'Handgun', damage: '3d6', reserve: 25 },
      { name: 'Heavy Melee Weapon', skill: 'Melee Weapon', damage: '3d6' },
    ],
    gear: ['Slug Ammo x25', 'Heavy Pistol Ammo x25', 'Agent', 'Grapple Gun', 'Radio Communicator', 'Tent & Camping Equipment', 'Nasal Filters'], cyberware: ['Neural Link (Chipware Socket, Tactile Boost)'], programs: [], specialRules: [], sourceWarnings: [],
  },
  'security-officer': {
    id: 'security-officer', name: 'Security Officer', tier: 'lieutenant', sourcePage: '415',
    stats: [stat('WILL', 4), stat('REF', 8, 6, 'Medium Armorjack'), stat('DEX', 6, 4, 'Medium Armorjack'), stat('TECH', 4), stat('COOL', 6), stat('INT', 5), stat('LUCK', 0), stat('MOVE', 6, 4, 'Medium Armorjack'), stat('BODY', 7), stat('EMP', 4)],
    skills: parseSkills('Athletics 10 (8), Autofire 12 (10), Brawling 10 (8), Concentration 7, Conversation 6, Deduction 6, Drive Land Vehicle 12 (10), Education 6, Evasion 10 (8), First Aid 6, Handgun 10 (8), Human Perception 6, Interrogation 8, Language (Native) 6, Language (Streetslang) 6, Local Expert (Your Home) 6, Melee Weapon 10 (8), Perception 6, Persuasion 8, Resist Torture/Drugs 10, Shoulder Arms 10 (8), Stealth 8 (6), Tactics 6'),
    hp: 40, seriouslyWoundedAt: 20, deathSave: 7,
    armor: { name: 'Medium Armorjack', body: 12, head: 12 },
    weapons: [
      { name: 'Assault Rifle', skill: 'Shoulder Arms', damage: '5d6', autofireBase: 10, reserve: 50 },
      { name: 'Very Heavy Pistol', skill: 'Handgun', damage: '4d6', reserve: 30 },
      { name: 'Medium Melee Weapon', skill: 'Melee Weapon', damage: '2d6' },
    ],
    gear: ['Rifle Ammo x50', 'Very Heavy Pistol Ammo x30', 'Bulletproof Shield (10 HP)', 'Binoculars', 'Disposable Cellphone', 'Flashlight', 'Handcuffs x2', 'Radio Communicator', 'Radio Scanner/Music Player'], cyberware: ['Neural Link (Kerenzikov Speedware)'], programs: [], specialRules: [], sourceWarnings: [],
  },
  outrider: {
    id: 'outrider', name: 'Outrider', tier: 'mini-boss', sourcePage: '415',
    stats: [stat('WILL', 6), stat('REF', 8), stat('DEX', 8), stat('TECH', 3), stat('COOL', 5), stat('INT', 6), stat('LUCK', 0), stat('MOVE', 6), stat('BODY', 6), stat('EMP', 6)],
    skills: parseSkills('Moto 4, Animal Handling 8, Athletics 14, Autofire 12, Basic Tech 5, Brawling 14, Concentration 10, Conversation 6, Criminology 10, Drive Land Vehicle 14, Education 8, Endurance 10, Evasion 14, First Aid 5, Handgun 14, Human Perception 8, Land Vehicle Tech 7, Language (Native) 8, Language (Streetslang) 8, Local Expert (Badlands) 10, Local Expert (Your Home) 8, Melee Weapon 12, Perception 14, Persuasion 7, Resist Torture/Drugs 12, Shoulder Arms 14, Stealth 12, Streetwise 9, Tracking 10'),
    hp: 40, seriouslyWoundedAt: 20, deathSave: 6,
    armor: { name: 'Light Armorjack', body: 11, head: 11 },
    weapons: [
      { name: 'Assault Rifle', skill: 'Shoulder Arms', damage: '5d6', autofireBase: 12, reserve: 60 },
      { name: 'Very Heavy Pistol', skill: 'Handgun', damage: '4d6', reserve: 40 },
      { name: 'Light Melee Weapon', skill: 'Melee Weapon', damage: '1d6' },
    ],
    gear: ['Rifle Ammo x60', 'Very Heavy Pistol Ammo x40', 'Handcuffs x2', 'Homing Tracers', 'Radio Communicator'], cyberware: ['Cyberaudio Suite (Amplified Hearing)', 'Cybereye (Targeting Scope, TeleOptics)', 'Neural Link (Interface Plugs)'], programs: [], specialRules: [], sourceWarnings: [],
  },
  pyro: {
    id: 'pyro', name: 'Pyro', tier: 'mini-boss', sourcePage: '416',
    stats: [stat('WILL', 5), stat('REF', 8), stat('DEX', 6), stat('TECH', 7), stat('COOL', 4), stat('INT', 4), stat('LUCK', 0), stat('MOVE', 6), stat('BODY', 5), stat('EMP', 3)],
    skills: parseSkills('Combat Awareness 4, Athletics 11, Basic Tech 12, Brawling 10, Concentration 8, Conversation 5, Demolition 13, Drive Land Vehicle 10, Education 7, Evasion 13, First Aid 9, Handgun 14, Heavy Weapons 14, Human Perception 5, Interrogation 10, Language (Native) 7, Language (Streetslang) 7, Local Expert (Your Home) 7, Melee Weapon 13, Perception 12, Persuasion 6, Resist Torture/Drugs 14, Science (Chemistry) 10, Stealth 10, Streetwise 8, Tactics 8'),
    hp: 35, seriouslyWoundedAt: 18, deathSave: 5,
    armor: { name: 'Light Armorjack', body: 11, head: 11 },
    weapons: [
      { name: 'Flamethrower', skill: 'Heavy Weapons', damage: '3d6', reserve: 8 },
      { name: 'Heavy Pistol', skill: 'Handgun', damage: '3d6', reserve: 50 },
      { name: 'Heavy Melee Weapon', skill: 'Melee Weapon', damage: '3d6' },
    ],
    gear: ['Flamethrower Ammo (Incendiary Shotgun Shells) x8', 'Very Heavy Pistol Ammo x50', 'Incendiary Grenade x1', 'Flashbang Grenade x1'], cyberware: ['Cyberaudio Suite (Level Dampeners)', 'Cybereye x2 (Anti-Dazzle x2)', 'Nasal Filters'], programs: [], specialRules: [], sourceWarnings: [],
  },
  cyberpsycho: {
    id: 'cyberpsycho', name: 'Cyberpsycho', tier: 'boss', sourcePage: '416',
    stats: [stat('WILL', 5), stat('REF', 8), stat('DEX', 8), stat('TECH', 5), stat('COOL', 4), stat('INT', 7), stat('LUCK', 0), stat('MOVE', 8), stat('BODY', 10), stat('EMP', 0)],
    skills: parseSkills('Athletics 16, Autofire 14, Basic Tech 11, Brawling 15, Concentration 6, Conversation 2, Drive Land Vehicle 10, Education 7, Endurance 10, Evasion 13, First Aid 6, Handgun 12, Heavy Weapons 14, Human Perception 2, Interrogation 13, Language (Native) 7, Language (Streetslang) 7, Local Expert (Your Home) 7, Melee Weapon 17, Perception 9, Persuasion 6, Resist Torture/Drugs 15, Stealth 10, Tracking 10'),
    hp: 55, seriouslyWoundedAt: 28, deathSave: 10,
    armor: { name: 'Subdermal Armor', body: 11, head: 11 },
    weapons: [
      { name: 'Popup Grenade Launcher', skill: 'Heavy Weapons', damage: '6d6', reserve: 2 },
      { name: 'Cybersnake', skill: 'Melee Weapon', damage: '4d6' },
      { name: 'Popup Heavy SMG', skill: 'Handgun', damage: '3d6', autofireBase: 14, reserve: 100 },
      { name: 'Wolvers', skill: 'Melee Weapon', damage: '3d6' },
    ],
    gear: ['Armor-Piercing Grenade x2', 'Heavy Pistol Ammo x100'],
    cyberware: ['Cyberarm x2 (Popup Grenade Launcher x2, Popup Heavy SMG, Wolvers)', 'Cyberleg x2 (Jump Boosters x2)', 'Cybersnake', 'Grafted Muscle & Bone Lace', 'Neural Link (Chipware Socket, Pain Editor)', 'Subdermal Armor'],
    programs: [],
    specialRules: ['The supplied source identifies this NPC as a full boss battle.'],
    sourceWarnings: [],
    painEditor: true,
  },
  'trauma-team-doctor': {
    id: 'trauma-team-doctor', name: 'Trauma Team Doctor', tier: 'lieutenant', sourcePage: '224',
    sourceLabel: 'Cyberpunk RED Core Rulebook · Trauma Team', combatNumber: 10, initiativeBase: null,
    stats: [],
    skills: parseSkills('First Aid 10, Paramedic 10, Surgery 10, Medical Tech 10'),
    hp: 20, seriouslyWoundedAt: 10, deathSave: null,
    armor: { name: 'Light Armorjack', body: 11, head: 11 },
    weapons: [{ name: 'Heavy Handgun', skill: 'Combat Number', damage: '3d6', attackBase: 10, rateOfFire: 2, magazine: 8 }],
    gear: ['Cryopump', 'Airhypo x2 (Rapidetox dose in each)'], cyberware: [], programs: [],
    specialRules: ['Uses Combat Number 10 for attacks and for First Aid, Paramedic, Surgery, and Medical Tech.'],
    sourceWarnings: ['The supplied simplified stat block does not include REF or a complete STAT line, so initiative and unlisted STAT checks remain manual.', 'The final numeric value in the supplied row is 4, but the pasted header does not unambiguously identify it as BODY or MOVE. It is preserved as a source note and is not applied automatically.'],
  },
  'trauma-team-medical-assistant': {
    id: 'trauma-team-medical-assistant', name: 'Trauma Team Medical Assistant', tier: 'mook', sourcePage: '224',
    sourceLabel: 'Cyberpunk RED Core Rulebook · Trauma Team', combatNumber: 10, initiativeBase: null,
    stats: [],
    skills: parseSkills('Pilot Air Vehicle 10, First Aid 10, Paramedic 10, Medical Tech 10'),
    hp: 25, seriouslyWoundedAt: 13, deathSave: null,
    armor: { name: 'Kevlar', body: 7, head: 7 },
    weapons: [],
    gear: ['Cryopump', 'Bulletproof Shield'], cyberware: [], programs: [],
    specialRules: ['Uses Combat Number 10 for Pilot Air Vehicle, First Aid, Paramedic, and Medical Tech.'],
    sourceWarnings: ['The supplied simplified stat block does not include REF or a complete STAT line, so initiative and unlisted STAT checks remain manual.', 'The final numeric value in the supplied row is 6, but the pasted header does not unambiguously identify it as BODY or MOVE. It is preserved as a source note and is not applied automatically.'],
  },
  'trauma-team-pilot': {
    id: 'trauma-team-pilot', name: 'Trauma Team Pilot', tier: 'mook', sourcePage: '224',
    sourceLabel: 'Cyberpunk RED Core Rulebook · Trauma Team', combatNumber: 10, initiativeBase: null,
    stats: [],
    skills: parseSkills('Air Vehicle Tech 10, First Aid 10, Pilot Air Vehicle 10'),
    hp: 25, seriouslyWoundedAt: 13, deathSave: null,
    armor: { name: 'Kevlar', body: 7, head: 7 },
    weapons: [{ name: 'Very Heavy Pistol', skill: 'Combat Number', damage: '4d6', attackBase: 10, rateOfFire: 1, magazine: 8 }],
    gear: [], cyberware: [], programs: [],
    specialRules: ['Uses Combat Number 10 for attacks and for Air Vehicle Tech, First Aid, and Pilot Air Vehicle.'],
    sourceWarnings: ['The supplied simplified stat block does not include REF or a complete STAT line, so initiative and unlisted STAT checks remain manual.', 'The final numeric value in the supplied row is 6, but the pasted header does not unambiguously identify it as BODY or MOVE. It is preserved as a source note and is not applied automatically.'],
  },
  'trauma-team-security-officer': {
    id: 'trauma-team-security-officer', name: 'Trauma Team Security Officer', tier: 'mook', sourcePage: '224',
    sourceLabel: 'Cyberpunk RED Core Rulebook · Trauma Team', combatNumber: 10, initiativeBase: null,
    stats: [], skills: [],
    hp: 30, seriouslyWoundedAt: 15, deathSave: null,
    armor: { name: 'Heavy Armorjack', body: 13, head: 13 },
    weapons: [{ name: 'Assault Rifle', skill: 'Combat Number', damage: '5d6', attackBase: 10, rateOfFire: 1, magazine: 25 }],
    gear: [], cyberware: [], programs: [],
    specialRules: ['Uses Combat Number 10 for attacks.'],
    sourceWarnings: ['The supplied simplified stat block does not include REF or a complete STAT line, so initiative and unlisted STAT checks remain manual.', 'The final numeric value in the supplied row is 4, but the pasted header does not unambiguously identify it as BODY or MOVE. It is preserved as a source note and is not applied automatically.'],
  },
  'automated-turret': {
    id: 'automated-turret', name: 'Automated Turret', tier: 'lieutenant', sourcePage: '214',
    sourceLabel: 'Cyberpunk RED Core Rulebook · Emplaced Defenses', combatNumber: 14, initiativeBase: null,
    stats: [], skills: [],
    hp: 25, seriouslyWoundedAt: null, deathSave: null,
    armor: { name: 'No armor listed', body: 0, head: 0 },
    weapons: [], gear: ['Connected to its own Control Node in a NET Architecture'], cyberware: [], programs: [],
    specialRules: [
      'Stationary emplaced defense; it cannot dodge attacks.',
      'When autonomous, attacks use Combat Number 14 + 1d10.',
      'DV17 Electronics/Security Tech and 5 minutes are required to counter it.',
      'Default trigger: a target enters without the proper pass or badge.',
      'It continues firing until the target is dead, leaves range, or presents the proper badge.',
      'When controlled by a Netrunner, attacks use the Netrunner’s own Skills.',
    ],
    sourceWarnings: [],
  },
};

const NAME_ALIASES: Record<string, string[]> = {
  'heavy handgun': ['Heavy Pistol'],
  'poor quality very heavy pistol': ['Very Heavy Pistol'],
  'poor quality heavy pistol': ['Heavy Pistol'],
  'poor quality medium pistol': ['Medium Pistol'],
  'poor quality assault rifle': ['Assault Rifle'],
  'poor quality smg': ['SMG'],
  'poor quality heavy smg': ['Heavy SMG'],
  'smartgun linked assault rifle': ['Assault Rifle'],
  'smartgun linked heavy smg': ['Heavy SMG'],
  'popup heavy smg': ['Heavy SMG'],
  'popup grenade launcher': ['Grenade Launcher'],
  'fighting knife': ['Light Melee Weapon'],
  'knife': ['Light Melee Weapon'],
  'club': ['Light Melee Weapon'],
  'heavy baton': ['Medium Melee Weapon'],
  'machete': ['Medium Melee Weapon'],
  'sword': ['Heavy Melee Weapon'],
  'katana': ['Heavy Melee Weapon'],
  'nunchaku': ['Medium Melee Weapon'],
  'whip': ['Medium Melee Weapon'],
};

function weaponMechanics(entry: CatalogEntry | undefined): Extract<MechanicsSummary, { kind: 'weapon' }> | undefined {
  if (!entry) return undefined;
  if (entry.mechanics.kind === 'weapon') return entry.mechanics;
  if (entry.mechanics.kind === 'cyberware') return entry.mechanics.weapon;
  return undefined;
}

function findWeaponEntry(entries: readonly CatalogEntry[], name: string): CatalogEntry | undefined {
  const candidates = [name, ...(NAME_ALIASES[normalizeCatalogName(name)] ?? [])];
  for (const candidate of candidates) {
    const weapon = findCatalogEntry(entries, { name: candidate, type: 'weapon' });
    if (weapon) return weapon;
    const cyberware = findCatalogEntry(entries, { name: candidate, type: 'cyberware' });
    if (cyberware && weaponMechanics(cyberware)) return cyberware;
  }
  return undefined;
}

function skillValue(skills: readonly EncounterSkillValue[], name: string): EncounterSkillValue | undefined {
  const normalized = normalizeCatalogName(name).replace(/s$/, '');
  return skills.find((skill) => normalizeCatalogName(skill.name).replace(/s$/, '') === normalized);
}

function matches(value: string, pattern: string): boolean {
  const normalizedValue = normalizeCatalogName(value);
  const normalizedPattern = normalizeCatalogName(pattern);
  return normalizedValue === normalizedPattern || normalizedValue.includes(normalizedPattern) || normalizedPattern.includes(normalizedValue);
}

function removeMatching(values: readonly string[], patterns: readonly string[]): string[] {
  return values.filter((value) => !patterns.some((pattern) => matches(value, pattern)));
}

function applyPatch(template: OfficialNpcTemplate, patch: OfficialNpcPatch | undefined): OfficialNpcTemplate & { modifications: string[] } {
  if (!patch) return { ...structuredClone(template), modifications: [] };
  const next = structuredClone(template) as OfficialNpcTemplate & { modifications: string[] };
  next.modifications = [...(patch.modifications ?? [])];
  if (patch.name) next.name = patch.name;
  if (patch.armor === null) next.armor = { name: 'No armor', body: 0, head: 0 };
  else if (patch.armor) next.armor = { name: patch.armor.name, body: patch.armor.body, head: patch.armor.head ?? patch.armor.body };

  const removed = patch.removeWeapons ?? [];
  next.weapons = next.weapons.filter((weapon) => !removed.some((pattern) => matches(weapon.name, pattern)));
  for (const replacement of patch.replaceWeapons ?? []) {
    const index = next.weapons.findIndex((weapon) => matches(weapon.name, replacement.from));
    if (index >= 0) {
      const previous = next.weapons[index]!;
      next.weapons[index] = { ...replacement.to, reserve: replacement.to.reserve === undefined ? previous.reserve : replacement.to.reserve };
    }
  }
  next.weapons.push(...(patch.addWeapons ?? []));

  const setSkills = Object.entries(patch.setSkills ?? {});
  for (const [name, value] of setSkills) {
    const existing = skillValue(next.skills, name);
    if (existing) {
      existing.base = value;
      existing.effective = value;
    } else {
      next.skills.push({ name, base: value, effective: value });
    }
  }
  next.skills = next.skills.filter((skill) => !(patch.removeSkills ?? []).some((pattern) => matches(skill.name, pattern)));

  next.gear = [...removeMatching(next.gear, patch.removeGear ?? []), ...(patch.addGear ?? [])];
  next.cyberware = [...removeMatching(next.cyberware, patch.removeCyberware ?? []), ...(patch.addCyberware ?? [])];
  next.programs = [...next.programs, ...(patch.addPrograms ?? [])];
  next.specialRules = [...next.specialRules, ...(patch.specialRules ?? [])];
  next.sourceWarnings = [...next.sourceWarnings, ...(patch.sourceWarnings ?? [])];
  if (patch.painEditor !== undefined) next.painEditor = patch.painEditor;
  return next;
}

function createAttack(seed: OfficialWeaponSeed, skills: readonly EncounterSkillValue[], entries: readonly CatalogEntry[]): EncounterAttack {
  const entry = findWeaponEntry(entries, seed.name);
  const mechanics = weaponMechanics(entry);
  const skill = seed.skill || mechanics?.skill || 'Attack';
  const skillBase = skillValue(skills, skill)?.effective ?? null;
  const base = seed.attackBase ?? skillBase;
  const rangeProfile = inferRangeProfile(seed.name, skill, entry?.tags ?? []);
  const magazine = seed.magazine ?? mechanics?.magazine ?? null;
  const supportsAutofire = /\b(?:assault rifle|smg)\b/i.test(seed.name);
  return {
    id: id('attack'),
    name: seed.name,
    skill,
    base,
    damage: seed.damage ?? mechanics?.damage ?? null,
    rateOfFire: seed.rateOfFire ?? mechanics?.rateOfFire ?? null,
    autofireBase: seed.autofireBase ?? (supportsAutofire ? skillValue(skills, 'Autofire')?.effective ?? null : null),
    rangeProfile,
    selectedRangeBand: defaultRangeBand(rangeProfile),
    ammo: {
      current: magazine,
      max: magazine,
      reserve: seed.reserve ?? null,
    },
    notes: seed.notes ?? '',
  };
}

export function officialNpcTemplateIds(): OfficialNpcTemplateId[] {
  return Object.keys(TEMPLATES) as OfficialNpcTemplateId[];
}

export function officialNpcTemplate(templateId: OfficialNpcTemplateId): Readonly<OfficialNpcTemplate> {
  return TEMPLATES[templateId];
}

/** Core generic NPC stat blocks that can be added without encounter-specific patches or loadout choices. */
export function genericNpcTemplates(): GenericNpcTemplateSummary[] {
  return GENERIC_NPC_TEMPLATE_IDS.map((templateId) => {
    const template = TEMPLATES[templateId];
    return {
      id: template.id,
      name: template.name,
      tier: template.tier,
      sourceLabel: template.sourceLabel ?? 'Cyberpunk RED Core Rulebook · Mooks and Grunts',
      sourcePage: template.sourcePage,
    };
  });
}

export function createOfficialCombatant(templateId: OfficialNpcTemplateId, options: OfficialCombatantOptions = {}): EncounterCombatant {
  const source = applyPatch(TEMPLATES[templateId], options.patch);
  const entries = options.referenceEntries ?? [];
  const attacks = source.weapons.map((weapon) => createAttack(weapon, source.skills, entries));
  const ref = source.stats.find((value) => value.name === 'REF')?.effective ?? null;
  const initiativeBase = source.initiativeBase === undefined ? ref : source.initiativeBase;
  const evasion = skillValue(source.skills, 'Evasion')?.effective ?? null;
  const statBlock: EncounterStatBlock = {
    kind: 'official',
    templateId: source.id,
    templateName: source.name,
    tier: source.tier,
    combatNumber: source.combatNumber,
    source: { label: source.sourceLabel ?? 'Cyberpunk RED Core Rulebook · Mooks and Grunts', page: source.sourcePage },
    stats: structuredClone(source.stats),
    skills: structuredClone(source.skills),
    armorName: source.armor.name,
    gear: [...source.gear],
    cyberware: [...source.cyberware],
    programs: [...source.programs],
    specialRules: [...source.specialRules],
    modifications: [...source.modifications],
    sourceWarnings: [...source.sourceWarnings],
  };
  const displayName = options.name?.trim() || source.name;
  return {
    id: id('official-npc'),
    kind: 'npc',
    side: options.side ?? 'enemy',
    name: displayName,
    initiative: null,
    initiativeBase,
    currentHp: source.hp,
    maxHp: source.hp,
    seriouslyWoundedAt: source.seriouslyWoundedAt,
    painEditor: Boolean(source.painEditor),
    armor: {
      body: { current: source.armor.body, max: source.armor.body },
      head: { current: source.armor.head, max: source.armor.head },
    },
    conditions: [],
    criticalInjuries: [],
    attacks,
    cover: null,
    heldAction: null,
    deathSaveBase: source.deathSave,
    deathSaveFailures: 0,
    reflex: ref,
    evasionBase: evasion,
    tactics: options.tactics ?? (attacks[0]
      ? `Use ${attacks[0].name} at ${attacks[0].skill} ${attacks[0].base === null ? '—' : `+${attacks[0].base}`}. Follow the encounter brief and morale cues.`
      : 'Follow the encounter brief and use the strongest available skill.'),
    notes: options.notes ?? '',
    npcView: null,
    statBlock,
    createdAt: now(),
  };
}
