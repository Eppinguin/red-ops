import type { TargetedEvent } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { findCatalogEntry, normalizeCatalogName } from './content/catalog';
import type { CatalogConflict, CatalogEntry, ReferenceCatalogManifest } from './content/types';
import { DetailDrawer, type SelectedReference } from './components/DetailDrawer';
import { GlossaryTerm } from './components/GlossaryTerm';
import { ReferenceBrowser } from './components/ReferenceBrowser';
import { NpcLibrary } from './components/NpcLibrary';
import { EncounterTracker } from './components/EncounterTracker';
import { getAllTags } from './engine/domain';
import { createMarkdownExport, createNativeExport } from './engine/export';
import type {
  GenerateOptions,
  NpcCommand,
  NpcSection,
  GeneratedNpcView,
  InventoryNode,
  Item,
  SkillType,
} from './engine/types';
import { DEFAULT_OPTIONS, DEFAULT_RULES, SKILL_TYPES } from './engine/types';
import { deleteSavedNpc, listSavedNpcs, saveNpc, type SavedNpcRecord } from './storage';
import { applyTheme, loadTheme, THEMES, type ThemeId } from './theme';

interface Meta {
  ranks: string[];
  roles: string[];
  nationalities: readonly string[];
  commit: string;
  referenceManifest: ReferenceCatalogManifest;
  referenceEntries: CatalogEntry[];
  referenceConflicts: CatalogConflict[];
}

type WorkerMessage =
  | { type: 'boot-progress'; message: string; value: number }
  | { type: 'generation-progress'; progress: { stage: string; value: number } }
  | { type: 'ready'; meta: Meta }
  | { type: 'result'; view: GeneratedNpcView; warning: string | null }
  | { type: 'fatal' | 'generation-error'; error: string };


const REROLL_SECTIONS: Array<{ section: NpcSection; title: string; description: string }> = [
  { section: 'identity', title: 'Identity', description: 'Name, age, sex, nationality, and deterministic profile text.' },
  { section: 'description', title: 'Description', description: 'Regenerate only the narrative description; AI is used only when configured.' },
  { section: 'stats', title: 'Stats', description: 'Replace base stats while retaining the current skills and loadout.' },
  { section: 'skills', title: 'Skills', description: 'Replace trained skill levels while retaining stats and equipment.' },
  { section: 'cyberware', title: 'Cyberware', description: 'Replace the installation tree and recalculate all derived modifiers.' },
  { section: 'weapons', title: 'Weapons + ammo', description: 'Replace weapons and their generated ammunition together.' },
  { section: 'armor', title: 'Armor', description: 'Replace armor without changing the rest of the loadout.' },
  { section: 'inventory', title: 'Inventory', description: 'Replace ammunition, equipment, drugs, money, and junk.' },
  { section: 'loadout', title: 'Full loadout', description: 'Replace cyberware, armor, weapons, inventory, and Trauma Team status.' },
];

const RULE_LABELS: Array<[keyof typeof DEFAULT_RULES, string]> = [
  ['allow_non_basic_ammo', 'Special ammo'],
  ['allow_grenades', 'Grenades'],
  ['allow_armor', 'Armor'],
  ['allow_cyberware', 'Cyberware'],
  ['allow_borgware', 'Borgware'],
  ['allow_drugs', 'Drugs'],
  ['allow_equipment', 'Equipment'],
  ['allow_money', 'Money'],
  ['allow_junk', 'Junk'],
  ['allow_melee_weapon', 'Melee weapons'],
  ['allow_ranged_weapon', 'Ranged weapons'],
  ['allow_martial_arts', 'Martial arts'],
];

const TABS = ['overview', 'combat', 'skills', 'cyberware', 'gear', 'refine', 'validation', 'text', 'exports'] as const;
const PAGES = ['generator', 'encounter', 'reference', 'library'] as const;
type Tab = (typeof TABS)[number];
type Page = (typeof PAGES)[number];
const UI_STATE_KEY = 'red-ops.ui-state.v1';

function loadUiState(): { page: Page; tab: Tab } {
  try {
    const parsed = JSON.parse(localStorage.getItem(UI_STATE_KEY) ?? '{}') as { page?: unknown; tab?: unknown };
    return {
      page: typeof parsed.page === 'string' && PAGES.includes(parsed.page as Page) ? parsed.page as Page : 'generator',
      tab: typeof parsed.tab === 'string' && TABS.includes(parsed.tab as Tab) ? parsed.tab as Tab : 'overview',
    };
  } catch {
    return { page: 'generator', tab: 'overview' };
  }
}
type InputEvent = TargetedEvent<HTMLInputElement>;
type SelectEvent = TargetedEvent<HTMLSelectElement>;

function pretty(value: string): string {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function download(filename: string, content: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function copyText(value: string): Promise<void> {
  await navigator.clipboard.writeText(value);
}

function loadSavedOptions(): GenerateOptions {
  try {
    const raw = localStorage.getItem('red-ops.generator-options');
    if (!raw) return DEFAULT_OPTIONS;
    return { ...DEFAULT_OPTIONS, ...JSON.parse(raw), model_api_key: null } as GenerateOptions;
  } catch {
    return DEFAULT_OPTIONS;
  }
}

function reasonFor(view: GeneratedNpcView | null, entry: CatalogEntry, itemName?: string): string | undefined {
  if (!view) return undefined;
  return view.itemExplanations.find((explanation) => explanation.catalogId === entry.id)?.reason
    ?? view.itemExplanations.find((explanation) => normalizeCatalogName(explanation.name) === normalizeCatalogName(itemName ?? entry.name))?.reason;
}

function CyberwareNode({
  node,
  entries,
  view,
  onSelect,
}: {
  node: InventoryNode;
  entries: readonly CatalogEntry[];
  view: GeneratedNpcView;
  onSelect: (selected: SelectedReference) => void;
}) {
  if (node.item.default_hidden && node.children.length === 0) return null;
  const used = node.children.reduce((sum, child) => sum + child.item.size_in_container, 0);
  const reference = findCatalogEntry(entries, { name: node.item.name, type: node.item.type, quality: node.item.quality });
  return (
    <div class="tree-node">
      <button
        type="button"
        class="tree-label"
        disabled={!reference}
        onClick={() => reference && onSelect({ entry: reference, reason: reasonFor(view, reference, node.item.name) })}
      >
        <strong>{node.item.name}</strong>
        {node.item.price > 0 && <span>{node.item.price}eb</span>}
        {node.item.container_capacity > 0 && node.item.container_capacity < 100 && (
          <span>{used}/{node.item.container_capacity} slots</span>
        )}
      </button>
      {node.children.length > 0 && <div class="tree-children">{node.children.map((child, index) => (
        <CyberwareNode key={`${child.item.id}-${index}`} node={child} entries={entries} view={view} onSelect={onSelect} />
      ))}</div>}
    </div>
  );
}

function ItemCard({
  item,
  amount,
  entries,
  view,
  onSelect,
}: {
  item: Item;
  amount?: number;
  entries: readonly CatalogEntry[];
  view: GeneratedNpcView;
  onSelect: (selected: SelectedReference) => void;
}) {
  const reference = findCatalogEntry(entries, { name: item.name, type: item.type, quality: item.quality });
  return (
    <button
      type="button"
      class="item-card"
      disabled={!reference}
      onClick={() => reference && onSelect({ entry: reference, reason: reasonFor(view, reference, item.name) })}
    >
      <div class="item-card-title">
        <strong>{amount !== undefined ? `[${amount}] ` : ''}{item.name}</strong>
        {item.price > 0 && <span>{item.price}eb</span>}
      </div>
      <div class="item-facts">
        {item.quality && <span>{item.quality}</span>}
        {item.armor_class && <span><GlossaryTerm id="SP">SP</GlossaryTerm> {item.armor_class}</span>}
        {item.damage && <span>{item.damage}</span>}
        {item.rate_of_fire && <span><GlossaryTerm id="ROF">ROF</GlossaryTerm> {item.rate_of_fire}</span>}
        {item.magazine && <span>MAG {item.magazine}</span>}
      </div>
      {(item.unique_tags.length > 0 || item.tags.length > 0) && (
        <div class="tags">{getAllTags(item).map((tag, index) => <span key={`${tag}-${index}`}>{tag}</span>)}</div>
      )}
      {reference && <small class="inspect-hint">Open reference</small>}
    </button>
  );
}

function ThemePicker({ theme, onChange }: { theme: ThemeId; onChange: (theme: ThemeId) => void }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const active = THEMES.find((candidate) => candidate.id === theme) ?? THEMES[0];

  useEffect(() => {
    if (!open) return;
    // Closing on `click` rather than `mousedown` lets an option's own click
    // land first; mousedown would tear the menu down before selection.
    const onDocumentClick = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('click', onDocumentClick);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('click', onDocumentClick);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div class="theme-picker" ref={rootRef}>
      <button
        type="button"
        class="theme-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        title={`Colour scheme: ${active.name}`}
        onClick={(event: MouseEvent) => {
          event.stopPropagation();
          setOpen((value) => !value);
        }}
      >
        <span class="theme-swatch" data-theme={active.id} aria-hidden="true"><i /><i /><i /></span>
        <span class="theme-trigger-name">{active.name}</span>
      </button>
      {open && <div class="theme-menu" role="listbox" aria-label="Colour scheme">
        {THEMES.map((candidate) => (
          <button
            type="button"
            role="option"
            aria-selected={candidate.id === theme}
            class={candidate.id === theme ? 'active' : ''}
            key={candidate.id}
            onClick={() => {
              onChange(candidate.id);
              setOpen(false);
            }}
          >
            <span class="theme-swatch" data-theme={candidate.id} aria-hidden="true"><i /><i /><i /></span>
            <span class="theme-option-copy"><strong>{candidate.name}</strong><small>{candidate.blurb}</small></span>
          </button>
        ))}
      </div>}
    </div>
  );
}

function EmptyState({ busy, status, progress }: { busy: boolean; status: string; progress: number }) {
  return (
    <div class="empty panel">
      <div class="empty-glyph">R//</div>
      <h2>{busy ? 'Compiling operative' : 'Generator standing by'}</h2>
      <p>{status}</p>
      <div class="progress"><i style={{ width: `${Math.round(progress * 100)}%` }} /></div>
      <small>{Math.round(progress * 100)}%</small>
    </div>
  );
}

export function App() {
  const workerRef = useRef<Worker | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [options, setOptions] = useState<GenerateOptions>(loadSavedOptions);
  const [view, setView] = useState<GeneratedNpcView | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [status, setStatus] = useState('Loading the pinned upstream catalog…');
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(true);
  const [fatal, setFatal] = useState<string | null>(null);
  const initialUiState = useMemo(loadUiState, []);
  const [tab, setTab] = useState<Tab>(initialUiState.tab);
  const [page, setPage] = useState<Page>(initialUiState.page);
  const [skillSearch, setSkillSearch] = useState('');
  const [trainedOnly, setTrainedOnly] = useState(false);
  const [selectedReference, setSelectedReference] = useState<SelectedReference | null>(null);
  const [savedNpcs, setSavedNpcs] = useState<SavedNpcRecord[]>([]);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [theme, setTheme] = useState<ThemeId>(loadTheme);

  const changeTheme = (next: ThemeId) => {
    setTheme(next);
    applyTheme(next);
  };

  useEffect(() => {
    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = worker;
    worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
      const message = event.data;
      if (message.type === 'boot-progress') {
        setStatus(message.message);
        setProgress(message.value * 0.25);
      } else if (message.type === 'ready') {
        setMeta(message.meta);
        setBusy(false);
        setProgress(1);
        setStatus('TypeScript engine and reference catalog ready.');
      } else if (message.type === 'generation-progress') {
        setBusy(true);
        setStatus(message.progress.stage);
        setProgress(message.progress.value);
      } else if (message.type === 'result') {
        setView(message.view);
        setWarning(message.warning);
        setBusy(false);
        setStatus('Operative generated.');
        setProgress(1);
      } else {
        setFatal(message.error);
        setBusy(false);
      }
    };
    return () => worker.terminate();
  }, []);

  useEffect(() => {
    void listSavedNpcs()
      .then(setSavedNpcs)
      .catch((error: unknown) => setLibraryError(error instanceof Error ? error.message : String(error)));
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(UI_STATE_KEY, JSON.stringify({ page, tab }));
    } catch {
      // Navigation state remains in memory when browser storage is unavailable.
    }
  }, [page, tab]);

  useEffect(() => {
    const safeOptions = { ...options, model_api_key: null };
    try {
      localStorage.setItem('red-ops.generator-options', JSON.stringify(safeOptions));
    } catch {
      // Storage may be unavailable in hardened or private browser contexts.
    }
  }, [options]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelectedReference(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const entries = meta?.referenceEntries ?? [];
  const filteredSkills = useMemo(() => {
    if (!view) return [];
    const query = skillSearch.trim().toLowerCase();
    return view.skills.filter((skill) =>
      (!trainedOnly || skill.base + skill.modifier > 0) &&
      (!query || skill.name.toLowerCase().includes(query) || skill.type.includes(query)),
    );
  }, [view, skillSearch, trainedOnly]);

  const generate = () => {
    if (!meta || busy) return;
    setBusy(true);
    setFatal(null);
    setWarning(null);
    setProgress(0);
    setStatus('Preparing seeded generator…');
    workerRef.current?.postMessage({ type: 'generate', options });
  };

  const update = <K extends keyof GenerateOptions>(key: K, value: GenerateOptions[K]) => {
    setOptions((current) => ({ ...current, [key]: value }));
  };

  const reroll = (section: NpcSection) => {
    if (!view || !meta || busy) return;
    const randomSeed = new Uint32Array(1);
    crypto.getRandomValues(randomSeed);
    const seed = randomSeed[0] || 1;
    setBusy(true);
    setFatal(null);
    setWarning(null);
    setProgress(0);
    setStatus(`Rerolling ${section}…`);
    workerRef.current?.postMessage({ type: 'reroll', current: view, options, section, seed });
  };

  const editNpc = (command: NpcCommand) => {
    if (!view || !meta || busy) return;
    setBusy(true);
    setFatal(null);
    setProgress(0.9);
    setStatus('Applying NPC edit…');
    workerRef.current?.postMessage({ type: 'edit', current: view, command });
  };

  const printNpc = () => {
    const previousTab = tab;
    setTab('overview');
    window.setTimeout(() => {
      window.print();
      setTab(previousTab);
    }, 0);
  };

  const saveCurrentNpc = async () => {
    if (!view) return;
    try {
      const record = await saveNpc(view);
      setSavedNpcs((current) => [record, ...current]);
      setLibraryError(null);
      setStatus('Operative saved to the local library.');
    } catch (error) {
      setLibraryError(error instanceof Error ? error.message : String(error));
    }
  };

  const openSavedNpc = (record: SavedNpcRecord) => {
    setView(record.view);
    setWarning(null);
    setFatal(null);
    setPage('generator');
    setTab('overview');
    setStatus(`Loaded ${record.label} from the local library.`);
  };

  const removeSavedNpc = async (record: SavedNpcRecord) => {
    try {
      await deleteSavedNpc(record.id);
      setSavedNpcs((current) => current.filter((candidate) => candidate.id !== record.id));
    } catch (error) {
      setLibraryError(error instanceof Error ? error.message : String(error));
    }
  };

  const foundryJson = view ? JSON.stringify(view.foundry, null, 2) : '';
  const nativeJson = view ? JSON.stringify(createNativeExport(view), null, 2) : '';
  const markdown = view ? createMarkdownExport(view) : '';
  const filename = view ? `${view.npc.name}-${view.npc.surname}`.replace(/[^a-z0-9-]+/gi, '-').toLowerCase() : 'npc';
  const errorCount = view?.validation.filter((issue) => issue.severity === 'error').length ?? 0;
  const warningCount = view?.validation.filter((issue) => issue.severity === 'warning').length ?? 0;

  return (
    <main class={`shell page-${page}`}>
      <header class="topbar panel">
        <div class="brand-mark">R//</div>
        <div class="brand-copy">
          <h1>RED<span>//OPS</span></h1>
          <p>Cyberpunk RED NPC generator and encounter runner</p>
        </div>
        <nav class="primary-nav" aria-label="Primary">
          <button class={page === 'generator' ? 'active' : ''} onClick={() => setPage('generator')}><span class="nav-key">01</span><span>Generator</span></button>
          <button class={page === 'encounter' ? 'active' : ''} onClick={() => setPage('encounter')}><span class="nav-key">02</span><span>Encounter</span></button>
          <button class={page === 'reference' ? 'active' : ''} onClick={() => setPage('reference')}><span class="nav-key">03</span><span>Reference</span></button>
          <button class={page === 'library' ? 'active' : ''} onClick={() => setPage('library')}><span class="nav-key">04</span><span>Library</span></button>
        </nav>
        <div class="topbar-utilities">
          <ThemePicker theme={theme} onChange={changeTheme} />
          <div class="engine-state">
            <i class={busy ? 'loading' : fatal ? 'error' : 'ready'} />
            <span>{fatal ? 'ENGINE FAULT' : busy ? 'PROCESSING' : 'ONLINE'}</span>
            {meta && <small>{meta.commit.slice(0, 8)}</small>}
          </div>
        </div>
      </header>

      {page === 'encounter' ? (
        <EncounterTracker currentNpc={view} savedNpcs={savedNpcs} referenceEntries={entries} />
      ) : page === 'reference' ? (
        <ReferenceBrowser entries={entries} manifest={meta?.referenceManifest ?? null} onSelect={(entry) => setSelectedReference({ entry })} />
      ) : page === 'library' ? (
        <NpcLibrary records={savedNpcs} error={libraryError} onOpen={openSavedNpc} onDelete={(record) => void removeSavedNpc(record)} />
      ) : (
        <div class="layout">
          <aside class="controls panel">
            <div class="panel-heading"><h2>Generator matrix</h2><span>01</span></div>
            <div class="control-body">
              <div class="field-grid">
                <label><span>Rank</span><select value={options.rank} disabled={!meta || busy} onChange={(event: SelectEvent) => update('rank', event.currentTarget.value)}>
                  {(meta?.ranks ?? [options.rank]).map((rank) => <option key={rank} value={rank}>{pretty(rank)}</option>)}
                </select></label>
                <label><span>Role</span><select value={options.role} disabled={!meta || busy} onChange={(event: SelectEvent) => update('role', event.currentTarget.value)}>
                  {(meta?.roles ?? [options.role]).map((role) => <option key={role} value={role}>{pretty(role)}</option>)}
                </select></label>
                <label class="wide"><span>Nationality / Faker locale</span><select value={options.nationality ?? ''} disabled={!meta || busy} onChange={(event: SelectEvent) => update('nationality', event.currentTarget.value || null)}>
                  <option value="">Auto · population weighted</option>
                  {meta?.nationalities.map((locale) => <option key={locale} value={locale}>{locale}</option>)}
                </select></label>
                <label class="wide"><span>Seed · 0 uses current time</span><input type="number" value={options.seed} disabled={busy} onInput={(event: InputEvent) => update('seed', Number(event.currentTarget.value))} /></label>
              </div>

              <div class="rule-heading"><h3>Generation permissions</h3><button type="button" onClick={() => setOptions((current) => ({ ...current, ...DEFAULT_RULES }))}>Reset</button></div>
              <div class="toggles">
                {RULE_LABELS.map(([key, label]) => (
                  <label key={key} class="toggle">
                    <span>{label}</span>
                    <input type="checkbox" checked={options[key]} disabled={busy} onChange={(event: InputEvent) => update(key, event.currentTarget.checked)} />
                    <i />
                  </label>
                ))}
              </div>

              <details>
                <summary>AI description · optional</summary>
                <div class="details-grid">
                  <label><span>Model ID</span><input value={options.model_id ?? ''} placeholder="disabled" onInput={(event: InputEvent) => update('model_id', event.currentTarget.value || null)} /></label>
                  <label><span>API key</span><input type="password" value={options.model_api_key ?? ''} placeholder="not stored" onInput={(event: InputEvent) => update('model_api_key', event.currentTarget.value || null)} /></label>
                  <label><span>Base URL</span><input value={options.model_base_url ?? ''} placeholder="http://localhost:1234/v1" onInput={(event: InputEvent) => update('model_base_url', event.currentTarget.value || null)} /></label>
                  <label><span>Language</span><input value={options.model_language} onInput={(event: InputEvent) => update('model_language', event.currentTarget.value)} /></label>
                </div>
                <p>Requests go directly from the browser. API keys are kept only in memory and are not stored locally.</p>
              </details>

              <label class="toggle standalone"><span>Flat exact-text layout</span><input type="checkbox" checked={options.flat} onChange={(event: InputEvent) => update('flat', event.currentTarget.checked)} /><i /></label>
              <button class="generate" type="button" disabled={!meta || busy} onClick={generate}>{busy ? 'Fabricating…' : 'Generate NPC'}</button>
            </div>
          </aside>

          <section class="workspace">
            {fatal && <div class="fatal panel"><strong>Engine fault</strong><pre>{fatal}</pre></div>}
            {!view && !fatal && <EmptyState busy={busy} status={status} progress={progress} />}
            {view && (
              <div class="result panel">
                <section class="hero">
                  <div class="hero-copy">
                    <span class="kicker">{pretty(view.rank.name)} · {pretty(view.role.name)}</span>
                    <h2>{view.npc.name} {view.npc.surname}</h2>
                    <div class="chips">
                      <span>{view.npc.sex ? 'Male' : 'Female'}</span><span>{view.npc.nationality}</span><span>{view.npc.age} yo</span>
                      <span>Seed {view.seed}</span><span>{view.totalPrice}eb loadout</span><span>Trauma Team {view.npc.traumaTeamStatus}</span>
                    </div>
                    <p class="description">{view.profileSummary}</p>
                    {warning && <p class="warning">{warning}</p>}
                  </div>
                  <div class="hero-actions">
                    <button class="primary-action" onClick={() => setPage('encounter')}>Use in encounter</button>
                    <button onClick={() => void saveCurrentNpc()}>Save</button>
                    <button onClick={printNpc}>Print</button>
                    <button onClick={() => copyText(view.command)}>Copy command</button>
                    <button onClick={() => download(`${filename}.json`, nativeJson, 'application/json')}>Native JSON</button>
                  </div>
                </section>

                <nav class="tabs">
                  {TABS.map((name) => <button key={name} class={tab === name ? 'active' : ''} onClick={() => setTab(name)}>{pretty(name)}</button>)}
                </nav>

                {tab === 'overview' && <section class="tab-content overview-grid">
                  <article class="card wide"><header><h3>Stats</h3><span>base + modifiers</span></header><div class="stats-grid">
                    {view.stats.map((stat) => <div key={stat.name} class="stat"><span>{stat.name}</span><strong>{stat.total}</strong><small>{stat.modifier ? `${stat.base} ${stat.modifier >= 0 ? '+' : ''}${stat.modifier}` : `base ${stat.base}`}</small></div>)}
                  </div></article>
                  <article class="card"><header><h3>Combat state</h3></header><div class="metrics">
                    <div><span><GlossaryTerm id="HP">HP</GlossaryTerm></span><strong>{view.combat.hitPoints}</strong><small>{view.hp.painEditor ? 'Pain Editor' : `Seriously wounded ${view.combat.seriouslyWounded}`}</small></div>
                    <div><span>Initiative</span><strong>+{view.combat.initiative}</strong><small><GlossaryTerm id="REF">REF</GlossaryTerm> total</small></div>
                    <div><span>Death Save</span><strong>{view.combat.deathSave}</strong><small><GlossaryTerm id="BODY">BODY</GlossaryTerm> total</small></div>
                  </div></article>
                  <article class="card"><header><h3>Character check</h3><span>{errorCount ? `${errorCount} errors` : warningCount ? `${warningCount} warnings` : 'valid'}</span></header>
                    <div class={`validation-summary ${errorCount ? 'has-errors' : warningCount ? 'has-warnings' : 'valid'}`}>
                      <strong>{errorCount ? 'Needs correction' : warningCount ? 'Review suggested' : 'No mechanical issues detected'}</strong>
                      <p>{view.validation[0]?.message ?? 'Weapons, ammunition, cyberware capacity, skills, and catalog mappings passed the current checks.'}</p>
                      <button type="button" onClick={() => setTab('validation')}>Open validation</button>
                    </div>
                  </article>
                  <article class="card"><header><h3>Conditions</h3></header><div class="conditions">
                    {view.conditions.map((condition) => <div key={condition.label} class={condition.value ? 'ok' : ''}><i>{condition.value ? '✓' : '×'}</i><span>{condition.label}<small>{condition.source ?? 'Not available'}</small></span></div>)}
                  </div></article>
                  <article class="card"><header><h3>Actions</h3></header><div class="tags large">{view.actions.length ? view.actions.map((action, index) => <span key={`${action}-${index}`}>{action}</span>) : <em>None</em>}</div></article>
                  <article class="card"><header><h3>Abilities</h3></header><div class="tags large">{view.abilities.length ? view.abilities.map((ability, index) => <span key={`${ability}-${index}`}>{ability}</span>) : <em>None</em>}</div></article>
                </section>}

                {tab === 'combat' && <section class="tab-content combat-layout">
                  <div class="combat-metrics">
                    <article><span><GlossaryTerm id="HP">HP</GlossaryTerm></span><strong>{view.combat.hitPoints}</strong></article>
                    <article><span>Seriously Wounded</span><strong>{view.combat.seriouslyWounded ?? 'No'}</strong></article>
                    <article><span>Initiative</span><strong>+{view.combat.initiative}</strong></article>
                    <article><span>Death Save</span><strong>{view.combat.deathSave}</strong></article>
                  </div>
                  <article class="combat-section"><h3>Armor</h3><div class="combat-list">{view.combat.armor.length ? view.combat.armor.map((armor) => <div key={armor.name}><strong>{armor.name}</strong><span><GlossaryTerm id="SP">SP</GlossaryTerm> {armor.stoppingPower ?? '—'}</span></div>) : <p class="muted">No armor equipped.</p>}</div></article>
                  <article class="combat-section"><h3>Attacks</h3><div class="attack-grid">{view.combat.attacks.map((attack) => {
                    const item = view.npc.weapons.find((weapon) => weapon.name === attack.name);
                    const reference = item ? findCatalogEntry(entries, { name: item.name, type: item.type, quality: item.quality }) : undefined;
                    return <button key={attack.name} type="button" class="attack-card" disabled={!reference} onClick={() => reference && setSelectedReference({ entry: reference, reason: reasonFor(view, reference, attack.name) })}>
                      <header><strong>{attack.name}</strong><span>{attack.skill ?? 'Unmapped'}</span></header>
                      <div><span>Attack</span><strong>{attack.attackBase ?? '—'}</strong></div>
                      {attack.autofireBase !== null && <div><span>Autofire</span><strong>{attack.autofireBase}</strong></div>}
                      <div><span>Damage</span><strong>{attack.damage ?? '—'}</strong></div>
                      <div><span><GlossaryTerm id="ROF">ROF</GlossaryTerm></span><strong>{attack.rateOfFire ?? '—'}</strong></div>
                      <div><span>MAG</span><strong>{attack.magazine ?? '—'}</strong></div>
                      <p>{attack.explanation}</p>
                    </button>;
                  })}</div></article>
                </section>}

                {tab === 'skills' && <section class="tab-content">
                  <div class="skill-tools"><input type="search" placeholder="Filter skills" value={skillSearch} onInput={(event: InputEvent) => setSkillSearch(event.currentTarget.value)} /><button class={trainedOnly ? 'active' : ''} onClick={() => setTrainedOnly((value) => !value)}>Trained only</button></div>
                  <div class="skill-groups">{SKILL_TYPES.map((type: SkillType) => {
                    const skills = filteredSkills.filter((skill) => skill.type === type);
                    return skills.length ? <article key={type}><h3>{pretty(type)}</h3>{skills.map((skill) => {
                      const reference = findCatalogEntry(entries, { name: skill.name, type: 'skill' });
                      return <button key={skill.name} type="button" class="skill" disabled={!reference} onClick={() => reference && setSelectedReference({ entry: reference })}><span>{skill.name}<small>{skill.link} {skill.base}{skill.modifier ? ` ${skill.modifier >= 0 ? '+' : ''}${skill.modifier}` : ''}</small></span><strong>{skill.total}</strong></button>;
                    })}</article> : null;
                  })}</div>
                </section>}

                {tab === 'cyberware' && <section class="tab-content cyberware-layout">
                  {view.npc.cyberware.children.length ? view.npc.cyberware.children.map((node, index) => <CyberwareNode key={`${node.item.id}-${index}`} node={node} entries={entries} view={view} onSelect={setSelectedReference} />) : <p class="muted">No cyberware generated.</p>}
                </section>}

                {tab === 'gear' && <section class="tab-content gear-grid">
                  <article><h3>Armor</h3>{view.npc.armor.length ? view.npc.armor.map((item, index) => <ItemCard key={`${item.name}-${index}`} item={item} entries={entries} view={view} onSelect={setSelectedReference} />) : <p class="muted">None</p>}</article>
                  <article><h3>Weapons</h3>{view.npc.weapons.map((item, index) => <ItemCard key={`${item.name}-${index}`} item={item} entries={entries} view={view} onSelect={setSelectedReference} />)}</article>
                  <article><h3>Inventory</h3>{[...view.npc.inventory.values()].map((entry, index) => <ItemCard key={`${entry.item.name}-${index}`} item={entry.item} amount={entry.amount} entries={entries} view={view} onSelect={setSelectedReference} />)}</article>
                </section>}

                {tab === 'refine' && <section class="tab-content refine-layout">
                  <header class="refine-header">
                    <div><span class="kicker">Non-destructive iteration</span><h3>Refine this operative</h3><p>Each partial reroll keeps every other section locked. A new seed is recorded so native exports retain an audit trail.</p></div>
                    <span>{view.revisions.length} revisions</span>
                  </header>
                  <div class="reroll-grid">
                    {REROLL_SECTIONS.map(({ section, title, description }) => <article key={section}>
                      <h4>{title}</h4><p>{description}</p><button type="button" disabled={busy} onClick={() => reroll(section)}>Reroll {title}</button>
                    </article>)}
                  </div>
                  <div class="edit-grid">
                    <article class="inline-editor"><h3>Base stats</h3><p>Manual changes are clamped to 1–10. Cyberware modifiers remain separate.</p><div>
                      {view.stats.map((stat) => <div key={stat.name}><span>{stat.name}</span><button type="button" disabled={busy || stat.base <= 1} onClick={() => editNpc({ type: 'set-stat', stat: stat.name, value: stat.base - 1 })}>−</button><strong>{stat.base}</strong><button type="button" disabled={busy || stat.base >= 10} onClick={() => editNpc({ type: 'set-stat', stat: stat.name, value: stat.base + 1 })}>+</button></div>)}
                    </div></article>
                    <article class="inline-editor"><h3>Trained skills</h3><p>Adjust the highest trained skills. Validation immediately rechecks weapon compatibility.</p><div>
                      {[...view.skills].sort((left, right) => right.base - left.base || left.name.localeCompare(right.name)).filter((skill) => skill.base > 0).slice(0, 20).map((skill) => {
                        const trainedLevel = view.npc.skills.get(skill.name)?.level ?? 0;
                        return <div key={skill.name}><span>{skill.name}</span><button type="button" disabled={busy || trainedLevel <= 0} onClick={() => editNpc({ type: 'set-skill', skill: skill.name, value: trainedLevel - 1 })}>−</button><strong>{trainedLevel}</strong><button type="button" disabled={busy || trainedLevel >= 10} onClick={() => editNpc({ type: 'set-skill', skill: skill.name, value: trainedLevel + 1 })}>+</button></div>;
                      })}
                    </div></article>
                  </div>
                  <article class="revision-log"><h3>Revision history</h3>{view.revisions.length ? <ol>{[...view.revisions].reverse().map((revision, index) => <li key={`${revision.createdAt}-${index}`}><strong>{pretty(revision.section)}</strong><span>{revision.seed !== undefined ? `seed ${revision.seed}` : revision.command}</span><time>{new Date(revision.createdAt).toLocaleString()}</time></li>)}</ol> : <p>No partial rerolls or manual edits yet.</p>}</article>
                </section>}

                {tab === 'validation' && <section class="tab-content validation-panel">
                  <header><div><span class="kicker">Post-generation integrity checks</span><h3>Character validation</h3></div><div class="validation-counts"><span>{errorCount} errors</span><span>{warningCount} warnings</span><span>{view.validation.filter((issue) => issue.severity === 'info').length} notes</span></div></header>
                  {view.validation.length === 0 ? <div class="validation-ok"><strong>All checks passed</strong><p>Weapon skills, ammunition, cyberware capacity, derived values, and catalog mappings are internally consistent.</p></div> : <div class="validation-list">{view.validation.map((issue, index) => <article key={`${issue.code}-${issue.subject}-${index}`} class={`validation-issue ${issue.severity}`}><span>{issue.severity}</span><div><strong>{issue.subject ?? issue.code}</strong><p>{issue.message}</p>{issue.suggestedAction && <small>{issue.suggestedAction}</small>}</div></article>)}</div>}
                </section>}

                {tab === 'text' && <section class="tab-content code-pane"><div><button onClick={() => copyText(view.text)}>Copy text</button><button onClick={() => download(`${filename}.txt`, view.text, 'text/plain')}>Download</button></div><pre>{view.text}</pre></section>}

                {tab === 'exports' && <section class="tab-content export-grid">
                  <article><span>Primary</span><h3>Native JSON</h3><p>Complete, versioned NPC data with combat summary, validation, and generation explanations.</p><div><button onClick={() => copyText(nativeJson)}>Copy</button><button onClick={() => download(`${filename}.json`, nativeJson, 'application/json')}>Download</button></div></article>
                  <article><span>Table use</span><h3>Markdown</h3><p>Portable stat block for notes, wikis, campaign documents, and chat.</p><div><button onClick={() => copyText(markdown)}>Copy</button><button onClick={() => download(`${filename}.md`, markdown, 'text/markdown')}>Download</button></div></article>
                  <article><span>Compatibility</span><h3>Foundry JSON</h3><p>Secondary compatibility export using the original generator's lightweight Foundry structure.</p><div><button onClick={() => copyText(foundryJson)}>Copy</button><button onClick={() => download(`${filename}-foundry.json`, foundryJson, 'application/json')}>Download</button></div></article>
                  <article><span>Table use</span><h3>Print sheet</h3><p>Print the current operative or save a clean PDF through the browser print dialog.</p><div><button onClick={printNpc}>Print</button></div></article>
                  <article><span>Debug</span><h3>CLI command</h3><p>Reproduce the same seeded inputs upstream. When AI is enabled, the command uses the $MODEL_API_KEY environment variable and never embeds the key.</p><div><button onClick={() => copyText(view.command)}>Copy command</button></div></article>
                </section>}
              </div>
            )}
          </section>
        </div>
      )}
      <footer class="app-footer">
        <span><b>RED//OPS</b> TABLE SYSTEM</span>
        <span>UNOFFICIAL FAN UTILITY · GPL-3.0</span>
        <span>GEN {meta?.commit.slice(0, 8) ?? 'LOADING'} · DATA {meta?.referenceManifest.foundry?.ref ?? 'FALLBACK'}</span>
      </footer>
      <DetailDrawer selected={selectedReference} conflicts={meta?.referenceConflicts ?? []} onClose={() => setSelectedReference(null)} />
    </main>
  );
}
