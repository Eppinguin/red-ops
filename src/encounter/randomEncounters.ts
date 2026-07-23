import type { CatalogEntry } from '../content/types';
import { createOfficialCombatant, type OfficialNpcPatch, type OfficialNpcTemplateId, type OfficialWeaponSeed } from './officialNpcs';
import type { CombatantSide, EncounterCombatant } from './types';

export type EncounterPeriod = 'daytime' | 'evening' | 'midnight';
export type ThreatZone = 'moderate' | 'corporate' | 'combat' | 'hot' | 'executive';
export type RandomEncounterSubrollDie = '1d10' | '1d6' | '1d100';

export interface RandomEncounterSubroll {
  /** Stable within a rolled encounter so a single result can be rebuilt safely. */
  id: string;
  label: string;
  /** The face/result before a fixed modifier is applied. */
  roll: number;
  die: RandomEncounterSubrollDie;
  modifier: number;
  total: number;
  /** Human-readable consequence of the current result. */
  outcome: string;
}

export interface RandomEncounterGroup {
  id: string;
  label: string;
  /** Encounter-local faction marker used to distinguish otherwise identical groups. */
  teamLabel?: string;
  count: number;
  side: CombatantSide;
  templateId?: OfficialNpcTemplateId;
  missingStatBlock?: {
    name: string;
    source: string;
  };
  patch?: OfficialNpcPatch;
  instancePatches?: OfficialNpcPatch[];
  loadoutOptions?: Array<{
    id: string;
    label: string;
    description: string;
    patch: OfficialNpcPatch;
  }>;
  selectedLoadoutId?: string;
  notes?: string;
}

export interface RandomEncounterResult {
  id: string;
  period: EncounterPeriod;
  zone: ThreatZone;
  partySize: number;
  /** Whether the app applied the source's advisory regional percentile band. */
  regionalGuidance: boolean;
  roll: number;
  dice: [number, number];
  title: string;
  description: string;
  groups: RandomEncounterGroup[];
  /** Independently rerollable result parts, such as each side of a Turf War. */
  subrolls: RandomEncounterSubroll[];
  gmNotes: string[];
  warnings: string[];
  createdAt: string;
}

interface BuildContext {
  partySize: number;
  d10: () => number;
  d6: () => number;
  rollAgain: (depth: number) => RandomEncounterResult;
  depth: number;
}

interface EncounterTableEntry {
  min: number;
  max: number;
  title: string;
  build: (context: BuildContext) => Omit<RandomEncounterResult, 'id' | 'period' | 'zone' | 'partySize' | 'regionalGuidance' | 'roll' | 'dice' | 'createdAt'>;
}

export interface RollRandomEncounterOptions {
  period: EncounterPeriod;
  zone: ThreatZone;
  partySize: number;
  /** Deterministic test hook. Values must be in [0, 1). */
  random?: () => number;
  /** Resolve a specific percentile result instead of rolling. */
  percentile?: number;
  /** Apply the source's advisory 01–50 / 51–100 regional guidance. Defaults to true. */
  regionalGuidance?: boolean;
  /** Internal deterministic rebuild hook used when rerolling one secondary result. */
  subrollOverrides?: Readonly<Record<string, number>>;
}

export interface MaterializedRandomEncounter {
  combatants: EncounterCombatant[];
  unavailable: string[];
  warnings: string[];
}

function id(prefix: string): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function d10From(random: () => number): number {
  return Math.floor(random() * 10) + 1;
}

function d6From(random: () => number): number {
  return Math.floor(random() * 6) + 1;
}

function d100From(random: () => number, zone: ThreatZone, regionalGuidance: boolean): number {
  return rollPercentile(random, zone, regionalGuidance);
}

function clampDieRoll(die: RandomEncounterSubrollDie, value: number): number {
  const max = die === '1d6' ? 6 : die === '1d10' ? 10 : 100;
  return Math.max(1, Math.min(max, Math.trunc(value) || 1));
}

function describeRollLabel(raw: string): string {
  const normalized = raw.replace(/[-_]+/g, ' ').replace(/\s+roll$/i, '').trim();
  if (/^scene$/i.test(normalized)) return 'Scene reaction';
  if (/^offer help$/i.test(normalized)) return 'Offer help';
  if (/^side [ab]$/i.test(normalized)) return `${normalized} faction`;
  return normalized || 'Secondary roll';
}

function noteOutcome(note: string): string | null {
  const dash = note.match(/[—–]\s*(.+?)\.?$/);
  return dash?.[1]?.trim() || null;
}

function annotateSubrolls(
  title: string,
  description: string,
  groups: readonly RandomEncounterGroup[],
  gmNotes: readonly string[],
  subrolls: readonly RandomEncounterSubroll[],
): RandomEncounterSubroll[] {
  const notes = gmNotes.filter((note) => /roll\s*:/i.test(note));
  let noteIndex = 0;
  let turfIndex = 0;

  return subrolls.map((subroll) => {
    if (subroll.label !== 'Secondary roll') return subroll;

    if (title === 'Cyberpsycho Rage' && subroll.die === '1d6') {
      const total = subroll.roll + 1;
      return { ...subroll, label: 'Psycho Squad arrival', modifier: 1, total, outcome: `${total} rounds` };
    }

    if (title === 'Turf War' && subroll.die === '1d10' && turfIndex < 2) {
      const side = turfIndex === 0 ? 'Side A' : 'Side B';
      const groupEntry = groups[turfIndex];
      turfIndex += 1;
      return { ...subroll, label: `${side} faction`, outcome: groupEntry?.label ?? description };
    }

    const note = notes[noteIndex++];
    if (!note) return { ...subroll, outcome: description };
    const labelMatch = note.match(/^(.+?roll)\s*:/i);
    return {
      ...subroll,
      label: describeRollLabel(labelMatch?.[1] ?? 'Secondary roll'),
      outcome: noteOutcome(note) ?? description,
    };
  });
}

function preserveGroupEdits(
  previous: readonly RandomEncounterGroup[],
  next: readonly RandomEncounterGroup[],
): RandomEncounterGroup[] {
  const used = new Set<string>();

  const findPrevious = (groupEntry: RandomEncounterGroup, index: number): RandomEncounterGroup | undefined => {
    const candidates = [
      previous.find((candidate) => !used.has(candidate.id) && groupEntry.teamLabel && candidate.teamLabel === groupEntry.teamLabel),
      previous.find((candidate) => !used.has(candidate.id) && candidate.label === groupEntry.label),
      previous[index] && !used.has(previous[index]!.id) && previous[index]!.templateId === groupEntry.templateId ? previous[index] : undefined,
    ];
    return candidates.find(Boolean);
  };

  return next.map((groupEntry, index) => {
    const existing = findPrevious(groupEntry, index);
    if (!existing) return groupEntry;
    used.add(existing.id);
    const loadoutStillExists = groupEntry.loadoutOptions?.some((option) => option.id === existing.selectedLoadoutId);
    const selectedLoadoutId = loadoutStillExists ? existing.selectedLoadoutId : groupEntry.selectedLoadoutId;
    return {
      ...groupEntry,
      id: existing.id,
      count: existing.count,
      side: existing.side,
      ...(selectedLoadoutId ? { selectedLoadoutId } : {}),
    };
  });
}

function party(context: BuildContext): number {
  return Math.max(1, Math.trunc(context.partySize));
}

function halfParty(context: BuildContext): number {
  return Math.max(1, Math.ceil(party(context) / 2));
}

function group(
  label: string,
  templateId: OfficialNpcTemplateId,
  count: number,
  patch?: OfficialNpcPatch,
  side: CombatantSide = 'enemy',
  notes?: string,
): RandomEncounterGroup {
  return { id: id('encounter-group'), label, templateId, count: Math.max(0, Math.trunc(count)), side, patch, notes };
}

function onTeam(groupEntry: RandomEncounterGroup, teamLabel: string): RandomEncounterGroup {
  return { ...groupEntry, teamLabel };
}

function traumaTeamGroups(hostile: boolean): RandomEncounterGroup[] {
  return [
    group('Trauma Team Doctor', 'trauma-team-doctor', 1, undefined, 'neutral'),
    group('Trauma Team Medical Assistant', 'trauma-team-medical-assistant', 1, undefined, 'neutral'),
    group('Trauma Team Pilot', 'trauma-team-pilot', 1, undefined, 'neutral'),
    group('Trauma Team Security Officer', 'trauma-team-security-officer', 2, undefined, hostile ? 'enemy' : 'neutral'),
  ];
}

function automatedTurretGroup(count: number): RandomEncounterGroup {
  return {
    ...group('Automated Turret', 'automated-turret', count),
    notes: 'Choose one official weapon package before adding the encounter.',
    loadoutOptions: [
      {
        id: 'assault-rifle', label: 'Assault Rifle', description: '25 Basic Bullets',
        patch: { addWeapons: [weapon('Assault Rifle', 'Combat Number', '5d6', { attackBase: 14, rateOfFire: 1, magazine: 25, reserve: 0 })], modifications: ['Installed Assault Rifle with 25 Basic Bullets.'] },
      },
      {
        id: 'flamethrower', label: 'Flamethrower', description: '4 Incendiary Shotgun Shells',
        patch: { addWeapons: [weapon('Flamethrower', 'Combat Number', '3d6', { attackBase: 14, rateOfFire: 1, magazine: 4, reserve: 0 })], modifications: ['Installed Flamethrower with 4 Incendiary Shotgun Shells.'] },
      },
      {
        id: 'dartgun', label: 'Dartgun', description: '8 Poison Arrows; damage/effect comes from the selected ammunition',
        patch: { addWeapons: [weapon('Dartgun', 'Combat Number', undefined, { attackBase: 14, magazine: 8, reserve: 0, notes: 'Loaded with 8 Poison Arrows.' })], modifications: ['Installed Dartgun with 8 Poison Arrows.'] },
      },
      {
        id: 'very-heavy-pistol', label: 'Very Heavy Pistol', description: '8 Armor-Piercing Bullets',
        patch: { addWeapons: [weapon('Very Heavy Pistol', 'Combat Number', '4d6', { attackBase: 14, rateOfFire: 1, magazine: 8, reserve: 0, notes: 'Loaded with Armor-Piercing ammunition.' })], modifications: ['Installed Very Heavy Pistol with 8 Armor-Piercing Bullets.'] },
      },
      {
        id: 'heavy-smg', label: 'Heavy SMG', description: '40 Basic Bullets',
        patch: { addWeapons: [weapon('Heavy SMG', 'Combat Number', '3d6', { attackBase: 14, autofireBase: 14, rateOfFire: 1, magazine: 40, reserve: 0 })], modifications: ['Installed Heavy SMG with 40 Basic Bullets.'] },
      },
    ],
  };
}

function armor(name: string, sp: number): OfficialNpcPatch['armor'] {
  return { name, body: sp, head: sp };
}

function weapon(name: string, skill: string, damage?: string, extra: Partial<OfficialWeaponSeed> = {}): OfficialWeaponSeed {
  return { name, skill, damage, ...extra };
}

function replace(from: string, to: OfficialWeaponSeed): NonNullable<OfficialNpcPatch['replaceWeapons']>[number] {
  return { from, to };
}

function baseResult(
  title: string,
  description: string,
  groups: RandomEncounterGroup[] = [],
  gmNotes: string[] = [],
  warnings: string[] = [],
) {
  return { title, description, groups, subrolls: [], gmNotes, warnings };
}

function boosterPatch(overrides: OfficialNpcPatch = {}): OfficialNpcPatch {
  return {
    ...overrides,
    replaceWeapons: [...(overrides.replaceWeapons ?? [])],
    removeWeapons: [...(overrides.removeWeapons ?? [])],
    addWeapons: [...(overrides.addWeapons ?? [])],
    addGear: [...(overrides.addGear ?? [])],
    removeGear: [...(overrides.removeGear ?? [])],
    addCyberware: [...(overrides.addCyberware ?? [])],
    removeCyberware: [...(overrides.removeCyberware ?? [])],
    modifications: [...(overrides.modifications ?? [])],
  };
}

function storySubject(context: BuildContext): { groups: RandomEncounterGroup[]; description: string; warnings: string[] } {
  if (context.depth >= 1) {
    return { groups: [], description: 'The story subject requires another roll on this encounter table when the scene is played.', warnings: ['Recursive story-subject roll deferred to avoid an endless chain.'] };
  }
  const nested = context.rollAgain(context.depth + 1);
  return {
    groups: nested.groups.map((entry) => ({ ...entry, id: id('encounter-group'), label: `Story subject · ${entry.label}` })),
    description: `The story subject resolves as ${nested.roll.toString().padStart(2, '0')} — ${nested.title}.`,
    warnings: nested.warnings,
  };
}

const DAYTIME: EncounterTableEntry[] = [
  { min: 1, max: 5, title: 'Local Law', build: (c) => baseResult('Local Law', 'Patrol officers stop visibly armed or armored people for identification. Argument brings three-officer backup; reaching for a weapon starts a firefight.', [group('Patrol officer', 'security-operative', halfParty(c), { replaceWeapons: [replace('Poor Quality Assault Rifle', weapon('Assault Rifle', 'Shoulder Arms'))], modifications: ['Poor Quality Assault Rifle replaced with Assault Rifle.'] })], ['Corporate-zone firefights may bring additional Corporate police after 1d10 rounds.']) },
  { min: 6, max: 11, title: 'Corporate Guards', build: (c) => baseResult('Corporate Guards', 'Low-level Corporate guards patrol restricted ground and order outsiders to move on.', [group('Corporate guard', 'security-operative', party(c), { armor: armor('Light Armorjack', 11), replaceWeapons: [replace('Poor Quality Assault Rifle', weapon('Poor Quality SMG', 'Handgun'))], modifications: ['Kevlar replaced with Light Armorjack.', 'Poor Quality Assault Rifle replaced with Poor Quality SMG.'] })]) },
  { min: 12, max: 13, title: 'Techs', build: (c) => { const roll = c.d10(); const task = roll <= 2 ? 'loading tools into an AV-4' : roll <= 5 ? 'working on a City system in the Crew’s path' : 'walking toward work'; return baseResult('Techs', `A small technical crew is ${task}.`, [group('Tech', 'bodyguard', halfParty(c), { addCyberware: ['Tool Hand', 'MicroOptics Cybereye'], modifications: ['Added Tool Hand and MicroOptics Cybereye.'] }, 'neutral')], [`Scene roll: ${roll}.`]); } },
  { min: 14, max: 17, title: 'Private Investigator', build: (c) => { const roll = c.d10(); const action = roll <= 3 ? 'hassling an informant' : roll <= 7 ? 'shadowing a suspect' : 'asking the Crew whether they have seen the target'; return baseResult('Private Investigator', `A PI is ${action}.`, [group('Private investigator', 'security-officer', 1, { removeWeapons: ['Assault Rifle'], removeGear: ['Bulletproof Shield'], modifications: ['Removed Assault Rifle and Bulletproof Shield.'] }, 'neutral')], [`Scene roll: ${roll}.`]); } },
  { min: 18, max: 20, title: 'Corporates', build: (c) => { const roll = c.d10(); const corporate = group('Corporate', 'boosterganger', party(c), boosterPatch({ armor: armor('Kevlar', 7), removeWeapons: ['Rippers'], replaceWeapons: [replace('Poor Quality Very Heavy Pistol', weapon('Medium Pistol', 'Handgun'))], addCyberware: ['Cyberaudio Suite (Radio Scanner/Music Player)'], modifications: ['Removed Rippers.', 'Leather replaced with Kevlar.', 'Poor Quality Very Heavy Pistol replaced with Medium Pistol.'] }), 'neutral'); if (roll <= 4) return baseResult('Corporates', 'A local corporate group is being followed by gangers intent on robbery.', [corporate, group('Robber', 'boosterganger', party(c))], [`Scene roll: ${roll}.`]); if (roll <= 8) return baseResult('Corporates', 'The corporates mistake the Crew for boosters and react aggressively to provocation.', [corporate], [`Scene roll: ${roll}.`]); return baseResult('Corporates', 'The corporates call for Corporate backup rather than engage directly.', [corporate], [`Scene roll: ${roll}.`, 'Use the Corporate Guards encounter for backup if needed.']); } },
  { min: 21, max: 27, title: 'Locals', build: (c) => { const roll = c.d10(); const locals = group('Local', 'boosterganger', 2, boosterPatch({ removeWeapons: ['Rippers', 'Poor Quality Very Heavy Pistol'], modifications: ['Removed Rippers and Poor Quality Very Heavy Pistol.'] }), 'ally'); if (roll <= 5) return baseResult('Locals', 'Two local youths are being held up by Red Chrome Legion gangers.', [locals, group('Red Chrome Legion ganger', 'boosterganger', party(c), boosterPatch({ armor: armor('Heavy Armorjack', 13), modifications: ['Leather replaced with Heavy Armorjack.'] }))], [`Scene roll: ${roll}.`]); return baseResult('Locals', 'Two local youths are being beaten by Inquisitor cultists over designer eyes.', [locals, group('Inquisitor', 'boosterganger', party(c), boosterPatch({ replaceWeapons: [replace('Rippers', weapon('Medium Melee Weapon', 'Melee Weapon'))], removeCyberware: ['Techhair'], modifications: ['Rippers replaced with Medium Melee Weapon.', 'Removed Techhair.'] }))], [`Scene roll: ${roll}.`]); } },
  { min: 28, max: 32, title: 'Reclaimers', build: (c) => { const roll = c.d10(); const response = roll <= 5 ? 'ignore the Crew' : roll <= 8 ? 'send the chief and one reclaimer over to check the Crew' : 'blow a transformer and black out the block'; return baseResult('Reclaimers', `A reclaimer crew is hot-wiring an abandoned building into the grid; they ${response}.`, [group('Reclaimer', 'road-ganger', Math.max(0, party(c) - 2), undefined, 'neutral'), group('Reclaimer chief', 'reclaimer-chief', 1, undefined, 'neutral')], [`Scene roll: ${roll}.`]); } },
  { min: 33, max: 37, title: 'Medias', build: (c) => { const roll = c.d10(); const media = group('Media', 'boosterganger', 2, boosterPatch({ armor: armor('Kevlar', 7), removeWeapons: ['Rippers'], replaceWeapons: [replace('Poor Quality Very Heavy Pistol', weapon('Heavy Pistol', 'Handgun'))], addCyberware: ['MicroVideo Cybereye', 'Cyberaudio Suite', 'Amplified Hearing'], modifications: ['Leather replaced with Kevlar.', 'Very Heavy Pistol replaced with Heavy Pistol.', 'Removed Rippers.', 'Added recording cyberware.'] }), 'neutral'); if (roll > 5) return baseResult('Medias', 'A two-person media team stakes out a building without being spotted yet.', [media], [`Scene roll: ${roll}.`]); const subject = storySubject(c); return baseResult('Medias', `The media team is spotted and conflict erupts. ${subject.description}`, [media, ...subject.groups], [`Scene roll: ${roll}.`], subject.warnings); } },
  { min: 38, max: 41, title: 'Private Investigator', build: (c) => { const roll = c.d10(); const action = roll <= 3 ? 'beating an informant' : roll <= 7 ? 'breaking into a car' : 'demanding information about a target'; return baseResult('Private Investigator', `A PI is ${action}.`, [group('Private investigator', 'security-officer', 1, { removeWeapons: ['Assault Rifle'], removeGear: ['Bulletproof Shield'], modifications: ['Removed Assault Rifle and Bulletproof Shield.'] }, 'neutral')], [`Scene roll: ${roll}.`]); } },
  { min: 42, max: 46, title: 'Trauma Team', build: (c) => { const roll = c.d10(); const hostile = roll >= 6; return baseResult('Trauma Team', hostile ? 'A Trauma Team AV-4 lands among wounded gangers; two security officers decide the Crew is part of the problem.' : 'A Trauma Team AV-4 lands among wounded gangers and treats the Crew as bystanders.', traumaTeamGroups(hostile), [`Scene roll: ${roll}.`, hostile ? 'Only the two security officers begin hostile; the medical crew remains neutral unless the scene changes.' : 'The full team is present but initially neutral.']); } },
  { min: 47, max: 57, title: 'Scavvers', build: (c) => { const roll = c.d10(); const action = roll <= 6 ? 'beg for money or supplies' : roll <= 8 ? 'ignore the Crew' : 'try to rob the Crew'; return baseResult('Scavvers', `Dirt-poor scavengers root through ruins and ${action}.`, [group('Scavver', 'boosterganger', party(c), boosterPatch({ replaceWeapons: [replace('Rippers', weapon('Light Melee Weapon', 'Melee Weapon'))], modifications: ['Rippers replaced with Light Melee Weapon.'] }), roll <= 8 ? 'neutral' : 'enemy')], [`Scene roll: ${roll}.`, 'The GM may add up to six nearby scavvers if violence begins.']); } },
  { min: 58, max: 63, title: 'Nomads', build: (c) => baseResult('Nomads', 'A drunk nomad group carrying crossbows, knives, and Very Heavy Pistols is looking for a fight.', [group('Nomad', 'road-ganger', party(c))]) },
  { min: 64, max: 70, title: 'Boostergang', build: (c) => baseResult('Boostergang', 'Piranhas gangers shake down anyone who looks like easy prey.', [group('Piranhas ganger', 'boosterganger', party(c))]) },
  { min: 71, max: 76, title: 'Street Punks', build: (c) => baseResult('Street Punks', 'Smash-heads rush the Crew for drug money with knives and clubs and no armor.', [group('Street punk', 'boosterganger', party(c), boosterPatch({ armor: null, replaceWeapons: [replace('Rippers', weapon('Light Melee Weapon', 'Melee Weapon'))], removeWeapons: ['Poor Quality Very Heavy Pistol'], modifications: ['Removed armor and Very Heavy Pistol.', 'Rippers replaced with Light Melee Weapon.'] }))]) },
  { min: 77, max: 82, title: 'Culties', build: (c) => baseResult('Culties', 'Reckoners corner the Crew to preach the end times, then try to beat the message in.', [group('Reckoner', 'boosterganger', party(c), boosterPatch({ replaceWeapons: [replace('Rippers', weapon('Big Knucks', 'Melee Weapon')), replace('Poor Quality Very Heavy Pistol', weapon('Poor Quality Heavy Pistol', 'Handgun'))], addWeapons: [weapon('Light Melee Weapon', 'Melee Weapon')], modifications: ['Rippers replaced with Big Knucks.', 'Very Heavy Pistol replaced with Heavy Pistol.', 'Added Light Melee Weapon.'] }))]) },
  { min: 83, max: 88, title: 'Nomad Truck', build: (c) => { const roll = c.d10(); return baseResult('Nomad Truck', 'Nomads repair a broken truck while facing off with local gangers. They may accept help.', [group('Nomad', 'road-ganger', Math.max(2, halfParty(c)), { armor: armor('Kevlar', 7), modifications: ['Leather replaced with Kevlar.'] }, 'neutral'), group('Local ganger', 'boosterganger', party(c), undefined, 'enemy')], [`Offer-help roll: ${roll} — ${roll <= 6 ? 'accepted' : 'refused'}.`]); } },
  { min: 89, max: 94, title: 'Boostergang', build: (c) => baseResult('Boostergang', 'Iron Sights gangers with automatic weapons and boosted reflexes are spoiling for a fight.', [group('Iron Sights ganger', 'boosterganger', party(c), boosterPatch({ replaceWeapons: [replace('Poor Quality Very Heavy Pistol', weapon('Poor Quality SMG', 'Handgun'))], addCyberware: ['Low-Light/Infrared/UV Cybereyes', 'Neural Link', 'Kerenzikov'], modifications: ['Very Heavy Pistol replaced with SMG.', 'Added enhanced cybereyes and Kerenzikov.'] }))]) },
  { min: 95, max: 100, title: 'Major Criminal', build: (c) => { const roll = c.d10(); const response = roll <= 4 ? 'do not notice the Crew' : roll <= 8 ? 'warn the Crew off' : 'decide the Crew are witnesses'; const patch: OfficialNpcPatch = { armor: armor('Heavy Armorjack', 13), replaceWeapons: [replace('Assault Rifle', weapon('Shotgun', 'Shoulder Arms')), replace('Poor Quality Assault Rifle', weapon('Shotgun', 'Shoulder Arms'))], modifications: ['Armor replaced with Heavy Armorjack.', 'Assault Rifle replaced with Shotgun.'] }; return baseResult('Major Criminal', `A Vilshenko smuggling crew unloads contraband; they ${response}.`, [group('Syndicate solo', 'security-operative', Math.max(0, party(c) - 2), patch), group('Veteran solo', 'security-officer', 1, patch)], [`Scene roll: ${roll}.`]); } },
];

const EVENING: EncounterTableEntry[] = [
  { min: 1, max: 5, title: 'City Police', build: (c) => baseResult('City Police', 'Patrol officers in Medium Armorjack demand identification from visibly armed people.', [group('Patrol officer', 'security-officer', halfParty(c))]) },
  { min: 6, max: 11, title: 'Corporate Guards', build: (c) => baseResult('Corporate Guards', 'Corporate guards in Heavy Armorjack carrying Heavy SMGs patrol restricted territory.', [group('Corporate guard', 'security-operative', party(c), { armor: armor('Heavy Armorjack', 13), replaceWeapons: [replace('Poor Quality Assault Rifle', weapon('Poor Quality Heavy SMG', 'Handgun'))], modifications: ['Kevlar replaced with Heavy Armorjack.', 'Assault Rifle replaced with Heavy SMG.'] })]) },
  { min: 12, max: 13, title: 'Corporate Techs', build: (c) => { const roll = c.d10(); const task = roll <= 2 ? 'loading parts into an AV-4' : roll <= 5 ? 'working on a City system' : 'repairing a nice car'; return baseResult('Corporate Techs', `Corporate technicians are ${task} under guard.`, [group('Corporate tech', 'bodyguard', halfParty(c), { addCyberware: ['Tool Hand', 'MicroOptics Cybereye'], modifications: ['Added Tool Hand and MicroOptics Cybereye.'] }, 'neutral'), group('Corporate bodyguard', 'bodyguard', halfParty(c), { armor: armor('Medium Armorjack', 12), replaceWeapons: [replace('Poor Quality Shotgun', weapon('Shotgun', 'Shoulder Arms'))], addCyberware: ['Targeting Scope Cybereye'], modifications: ['Kevlar replaced with Medium Armorjack.', 'Poor Quality Shotgun replaced with Shotgun.', 'Added Targeting Scope Cybereye.'] })], [`Scene roll: ${roll}.`]); } },
  { min: 14, max: 17, title: 'Private Investigator', build: (c) => { const roll = c.d10(); const action = roll <= 3 ? 'hassling an informant' : roll <= 7 ? 'shadowing a target' : 'asking the Crew about the target'; return baseResult('Private Investigator', `A PI is ${action}.`, [group('Private investigator', 'reclaimer-chief', 1, { removeWeapons: ['Shotgun'], removeGear: ['Tent & Camping Equipment'], replaceWeapons: [replace('Heavy Pistol', weapon('Very Heavy Pistol', 'Handgun')), replace('Heavy Melee Weapon', weapon('Medium Melee Weapon', 'Melee Weapon'))], modifications: ['Removed Shotgun and camping equipment.', 'Heavy Pistol replaced with Very Heavy Pistol.', 'Heavy Melee Weapon replaced with Medium Melee Weapon.'] }, 'neutral')], [`Scene roll: ${roll}.`]); } },
  { min: 18, max: 20, title: 'Corporates', build: (c) => { const roll = c.d10(); const patch = boosterPatch({ armor: armor('Kevlar', 7), removeWeapons: ['Rippers'], replaceWeapons: [replace('Poor Quality Very Heavy Pistol', weapon('Polymer One-shot', 'Handgun'))], addCyberware: ['Cyberaudio Suite (Radio Scanner/Music Player)'], modifications: ['Removed Rippers.', 'Leather replaced with Kevlar.', 'Very Heavy Pistol replaced with Polymer One-shot.'], sourceWarnings: ['Polymer One-shot damage and capacity require a matching reference-catalog entry.'] }); const corporates = group('Corporate', 'boosterganger', party(c), patch, 'neutral'); if (roll <= 4) return baseResult('Corporates', 'Corporates heading for the lev train are followed by robbers.', [corporates, group('Robber', 'boosterganger', party(c))], [`Scene roll: ${roll}.`]); if (roll <= 8) return baseResult('Corporates', 'The corporates mistake the Crew for boosters and may open fire.', [corporates], [`Scene roll: ${roll}.`]); return baseResult('Corporates', 'The corporates call for Corporate backup.', [corporates], [`Scene roll: ${roll}.`, 'Use the Corporate Guards encounter for backup.']); } },
  { min: 21, max: 25, title: 'Rockerboys', build: (c) => { const roll = c.d10(); const action = roll <= 4 ? 'invite the Crew to join them' : roll <= 8 ? 'send their bodyguards to deal with perceived followers' : 'ignore the Crew'; return baseResult('Rockerboys', `A touring group is headed to a gig and will ${action}.`, [group('Rocker', 'boosterganger', Math.max(0, halfParty(c) - 1), { addCyberware: ['AudioVox'], addGear: ['Instrument'], modifications: ['Added AudioVox and instrument.'] }, 'neutral'), group('Solo bodyguard', 'bodyguard', halfParty(c), undefined, roll <= 8 && roll >= 5 ? 'enemy' : 'neutral'), group('Fixer manager', 'boosterganger', 1, { addCyberware: ['Cyberaudio Suite', 'Internal Agent'], modifications: ['Added Cyberaudio Suite and Internal Agent.'] }, 'neutral')], [`Scene roll: ${roll}.`]); } },
  { min: 26, max: 30, title: 'Medias', build: (c) => { const roll = c.d10(); const media = group('Media', 'boosterganger', 2, boosterPatch({ armor: armor('Kevlar', 7), removeWeapons: ['Rippers'], replaceWeapons: [replace('Poor Quality Very Heavy Pistol', weapon('Heavy Pistol', 'Handgun'))], addCyberware: ['MicroVideo Cybereye', 'Cyberaudio Suite', 'Amplified Hearing'], modifications: ['Leather replaced with Kevlar.', 'Very Heavy Pistol replaced with Heavy Pistol.', 'Removed Rippers.', 'Added recording cyberware.'] }), 'neutral'); if (roll > 5) return baseResult('Medias', 'A media team continues a tense stakeout.', [media], [`Scene roll: ${roll}.`]); const subject = storySubject(c); return baseResult('Medias', `The team is spotted and a firefight starts. ${subject.description}`, [media, ...subject.groups], [`Scene roll: ${roll}.`], subject.warnings); } },
  { min: 31, max: 33, title: 'Philharmonic Vampires', build: (c) => { const roll = c.d10(); const events = ['setting up a bizarre prank while gangers close in', 'hacking streetlights to pulse with music', 'broadcasting a fake missile warning', 'dropping bags of counterfeit eurobucks', 'broadcasting fake news']; const index = roll <= 2 ? 0 : roll <= 4 ? 1 : roll <= 6 ? 2 : roll <= 8 ? 3 : 4; const groups = [group('Philharmonic Vampire', 'boosterganger', 3, { setSkills: { 'Electronics/Security Tech': 10 }, modifications: ['Electronics/Security Tech set to 10.'] }, 'neutral')]; if (roll <= 2) groups.push(group('Intervening ganger', 'bodyguard', party(c))); return baseResult('Philharmonic Vampires', `Three pranksters are ${events[index]}.`, groups, [`Scene roll: ${roll}.`, 'Undoing the electronic prank requires a DV14 Electronics/Security Tech Check when applicable.']); } },
  { min: 34, max: 40, title: 'Locals', build: (c) => { const roll = c.d10(); if (roll <= 4) return baseResult('Locals', 'A Beaverville teen is being held up by Piranhas.', [group('Piranhas ganger', 'boosterganger', party(c), { armor: armor('Light Armorjack', 11), modifications: ['Leather replaced with Light Armorjack.'] })], [`Scene roll: ${roll}.`]); if (roll <= 8) return baseResult('Locals', 'A teen is being beaten by Inquisitors over fashionware.', [group('Inquisitor', 'boosterganger', party(c), boosterPatch({ replaceWeapons: [replace('Rippers', weapon('Light Melee Weapon', 'Melee Weapon'))], removeCyberware: ['Techhair'], modifications: ['Rippers replaced with Light Melee Weapon.', 'Removed Techhair.'] }))], [`Scene roll: ${roll}.`]); return baseResult('Locals', 'A Fixer is collecting a debt from a teen who cannot pay.', [group('Fixer', 'bodyguard', 1, { setSkills: { Trading: 10 }, addCyberware: ['Cyberaudio Suite', 'Internal Agent', 'Voice Stress Analyzer'], modifications: ['Trading set to 10.', 'Added Fixer cyberware.'] }, 'neutral')], [`Scene roll: ${roll}.`]); } },
  { min: 41, max: 46, title: 'Roaming Netrunner', build: (c) => { const roll = c.d10(); const runners = group('Netrunner', 'netrunner', 2, { armor: armor('Light Armorjack', 11), modifications: ['Bodyweight Suit replaced with Light Armorjack.'] }, 'neutral'); if (roll <= 5) return baseResult('Roaming Netrunner', 'Two Netrunners are spotted breaching a Corporate office and guards intervene.', [runners, group('Security guard', 'security-operative', party(c))], [`Scene roll: ${roll}.`]); return baseResult('Roaming Netrunner', 'Two Netrunners mistake the Crew for security and activate two building turrets.', [runners, automatedTurretGroup(2)], [`Scene roll: ${roll}.`, 'Select the official turret weapon package before adding the encounter.']); } },
  { min: 47, max: 52, title: 'Nomads', build: (c) => baseResult('Nomads', 'Roadrunners in Medium Armorjack with rifles and knives are drunk and looking for a fight.', [group('Roadrunner', 'road-ganger', party(c), { armor: armor('Medium Armorjack', 12), replaceWeapons: [replace('Crossbow', weapon('Assault Rifle', 'Shoulder Arms'))], setSkills: { 'Shoulder Arms': 10 }, removeSkills: ['Archery'], modifications: ['Leather replaced with Medium Armorjack.', 'Crossbow replaced with Assault Rifle.', 'Archery replaced with Shoulder Arms 10.'] })]) },
  { min: 53, max: 58, title: 'Street Punks', build: (c) => baseResult('Street Punks', 'Smash-heads rush the Crew with knives and clubs and no armor.', [group('Street punk', 'boosterganger', party(c), boosterPatch({ armor: null, replaceWeapons: [replace('Rippers', weapon('Light Melee Weapon', 'Melee Weapon'))], removeWeapons: ['Poor Quality Very Heavy Pistol'], modifications: ['Removed armor and pistol.', 'Rippers replaced with Light Melee Weapon.'] }))]) },
  { min: 59, max: 63, title: 'Trauma Team', build: (c) => { const roll = c.d10(); const hostile = roll >= 6; return baseResult('Trauma Team', hostile ? 'Trauma Team security identifies the Crew as part of the threat.' : 'Trauma Team treats wounded gangers and ignores the Crew.', traumaTeamGroups(hostile), [`Scene roll: ${roll}.`, hostile ? 'Only the two security officers begin hostile.' : 'The full team is present but initially neutral.']); } },
  { min: 64, max: 69, title: 'Chromers', build: (c) => { const roll = c.d10(); const action = roll <= 5 ? 'pick a fight while high on Smash' : roll <= 7 ? 'pass with rude comments' : 'invite the Crew to a concert'; return baseResult('Chromers', `Chromatic-rock fans with chrome arms ${action}.`, [group('Chromer', 'boosterganger', party(c), boosterPatch({ armor: armor('Light Armorjack', 11), replaceWeapons: [replace('Rippers', weapon('Wolvers', 'Melee Weapon'))], addCyberware: ['Cyberarm x2 (Superchrome Covering)'], modifications: ['Leather replaced with Light Armorjack.', 'Rippers replaced with Wolvers.', 'Added two Superchrome Cyberarms.'] }), roll <= 5 ? 'enemy' : 'neutral')], [`Scene roll: ${roll}.`]); } },
  { min: 70, max: 72, title: 'Solo Team', build: (c) => { const roll = c.d10(); return baseResult('Solo Team', roll <= 5 ? 'A cybered assassin team avoids the Crew.' : 'A cybered assassin team decides the Crew are witnesses.', [group('Solo', 'security-officer', halfParty(c), { removeWeapons: ['Assault Rifle'], replaceWeapons: [replace('Very Heavy Pistol', weapon('Heavy Pistol', 'Handgun'))], addCyberware: ['Low-Light/Infrared/UV Cybereyes', 'Cyberleg x2 (Jump Boosters)'], modifications: ['Removed Assault Rifle.', 'Very Heavy Pistol replaced with Heavy Pistol.', 'Added enhanced cybereyes and Jump Booster cyberlegs.'] }, roll <= 5 ? 'neutral' : 'enemy')], [`Scene roll: ${roll}.`]); } },
  { min: 73, max: 77, title: 'Boostergang', build: (c) => baseResult('Boostergang', 'A tougher Iron Sights group carries automatic weapons, cyberweapons, enhanced vision, and boosted reflexes.', [group('Iron Sights ganger', 'bodyguard', party(c), { replaceWeapons: [replace('Poor Quality Shotgun', weapon('Heavy SMG', 'Handgun'))], addCyberware: ['Two cyberweapons (GM choice)', 'Low-Light/Infrared/UV Cybereyes', 'Neural Link', 'Kerenzikov'], modifications: ['Shotgun replaced with Heavy SMG.', 'Added enhanced cybereyes, Kerenzikov, and two GM-chosen cyberweapons.'] })], [], ['The printed source overlaps percentile 72 between adjacent entries; the app assigns 72 to Solo Team and starts this entry at 73.', 'Two cyberweapons are intentionally left as GM choices by the encounter text.']) },
  { min: 78, max: 83, title: 'Solo Team', build: (c) => { const roll = c.d10(); return baseResult('Solo Team', roll <= 5 ? 'A smartgun-equipped operation team avoids the Crew.' : 'The team decides the Crew are witnesses.', [group('Solo', 'security-officer', halfParty(c), { replaceWeapons: [replace('Assault Rifle', weapon('Smartgun Linked Assault Rifle', 'Shoulder Arms'))], addCyberware: ['Smartgun Link', 'Interface Plugs', 'Cyberaudio Suite', 'Amplified Hearing', 'Low-Light/Infrared/UV Cybereyes', 'Targeting Scope Cybereye'], modifications: ['Assault Rifle replaced with Smartgun Linked Assault Rifle.', 'Added smartgun and sensory cyberware.'] }, roll <= 5 ? 'neutral' : 'enemy')], [`Scene roll: ${roll}.`]); } },
  { min: 84, max: 90, title: 'Boostergang', build: (c) => baseResult('Boostergang', 'Piranhas outnumber the Crew and carry Medium Pistols, knives, and boosted reflexes.', [group('Piranhas ganger', 'boosterganger', party(c) + 2, boosterPatch({ replaceWeapons: [replace('Poor Quality Very Heavy Pistol', weapon('Poor Quality Medium Pistol', 'Handgun'))], addCyberware: ['Neural Link', 'Kerenzikov'], modifications: ['Very Heavy Pistol replaced with Medium Pistol.', 'Added Kerenzikov.'] }))]) },
  { min: 91, max: 93, title: 'Major Criminal', build: (c) => { const roll = c.d10(); const patch: OfficialNpcPatch = { replaceWeapons: [replace('Assault Rifle', weapon('Smartgun Linked Assault Rifle', 'Shoulder Arms')), replace('Poor Quality Assault Rifle', weapon('Smartgun Linked Assault Rifle', 'Shoulder Arms')), replace('Very Heavy Pistol', weapon('Heavy Pistol', 'Handgun'))], addWeapons: [weapon('Wolvers', 'Melee Weapon')], addCyberware: ['Wolvers', 'Neural Link', 'Interface Plugs', 'Smartgun Link', 'Targeting Scope Cybereye'], modifications: ['Rifle replaced with Smartgun Linked Assault Rifle.', 'Pistol replaced with Heavy Pistol.', 'Added Wolvers and smartgun cyberware.'] }; return baseResult('Major Criminal', `A Scagattalia drug operation reacts according to a scene roll of ${roll}.`, [group('Cybered solo', 'security-operative', halfParty(c), patch), group('Veteran solo', 'security-officer', 2, patch)], [`Scene roll: ${roll} — ${roll <= 4 ? 'unnoticed' : roll <= 8 ? 'warned off' : 'marked as witnesses'}.`]); } },
  { min: 94, max: 100, title: 'Firefight', build: (c) => { const gruntPatch = boosterPatch({ armor: armor('Light Armorjack', 11), modifications: ['Leather replaced with Light Armorjack.', 'Cyberweapon remains a GM choice.'], addCyberware: ['Cyberweapon (GM choice)'] }); const leaderPatch: OfficialNpcPatch = { addCyberware: ['Cyberweapon (GM choice)'], modifications: ['Added a GM-chosen cyberweapon.'] }; return baseResult('Firefight', 'The Crew walks into a firefight between Maelstrom and Red Chrome Legion forces.', [group('Maelstrom grunt', 'boosterganger', party(c), gruntPatch, 'enemy'), group('Red Chrome Legion grunt', 'boosterganger', party(c), gruntPatch, 'neutral'), group('Maelstrom leader', 'security-officer', 1, leaderPatch, 'enemy'), group('Red Chrome Legion leader', 'security-officer', 1, leaderPatch, 'neutral')], [], ['Cyberweapon choices are intentionally left to the GM by the encounter text.']); } },
];

function gangSide(roll: number, count: number, side: CombatantSide): RandomEncounterGroup {
  if (roll <= 2) return group('Tyger Claw', 'boosterganger', count, boosterPatch({ armor: armor('Light Armorjack', 11), addWeapons: [weapon('Heavy Melee Weapon', 'Melee Weapon')], modifications: ['Leather replaced with Light Armorjack.', 'Added Heavy Melee Weapon.'] }), side);
  if (roll <= 4) return group('6th Street ganger', 'boosterganger', count, boosterPatch({ armor: armor('Medium Armorjack', 12), replaceWeapons: [replace('Rippers', weapon('Heavy SMG', 'Handgun'))], modifications: ['Leather replaced with Medium Armorjack.', 'Rippers replaced with Heavy SMG.'] }), side);
  if (roll <= 6) return group('Piranhas ganger', 'boosterganger', count, undefined, side);
  if (roll <= 8) return group('Iron Sights ganger', 'boosterganger', count, boosterPatch({ replaceWeapons: [replace('Poor Quality Very Heavy Pistol', weapon('SMG', 'Handgun'))], addCyberware: ['Cyberweapon (GM choice)'], modifications: ['Pistol replaced with SMG.', 'Cyberweapon remains a GM choice.'] }), side);
  return group('NCPD patrol officer', 'boosterganger', count, boosterPatch({ armor: armor('Medium Armorjack', 12), addWeapons: [weapon('Assault Rifle', 'Shoulder Arms')], setSkills: { 'Shoulder Arms': 10 }, modifications: ['Leather replaced with Medium Armorjack.', 'Added Assault Rifle and Shoulder Arms 10.'] }), side);
}

function lateGangSide(roll: number, count: number, side: CombatantSide): RandomEncounterGroup {
  if (roll <= 2) return group('Bozo', 'boosterganger', count, boosterPatch({ armor: armor('Light Armorjack', 11), replaceWeapons: [replace('Rippers', weapon('Big Knucks', 'Melee Weapon'))], addWeapons: [weapon('Very Heavy Melee Weapon', 'Melee Weapon')], modifications: ['Leather replaced with Light Armorjack.', 'Rippers replaced with Big Knucks.', 'Added Very Heavy Melee Weapon.'] }), side);
  if (roll <= 4) return group('Maelstrom ganger', 'boosterganger', count, boosterPatch({ armor: armor('Medium Armorjack', 12), replaceWeapons: [replace('Rippers', weapon('Wolvers', 'Melee Weapon'))], modifications: ['Leather replaced with Medium Armorjack.', 'Rippers replaced with Wolvers.'] }), side);
  if (roll <= 6) return group('Primetime Player', 'boosterganger', count, boosterPatch({ addWeapons: [weapon('Shotgun', 'Shoulder Arms')], setSkills: { 'Shoulder Arms': 10 }, modifications: ['Added Shotgun and Shoulder Arms 10.'] }), side);
  if (roll <= 8) return group('Voodoo Boy', 'boosterganger', count, boosterPatch({ replaceWeapons: [replace('Poor Quality Very Heavy Pistol', weapon('SMG', 'Handgun'))], addGear: ['Teargas Grenade x1'], modifications: ['Pistol replaced with SMG.', 'Added Teargas Grenade.'] }), side);
  return group('Red Chrome Legion ganger', 'boosterganger', count, boosterPatch({ armor: armor('Medium Armorjack', 12), addWeapons: [weapon('Assault Rifle', 'Shoulder Arms')], setSkills: { 'Shoulder Arms': 10 }, modifications: ['Leather replaced with Medium Armorjack.', 'Added Assault Rifle and Shoulder Arms 10.'] }), side);
}

const MIDNIGHT: EncounterTableEntry[] = [
  { min: 1, max: 10, title: 'City Police', build: (c) => baseResult('City Police', 'After-midnight patrol officers with Smartgun Linked Assault Rifles look for a pretext to detain visibly armed people.', [group('Patrol officer', 'security-officer', halfParty(c), { replaceWeapons: [replace('Assault Rifle', weapon('Smartgun Linked Assault Rifle', 'Shoulder Arms'))], addCyberware: ['Interface Plugs', 'Smartgun Link'], modifications: ['Assault Rifle replaced with Smartgun Linked Assault Rifle.', 'Added Interface Plugs and Smartgun Link.'] })]) },
  { min: 11, max: 22, title: 'Corporate Guards', build: (c) => baseResult('Corporate Guards', 'Corporate guards with Smartgun Linked Heavy SMGs patrol property after midnight.', [group('Corporate guard', 'security-officer', party(c), { replaceWeapons: [replace('Assault Rifle', weapon('Smartgun Linked Heavy SMG', 'Handgun'))], addCyberware: ['Interface Plugs', 'Smartgun Link'], modifications: ['Assault Rifle replaced with Smartgun Linked Heavy SMG.', 'Added Interface Plugs and Smartgun Link.'] })]) },
  { min: 23, max: 24, title: 'Private Investigator', build: (c) => { const roll = c.d10(); const action = roll <= 3 ? 'hassling an informant' : roll <= 7 ? 'shadowing a target' : 'questioning the Crew'; return baseResult('Private Investigator', `A PI is ${action}.`, [group('Private investigator', 'reclaimer-chief', 1, { removeWeapons: ['Shotgun'], removeGear: ['Tent & Camping Equipment'], replaceWeapons: [replace('Heavy Pistol', weapon('Very Heavy Pistol', 'Handgun')), replace('Heavy Melee Weapon', weapon('Medium Melee Weapon', 'Melee Weapon'))], modifications: ['Removed Shotgun and camping equipment.', 'Heavy Pistol replaced with Very Heavy Pistol.', 'Heavy Melee Weapon replaced with Medium Melee Weapon.'] }, 'neutral')], [`Scene roll: ${roll}.`]); } },
  { min: 25, max: 25, title: 'Medias', build: (c) => { const roll = c.d10(); const media = group('Media', 'boosterganger', 2, boosterPatch({ armor: armor('Kevlar', 7), removeWeapons: ['Rippers'], replaceWeapons: [replace('Poor Quality Very Heavy Pistol', weapon('Heavy Pistol', 'Handgun'))], addCyberware: ['MicroVideo Cybereye', 'Cyberaudio Suite', 'Amplified Hearing'], modifications: ['Leather replaced with Kevlar.', 'Pistol replaced with Heavy Pistol.', 'Removed Rippers.', 'Added recording cyberware.'] }), 'neutral'); if (roll >= 6) return baseResult('Medias', 'A media team decides the Crew is the story and follows them.', [media], [`Scene roll: ${roll}.`]); const subject = storySubject(c); return baseResult('Medias', `The team is spotted and a firefight starts. ${subject.description}`, [media, ...subject.groups], [`Scene roll: ${roll}.`], subject.warnings); } },
  { min: 26, max: 29, title: 'Chromers', build: (c) => { const roll = c.d10(); const action = roll <= 5 ? 'pick a fight while high on Smash' : roll <= 7 ? 'pass with rude comments' : 'invite the Crew to an after-party'; return baseResult('Chromers', `Chromatic-rock fans outnumber the Crew and ${action}.`, [group('Chromer', 'boosterganger', party(c) + 2, boosterPatch({ armor: armor('Light Armorjack', 11), replaceWeapons: [replace('Rippers', weapon('Wolvers', 'Melee Weapon'))], addCyberware: ['Cyberarm x2 (Superchrome Covering)'], modifications: ['Leather replaced with Light Armorjack.', 'Rippers replaced with Wolvers.', 'Added two Superchrome Cyberarms.'] }), roll <= 5 ? 'enemy' : 'neutral')], [`Scene roll: ${roll}.`]); } },
  { min: 30, max: 39, title: 'Edgerunner Team', build: (c) => { const roll = c.d10(); return baseResult('Edgerunner Team', roll <= 5 ? 'A Netrunner, Solo, and Nomad are spotted preparing a Corporate break-in and conflict starts with six guards.' : 'A Netrunner, Solo, and Nomad offer the Crew a piece of a Corporate break-in while six guards patrol outside.', [group('Edgerunner Netrunner', 'netrunner', 1, undefined, 'ally'), group('Edgerunner Solo', 'security-officer', 1, undefined, 'ally'), group('Edgerunner Nomad', 'reclaimer-chief', 1, undefined, 'ally'), group('Corporate security', 'security-operative', 6, undefined, 'enemy')], [`Scene roll: ${roll}.`]); } },
  { min: 40, max: 42, title: 'Trauma Team', build: (c) => { const roll = c.d10(); const hostile = roll >= 6; return baseResult('Trauma Team', hostile ? 'Trauma Team security opens fire on the Crew.' : 'Trauma Team treats wounded gangers and ignores the Crew.', traumaTeamGroups(hostile), [`Scene roll: ${roll}.`, hostile ? 'Only the two security officers begin hostile.' : 'The full team is present but initially neutral.']); } },
  { min: 43, max: 45, title: 'Ranger', build: (c) => { const roll = c.d10(); return baseResult('Ranger', roll <= 5 ? 'A Lawman and deputy are already fighting six scavengers and ask the Crew to join.' : 'A Lawman and deputy prepare to raid a six-scavenger hideout and offer part of the bounty.', [group('Lawman', 'outrider', 1, undefined, 'ally'), group('Deputy', 'road-ganger', 1, undefined, 'ally'), group('Scavenger', 'boosterganger', 6, undefined, 'enemy')], [`Scene roll: ${roll}.`]); } },
  { min: 46, max: 58, title: 'Nomads', build: (c) => baseResult('Nomads', 'Wildman nomads are beating a Corporate couple and ignore anyone who stays clear of them and their bikes.', [group('Wildman nomad', 'road-ganger', party(c) + 2, { replaceWeapons: [replace('Crossbow', weapon('Assault Rifle', 'Shoulder Arms'))], setSkills: { 'Shoulder Arms': 10 }, removeSkills: ['Archery'], addGear: ['Light Tattoos'], modifications: ['Crossbow replaced with Assault Rifle.', 'Archery replaced with Shoulder Arms.', 'Added Light Tattoos.'] }), group('Corporate victim', 'boosterganger', 2, { removeWeapons: ['Rippers'], modifications: ['Removed Rippers.'] }, 'ally')]) },
  { min: 59, max: 63, title: 'Culties', build: (c) => { const total = party(c); const patch = boosterPatch({ armor: null, replaceWeapons: [replace('Rippers', weapon('Medium Melee Weapon', 'Melee Weapon'))], removeCyberware: ['Techhair'], modifications: ['Removed armor and Techhair.', 'Rippers replaced with Medium Melee Weapon.'] }); const rangedPatch: OfficialNpcPatch = { addWeapons: [weapon('Air Pistol', 'Handgun')], addGear: ['Acid Paintballs x20'], modifications: ['Added Air Pistol with 20 Acid Paintballs.'] }; return baseResult('Culties', 'Inquisitors corner the Crew with melee weapons and handguns while two stand back with acid-loaded Air Pistols.', [{ ...group('Inquisitor', 'boosterganger', total, patch), instancePatches: Array.from({ length: total }, (_, index) => index < 2 ? rangedPatch : {}) }]); } },
  { min: 64, max: 73, title: 'Street Punks', build: (c) => baseResult('Street Punks', 'Black Lace addicts outnumber the Crew, rush them with knives and clubs, and ignore the Seriously Wounded penalty.', [group('Black Lace punk', 'boosterganger', party(c) + 2, boosterPatch({ armor: null, replaceWeapons: [replace('Rippers', weapon('Light Melee Weapon', 'Melee Weapon'))], removeWeapons: ['Poor Quality Very Heavy Pistol'], addGear: ['Black Lace (active)'], painEditor: true, specialRules: ['Unaffected by the Seriously Wounded Wound State while Black Lace is active.'], modifications: ['Removed armor and pistol.', 'Rippers replaced with Light Melee Weapon.', 'Black Lace active.'] }))]) },
  { min: 74, max: 74, title: 'Major Criminal', build: (c) => { const roll = c.d10(); const patch: OfficialNpcPatch = { replaceWeapons: [replace('Assault Rifle', weapon('Smartgun Linked Assault Rifle', 'Shoulder Arms')), replace('Very Heavy Pistol', weapon('Heavy Pistol', 'Handgun'))], addWeapons: [weapon('Wolvers', 'Melee Weapon')], addCyberware: ['Wolvers', 'Interface Plugs', 'Smartgun Link', 'Targeting Scope Cybereye'], modifications: ['Rifle replaced with Smartgun Linked Assault Rifle.', 'Pistol replaced with Heavy Pistol.', 'Added Wolvers and smartgun cyberware.'] }; return baseResult('Major Criminal', `A Scagattalia cargo operation reacts according to a scene roll of ${roll}.`, [group('Cybered solo', 'security-officer', party(c), patch)], [`Scene roll: ${roll} — ${roll <= 4 ? 'unnoticed' : roll <= 8 ? 'warned off' : 'marked as witnesses'}.`]); } },
  { min: 75, max: 79, title: 'Turf War', build: (c) => {
    const count = Math.max(4, party(c));
    const first = c.d10();
    const second = c.d10();
    const sideA = onTeam(gangSide(first, count, 'enemy'), 'Side A');
    const sideB = onTeam(gangSide(second, count, 'neutral'), 'Side B');
    return baseResult(
      'Turf War',
      'Two major factions are fighting in the street. Pick a side or pick a target.',
      [sideA, sideB],
      [`Side A roll: ${first}.`, `Side B roll: ${second}.`],
      ['Cyberweapon choices remain GM choices where specified by the source.'],
    );
  } },
  { min: 80, max: 87, title: 'Arsonists', build: (c) => baseResult('Arsonists', 'A Pyro leads radical arsonists burning the block; they avoid a fight unless someone gets in the way.', [group('Flamethrower ganger', 'pyro', 1), group('Arsonist', 'boosterganger', Math.max(2, party(c) - 3), { addGear: ['Incendiary Grenade x1'], modifications: ['Added Incendiary Grenade.'] })]) },
  { min: 88, max: 92, title: 'Turf War', build: (c) => {
    const count = Math.max(4, party(c));
    const first = c.d10();
    const second = c.d10();
    const sideA = onTeam(lateGangSide(first, count, 'enemy'), 'Side A');
    const sideB = onTeam(lateGangSide(second, count, 'neutral'), 'Side B');
    return baseResult(
      'Turf War',
      'Two large gangs are in an all-out turf war. Pick a side or a target.',
      [sideA, sideB],
      [`Side A roll: ${first}.`, `Side B roll: ${second}.`],
      ['Cyberweapon choices remain GM choices where specified by the source.'],
    );
  } },
  { min: 93, max: 99, title: 'Major Criminal', build: (c) => { const roll = c.d10(); const patch: OfficialNpcPatch = { replaceWeapons: [replace('Assault Rifle', weapon('Smartgun Linked Assault Rifle', 'Shoulder Arms')), replace('Very Heavy Pistol', weapon('Heavy Pistol', 'Handgun'))], addWeapons: [weapon('Wolvers', 'Melee Weapon')], addCyberware: ['Wolvers', 'Interface Plugs', 'Smartgun Link', 'Targeting Scope Cybereye'], modifications: ['Rifle replaced with Smartgun Linked Assault Rifle.', 'Pistol replaced with Heavy Pistol.', 'Added Wolvers and smartgun cyberware.'] }; return baseResult('Major Criminal', `Six Scagattalia solos react according to a scene roll of ${roll}.`, [group('Cybered solo', 'security-officer', 6, patch)], [`Scene roll: ${roll} — ${roll <= 4 ? 'unnoticed' : roll <= 8 ? 'warned off' : 'marked as witnesses'}.`]); } },
  { min: 100, max: 100, title: 'Cyberpsycho Rage', build: (c) => { const rounds = c.d6() + 1; return baseResult('Cyberpsycho Rage', 'A heavily cybered psycho is attacking a pedestrian and has noticed the Crew.', [group('Cyberpsycho', 'cyberpsycho', 1)], [`Psycho Squad estimated arrival: ${rounds} rounds.`]); } },
];

const TABLES: Record<EncounterPeriod, EncounterTableEntry[]> = {
  daytime: DAYTIME,
  evening: EVENING,
  midnight: MIDNIGHT,
};

function percentileDice(roll: number): [number, number] {
  if (roll === 100) return [0, 0];
  return [Math.floor(roll / 10), roll % 10];
}

function rollPercentile(random: () => number, zone: ThreatZone, regionalGuidance: boolean): number {
  if (regionalGuidance && zone === 'corporate') return Math.floor(random() * 50) + 1;
  if (regionalGuidance && (zone === 'combat' || zone === 'hot')) return Math.floor(random() * 50) + 51;
  const tens = Math.floor(random() * 10);
  const ones = Math.floor(random() * 10);
  const percentile = tens * 10 + ones;
  return percentile === 0 ? 100 : percentile;
}

function findEntry(period: EncounterPeriod, percentile: number): EncounterTableEntry {
  const entry = TABLES[period].find((candidate) => percentile >= candidate.min && percentile <= candidate.max);
  if (!entry) throw new Error(`No ${period} encounter for percentile ${percentile}.`);
  return entry;
}

export function rollRandomEncounter(options: RollRandomEncounterOptions): RandomEncounterResult {
  const random = options.random ?? Math.random;
  const partySize = Math.max(1, Math.trunc(options.partySize));
  const regionalGuidance = options.regionalGuidance ?? true;
  const overrides = options.subrollOverrides ?? {};

  if (options.zone === 'executive') {
    return {
      id: id('random-encounter'), period: options.period, zone: options.zone, partySize, regionalGuidance, roll: 0, dice: [0, 0],
      title: 'Executive Zone Surveillance',
      description: 'The supplied regional rules do not use the random street tables in the Executive Zone. Constant high-grade Corporate surveillance is the encounter pressure instead.',
      groups: [], subrolls: [], gmNotes: ['Drawing a weapon should trigger an immediate, overwhelming Corporate security response.'], warnings: [], createdAt: new Date().toISOString(),
    };
  }

  const resolve = (percentile: number, depth: number, keyPrefix = 'root.'): RandomEncounterResult => {
    const normalized = Math.max(1, Math.min(100, Math.trunc(percentile)));
    const entry = findEntry(options.period, normalized);
    const directSubrolls: RandomEncounterSubroll[] = [];
    let subrollIndex = 0;

    const record = (die: RandomEncounterSubrollDie, producer: () => number, label = 'Secondary roll') => {
      const subrollId = `${keyPrefix}${subrollIndex}`;
      subrollIndex += 1;
      const raw = clampDieRoll(die, overrides[subrollId] ?? producer());
      const descriptor: RandomEncounterSubroll = {
        id: subrollId,
        label,
        roll: raw,
        die,
        modifier: 0,
        total: raw,
        outcome: '',
      };
      directSubrolls.push(descriptor);
      return descriptor;
    };

    const context: BuildContext = {
      partySize,
      d10: () => record('1d10', () => d10From(random)).roll,
      d6: () => record('1d6', () => d6From(random)).roll,
      depth,
      rollAgain: (nextDepth) => {
        const nestedRoll = record('1d100', () => d100From(random, options.zone, regionalGuidance), 'Story subject');
        const nested = resolve(nestedRoll.roll, nextDepth, `${nestedRoll.id}.`);
        nestedRoll.outcome = `${nested.roll.toString().padStart(2, '0')} · ${nested.title}`;
        directSubrolls.push(...nested.subrolls);
        return nested;
      },
    };
    const built = entry.build(context);
    const zoneNote = !regionalGuidance
      ? (options.zone === 'moderate' ? null : 'Regional guidance was disabled; the full 01–100 table was used.')
      : options.zone === 'corporate'
        ? 'Corporate-zone guidance kept the percentile roll in 01–50.'
        : options.zone === 'combat' || options.zone === 'hot'
          ? `${options.zone === 'combat' ? 'Combat' : 'Hot'}-zone guidance kept the percentile roll in 51–100.`
          : null;
    const subrolls = annotateSubrolls(built.title, built.description, built.groups, built.gmNotes, directSubrolls);
    return {
      id: id('random-encounter'),
      period: options.period,
      zone: options.zone,
      partySize,
      regionalGuidance,
      roll: normalized,
      dice: percentileDice(normalized),
      title: built.title,
      description: built.description,
      groups: built.groups,
      subrolls,
      gmNotes: [...(zoneNote ? [zoneNote] : []), ...built.gmNotes],
      warnings: built.warnings,
      createdAt: new Date().toISOString(),
    };
  };

  return resolve(options.percentile ?? rollPercentile(random, options.zone, regionalGuidance), 0);
}

/** Rebuild one encounter with a single secondary die rerolled and all other resolved choices retained. */
export function rerollRandomEncounterSubroll(
  result: RandomEncounterResult,
  subrollId: string,
  random: () => number = Math.random,
): RandomEncounterResult {
  const target = result.subrolls.find((candidate) => candidate.id === subrollId);
  if (!target) return result;

  const nextRoll = target.die === '1d6'
    ? d6From(random)
    : target.die === '1d10'
      ? d10From(random)
      : d100From(random, result.zone, result.regionalGuidance);
  const subrollOverrides = Object.fromEntries(result.subrolls.map((subroll) => [subroll.id, subroll.roll]));
  subrollOverrides[target.id] = nextRoll;

  const rebuilt = rollRandomEncounter({
    period: result.period,
    zone: result.zone,
    partySize: result.partySize,
    percentile: result.roll,
    regionalGuidance: result.regionalGuidance,
    random,
    subrollOverrides,
  });

  return {
    ...rebuilt,
    id: result.id,
    createdAt: result.createdAt,
    groups: preserveGroupEdits(result.groups, rebuilt.groups),
  };
}

function mergePatch(base: OfficialNpcPatch | undefined, extra: OfficialNpcPatch | undefined): OfficialNpcPatch | undefined {
  if (!base) return extra;
  if (!extra) return base;
  return {
    ...base,
    ...extra,
    armor: extra.armor === undefined ? base.armor : extra.armor,
    replaceWeapons: [...(base.replaceWeapons ?? []), ...(extra.replaceWeapons ?? [])],
    removeWeapons: [...(base.removeWeapons ?? []), ...(extra.removeWeapons ?? [])],
    addWeapons: [...(base.addWeapons ?? []), ...(extra.addWeapons ?? [])],
    setSkills: { ...(base.setSkills ?? {}), ...(extra.setSkills ?? {}) },
    removeSkills: [...(base.removeSkills ?? []), ...(extra.removeSkills ?? [])],
    addGear: [...(base.addGear ?? []), ...(extra.addGear ?? [])],
    removeGear: [...(base.removeGear ?? []), ...(extra.removeGear ?? [])],
    addCyberware: [...(base.addCyberware ?? []), ...(extra.addCyberware ?? [])],
    removeCyberware: [...(base.removeCyberware ?? []), ...(extra.removeCyberware ?? [])],
    addPrograms: [...(base.addPrograms ?? []), ...(extra.addPrograms ?? [])],
    specialRules: [...(base.specialRules ?? []), ...(extra.specialRules ?? [])],
    modifications: [...(base.modifications ?? []), ...(extra.modifications ?? [])],
    sourceWarnings: [...(base.sourceWarnings ?? []), ...(extra.sourceWarnings ?? [])],
  };
}

export function materializeRandomEncounter(result: RandomEncounterResult, referenceEntries: readonly CatalogEntry[] = []): MaterializedRandomEncounter {
  const combatants: EncounterCombatant[] = [];
  const unavailable: string[] = [];
  const warnings = [...result.warnings];

  for (const entry of result.groups) {
    if (entry.count <= 0) continue;
    const selectedLoadout = entry.loadoutOptions?.find((option) => option.id === entry.selectedLoadoutId);
    if (entry.loadoutOptions?.length && !selectedLoadout) {
      unavailable.push(`${entry.label}: select an official weapon package before adding the encounter`);
      continue;
    }
    if (!entry.templateId) {
      const missing = entry.missingStatBlock;
      unavailable.push(`${entry.label}: ${missing?.name ?? 'missing stat block'}${missing?.source ? ` (${missing.source})` : ''}`);
      continue;
    }
    for (let index = 0; index < entry.count; index += 1) {
      const rosterLabel = entry.teamLabel ? `${entry.teamLabel} · ${entry.label}` : entry.label;
      const numberedName = entry.count > 1 ? `${rosterLabel} ${index + 1}` : rosterLabel;
      const patch = mergePatch(mergePatch(entry.patch, selectedLoadout?.patch), entry.instancePatches?.[index]);
      const combatant = createOfficialCombatant(entry.templateId, {
        name: numberedName,
        side: entry.side,
        patch,
        referenceEntries,
        notes: [entry.notes, `Random encounter ${result.roll.toString().padStart(2, '0')} · ${result.title}`].filter(Boolean).join('\n'),
      });
      combatant.teamLabel = entry.teamLabel;
      const mechanicsMissing = combatant.attacks.filter((attack) => !attack.damage).map((attack) => attack.name);
      if (mechanicsMissing.length) unavailable.push(`${numberedName}: missing weapon mechanics for ${mechanicsMissing.join(', ')}`);
      combatants.push(combatant);
    }
  }

  return { combatants, unavailable: [...new Set(unavailable)], warnings: [...new Set(warnings)] };
}

export function encounterTableCoverage(period: EncounterPeriod): number[] {
  const coverage = new Set<number>();
  for (const entry of TABLES[period]) for (let value = entry.min; value <= entry.max; value += 1) coverage.add(value);
  return [...coverage].sort((a, b) => a - b);
}
