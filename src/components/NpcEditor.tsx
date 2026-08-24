import type { TargetedEvent } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { PYTHON_FAKER_LOCALES } from '../engine/catalog';
import { cloneItem, createItem, itemEqualityKey } from '../engine/domain';
import type {
  Catalog,
  GeneratedNpcView,
  InventoryEntry,
  InventoryNode,
  Item,
  ItemData,
  ItemType,
  Lifepath,
  LifepathEnemy,
  Npc,
  Skill,
  StatName,
} from '../engine/types';
import { SKILL_TYPES, STAT_NAMES } from '../engine/types';
import type { NpcEditor } from './useNpcEditor';
import './NpcEditor.css';

type InputEvent = TargetedEvent<HTMLInputElement>;
type SelectEvent = TargetedEvent<HTMLSelectElement>;
type TextAreaEvent = TargetedEvent<HTMLTextAreaElement>;

interface PanelProps {
  view: GeneratedNpcView;
  editor: NpcEditor;
  catalog: Catalog;
}

function pretty(value: string): string {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function makeItem(data: ItemData, fallbackType: ItemType): Item {
  return cloneItem(createItem({ ...data, type: data.type ?? fallbackType }));
}

function customItem(type: ItemType): Item {
  const name = type === 'weapon'
    ? 'Custom Weapon'
    : type === 'armor'
      ? 'Custom Armor'
      : type === 'cyberware'
        ? 'Custom Cyberware'
        : 'Custom Gear';
  return makeItem({ name, type, price: 0 }, type);
}

function listValue(values: readonly string[]): string {
  return values.join(', ');
}

function parseList(value: string): string[] {
  return value.split(',').map((entry) => entry.trim()).filter(Boolean);
}

function lineList(value: string): string[] {
  return value.split('\n').map((entry) => entry.trim()).filter(Boolean);
}

function itemFacts(item: Item, amount?: number): string {
  return [
    amount !== undefined ? `${amount}×` : null,
    item.price ? `${item.price}eb` : null,
    item.armor_class ? `SP ${item.armor_class}` : null,
    item.damage ?? null,
    item.rate_of_fire ? `ROF ${item.rate_of_fire}` : null,
    item.magazine ? `MAG ${item.magazine}` : null,
  ].filter(Boolean).join(' · ') || pretty(item.type);
}

/**
 * Rerolls run in the generator worker, so only one can be in flight. Every
 * reroll control disables while any of them is busy and the active one reports
 * which section is being replaced.
 */
function RerollButton({
  label,
  target,
  editor,
  onClick,
}: {
  label: string;
  target: string;
  editor: NpcEditor;
  onClick: () => void;
}) {
  const active = editor.rerolling === target;
  return <button
    type="button"
    class="editor-reroll"
    disabled={Boolean(editor.rerolling)}
    aria-busy={active}
    title={`Reroll ${label.toLowerCase()}`}
    onClick={onClick}
  >{active ? 'Rerolling…' : `↻ ${label}`}</button>;
}

function FieldHead({ label, children }: { label: string; children?: preact.ComponentChildren }) {
  return <div class="editor-field-head"><span>{label}</span>{children}</div>;
}

function CatalogPicker({
  label,
  options,
  fallbackType,
  onAdd,
}: {
  label: string;
  options: readonly ItemData[];
  fallbackType: ItemType;
  onAdd: (item: Item) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return options
      .filter((item) => !needle || (item.name ?? '').toLowerCase().includes(needle))
      .slice(0, 80);
  }, [options, query]);

  const close = () => {
    setOpen(false);
    setQuery('');
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return <>
    <button type="button" class="editor-add" onClick={() => setOpen(true)}>+ {label}</button>
    {open && <div class="editor-picker-backdrop" onClick={close}>
      <section class="editor-picker" role="dialog" aria-modal="true" aria-label={label} onClick={(event) => event.stopPropagation()}>
        <header>
          <div><span class="kicker">Add to NPC</span><h3>{label}</h3></div>
          <button type="button" onClick={close}>Close</button>
        </header>
        <input
          autoFocus
          type="search"
          placeholder={`Search ${label.toLowerCase()}…`}
          value={query}
          onInput={(event: InputEvent) => setQuery(event.currentTarget.value)}
        />
        <div class="editor-picker-results">
          {filtered.map((data, index) => <button type="button" key={`${data.name ?? fallbackType}-${index}`} onClick={() => {
            onAdd(makeItem(data, fallbackType));
            close();
          }}>
            <strong>{data.name ?? `Unnamed ${fallbackType}`}</strong>
            <span>{[
              data.price ? `${data.price}eb` : null,
              data.damage ?? null,
              data.armor_class ? `SP ${data.armor_class}` : null,
              data.quality ? pretty(data.quality) : null,
            ].filter(Boolean).join(' · ') || pretty(fallbackType)}</span>
          </button>)}
          {!filtered.length && <p class="muted">No catalog matches.</p>}
        </div>
        <footer>
          <button type="button" onClick={() => {
            onAdd(customItem(fallbackType));
            close();
          }}>+ Add custom {pretty(fallbackType)}</button>
        </footer>
      </section>
    </div>}
  </>;
}

function ItemFields({ item, onChange }: { item: Item; onChange: (item: Item) => void }) {
  return <div class="editor-item-fields">
    <label><span>Name</span><input value={item.name} onInput={(event: InputEvent) => onChange({ ...item, name: event.currentTarget.value })} /></label>
    <label><span>Display name</span><input value={item.beautiful_name ?? ''} onInput={(event: InputEvent) => onChange({ ...item, beautiful_name: event.currentTarget.value || null })} /></label>
    <label><span>Price</span><input type="number" value={item.price} onInput={(event: InputEvent) => onChange({ ...item, price: Number(event.currentTarget.value) })} /></label>
    <label><span>Quality</span><select value={item.quality ?? ''} onChange={(event: SelectEvent) => onChange({ ...item, quality: event.currentTarget.value ? event.currentTarget.value as Item['quality'] : null })}>
      <option value="">None</option><option value="poor">Poor</option><option value="standard">Standard</option><option value="excellent">Excellent</option>
    </select></label>
    <label><span>Skill</span><input value={item.skill ?? ''} onInput={(event: InputEvent) => onChange({ ...item, skill: event.currentTarget.value || null })} /></label>
    <label><span>Damage</span><input value={item.damage ?? ''} placeholder="3d6" onInput={(event: InputEvent) => onChange({ ...item, damage: event.currentTarget.value || null })} /></label>
    <label><span>ROF</span><input type="number" value={item.rate_of_fire ?? ''} onInput={(event: InputEvent) => onChange({ ...item, rate_of_fire: event.currentTarget.value === '' ? null : Number(event.currentTarget.value) })} /></label>
    <label><span>Magazine</span><input type="number" value={item.magazine ?? ''} onInput={(event: InputEvent) => onChange({ ...item, magazine: event.currentTarget.value === '' ? null : Number(event.currentTarget.value) })} /></label>
    <label><span>Armor SP</span><input type="number" value={item.armor_class ?? ''} onInput={(event: InputEvent) => onChange({ ...item, armor_class: event.currentTarget.value === '' ? null : Number(event.currentTarget.value) })} /></label>
    <details class="editor-item-more">
      <summary>More fields</summary>
      <div class="editor-item-fields">
        <label><span>Type</span><select value={item.type} onChange={(event: SelectEvent) => onChange({ ...item, type: event.currentTarget.value as ItemType })}>
          {(['armor', 'weapon', 'cyberware', 'ammo', 'equipment', 'drug', 'junk'] as const).map((type) => <option key={type} value={type}>{pretty(type)}</option>)}
        </select></label>
        <label><span>Armor locations</span><input value={listValue(item.armor_locations)} onInput={(event: InputEvent) => onChange({ ...item, armor_locations: parseList(event.currentTarget.value) })} /></label>
        <label><span>Ammo types</span><input value={listValue(item.ammo_types)} onInput={(event: InputEvent) => onChange({ ...item, ammo_types: parseList(event.currentTarget.value) })} /></label>
        <label><span>Tags</span><input value={listValue(item.tags)} onInput={(event: InputEvent) => onChange({ ...item, tags: parseList(event.currentTarget.value) })} /></label>
        <label><span>Unique tags</span><input value={listValue(item.unique_tags)} onInput={(event: InputEvent) => onChange({ ...item, unique_tags: parseList(event.currentTarget.value) })} /></label>
        <label><span>Container capacity</span><input type="number" value={item.container_capacity} onInput={(event: InputEvent) => onChange({ ...item, container_capacity: Number(event.currentTarget.value) })} /></label>
        <label><span>Size in container</span><input type="number" value={item.size_in_container} onInput={(event: InputEvent) => onChange({ ...item, size_in_container: Number(event.currentTarget.value) })} /></label>
        <label><span>Max humanity loss</span><input type="number" value={item.max_humanity_loss} onInput={(event: InputEvent) => onChange({ ...item, max_humanity_loss: Number(event.currentTarget.value) })} /></label>
        <label class="editor-check"><input type="checkbox" checked={item.default_hidden} onChange={(event: InputEvent) => onChange({ ...item, default_hidden: event.currentTarget.checked })} /><span>Hidden by default</span></label>
      </div>
    </details>
  </div>;
}

function EditableItem({
  item,
  amount,
  onAmountChange,
  onChange,
  onRemove,
}: {
  item: Item;
  amount?: number;
  onAmountChange?: (amount: number) => void;
  onChange: (item: Item) => void;
  onRemove: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  return <article class={`editor-item ${expanded ? 'is-expanded' : ''}`}>
    <header>
      <button type="button" class="editor-item-main" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
        <strong>{item.beautiful_name || item.name}</strong>
        <span>{itemFacts(item, amount)}</span>
      </button>
      {amount !== undefined && <div class="editor-quantity">
        <button type="button" aria-label="Decrease quantity" onClick={() => onAmountChange?.(Math.max(0, amount - 1))}>−</button>
        <input type="number" min="0" aria-label="Quantity" value={amount} onInput={(event: InputEvent) => onAmountChange?.(Math.max(0, Number(event.currentTarget.value)))} />
        <button type="button" aria-label="Increase quantity" onClick={() => onAmountChange?.(amount + 1)}>+</button>
      </div>}
      <button type="button" onClick={() => setExpanded((value) => !value)}>{expanded ? 'Done' : 'Edit'}</button>
      <button type="button" class="danger" onClick={onRemove}>Remove</button>
    </header>
    {expanded && <ItemFields item={item} onChange={onChange} />}
  </article>;
}

const LIFEPATH_FIELDS = [
  ['cultural_origin', 'Cultural origin'],
  ['language', 'Language'],
  ['personality', 'Personality'],
  ['clothing_style', 'Clothing style'],
  ['hairstyle', 'Hairstyle'],
  ['affectation', 'Affectation'],
  ['value_most', 'Values most'],
  ['feel_about_people', 'Feels about people'],
  ['valued_person', 'Most valued person'],
  ['valued_possession', 'Most valued possession'],
  ['childhood_environment', 'Childhood environment'],
  ['family_crisis', 'Family crisis'],
  ['life_goal', 'Life goal'],
] as const;

function LifepathEditor({ lifepath, onChange }: { lifepath: Lifepath; onChange: (lifepath: Lifepath) => void }) {
  const update = (mutate: (draft: Lifepath) => void) => {
    const next = structuredClone(lifepath);
    mutate(next);
    onChange(next);
  };
  const setText = (field: string, value: string) => update((draft) => {
    const record = draft as unknown as Record<string, unknown>;
    if (value) record[field] = value;
    else delete record[field];
  });
  const enemies = lifepath.enemies ?? [];

  return <div class="editor-lifepath">
    <div class="editor-grid">
      {LIFEPATH_FIELDS.map(([field, label]) => <label key={field}>
        <span>{label}</span>
        <input value={String((lifepath as unknown as Record<string, unknown>)[field] ?? '')} onInput={(event: InputEvent) => setText(field, event.currentTarget.value)} />
      </label>)}
      <label><span>Family background</span><input value={lifepath.family_background?.name ?? ''} onInput={(event: InputEvent) => update((draft) => {
        draft.family_background = { name: event.currentTarget.value, description: draft.family_background?.description ?? '' };
      })} /></label>
      <label><span>Background details</span><input value={lifepath.family_background?.description ?? ''} onInput={(event: InputEvent) => update((draft) => {
        draft.family_background = { name: draft.family_background?.name ?? '', description: event.currentTarget.value };
      })} /></label>
    </div>
    <div class="editor-textareas">
      <label><span>Friends · one per line</span><textarea rows={4} value={(lifepath.friends ?? []).join('\n')} onInput={(event: TextAreaEvent) => update((draft) => { draft.friends = lineList(event.currentTarget.value); })} /></label>
      <label><span>Tragic love affairs · one per line</span><textarea rows={4} value={(lifepath.tragic_love_affairs ?? []).join('\n')} onInput={(event: TextAreaEvent) => update((draft) => { draft.tragic_love_affairs = lineList(event.currentTarget.value); })} /></label>
    </div>
    <section class="editor-enemies">
      <header><strong>Enemies</strong><button type="button" onClick={() => update((draft) => {
        const next: LifepathEnemy = { enemy: '', cause: '', wronged_party: 'They', resources: '', reaction: '' };
        draft.enemies = [...(draft.enemies ?? []), next];
      })}>+ Add enemy</button></header>
      {enemies.map((enemy, index) => <article key={index}>
        <div class="editor-grid">
          {(['enemy', 'cause', 'wronged_party', 'resources', 'reaction'] as const).map((field) => <label key={field}>
            <span>{pretty(field)}</span>
            <input value={enemy[field]} onInput={(event: InputEvent) => update((draft) => {
              const target = draft.enemies?.[index];
              if (target) target[field] = event.currentTarget.value;
            })} />
          </label>)}
        </div>
        <button type="button" class="danger" onClick={() => update((draft) => {
          draft.enemies = (draft.enemies ?? []).filter((_, enemyIndex) => enemyIndex !== index);
        })}>Remove enemy</button>
      </article>)}
      {!enemies.length && <p class="muted">No enemies recorded.</p>}
    </section>
  </div>;
}

/** Identity, role, description, and lifepath — the top of the sheet. */
export function IdentityEditor({ view, editor, catalog }: PanelProps) {
  return <section class="editor-panel editor-identity">
    <header class="editor-panel-head">
      <div><span class="kicker">Identity</span><h3>Who this operative is</h3></div>
      <RerollButton label="All identity" target="identity" editor={editor} onClick={() => editor.reroll('identity')} />
    </header>

    <div class="editor-grid">
      <div class="editor-field editor-span-2">
        <FieldHead label="Name"><RerollButton label="Name" target="identity:name" editor={editor} onClick={() => editor.rerollIdentity('name')} /></FieldHead>
        <div class="editor-name-pair">
          <input aria-label="First name" placeholder="First name" value={view.npc.name} onInput={(event: InputEvent) => editor.updateNpc((npc) => { npc.name = event.currentTarget.value; })} />
          <input aria-label="Surname" placeholder="Surname" value={view.npc.surname} onInput={(event: InputEvent) => editor.updateNpc((npc) => { npc.surname = event.currentTarget.value; })} />
        </div>
      </div>
      <label><span>Rank</span><select value={view.rank.name} onChange={(event: SelectEvent) => editor.setRank(event.currentTarget.value)}>
        {catalog.ranks.map((rank) => <option key={rank.name} value={rank.name}>{pretty(rank.name)}</option>)}
      </select></label>
      <label><span>Role</span><select value={view.role.name} onChange={(event: SelectEvent) => editor.setRole(event.currentTarget.value)}>
        {catalog.roles.map((role) => <option key={role.name} value={role.name}>{pretty(role.name)}</option>)}
      </select></label>
      <div class="editor-field">
        <FieldHead label="Age"><RerollButton label="Age" target="identity:age" editor={editor} onClick={() => editor.rerollIdentity('age')} /></FieldHead>
        <input type="number" min="0" aria-label="Age" value={view.npc.age} onInput={(event: InputEvent) => editor.updateNpc((npc) => { npc.age = Number(event.currentTarget.value); })} />
      </div>
      <div class="editor-field">
        <FieldHead label="Sex"><RerollButton label="Sex" target="identity:sex" editor={editor} onClick={() => editor.rerollIdentity('sex')} /></FieldHead>
        <select aria-label="Sex" value={view.npc.sex ? 'male' : 'female'} onChange={(event: SelectEvent) => editor.updateNpc((npc) => { npc.sex = event.currentTarget.value === 'male'; })}>
          <option value="male">Male</option><option value="female">Female</option>
        </select>
      </div>
      <div class="editor-field">
        <FieldHead label="Nationality"><RerollButton label="Nationality" target="identity:nationality" editor={editor} onClick={() => editor.rerollIdentity('nationality')} /></FieldHead>
        <input list="npc-editor-nationalities" aria-label="Nationality" value={view.npc.nationality ?? ''} onInput={(event: InputEvent) => editor.updateNpc((npc) => { npc.nationality = event.currentTarget.value || null; })} />
      </div>
      <label><span>Trauma Team</span><select value={view.npc.traumaTeamStatus} onChange={(event: SelectEvent) => editor.updateNpc((npc) => { npc.traumaTeamStatus = event.currentTarget.value as Npc['traumaTeamStatus']; })}>
        <option value="NONE">None</option><option value="SILVER">Silver</option><option value="EXECUTIVE">Executive</option>
      </select></label>
    </div>
    <datalist id="npc-editor-nationalities">{PYTHON_FAKER_LOCALES.map((locale) => <option key={locale} value={locale} />)}</datalist>

    <div class="editor-field">
      <FieldHead label="Description"><RerollButton label="Description" target="description" editor={editor} onClick={() => editor.reroll('description')} /></FieldHead>
      <textarea rows={4} aria-label="Description" value={view.npc.description} onInput={(event: TextAreaEvent) => editor.updateNpc((npc) => { npc.description = event.currentTarget.value; })} />
    </div>

    <details class="editor-disclosure">
      <summary><span>Lifepath</span><small>Background, relationships, and goals</small></summary>
      <div class="editor-disclosure-body">
        <div class="editor-disclosure-actions">
          <RerollButton label="Lifepath" target="identity:lifepath" editor={editor} onClick={() => editor.rerollIdentity('lifepath')} />
        </div>
        <LifepathEditor lifepath={view.npc.lifepath} onChange={(lifepath) => editor.updateNpc((npc) => { npc.lifepath = lifepath; })} />
      </div>
    </details>
  </section>;
}

export function StatsEditor({ view, editor }: Omit<PanelProps, 'catalog'>) {
  return <section class="editor-panel">
    <header class="editor-panel-head">
      <div><span class="kicker">Stats</span><h3>Base values</h3></div>
      <RerollButton label="Stats" target="stats" editor={editor} onClick={() => editor.reroll('stats')} />
    </header>
    <div class="editor-stats">
      {STAT_NAMES.map((name: StatName) => {
        const stat = view.stats.find((candidate) => candidate.name === name);
        if (!stat) return null;
        return <label key={name}>
          <span>{name}</span>
          <input type="number" min="1" max="10" value={stat.base} onInput={(event: InputEvent) => editor.updateNpc((npc) => {
            npc.stats.set(name, Math.max(1, Math.min(10, Number(event.currentTarget.value))));
          })} />
          <strong>{stat.total}</strong>
          <small>{stat.modifier ? `${stat.modifier >= 0 ? '+' : ''}${stat.modifier} gear` : 'no modifiers'}</small>
        </label>;
      })}
    </div>
  </section>;
}

export function SkillsEditor({ view, editor }: Omit<PanelProps, 'catalog'>) {
  const [query, setQuery] = useState('');
  const [trainedOnly, setTrainedOnly] = useState(false);
  const needle = query.trim().toLowerCase();

  const setLevel = (name: string, level: number) => editor.updateNpc((npc) => {
    const entry = npc.skills.get(name);
    if (entry) entry.level = Math.max(0, Math.min(10, level));
  });

  return <section class="editor-panel">
    <header class="editor-panel-head">
      <div><span class="kicker">Skills</span><h3>Trained levels</h3></div>
      <RerollButton label="Skills" target="skills" editor={editor} onClick={() => editor.reroll('skills')} />
    </header>
    <div class="editor-toolbar">
      <input type="search" placeholder="Search skills…" value={query} onInput={(event: InputEvent) => setQuery(event.currentTarget.value)} />
      <button type="button" class={trainedOnly ? 'active' : ''} onClick={() => setTrainedOnly((value) => !value)}>Trained only</button>
    </div>
    <div class="editor-skill-groups">{SKILL_TYPES.map((type) => {
      const skills = view.skills
        .filter((skill) => skill.type === type)
        .filter((skill) => !trainedOnly || skill.base > 0)
        .filter((skill) => !needle || skill.name.toLowerCase().includes(needle));
      if (!skills.length) return null;
      return <section key={type}>
        <h4>{pretty(type)}</h4>
        {skills.map((skill) => <div class="editor-skill-row" key={skill.name}>
          <div>
            <strong>{skill.name}</strong>
            <small>{skill.link} · total {skill.total}{skill.modifier ? ` · ${skill.modifier >= 0 ? '+' : ''}${skill.modifier} gear` : ''}</small>
          </div>
          <div class="editor-stepper">
            <button type="button" aria-label={`Lower ${skill.name}`} disabled={skill.base <= 0} onClick={() => setLevel(skill.name, skill.base - 1)}>−</button>
            <input type="number" min="0" max="10" aria-label={skill.name} value={skill.base} onInput={(event: InputEvent) => setLevel(skill.name, Number(event.currentTarget.value))} />
            <button type="button" aria-label={`Raise ${skill.name}`} disabled={skill.base >= 10} onClick={() => setLevel(skill.name, skill.base + 1)}>+</button>
          </div>
        </div>)}
      </section>;
    })}</div>
  </section>;
}

export function GearEditor({ view, editor, catalog }: PanelProps) {
  const inventoryCatalog = useMemo(
    () => [...catalog.equipment, ...catalog.drugs, ...catalog.junk],
    [catalog],
  );
  const inventory = [...view.npc.inventory.entries()];

  return <>
    <section class="editor-panel">
      <header class="editor-panel-head">
        <div><span class="kicker">Armor</span><h3>{view.npc.armor.length} equipped</h3></div>
        <div class="editor-panel-actions">
          <RerollButton label="Armor" target="armor" editor={editor} onClick={() => editor.reroll('armor')} />
          <CatalogPicker label="Add armor" options={catalog.armor} fallbackType="armor" onAdd={(item) => editor.updateNpc((npc) => { npc.armor = [...npc.armor, item]; })} />
        </div>
      </header>
      <div class="editor-item-list">
        {view.npc.armor.map((item, index) => <EditableItem
          key={`${item.id}-${index}`}
          item={item}
          onChange={(next) => editor.updateNpc((npc) => { npc.armor = npc.armor.map((candidate, itemIndex) => itemIndex === index ? next : candidate); })}
          onRemove={() => editor.updateNpc((npc) => { npc.armor = npc.armor.filter((_, itemIndex) => itemIndex !== index); })}
        />)}
        {!view.npc.armor.length && <p class="muted">No armor equipped.</p>}
      </div>
    </section>

    <section class="editor-panel">
      <header class="editor-panel-head">
        <div><span class="kicker">Weapons</span><h3>{view.npc.weapons.length} carried</h3></div>
        <div class="editor-panel-actions">
          <RerollButton label="Weapons" target="weapons" editor={editor} onClick={() => editor.reroll('weapons')} />
          <CatalogPicker label="Add weapon" options={catalog.weapons} fallbackType="weapon" onAdd={(item) => editor.updateNpc((npc) => { npc.weapons = [...npc.weapons, item]; })} />
        </div>
      </header>
      <div class="editor-item-list">
        {view.npc.weapons.map((item, index) => <EditableItem
          key={`${item.id}-${index}`}
          item={item}
          onChange={(next) => editor.updateNpc((npc) => { npc.weapons = npc.weapons.map((candidate, itemIndex) => itemIndex === index ? next : candidate); })}
          onRemove={() => editor.updateNpc((npc) => { npc.weapons = npc.weapons.filter((_, itemIndex) => itemIndex !== index); })}
        />)}
        {!view.npc.weapons.length && <p class="muted">No weapons configured.</p>}
      </div>
    </section>

    <section class="editor-panel">
      <header class="editor-panel-head">
        <div><span class="kicker">Inventory</span><h3>{inventory.length} entries</h3></div>
        <div class="editor-panel-actions">
          <RerollButton label="Inventory" target="inventory" editor={editor} onClick={() => editor.reroll('inventory')} />
          <CatalogPicker label="Add gear" options={inventoryCatalog} fallbackType="equipment" onAdd={(item) => editor.updateNpc((npc) => {
            const key = itemEqualityKey(item);
            const existing = npc.inventory.get(key);
            npc.inventory.set(key, { item: existing?.item ?? item, amount: (existing?.amount ?? 0) + 1 });
          })} />
        </div>
      </header>
      <div class="editor-item-list">
        {inventory.map(([key, entry]) => <EditableItem
          key={key}
          item={entry.item}
          amount={entry.amount}
          onAmountChange={(amount) => editor.updateNpc((npc) => {
            if (amount <= 0) {
              npc.inventory.delete(key);
              return;
            }
            const target = npc.inventory.get(key);
            if (target) target.amount = amount;
          })}
          onChange={(next) => editor.updateNpc((npc) => {
            const target = npc.inventory.get(key);
            if (!target) return;
            // Renaming or requalifying an item changes its identity key, so the
            // entry has to move rather than keep a key that no longer matches.
            const nextKey = itemEqualityKey(next);
            npc.inventory.delete(key);
            npc.inventory.set(nextKey, { ...target, item: next });
          })}
          onRemove={() => editor.updateNpc((npc) => { npc.inventory.delete(key); })}
        />)}
        {!inventory.length && <p class="muted">No carried gear.</p>}
      </div>
    </section>
  </>;
}

function CyberwareNodeEditor({
  node,
  catalog,
  onChange,
  onRemove,
}: {
  node: InventoryNode;
  catalog: Catalog;
  onChange: (node: InventoryNode) => void;
  onRemove: () => void;
}) {
  const installable = catalog.cyberware.filter((item) => item.name !== 'Meatbody');
  return <article class="editor-cyber-node">
    <EditableItem item={node.item} onChange={(item) => onChange({ ...node, item })} onRemove={onRemove} />
    <div class="editor-cyber-install">
      <CatalogPicker
        label={`Install in ${node.item.name}`}
        options={installable}
        fallbackType="cyberware"
        onAdd={(item) => onChange({ ...node, children: [...node.children, { item, children: [] }] })}
      />
    </div>
    {node.children.length > 0 && <div class="editor-cyber-children">
      {node.children.map((child, index) => <CyberwareNodeEditor
        key={`${child.item.id}-${index}`}
        node={child}
        catalog={catalog}
        onChange={(next) => onChange({ ...node, children: node.children.map((candidate, childIndex) => childIndex === index ? next : candidate) })}
        onRemove={() => onChange({ ...node, children: node.children.filter((_, childIndex) => childIndex !== index) })}
      />)}
    </div>}
  </article>;
}

export function CyberwareEditor({ view, editor, catalog }: PanelProps) {
  const installable = catalog.cyberware.filter((item) => item.name !== 'Meatbody');
  return <section class="editor-panel">
    <header class="editor-panel-head">
      <div><span class="kicker">Cyberware</span><h3>{view.npc.cyberware.children.length} installed at the body root</h3></div>
      <div class="editor-panel-actions">
        <RerollButton label="Cyberware" target="cyberware" editor={editor} onClick={() => editor.reroll('cyberware')} />
        <CatalogPicker label="Install cyberware" options={installable} fallbackType="cyberware" onAdd={(item) => editor.updateNpc((npc) => {
          npc.cyberware.children = [...npc.cyberware.children, { item, children: [] }];
        })} />
      </div>
    </header>
    <div class="editor-item-list">
      {view.npc.cyberware.children.map((node, index) => <CyberwareNodeEditor
        key={`${node.item.id}-${index}`}
        node={node}
        catalog={catalog}
        onChange={(next) => editor.updateNpc((npc) => {
          npc.cyberware.children = npc.cyberware.children.map((candidate, childIndex) => childIndex === index ? next : candidate);
        })}
        onRemove={() => editor.updateNpc((npc) => {
          npc.cyberware.children = npc.cyberware.children.filter((_, childIndex) => childIndex !== index);
        })}
      />)}
      {!view.npc.cyberware.children.length && <p class="muted">No cyberware installed. Capacity problems are reported by the character check after Apply.</p>}
    </div>
  </section>;
}

interface PortableNpc extends Omit<Npc, 'stats' | 'skills' | 'inventory'> {
  stats: Record<string, number>;
  skills: Record<string, { skill: Skill; level: number }>;
  inventory: Array<{ key: string; item: Item; amount: number }>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** Maps hold NPC stats, skills, and inventory; JSON needs them flattened. */
function serializeNpc(npc: Npc): string {
  const portable: PortableNpc = {
    ...npc,
    stats: Object.fromEntries(npc.stats),
    skills: Object.fromEntries(npc.skills),
    inventory: [...npc.inventory].map(([key, entry]) => ({ key, item: entry.item, amount: entry.amount })),
  };
  return JSON.stringify(portable, null, 2);
}

function parseNpc(text: string): Npc {
  const parsed: unknown = JSON.parse(text);
  if (!isRecord(parsed)) throw new Error('NPC data must be a JSON object.');
  if (typeof parsed.name !== 'string' || typeof parsed.surname !== 'string') throw new Error('NPC name and surname must be strings.');
  if (typeof parsed.sex !== 'boolean') throw new Error('NPC sex must be a boolean.');
  if (typeof parsed.age !== 'number' || !Number.isFinite(parsed.age)) throw new Error('NPC age must be a number.');
  if (parsed.nationality !== null && typeof parsed.nationality !== 'string') throw new Error('NPC nationality must be a string or null.');
  if (typeof parsed.description !== 'string' || typeof parsed.role !== 'string') throw new Error('NPC description and role must be strings.');
  if (!isRecord(parsed.lifepath)) throw new Error('NPC lifepath must be an object.');
  if (!['NONE', 'SILVER', 'EXECUTIVE'].includes(String(parsed.traumaTeamStatus))) throw new Error('NPC Trauma Team status is invalid.');
  if (!isRecord(parsed.stats)) throw new Error('NPC data must contain a stats object.');
  if (!isRecord(parsed.skills)) throw new Error('NPC data must contain a skills object.');
  if (!Array.isArray(parsed.inventory)) throw new Error('NPC data must contain an inventory array.');
  if (!isRecord(parsed.cyberware) || !isRecord(parsed.cyberware.item) || !Array.isArray(parsed.cyberware.children)) throw new Error('NPC data must contain a cyberware tree.');
  if (!Array.isArray(parsed.armor) || !parsed.armor.every(isRecord)) throw new Error('NPC armor must be an array of items.');
  if (!Array.isArray(parsed.weapons) || !parsed.weapons.every(isRecord)) throw new Error('NPC weapons must be an array of items.');

  const stats = new Map<StatName, number>();
  for (const stat of STAT_NAMES) {
    const value = parsed.stats[stat];
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${stat} must be a number.`);
    stats.set(stat, value);
  }

  const skills = new Map<string, { skill: Skill; level: number }>();
  for (const [name, rawEntry] of Object.entries(parsed.skills)) {
    if (!isRecord(rawEntry) || !isRecord(rawEntry.skill) || typeof rawEntry.level !== 'number' || !Number.isFinite(rawEntry.level)) {
      throw new Error(`Skill ${name} is invalid.`);
    }
    if (typeof rawEntry.skill.name !== 'string' || typeof rawEntry.skill.link !== 'string' || typeof rawEntry.skill.type !== 'string') {
      throw new Error(`Skill ${name} must contain name, linked stat, and type fields.`);
    }
    skills.set(name, rawEntry as unknown as { skill: Skill; level: number });
  }

  const inventory = new Map<string, InventoryEntry>();
  for (const rawEntry of parsed.inventory) {
    if (!isRecord(rawEntry) || typeof rawEntry.key !== 'string' || !isRecord(rawEntry.item) || typeof rawEntry.amount !== 'number' || !Number.isFinite(rawEntry.amount)) {
      throw new Error('Every inventory entry needs key, item, and numeric amount fields.');
    }
    inventory.set(rawEntry.key, { item: rawEntry.item as unknown as Item, amount: rawEntry.amount });
  }

  return {
    ...(parsed as unknown as Omit<Npc, 'stats' | 'skills' | 'inventory'>),
    stats,
    skills,
    inventory,
  };
}

/**
 * Escape hatch for upstream fields with no dedicated control, such as modifier
 * scripts and unusual item metadata. It is deliberately explicit — text is only
 * parsed back into the draft when the user asks for it, so a half-typed edit
 * never destroys the sheet behind it.
 */
export function RawNpcEditor({ view, editor }: Omit<PanelProps, 'catalog'>) {
  const [text, setText] = useState(() => serializeNpc(view.npc));
  const [error, setError] = useState<string | null>(null);
  const [applied, setApplied] = useState(false);
  const [dirty, setDirty] = useState(false);

  // Edits made through the panels above must show up here, or the user could
  // open this disclosure, see stale JSON, and load it back over their own work.
  // Once they have typed, their text is theirs until they reset it.
  useEffect(() => {
    if (dirty) return;
    setText(serializeNpc(view.npc));
  }, [view.npc, dirty]);

  const load = () => {
    setText(serializeNpc(view.npc));
    setError(null);
    setApplied(false);
    setDirty(false);
  };

  const applyText = () => {
    try {
      editor.replaceNpc(parseNpc(text));
      setError(null);
      setApplied(true);
      setDirty(false);
    } catch (parseError) {
      setError(parseError instanceof Error ? parseError.message : String(parseError));
      setApplied(false);
    }
  };

  return <details class="editor-disclosure editor-raw">
    <summary><span>Raw NPC data</span><small>Uncommon fields with no control above</small></summary>
    <div class="editor-disclosure-body">
      <p class="muted">Edits here apply to the draft only when you select Load into draft, and still need Apply changes to be committed.</p>
      {error && <div class="content-notice error" role="alert"><strong>Data needs attention</strong><span>{error}</span></div>}
      {applied && !error && <p class="editor-raw-ok">Loaded into the draft.</p>}
      <textarea
        aria-label="Complete NPC JSON"
        spellcheck={false}
        rows={22}
        value={text}
        onInput={(event: TextAreaEvent) => {
          setText(event.currentTarget.value);
          setError(null);
          setApplied(false);
          setDirty(true);
        }}
      />
      <div class="editor-disclosure-actions">
        <button type="button" onClick={load}>Reset from draft</button>
        <button type="button" onClick={applyText}>Load into draft</button>
      </div>
    </div>
  </details>;
}

/** Sticky commit bar. Editing is a draft, so it needs a permanent way out. */
export function EditorActionBar({ view, editor }: Omit<PanelProps, 'catalog'>) {
  const busy = Boolean(editor.rerolling);
  return <div class="editor-actionbar" role="region" aria-label="NPC edit actions" aria-busy={busy}>
    <div class="editor-actionbar-copy">
      <strong>{busy ? `Rerolling ${pretty(String(editor.rerolling).replace('identity:', ''))}…` : `Editing ${view.npc.name} ${view.npc.surname}`}</strong>
      <small>{busy ? 'Generating a replacement for this section.' : 'Derived totals update live. Nothing is committed until you apply.'}</small>
      {editor.error && <small class="editor-actionbar-error" role="alert">{editor.error}</small>}
    </div>
    <div class="editor-actionbar-actions">
      <button type="button" disabled={busy} onClick={editor.cancel}>Cancel</button>
      <button type="button" class="primary-action" disabled={busy} onClick={editor.apply}>Apply changes</button>
    </div>
  </div>;
}
