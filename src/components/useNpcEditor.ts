import { useCallback, useRef, useState } from 'preact/hooks';
import type { CatalogEntry } from '../content/types';
import { createBlankManualView, previewManualNpcView, rebuildManualNpcView } from '../engine/builder';
import { loadCatalog } from '../engine/catalog';
import type { IdentityRerollField } from '../engine/refine';
import type { Catalog, GeneratedNpcView, Npc, NpcSection } from '../engine/types';

/**
 * A reroll in progress, used to label the busy control. Section rerolls replace
 * a whole block; `identity:*` rerolls replace a single identity field.
 */
export type RerollTarget = NpcSection | `identity:${IdentityRerollField}`;

interface EditorSession {
  /** The view to restore on Cancel; null when the draft started from a blank sheet. */
  original: GeneratedNpcView | null;
  draft: GeneratedNpcView;
  catalog: Catalog;
}

export interface NpcEditor {
  draft: GeneratedNpcView | null;
  editing: boolean;
  opening: boolean;
  rerolling: RerollTarget | null;
  error: string | null;
  catalog: Catalog | null;
  open: (view: GeneratedNpcView) => Promise<void>;
  openBlank: () => Promise<void>;
  updateNpc: (mutate: (npc: Npc) => void) => void;
  replaceNpc: (npc: Npc) => void;
  setRank: (rank: string) => void;
  setRole: (role: string) => void;
  reroll: (section: NpcSection) => void;
  rerollIdentity: (field: IdentityRerollField) => void;
  cancel: () => void;
  apply: () => void;
}

export interface NpcEditorHost {
  referenceEntries: readonly CatalogEntry[];
  /** Runs a generator request and resolves with the resulting view. */
  requestReroll: (message: object) => Promise<GeneratedNpcView>;
  /** Called with the finished view when the user applies the edit. */
  onApply: (view: GeneratedNpcView) => void;
  /** Called on cancel with the view the session started from, if any. */
  onCancel: (restored: GeneratedNpcView | null) => void;
}

function randomSeed(): number {
  const seed = new Uint32Array(1);
  crypto.getRandomValues(seed);
  return seed[0] || 1;
}

/**
 * Owns the single NPC editing session.
 *
 * Editing is a draft on top of the displayed NPC: every change recalculates the
 * complete derived view synchronously, so the sheet the user is looking at *is*
 * the preview. Nothing is committed until Apply, and Cancel restores the view
 * the session started from. Recalculation needs the generator catalog on the
 * main thread; the worker already fetched those files, so this is a parse of
 * cached responses rather than a second download.
 */
export function useNpcEditor({ referenceEntries, requestReroll, onApply, onCancel }: NpcEditorHost): NpcEditor {
  // The session is mirrored in a ref because edit handlers fire from input
  // events that may run several times before a render lands, and each one has
  // to build on the previous draft rather than the one its closure captured.
  const sessionRef = useRef<EditorSession | null>(null);
  const [session, setSession] = useState<EditorSession | null>(null);
  const [opening, setOpening] = useState(false);
  const [rerolling, setRerolling] = useState<RerollTarget | null>(null);
  const [error, setError] = useState<string | null>(null);

  const commitSession = useCallback((next: EditorSession | null) => {
    sessionRef.current = next;
    setSession(next);
  }, []);

  const start = useCallback(async (build: (catalog: Catalog) => EditorSession) => {
    setOpening(true);
    setError(null);
    try {
      commitSession(build(await loadCatalog()));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setOpening(false);
    }
  }, [commitSession]);

  const open = useCallback(
    (view: GeneratedNpcView) => start((catalog) => ({ original: view, draft: view, catalog })),
    [start],
  );

  const openBlank = useCallback(
    () => start((catalog) => ({
      original: null,
      draft: createBlankManualView(catalog, referenceEntries),
      catalog,
    })),
    [start, referenceEntries],
  );

  const preview = useCallback((npc: Npc, rankName: string, roleName: string) => {
    const active = sessionRef.current;
    if (!active || rerolling) return;
    try {
      const draft = previewManualNpcView(active.draft, npc, rankName, roleName, active.catalog, referenceEntries);
      commitSession({ ...active, draft });
      setError(null);
    } catch (previewError) {
      setError(previewError instanceof Error ? previewError.message : String(previewError));
    }
  }, [commitSession, referenceEntries, rerolling]);

  const updateNpc = useCallback((mutate: (npc: Npc) => void) => {
    const active = sessionRef.current;
    if (!active) return;
    const npc = structuredClone(active.draft.npc);
    mutate(npc);
    preview(npc, active.draft.rank.name, active.draft.role.name);
  }, [preview]);

  const replaceNpc = useCallback((npc: Npc) => {
    const active = sessionRef.current;
    if (!active) return;
    preview(npc, active.draft.rank.name, active.draft.role.name);
  }, [preview]);

  const setRank = useCallback((rank: string) => {
    const active = sessionRef.current;
    if (!active) return;
    preview(active.draft.npc, rank, active.draft.role.name);
  }, [preview]);

  const setRole = useCallback((role: string) => {
    const active = sessionRef.current;
    if (!active) return;
    preview(active.draft.npc, active.draft.rank.name, role);
  }, [preview]);

  const runReroll = useCallback((target: RerollTarget, message: (draft: GeneratedNpcView) => object) => {
    const active = sessionRef.current;
    if (!active || rerolling) return;
    setError(null);
    setRerolling(target);
    void requestReroll(message(active.draft))
      .then((draft) => {
        const current = sessionRef.current;
        if (current) commitSession({ ...current, draft });
      })
      .catch((rerollError: unknown) => {
        setError(rerollError instanceof Error ? rerollError.message : String(rerollError));
      })
      .finally(() => setRerolling(null));
  }, [commitSession, rerolling, requestReroll]);

  const reroll = useCallback((section: NpcSection) => {
    runReroll(section, (draft) => ({
      type: 'reroll',
      current: draft,
      options: draft.options,
      section,
      seed: randomSeed(),
    }));
  }, [runReroll]);

  const rerollIdentity = useCallback((field: IdentityRerollField) => {
    runReroll(`identity:${field}`, (draft) => ({
      type: 'reroll-identity-field',
      current: draft,
      options: draft.options,
      field,
      seed: randomSeed(),
    }));
  }, [runReroll]);

  const cancel = useCallback(() => {
    const active = sessionRef.current;
    if (!active || rerolling) return;
    onCancel(active.original);
    setError(null);
    commitSession(null);
  }, [commitSession, onCancel, rerolling]);

  const apply = useCallback(() => {
    const active = sessionRef.current;
    if (!active || rerolling) return;
    // Rebuild from the draft rather than the original so rerolls performed
    // during the session stay in the revision history alongside the edit.
    const finalView = rebuildManualNpcView(
      active.draft,
      active.draft.npc,
      active.draft.rank.name,
      active.draft.role.name,
      active.catalog,
      referenceEntries,
    );
    onApply(finalView);
    setError(null);
    commitSession(null);
  }, [commitSession, onApply, referenceEntries, rerolling]);

  return {
    draft: session?.draft ?? null,
    editing: Boolean(session),
    opening,
    rerolling,
    error,
    catalog: session?.catalog ?? null,
    open,
    openBlank,
    updateNpc,
    replaceNpc,
    setRank,
    setRole,
    reroll,
    rerollIdentity,
    cancel,
    apply,
  };
}
