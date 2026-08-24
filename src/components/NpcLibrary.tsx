import type { SavedNpcRecord } from '../storage';

export function NpcLibrary({
  records,
  error,
  busy,
  onOpen,
  onEdit,
  onCreate,
  onDelete,
}: {
  records: readonly SavedNpcRecord[];
  error: string | null;
  busy: boolean;
  onOpen: (record: SavedNpcRecord) => void;
  onEdit: (record: SavedNpcRecord) => void;
  onCreate: () => void;
  onDelete: (record: SavedNpcRecord) => void;
}) {
  return (
    <section class="library panel">
      <header class="reference-hero">
        <div>
          <span class="kicker">Browser-local persistence</span>
          <h2>NPC library</h2>
          <p>Saved operatives stay in this browser through IndexedDB. Opening or editing a record loads it onto the generator sheet, where the same editor handles generated and hand-built NPCs alike. API keys are removed before storage.</p>
          <div class="hero-actions">
            <button type="button" class="primary-action" disabled={busy} onClick={onCreate}>{busy ? 'Loading editor…' : 'New manual NPC'}</button>
          </div>
        </div>
        <div class="reference-stats"><strong>{records.length}</strong><span>saved NPCs</span></div>
      </header>
      {error && <div class="content-notice error" role="alert"><strong>Library unavailable</strong><span>{error}</span></div>}
      <div class="library-grid">
        {records.map((record) => (
          <article key={record.id} class="library-card">
            <span>{new Date(record.savedAt).toLocaleString()}</span>
            <h3>{record.label}</h3>
            <p>{record.view.rank.name} · {record.view.role.name} · seed {record.view.seed}</p>
            <div>
              <button type="button" onClick={() => onOpen(record)}>Open</button>
              <button type="button" disabled={busy} onClick={() => onEdit(record)}>Edit</button>
              <button type="button" class="danger" onClick={() => onDelete(record)}>Delete</button>
            </div>
          </article>
        ))}
        {records.length === 0 && !error && <div class="reference-empty"><strong>No saved NPCs</strong><p>Generate an operative and use Save, or start with New manual NPC to build one without random generation.</p></div>}
      </div>
    </section>
  );
}
