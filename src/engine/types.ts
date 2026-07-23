export const STAT_NAMES = ['INT', 'REF', 'DEX', 'TECH', 'COOL', 'WILL', 'LUCK', 'MOVE', 'BODY', 'EMP'] as const;
export type StatName = (typeof STAT_NAMES)[number];

export const SKILL_TYPES = [
  'awareness', 'body', 'control', 'education', 'fighting', 'performance', 'ranged_weapon', 'social', 'technique',
] as const;
export type SkillType = (typeof SKILL_TYPES)[number];

export type ItemType = 'armor' | 'weapon' | 'cyberware' | 'ammo' | 'equipment' | 'drug' | 'junk';
export type ItemQuality = 'poor' | 'standard' | 'excellent';
export type TraumaTeamStatus = 'NONE' | 'SILVER' | 'EXECUTIVE';

export interface NormalDistributionData {
  mean: number;
  standard_deviation: number;
}

export interface ModifierData {
  name: string;
  simple?: number;
  complicated?: string[];
}

export interface ItemData {
  name?: string;
  type?: ItemType;
  price?: number;
  default_hidden?: boolean;
  modifier_applying_priority?: number;
  unique_tags?: string[];
  tags?: string[];
  modifiers?: ModifierData[];
  quality?: ItemQuality | null;
  container_capacity?: number;
  size_in_container?: number;
  required_containers?: string[];
  max_equipped_items?: number;
  armor_class?: number | null;
  damage?: string | null;
  rate_of_fire?: number | null;
  magazine?: number | null;
  ammo_types?: string[];
  skill?: string | null;
  max_humanity_loss?: number;
  must_be_paired?: boolean;
  paired_container?: boolean;
  required_cyberware?: string[];
  required_condition?: string[];
  possible_names?: string[];
}

export interface Item extends Required<Omit<ItemData,
  'quality' | 'armor_class' | 'damage' | 'rate_of_fire' | 'magazine' | 'skill' | 'possible_names'>> {
  id: string;
  creationTime: number;
  quality: ItemQuality | null;
  armor_class: number | null;
  damage: string | null;
  rate_of_fire: number | null;
  magazine: number | null;
  skill: string | null;
  possible_names: string[];
}

export interface SkillData {
  link: StatName;
  type: SkillType;
}

export interface Skill extends SkillData {
  name: string;
}

export interface RoleData {
  name: string;
  skills?: Record<string, number>;
  preferred_cyberware?: string[];
  preferred_primary_weapons?: string[];
  preferred_secondary_weapons?: string[];
  preferred_ammo?: string[];
  preferred_armor_class?: number;
  preferred_drugs?: string[];
  preferred_equipment?: string[];
  min_empathy?: number;
  martial_arts_probability?: number;
}

export interface Role extends Required<RoleData> {}

export interface RankData {
  name: string;
  min_items_quality?: ItemQuality;
  items_budget?: Partial<Record<ItemType, NormalDistributionData>>;
  items_num_budget?: Partial<Record<ItemType, NormalDistributionData>>;
  stats_budget?: NormalDistributionData;
  skills_budget?: NormalDistributionData;
  pocket_money?: NormalDistributionData;
  trauma_team_status_weights?: number[];
  container_selection?: NormalDistributionData;
}

export interface Rank extends Required<RankData> {
  rankNumber: number;
}

export interface GenerationRules {
  allow_non_basic_ammo: boolean;
  allow_grenades: boolean;
  allow_armor: boolean;
  allow_cyberware: boolean;
  allow_borgware: boolean;
  allow_drugs: boolean;
  allow_equipment: boolean;
  allow_money: boolean;
  allow_junk: boolean;
  allow_melee_weapon: boolean;
  allow_ranged_weapon: boolean;
  allow_martial_arts: boolean;
}

export interface GenerateOptions extends GenerationRules {
  rank: string;
  role: string;
  nationality: string | null;
  seed: number;
  flat: boolean;
  model_id: string | null;
  model_api_key: string | null;
  model_base_url: string | null;
  model_language: string;
}

export interface InventoryNode {
  item: Item;
  children: InventoryNode[];
}

export interface InventoryEntry {
  item: Item;
  amount: number;
}

export interface ModifierSource {
  itemName: string;
  value: number;
}

export interface StatSkillValue {
  value: number;
  totalModifier: number;
  modifiers: ModifierSource[];
}

export interface Npc {
  sex: boolean;
  nationality: string | null;
  age: number;
  name: string;
  surname: string;
  description: string;
  stats: Map<StatName, number>;
  skills: Map<string, { skill: Skill; level: number }>;
  cyberware: InventoryNode;
  armor: Item[];
  weapons: Item[];
  inventory: Map<string, InventoryEntry>;
  traumaTeamStatus: TraumaTeamStatus;
}

export interface AmmoModificationData {
  price: number;
  types: string[];
}

export interface StatsCatalog {
  streetrat_stats: Record<string, number[][]>;
}

export interface NationalityWeights {
  populations: Record<string, number>;
}

export interface Catalog {
  ranks: RankData[];
  roles: RoleData[];
  stats: StatsCatalog;
  skills: Record<string, SkillData>;
  weaponSkills: Record<string, string>;
  nationalityWeights: NationalityWeights;
  descriptionPrompt: string;
  ammo: Record<string, AmmoModificationData>;
  armor: ItemData[];
  drugs: ItemData[];
  equipment: ItemData[];
  junk: ItemData[];
  weapons: ItemData[];
  cyberware: ItemData[];
}

export interface FoundryItem {
  name: string;
  quality: ItemQuality | null;
}

export interface FoundryInventoryNode {
  item: FoundryItem;
  children: FoundryInventoryNode[];
}

export interface FoundryNpc {
  sex: boolean;
  nationality: string | null;
  age: number;
  name: string;
  surname: string;
  description: string;
  stats: Record<StatName, number>;
  skills: Record<string, number>;
  cyberware: FoundryInventoryNode | null;
  armor: FoundryItem[];
  weapons: FoundryItem[];
  inventory: Array<{ item: FoundryItem; amount: number }>;
  trauma_team_status: TraumaTeamStatus;
}

export interface ViewItem {
  name: string;
  display: string;
  type: ItemType;
  price: number;
  quality: ItemQuality | null;
  armorClass: number | null;
  damage: string | null;
  rateOfFire: number | null;
  magazine: number | null;
  ammoTypes: string[];
  skill: string | null;
  tags: string[];
  uniqueTags: string[];
}


export type ValidationSeverity = 'info' | 'warning' | 'error';

export interface ValidationIssue {
  code: string;
  severity: ValidationSeverity;
  message: string;
  subject?: string;
  suggestedAction?: string;
}

export interface WeaponCombatSummary {
  name: string;
  skill: string | null;
  attackBase: number | null;
  autofireBase: number | null;
  damage: string | null;
  rateOfFire: number | null;
  magazine: number | null;
  ammoTypes: string[];
  explanation: string;
}

export interface CombatSummary {
  initiative: number;
  deathSave: number;
  hitPoints: number;
  seriouslyWounded: number | null;
  armor: Array<{ name: string; stoppingPower: number | null }>;
  attacks: WeaponCombatSummary[];
}

export type NpcSection = 'identity' | 'description' | 'stats' | 'skills' | 'cyberware' | 'weapons' | 'armor' | 'inventory' | 'loadout';

export type NpcCommand =
  | { type: 'set-stat'; stat: StatName; value: number }
  | { type: 'set-skill'; skill: string; value: number };

export interface GenerationRevision {
  section: NpcSection | 'edit';
  seed?: number;
  command?: string;
  createdAt: string;
}

export interface GeneratedItemExplanation {
  name: string;
  type: ItemType;
  reason: string;
  catalogId?: string;
}

export interface GeneratedNpcView {
  npc: Npc;
  rank: Rank;
  role: Role;
  options: GenerateOptions;
  seed: number;
  command: string;
  text: string;
  foundry: FoundryNpc;
  totalPrice: number;
  stats: Array<{ name: StatName; base: number; modifier: number; total: number; sources: ModifierSource[] }>;
  skills: Array<{ name: string; type: SkillType; link: StatName; base: number; modifier: number; total: number; display: string }>;
  hp: { current: number; max: number; seriouslyWounded: number | null; painEditor: boolean };
  conditions: Array<{ label: string; value: boolean; source: string | null }>;
  actions: string[];
  abilities: string[];
  profileSummary: string;
  combat: CombatSummary;
  validation: ValidationIssue[];
  itemExplanations: GeneratedItemExplanation[];
  revisions: GenerationRevision[];
}

export interface GenerationProgress {
  stage: string;
  value: number;
}

export const DEFAULT_RULES: GenerationRules = {
  allow_non_basic_ammo: true,
  allow_grenades: true,
  allow_armor: true,
  allow_cyberware: true,
  allow_borgware: false,
  allow_drugs: true,
  allow_equipment: true,
  allow_money: true,
  allow_junk: true,
  allow_melee_weapon: true,
  allow_ranged_weapon: true,
  allow_martial_arts: true,
};

export const DEFAULT_OPTIONS: GenerateOptions = {
  rank: 'captain',
  role: 'solo',
  nationality: null,
  seed: 0,
  flat: false,
  model_id: null,
  model_api_key: null,
  model_base_url: null,
  model_language: 'English',
  ...DEFAULT_RULES,
};
