import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { CatalogEntry } from '../content/types';
import type { Catalog, GeneratedNpcView } from '../engine/types';
import { NpcBuilder } from './NpcBuilder';
import { loadBuilderEngine } from './builderEngine';
import {
  applyCurrentNpc,
  getCurrentNpc,
  installNpcWorkerBridge,
  subscribeCurrentNpc,
} from './npcEditorBridge';
import './NpcEditorShell.css';

interface EditorSession {
  view: GeneratedNpcView;
  catalog: Catalog;
  referenceEntries: readonly CatalogEntry[];
}

export function NpcEditorShell({ children }: { children: ComponentChildren }) {
  installNpcWorkerBridge();
  const [current, setCurrent] = useState<GeneratedNpcView | null>(getCurrentNpc);
  const [session, setSession] = useState<EditorSession | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => subscribeCurrentNpc(setCurrent), []);

  const openEditor = async () => {
    if (!current || loading) return;
    setLoading(true);
    setLoadError(null);
    try {
      const engine = await loadBuilderEngine();
      setSession({ ...engine, view: current });
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  };

  return <>
    {children}
    {current && !session && (
      <div class="npc-editor-fab-wrap">
        {loadError && <div class="npc-editor-fab-error" role="alert">{loadError}</div>}
        <button type="button" class="npc-editor-fab" disabled={loading} onClick={() => void openEditor()}>
          <span>Edit NPC</span>
          <small>{current.npc.name} {current.npc.surname}</small>
        </button>
      </div>
    )}
    {session && (
      <div class="npc-editor-overlay" role="dialog" aria-modal="true" aria-label="Edit current NPC">
        <div class="npc-editor-modal panel">
          <NpcBuilder
            view={session.view}
            catalog={session.catalog}
            referenceEntries={session.referenceEntries}
            onCancel={() => setSession(null)}
            onApply={(next) => {
              applyCurrentNpc(next);
              setSession(null);
            }}
          />
        </div>
      </div>
    )}
  </>;
}
