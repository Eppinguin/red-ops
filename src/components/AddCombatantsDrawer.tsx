import type { TargetedEvent } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { CatalogEntry } from '../content/types';
import { combatantFromNpc, createPcCombatant } from '../encounter/model';
import {
  createOfficialCombatant,
  genericNpcTemplates,
  type GenericNpcTemplateSummary,
  type OfficialNpcTemplateId,
} from '../encounter/officialNpcs';
import type { RandomEncounterResult } from '../encounter/randomEncounters';
import type { CombatantSide, EncounterAction, EncounterCombatant, OfficialNpcTier } from '../encounter/types';
import type { GeneratedNpcView } from '../engine/types';
import type { SavedNpcRecord } from '../storage';
import { RandomEncounterPanel } from './RandomEncounterBuilder';

type InputEvent = TargetedEvent<HTMLInputElement>;
type SelectEvent = TargetedEvent<HTMLSelectElement>;
type KeyboardInputEvent = TargetedEvent<HTMLInputElement, KeyboardEvent>;
type MouseDivEvent = TargetedEvent<HTMLDivElement, MouseEvent>;

export type AddTab = 'statblocks' | 'roster' | 'random';

interface AddCombatantsDrawerProps {
  currentNpc: GeneratedNpcView | null;
  savedNpcs: readonly SavedNpcRecord[];
  referenceEntries: readonly CatalogEntry[];
  defaultPartySize: number;
  dispatch: (action: EncounterAction) => void;
  onAddRandomToCurrent: (result: RandomEncounterResult, combatants: EncounterCombatant[]) => void;
  onCreatePreparedFromRandom: (result: RandomEncounterResult, combatants: EncounterCombatant[]) => void;
  tab: AddTab;
  onTabChange: (tab: AddTab) => void;
  onClose: () => void;
}

const TIER_ORDER: readonly OfficialNpcTier[] = ['mook', 'lieutenant', 'mini-boss', 'boss'];
const TIER_LABELS: Record<OfficialNpcTier, string> = {
  mook: 'Mooks',
  lieutenant: 'Lieutenants',
  'mini-boss': 'Mini-bosses',
  boss: 'Bosses',
};
const SIDES: readonly CombatantSide[] = ['enemy', 'neutral', 'ally', 'player'];

const TABS: ReadonlyArray<{ id: AddTab; label: string; hint: string }> = [
  { id: 'statblocks', label: 'Stat blocks', hint: 'Official generic NPCs' },
  { id: 'roster', label: 'Your roster', hint: 'Generated NPCs and players' },
  { id: 'random', label: 'Roll encounter', hint: 'Random Night City scene' },
];

/**
 * Adding is a repeated action: a GM adds three mooks, glances at the turn
 * order, then adds two more. The disposition and count therefore persist as
 * drawer-level state rather than living inside each individual add form.
 */
function AddModeBar({ side, count, onSide, onCount }: {
  side: CombatantSide;
  count: number;
  onSide: (side: CombatantSide) => void;
  onCount: (count: number) => void;
}) {
  return (
    <div class="add-mode-bar">
      <div class="add-mode-sides" role="group" aria-label="Disposition for combatants added next">
        {SIDES.map((candidate) => (
          <button
            type="button"
            key={candidate}
            class={`add-side-chip ${candidate} ${candidate === side ? 'active' : ''}`}
            aria-pressed={candidate === side}
            onClick={() => onSide(candidate)}
          >{candidate}</button>
        ))}
      </div>
      <div class="add-mode-count">
        <span>Count</span>
        <button type="button" aria-label="One fewer" disabled={count <= 1} onClick={() => onCount(count - 1)}>−</button>
        <input
          type="number"
          min="1"
          max="20"
          aria-label="How many to add"
          value={count}
          onInput={(event: InputEvent) => onCount(Math.max(1, Math.min(20, Math.trunc(Number(event.currentTarget.value)) || 1)))}
        />
        <button type="button" aria-label="One more" disabled={count >= 20} onClick={() => onCount(count + 1)}>+</button>
      </div>
    </div>
  );
}

function StatBlockPicker({ side, count, referenceEntries, dispatch, onAdded }: {
  side: CombatantSide;
  count: number;
  referenceEntries: readonly CatalogEntry[];
  dispatch: (action: EncounterAction) => void;
  onAdded: (message: string) => void;
}) {
  const templates = useMemo(genericNpcTemplates, []);
  const [query, setQuery] = useState('');
  const grouped = useMemo(() => {
    const search = query.trim().toLowerCase();
    const matches = templates.filter((template) => !search
      || template.name.toLowerCase().includes(search)
      || template.tier.includes(search)
      || template.weapons.some((weapon) => weapon.toLowerCase().includes(search)));
    return TIER_ORDER
      .map((tier) => ({ tier, templates: matches.filter((template) => template.tier === tier) }))
      .filter((group) => group.templates.length > 0);
  }, [templates, query]);

  const add = (template: GenericNpcTemplateSummary) => {
    const combatants = Array.from({ length: count }, (_, index) => createOfficialCombatant(template.id as OfficialNpcTemplateId, {
      name: count > 1 ? `${template.name} ${index + 1}` : template.name,
      side,
      referenceEntries,
      notes: 'Added manually from the generic NPC statblock library.',
    }));
    dispatch({ type: 'add-combatants', combatants, source: `${template.name} stat block` });
    onAdded(`Added ${count} × ${template.name}`);
  };

  return (
    <div class="statblock-picker">
      <input
        type="search"
        class="add-search"
        placeholder="Filter stat blocks…"
        aria-label="Filter stat blocks"
        value={query}
        onInput={(event: InputEvent) => setQuery(event.currentTarget.value)}
      />
      {grouped.length ? grouped.map((group) => (
        <section class="statblock-tier" key={group.tier}>
          <h4>{TIER_LABELS[group.tier]}</h4>
          <div class="statblock-card-grid">
            {group.templates.map((template) => (
              <button type="button" class={`statblock-card tier-${group.tier}`} key={template.id} onClick={() => add(template)}>
                <span class="statblock-card-name">{template.name}</span>
                <span class="statblock-card-vitals">
                  <b>HP {template.hp}</b>
                  <b>SP {template.bodySp}/{template.headSp}</b>
                </span>
                <span class="statblock-card-loadout">{template.weapons.slice(0, 2).join(' · ') || 'No weapons listed'}</span>
                <span class="statblock-card-add" aria-hidden="true">+{count > 1 ? ` ${count}` : ''}</span>
              </button>
            ))}
          </div>
        </section>
      )) : <p class="add-empty">No stat block matches “{query}”.</p>}
    </div>
  );
}

function RosterPanel({ currentNpc, savedNpcs, side, count, dispatch, onAdded }: {
  currentNpc: GeneratedNpcView | null;
  savedNpcs: readonly SavedNpcRecord[];
  side: CombatantSide;
  count: number;
  dispatch: (action: EncounterAction) => void;
  onAdded: (message: string) => void;
}) {
  const [pcName, setPcName] = useState('');
  const [showVitals, setShowVitals] = useState(false);
  const [pcInitiative, setPcInitiative] = useState('');
  const [pcBase, setPcBase] = useState('');
  const [pcHp, setPcHp] = useState('');
  const [pcBody, setPcBody] = useState('');
  const [pcHead, setPcHead] = useState('');
  const pcNameRef = useRef<HTMLInputElement | null>(null);

  const addNpcView = (view: GeneratedNpcView, label: string) => {
    const combatants = Array.from({ length: count }, (_, index) => {
      const combatant = combatantFromNpc(view);
      return {
        ...combatant,
        name: count > 1 ? `${combatant.name} ${index + 1}` : combatant.name,
        side,
      };
    });
    dispatch({ type: 'add-combatants', combatants, source: label });
    onAdded(`Added ${count} × ${label}`);
  };

  // Players are added one at a time by name, so Enter re-focuses the field for
  // the next name rather than clearing the form and dropping focus.
  const addPc = () => {
    const name = pcName.trim();
    if (!name) return;
    dispatch({ type: 'add-combatant', combatant: createPcCombatant({
      name,
      initiative: pcInitiative === '' ? null : Number(pcInitiative),
      initiativeBase: pcBase === '' ? null : Number(pcBase),
      maxHp: pcHp === '' ? null : Number(pcHp),
      bodySp: pcBody === '' ? 0 : Number(pcBody),
      headSp: pcHead === '' ? 0 : Number(pcHead),
    }) });
    onAdded(`Added ${name}`);
    setPcName(''); setPcInitiative(''); setPcBase(''); setPcHp(''); setPcBody(''); setPcHead('');
    pcNameRef.current?.focus();
  };

  return (
    <div class="roster-panel">
      <section class="add-section">
        <h4>Player characters</h4>
        <p>Type a name and press Enter. Vitals are optional — HP and armour stay editable in the turn order.</p>
        <div class="pc-quick-add">
          <input
            ref={pcNameRef}
            class="pc-name-input"
            placeholder="Player name"
            aria-label="Player name"
            value={pcName}
            onInput={(event: InputEvent) => setPcName(event.currentTarget.value)}
            onKeyDown={(event: KeyboardInputEvent) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                addPc();
              }
            }}
          />
          <button type="button" class="primary-action" disabled={!pcName.trim()} onClick={addPc}>Add player</button>
        </div>
        <button
          type="button"
          class="add-vitals-toggle"
          aria-expanded={showVitals}
          onClick={() => setShowVitals((value) => !value)}
        >{showVitals ? '− Hide optional vitals' : '+ Add vitals now'}</button>
        {showVitals && <div class="pc-vitals-fields">
          <label><span>Initiative</span><input type="number" value={pcInitiative} onInput={(event: InputEvent) => setPcInitiative(event.currentTarget.value)} /></label>
          <label><span>REF / base</span><input type="number" value={pcBase} onInput={(event: InputEvent) => setPcBase(event.currentTarget.value)} /></label>
          <label><span>Max HP</span><input type="number" value={pcHp} onInput={(event: InputEvent) => setPcHp(event.currentTarget.value)} /></label>
          <label><span>Body SP</span><input type="number" value={pcBody} onInput={(event: InputEvent) => setPcBody(event.currentTarget.value)} /></label>
          <label><span>Head SP</span><input type="number" value={pcHead} onInput={(event: InputEvent) => setPcHead(event.currentTarget.value)} /></label>
        </div>}
      </section>

      <section class="add-section">
        <h4>Generated NPCs</h4>
        <p>Each copy gets independent HP, armour, ammo, notes, and initiative.</p>
        {currentNpc ? (
          <button
            type="button"
            class="roster-card current"
            onClick={() => addNpcView(currentNpc, `${currentNpc.npc.name} ${currentNpc.npc.surname}`)}
          >
            <span class="roster-card-tag">Current operative</span>
            <span class="roster-card-name">{currentNpc.npc.name} {currentNpc.npc.surname}</span>
            <span class="roster-card-meta">{currentNpc.rank.name} · {currentNpc.role.name}</span>
            <span class="statblock-card-add" aria-hidden="true">+{count > 1 ? ` ${count}` : ''}</span>
          </button>
        ) : (
          <p class="add-empty">No operative generated yet. Build one on the Generator page to add it here.</p>
        )}
        {savedNpcs.length > 0 && <div class="roster-saved-list">
          {savedNpcs.map((record) => (
            <button type="button" class="roster-card" key={record.id} onClick={() => addNpcView(record.view, record.label)}>
              <span class="roster-card-tag">Saved</span>
              <span class="roster-card-name">{record.label}</span>
              <span class="roster-card-meta">{record.view.rank.name} · {record.view.role.name}</span>
              <span class="statblock-card-add" aria-hidden="true">+{count > 1 ? ` ${count}` : ''}</span>
            </button>
          ))}
        </div>}
      </section>
    </div>
  );
}

export function AddCombatantsDrawer({
  currentNpc,
  savedNpcs,
  referenceEntries,
  defaultPartySize,
  dispatch,
  onAddRandomToCurrent,
  onCreatePreparedFromRandom,
  tab,
  onTabChange,
  onClose,
}: AddCombatantsDrawerProps) {
  const [side, setSide] = useState<CombatantSide>('enemy');
  const [count, setCount] = useState(1);
  const [toast, setToast] = useState<string | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  useEffect(() => {
    panelRef.current?.querySelector<HTMLElement>('input, button')?.focus();
  }, []);

  // The confirmation replaces itself on each add so rapid adds do not stack up.
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  return (
    <div
      class="add-drawer-backdrop"
      onMouseDown={(event: MouseDivEvent) => event.currentTarget === event.target && onClose()}
    >
      <aside
        class={`add-drawer panel ${tab === 'random' ? 'wide' : ''}`}
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Add combatants to this encounter"
      >
        <header class="add-drawer-header">
          <div>
            <span class="kicker">Add to encounter</span>
            <h2>{TABS.find((entry) => entry.id === tab)?.hint}</h2>
          </div>
          <button type="button" class="icon-button" onClick={onClose} aria-label="Close">×</button>
        </header>

        <nav class="add-drawer-tabs" role="tablist" aria-label="What to add">
          {TABS.map((entry) => (
            <button
              type="button"
              role="tab"
              key={entry.id}
              aria-selected={entry.id === tab}
              class={entry.id === tab ? 'active' : ''}
              onClick={() => onTabChange(entry.id)}
            >{entry.label}</button>
          ))}
        </nav>

        {tab !== 'random' && <AddModeBar side={side} count={count} onSide={setSide} onCount={setCount} />}

        <div class="add-drawer-body">
          {tab === 'statblocks' && <StatBlockPicker
            side={side}
            count={count}
            referenceEntries={referenceEntries}
            dispatch={dispatch}
            onAdded={setToast}
          />}
          {tab === 'roster' && <RosterPanel
            currentNpc={currentNpc}
            savedNpcs={savedNpcs}
            side={side}
            count={count}
            dispatch={dispatch}
            onAdded={setToast}
          />}
          {tab === 'random' && <RandomEncounterPanel
            referenceEntries={referenceEntries}
            defaultPartySize={defaultPartySize}
            onAddToCurrent={(result, combatants) => {
              onAddRandomToCurrent(result, combatants);
              setToast(`Added ${combatants.length} combatants to this encounter`);
            }}
            onCreatePrepared={(result, combatants) => {
              onCreatePreparedFromRandom(result, combatants);
              onClose();
            }}
          />}
        </div>

        <footer class="add-drawer-footer">
          <span class={`add-toast ${toast ? 'visible' : ''}`} role="status">{toast ?? ''}</span>
          <button type="button" class="primary-action" onClick={onClose}>Done</button>
        </footer>
      </aside>
    </div>
  );
}
