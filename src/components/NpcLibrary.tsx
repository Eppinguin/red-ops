import type { SavedNpcRecord } from '../storage';

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
  return (
    <section class="library panel">
      <header class="reference-hero">
        <div>
          <span class="kicker">Browser-local persistence</span>
          <h2>NPC library</h2>
          <p>Saved operatives stay in this browser through IndexedDB. API keys are removed before storage. Export native JSON for portable backups.</p>
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
              <button type="button" class="danger" onClick={() => onDelete(record)}>Delete</button>
            </div>
          </article>
        ))}
        {records.length === 0 && !error && <div class="reference-empty"><strong>No saved NPCs</strong><p>Generate an operative and use Save to keep it in this browser.</p></div>}
      </div>
    </section>
  );
}
