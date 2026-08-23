import type { TargetedEvent } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import type { CatalogEntry } from '../content/types';
import { PYTHON_FAKER_LOCALES } from '../engine/catalog';
import { rebuildManualNpcView } from '../engine/builder';
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
  Npc,
  Skill,
  StatName,
} from '../engine/types';
import { STAT_NAMES } from '../engine/types';
import './NpcBuilder.css';

type InputEvent = TargetedEvent<HTMLInputElement>;
type SelectEvent = TargetedEvent<HTMLSelectElement>;
type TextAreaEvent = TargetedEvent<HTMLTextAreaElement>;

interface PortableNpc extends Omit<Npc, 'stats' | 'skills' | 'inventory'> {
  stats: Record<string, number>;
  skills: Record<string, { skill: Skill; level: number }>;
  inventory: Array<{ key: string; item: Item; amount: number }>;
}

const LIFEPATH_TEXT_FIELDS = [
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

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

function pretty(value: string): string {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
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

function makeItem(data: ItemData, fallbackType: ItemType): Item {
  return cloneItem(createItem({ ...data, type: data.type ?? fallbackType }));
}

function customItem(type: ItemType): Item {
  return makeItem({
    name: type === 'weapon' ? 'Custom Weapon' : type === 'armor' ? 'Custom Armor' : type === 'cyberware' ? 'Custom Cyberware' : 'Custom Gear',
    type,
    price: 0,
  }, type);
}

function CatalogAdder({
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
  const [selected, setSelected] = useState('');
  const addSelected = () => {
    if (!selected) return;
    const option = options[Number(selected)];
    if (!option) return;
    onAdd(makeItem(option, fallbackType));
    setSelected('');
  };

  return <div class="builder-add-row">
    <label>
      <span>{label}</span>
      <select value={selected} onChange={(event: SelectEvent) => setSelected(event.currentTarget.value)}>
        <option value="">Choose from catalog…</option>
        {options.map((item, index) => <option key={`${item.name ?? fallbackType}-${index}`} value={String(index)}>{item.name ?? `Unnamed ${fallbackType}`}</option>)}
      </select>
    </label>
    <button type="button" disabled={!selected} onClick={addSelected}>Add selected</button>
    <button type="button" onClick={() => onAdd(customItem(fallbackType))}>Add custom</button>
  </div>;
}

function ItemEditor({
  item,
  onChange,
  onRemove,
  compact = false,
}: {
  item: Item;
  onChange: (item: Item) => void;
  onRemove: () => void;
  compact?: boolean;
}) {
  return <article class={`builder-item ${compact ? 'compact' : ''}`}>
    <header>
      <div><strong>{item.beautiful_name || item.name}</strong><small>{pretty(item.type)}</small></div>
      <button type="button" class="danger" onClick={onRemove}>Remove</button>
    </header>
    <div class="builder-item-fields">
      <label><span>Name</span><input value={item.name} onInput={(event: InputEvent) => onChange({ ...item, name: event.currentTarget.value })} /></label>
      <label><span>Display name</span><input value={item.beautiful_name ?? ''} onInput={(event: InputEvent) => onChange({ ...item, beautiful_name: event.currentTarget.value || null })} /></label>
      <label><span>Type</span><select value={item.type} onChange={(event: SelectEvent) => onChange({ ...item, type: event.currentTarget.value as ItemType })}>
        {['armor', 'weapon', 'cyberware', 'ammo', 'equipment', 'drug', 'junk'].map((type) => <option key={type} value={type}>{pretty(type)}</option>)}
      </select></label>
      <label><span>Price (eb)</span><input type="number" value={item.price} onInput={(event: InputEvent) => onChange({ ...item, price: Number(event.currentTarget.value) })} /></label>
      <label><span>Quality</span><select value={item.quality ?? ''} onChange={(event: SelectEvent) => onChange({ ...item, quality: event.currentTarget.value ? event.currentTarget.value as Item['quality'] : null })}>
        <option value="">None</option><option value="poor">Poor</option><option value="standard">Standard</option><option value="excellent">Excellent</option>
      </select></label>
      <label><span>Skill</span><input value={item.skill ?? ''} onInput={(event: InputEvent) => onChange({ ...item, skill: event.currentTarget.value || null })} /></label>
      <label><span>Damage</span><input value={item.damage ?? ''} placeholder="e.g. 3d6" onInput={(event: InputEvent) => onChange({ ...item, damage: event.currentTarget.value || null })} /></label>
      <label><span>ROF</span><input type="number" value={item.rate_of_fire ?? ''} onInput={(event: InputEvent) => onChange({ ...item, rate_of_fire: event.currentTarget.value === '' ? null : Number(event.currentTarget.value) })} /></label>
      <label><span>Magazine</span><input type="number" value={item.magazine ?? ''} onInput={(event: InputEvent) => onChange({ ...item, magazine: event.currentTarget.value === '' ? null : Number(event.currentTarget.value) })} /></label>
      <label><span>Armor SP</span><input type="number" value={item.armor_class ?? ''} onInput={(event: InputEvent) => onChange({ ...item, armor_class: event.currentTarget.value === '' ? null : Number(event.currentTarget.value) })} /></label>
    </div>
    <details class="builder-item-advanced">
      <summary>More item fields</summary>
      <div class="builder-item-fields">
        <label><span>Armor locations</span><input value={listValue(item.armor_locations)} onInput={(event: InputEvent) => onChange({ ...item, armor_locations: parseList(event.currentTarget.value) })} /></label>
        <label><span>Ammo types</span><input value={listValue(item.ammo_types)} onInput={(event: InputEvent) => onChange({ ...item, ammo_types: parseList(event.currentTarget.value) })} /></label>
        <label><span>Tags</span><input value={listValue(item.tags)} onInput={(event: InputEvent) => onChange({ ...item, tags: parseList(event.currentTarget.value) })} /></label>
        <label><span>Unique tags</span><input value={listValue(item.unique_tags)} onInput={(event: InputEvent) => onChange({ ...item, unique_tags: parseList(event.currentTarget.value) })} /></label>
        <label><span>Container capacity</span><input type="number" value={item.container_capacity} onInput={(event: InputEvent) => onChange({ ...item, container_capacity: Number(event.currentTarget.value) })} /></label>
        <label><span>Size in container</span><input type="number" value={item.size_in_container} onInput={(event: InputEvent) => onChange({ ...item, size_in_container: Number(event.currentTarget.value) })} /></label>
        <label><span>Max humanity loss</span><input type="number" value={item.max_humanity_loss} onInput={(event: InputEvent) => onChange({ ...item, max_humanity_loss: Number(event.currentTarget.value) })} /></label>
        <label class="builder-check"><input type="checkbox" checked={item.default_hidden} onChange={(event: InputEvent) => onChange({ ...item, default_hidden: event.currentTarget.checked })} /><span>Hidden by default</span></label>
      </div>
    </details>
  </article>;
}

function CyberwareNodeEditor({
  node,
  catalog,
  onChange,
  onRemove,
  root = false,
  depth = 0,
}: {
  node: InventoryNode;
  catalog: Catalog;
  onChange: (node: InventoryNode) => void;
  onRemove?: () => void;
  root?: boolean;
  depth?: number;
}) {
  const available = catalog.cyberware.filter((item) => item.name !== 'Meatbody');
  const addChild = (item: Item) => onChange({ ...node, children: [...node.children, { item, children: [] }] });

  return <div class={`builder-cyber-node ${root ? 'root' : ''}`} style={{ '--builder-depth': depth } as Record<string, number>}>
    {root ? <div class="builder-cyber-root"><strong>{node.item.name}</strong><span>{node.children.length} installed</span></div> : (
      <ItemEditor item={node.item} compact onChange={(item) => onChange({ ...node, item })} onRemove={() => onRemove?.()} />
    )}
    <CatalogAdder label={root ? 'Install cyberware' : `Install inside ${node.item.name}`} options={available} fallbackType="cyberware" onAdd={addChild} />
    {node.children.length > 0 && <div class="builder-cyber-children">
      {node.children.map((child, index) => <CyberwareNodeEditor
        key={`${child.item.id}-${index}`}
        node={child}
        catalog={catalog}
        depth={depth + 1}
        onRemove={() => onChange({ ...node, children: node.children.filter((_, childIndex) => childIndex !== index) })}
        onChange={(next) => onChange({ ...node, children: node.children.map((candidate, childIndex) => childIndex === index ? next : candidate) })}
      />)}
    </div>}
  </div>;
}

function setLifepathText(lifepath: Lifepath, field: string, value: string): void {
  const record = lifepath as unknown as Record<string, unknown>;
  if (value) record[field] = value;
  else delete record[field];
}

export function NpcBuilder({
  view,
  catalog,
  referenceEntries,
  onApply,
  onCancel,
}: {
  view: GeneratedNpcView;
  catalog: Catalog;
  referenceEntries: readonly CatalogEntry[];
  onApply: (view: GeneratedNpcView) => void | Promise<void>;
  onCancel: () => void;
}) {
  const [draftText, setDraftText] = useState(() => serializeNpc(view.npc));
  const [rankName, setRankName] = useState(view.rank.name);
  const [roleName, setRoleName] = useState(view.role.name);
  const [skillSearch, setSkillSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);

  const parsed = useMemo(() => {
    try {
      return { npc: parseNpc(draftText), error: null as string | null };
    } catch (error) {
      return { npc: null, error: error instanceof Error ? error.message : String(error) };
    }
  }, [draftText]);

  const inventoryCatalog = useMemo(() => [
    ...catalog.equipment,
    ...catalog.drugs,
    ...catalog.junk,
  ], [catalog]);

  const updateNpc = (mutate: (npc: Npc) => void) => {
    if (!parsed.npc) return;
    const next = structuredClone(parsed.npc);
    mutate(next);
    setDraftText(serializeNpc(next));
    setApplyError(null);
  };

  const visibleSkills = parsed.npc
    ? [...parsed.npc.skills.entries()]
      .filter(([name]) => !skillSearch.trim() || name.toLowerCase().includes(skillSearch.trim().toLowerCase()))
      .sort(([left], [right]) => left.localeCompare(right))
    : [];

  const apply = async () => {
    if (!parsed.npc || busy) return;
    setBusy(true);
    setApplyError(null);
    try {
      const next = rebuildManualNpcView(view, parsed.npc, rankName, roleName, catalog, referenceEntries);
      await onApply(next);
      setBusy(false);
    } catch (error) {
      setApplyError(error instanceof Error ? error.message : String(error));
      setBusy(false);
    }
  };

  return (
    <section class="npc-builder">
      <header class="builder-toolbar">
        <div>
          <span class="kicker">Manual construction</span>
          <h2>NPC builder</h2>
          <p>Every common NPC field is editable here. Changes recalculate combat, validation and exports when applied.</p>
        </div>
        <div class="builder-toolbar-actions">
          <button type="button" onClick={onCancel} disabled={busy}>Cancel</button>
          <button type="button" class="primary-action" onClick={() => void apply()} disabled={busy || !parsed.npc}>{busy ? 'Applying…' : 'Apply NPC'}</button>
        </div>
      </header>

      {(parsed.error || applyError) && (
        <div class="content-notice error" role="alert">
          <strong>Builder data needs attention</strong>
          <span>{applyError ?? parsed.error}</span>
        </div>
      )}

      {parsed.npc && <>
        <article class="builder-section">
          <header><div><span class="kicker">01</span><h3>Identity & role</h3></div><span>Core profile</span></header>
          <div class="builder-field-grid">
            <label><span>Rank</span><select value={rankName} onChange={(event: SelectEvent) => setRankName(event.currentTarget.value)}>
              {catalog.ranks.map((rank) => <option key={rank.name} value={rank.name}>{pretty(rank.name)}</option>)}
            </select></label>
            <label><span>Role</span><select value={roleName} onChange={(event: SelectEvent) => setRoleName(event.currentTarget.value)}>
              {catalog.roles.map((role) => <option key={role.name} value={role.name}>{pretty(role.name)}</option>)}
            </select></label>
            <label><span>First name</span><input value={parsed.npc.name} onInput={(event: InputEvent) => updateNpc((npc) => { npc.name = event.currentTarget.value; })} /></label>
            <label><span>Surname</span><input value={parsed.npc.surname} onInput={(event: InputEvent) => updateNpc((npc) => { npc.surname = event.currentTarget.value; })} /></label>
            <label><span>Age</span><input type="number" min="0" value={parsed.npc.age} onInput={(event: InputEvent) => updateNpc((npc) => { npc.age = Number(event.currentTarget.value); })} /></label>
            <label><span>Sex</span><select value={parsed.npc.sex ? 'male' : 'female'} onChange={(event: SelectEvent) => updateNpc((npc) => { npc.sex = event.currentTarget.value === 'male'; })}>
              <option value="male">Male</option><option value="female">Female</option>
            </select></label>
            <label><span>Nationality / locale</span><input list="npc-builder-nationalities" value={parsed.npc.nationality ?? ''} onInput={(event: InputEvent) => updateNpc((npc) => { npc.nationality = event.currentTarget.value || null; })} /></label>
            <label><span>Trauma Team</span><select value={parsed.npc.traumaTeamStatus} onChange={(event: SelectEvent) => updateNpc((npc) => { npc.traumaTeamStatus = event.currentTarget.value as Npc['traumaTeamStatus']; })}>
              <option value="NONE">None</option><option value="SILVER">Silver</option><option value="EXECUTIVE">Executive</option>
            </select></label>
          </div>
          <datalist id="npc-builder-nationalities">{PYTHON_FAKER_LOCALES.map((locale) => <option key={locale} value={locale} />)}</datalist>
          <label class="builder-full-field"><span>Description</span><textarea rows={5} value={parsed.npc.description} onInput={(event: TextAreaEvent) => updateNpc((npc) => { npc.description = event.currentTarget.value; })} /></label>
        </article>

        <article class="builder-section">
          <header><div><span class="kicker">02</span><h3>Stats</h3></div><span>Base values</span></header>
          <div class="builder-stats-grid">
            {STAT_NAMES.map((stat) => <label key={stat}><span>{stat}</span><input type="number" min="0" value={parsed.npc!.stats.get(stat) ?? 0} onInput={(event: InputEvent) => updateNpc((npc) => { npc.stats.set(stat, Number(event.currentTarget.value)); })} /></label>)}
          </div>
        </article>

        <article class="builder-section">
          <header><div><span class="kicker">03</span><h3>Skills</h3></div><span>{parsed.npc.skills.size} editable skills</span></header>
          <div class="builder-search"><input type="search" placeholder="Filter skills" value={skillSearch} onInput={(event: InputEvent) => setSkillSearch(event.currentTarget.value)} /></div>
          <div class="builder-skill-grid">
            {visibleSkills.map(([name, entry]) => <label key={name}>
              <span>{name}<small>{entry.skill.link} · {pretty(entry.skill.type)}</small></span>
              <input type="number" min="0" max="10" value={entry.level} onInput={(event: InputEvent) => updateNpc((npc) => {
                const skill = npc.skills.get(name);
                if (skill) skill.level = Number(event.currentTarget.value);
              })} />
            </label>)}
          </div>
        </article>

        <article class="builder-section">
          <header><div><span class="kicker">04</span><h3>Lifepath</h3></div><span>Background & hooks</span></header>
          <div class="builder-field-grid">
            {LIFEPATH_TEXT_FIELDS.map(([field, label]) => <label key={field}><span>{label}</span><input value={String(parsed.npc!.lifepath[field] ?? '')} onInput={(event: InputEvent) => updateNpc((npc) => setLifepathText(npc.lifepath, field, event.currentTarget.value))} /></label>)}
            <label><span>Family background</span><input value={parsed.npc.lifepath.family_background?.name ?? ''} onInput={(event: InputEvent) => updateNpc((npc) => {
              npc.lifepath.family_background = { name: event.currentTarget.value, description: npc.lifepath.family_background?.description ?? '' };
            })} /></label>
            <label><span>Family background details</span><input value={parsed.npc.lifepath.family_background?.description ?? ''} onInput={(event: InputEvent) => updateNpc((npc) => {
              npc.lifepath.family_background = { name: npc.lifepath.family_background?.name ?? '', description: event.currentTarget.value };
            })} /></label>
          </div>
          <div class="builder-textarea-grid">
            <label><span>Friends · one per line</span><textarea rows={5} value={(parsed.npc.lifepath.friends ?? []).join('\n')} onInput={(event: TextAreaEvent) => updateNpc((npc) => { npc.lifepath.friends = lineList(event.currentTarget.value); })} /></label>
            <label><span>Tragic love affairs · one per line</span><textarea rows={5} value={(parsed.npc.lifepath.tragic_love_affairs ?? []).join('\n')} onInput={(event: TextAreaEvent) => updateNpc((npc) => { npc.lifepath.tragic_love_affairs = lineList(event.currentTarget.value); })} /></label>
          </div>
          <div class="builder-enemy-list">
            <div class="builder-subhead"><strong>Enemies</strong><button type="button" onClick={() => updateNpc((npc) => {
              npc.lifepath.enemies = [...(npc.lifepath.enemies ?? []), { enemy: '', cause: '', wronged_party: 'You', resources: '', reaction: '' }];
            })}>Add enemy</button></div>
            {(parsed.npc.lifepath.enemies ?? []).map((enemy, index) => <article key={index} class="builder-enemy-card">
              <div class="builder-field-grid">
                {(['enemy', 'cause', 'wronged_party', 'resources', 'reaction'] as const).map((field) => <label key={field}><span>{pretty(field)}</span><input value={enemy[field]} onInput={(event: InputEvent) => updateNpc((npc) => {
                  const enemies = [...(npc.lifepath.enemies ?? [])];
                  const current = enemies[index];
                  if (current) enemies[index] = { ...current, [field]: event.currentTarget.value };
                  npc.lifepath.enemies = enemies;
                })} /></label>)}
              </div>
              <button type="button" class="danger" onClick={() => updateNpc((npc) => { npc.lifepath.enemies = (npc.lifepath.enemies ?? []).filter((_, enemyIndex) => enemyIndex !== index); })}>Remove enemy</button>
            </article>)}
          </div>
        </article>

        <article class="builder-section">
          <header><div><span class="kicker">05</span><h3>Armor</h3></div><span>{parsed.npc.armor.length} equipped</span></header>
          <CatalogAdder label="Add armor" options={catalog.armor} fallbackType="armor" onAdd={(item) => updateNpc((npc) => { npc.armor.push(item); })} />
          <div class="builder-item-list">
            {parsed.npc.armor.map((item, index) => <ItemEditor key={`${item.id}-${index}`} item={item} onChange={(next) => updateNpc((npc) => { npc.armor[index] = next; })} onRemove={() => updateNpc((npc) => { npc.armor.splice(index, 1); })} />)}
            {parsed.npc.armor.length === 0 && <p class="builder-empty">No armor equipped.</p>}
          </div>
        </article>

        <article class="builder-section">
          <header><div><span class="kicker">06</span><h3>Weapons</h3></div><span>{parsed.npc.weapons.length} attacks</span></header>
          <CatalogAdder label="Add weapon" options={catalog.weapons} fallbackType="weapon" onAdd={(item) => updateNpc((npc) => { npc.weapons.push(item); })} />
          <div class="builder-item-list">
            {parsed.npc.weapons.map((item, index) => <ItemEditor key={`${item.id}-${index}`} item={item} onChange={(next) => updateNpc((npc) => { npc.weapons[index] = next; })} onRemove={() => updateNpc((npc) => { npc.weapons.splice(index, 1); })} />)}
            {parsed.npc.weapons.length === 0 && <p class="builder-empty">No weapons configured.</p>}
          </div>
        </article>

        <article class="builder-section">
          <header><div><span class="kicker">07</span><h3>Inventory & gear</h3></div><span>{parsed.npc.inventory.size} entries</span></header>
          <CatalogAdder label="Add carried gear" options={inventoryCatalog} fallbackType="equipment" onAdd={(item) => updateNpc((npc) => {
            const key = itemEqualityKey(item);
            const existing = npc.inventory.get(key);
            npc.inventory.set(key, { item: existing?.item ?? item, amount: (existing?.amount ?? 0) + 1 });
          })} />
          <div class="builder-item-list">
            {[...parsed.npc.inventory].map(([key, entry]) => <div key={key} class="builder-inventory-entry">
              <label class="builder-amount"><span>Amount</span><input type="number" min="0" value={entry.amount} onInput={(event: InputEvent) => updateNpc((npc) => {
                const current = npc.inventory.get(key);
                if (current) current.amount = Number(event.currentTarget.value);
              })} /></label>
              <ItemEditor item={entry.item} onChange={(nextItem) => updateNpc((npc) => {
                const current = npc.inventory.get(key);
                if (!current) return;
                npc.inventory.delete(key);
                npc.inventory.set(itemEqualityKey(nextItem), { ...current, item: nextItem });
              })} onRemove={() => updateNpc((npc) => { npc.inventory.delete(key); })} />
            </div>)}
            {parsed.npc.inventory.size === 0 && <p class="builder-empty">No carried gear or ammunition.</p>}
          </div>
        </article>

        <article class="builder-section">
          <header><div><span class="kicker">08</span><h3>Cyberware</h3></div><span>Recursive installation tree</span></header>
          <p class="builder-help">Install cyberware at the body root or inside another cyberware container. Capacity problems are reported by the normal NPC validation after Apply.</p>
          <CyberwareNodeEditor root node={parsed.npc.cyberware} catalog={catalog} onChange={(node) => updateNpc((npc) => { npc.cyberware = node; })} />
        </article>
      </>}

      <details class="builder-advanced">
        <summary>Advanced raw NPC data</summary>
        <p>Use this only for uncommon fields that do not have a dedicated control above, such as complex modifier scripts or unusual upstream item metadata. The complete NPC remains editable.</p>
        <textarea
          aria-label="Complete NPC JSON"
          spellcheck={false}
          rows={30}
          value={draftText}
          onInput={(event: TextAreaEvent) => {
            setDraftText(event.currentTarget.value);
            setApplyError(null);
          }}
        />
      </details>

      <div class="builder-bottom-actions">
        <button type="button" onClick={onCancel} disabled={busy}>Cancel</button>
        <button type="button" class="primary-action" onClick={() => void apply()} disabled={busy || !parsed.npc}>{busy ? 'Applying…' : 'Apply NPC'}</button>
      </div>
    </section>
  );
}
