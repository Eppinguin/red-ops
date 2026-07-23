import type { TargetedEvent } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import {
  attackPenalty,
  canDodgeRanged,
  effectiveEvasionBase,
} from '../encounter/model';
import {
  defaultRangeBand,
  rangeDv,
  rangeProfileLabel,
  validRangeBands,
  type RangeBandId,
} from '../encounter/rangeDvs';
import type {
  EncounterAction,
  EncounterAttack,
  EncounterCombatant,
  RangedDefenseMode,
} from '../encounter/types';

type SelectEvent = TargetedEvent<HTMLSelectElement>;
type MouseDivEvent = TargetedEvent<HTMLDivElement, MouseEvent>;

function preferredTargets(attacker: EncounterCombatant, combatants: readonly EncounterCombatant[]): EncounterCombatant[] {
  const others = combatants.filter((combatant) => combatant.id !== attacker.id);
  const preferred = (combatant: EncounterCombatant) => attacker.side === 'enemy'
    ? combatant.side === 'player' || combatant.side === 'ally'
    : combatant.side === 'enemy';
  return [...others].sort((left, right) => Number(preferred(right)) - Number(preferred(left)) || left.name.localeCompare(right.name));
}

export function AttackResolverDialog({
  attacker,
  attack,
  combatants,
  dispatch,
  onClose,
  onOpenRangeReference,
}: {
  attacker: EncounterCombatant;
  attack: EncounterAttack;
  combatants: readonly EncounterCombatant[];
  dispatch: (action: EncounterAction) => void;
  onClose: () => void;
  onOpenRangeReference: () => void;
}) {
  const targets = useMemo(() => preferredTargets(attacker, combatants), [attacker, combatants]);
  const bands = useMemo(() => validRangeBands(attack.rangeProfile), [attack.rangeProfile]);
  const [targetId, setTargetId] = useState(targets[0]?.id ?? '');
  const [rangeBand, setRangeBand] = useState<RangeBandId | null>(attack.selectedRangeBand ?? defaultRangeBand(attack.rangeProfile));
  const [defenseMode, setDefenseMode] = useState<RangedDefenseMode>('range-dv');
  const target = targets.find((candidate) => candidate.id === targetId) ?? null;
  const dodgeEligible = target ? canDodgeRanged(target) : false;
  const dodgeBase = target ? effectiveEvasionBase(target) : null;
  const tableDv = rangeDv(attack.rangeProfile, rangeBand);
  const effectiveAttackBase = attack.base === null ? null : attack.base - attackPenalty(attacker, attack);
  const empty = attack.ammo.current === 0;

  useEffect(() => {
    if (defenseMode === 'dodge' && !dodgeEligible) setDefenseMode('range-dv');
  }, [defenseMode, dodgeEligible]);

  const canResolve = !empty
    && effectiveAttackBase !== null
    && (defenseMode === 'dodge' ? dodgeEligible : tableDv !== null);

  return (
    <div class="encounter-modal-backdrop" onMouseDown={(event: MouseDivEvent) => event.currentTarget === event.target && onClose()}>
      <section class="attack-resolver-dialog panel" role="dialog" aria-modal="true" aria-labelledby="attack-resolver-title">
        <header>
          <div>
            <span class="kicker">Resolve ranged attack</span>
            <h2 id="attack-resolver-title">{attacker.name} · {attack.name}</h2>
            <p>{attack.skill} {effectiveAttackBase === null ? 'unmapped' : `${effectiveAttackBase >= 0 ? '+' : ''}${effectiveAttackBase}`} · ROF {attack.rateOfFire ?? '—'} · Damage {attack.damage ?? '—'}</p>
          </div>
          <button type="button" class="icon-button" onClick={onClose} aria-label="Close attack resolver">×</button>
        </header>

        <div class="attack-resolver-body">
          <div class="attack-resolver-fields">
            <label><span>Target</span><select value={targetId} onChange={(event: SelectEvent) => setTargetId(event.currentTarget.value)}><option value="">No named target</option>{targets.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}</select></label>
            <label><span>Range</span><select disabled={!bands.length} value={rangeBand ?? ''} onChange={(event: SelectEvent) => setRangeBand(event.currentTarget.value as RangeBandId)}>{bands.length ? bands.map((band) => <option key={band.id} value={band.id}>{band.label} · DV {band.dv}</option>) : <option value="">No mapped range profile</option>}</select></label>
          </div>

          <div class="attack-resolver-summary">
            <div><span>Attack base</span><strong>{effectiveAttackBase === null ? '—' : `${effectiveAttackBase >= 0 ? '+' : ''}${effectiveAttackBase}`}</strong></div>
            <div><span>Range profile</span><strong>{attack.rangeProfile ? rangeProfileLabel(attack.rangeProfile) : 'Unmapped'}</strong></div>
            <div><span>Table DV</span><strong>{tableDv ?? '—'}</strong></div>
            <div><span>Ammo</span><strong>{attack.ammo.current ?? '—'}{attack.ammo.max !== null ? `/${attack.ammo.max}` : ''}</strong></div>
          </div>

          <fieldset class="defense-choice">
            <legend>Defender chooses</legend>
            <button type="button" class={defenseMode === 'range-dv' ? 'active' : ''} onClick={() => setDefenseMode('range-dv')}>
              <strong>Range table</strong><span>{tableDv === null ? 'No DV at this range' : `Static DV ${tableDv}`}</span>
            </button>
            <button type="button" class={defenseMode === 'dodge' ? 'active' : ''} disabled={!dodgeEligible} onClick={() => setDefenseMode('dodge')}>
              <strong>Dodge ranged</strong><span>{target === null ? 'Choose a target' : dodgeEligible ? `Evasion ${dodgeBase! >= 0 ? '+' : ''}${dodgeBase} + RED d10` : target.reflex !== null && target.reflex < 8 ? `REF ${target.reflex}: requires REF 8+` : 'REF and Evasion base not recorded'}</span>
            </button>
          </fieldset>

          {!attack.rangeProfile && <div class="resolver-warning"><strong>Range profile not mapped.</strong><span>Use the full range reference and resolve the attack manually.</span><button type="button" onClick={onOpenRangeReference}>Open Range DVs</button></div>}
          {empty && <div class="resolver-warning danger"><strong>Weapon empty.</strong><span>Reload before resolving this attack.</span></div>}
          <p class="resolver-rule">Both checks use the RED critical d10: a natural 10 adds one extra d10; a natural 1 subtracts one extra d10. The attacker must beat the selected defense.</p>
        </div>

        <footer>
          <button type="button" onClick={onOpenRangeReference}>Full Range DVs</button>
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="button" class="primary-action" disabled={!canResolve} onClick={() => {
            dispatch({
              type: 'resolve-ranged-attack',
              combatantId: attacker.id,
              attackId: attack.id,
              targetId: target?.id ?? null,
              defenseMode,
              rangeBand,
            });
            onClose();
          }}>Roll and resolve</button>
        </footer>
      </section>
    </div>
  );
}
