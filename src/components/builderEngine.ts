import { buildReferenceCatalog } from '../content/catalog';
import type { CatalogEntry } from '../content/types';
import { loadCatalog } from '../engine/catalog';
import type { Catalog } from '../engine/types';

export interface BuilderEngine {
  catalog: Catalog;
  referenceEntries: readonly CatalogEntry[];
}

let builderEnginePromise: Promise<BuilderEngine> | null = null;

export function loadBuilderEngine(): Promise<BuilderEngine> {
  builderEnginePromise ??= loadCatalog().then(async (catalog) => {
    const reference = await buildReferenceCatalog(catalog);
    return { catalog, referenceEntries: reference.entries };
  });
  return builderEnginePromise;
}
