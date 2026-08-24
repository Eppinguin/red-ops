import type { TargetedEvent } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import type { CatalogEntry, CatalogEntryType, ReferenceCatalogManifest } from '../content/types';

type SourceFilter = 'all' | 'generator' | 'foundry';
type InputEvent = TargetedEvent<HTMLInputElement>;
type SelectEvent = TargetedEvent<HTMLSelectElement>;

const TYPE_ORDER: CatalogEntryType[] = [
  'weapon', 'armor', 'cyberware', 'ammo', 'equipment', 'drug', 'skill', 'clothing', 'cyberdeck', 'program',
  'upgrade', 'role', 'vehicle', 'criticalInjury', 'junk',
];

function pretty(value: string): string {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function mechanicsFacts(entry: CatalogEntry): string[] {
  const mechanics = entry.mechanics;
  if (mechanics.kind === 'weapon') return [
    mechanics.damage ? `Damage ${mechanics.damage}` : '',
    mechanics.rateOfFire ? `ROF ${mechanics.rateOfFire}` : '',
    mechanics.magazine ? `MAG ${mechanics.magazine}` : '',
    mechanics.skill ? mechanics.skill : '',
  ].filter(Boolean);
  if (mechanics.kind === 'armor') return [
    mechanics.stoppingPower ? `SP ${mechanics.stoppingPower}` : '',
    mechanics.penalty ? `Penalty ${mechanics.penalty}` : '',
  ].filter(Boolean);
  if (mechanics.kind === 'cyberware') return [
    mechanics.humanityLoss ? `HL ${mechanics.humanityLoss}` : '',
    mechanics.installation.capacity ? `${mechanics.installation.capacity} slots` : '',
    mechanics.weapon?.damage ? `Damage ${mechanics.weapon.damage}` : '',
  ].filter(Boolean);
  if (mechanics.kind === 'skill') return [
    mechanics.linkedStat ?? '',
    mechanics.skillType ? pretty(mechanics.skillType) : '',
  ].filter(Boolean);
  if (mechanics.kind === 'drug') return [
    mechanics.duration ? `Lasts ${mechanics.duration}` : '',
    mechanics.secondaryDv ? `Secondary DV ${mechanics.secondaryDv}` : '',
    mechanics.usage ? pretty(mechanics.usage) : '',
  ].filter(Boolean);
  return [
    mechanics.brand ?? '',
    mechanics.electronic ? 'Electronic' : '',
  ].filter(Boolean);
}

export function ReferenceBrowser({
  entries,
  manifest,
  onSelect,
}: {
  entries: readonly CatalogEntry[];
  manifest: ReferenceCatalogManifest | null;
  onSelect: (entry: CatalogEntry) => void;
}) {
  const [query, setQuery] = useState('');
  const [type, setType] = useState<CatalogEntryType | 'all'>('all');
  const [source, setSource] = useState<SourceFilter>('all');

  const types = useMemo(() => TYPE_ORDER.filter((candidate) => entries.some((entry) => entry.type === candidate)), [entries]);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return entries.filter((entry) => {
      if (type !== 'all' && entry.type !== type) return false;
      if (source !== 'all' && !entry.provenance.some((item) => item.source === source)) return false;
      if (!needle) return true;
      const haystack = [
        entry.name,
        ...entry.aliases,
        entry.summary,
        entry.usage ?? '',
        ...entry.tags,
        entry.source?.book ?? '',
      ].join(' ').toLowerCase();
      return haystack.includes(needle);
    });
  }, [entries, query, source, type]);

  return (
    <section class="reference panel">
      <header class="reference-hero">
        <div>
          <span class="kicker">Game reference</span>
          <h2>Find rules and equipment</h2>
          <p>Search skills, weapons, armor, cyberware, and gear.</p>
        </div>
        <div class="reference-stats">
          <strong>{entries.length}</strong><span>entries</span>
          <strong>{manifest?.foundry?.itemCount ?? 0}</strong><span>extra references</span>
        </div>
      </header>

      {manifest?.foundry && manifest.foundry.itemCount === 0 && (
        <div class="content-notice" role="status">
          <strong>Some reference details are unavailable.</strong>
          <span>You can still search and use the built-in rules and equipment.</span>
        </div>
      )}

      <div class="reference-toolbar">
        <input
          type="search"
          value={query}
          placeholder="Search names, mechanics, tags, or source books"
          onInput={(event: InputEvent) => setQuery(event.currentTarget.value)}
        />
        <select value={type} onChange={(event: SelectEvent) => setType(event.currentTarget.value as CatalogEntryType | 'all')}>
          <option value="all">All categories</option>
          {types.map((entryType) => <option key={entryType} value={entryType}>{pretty(entryType)}</option>)}
        </select>
        <select value={source} onChange={(event: SelectEvent) => setSource(event.currentTarget.value as SourceFilter)}>
          <option value="all">All sources</option>
          <option value="generator">Built-in</option>
          <option value="foundry">Extra references</option>
        </select>
      </div>

      <div class="reference-results"><span>{filtered.length} matching entries</span></div>
      <div class="reference-grid">
        {filtered.map((entry) => {
          const facts = mechanicsFacts(entry);
          return (
            <button key={entry.id} type="button" class="reference-card" onClick={() => onSelect(entry)}>
              <span class="reference-type">{pretty(entry.type)}</span>
              <strong>{entry.name}</strong>
              <p>{entry.summary}</p>
              {facts.length > 0 && <div class="item-facts">{facts.map((fact) => <span key={fact}>{fact}</span>)}</div>}
              <footer>
                <span>{entry.price?.amount !== undefined ? `${entry.price.amount}eb` : entry.price?.category ?? '—'}</span>
                <span>{entry.source?.book ?? (entry.foundry ? 'Foundry enriched' : 'Generator')}</span>
              </footer>
            </button>
          );
        })}
        {filtered.length === 0 && <div class="reference-empty"><strong>No matching entries</strong><p>Broaden the search or remove a filter.</p></div>}
      </div>
    </section>
  );
}
