import type { TargetedEvent } from 'preact';
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { findCatalogEntry, normalizeCatalogName } from './content/catalog';
import type { CatalogConflict, CatalogEntry, ReferenceCatalogManifest } from './content/types';
import { DetailDrawer, type SelectedReference } from './components/DetailDrawer';
import { GlossaryTerm } from './components/GlossaryTerm';
import { ReferenceBrowser } from './components/ReferenceBrowser';
import { NpcLibrary } from './components/NpcLibrary';
import { EncounterTracker } from './components/EncounterTracker';
import {
  CyberwareEditor,
  EditorActionBar,
  GearEditor,
  IdentityEditor,
  RawNpcEditor,
  SkillsEditor,
  StatsEditor,
} from './components/NpcEditor';
import { useNpcEditor } from './components/useNpcEditor';
import { getAllTags } from './engine/domain';
import { createMarkdownExport, createNativeExport, parseNativeExport } from './engine/export';
import { addNpcToActiveEncounter, loadEncounterWorkspace, persistEncounterWorkspace } from './encounter/storage';
import type {
  GenerateOptions,
  GenerationRules,
  GeneratedNpcView,
  InventoryNode,
  Item,
  SkillType,
} from './engine/types';
import { DEFAULT_OPTIONS, DEFAULT_RULES, SKILL_TYPES } from './engine/types';
import { deleteSavedNpc, listSavedNpcs, normalizeSavedNpcView, saveNpc, type SavedNpcRecord } from './storage';
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
  | { type: 'result'; view: GeneratedNpcView; warning: string | null; requestId?: string }
  | { type: 'fatal' | 'generation-error'; error: string; requestId?: string };

const RULE_LABELS: Array<[Exclude<keyof GenerationRules, 'forbidden_skills' | 'allow_description'>, string]> = [
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
  ['allow_lifepath', 'Lifepath'],
];

const TABS = ['overview', 'combat', 'skills', 'gear', 'export'] as const;
const PAGES = ['generator', 'encounter', 'reference', 'library'] as const;
type Tab = (typeof TABS)[number];
type Page = (typeof PAGES)[number];
const UI_STATE_KEY = 'red-ops.ui-state.v1';

/** Tabs removed in the sheet rework still live in browsers' saved UI state. */
const RETIRED_TABS: Record<string, Tab> = {
  cyberware: 'gear',
  refine: 'overview',
  validation: 'overview',
  text: 'export',
  exports: 'export',
};

function loadUiState(): { page: Page; tab: Tab } {
  try {
    const parsed = JSON.parse(localStorage.getItem(UI_STATE_KEY) ?? '{}') as { page?: unknown; tab?: unknown };
    const savedTab = typeof parsed.tab === 'string' ? parsed.tab : '';
    return {
      page: typeof parsed.page === 'string' && PAGES.includes(parsed.page as Page) ? parsed.page as Page : 'generator',
      tab: TABS.includes(savedTab as Tab) ? savedTab as Tab : RETIRED_TABS[savedTab] ?? 'overview',
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

/**
 * Print sheet.
 *
 * The screen UI hides most of the NPC behind tabs, which is wrong for paper:
 * a GM at the table wants stats, combat, skills, gear, and cyberware all
 * visible at once. So printing renders this dedicated block rather than
 * whichever tab happened to be open, and the screen tabs are hidden in
 * `@media print`. Everything here is static — no buttons, no drawers, no
 * "open reference" affordances that mean nothing on paper.
 */
function PrintSheet({ view }: { view: GeneratedNpcView }) {
  const trainedSkills = view.skills
    .filter((skill) => skill.base > 0)
    .sort((left, right) => right.total - left.total || left.name.localeCompare(right.name));
  const inventory = [...view.npc.inventory.values()];
  const cyberware = flattenCyberware(view.npc.cyberware.children);

  return (
    <section class="print-sheet" aria-hidden="true">
      <header class="print-head">
        <div class="print-identity">
          <h1>{view.npc.name} {view.npc.surname}</h1>
          <p class="print-role">{pretty(view.rank.name)} · {pretty(view.role.name)}</p>
        </div>
        <dl class="print-bio">
          <div><dt>Sex</dt><dd>{view.npc.sex ? 'Male' : 'Female'}</dd></div>
          <div><dt>Age</dt><dd>{view.npc.age}</dd></div>
          <div><dt>Nationality</dt><dd>{view.npc.nationality}</dd></div>
          <div><dt>Trauma Team</dt><dd>{view.npc.traumaTeamStatus}</dd></div>
          <div><dt>Loadout</dt><dd>{view.totalPrice}eb</dd></div>
          <div><dt>Seed</dt><dd>{view.seed}</dd></div>
        </dl>
      </header>

      {view.profileSummary && <p class="print-description">{view.profileSummary}</p>}

      <section class="print-block print-vitals">
        <h2>Vitals</h2>
        <div class="print-vital-row">
          <div><span>HP</span><strong>{view.combat.hitPoints}</strong></div>
          <div><span>Seriously Wounded</span><strong>{view.combat.seriouslyWounded ?? '—'}</strong></div>
          <div><span>Death Save</span><strong>{view.combat.deathSave}</strong></div>
          <div><span>Initiative</span><strong>+{view.combat.initiative}</strong></div>
        </div>
        {/* Damage tracking is the one thing a paper sheet must support that the
            screen does not: an empty grid to tick off HP as it comes off. One
            box per point of this NPC's actual HP, so the row is a true track
            rather than a fixed-length decoration. The Seriously Wounded
            threshold is marked because crossing it changes how the NPC acts. */}
        <div class="print-damage-track">
          <span>Damage</span>
          <div class="print-boxes">{Array.from({ length: view.combat.hitPoints }, (_, index) => (
            <i key={index} class={index + 1 === view.combat.seriouslyWounded ? 'print-box-threshold' : undefined} />
          ))}</div>
        </div>
      </section>

      <section class="print-block">
        <h2>Stats</h2>
        <table class="print-table print-stat-table">
          <thead><tr>{view.stats.map((stat) => <th key={stat.name} scope="col">{stat.name}</th>)}</tr></thead>
          <tbody><tr>{view.stats.map((stat) => <td key={stat.name}>{stat.total}</td>)}</tr></tbody>
        </table>
      </section>

      <section class="print-block">
        <h2>Attacks</h2>
        {view.combat.attacks.length ? (
          <table class="print-table">
            <thead><tr><th scope="col">Weapon</th><th scope="col">Attack</th><th scope="col">Autofire</th><th scope="col">Damage</th><th scope="col">ROF</th><th scope="col">Mag</th></tr></thead>
            <tbody>{view.combat.attacks.map((attack) => (
              <tr key={attack.name}>
                <th scope="row">{attack.name}<small>{attack.skill ?? 'Unmapped'}</small></th>
                <td>{attack.attackBase ?? '—'}</td>
                <td>{attack.autofireBase ?? '—'}</td>
                <td>{attack.damage ?? '—'}</td>
                <td>{attack.rateOfFire ?? '—'}</td>
                <td>{attack.magazine ?? '—'}</td>
              </tr>
            ))}</tbody>
          </table>
        ) : <p class="print-empty">No attacks.</p>}
      </section>

      <section class="print-block">
        <h2>Armor</h2>
        {view.combat.armor.length ? (
          <table class="print-table">
            <thead><tr><th scope="col">Location</th><th scope="col">SP</th></tr></thead>
            <tbody>{view.combat.armor.map((armor) => (
              <tr key={armor.name}><th scope="row">{armor.name}</th><td>{armor.stoppingPower ?? '—'}</td></tr>
            ))}</tbody>
          </table>
        ) : <p class="print-empty">No armor equipped.</p>}
      </section>

      <section class="print-block print-skills">
        <h2>Trained skills</h2>
        {trainedSkills.length ? (
          <ul class="print-skill-list">{trainedSkills.map((skill) => (
            <li key={skill.name}><span>{skill.name}</span><strong>{skill.total}</strong></li>
          ))}</ul>
        ) : <p class="print-empty">No trained skills.</p>}
      </section>

      {cyberware.length > 0 && (
        <section class="print-block">
          <h2>Cyberware</h2>
          <ul class="print-list print-cyberware-list">{cyberware.map((entry, index) => (
            <li key={`${entry.name}-${index}`} style={{ paddingLeft: `${entry.depth * 5}mm` }}>{entry.name}</li>
          ))}</ul>
        </section>
      )}

      <section class="print-block print-gear">
        <h2>Gear</h2>
        <ul class="print-list">
          {/* Unarmed/martial-arts strikes are synthesized attack entries, not
              things the NPC is carrying — they belong in Attacks, not on a
              packing list. They are the only zero-price weapons. */}
          {view.npc.weapons.filter((item) => item.price > 0).map((item, index) => <li key={`w-${index}`}>{item.beautiful_name ?? item.name}</li>)}
          {view.npc.armor.map((item, index) => <li key={`a-${index}`}>{item.beautiful_name ?? item.name}</li>)}
          {inventory.map((entry, index) => (
            <li key={`i-${index}`}>{entry.amount > 1 ? `${entry.amount}× ` : ''}{entry.item.beautiful_name ?? entry.item.name}</li>
          ))}
        </ul>
      </section>

      {view.actions.length > 0 && (
        <section class="print-block"><h2>Actions</h2><ul class="print-list">{view.actions.map((action, index) => <li key={index}>{action}</li>)}</ul></section>
      )}
      {view.abilities.length > 0 && (
        <section class="print-block"><h2>Abilities</h2><ul class="print-list">{view.abilities.map((ability, index) => <li key={index}>{ability}</li>)}</ul></section>
      )}

      <footer class="print-foot">RED//OPS · {view.npc.name} {view.npc.surname} · seed {view.seed}</footer>
    </section>
  );
}

/** Flattens the cyberware tree to indented rows; paper has no disclosure widgets. */
function flattenCyberware(nodes: readonly InventoryNode[], depth = 0): Array<{ name: string; depth: number }> {
  return nodes.flatMap((node) => {
    if (node.item.default_hidden && node.children.length === 0) return [];
    return [
      { name: node.item.beautiful_name ?? node.item.name, depth },
      ...flattenCyberware(node.children, depth + 1),
    ];
  });
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
        <strong>{amount !== undefined ? `[${amount}] ` : ''}{item.beautiful_name ?? item.name}</strong>
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

function EmptyState({
  busy,
  status,
  progress,
  onImport,
  onBuild,
  canBuild,
}: {
  busy: boolean;
  status: string;
  progress: number;
  onImport: () => void;
  onBuild: () => void;
  canBuild: boolean;
}) {
  const pct = Math.round(progress * 100);
  return (
    <div class="empty panel">
      <div class="empty-glyph">R//</div>
      <h2>{busy ? 'Getting everything ready' : 'Ready to generate'}</h2>
      <p>{status}</p>
      <div
        class={busy ? 'progress is-busy' : 'progress'}
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <i style={{ width: `${pct}%` }} />
      </div>
      <div class={busy ? 'progress-readout is-busy' : 'progress-readout'}>
        <b>{pct}%</b>
        <span>{busy ? 'Establishing CitiNet link' : 'CitiNet link established'}</span>
      </div>
      {!busy && <div class="empty-actions">
        <button type="button" onClick={onImport}>Import NPC</button>
        <button type="button" disabled={!canBuild} onClick={onBuild}>Build from blank</button>
      </div>}
    </div>
  );
}

export function App() {
  const workerRef = useRef<Worker | null>(null);
  const resultRef = useRef<HTMLElement | null>(null);
  const importNpcInput = useRef<HTMLInputElement>(null);
  // Set when the user asks for a generate/reroll so the finished operative can be
  // scrolled into view. On a stacked phone layout the result sits below the
  // options panel, and without this the tap produced no visible change.
  const scrollToResultRef = useRef(false);
  // Requests whose results belong to a caller rather than to the sheet, keyed by
  // the id echoed back by the worker. Editor rerolls land here so an in-progress
  // draft is never replaced by a worker message aimed at something else.
  const pendingRequests = useRef(new Map<string, {
    resolve: (view: GeneratedNpcView) => void;
    reject: (error: Error) => void;
  }>());
  const [meta, setMeta] = useState<Meta | null>(null);
  const [options, setOptions] = useState<GenerateOptions>(loadSavedOptions);
  const [view, setView] = useState<GeneratedNpcView | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [status, setStatus] = useState('Loading game data…');
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
  // Set while editing an NPC that came from the library, so applying updates
  // that record instead of leaving the change only on screen.
  const [editingRecordId, setEditingRecordId] = useState<string | null>(null);
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
        return;
      }
      if (message.type === 'ready') {
        setMeta(message.meta);
        setBusy(false);
        setProgress(1);
        setStatus('Ready.');
        return;
      }
      if (message.type === 'generation-progress') {
        setBusy(true);
        setStatus(message.progress.stage);
        setProgress(message.progress.value);
        return;
      }

      const pending = message.requestId ? pendingRequests.current.get(message.requestId) : undefined;
      if (pending) {
        pendingRequests.current.delete(message.requestId!);
        setBusy(false);
        setProgress(1);
        if (message.type === 'result') {
          setStatus('Section replaced in the draft.');
          pending.resolve(message.view);
        } else {
          setStatus('Reroll failed.');
          pending.reject(new Error(message.error));
        }
        return;
      }

      if (message.type === 'result') {
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
    return () => {
      worker.terminate();
      for (const pending of pendingRequests.current.values()) pending.reject(new Error('The generator stopped.'));
      pendingRequests.current.clear();
    };
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

  /** Sends a worker request whose result is returned to the caller. */
  const requestReroll = useCallback((message: object) => new Promise<GeneratedNpcView>((resolve, reject) => {
    const worker = workerRef.current;
    if (!worker) {
      reject(new Error('The generator is not ready yet.'));
      return;
    }
    const requestId = crypto.randomUUID();
    pendingRequests.current.set(requestId, { resolve, reject });
    setBusy(true);
    setProgress(0);
    worker.postMessage({ ...message, requestId });
  }), []);

  const applyEditedNpc = useCallback((edited: GeneratedNpcView) => {
    setView(edited);
    setWarning(null);
    setStatus(`Applied changes to ${edited.npc.name} ${edited.npc.surname}.`);
    if (!editingRecordId) return;
    setEditingRecordId(null);
    void saveNpc(edited, editingRecordId)
      .then((saved) => {
        setSavedNpcs((current) => current.map((record) => record.id === saved.id ? saved : record));
        setLibraryError(null);
        setStatus(`Updated ${saved.label} in the local library.`);
      })
      .catch((error: unknown) => setLibraryError(error instanceof Error ? error.message : String(error)));
  }, [editingRecordId]);

  const restoreEditedNpc = useCallback((restored: GeneratedNpcView | null) => {
    setEditingRecordId(null);
    if (restored) {
      setView(restored);
      setStatus('Edit discarded.');
      return;
    }
    setStatus('Manual NPC discarded.');
  }, []);

  const editor = useNpcEditor({
    referenceEntries: entries,
    requestReroll,
    onApply: applyEditedNpc,
    onCancel: restoreEditedNpc,
  });

  // The draft is what the sheet renders while editing, so every derived panel,
  // export and print view previews the pending change without extra plumbing.
  const sheet = editor.draft ?? view;

  // Reveal a freshly generated operative on the stacked layout, where the result
  // panel starts off-screen. Above that width the two columns are both visible,
  // so scrolling would only yank the page out from under the user.
  useEffect(() => {
    if (!sheet || busy || !scrollToResultRef.current) return;
    scrollToResultRef.current = false;
    if (page !== 'generator') return;
    if (!window.matchMedia('(max-width: 1120px)').matches) return;
    resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [sheet, busy, page]);

  const filteredSkills = useMemo(() => {
    if (!sheet) return [];
    const query = skillSearch.trim().toLowerCase();
    return sheet.skills.filter((skill) =>
      (!trainedOnly || skill.base + skill.modifier > 0) &&
      (!query || skill.name.toLowerCase().includes(query) || skill.type.includes(query)),
    );
  }, [sheet, skillSearch, trainedOnly]);

  const generate = () => {
    if (!meta || busy || editor.editing) return;
    scrollToResultRef.current = true;
    setBusy(true);
    setFatal(null);
    setWarning(null);
    setProgress(0);
    setStatus('Generating NPC…');
    workerRef.current?.postMessage({ type: 'generate', options });
  };

  const update = <K extends keyof GenerateOptions>(key: K, value: GenerateOptions[K]) => {
    setOptions((current) => ({ ...current, [key]: value }));
  };

  const openEditor = () => {
    if (!view || busy) return;
    setEditingRecordId(null);
    setStatus('Editing this operative. Nothing is committed until you apply.');
    void editor.open(view);
  };

  const buildFromBlank = () => {
    if (busy || editor.editing) return;
    setEditingRecordId(null);
    setFatal(null);
    setWarning(null);
    setPage('generator');
    setTab('overview');
    setStatus('Building a new operative from a blank sheet.');
    void editor.openBlank();
  };

  // The print stylesheet swaps the tabbed screen UI for the always-rendered
  // <PrintSheet />, so printing no longer has to switch tabs and switch back.
  const printNpc = () => window.print();

  const saveCurrentNpc = async () => {
    if (!sheet) return;
    try {
      const record = await saveNpc(sheet);
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

  const editSavedNpc = (record: SavedNpcRecord) => {
    setView(record.view);
    setWarning(null);
    setFatal(null);
    setPage('generator');
    setTab('overview');
    setEditingRecordId(record.id);
    setStatus(`Editing ${record.label}. Applying updates the saved record.`);
    void editor.open(record.view);
  };

  const removeSavedNpc = async (record: SavedNpcRecord) => {
    try {
      await deleteSavedNpc(record.id);
      setSavedNpcs((current) => current.filter((candidate) => candidate.id !== record.id));
    } catch (error) {
      setLibraryError(error instanceof Error ? error.message : String(error));
    }
  };

  const addCurrentNpcToEncounter = () => {
    if (!sheet) return;
    const workspace = addNpcToActiveEncounter(loadEncounterWorkspace(), sheet);
    persistEncounterWorkspace(workspace);
    const encounter = workspace.encounters.find((candidate) => candidate.id === workspace.activeEncounterId);
    setStatus(`Added ${sheet.npc.name} ${sheet.npc.surname} to ${encounter?.name ?? 'the active encounter'}.`);
    setPage('encounter');
  };

  const importNpc = async (event: InputEvent) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      const imported = normalizeSavedNpcView(parseNativeExport(await file.text()));
      setView(imported);
      setOptions(imported.options);
      setWarning(null);
      setFatal(null);
      setPage('generator');
      setTab('overview');
      setStatus(`Imported ${imported.npc.name} ${imported.npc.surname} from ${file.name}.`);
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'The file could not be read.';
      window.alert(`Could not import NPC. ${detail}`);
    }
  };

  const foundryJson = sheet ? JSON.stringify(sheet.foundry, null, 2) : '';
  const nativeJson = sheet ? JSON.stringify(createNativeExport(sheet), null, 2) : '';
  const markdown = sheet ? createMarkdownExport(sheet) : '';
  const filename = sheet ? `${sheet.npc.name}-${sheet.npc.surname}`.replace(/[^a-z0-9-]+/gi, '-').toLowerCase() : 'npc';
  // Informational findings are content-maintenance diagnostics. Keep them on
  // the generated view for native exports, but only surface issues the GM can
  // act on here.
  const characterIssues = sheet?.validation.filter((issue) => issue.severity !== 'info') ?? [];
  const errorCount = characterIssues.filter((issue) => issue.severity === 'error').length;
  const warningCount = characterIssues.filter((issue) => issue.severity === 'warning').length;
  const checkState = errorCount ? 'has-errors' : warningCount ? 'has-warnings' : 'valid';
  const checkLabel = errorCount
    ? `${errorCount} ${errorCount === 1 ? 'error' : 'errors'}`
    : `${warningCount} ${warningCount === 1 ? 'warning' : 'warnings'}`;
  const aiConfigurationIssue = options.allow_description
    ? !options.model_id
      ? 'Enter a model ID to generate an AI description.'
      : !options.model_base_url
        ? 'Enter an OpenAI-compatible base URL to generate an AI description.'
        : null
    : null;

  return (
    <main class={`shell page-${page}${editor.editing ? ' is-editing' : ''}`}>
      <header class="topbar panel">
        <div class="brand-mark">R//</div>
        <div class="brand-copy">
          <h1>RED<span>//OPS</span></h1>
          <p>Cyberpunk RED NPC generator and encounter runner</p>
        </div>
        <nav class="primary-nav" aria-label="Primary">
          {PAGES.map((name, index) => (
            <button
              key={name}
              class={page === name ? 'active' : ''}
              disabled={editor.editing && name !== 'generator'}
              onClick={() => setPage(name)}
            ><span class="nav-key">{String(index + 1).padStart(2, '0')}</span><span>{pretty(name)}</span></button>
          ))}
        </nav>
        <div class="topbar-utilities">
          <ThemePicker theme={theme} onChange={changeTheme} />
          <div class="engine-state">
            <i class={busy ? 'loading' : fatal ? 'error' : 'ready'} />
            <span>{fatal ? 'ENGINE FAULT' : busy ? 'PROCESSING' : 'ONLINE'}</span>
          </div>
        </div>
      </header>

      {page === 'encounter' ? (
        <EncounterTracker currentNpc={sheet} savedNpcs={savedNpcs} referenceEntries={entries} />
      ) : page === 'reference' ? (
        <ReferenceBrowser entries={entries} manifest={meta?.referenceManifest ?? null} onSelect={(entry) => setSelectedReference({ entry })} />
      ) : page === 'library' ? (
        <NpcLibrary
          records={savedNpcs}
          error={libraryError}
          busy={editor.opening}
          onOpen={openSavedNpc}
          onEdit={editSavedNpc}
          onCreate={buildFromBlank}
          onDelete={(record) => void removeSavedNpc(record)}
        />
      ) : (
        <div class="layout">
          <aside class="controls panel" inert={editor.editing}>
            <div class="panel-heading"><h2>Generator matrix</h2><span>01</span></div>
            <div class="control-body">
              <div class="field-grid">
                <label><span>Rank</span><select value={options.rank} disabled={!meta || busy} onChange={(event: SelectEvent) => update('rank', event.currentTarget.value)}>
                  {(meta?.ranks ?? [options.rank]).map((rank) => <option key={rank} value={rank}>{pretty(rank)}</option>)}
                </select></label>
                <label><span>Role</span><select value={options.role} disabled={!meta || busy} onChange={(event: SelectEvent) => update('role', event.currentTarget.value)}>
                  {(meta?.roles ?? [options.role]).map((role) => <option key={role} value={role}>{pretty(role)}</option>)}
                </select></label>
                <label class="wide"><span>Nationality</span><select value={options.nationality ?? ''} disabled={!meta || busy} onChange={(event: SelectEvent) => update('nationality', event.currentTarget.value || null)}>
                  <option value="">Choose automatically</option>
                  {meta?.nationalities.map((locale) => <option key={locale} value={locale}>{locale}</option>)}
                </select></label>
                <label class="wide"><span>Seed · 0 for random</span><input type="number" value={options.seed} disabled={busy} onInput={(event: InputEvent) => update('seed', Number(event.currentTarget.value))} /></label>
              </div>

              <div class="rule-heading"><h3>Include</h3><button type="button" onClick={() => setOptions((current) => ({ ...current, ...DEFAULT_RULES }))}>Reset</button></div>
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
                  <label class="toggle standalone"><span>Generate description</span><input type="checkbox" checked={options.allow_description} onChange={(event: InputEvent) => update('allow_description', event.currentTarget.checked)} /><i /></label>
                  <label><span>Model ID</span><input value={options.model_id ?? ''} placeholder="disabled" onInput={(event: InputEvent) => update('model_id', event.currentTarget.value || null)} /></label>
                  <label><span>API key · optional</span><input type="password" value={options.model_api_key ?? ''} placeholder="not stored" onInput={(event: InputEvent) => update('model_api_key', event.currentTarget.value || null)} /></label>
                  <label><span>Base URL</span><input value={options.model_base_url ?? ''} placeholder="http://localhost:11434/v1" onInput={(event: InputEvent) => update('model_base_url', event.currentTarget.value || null)} /></label>
                  <label><span>Language</span><input value={options.model_language} onInput={(event: InputEvent) => update('model_language', event.currentTarget.value)} /></label>
                </div>
                {aiConfigurationIssue && <p class="warning">{aiConfigurationIssue}</p>}
                <p>Requests go directly from the browser. For Ollama, use <code>http://localhost:11434/v1</code>; no API key is needed. API keys are kept only in memory and are not stored locally.</p>
              </details>

              <label class="toggle standalone"><span>Simplified text layout</span><input type="checkbox" checked={options.flat} onChange={(event: InputEvent) => update('flat', event.currentTarget.checked)} /><i /></label>
              <button class="generate" type="button" disabled={!meta || busy || editor.editing} onClick={generate}>{busy ? 'Fabricating…' : 'Generate NPC'}</button>
              <button class="build-blank" type="button" disabled={!meta || busy || editor.editing} onClick={buildFromBlank}>Build from blank</button>
            </div>
          </aside>

          <section class="workspace" ref={resultRef}>
            {fatal && <div class="fatal panel"><strong>Engine fault</strong><pre>{fatal}</pre></div>}
            {!sheet && !fatal && <EmptyState
              busy={busy}
              status={status}
              progress={progress}
              canBuild={Boolean(meta) && !editor.opening}
              onImport={() => importNpcInput.current?.click()}
              onBuild={buildFromBlank}
            />}
            {sheet && (
              <div class="sheet panel">
                <header class="sheet-head">
                  <div class="sheet-title">
                    <span class="kicker">{pretty(sheet.rank.name)} · {pretty(sheet.role.name)}</span>
                    <h2>{sheet.npc.name} {sheet.npc.surname}</h2>
                    <div class="chips">
                      <span>{sheet.npc.sex ? 'Male' : 'Female'}</span>
                      <span>{sheet.npc.nationality}</span>
                      <span>{sheet.npc.age} yo</span>
                      <span>Trauma Team {pretty(sheet.npc.traumaTeamStatus.toLowerCase())}</span>
                      <span>{sheet.totalPrice}eb loadout</span>
                      <span>Seed {sheet.seed}</span>
                    </div>
                  </div>
                  <div class="sheet-actions">
                    {editor.editing ? (
                      <span class="sheet-editing-badge">Editing draft</span>
                    ) : <>
                      <button type="button" class="primary-action" disabled={busy || editor.opening} onClick={openEditor}>{editor.opening ? 'Loading editor…' : 'Edit NPC'}</button>
                      <button type="button" onClick={addCurrentNpcToEncounter}>Add to encounter</button>
                      <button type="button" onClick={() => void saveCurrentNpc()}>Save</button>
                      <button type="button" onClick={() => setTab('export')}>Export</button>
                      <button type="button" onClick={() => importNpcInput.current?.click()}>Import</button>
                    </>}
                  </div>
                </header>

                {/* The numbers a GM reaches for mid-scene stay visible on every
                    tab instead of living inside one of them. */}
                <dl class={`sheet-vitals${characterIssues.length ? ' has-character-issues' : ''}`}>
                  <div><dt><GlossaryTerm id="HP">HP</GlossaryTerm></dt><dd>{sheet.combat.hitPoints}</dd></div>
                  <div><dt>Seriously Wounded</dt><dd>{sheet.hp.painEditor ? 'Pain Editor' : sheet.combat.seriouslyWounded ?? '—'}</dd></div>
                  <div><dt>Initiative</dt><dd>+{sheet.combat.initiative}</dd></div>
                  <div><dt>Death Save</dt><dd>{sheet.combat.deathSave}</dd></div>
                  {characterIssues.length > 0 && <div class={`sheet-check ${checkState}`}><dt>Character check</dt><dd>
                    <button type="button" onClick={() => setTab('overview')}>{checkLabel}</button>
                  </dd></div>}
                </dl>

                {(sheet.profileSummary || warning || editor.error) && <div class="sheet-brief">
                  {sheet.profileSummary && <p class="description">{sheet.profileSummary}</p>}
                  {warning && <p class="warning">{warning}</p>}
                  {editor.error && !editor.editing && <p class="warning" role="alert">{editor.error}</p>}
                </div>}

                <nav class="tabs">
                  {TABS.map((name) => <button key={name} class={tab === name ? 'active' : ''} onClick={() => setTab(name)}>{pretty(name)}</button>)}
                </nav>

                <PrintSheet view={sheet} />

                {tab === 'overview' && <section class="tab-content overview-grid">
                  {editor.editing && editor.catalog && <>
                    <div class="span-all"><IdentityEditor view={sheet} editor={editor} catalog={editor.catalog} /></div>
                    <div class="span-all"><StatsEditor view={sheet} editor={editor} /></div>
                  </>}

                  {!editor.editing && <article class="card span-all">
                    <header><h3>Stats</h3><span>base + modifiers</span></header>
                    <div class="stats-grid">
                      {sheet.stats.map((stat) => <div key={stat.name} class="stat">
                        <span>{stat.name}</span>
                        <strong>{stat.total}</strong>
                        <small>{stat.modifier ? `${stat.base} ${stat.modifier >= 0 ? '+' : ''}${stat.modifier}` : `base ${stat.base}`}</small>
                      </div>)}
                    </div>
                  </article>}

                  <article class="card"><header><h3>Conditions</h3></header><div class="conditions">
                    {sheet.conditions.map((condition) => <div key={condition.label} class={condition.value ? 'ok' : ''}><i>{condition.value ? '✓' : '×'}</i><span>{condition.label}<small>{condition.source ?? 'Not available'}</small></span></div>)}
                  </div></article>

                  {characterIssues.length > 0 && <article class={`card validation-card ${checkState}`}>
                    <header><h3>Character check</h3><span>{checkLabel}</span></header>
                    <div class="validation-list">{characterIssues.map((issue, index) => (
                        <article key={`${issue.code}-${issue.subject}-${index}`} class={`validation-issue ${issue.severity}`}>
                          <span>{issue.severity}</span>
                          <div><strong>{issue.subject ?? issue.code}</strong><p>{issue.message}</p>{issue.suggestedAction && <small>{issue.suggestedAction}</small>}</div>
                        </article>
                      ))}</div>
                  </article>}

                  <article class="card"><header><h3>Actions</h3></header><div class="tags large">{sheet.actions.length ? sheet.actions.map((action, index) => <span key={`${action}-${index}`}>{action}</span>) : <em>None</em>}</div></article>
                  <article class="card"><header><h3>Abilities</h3></header><div class="tags large">{sheet.abilities.length ? sheet.abilities.map((ability, index) => <span key={`${ability}-${index}`}>{ability}</span>) : <em>None</em>}</div></article>

                  <article class="card span-all revision-log">
                    <header><h3>Change history</h3><span>{sheet.revisions.length} entries</span></header>
                    {sheet.revisions.length
                      ? <ol>{[...sheet.revisions].reverse().map((revision, index) => (
                        <li key={`${revision.createdAt}-${index}`}>
                          <strong>{pretty(revision.section)}</strong>
                          <span>{revision.seed !== undefined ? `variation ${revision.seed}` : revision.command}</span>
                          <time>{new Date(revision.createdAt).toLocaleString()}</time>
                        </li>
                      ))}</ol>
                      : <p class="muted">No rerolls or manual changes yet.</p>}
                  </article>

                  {editor.editing && <div class="span-all"><RawNpcEditor view={sheet} editor={editor} /></div>}
                </section>}

                {tab === 'combat' && <section class="tab-content combat-layout">
                  {editor.editing && <p class="editor-note">Combat values are derived. Change stats, weapons, armor, or cyberware and they update here.</p>}
                  <article class="combat-section"><h3>Armor</h3><div class="combat-list">{sheet.combat.armor.length ? sheet.combat.armor.map((armor) => <div key={armor.name}><strong>{armor.name}</strong><span><GlossaryTerm id="SP">SP</GlossaryTerm> {armor.stoppingPower ?? '—'}</span></div>) : <p class="muted">No armor equipped.</p>}</div></article>
                  <article class="combat-section"><h3>Attacks</h3><div class="attack-grid">{sheet.combat.attacks.length ? sheet.combat.attacks.map((attack) => {
                    const item = sheet.npc.weapons.find((weapon) => weapon.name === attack.name);
                    const reference = item ? findCatalogEntry(entries, { name: item.name, type: item.type, quality: item.quality }) : undefined;
                    return <button key={attack.name} type="button" class="attack-card" disabled={!reference} onClick={() => reference && setSelectedReference({ entry: reference, reason: reasonFor(sheet, reference, attack.name) })}>
                      <header><strong>{attack.name}</strong><span>{attack.skill ?? 'Unmapped'}</span></header>
                      <div><span>Attack</span><strong>{attack.attackBase ?? '—'}</strong></div>
                      {attack.autofireBase !== null && <div><span>Autofire</span><strong>{attack.autofireBase}</strong></div>}
                      <div><span>Damage</span><strong>{attack.damage ?? '—'}</strong></div>
                      <div><span><GlossaryTerm id="ROF">ROF</GlossaryTerm></span><strong>{attack.rateOfFire ?? '—'}</strong></div>
                      <div><span>MAG</span><strong>{attack.magazine ?? '—'}</strong></div>
                      <p>{attack.explanation}</p>
                    </button>;
                  }) : <p class="muted">No attacks.</p>}</div></article>
                </section>}

                {tab === 'skills' && (editor.editing
                  ? <section class="tab-content"><SkillsEditor view={sheet} editor={editor} /></section>
                  : <section class="tab-content">
                    <div class="skill-tools"><input type="search" placeholder="Filter skills" value={skillSearch} onInput={(event: InputEvent) => setSkillSearch(event.currentTarget.value)} /><button class={trainedOnly ? 'active' : ''} onClick={() => setTrainedOnly((value) => !value)}>Trained only</button></div>
                    <div class="skill-groups">{SKILL_TYPES.map((type: SkillType) => {
                      const skills = filteredSkills.filter((skill) => skill.type === type);
                      return skills.length ? <article key={type}><h3>{pretty(type)}</h3>{skills.map((skill) => {
                        const reference = findCatalogEntry(entries, { name: skill.name, type: 'skill' });
                        return <button key={skill.name} type="button" class="skill" disabled={!reference} onClick={() => reference && setSelectedReference({ entry: reference })}><span>{skill.name}<small>{skill.link} {skill.base}{skill.modifier ? ` ${skill.modifier >= 0 ? '+' : ''}${skill.modifier}` : ''}</small></span><strong>{skill.total}</strong></button>;
                      })}</article> : null;
                    })}</div>
                  </section>)}

                {tab === 'gear' && (editor.editing && editor.catalog
                  ? <section class="tab-content">
                    <GearEditor view={sheet} editor={editor} catalog={editor.catalog} />
                    <CyberwareEditor view={sheet} editor={editor} catalog={editor.catalog} />
                  </section>
                  : <section class="tab-content gear-layout">
                    <div class="gear-grid">
                      <article><h3>Armor</h3>{sheet.npc.armor.length ? sheet.npc.armor.map((item, index) => <ItemCard key={`${item.name}-${index}`} item={item} entries={entries} view={sheet} onSelect={setSelectedReference} />) : <p class="muted">None</p>}</article>
                      <article><h3>Weapons</h3>{sheet.npc.weapons.length ? sheet.npc.weapons.map((item, index) => <ItemCard key={`${item.name}-${index}`} item={item} entries={entries} view={sheet} onSelect={setSelectedReference} />) : <p class="muted">None</p>}</article>
                      <article><h3>Inventory</h3>{sheet.npc.inventory.size ? [...sheet.npc.inventory.values()].map((entry, index) => <ItemCard key={`${entry.item.name}-${index}`} item={entry.item} amount={entry.amount} entries={entries} view={sheet} onSelect={setSelectedReference} />) : <p class="muted">None</p>}</article>
                    </div>
                    <article class="gear-cyberware">
                      <h3>Cyberware</h3>
                      {sheet.npc.cyberware.children.length
                        ? sheet.npc.cyberware.children.map((node, index) => <CyberwareNode key={`${node.item.id}-${index}`} node={node} entries={entries} view={sheet} onSelect={setSelectedReference} />)
                        : <p class="muted">No cyberware installed.</p>}
                    </article>
                  </section>)}

                {tab === 'export' && <section class="tab-content export-layout">
                  <div class="export-grid">
                    <article><span>Backup</span><h3>NPC file</h3><p>Save the complete NPC so you can import it again later.</p><div><button onClick={() => copyText(nativeJson)}>Copy</button><button onClick={() => download(`${filename}.json`, nativeJson, 'application/json')}>Download</button></div></article>
                    <article><span>Share</span><h3>Markdown</h3><p>Copy the stat block into notes, campaign documents, or chat.</p><div><button onClick={() => copyText(markdown)}>Copy</button><button onClick={() => download(`${filename}.md`, markdown, 'text/markdown')}>Download</button></div></article>
                    <article><span>Foundry VTT</span><h3>Foundry JSON</h3><p>Import this NPC into Foundry.</p><div><button onClick={() => copyText(foundryJson)}>Copy</button><button onClick={() => download(`${filename}-foundry.json`, foundryJson, 'application/json')}>Download</button></div></article>
                    <article><span>Print</span><h3>Print sheet</h3><p>Print the operative or save it as a PDF.</p><div><button onClick={printNpc}>Print</button></div></article>
                    <article><span>Repeat</span><h3>Generator command</h3><p>Create this NPC again with the same choices.</p><div><button onClick={() => copyText(sheet.command)}>Copy command</button></div></article>
                  </div>
                  <article class="code-pane">
                    <header><h3>Statblock text</h3><div><button onClick={() => copyText(sheet.text)}>Copy text</button><button onClick={() => download(`${filename}.txt`, sheet.text, 'text/plain')}>Download</button></div></header>
                    <pre>{sheet.text}</pre>
                  </article>
                </section>}

                {editor.editing && <EditorActionBar view={sheet} editor={editor} />}
              </div>
            )}
          </section>
        </div>
      )}
      <footer class="app-footer">
        <span><b>RED//OPS</b> - RAPID ENCOUNTER DEPLOYMENT</span>
        <span>UNOFFICIAL FAN UTILITY · <a href="https://github.com/Eppinguin/red-ops" target="_blank" rel="noreferrer">GITHUB</a></span>
        <span>GEN {meta?.commit.slice(0, 8) ?? 'LOADING'} · DATA {meta?.referenceManifest.foundry?.ref ?? 'FALLBACK'}</span>
      </footer>
      <input ref={importNpcInput} hidden type="file" accept=".json,application/json" onChange={importNpc} />
      <DetailDrawer selected={selectedReference} onClose={() => setSelectedReference(null)} />
    </main>
  );
}
