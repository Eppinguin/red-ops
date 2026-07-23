import type { TargetedEvent } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import type { CatalogEntry } from '../content/types';
import {
  materializeRandomEncounter,
  rerollRandomEncounterSubroll,
  rollRandomEncounter,
  type EncounterPeriod,
  type RandomEncounterGroup,
  type RandomEncounterResult,
  type RandomEncounterSubroll,
  type ThreatZone,
} from '../encounter/randomEncounters';
import type { CombatantSide, EncounterCombatant, EncounterSkillValue } from '../encounter/types';

interface RandomEncounterPanelProps {
  referenceEntries: readonly CatalogEntry[];
  defaultPartySize: number;
  onAddToCurrent: (result: RandomEncounterResult, combatants: EncounterCombatant[]) => void;
  onCreatePrepared: (result: RandomEncounterResult, combatants: EncounterCombatant[]) => void;
}

type InputEvent = TargetedEvent<HTMLInputElement>;
type SelectEvent = TargetedEvent<HTMLSelectElement>;

const PERIOD_LABELS: Record<EncounterPeriod, string> = {
  daytime: 'Daytime',
  evening: 'Evening',
  midnight: 'Midnight',
};

const ZONE_LABELS: Record<ThreatZone, string> = {
  moderate: 'Moderate · full table',
  corporate: 'Corporate · 01–50 guidance',
  combat: 'Combat · 51–100 guidance',
  hot: 'Hot · 51–100 guidance',
  executive: 'Executive · surveillance only',
};

function resultBrief(result: RandomEncounterResult): string {
  const roll = result.roll ? result.roll.toString().padStart(2, '0') : '—';
  return [
    `${PERIOD_LABELS[result.period]} encounter ${roll}: ${result.title}. ${result.description}`,
    ...result.gmNotes,
  ].filter(Boolean).join('\n');
}

function signed(value: number | null): string {
  if (value === null) return '—';
  return value >= 0 ? `+${value}` : String(value);
}

const COMBAT_SKILLS = new Set([
  'Archery', 'Athletics', 'Autofire', 'Brawling', 'Evasion', 'Handgun', 'Heavy Weapons',
  'Melee Weapon', 'Melee Weapons', 'Shoulder Arms', 'Stealth',
]);
const SOCIAL_AWARENESS_SKILLS = new Set([
  'Conceal/Reveal Object', 'Concentration', 'Conversation', 'Human Perception', 'Interrogation',
  'Perception', 'Persuasion', 'Streetwise', 'Tactics', 'Tracking',
]);

function skillGroups(skills: readonly EncounterSkillValue[]): Array<{ label: string; skills: EncounterSkillValue[] }> {
  const combat: EncounterSkillValue[] = [];
  const awareness: EncounterSkillValue[] = [];
  const technical: EncounterSkillValue[] = [];
  for (const skill of [...skills].sort((a, b) => a.name.localeCompare(b.name))) {
    if (COMBAT_SKILLS.has(skill.name)) combat.push(skill);
    else if (SOCIAL_AWARENESS_SKILLS.has(skill.name)) awareness.push(skill);
    else technical.push(skill);
  }
  return [
    { label: 'Combat & movement', skills: combat },
    { label: 'Awareness & social', skills: awareness },
    { label: 'Technical & knowledge', skills: technical },
  ].filter((group) => group.skills.length > 0);
}

function GroupStatBlockPreview({ group, result, referenceEntries }: {
  group: RandomEncounterGroup;
  result: RandomEncounterResult;
  referenceEntries: readonly CatalogEntry[];
}) {
  const preview = useMemo(
    () => materializeRandomEncounter({ ...result, groups: [{ ...group, count: 1 }] }, referenceEntries),
    [group, result, referenceEntries],
  );
  const combatant = preview.combatants[0];

  if (!combatant) {
    const needsLoadout = Boolean(group.loadoutOptions?.length && !group.selectedLoadoutId);
    return (
      <div class={`random-statblock-missing ${needsLoadout ? 'choice-required' : ''}`} role="status">
        <strong>{needsLoadout ? 'Choose a weapon package' : 'Official stat block required'}</strong>
        <span>{needsLoadout
          ? 'The source lists several valid turret configurations. Select one above; the app will not choose for you.'
          : preview.unavailable[0] ?? group.missingStatBlock?.source ?? 'Not supplied.'}</span>
      </div>
    );
  }

  const block = combatant.statBlock;
  if (!block) return null;
  const groupedSkills = skillGroups(block.skills);

  return (
    <div class="random-statblock-preview">
      <div class="random-statblock-vitals" aria-label={`${combatant.name} combat summary`}>
        {block.combatNumber !== undefined && <span class="combat-number"><small>Combat number</small><strong>{block.combatNumber}</strong></span>}
        <span><small>HP</small><strong>{combatant.maxHp ?? '—'}</strong></span>
        <span><small>Seriously wounded</small><strong>{combatant.seriouslyWoundedAt ?? '—'}</strong></span>
        <span><small>Death save</small><strong>{combatant.deathSaveBase ?? '—'}</strong></span>
        <span><small>Armor</small><strong>B {combatant.armor.body.max} · H {combatant.armor.head.max}</strong></span>
      </div>

      {combatant.attacks.length > 0 ? (
        <section class="random-preview-section">
          <h5>Attacks</h5>
          <div class="random-attack-preview">
            {combatant.attacks.map((attack) => (
              <article key={attack.id}>
                <div class="random-attack-heading">
                  <strong>{attack.name}</strong>
                  <span>{attack.skill} {signed(attack.base)}</span>
                </div>
                <dl>
                  <div><dt>Damage</dt><dd>{attack.damage ?? 'Not supplied'}</dd></div>
                  <div><dt>ROF</dt><dd>{attack.rateOfFire ?? '—'}</dd></div>
                  {attack.autofireBase !== null && <div><dt>Autofire</dt><dd>{signed(attack.autofireBase)}</dd></div>}
                  {attack.ammo.max !== null && <div><dt>Magazine</dt><dd>{attack.ammo.max}</dd></div>}
                </dl>
                {attack.notes && <p>{attack.notes}</p>}
              </article>
            ))}
          </div>
        </section>
      ) : (
        <div class="random-no-attacks">No attack profile is listed for this role.</div>
      )}

      {block.stats.length > 0 ? (
        <section class="random-preview-section">
          <h5>Stats</h5>
          <div class="random-stat-grid">
            {block.stats.map((stat) => (
              <span key={stat.name}>
                <small>{stat.name}</small>
                <strong>{stat.base === stat.effective ? stat.base : `${stat.base} (${stat.effective})`}</strong>
              </span>
            ))}
          </div>
        </section>
      ) : block.combatNumber !== undefined ? (
        <div class="random-combat-number-note">
          <strong>Simplified official block</strong>
          <span>This role uses Combat Number {block.combatNumber}. No complete STAT line was supplied, so initiative and unlisted checks remain manual.</span>
        </div>
      ) : null}

      <details class="random-full-statblock">
        <summary>
          <span><strong>Full stat block</strong><small>All checks, loadout, rules, and source</small></span>
          <b aria-hidden="true">Open</b>
        </summary>
        <div class="random-details-content">
          <div class="random-statblock-sheet">
            <div class="random-skill-groups">
              {groupedSkills.map((skillGroup) => (
                <section class="random-skill-section" key={skillGroup.label}>
                  <header><h5>{skillGroup.label}</h5><span>{skillGroup.skills.length}</span></header>
                  <div class="random-skill-list">
                    {skillGroup.skills.map((skill) => (
                      <div class="random-skill-row" key={skill.name}>
                        <span>{skill.name}</span>
                        <strong>{signed(skill.effective)}</strong>
                      </div>
                    ))}
                  </div>
                </section>
              ))}
            </div>

            <aside class="random-loadout-sheet">
              {block.gear.length > 0 && <section><header><h5>Gear</h5><span>{block.gear.length}</span></header><ul>{block.gear.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul></section>}
              {block.cyberware.length > 0 && <section><header><h5>Cyberware</h5><span>{block.cyberware.length}</span></header><ul>{block.cyberware.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul></section>}
              {block.programs.length > 0 && <section><header><h5>Programs</h5><span>{block.programs.length}</span></header><ul>{block.programs.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul></section>}
              {block.gear.length === 0 && block.cyberware.length === 0 && block.programs.length === 0 && <section class="random-empty-loadout"><h5>Loadout</h5><p>No additional equipment listed.</p></section>}
            </aside>
          </div>

          {(block.modifications.length > 0 || block.specialRules.length > 0 || block.sourceWarnings.length > 0) && <div class="random-rule-notes">
            {block.modifications.length > 0 && <section><h5>Encounter changes</h5><p>{block.modifications.join(' ')}</p></section>}
            {block.specialRules.length > 0 && <section><h5>Special rules</h5><p>{block.specialRules.join(' ')}</p></section>}
            {block.sourceWarnings.length > 0 && <section class="warning-text"><h5>Source note</h5><p>{block.sourceWarnings.join(' ')}</p></section>}
          </div>}
          <footer class="random-source-line"><span>Source</span><strong>{block.source.label}, p. {block.source.page}</strong></footer>
        </div>
      </details>
    </div>
  );
}

function LoadoutControl({ group, onChange }: { group: RandomEncounterGroup; onChange: (loadoutId: string) => void }) {
  if (!group.loadoutOptions?.length) return null;
  const selected = group.loadoutOptions.find((option) => option.id === group.selectedLoadoutId);
  return (
    <label class="random-loadout-control">
      <span>Weapon package <strong>required</strong></span>
      <select value={group.selectedLoadoutId ?? ''} onChange={(event: SelectEvent) => onChange(event.currentTarget.value)}>
        <option value="">Choose from the official list…</option>
        {group.loadoutOptions.map((option) => <option key={option.id} value={option.id}>{option.label} · {option.description}</option>)}
      </select>
      {selected && <small>{selected.description}</small>}
    </label>
  );
}

function SubrollControl({ subroll, onReroll }: { subroll: RandomEncounterSubroll; onReroll: () => void }) {
  const notation = subroll.modifier === 0
    ? subroll.die
    : `${subroll.die} ${subroll.modifier > 0 ? '+' : '−'} ${Math.abs(subroll.modifier)}`;
  return (
    <button type="button" class="random-subroll-control" onClick={onReroll} title={`Reroll only ${subroll.label}; the main percentile result and every other secondary roll remain unchanged`}>
      <span class="random-subroll-label">{subroll.label}</span>
      <strong>{notation}: {subroll.modifier === 0 ? subroll.roll : `${subroll.roll} → ${subroll.total}`}</strong>
      <em>{subroll.outcome || 'Resolved secondary result'}</em>
      <b>Reroll only this</b>
    </button>
  );
}

function CountControl({ group, onChange }: { group: RandomEncounterGroup; onChange: (count: number) => void }) {
  return (
    <div class="random-count-control" aria-label={`${group.label} count`}>
      <span>Count</span>
      <div>
        <button type="button" aria-label={`Remove one ${group.label}`} disabled={group.count <= 0} onClick={() => onChange(group.count - 1)}>−</button>
        <input type="number" min="0" max="50" value={group.count} aria-label={`${group.label} count`} onInput={(event: InputEvent) => onChange(Number(event.currentTarget.value))} />
        <button type="button" aria-label={`Add one ${group.label}`} disabled={group.count >= 50} onClick={() => onChange(group.count + 1)}>+</button>
      </div>
    </div>
  );
}

export function RandomEncounterPanel({ referenceEntries, defaultPartySize, onAddToCurrent, onCreatePrepared }: RandomEncounterPanelProps) {
  const [partySize, setPartySize] = useState(Math.max(1, defaultPartySize || 4));
  const [period, setPeriod] = useState<EncounterPeriod>('daytime');
  const [zone, setZone] = useState<ThreatZone>('moderate');
  const [regionalGuidance, setRegionalGuidance] = useState(true);
  const [result, setResult] = useState<RandomEncounterResult | null>(null);

  const materialized = useMemo(() => result ? materializeRandomEncounter(result, referenceEntries) : null, [result, referenceEntries]);
  const blocked = Boolean(materialized?.unavailable.length);
  const warnings = result && materialized
    ? [...new Set([...(result.warnings ?? []), ...(materialized.warnings ?? [])])]
    : [];

  const roll = () => setResult(rollRandomEncounter({ period, zone, partySize, regionalGuidance }));
  const setGroupCount = (groupId: string, count: number) => setResult((current) => current ? {
    ...current,
    groups: current.groups.map((group) => group.id === groupId ? { ...group, count: Math.max(0, Math.min(50, Math.trunc(count) || 0)) } : group),
  } : current);
  const setGroupLoadout = (groupId: string, selectedLoadoutId: string) => setResult((current) => current ? {
    ...current,
    groups: current.groups.map((group) => group.id === groupId ? { ...group, selectedLoadoutId: selectedLoadoutId || undefined } : group),
  } : current);
  const setGroupSide = (groupId: string, side: CombatantSide) => setResult((current) => current ? {
    ...current,
    groups: current.groups.map((group) => group.id === groupId ? { ...group, side } : group),
  } : current);
  const rerollSubroll = (subrollId: string) => setResult((current) => current
    ? rerollRandomEncounterSubroll(current, subrollId)
    : current);

  return (
    <section class="random-encounter-builder">
      <div class="random-encounter-controls">
        <label>
          <span>Crew size</span>
          <input aria-label="Crew size" type="number" min="1" max="20" value={partySize} onInput={(event: InputEvent) => setPartySize(Math.max(1, Number(event.currentTarget.value) || 1))} />
        </label>
        <label>
          <span>Time of day</span>
          <select value={period} onChange={(event: SelectEvent) => setPeriod(event.currentTarget.value as EncounterPeriod)}>
            {Object.entries(PERIOD_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label class="random-zone-field">
          <span>Threat zone</span>
          <select value={zone} onChange={(event: SelectEvent) => setZone(event.currentTarget.value as ThreatZone)}>
            {Object.entries(ZONE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        {zone !== 'moderate' && zone !== 'executive' && (
          <label class="random-guidance-toggle" title="The source presents these regional bands as guidance, not a mandatory replacement table.">
            <input type="checkbox" checked={regionalGuidance} onChange={(event: InputEvent) => setRegionalGuidance(event.currentTarget.checked)} />
            <span>Use regional percentile guidance</span>
          </label>
        )}
        <button type="button" class="primary-action random-roll-action" onClick={roll}>{result ? 'Roll again' : 'Roll encounter'}</button>
      </div>

      {!result && (
        <div class="random-empty-state">
          <strong>Ready to roll</strong>
          <span>The result remains a preview until you explicitly add or prepare it.</span>
        </div>
      )}

      {result && (
        <div class="random-encounter-result">
          <section class="random-result-hero">
            <div class="random-roll-badge">
              <strong>{result.roll ? result.roll.toString().padStart(2, '0') : '—'}</strong>
              <span>{result.roll ? `${result.dice[0]} / ${result.dice[1]}` : 'No street roll'}</span>
            </div>
            <div class="random-result-copy">
              <div class="section-title-row">
                <div>
                  <span class="kicker">{PERIOD_LABELS[result.period]} · {ZONE_LABELS[result.zone]}</span>
                  <h3>{result.title}</h3>
                </div>
                <button type="button" onClick={roll}>Reroll</button>
              </div>
              <p>{result.description}</p>
              {result.gmNotes.length > 0 && (
                <div class="random-gm-notes">
                  <strong>GM cues</strong>
                  <ul>{result.gmNotes.map((note, index) => <li key={`${note}-${index}`}>{note}</li>)}</ul>
                </div>
              )}
            </div>
          </section>

          {result.subrolls.length > 0 && (
            <section class="random-subroll-panel" aria-label="Secondary encounter rolls">
              <header>
                <div>
                  <span class="kicker">Secondary rolls</span>
                  <h4>Reroll any resolved detail</h4>
                </div>
                <p>The street percentile and every other result stay fixed.</p>
              </header>
              <div class="random-subroll-grid">
                {result.subrolls.map((subroll) => (
                  <SubrollControl key={subroll.id} subroll={subroll} onReroll={() => rerollSubroll(subroll.id)} />
                ))}
              </div>
            </section>
          )}

          {result.groups.length > 0 ? (
            <div class="random-groups">
              {result.groups.map((group) => (
                <article class={`random-group-card ${group.side}`} key={group.id}>
                  <header>
                    <div>
                      <div class="random-group-badges">
                        {group.teamLabel && <span class="random-team-badge">{group.teamLabel}</span>}
                        <label class={`random-side-control ${group.side}`}>
                          <span class="sr-only">Disposition for {group.label}</span>
                          <select value={group.side} onChange={(event: SelectEvent) => setGroupSide(group.id, event.currentTarget.value as CombatantSide)}>
                            <option value="enemy">Enemy</option>
                            <option value="neutral">Neutral</option>
                            <option value="ally">Ally</option>
                            <option value="player">Player</option>
                          </select>
                        </label>
                      </div>
                      <h4>{group.label}</h4>
                      <p>{group.templateId ? group.templateId.replaceAll('-', ' ') : group.missingStatBlock?.name ?? 'Narrative only'}</p>
                    </div>
                    <div class="random-group-actions">
                      <CountControl group={group} onChange={(count) => setGroupCount(group.id, count)} />
                    </div>
                  </header>
                  {group.notes && <p class="random-group-note">{group.notes}</p>}
                  <LoadoutControl group={group} onChange={(loadoutId) => setGroupLoadout(group.id, loadoutId)} />
                  {/* A roll answers "who and how many" first; the full block is
                      one click away rather than several screens of scrolling. */}
                  <details class="random-group-preview-toggle" open={Boolean(group.loadoutOptions?.length && !group.selectedLoadoutId)}>
                    <summary><span>Stat block</span><b aria-hidden="true">Preview</b></summary>
                    <GroupStatBlockPreview group={group} result={result} referenceEntries={referenceEntries} />
                  </details>
                </article>
              ))}
            </div>
          ) : (
            <div class="random-no-combatants"><strong>No automatic combatants</strong><span>This result is scene pressure rather than a street-fight roster.</span></div>
          )}

          {warnings.length > 0 && <div class="random-warning-list">{warnings.map((warning) => <span key={warning}>{warning}</span>)}</div>}
          {Boolean(materialized?.unavailable.length) && (
            <div class="random-missing-list">
              <strong>Cannot create the complete encounter yet</strong>
              {materialized?.unavailable.map((entry) => <span key={entry}>{entry}</span>)}
              <small>No substitute or invented stat block has been used.</small>
            </div>
          )}

          <footer class="random-result-actions">
            <div class="random-roster-total"><strong>{materialized?.combatants.length ?? 0}</strong><span>initiative-ready combatants</span></div>
            <button type="button" disabled={blocked || !materialized} onClick={() => materialized && onAddToCurrent(result, materialized.combatants)}>Add to current</button>
            <button type="button" class="primary-action" disabled={blocked || !materialized} onClick={() => materialized && onCreatePrepared(result, materialized.combatants)}>Create prepared encounter</button>
          </footer>
        </div>
      )}
    </section>
  );
}

export { resultBrief as randomEncounterBrief };
