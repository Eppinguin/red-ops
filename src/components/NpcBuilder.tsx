import type { TargetedEvent } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import type { CatalogEntry } from '../content/types';
import { PYTHON_FAKER_LOCALES } from '../engine/catalog';
import { rebuildManualNpcView } from '../engine/builder';
import type { Catalog, GeneratedNpcView, InventoryEntry, Item, Npc, Skill, StatName } from '../engine/types';
import { STAT_NAMES } from '../engine/types';

type InputEvent = TargetedEvent<HTMLInputElement>;
type SelectEvent = TargetedEvent<HTMLSelectElement>;
type TextAreaEvent = TargetedEvent<HTMLTextAreaElement>;

interface PortableNpc extends Omit<Npc, 'stats' | 'skills' | 'inventory'> {
  stats: Record<string, number>;
  skills: Record<string, { skill: Skill; level: number }>;
  inventory: Array<{ key: string; item: Item; amount: number }>;
}

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
    } catch (error) {
      setApplyError(error instanceof Error ? error.message : String(error));
      setBusy(false);
    }
  };

  return (
    <section class="tab-content refine-layout">
      <header class="refine-header">
        <div>
          <span class="kicker">Manual construction</span>
          <h2>NPC builder</h2>
          <p>Edit the complete NPC manually. Identity, stats and skills have direct controls; the advanced data editor exposes lifepath, weapons, armor, cyberware, inventory and every item field.</p>
        </div>
        <div>
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
        <article class="card">
          <header><h3>Identity & role</h3><span>fully manual</span></header>
          <div class="field-grid">
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
            <label class="wide"><span>Nationality / locale</span><input list="npc-builder-nationalities" value={parsed.npc.nationality ?? ''} onInput={(event: InputEvent) => updateNpc((npc) => { npc.nationality = event.currentTarget.value || null; })} /></label>
            <label class="wide"><span>Trauma Team</span><select value={parsed.npc.traumaTeamStatus} onChange={(event: SelectEvent) => updateNpc((npc) => { npc.traumaTeamStatus = event.currentTarget.value as Npc['traumaTeamStatus']; })}>
              <option value="NONE">None</option><option value="SILVER">Silver</option><option value="EXECUTIVE">Executive</option>
            </select></label>
          </div>
          <datalist id="npc-builder-nationalities">{PYTHON_FAKER_LOCALES.map((locale) => <option key={locale} value={locale} />)}</datalist>
          <label style={{ display: 'grid', gap: '0.45rem', marginTop: '1rem' }}><span>Description</span><textarea rows={5} value={parsed.npc.description} onInput={(event: TextAreaEvent) => updateNpc((npc) => { npc.description = event.currentTarget.value; })} /></label>
        </article>

        <article class="card wide">
          <header><h3>Base stats</h3><span>1–10 recommended</span></header>
          <div class="stats-grid">
            {STAT_NAMES.map((stat) => <label key={stat} class="stat"><span>{stat}</span><input type="number" value={parsed.npc!.stats.get(stat) ?? 0} onInput={(event: InputEvent) => updateNpc((npc) => { npc.stats.set(stat, Number(event.currentTarget.value)); })} /></label>)}
          </div>
        </article>

        <article class="card wide">
          <header><h3>Skills</h3><span>{parsed.npc.skills.size} editable skills</span></header>
          <div class="skill-tools"><input type="search" placeholder="Filter skills" value={skillSearch} onInput={(event: InputEvent) => setSkillSearch(event.currentTarget.value)} /></div>
          <div class="edit-grid">
            <article class="inline-editor"><div>
              {visibleSkills.map(([name, entry]) => <div key={name}>
                <span>{name}<small>{entry.skill.link} · {pretty(entry.skill.type)}</small></span>
                <input type="number" min="0" max="10" value={entry.level} onInput={(event: InputEvent) => updateNpc((npc) => {
                  const skill = npc.skills.get(name);
                  if (skill) skill.level = Number(event.currentTarget.value);
                })} />
              </div>)}
            </div></article>
          </div>
        </article>
      </>}

      <article class="card wide">
        <header><h3>Advanced NPC data</h3><span>complete editable model</span></header>
        <p>Edit this JSON to add, remove, or change lifepath data, cyberware trees, armor, weapons, inventory entries, item modifiers, tags, prices, damage values, magazine sizes, and any other NPC field. Stats, skills and inventory are shown in JSON-friendly object/array form and are converted back to Maps when applied. Rank and role are controlled by the selectors above.</p>
        <textarea
          aria-label="Complete NPC JSON"
          spellcheck={false}
          rows={30}
          value={draftText}
          onInput={(event: TextAreaEvent) => {
            setDraftText(event.currentTarget.value);
            setApplyError(null);
          }}
          style={{ width: '100%', fontFamily: 'var(--font-mono, monospace)', fontSize: '0.78rem', lineHeight: '1.45', resize: 'vertical' }}
        />
      </article>

      <div class="hero-actions">
        <button type="button" onClick={onCancel} disabled={busy}>Cancel</button>
        <button type="button" class="primary-action" onClick={() => void apply()} disabled={busy || !parsed.npc}>{busy ? 'Applying…' : 'Apply NPC'}</button>
      </div>
    </section>
  );
}
