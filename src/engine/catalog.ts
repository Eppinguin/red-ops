import type { Catalog, ItemData, NationalityWeights } from './types';
import upstreamManifest from '../../upstream-manifest.json';

export const UPSTREAM_REPOSITORY = upstreamManifest.repository;
export const UPSTREAM_COMMIT = upstreamManifest.commit;
const PROJECT_ROOT = upstreamManifest.root;
export const CONFIG_PATHS = upstreamManifest.paths;

export const PYTHON_FAKER_LOCALES = [
  'en_US','es_MX','ja_JP','zh_CN','ru_RU','vi_VN','es_CO','pt_BR','ko_KR','id_ID','en_AU','es_AR','de_DE','en_GB',
  'en_PH','fil_PH','tl_PH','es_CL','en_CA','es_CA','fr_CA','en_PK','fr_FR','uk_UA','it_IT','es_ES','pl_PL','en_IN',
  'gu_IN','hi_IN','mr_IN','or_IN','ta_IN','en_NZ','tr_TR','en_TH','th_TH','nl_NL','ar_EG','zu_ZA','am_ET','pt_PT',
  'bn_BD','en_BD','ne_NP','ro_RO','fa_IR','sv_SE','de_AT','en_KE','cs_CZ','uz_UZ','el_GR','tw_GH','hu_HU','no_NO',
  'ar_SA','fi_FI','bg_BG','az_AZ','ar_AE','he_IL','sk_SK','fr_BE','nl_BE','hr_HR','ka_GE','ar_JO','en_NG','ha_NG',
  'ig_NG','ng_NG','yo_NG','en_IE','ga_IE','lt_LT','hy_AM','da_DK','dk_DK','el_CY','ar_DZ','fr_DZ','lv_LV','sq_AL',
  'de_CH','fr_CH','it_CH','sl_SI','et_EE','ar_PS','mk_MK','mt_MT','is_IS','bs_BA','sr_BA','ar_BH','de_LU','lb_LU','de_LI',
] as const;

function rawUrl(path: string): string {
  return `https://raw.githubusercontent.com/${UPSTREAM_REPOSITORY}/${UPSTREAM_COMMIT}/${PROJECT_ROOT}/${path}`;
}

async function fetchText(path: string): Promise<string> {
  const local = await fetch(`/upstream/${path}`, { cache: 'no-cache' });
  if (local.ok) {
    const text = await local.text();
    if (!text.trimStart().startsWith('<!doctype html')) return text;
  }

  const remote = await fetch(rawUrl(path), { cache: 'force-cache' });
  if (!remote.ok) throw new Error(`Could not load upstream ${path}: HTTP ${remote.status}`);
  return remote.text();
}

async function fetchJson<T>(path: string): Promise<T> {
  return JSON.parse(await fetchText(path)) as T;
}

let catalogPromise: Promise<Catalog> | null = null;

export function loadCatalog(onProgress?: (message: string, value: number) => void): Promise<Catalog> {
  catalogPromise ??= (async () => {
    const results = new Map<string, unknown>();
    let completed = 0;
    const concurrency = 6;

    for (let offset = 0; offset < CONFIG_PATHS.length; offset += concurrency) {
      const batch = CONFIG_PATHS.slice(offset, offset + concurrency);
      await Promise.all(batch.map(async (path) => {
        const value = path.endsWith('.json') ? await fetchJson<unknown>(path) : await fetchText(path);
        results.set(path, value);
        completed += 1;
        onProgress?.(`Loading pinned catalog ${completed}/${CONFIG_PATHS.length}`, completed / CONFIG_PATHS.length);
      }));
    }

    const cyberware = CONFIG_PATHS
      .filter((path) => path.includes('/cyberware/') && path.endsWith('.json'))
      .flatMap((path) => results.get(path) as ItemData[]);

    return {
      ranks: results.get('configs/ranks.json') as Catalog['ranks'],
      roles: results.get('configs/roles.json') as Catalog['roles'],
      stats: results.get('configs/stats.json') as Catalog['stats'],
      skills: results.get('configs/skills.json') as Catalog['skills'],
      weaponSkills: results.get('configs/weapon_skills.json') as Catalog['weaponSkills'],
      nationalityWeights: results.get('configs/nationality_weights.json') as NationalityWeights,
      descriptionPrompt: (results.get('configs/description_prompt.md') as string).trim(),
      ammo: results.get('configs/items/ammo.json') as Catalog['ammo'],
      armor: results.get('configs/items/armor.json') as ItemData[],
      drugs: results.get('configs/items/drugs.json') as ItemData[],
      equipment: results.get('configs/items/equipment.json') as ItemData[],
      junk: results.get('configs/items/junk.json') as ItemData[],
      weapons: results.get('configs/items/weapon.json') as ItemData[],
      cyberware,
    };
  })();
  return catalogPromise;
}

export function resetCatalogCache(): void {
  catalogPromise = null;
}
