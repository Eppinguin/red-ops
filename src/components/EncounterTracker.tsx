import type { TargetedEvent } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  CRITICAL_INJURIES,
  createCriticalInjury,
  type CriticalInjuryDefinition,
} from '../encounter/criticalInjuries';
import {
  CONDITION_DEFINITIONS,
  automaticStatusDescription,
  conditionDescription,
  createCondition,
} from '../encounter/conditions';
import {
  attackPenalty,
  calculateDamage,
  canDodgeRanged,
  combatantPenalty,
  createEmptyEncounter,
  deathSaveTarget,
  encounterReducer,
  isSeriouslyWounded,
  sortCombatants,
} from '../encounter/model';
import { loadEncounterWorkspace, parseEncounterImport, persistEncounterWorkspace } from '../encounter/storage';
import { rangeDv, validRangeBands } from '../encounter/rangeDvs';
import { AttackResolverDialog } from './AttackResolverDialog';
import { RangeDvDialog } from './RangeDvDialog';
import { randomEncounterBrief } from './RandomEncounterBuilder';
import { AddCombatantsDrawer, type AddTab } from './AddCombatantsDrawer';
import { useMediaQuery, useScrollLock } from './useScrollLock';
import type { RandomEncounterResult } from '../encounter/randomEncounters';
import type { CatalogEntry } from '../content/types';
import type {
  ArmorLocation,
  CriticalInjury,
  EncounterAction,
  EncounterAttack,
  EncounterCombatant,
  EncounterCondition,
  EncounterState,
  EncounterWorkspace,
} from '../encounter/types';
import type { GeneratedNpcView, InventoryNode } from '../engine/types';
import type { SavedNpcRecord } from '../storage';

interface EncounterTrackerProps {
  currentNpc: GeneratedNpcView | null;
  savedNpcs: readonly SavedNpcRecord[];
  referenceEntries: readonly CatalogEntry[];
}

type InputEvent = TargetedEvent<HTMLInputElement>;
type SelectEvent = TargetedEvent<HTMLSelectElement>;
type TextAreaEvent = TargetedEvent<HTMLTextAreaElement>;
type KeyboardInputEvent = TargetedEvent<HTMLInputElement, KeyboardEvent>;
type MouseDivEvent = TargetedEvent<HTMLDivElement, MouseEvent>;

function uiId(prefix: string): string {
  return typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${prefix}-${Date.now()}-${Math.random()}`;
}

type RowDensity = 'compact' | 'comfortable';
const DENSITY_KEY = 'red-ops.encounter-density.v1';

function loadDensity(): RowDensity {
  try {
    return localStorage.getItem(DENSITY_KEY) === 'comfortable' ? 'comfortable' : 'compact';
  } catch {
    return 'compact';
  }
}

/**
 * Wound state drives the row's at-a-glance colour band. A GM reading the table
 * from across it should not have to parse the HP meter to see who is going down.
 */
function woundState(combatant: EncounterCombatant): 'untracked' | 'healthy' | 'serious' | 'mortal' {
  if (combatant.currentHp === null || combatant.maxHp === null) return 'untracked';
  if (combatant.currentHp <= 0) return 'mortal';
  return isSeriouslyWounded(combatant) ? 'serious' : 'healthy';
}

function signed(value: number): string {
  return `${value >= 0 ? '+' : ''}${value}`;
}

function downloadJson(filename: string, value: unknown): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function CommitNumberInput({
  value,
  min,
  max,
  label,
  nullable = false,
  onCommit,
}: {
  value: number | null;
  min?: number;
  max?: number;
  label: string;
  nullable?: boolean;
  onCommit: (value: number | null) => void;
}) {
  const [draft, setDraft] = useState(value === null ? '' : String(value));
  useEffect(() => setDraft(value === null ? '' : String(value)), [value]);
  const commit = (raw = draft) => {
    if (nullable && raw.trim() === '') {
      if (value !== null) onCommit(null);
      return;
    }
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) {
      setDraft(value === null ? '' : String(value));
      return;
    }
    const next = Math.max(min ?? Number.NEGATIVE_INFINITY, Math.min(max ?? Number.POSITIVE_INFINITY, Math.trunc(parsed)));
    setDraft(String(next));
    if (next !== value) onCommit(next);
  };
  return (
    <input
      class="compact-number"
      aria-label={label}
      type="number"
      min={min}
      max={max}
      value={draft}
      onInput={(event: InputEvent) => {
        const raw = event.currentTarget.value;
        setDraft(raw);
        // Native number-input steppers emit an input event without a text
        // inputType. Commit those clicks immediately while leaving typed
        // multi-digit values to change/blur/Enter.
        const inputType = (event as unknown as globalThis.InputEvent).inputType;
        if (!inputType) commit(raw);
      }}
      onChange={(event: InputEvent) => commit(event.currentTarget.value)}
      onBlur={() => commit()}
      onKeyDown={(event: KeyboardInputEvent) => {
        if (event.key === 'Enter') event.currentTarget.blur();
        if (event.key === 'Escape') {
          setDraft(value === null ? '' : String(value));
          event.currentTarget.blur();
        }
      }}
    />
  );
}

function HpMeter({ combatant, dispatch, large = false }: {
  combatant: EncounterCombatant;
  dispatch: (action: EncounterAction) => void;
  large?: boolean;
}) {
  const max = combatant.maxHp;
  const current = combatant.currentHp;
  const percentage = max && current !== null ? Math.max(0, Math.min(100, (current / max) * 100)) : 0;
  const threshold = max && combatant.seriouslyWoundedAt !== null
    ? Math.max(0, Math.min(100, (combatant.seriouslyWoundedAt / max) * 100))
    : 50;
  const state = current !== null && current <= 0
    ? 'mortal'
    : isSeriouslyWounded(combatant) ? 'serious' : 'healthy';
  return (
    <div class={`hp-meter ${state} ${large ? 'large' : ''}`}>
      <div class="hp-meter-values">
        <CommitNumberInput
          value={current}
          nullable
          min={0}
          label={`${combatant.name} current HP`}
          onCommit={(next) => dispatch({ type: 'set-hp', combatantId: combatant.id, current: next })}
        />
        <span>/</span>
        <CommitNumberInput
          value={max}
          nullable
          min={1}
          label={`${combatant.name} max HP`}
          onCommit={(nextMax) => dispatch({ type: 'set-hp', combatantId: combatant.id, current: current ?? nextMax, max: nextMax })}
        />
      </div>
      <div
        class="hp-meter-track"
        role="meter"
        aria-label={`${combatant.name} hit points`}
        aria-valuemin={0}
        aria-valuemax={max ?? 0}
        aria-valuenow={current ?? 0}
      >
        <span class="hp-serious-zone" style={{ width: `${threshold}%` }} />
        <i style={{ width: `${percentage}%` }} />
        <b style={{ left: `${threshold}%` }} title={`Seriously Wounded at ${combatant.seriouslyWoundedAt ?? '—'} HP`} />
      </div>
      <small>{max === null ? 'HP not tracked' : `SW ≤ ${combatant.seriouslyWoundedAt ?? Math.ceil(max / 2)} · MW 0`}</small>
    </div>
  );
}

function StatusSummary({ combatant }: { combatant: EncounterCombatant }) {
  const serious = isSeriouslyWounded(combatant);
  const defeated = combatant.currentHp !== null && combatant.currentHp <= 0;
  const statuses = [
    serious ? { label: 'Seriously Wounded', description: automaticStatusDescription('seriously wounded') } : null,
    defeated ? { label: 'Mortally Wounded', description: automaticStatusDescription('mortally wounded') } : null,
    combatant.heldAction ? {
      label: 'Holding',
      description: `${automaticStatusDescription('holding')} ${combatant.heldAction.action || 'Action not specified'} when ${combatant.heldAction.trigger || 'the recorded trigger occurs'}.`,
    } : null,
    combatant.cover ? {
      label: `Cover ${combatant.cover.currentHp}`,
      description: `${automaticStatusDescription('cover')} ${combatant.cover.name}: ${combatant.cover.currentHp}/${combatant.cover.maxHp} HP.`,
    } : null,
    ...combatant.conditions.map((condition) => ({ label: condition.name, description: conditionDescription(condition) })),
    ...combatant.criticalInjuries.map((injury) => ({
      label: injury.name,
      description: `${injury.effect || injury.notes || 'Tracked critical injury.'}${injury.quickFix ? ` Quick Fix: ${injury.quickFix}.` : ''}${injury.treatment ? ` Treatment: ${injury.treatment}.` : ''}`,
    })),
  ].filter((value): value is { label: string; description: string } => Boolean(value));
  if (!statuses.length) return <span class="status-clear" title={automaticStatusDescription('clear')} tabIndex={0}>Clear</span>;
  return <div class="row-status">{statuses.slice(0, 3).map((status, index) => <span key={`${status.label}-${index}`} title={status.description} tabIndex={0}>{status.label}</span>)}{statuses.length > 3 && <span title={statuses.slice(3).map((status) => `${status.label}: ${status.description}`).join('\n')} tabIndex={0}>+{statuses.length - 3}</span>}</div>;
}

function DamageDialog({ combatant, onClose, dispatch }: {
  combatant: EncounterCombatant;
  onClose: () => void;
  dispatch: (action: EncounterAction) => void;
}) {
  const [location, setLocation] = useState<ArmorLocation>('body');
  const [damage, setDamage] = useState(10);
  const preview = calculateDamage(combatant, location, damage);
  useScrollLock(true);
  return (
    <div class="encounter-modal-backdrop" onMouseDown={(event: MouseDivEvent) => event.currentTarget === event.target && onClose()}>
      <section class="damage-dialog panel" role="dialog" aria-modal="true" aria-labelledby="damage-title">
        <header>
          <div><span class="kicker">Damage workflow</span><h2 id="damage-title">{combatant.name}</h2></div>
          <button type="button" class="icon-button" onClick={onClose} aria-label="Close">×</button>
        </header>
        <div class="damage-fields">
          <label><span>Armor location</span><select value={location} onChange={(event: SelectEvent) => setLocation(event.currentTarget.value as ArmorLocation)}><option value="body">Body</option><option value="head">Head</option></select></label>
          <label><span>Damage rolled</span><input type="number" min="0" value={damage} autoFocus onInput={(event: InputEvent) => setDamage(Math.max(0, Number(event.currentTarget.value)))} /></label>
        </div>
        <div class="damage-preview">
          <div><span>SP</span><strong>{preview.armorBefore} → {preview.armorAfter}</strong></div>
          <div><span>HP damage</span><strong>{preview.hpDamage}</strong></div>
          <div><span>HP after</span><strong>{preview.hpAfter ?? '—'}</strong></div>
          <div><span>State</span><strong>{preview.defeated ? 'Mortally Wounded' : preview.seriouslyWounded ? 'Seriously Wounded' : 'Stable'}</strong></div>
        </div>
        <p class="damage-rule">Armor ablates only when damage exceeds current SP. Penetrating head damage is multiplied by ×{preview.headMultiplier}{preview.headMultiplier > 2 ? ' due to Cracked Skull' : ''}.</p>
        <footer>
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="button" class="primary-action" onClick={() => {
            dispatch({ type: 'apply-damage', combatantId: combatant.id, location, damage });
            onClose();
          }}>Apply damage</button>
        </footer>
      </section>
    </div>
  );
}

function CyberwareList({ node, depth = 0 }: { node: InventoryNode; depth?: number }) {
  return <>{node.children.map((child) => (
    <div key={child.item.id} class="inspector-line" style={{ paddingLeft: `${depth * 12}px` }}>
      <span>{child.item.name}</span><small>{child.item.container_capacity > 0 && child.item.container_capacity < 100 ? `${child.children.reduce((sum, item) => sum + item.item.size_in_container, 0)}/${child.item.container_capacity}` : ''}</small>
      {child.children.length > 0 && <CyberwareList node={child} depth={depth + 1} />}
    </div>
  ))}</>;
}

function AttackControls({ combatant, attack, dispatch, onResolve, compact = false }: {
  combatant: EncounterCombatant;
  attack: EncounterAttack;
  dispatch: (action: EncounterAction) => void;
  onResolve?: () => void;
  compact?: boolean;
}) {
  const penalty = attackPenalty(combatant, attack);
  const effective = attack.base === null ? null : attack.base - penalty;
  const empty = attack.ammo.current === 0;
  const canReload = empty
    && attack.ammo.max !== null
    && (attack.ammo.reserve === null || attack.ammo.reserve > 0);
  const selectedRange = validRangeBands(attack.rangeProfile).find((band) => band.id === attack.selectedRangeBand)
    ?? validRangeBands(attack.rangeProfile)[0]
    ?? null;
  const selectedDv = rangeDv(attack.rangeProfile, selectedRange?.id ?? null);
  return (
    <article class={`attack-control ${compact ? 'compact' : ''}`}>
      <div class="attack-control-heading">
        <strong title={`${attack.name} · ${attack.skill}`}>{attack.name}</strong>
        <div class="attack-control-facts">
          <span title="Rate of Fire: maximum attacks normally made with one Action">ROF {attack.rateOfFire ?? '—'}</span>
          {attack.autofireBase !== null && <span title="Autofire attack base">AF {signed(attack.autofireBase)}</span>}
          {attack.rangeProfile && onResolve && <button
            type="button"
            class="range-dv-chip"
            onClick={onResolve}
            title={`Resolve at ${selectedRange?.label ?? 'selected range'} using DV ${selectedDv ?? '—'}, or choose an eligible target's Evasion`}
          >{selectedRange?.label ?? 'Range'} · DV {selectedDv ?? '—'}</button>}
        </div>
      </div>
      <span class="attack-control-base">{attack.skill} {effective === null ? '—' : signed(effective)}{attack.ammo.current !== null ? ` · ${empty ? 'EMPTY' : `${attack.ammo.current} rnd`}` : ''}</span>
      <div class="attack-control-buttons">
        {empty ? <button
          type="button"
          class="reload-roll-button"
          disabled={!canReload}
          onClick={() => dispatch({ type: 'reload-attack', combatantId: combatant.id, attackId: attack.id })}
          title={canReload ? `Reload ${attack.name}${attack.ammo.reserve === null ? '' : ` from ${attack.ammo.reserve} reserve rounds`}` : 'No reserve ammunition available'}
        ><span>EMPTY</span><strong>RELOAD</strong></button> : <button
          type="button"
          class="attack-roll-button"
          onClick={() => dispatch({ type: 'roll-attack', combatantId: combatant.id, attackId: attack.id })}
          title={`Roll RED d10 + ${effective ?? 'unmapped'}; a natural 10 adds one d10 and a natural 1 subtracts one d10`}
        ><span>ATK</span><strong>{effective === null ? '—' : signed(effective)}</strong></button>}
        <button
          type="button"
          class="damage-roll-button"
          disabled={!attack.damage}
          onClick={() => dispatch({ type: 'roll-damage', combatantId: combatant.id, attackId: attack.id })}
          title={attack.damage ? `Roll ${attack.damage} damage` : 'No damage formula'}
        ><span>DMG</span><strong>{attack.damage ?? '—'}</strong></button>
      </div>
    </article>
  );
}

function CriticalInjuryCard({ injury, combatantId, dispatch }: {
  injury: CriticalInjury;
  combatantId: string;
  dispatch: (action: EncounterAction) => void;
}) {
  return (
    <article class="critical-injury-card">
      <header>
        <div><span>{injury.location ?? 'custom'}{injury.roll ? ` · ${injury.roll}` : ''}</span><strong>{injury.name}</strong></div>
        <button type="button" onClick={() => dispatch({ type: 'remove-critical', combatantId, injuryId: injury.id })} aria-label={`Remove ${injury.name}`}>×</button>
      </header>
      <p>{injury.effect || injury.notes || 'Custom injury effect.'}</p>
      <div class="critical-effects">
        {injury.penalty > 0 && <span>All actions −{injury.penalty}</span>}
        {injury.attackPenalty && <span>{injury.attackPenalty.scope} attacks −{injury.attackPenalty.value}</span>}
        {injury.deathSavePenalty > 0 && <span>Death Save +{injury.deathSavePenalty}</span>}
        {injury.headDamageMultiplier && <span>Head damage ×{injury.headDamageMultiplier}</span>}
      </div>
      {(injury.quickFix || injury.treatment) && <footer><span>Quick fix: {injury.quickFix ?? '—'}</span><span>Treatment: {injury.treatment ?? '—'}</span></footer>}
    </article>
  );
}

function CombatantInspector({ combatant, dispatch, onClose, onDamage, onResolveAttack }: {
  combatant: EncounterCombatant;
  dispatch: (action: EncounterAction) => void;
  onClose: () => void;
  onDamage: () => void;
  onResolveAttack: (attackId: string) => void;
}) {
  const [conditionName, setConditionName] = useState('');
  const [conditionPenalty, setConditionPenalty] = useState(0);
  const [conditionNotes, setConditionNotes] = useState('');
  const [criticalDefinitionId, setCriticalDefinitionId] = useState('');
  const [customCriticalName, setCustomCriticalName] = useState('');
  const [customCriticalPenalty, setCustomCriticalPenalty] = useState(0);
  const [customDeathPenalty, setCustomDeathPenalty] = useState(0);
  const [coverName, setCoverName] = useState(combatant.cover?.name ?? 'Hard cover');
  const [coverHp, setCoverHp] = useState(combatant.cover?.maxHp ?? 10);
  const [heldAction, setHeldAction] = useState(combatant.heldAction?.action ?? '');
  const [heldTrigger, setHeldTrigger] = useState(combatant.heldAction?.trigger ?? '');
  const view = combatant.npcView;
  const sourceBlock = combatant.statBlock;
  const penalty = combatantPenalty(combatant);
  const target = deathSaveTarget(combatant);

  useEffect(() => {
    setCoverName(combatant.cover?.name ?? 'Hard cover');
    setCoverHp(combatant.cover?.maxHp ?? 10);
    setHeldAction(combatant.heldAction?.action ?? '');
    setHeldTrigger(combatant.heldAction?.trigger ?? '');
    setCriticalDefinitionId('');
  }, [combatant.id]);

  const selectedDefinition = CRITICAL_INJURIES.find((injury) => injury.id === criticalDefinitionId);
  const addDefinition = (definition: CriticalInjuryDefinition) => {
    dispatch({
      type: 'add-critical',
      combatantId: combatant.id,
      injury: createCriticalInjury(definition, uiId('critical')),
      applyBonusDamage: true,
    });
    setCriticalDefinitionId('');
  };

  return (
    <aside class={`combatant-inspector panel side-${combatant.side}`} aria-label={`${combatant.name} stat block`}>
      <header class="inspector-header">
        <div>
          <span class="kicker">{combatant.kind === 'npc'
            ? sourceBlock ? `${sourceBlock.tier} · official encounter NPC` : `${view?.rank.name ?? 'NPC'} · ${view?.role.name ?? ''}`
            : 'Player character'}</span>
          <input
            key={`${combatant.id}-${combatant.name}`}
            class="inspector-name-input"
            aria-label="Combatant name"
            defaultValue={combatant.name}
            onBlur={(event: InputEvent) => {
              const name = event.currentTarget.value.trim();
              if (name && name !== combatant.name) dispatch({ type: 'rename-combatant', combatantId: combatant.id, name });
              else event.currentTarget.value = combatant.name;
            }}
            onKeyDown={(event: KeyboardInputEvent) => {
              if (event.key === 'Enter') event.currentTarget.blur();
              if (event.key === 'Escape') {
                event.currentTarget.value = combatant.name;
                event.currentTarget.blur();
              }
            }}
          />
          <div class="inspector-identity-controls">
            {combatant.teamLabel && <span>{combatant.teamLabel}</span>}
            <label>
              <span class="sr-only">Disposition</span>
              <select value={combatant.side} onChange={(event: SelectEvent) => dispatch({ type: 'set-combatant-side', combatantId: combatant.id, side: event.currentTarget.value as EncounterCombatant['side'] })}>
                <option value="enemy">Enemy</option>
                <option value="neutral">Neutral</option>
                <option value="ally">Ally</option>
                <option value="player">Player</option>
              </select>
            </label>
          </div>
          <p>{combatant.kind === 'npc'
            ? sourceBlock ? `${sourceBlock.templateName} · ${sourceBlock.source.label}, p. ${sourceBlock.source.page}` : view?.profileSummary
            : 'Minimal initiative record. Add only the combat details the GM needs.'}</p>
        </div>
        <button type="button" class="icon-button" onClick={onClose} aria-label="Close inspector">×</button>
      </header>

      <div class="inspector-scroll">
        <section class="inspector-vitals-section">
          <HpMeter combatant={combatant} dispatch={dispatch} large />
          <div class="inspector-vitals">
            <div><span>Body SP</span><strong>{combatant.armor.body.current}</strong></div>
            <div><span>Head SP</span><strong>{combatant.armor.head.current}</strong></div>
            <div><span>Action penalty</span><strong>{penalty ? `−${penalty}` : '—'}</strong></div>
            <button type="button" class="primary-action" onClick={onDamage}>Apply damage</button>
            <button type="button" onClick={() => dispatch({ type: 'heal', combatantId: combatant.id, amount: 5 })}>Heal 5</button>
          </div>
        </section>

        <section>
          <h3>Attacks</h3>
          {combatant.attacks.length ? <div class="inspector-attacks">{combatant.attacks.map((attack) => (
            <article key={attack.id}>
              <AttackControls combatant={combatant} attack={attack} dispatch={dispatch} onResolve={() => onResolveAttack(attack.id)} />
              <div class="attack-facts"><span>ROF <strong>{attack.rateOfFire ?? '—'}</strong></span><span>Loaded <strong>{attack.ammo.current ?? '—'} / {attack.ammo.max ?? '—'}</strong></span><span>Reserve <strong>{attack.ammo.reserve ?? '—'}</strong></span></div>
              {attack.notes && <p>{attack.notes}</p>}
              {attack.ammo.current !== null && <div class="ammo-controls">
                <CommitNumberInput value={attack.ammo.current} min={0} label={`${attack.name} loaded ammo`} onCommit={(current) => dispatch({ type: 'set-attack-ammo', combatantId: combatant.id, attackId: attack.id, current })} />
                <span>loaded</span>
                <CommitNumberInput value={attack.ammo.reserve} min={0} nullable label={`${attack.name} reserve ammo`} onCommit={(reserve) => dispatch({ type: 'set-attack-ammo', combatantId: combatant.id, attackId: attack.id, current: attack.ammo.current, reserve })} />
                <span>reserve</span>
                <button type="button" onClick={() => dispatch({ type: 'reload-attack', combatantId: combatant.id, attackId: attack.id })}>Reload</button>
              </div>}
            </article>
          ))}</div> : <p class="muted">No attacks recorded.</p>}
        </section>

        <section>
          <h3>Conditions</h3>
          <div class="condition-list">
            {isSeriouslyWounded(combatant) && <div class="condition-chip automatic" title={automaticStatusDescription('seriously wounded')}><strong>Seriously Wounded</strong><span>−2 to actions</span></div>}
            {combatant.conditions.map((condition) => <div class="condition-chip" key={condition.id} title={conditionDescription(condition)}><div><strong>{condition.name}</strong><span>{condition.penalty ? `−${condition.penalty} · ` : ''}{conditionDescription(condition)}</span></div><button type="button" onClick={() => dispatch({ type: 'remove-condition', combatantId: combatant.id, conditionId: condition.id })}>×</button></div>)}
          </div>
          <div class="inline-add compact-grid">
            <input aria-label="Condition name" placeholder="Prone, grappled…" value={conditionName} onInput={(event: InputEvent) => setConditionName(event.currentTarget.value)} />
            <input aria-label="Condition penalty" type="number" min="0" value={conditionPenalty} onInput={(event: InputEvent) => setConditionPenalty(Number(event.currentTarget.value))} />
            <input class="condition-description-input" aria-label="Condition description" placeholder="Effect / duration / source" value={conditionNotes} onInput={(event: InputEvent) => setConditionNotes(event.currentTarget.value)} />
            <button type="button" onClick={() => {
              if (!conditionName.trim()) return;
              const condition: EncounterCondition = { id: uiId('condition'), name: conditionName.trim(), penalty: Math.max(0, conditionPenalty), notes: conditionNotes.trim() };
              dispatch({ type: 'add-condition', combatantId: combatant.id, condition });
              setConditionName(''); setConditionPenalty(0); setConditionNotes('');
            }}>Add</button>
          </div>
          <div class="quick-conditions">
            {CONDITION_DEFINITIONS.filter((definition) => definition.id !== 'dead').map((definition) => <button type="button" key={definition.id} title={definition.description} onClick={() => dispatch({ type: 'add-condition', combatantId: combatant.id, condition: createCondition(definition, uiId('condition')) })}>+ {definition.name}</button>)}
          </div>
        </section>

        <section>
          <div class="section-title-row"><h3>Critical injuries</h3><span>Each core injury adds 5 direct HP damage</span></div>
          <div class="critical-roll-buttons">
            <button type="button" onClick={() => dispatch({ type: 'roll-critical', combatantId: combatant.id, location: 'body' })}>Roll body 2d6</button>
            <button type="button" onClick={() => dispatch({ type: 'roll-critical', combatantId: combatant.id, location: 'head' })}>Roll head 2d6</button>
          </div>
          <div class="critical-picker">
            <select aria-label="Critical injury" value={criticalDefinitionId} onChange={(event: SelectEvent) => setCriticalDefinitionId(event.currentTarget.value)}>
              <option value="">Choose predefined injury…</option>
              <optgroup label="Body">{CRITICAL_INJURIES.filter((injury) => injury.location === 'body').map((injury) => <option key={injury.id} value={injury.id}>{injury.roll} · {injury.name}</option>)}</optgroup>
              <optgroup label="Head">{CRITICAL_INJURIES.filter((injury) => injury.location === 'head').map((injury) => <option key={injury.id} value={injury.id}>{injury.roll} · {injury.name}</option>)}</optgroup>
            </select>
            <button type="button" disabled={!selectedDefinition} onClick={() => selectedDefinition && addDefinition(selectedDefinition)}>Add +5 HP</button>
          </div>
          {selectedDefinition && <div class="critical-definition-preview">
            <strong>{selectedDefinition.name}</strong>
            <p>{selectedDefinition.effect}</p>
            <span>Quick Fix: {selectedDefinition.quickFix} · Treatment: {selectedDefinition.treatment}</span>
          </div>}
          <div class="critical-injury-list">{combatant.criticalInjuries.map((injury) => <CriticalInjuryCard key={injury.id} injury={injury} combatantId={combatant.id} dispatch={dispatch} />)}</div>
          <details class="custom-critical">
            <summary>Custom injury</summary>
            <div class="inline-add critical-grid">
              <input aria-label="Critical injury name" placeholder="Custom injury" value={customCriticalName} onInput={(event: InputEvent) => setCustomCriticalName(event.currentTarget.value)} />
              <label><span>All-action penalty</span><input type="number" min="0" value={customCriticalPenalty} onInput={(event: InputEvent) => setCustomCriticalPenalty(Number(event.currentTarget.value))} /></label>
              <label><span>Death-save penalty</span><input type="number" min="0" value={customDeathPenalty} onInput={(event: InputEvent) => setCustomDeathPenalty(Number(event.currentTarget.value))} /></label>
              <button type="button" onClick={() => {
                if (!customCriticalName.trim()) return;
                dispatch({ type: 'add-critical', combatantId: combatant.id, injury: { id: uiId('critical'), name: customCriticalName.trim(), penalty: Math.max(0, customCriticalPenalty), deathSavePenalty: Math.max(0, customDeathPenalty), notes: '' } });
                setCustomCriticalName(''); setCustomCriticalPenalty(0); setCustomDeathPenalty(0);
              }}>Add custom injury</button>
            </div>
          </details>
        </section>

        <section class="two-column-inspector">
          <div>
            <h3>Cover</h3>
            {combatant.cover ? <div class="cover-card"><strong>{combatant.cover.name}</strong><span>{combatant.cover.currentHp} / {combatant.cover.maxHp} HP</span><div><button type="button" onClick={() => dispatch({ type: 'damage-cover', combatantId: combatant.id, damage: 5 })}>Damage 5</button><button type="button" onClick={() => dispatch({ type: 'set-cover', combatantId: combatant.id, cover: null })}>Remove</button></div></div> : <div class="inline-stack"><input value={coverName} onInput={(event: InputEvent) => setCoverName(event.currentTarget.value)} /><input type="number" min="1" value={coverHp} onInput={(event: InputEvent) => setCoverHp(Number(event.currentTarget.value))} /><button type="button" onClick={() => dispatch({ type: 'set-cover', combatantId: combatant.id, cover: { name: coverName.trim() || 'Cover', currentHp: Math.max(1, coverHp), maxHp: Math.max(1, coverHp) } })}>Set cover</button></div>}
          </div>
          <div>
            <h3>Held action</h3>
            {combatant.heldAction ? <div class="cover-card"><strong>{combatant.heldAction.action}</strong><span>Trigger: {combatant.heldAction.trigger || 'unspecified'}</span><button type="button" onClick={() => dispatch({ type: 'set-held-action', combatantId: combatant.id, heldAction: null })}>Resolve / clear</button></div> : <div class="inline-stack"><input placeholder="Action" value={heldAction} onInput={(event: InputEvent) => setHeldAction(event.currentTarget.value)} /><input placeholder="Trigger" value={heldTrigger} onInput={(event: InputEvent) => setHeldTrigger(event.currentTarget.value)} /><button type="button" onClick={() => heldAction.trim() && dispatch({ type: 'set-held-action', combatantId: combatant.id, heldAction: { action: heldAction.trim(), trigger: heldTrigger.trim() } })}>Hold action</button></div>}
          </div>
        </section>

        <section>
          <h3>Death saves</h3>
          <div class="death-save-row"><span>Current target</span><strong>{target ?? '—'}</strong><span>Penalty</span><strong>+{combatant.deathSaveFailures + combatant.criticalInjuries.reduce((sum, injury) => sum + injury.deathSavePenalty, 0)}</strong><button type="button" disabled={target === null} onClick={() => dispatch({ type: 'roll-death-save', combatantId: combatant.id })}>Roll death save</button></div>
        </section>

        <section>
          <div class="section-title-row"><h3>Ranged defense</h3><span>Optional for minimal PC records</span></div>
          <div class="ranged-defense-editor">
            <label><span>REF</span><CommitNumberInput value={combatant.reflex} nullable min={0} max={20} label={`${combatant.name} REF`} onCommit={(reflex) => dispatch({ type: 'set-ranged-defense', combatantId: combatant.id, reflex, evasionBase: combatant.evasionBase })} /></label>
            <label><span>DEX + Evasion</span><CommitNumberInput value={combatant.evasionBase} nullable min={0} max={40} label={`${combatant.name} Evasion base`} onCommit={(evasionBase) => dispatch({ type: 'set-ranged-defense', combatantId: combatant.id, reflex: combatant.reflex, evasionBase })} /></label>
            <div class={`dodge-readiness ${canDodgeRanged(combatant) ? 'ready' : ''}`} title="A defender with REF 8+ may choose DEX + Evasion + RED d10 instead of the range-table DV.">
              <strong>{canDodgeRanged(combatant) ? 'Ranged dodge ready' : 'Uses range-table DV'}</strong>
              <span>{canDodgeRanged(combatant) ? `Effective Evasion ${signed((combatant.evasionBase ?? 0) - penalty)}` : combatant.reflex !== null && combatant.reflex < 8 ? `REF ${combatant.reflex}; requires REF 8+` : 'Record REF and total Evasion base to enable.'}</span>
            </div>
          </div>
        </section>

        {view && <>
          <section>
            <h3>Stats</h3>
            <div class="inspector-stat-grid">{view.stats.map((stat) => {
              const effective = stat.total - penalty;
              return <button type="button" key={stat.name} title={`Roll ${stat.name}: RED d10 ${signed(effective)}${penalty ? ` after −${penalty} action penalty` : ''}`} onClick={() => dispatch({ type: 'roll-check', combatantId: combatant.id, label: stat.name, base: effective })}><span>{stat.name}</span><strong>{stat.total}</strong><small>ROLL {signed(effective)}</small></button>;
            })}</div>
          </section>
          <section>
            <h3>Skills</h3>
            <div class="inspector-skill-list">{[...view.skills].sort((a, b) => b.total - a.total).map((skill) => {
              const effective = skill.total - penalty;
              return <button type="button" key={skill.name} title={`Roll ${skill.name}: RED d10 ${signed(effective)}${penalty ? ` after −${penalty} action penalty` : ''}`} onClick={() => dispatch({ type: 'roll-check', combatantId: combatant.id, label: skill.name, base: effective })}><span>{skill.name}<small>{skill.link} + level</small></span><strong>{signed(effective)}</strong></button>;
            })}</div>
          </section>
          <section>
            <h3>Gear</h3>
            <div class="inspector-list"><strong>Armor</strong>{view.npc.armor.map((item) => <div class="inspector-line" key={item.id}><span>{item.name}</span><small>SP {item.armor_class ?? '—'}</small></div>)}<strong>Weapons</strong>{view.npc.weapons.map((item) => <div class="inspector-line" key={item.id}><span>{item.name}</span><small>{item.damage ?? ''}</small></div>)}<strong>Inventory</strong>{[...view.npc.inventory.values()].map((entry) => <div class="inspector-line" key={entry.item.id}><span>{entry.item.name}</span><small>×{entry.amount}</small></div>)}</div>
          </section>
          <section>
            <h3>Cyberware</h3>
            <div class="inspector-list"><CyberwareList node={view.npc.cyberware} /></div>
          </section>
        </>}

        {sourceBlock && <>
          <section>
            <div class="section-title-row"><h3>Official stats</h3><span>{sourceBlock.source.label}, p. {sourceBlock.source.page}</span></div>
            {sourceBlock.combatNumber !== undefined && <div class="combat-number-roll">
              <div><span>Combat Number</span><strong>{signed(sourceBlock.combatNumber - penalty)}</strong><small>Combined attack/check base</small></div>
              <button type="button" title={`Roll Combat Number: RED d10 ${signed(sourceBlock.combatNumber - penalty)}`} onClick={() => dispatch({ type: 'roll-check', combatantId: combatant.id, label: 'Combat Number', base: sourceBlock.combatNumber! - penalty })}>Roll</button>
            </div>}
            {sourceBlock.stats.length > 0 ? <div class="inspector-stat-grid">{sourceBlock.stats.map((stat) => {
              const effective = stat.effective - penalty;
              return <button type="button" key={stat.name} title={`Roll ${stat.name}: RED d10 ${signed(effective)}${stat.base !== stat.effective ? `; printed ${stat.base} (${stat.effective})` : ''}${penalty ? ` after −${penalty} encounter penalty` : ''}`} onClick={() => dispatch({ type: 'roll-check', combatantId: combatant.id, label: stat.name, base: effective })}><span>{stat.name}</span><strong>{stat.base === stat.effective ? stat.base : `${stat.base} (${stat.effective})`}</strong><small>ROLL {signed(effective)}</small></button>;
            })}</div> : <p class="muted">This simplified official block does not include a complete STAT line. Initiative and unlisted STAT checks remain manual.</p>}
          </section>
          <section>
            <h3>Official skill bases</h3>
            <div class="inspector-skill-list">{[...sourceBlock.skills].sort((a, b) => b.effective - a.effective).map((skill) => {
              const effective = skill.effective - penalty;
              return <button type="button" key={skill.name} title={`Roll ${skill.name}: RED d10 ${signed(effective)}${skill.base !== skill.effective ? `; printed ${skill.base} (${skill.effective})` : ''}${penalty ? ` after −${penalty} encounter penalty` : ''}`} onClick={() => dispatch({ type: 'roll-check', combatantId: combatant.id, label: skill.name, base: effective })}><span>{skill.name}<small>Combined source skill base</small></span><strong>{signed(effective)}</strong></button>;
            })}</div>
          </section>
          <section>
            <h3>Official loadout</h3>
            <div class="inspector-list">
              <strong>Armor</strong><div class="inspector-line"><span>{sourceBlock.armorName}</span><small>B {combatant.armor.body.max} · H {combatant.armor.head.max}</small></div>
              <strong>Weapons</strong>{combatant.attacks.map((attack) => <div class="inspector-line" key={attack.id}><span>{attack.name}</span><small>{attack.damage ?? 'mechanics missing'} · {attack.skill} {attack.base === null ? '—' : signed(attack.base)}</small></div>)}
              {sourceBlock.gear.length > 0 && <><strong>Gear</strong>{sourceBlock.gear.map((item, index) => <div class="inspector-line" key={`${item}-${index}`}><span>{item}</span><small /></div>)}</>}
              {sourceBlock.cyberware.length > 0 && <><strong>Cyberware</strong>{sourceBlock.cyberware.map((item, index) => <div class="inspector-line" key={`${item}-${index}`}><span>{item}</span><small /></div>)}</>}
              {sourceBlock.programs.length > 0 && <><strong>Programs</strong>{sourceBlock.programs.map((item, index) => <div class="inspector-line" key={`${item}-${index}`}><span>{item}</span><small /></div>)}</>}
            </div>
          </section>
          {(sourceBlock.modifications.length > 0 || sourceBlock.specialRules.length > 0 || sourceBlock.sourceWarnings.length > 0) && <section class="official-source-notes">
            <h3>Encounter adjustments</h3>
            {sourceBlock.modifications.map((note, index) => <p key={`mod-${index}`}>{note}</p>)}
            {sourceBlock.specialRules.map((note, index) => <p key={`rule-${index}`}><strong>Special:</strong> {note}</p>)}
            {sourceBlock.sourceWarnings.map((note, index) => <p class="warning-text" key={`warning-${index}`}><strong>Source note:</strong> {note}</p>)}
          </section>}
        </>}

        <section>
          <h3>Tactics</h3>
          <textarea key={`${combatant.id}-tactics`} defaultValue={combatant.tactics} placeholder="How this combatant behaves…" onBlur={(event: TextAreaEvent) => event.currentTarget.value !== combatant.tactics && dispatch({ type: 'set-tactics', combatantId: combatant.id, tactics: event.currentTarget.value })} />
        </section>
        <section>
          <h3>GM notes</h3>
          <textarea key={`${combatant.id}-notes`} defaultValue={combatant.notes} placeholder="Secrets, morale, reinforcements, reminders…" onBlur={(event: TextAreaEvent) => event.currentTarget.value !== combatant.notes && dispatch({ type: 'set-notes', combatantId: combatant.id, notes: event.currentTarget.value })} />
        </section>

        <button type="button" class="danger-zone" onClick={() => dispatch({ type: 'remove-combatant', combatantId: combatant.id })}>Remove from encounter</button>
      </div>
    </aside>
  );
}

function CombatantRow({ combatant, active, onDeck, selected, dispatch, onSelect, onDamage, onResolveAttack }: {
  combatant: EncounterCombatant;
  active: boolean;
  onDeck: boolean;
  selected: boolean;
  dispatch: (action: EncounterAction) => void;
  onSelect: () => void;
  onDamage: () => void;
  onResolveAttack: (attackId: string) => void;
}) {
  const primaryAttacks = combatant.attacks.slice(0, 2);
  const wound = woundState(combatant);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(combatant.name);

  useEffect(() => {
    setEditingName(false);
    setNameDraft(combatant.name);
  }, [combatant.id, combatant.name]);

  const commitName = () => {
    const name = nameDraft.trim();
    if (name && name !== combatant.name) dispatch({ type: 'rename-combatant', combatantId: combatant.id, name });
    else setNameDraft(combatant.name);
    setEditingName(false);
  };

  return (
    <article class={`combatant-row wound-${wound} ${active ? 'active-turn' : ''} ${onDeck ? 'on-deck' : ''} ${selected ? 'selected' : ''} ${combatant.side}`}>
      <button
        type="button"
        class="turn-marker"
        title={active ? 'Active turn' : onDeck ? 'Up next — click to jump the turn here' : 'Set active turn'}
        aria-current={active ? 'true' : undefined}
        onClick={() => dispatch({ type: 'set-active', combatantId: combatant.id })}
      >{active ? '▶' : onDeck ? '›' : '·'}</button>
      <div class="initiative-cell"><CommitNumberInput value={combatant.initiative} nullable min={-99} max={999} label={`${combatant.name} initiative`} onCommit={(initiative) => dispatch({ type: 'set-initiative', combatantId: combatant.id, initiative })} /><small>{combatant.initiativeBase === null ? 'manual' : `base ${signed(combatant.initiativeBase)}`}</small></div>
      <div class="combatant-name-cell">
        {editingName ? <input
          class="combatant-name-edit"
          autoFocus
          aria-label={`Rename ${combatant.name}`}
          value={nameDraft}
          onInput={(event: InputEvent) => setNameDraft(event.currentTarget.value)}
          onBlur={commitName}
          onKeyDown={(event: KeyboardInputEvent) => {
            if (event.key === 'Enter') event.currentTarget.blur();
            if (event.key === 'Escape') {
              setNameDraft(combatant.name);
              setEditingName(false);
            }
          }}
        /> : <>
          {/* The rename control sits inline after the name text so it reads as
              belonging to that name rather than to the row. */}
          <span class="combatant-name-line">
            <button type="button" class="combatant-name" onClick={onSelect}>
              <strong>{combatant.name}</strong>
            </button>
            <button
              type="button"
              class="rename-combatant-button"
              title={`Rename ${combatant.name}`}
              aria-label={`Rename ${combatant.name}`}
              onClick={() => setEditingName(true)}
            >✎<span class="sr-only"> Rename</span></button>
          </span>
          <button type="button" class="combatant-meta-button" tabIndex={-1} aria-hidden="true" onClick={onSelect}>
            <span class="combatant-meta">
              {combatant.teamLabel && <b class="combatant-team-badge">{combatant.teamLabel}</b>}
              <b class={`combatant-side-badge ${combatant.side}`}>{combatant.side}</b>
              <em>{combatant.kind === 'pc'
                ? 'PC'
                : combatant.statBlock
                  ? `${combatant.statBlock.tier} · ${combatant.statBlock.templateName}`
                  : `${combatant.npcView?.rank.name ?? 'NPC'} ${combatant.npcView?.role.name ?? ''}`}</em>
            </span>
          </button>
        </>}
      </div>
      <HpMeter combatant={combatant} dispatch={dispatch} />
      <div class="armor-cell"><label><span>B</span><CommitNumberInput value={combatant.armor.body.current} min={0} label={`${combatant.name} body SP`} onCommit={(current) => dispatch({ type: 'set-armor', combatantId: combatant.id, location: 'body', current: current ?? 0 })} /></label><label><span>H</span><CommitNumberInput value={combatant.armor.head.current} min={0} label={`${combatant.name} head SP`} onCommit={(current) => dispatch({ type: 'set-armor', combatantId: combatant.id, location: 'head', current: current ?? 0 })} /></label></div>
      <StatusSummary combatant={combatant} />
      <div class="row-attacks">{primaryAttacks.length ? primaryAttacks.map((attack) => <AttackControls key={attack.id} combatant={combatant} attack={attack} dispatch={dispatch} onResolve={() => onResolveAttack(attack.id)} compact />) : <span class="no-attacks">No attacks</span>}</div>
      <div class="row-actions">
        <button type="button" class="damage-button" title={`Apply damage to ${combatant.name}`} onClick={onDamage}>Damage</button>
        <button type="button" class="statblock-button" title={`Open the full stat block for ${combatant.name}`} onClick={onSelect}>Stat block</button>
        <button
          type="button"
          class="remove-combatant-button"
          title={`Remove ${combatant.name} from this encounter`}
          aria-label={`Remove ${combatant.name} from this encounter`}
          onClick={() => window.confirm(`Remove “${combatant.name}” from this encounter?`) && dispatch({ type: 'remove-combatant', combatantId: combatant.id })}
        >✕</button>
      </div>
    </article>
  );
}

function copyEncounter(source: EncounterState, name: string, lastEvent: string): EncounterState {
  const combatantIds = new Map<string, string>();
  const combatants = source.combatants.map((combatant) => {
    const newCombatantId = uiId(combatant.kind);
    combatantIds.set(combatant.id, newCombatantId);
    return {
      ...structuredClone(combatant),
      id: newCombatantId,
      attacks: combatant.attacks.map((attack) => ({ ...structuredClone(attack), id: uiId('attack') })),
      conditions: combatant.conditions.map((condition) => ({ ...condition, id: uiId('condition') })),
      criticalInjuries: combatant.criticalInjuries.map((injury) => ({ ...injury, id: uiId('critical') })),
      createdAt: new Date().toISOString(),
    };
  });
  return {
    ...structuredClone(source),
    id: uiId('encounter'),
    name,
    activeCombatantId: source.activeCombatantId ? combatantIds.get(source.activeCombatantId) ?? null : null,
    combatants,
    past: [],
    lastEvent,
    updatedAt: new Date().toISOString(),
  };
}

function duplicateEncounter(source: EncounterState): EncounterState {
  return copyEncounter(source, `${source.name} copy`, 'Encounter duplicated');
}

function activeEncounter(workspace: EncounterWorkspace): EncounterState {
  return workspace.encounters.find((encounter) => encounter.id === workspace.activeEncounterId)
    ?? workspace.encounters[0]
    ?? createEmptyEncounter();
}

export function EncounterTracker({ currentNpc, savedNpcs, referenceEntries }: EncounterTrackerProps) {
  const [workspace, setWorkspace] = useState<EncounterWorkspace>(loadEncounterWorkspace);
  const importInput = useRef<HTMLInputElement>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [damageId, setDamageId] = useState<string | null>(null);
  const [rangeReferenceOpen, setRangeReferenceOpen] = useState(false);
  const [attackResolver, setAttackResolver] = useState<{ combatantId: string; attackId: string } | null>(null);
  const [density, setDensity] = useState<RowDensity>(loadDensity);
  const [addTab, setAddTab] = useState<AddTab | null>(null);
  const state = activeEncounter(workspace);
  const ordered = useMemo(() => sortCombatants(state.combatants), [state.combatants]);
  // The combatant who acts after the current one, so the GM can prompt the next
  // player before the active turn finishes.
  const onDeckId = useMemo(() => {
    if (!ordered.length) return null;
    const index = ordered.findIndex((combatant) => combatant.id === state.activeCombatantId);
    if (index === -1) return ordered[0]?.id ?? null;
    return ordered[(index + 1) % ordered.length]?.id ?? null;
  }, [ordered, state.activeCombatantId]);
  const selected = state.combatants.find((combatant) => combatant.id === selectedId) ?? null;
  // Must track the width at which the inspector becomes a bottom sheet in CSS.
  const inspectorIsSheet = useMediaQuery('(max-width: 1320px)');
  useScrollLock(selected !== null && inspectorIsSheet);
  const damageTarget = state.combatants.find((combatant) => combatant.id === damageId) ?? null;
  const resolverAttacker = state.combatants.find((combatant) => combatant.id === attackResolver?.combatantId) ?? null;
  const resolverAttack = resolverAttacker?.attacks.find((attack) => attack.id === attackResolver?.attackId) ?? null;

  useEffect(() => persistEncounterWorkspace(workspace), [workspace]);
  useEffect(() => {
    try {
      localStorage.setItem(DENSITY_KEY, density);
    } catch {
      // Density remains a session preference when browser storage is unavailable.
    }
  }, [density]);
  useEffect(() => {
    setSelectedId(null);
    setDamageId(null);
    setAttackResolver(null);
  }, [workspace.activeEncounterId]);
  useEffect(() => {
    if (selectedId && !state.combatants.some((combatant) => combatant.id === selectedId)) setSelectedId(null);
  }, [selectedId, state.combatants]);

  const dispatch = (action: EncounterAction) => {
    setWorkspace((current) => ({
      ...current,
      encounters: current.encounters.map((encounter) => encounter.id === current.activeEncounterId ? encounterReducer(encounter, action) : encounter),
    }));
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      // Escape closes the inspector, but not while a field inside it is focused —
      // there the first Escape belongs to that editor (reverting a rename), and a
      // second one, now that focus has left the field, closes the sheet.
      if (event.key === 'Escape' && selectedId) {
        if (target?.matches('input, textarea, select, [contenteditable="true"]')) return;
        setSelectedId(null);
        return;
      }
      if (target?.matches('input, textarea, select, button, [contenteditable="true"]')) return;
      if (event.key.toLowerCase() === 'n' || event.key === 'ArrowDown') {
        event.preventDefault();
        dispatch({ type: 'advance-turn', direction: 1 });
      } else if (event.key.toLowerCase() === 'p' || event.key === 'ArrowUp') {
        event.preventDefault();
        dispatch({ type: 'advance-turn', direction: -1 });
      } else if (event.key.toLowerCase() === 'u') {
        event.preventDefault();
        dispatch({ type: 'undo' });
      } else if (event.key.toLowerCase() === 'd') {
        const targetId = selectedId ?? state.activeCombatantId;
        if (targetId) {
          event.preventDefault();
          setDamageId(targetId);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedId, state.activeCombatantId, workspace.activeEncounterId]);

  const active = state.combatants.find((combatant) => combatant.id === state.activeCombatantId) ?? null;
  const onDeckCombatant = active && ordered.length > 1
    ? state.combatants.find((combatant) => combatant.id === onDeckId) ?? null
    : null;
  const createEncounter = () => {
    const encounter = createEmptyEncounter(`Encounter ${workspace.encounters.length + 1}`);
    setWorkspace((current) => ({ ...current, activeEncounterId: encounter.id, encounters: [...current.encounters, encounter] }));
  };
  const cloneCurrent = () => {
    const encounter = duplicateEncounter(state);
    setWorkspace((current) => ({ ...current, activeEncounterId: encounter.id, encounters: [...current.encounters, encounter] }));
  };
  const deleteCurrent = () => {
    if (workspace.encounters.length <= 1) {
      if (window.confirm('Reset the only encounter?')) dispatch({ type: 'clear' });
      return;
    }
    if (!window.confirm(`Delete “${state.name}”?`)) return;
    setWorkspace((current) => {
      const index = current.encounters.findIndex((encounter) => encounter.id === current.activeEncounterId);
      const encounters = current.encounters.filter((encounter) => encounter.id !== current.activeEncounterId);
      const next = encounters[Math.min(Math.max(index, 0), encounters.length - 1)] ?? encounters[0]!;
      return { ...current, activeEncounterId: next.id, encounters };
    });
  };
  const importEncounter = async (event: InputEvent) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      const source = parseEncounterImport(await file.text());
      const encounter = copyEncounter(source, source.name, `Imported from ${file.name}`);
      setWorkspace((current) => ({
        ...current,
        activeEncounterId: encounter.id,
        encounters: [...current.encounters, encounter],
      }));
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'The file could not be read.';
      window.alert(`Could not import encounter. ${detail}`);
    }
  };
  const addRandomToCurrent = (result: RandomEncounterResult, combatants: EncounterCombatant[]) => {
    dispatch({
      type: 'apply-random-encounter',
      combatants,
      brief: randomEncounterBrief(result),
      source: `${result.roll ? result.roll.toString().padStart(2, '0') : '—'} ${result.title}`,
    });
  };
  const createPreparedFromRandom = (result: RandomEncounterResult, combatants: EncounterCombatant[]) => {
    const roll = result.roll ? result.roll.toString().padStart(2, '0') : '—';
    const encounter = createEmptyEncounter(`${result.title} · ${roll}`);
    encounter.brief = randomEncounterBrief(result);
    encounter.combatants = structuredClone(combatants);
    encounter.lastEvent = `Prepared from random encounter ${roll}`;
    setWorkspace((current) => ({ ...current, activeEncounterId: encounter.id, encounters: [...current.encounters, encounter] }));
  };

  return (
    <section class="encounter-page">
      <div class="encounter-library panel">
        <div class="encounter-tabs" role="tablist" aria-label="Prepared encounters">
          {workspace.encounters.map((encounter) => <button
            type="button"
            role="tab"
            aria-selected={encounter.id === workspace.activeEncounterId}
            class={encounter.id === workspace.activeEncounterId ? 'active' : ''}
            key={encounter.id}
            onClick={() => setWorkspace((current) => ({ ...current, activeEncounterId: encounter.id }))}
          ><strong>{encounter.name}</strong><span>{encounter.combatants.length} combatants · R{encounter.round}</span></button>)}
        </div>
        <div class="encounter-library-actions">
          <div class="encounter-action-group" role="group" aria-label="Create encounters">
            <button type="button" onClick={createEncounter}>+ New</button>
            <button type="button" onClick={() => importInput.current?.click()}>Import</button>
          </div>
          <div class="encounter-action-group" role="group" aria-label="Copy encounters">
            <button type="button" onClick={cloneCurrent}>Duplicate</button>
            <button type="button" onClick={() => downloadJson(`${state.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'encounter'}.json`, state)}>Export</button>
          </div>
          <button type="button" class="danger-text" onClick={deleteCurrent}>Delete</button>
          <input ref={importInput} hidden type="file" accept=".json,application/json" onChange={importEncounter} />
        </div>
      </div>

      <header class="encounter-command panel">
        <div class="encounter-title">
          <span class="kicker">Encounter runner</span>
          <input aria-label="Encounter name" value={state.name} onInput={(event: InputEvent) => dispatch({ type: 'rename', name: event.currentTarget.value })} />
          <textarea class="encounter-brief-input" aria-label="Encounter brief" placeholder="Scene setup, motives, non-combat resolution, reinforcements…" value={state.brief} onInput={(event: TextAreaEvent) => dispatch({ type: 'set-brief', brief: event.currentTarget.value })} />
        </div>
        <div class="encounter-turn-command">
          <div class="round-display">
            <span>Round</span>
            <strong>{state.round}</strong>
            <small class={active ? 'has-active' : ''} title={active ? `${active.name} is acting` : 'No active turn'}>{active?.name ?? 'No active turn'}</small>
            {onDeckCombatant && <small class="on-deck-name" title={`${onDeckCombatant.name} acts next`}>next: {onDeckCombatant.name}</small>}
          </div>
          <div class="encounter-turn-controls" role="group" aria-label="Turn controls">
            <button type="button" onClick={() => dispatch({ type: 'advance-turn', direction: -1 })}>← Previous</button>
            <button type="button" class="primary-action" onClick={() => dispatch({ type: 'advance-turn', direction: 1 })}>Next turn →</button>
            <button type="button" disabled={!state.past.length} onClick={() => dispatch({ type: 'undo' })}>Undo</button>
          </div>
        </div>
        <div class={`encounter-event ${state.lastEvent ? '' : 'idle'} ${state.lastEvent?.includes('CRITICAL') ? 'critical-event' : ''}`} role="status">
          <strong>{state.lastEvent ?? 'Ready. Roll initiative, then run the turn order.'}</strong>
          <span class="shortcut-hints"><kbd>N</kbd> next · <kbd>P</kbd> previous · <kbd>D</kbd> damage · <kbd>U</kbd> undo</span>
        </div>
      </header>

      <div class={`encounter-workspace ${selected ? 'has-inspector' : ''}`}>
        <div class={`initiative-panel panel density-${density}`}>
          <div class="initiative-toolbar">
            <div class="initiative-setup">
              <span>Combat setup</span>
              <div role="group" aria-label="Combat setup controls">
                <button type="button" class="add-combatants-button" onClick={() => setAddTab('statblocks')}>+ Add combatants</button>
                <button type="button" disabled={!state.combatants.some((combatant) => combatant.kind === 'npc')} onClick={() => dispatch({ type: 'roll-initiative', scope: 'npcs' })}>Roll NPCs</button>
                <button type="button" disabled={!state.combatants.length} onClick={() => dispatch({ type: 'roll-initiative', scope: 'all' })}>Roll all</button>
              </div>
            </div>
            <button type="button" class="range-reference-button" onClick={() => setRangeReferenceOpen(true)}>Range DV reference</button>
          </div>
          <div class="initiative-table-scroll">
            <div class="initiative-table">
              <header class="initiative-header">
                <span>Turn</span><span>Init</span><span>Name</span><span>HP</span><span>SP</span><span>Status</span><span>Primary attacks</span><span>Actions</span>
              </header>
              <div class="initiative-list">
                {ordered.length ? ordered.map((combatant) => <CombatantRow
                  key={combatant.id}
                  combatant={combatant}
                  active={combatant.id === state.activeCombatantId}
                  onDeck={ordered.length > 1 && combatant.id === onDeckId && combatant.id !== state.activeCombatantId}
                  selected={combatant.id === selectedId}
                  dispatch={dispatch}
                  onSelect={() => setSelectedId(combatant.id)}
                  onDamage={() => setDamageId(combatant.id)}
                  onResolveAttack={(attackId) => setAttackResolver({ combatantId: combatant.id, attackId })}
                />) : <div class="encounter-empty">
                  <strong>No combatants yet</strong>
                  <p>Add official stat blocks, your own NPCs and players, or roll a random Night City scene.</p>
                  <div class="encounter-empty-actions">
                    <button type="button" class="primary-action" onClick={() => setAddTab('statblocks')}>Add stat blocks</button>
                    <button type="button" onClick={() => setAddTab('roster')}>Add NPCs &amp; players</button>
                    <button type="button" onClick={() => setAddTab('random')}>Roll an encounter</button>
                  </div>
                </div>}
              </div>
            </div>
          </div>
          {ordered.length > 0 && <footer class="initiative-footer">
            <span>{ordered.length} combatants</span>

            <button type="button" onClick={() => dispatch({ type: 'reset-rounds' })}>Reset rounds</button>
            <button type="button" class="danger-text" onClick={() => window.confirm('Clear every combatant from this encounter?') && dispatch({ type: 'clear' })}>Clear encounter</button>
          </footer>}
        </div>
        {/* Backdrop for the mobile bottom sheet only; CSS hides it once the
            inspector returns to being a side column. Tapping it closes, matching
            the other overlays. */}
        {selected && <div class="inspector-backdrop" role="presentation" onClick={() => setSelectedId(null)} />}
        {selected && <CombatantInspector combatant={selected} dispatch={dispatch} onClose={() => setSelectedId(null)} onDamage={() => setDamageId(selected.id)} onResolveAttack={(attackId) => setAttackResolver({ combatantId: selected.id, attackId })} />}
      </div>
      {addTab && <AddCombatantsDrawer
        currentNpc={currentNpc}
        savedNpcs={savedNpcs}
        referenceEntries={referenceEntries}
        defaultPartySize={Math.max(1, state.combatants.filter((combatant) => combatant.kind === 'pc').length || 4)}
        dispatch={dispatch}
        onAddRandomToCurrent={addRandomToCurrent}
        onCreatePreparedFromRandom={createPreparedFromRandom}
        tab={addTab}
        onTabChange={setAddTab}
        onClose={() => setAddTab(null)}
      />}
      {damageTarget && <DamageDialog combatant={damageTarget} onClose={() => setDamageId(null)} dispatch={dispatch} />}
      {resolverAttacker && resolverAttack && <AttackResolverDialog
        attacker={resolverAttacker}
        attack={resolverAttack}
        combatants={state.combatants}
        dispatch={dispatch}
        onClose={() => setAttackResolver(null)}
        onOpenRangeReference={() => { setAttackResolver(null); setRangeReferenceOpen(true); }}
      />}
      {rangeReferenceOpen && <RangeDvDialog onClose={() => setRangeReferenceOpen(false)} />}
    </section>
  );
}
