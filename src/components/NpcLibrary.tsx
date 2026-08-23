import { useState } from 'preact/hooks';
import { buildReferenceCatalog } from '../content/catalog';
import type { CatalogEntry } from '../content/types';
import { createBlankManualView } from '../engine/builder';
import { loadCatalog } from '../engine/catalog';
import type { Catalog, GeneratedNpcView } from '../engine/types';
import { saveNpc, type SavedNpcRecord } from '../storage';
import { NpcBuilder } from './NpcBuilder';

interface BuilderEngine {
  catalog: Catalog;
  referenceEntries: readonly CatalogEntry[];
}

interface BuilderSession extends BuilderEngine {
  record: SavedNpcRecord | null;
  view: GeneratedNpcView;
}

let builderEnginePromise: Promise<BuilderEngine> | null = null;

function loadBuilderEngine(): Promise<BuilderEngine> {
  builderEnginePromise ??= loadCatalog().then(async (catalog) => {
    const reference = await buildReferenceCatalog(catalog);
    return { catalog, referenceEntries: reference.entries };
  });
  return builderEnginePromise;
}

export function NpcLibrary({
  records,
  error,
  onOpen,
  onDelete,
}: {
  records: readonly SavedNpcRecord[];
  error: string | null;
  onOpen: (record: SavedNpcRecord) => void;
  onDelete: (record: SavedNpcRecord) => void;
}) {
  const [builder, setBuilder] = useState<BuilderSession | null>(null);
  const [builderBusy, setBuilderBusy] = useState(false);
  const [builderError, setBuilderError] = useState<string | null>(null);

  const openBuilder = async (record: SavedNpcRecord | null) => {
    if (builderBusy) return;
    setBuilderBusy(true);
    setBuilderError(null);
    try {
      const engine = await loadBuilderEngine();
      setBuilder({
        ...engine,
        record,
        view: record?.view ?? createBlankManualView(engine.catalog, engine.referenceEntries),
      });
    } catch (loadError) {
      setBuilderError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setBuilderBusy(false);
    }
  };

  const applyBuilder = async (nextView: GeneratedNpcView) => {
    if (!builder) return;
    if (builder.record) {
      const saved = await saveNpc(nextView, builder.record.id);
      // Keep the parent's existing record object current without changing the
      // library callback contract. The next parent render sees the updated view.
      Object.assign(builder.record, saved);
      onOpen(saved);
      return;
    }

    // A brand-new manual NPC opens in the normal workspace first. From there the
    // existing Save action persists it and updates the parent library state just
    // like a generated NPC, avoiding a second persistence path in App.
    onOpen({
      id: `manual-${Date.now()}`,
      label: `${nextView.npc.name} ${nextView.npc.surname}`,
      savedAt: new Date().toISOString(),
      view: nextView,
    });
  };

  if (builder) {
    return (
      <section class="library panel">
        <NpcBuilder
          view={builder.view}
          catalog={builder.catalog}
          referenceEntries={builder.referenceEntries}
          onApply={applyBuilder}
          onCancel={() => setBuilder(null)}
        />
      </section>
    );
  }

  return (
    <section class="library panel">
      <header class="reference-hero">
        <div>
          <span class="kicker">Browser-local persistence & manual construction</span>
          <h2>NPC library</h2>
          <p>Saved operatives stay in this browser through IndexedDB. Generated NPCs can be opened in the full manual builder, and new NPCs can be built from a blank sheet without random generation. API keys are removed before storage.</p>
          <div class="hero-actions">
            <button type="button" class="primary-action" disabled={builderBusy} onClick={() => void openBuilder(null)}>{builderBusy ? 'Loading builder…' : 'New manual NPC'}</button>
          </div>
        </div>
        <div class="reference-stats"><strong>{records.length}</strong><span>saved NPCs</span></div>
      </header>
      {(error || builderError) && <div class="content-notice error" role="alert"><strong>Library unavailable</strong><span>{builderError ?? error}</span></div>}
      <div class="library-grid">
        {records.map((record) => (
          <article key={record.id} class="library-card">
            <span>{new Date(record.savedAt).toLocaleString()}</span>
            <h3>{record.label}</h3>
            <p>{record.view.rank.name} · {record.view.role.name} · seed {record.view.seed}</p>
            <div>
              <button type="button" onClick={() => onOpen(record)}>Open</button>
              <button type="button" disabled={builderBusy} onClick={() => void openBuilder(record)}>Edit</button>
              <button type="button" class="danger" onClick={() => onDelete(record)}>Delete</button>
            </div>
          </article>
        ))}
        {records.length === 0 && !error && <div class="reference-empty"><strong>No saved NPCs</strong><p>Generate an operative and use Save, or start with New manual NPC to build one without random generation.</p></div>}
      </div>
    </section>
  );
}
