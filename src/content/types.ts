import type { ItemQuality, ItemType, SkillType, StatName } from '../engine/types';

export type CatalogEntryType =
  | ItemType
  | 'skill'
  | 'clothing'
  | 'program'
  | 'cyberdeck'
  | 'upgrade'
  | 'role'
  | 'vehicle'
  | 'criticalInjury';

export type DataSource = 'generator' | 'foundry' | 'manual';

export interface DataProvenance {
  source: DataSource;
  field: string;
  repository?: string;
  ref?: string;
  originalId?: string;
  pack?: string;
}

export interface SourceReference {
  book?: string;
  page?: string;
  label?: string;
}

export interface PriceData {
  amount?: number;
  category?: string;
}

export interface InstallationData {
  capacity?: number;
  size?: number;
  allowedTypes: string[];
  requiredContainers: string[];
  requiredItems: string[];
}

export interface WeaponMechanics {
  kind: 'weapon';
  damage?: string;
  rateOfFire?: number;
  magazine?: number;
  skill?: string;
  ammoTypes: string[];
  quality?: ItemQuality | null;
  concealability?: string;
  hands?: number;
}

export interface ArmorMechanics {
  kind: 'armor';
  stoppingPower?: number;
  penalty?: number;
  locations: string[];
}

export interface CyberwareMechanics {
  kind: 'cyberware';
  humanityLoss?: number | string;
  foundational?: boolean;
  weapon?: WeaponMechanics;
  installation: InstallationData;
}

export interface SkillMechanics {
  kind: 'skill';
  linkedStat?: StatName;
  skillType?: SkillType;
  multiplier?: number;
}

export interface DrugEffectChange {
  key: string;
  mode: number | string;
  value: string;
}

export interface DrugActiveEffect {
  id: string;
  name: string;
  phase: 'primary' | 'secondary' | 'other';
  changes: DrugEffectChange[];
}

export interface DrugMechanics {
  kind: 'drug';
  usage?: string;
  duration?: string;
  primaryEffect?: string;
  secondaryEffect?: string;
  secondaryDv?: number;
  consumedEffect?: string;
  activeEffects: DrugActiveEffect[];
}

export interface GenericMechanics {
  kind: 'generic';
  electronic?: boolean;
  brand?: string;
  quantity?: number;
  installation?: InstallationData;
}

export type MechanicsSummary =
  | WeaponMechanics
  | ArmorMechanics
  | CyberwareMechanics
  | SkillMechanics
  | DrugMechanics
  | GenericMechanics;

export interface GeneratorMetadata {
  generatorName: string;
  generatorType: ItemType | 'skill';
  eligible: boolean;
  quality?: ItemQuality | null;
}

export interface FoundryReference {
  projectId: number;
  ref: string;
  pack?: string;
  documentId?: string;
  documentType?: string;
  img?: string;
}

export interface CatalogEntry {
  id: string;
  type: CatalogEntryType;
  name: string;
  aliases: string[];
  summary: string;
  usage?: string;
  mechanics: MechanicsSummary;
  price?: PriceData;
  source?: SourceReference;
  tags: string[];
  generator?: GeneratorMetadata;
  foundry?: FoundryReference;
  provenance: DataProvenance[];
}

export interface ReferenceCatalogManifest {
  schemaVersion: number;
  generatedAt: string;
  generator: {
    repository: string;
    commit: string;
  };
  foundry?: {
    projectId: number;
    repository: string;
    ref: string;
    commit?: string;
    itemCount: number;
    contentHash?: string;
  };
  entryCount: number;
  conflictCount: number;
}

export interface ReferenceCatalogData {
  manifest: ReferenceCatalogManifest;
  entries: CatalogEntry[];
  conflicts: CatalogConflict[];
}

export interface ManualCatalogMapping {
  generatorId: string;
  foundryId: string;
  aliases?: string[];
}

export interface ManualCatalogMappingFile {
  schemaVersion: number;
  mappings: ManualCatalogMapping[];
}

export interface CatalogConflict {
  entryId: string;
  field: string;
  generatorValue: unknown;
  foundryValue: unknown;
  resolution: 'generator' | 'foundry' | 'manual-review';
}
