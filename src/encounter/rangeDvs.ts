export const RANGE_BANDS = [
  { id: '0-6m', label: '0–6 m' },
  { id: '7-12m', label: '7–12 m' },
  { id: '13-25m', label: '13–25 m' },
  { id: '26-50m', label: '26–50 m' },
  { id: '51-100m', label: '51–100 m' },
  { id: '101-200m', label: '101–200 m' },
  { id: '201-400m', label: '201–400 m' },
  { id: '401-800m', label: '401–800 m' },
] as const;

export type RangeBandId = (typeof RANGE_BANDS)[number]['id'];

export type RangeProfileId =
  | 'pistol'
  | 'smg'
  | 'shotgun-slug'
  | 'assault-rifle'
  | 'sniper-rifle'
  | 'bow-crossbow'
  | 'grenade-launcher'
  | 'rocket-launcher';

export interface RangeDvRow {
  id: RangeProfileId;
  label: string;
  values: Partial<Record<RangeBandId, number>>;
}

export const SINGLE_SHOT_DVS: readonly RangeDvRow[] = [
  { id: 'pistol', label: 'Pistol', values: { '0-6m': 13, '7-12m': 15, '13-25m': 20, '26-50m': 25, '51-100m': 30, '101-200m': 30 } },
  { id: 'smg', label: 'SMG', values: { '0-6m': 15, '7-12m': 13, '13-25m': 15, '26-50m': 20, '51-100m': 25, '101-200m': 25, '201-400m': 30 } },
  { id: 'shotgun-slug', label: 'Shotgun (Slug)', values: { '0-6m': 13, '7-12m': 15, '13-25m': 20, '26-50m': 25, '51-100m': 30, '101-200m': 35 } },
  { id: 'assault-rifle', label: 'Assault Rifle', values: { '0-6m': 17, '7-12m': 16, '13-25m': 15, '26-50m': 13, '51-100m': 15, '101-200m': 20, '201-400m': 25, '401-800m': 30 } },
  { id: 'sniper-rifle', label: 'Sniper Rifle', values: { '0-6m': 30, '7-12m': 25, '13-25m': 25, '26-50m': 20, '51-100m': 15, '101-200m': 16, '201-400m': 17, '401-800m': 20 } },
  { id: 'bow-crossbow', label: 'Bows/Crossbows', values: { '0-6m': 15, '7-12m': 13, '13-25m': 15, '26-50m': 17, '51-100m': 20, '101-200m': 22 } },
  { id: 'grenade-launcher', label: 'Grenade Launcher', values: { '0-6m': 16, '7-12m': 15, '13-25m': 15, '26-50m': 17, '51-100m': 20, '101-200m': 22, '201-400m': 25 } },
  { id: 'rocket-launcher', label: 'Rocket Launcher', values: { '0-6m': 17, '7-12m': 16, '13-25m': 15, '26-50m': 15, '51-100m': 20, '101-200m': 20, '201-400m': 25, '401-800m': 30 } },
] as const;

export const AUTOFIRE_CORE_DVS = [
  { id: 'smg', label: 'SMG', values: { '0-6m': 15, '7-12m': 13, '13-25m': 15, '26-50m': 20, '51-100m': 25 } },
  { id: 'assault-rifle', label: 'AR', values: { '0-6m': 17, '7-12m': 16, '13-25m': 15, '26-50m': 13, '51-100m': 15 } },
] as const;

export const AUTOFIRE_EDGERUNNERS_DVS = [
  { id: 'smg', label: 'SMG', values: { '0-6m': 20, '7-12m': 17, '13-25m': 20, '26-50m': 25, '51-100m': 30 } },
  { id: 'assault-rifle', label: 'AR', values: { '0-6m': 22, '7-12m': 20, '13-25m': 17, '26-50m': 20, '51-100m': 25 } },
] as const;

export const THROWN_WEAPON_DVS = [
  { label: '0–6 m', dv: 16 },
  { label: '7–25 m', dv: 15 },
] as const;

const PROFILE_BY_ID = new Map(SINGLE_SHOT_DVS.map((row) => [row.id, row]));
const RANGE_BAND_IDS = new Set<string>(RANGE_BANDS.map((band) => band.id));

export function isRangeBandId(value: unknown): value is RangeBandId {
  return typeof value === 'string' && RANGE_BAND_IDS.has(value);
}

export function isRangeProfileId(value: unknown): value is RangeProfileId {
  return typeof value === 'string' && PROFILE_BY_ID.has(value as RangeProfileId);
}

export function rangeProfileLabel(profile: RangeProfileId): string {
  return PROFILE_BY_ID.get(profile)?.label ?? profile;
}

export function rangeDv(profile: RangeProfileId | null, band: RangeBandId | null): number | null {
  if (!profile || !band) return null;
  return PROFILE_BY_ID.get(profile)?.values[band] ?? null;
}

export function validRangeBands(profile: RangeProfileId | null): Array<{ id: RangeBandId; label: string; dv: number }> {
  if (!profile) return [];
  const row = PROFILE_BY_ID.get(profile);
  if (!row) return [];
  return RANGE_BANDS.flatMap((band) => {
    const dv = row.values[band.id];
    return dv === undefined ? [] : [{ id: band.id, label: band.label, dv }];
  });
}

export function defaultRangeBand(profile: RangeProfileId | null): RangeBandId | null {
  return validRangeBands(profile)[0]?.id ?? null;
}

/**
 * Maps generator weapon names to the RED range-table row. The source catalog
 * does not expose a dedicated range-table key, so this intentionally uses a
 * small, reviewable mapping rather than scattering name checks through the UI.
 */
export function inferRangeProfile(name: string, skill: string, tags: readonly string[] = []): RangeProfileId | null {
  const value = `${name} ${skill} ${tags.join(' ')}`.toLowerCase();
  if (/grenade\s*launcher/.test(value)) return 'grenade-launcher';
  if (/rocket\s*launcher/.test(value)) return 'rocket-launcher';
  if (/sniper/.test(value)) return 'sniper-rifle';
  if (/assault\s*rifle|\b(ar)\b/.test(value)) return 'assault-rifle';
  if (/shotgun/.test(value)) return 'shotgun-slug';
  if (/submachine|\bsmg\b/.test(value)) return 'smg';
  if (/crossbow|\bbow\b|archery/.test(value)) return 'bow-crossbow';
  if (/pistol|handgun/.test(value)) return 'pistol';
  return null;
}
