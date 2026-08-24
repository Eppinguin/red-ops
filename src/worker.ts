/// <reference lib="webworker" />
import { buildReferenceCatalog } from './content/catalog';
import type { ReferenceCatalogData } from './content/types';
import { loadCatalog, PYTHON_FAKER_LOCALES, UPSTREAM_COMMIT } from './engine/catalog';
import { createGeneratedView } from './engine/format';
import { generateNpc } from './engine/generator';
import { generateAiDescription } from './engine/identity';
import { createIdentityFieldRerolledView, createRerolledView, type IdentityRerollField } from './engine/refine';
import type { Catalog, GenerateOptions, GeneratedNpcView, NpcSection } from './engine/types';

const scope = self as unknown as DedicatedWorkerGlobalScope;
let loadedCatalog: Catalog | null = null;
let referenceCatalog: ReferenceCatalogData | null = null;

async function ensureCatalogs(): Promise<{ catalog: Catalog; reference: ReferenceCatalogData }> {
  loadedCatalog ??= await loadCatalog();
  referenceCatalog ??= await buildReferenceCatalog(loadedCatalog);
  return { catalog: loadedCatalog, reference: referenceCatalog };
}

async function boot(): Promise<void> {
  try {
    const catalog = await loadCatalog((message, value) => {
      scope.postMessage({ type: 'boot-progress', message, value: value * 0.8 });
    });
    loadedCatalog = catalog;
    scope.postMessage({ type: 'boot-progress', message: 'Building canonical reference catalog', value: 0.85 });
    referenceCatalog = await buildReferenceCatalog(catalog);
    scope.postMessage({
      type: 'ready',
      meta: {
        ranks: catalog.ranks.map((rank) => rank.name),
        roles: catalog.roles.map((role) => role.name),
        nationalities: PYTHON_FAKER_LOCALES,
        commit: UPSTREAM_COMMIT,
        referenceManifest: referenceCatalog.manifest,
        referenceEntries: referenceCatalog.entries,
        referenceConflicts: referenceCatalog.conflicts,
      },
    });
  } catch (error) {
    scope.postMessage({ type: 'fatal', error: error instanceof Error ? error.stack ?? error.message : String(error) });
  }
}

/**
 * `requestId` is echoed on the matching result so the page can route a reply to
 * the caller that asked for it. The editor uses it to keep a reroll aimed at a
 * draft from being mistaken for a new generation.
 */
type WorkerRequest = { requestId?: string } & (
  | { type: 'generate'; options: GenerateOptions }
  | { type: 'reroll'; options: GenerateOptions; current: GeneratedNpcView; section: NpcSection; seed: number }
  | { type: 'reroll-identity-field'; options: GenerateOptions; current: GeneratedNpcView; field: IdentityRerollField; seed: number }
);

scope.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const { requestId } = event.data;
  try {
    const { catalog, reference } = await ensureCatalogs();
    if (event.data.type === 'generate') {
      const core = await generateNpc(catalog, event.data.options, (progress) => {
        scope.postMessage({ type: 'generation-progress', progress });
      }, reference.entries);
      scope.postMessage({
        type: 'result',
        view: createGeneratedView(core, catalog, reference.entries),
        warning: core.warning,
        requestId,
      });
      return;
    }

    if (event.data.type === 'reroll-identity-field') {
      const { field, seed, current } = event.data;
      const candidateOptions: GenerateOptions = {
        ...current.options,
        rank: current.rank.name,
        role: current.role.name,
        nationality: field === 'nationality' ? null : current.npc.nationality,
        allow_lifepath: field === 'lifepath' ? true : current.options.allow_lifepath,
        seed,
        model_id: null,
        model_api_key: null,
        model_base_url: null,
      };
      const candidate = await generateNpc(catalog, candidateOptions, (progress) => {
        scope.postMessage({
          type: 'generation-progress',
          progress: { stage: `Rerolling ${field}: ${progress.stage}`, value: progress.value },
        });
      }, reference.entries);
      const view = createIdentityFieldRerolledView(current, candidate, field, catalog, reference.entries);
      scope.postMessage({ type: 'result', view, warning: candidate.warning, requestId });
      return;
    }

    if (event.data.type === 'reroll') {
      const { section, seed, current } = event.data;
      if (section === 'description') {
        scope.postMessage({ type: 'generation-progress', progress: { stage: 'Regenerating description', value: 0.5 } });
        const npc = structuredClone(current.npc);
        let warning: string | null = null;
        try {
          npc.description = await generateAiDescription(
            npc,
            current.rank,
            current.role,
            npc.nationality ?? 'unspecified',
            catalog,
            {
              ...current.options,
              model_id: event.data.options.model_id,
              model_api_key: event.data.options.model_api_key,
              model_base_url: event.data.options.model_base_url,
              model_language: event.data.options.model_language,
              rank: current.rank.name,
              role: current.role.name,
              seed,
            },
            seed,
            reference.entries,
          );
        } catch (error) {
          npc.description = '';
          warning = `AI description was not generated: ${error instanceof Error ? error.message : String(error)}`;
        }
        const candidate = {
          npc,
          rank: current.rank,
          role: current.role,
          options: { ...current.options, model_api_key: null },
          seed,
          warning,
        };
        const view = createRerolledView(current, candidate, section, catalog, reference.entries);
        scope.postMessage({ type: 'result', view, warning, requestId });
        return;
      }

      const candidateOptions: GenerateOptions = {
        ...current.options,
        rank: current.rank.name,
        role: current.role.name,
        nationality: current.npc.nationality,
        seed,
        model_id: null,
        model_api_key: null,
        model_base_url: null,
      };
      const candidate = await generateNpc(catalog, candidateOptions, (progress) => {
        scope.postMessage({
          type: 'generation-progress',
          progress: { stage: `Rerolling ${section}: ${progress.stage}`, value: progress.value },
        });
      }, reference.entries);
      const view = createRerolledView(current, candidate, section, catalog, reference.entries);
      scope.postMessage({ type: 'result', view, warning: candidate.warning, requestId });
      return;
    }

    throw new Error(`Unsupported generator request: ${JSON.stringify(event.data)}`);
  } catch (error) {
    scope.postMessage({
      type: 'generation-error',
      error: error instanceof Error ? error.stack ?? error.message : String(error),
      requestId,
    });
  }
};

void boot();
