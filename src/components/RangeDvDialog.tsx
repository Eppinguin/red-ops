import type { TargetedEvent } from 'preact';
import {
  AUTOFIRE_CORE_DVS,
  AUTOFIRE_EDGERUNNERS_DVS,
  RANGE_BANDS,
  SINGLE_SHOT_DVS,
  THROWN_WEAPON_DVS,
} from '../encounter/rangeDvs';
import { useScrollLock } from './useScrollLock';

type MouseDivEvent = TargetedEvent<HTMLDivElement, MouseEvent>;

function DvTable({
  title,
  rows,
  bands = RANGE_BANDS,
}: {
  title: string;
  rows: readonly { label: string; values: Partial<Record<string, number>> }[];
  bands?: readonly { id: string; label: string }[];
}) {
  return (
    <section class="range-reference-section">
      <h3>{title}</h3>
      <div class="range-table-scroll">
        <table class="range-dv-table">
          <thead><tr><th scope="col">Weapon type</th>{bands.map((band) => <th key={band.id} scope="col">{band.label}</th>)}</tr></thead>
          <tbody>{rows.map((row) => <tr key={row.label}><th scope="row">{row.label}</th>{bands.map((band) => {
            const dv = row.values[band.id];
            // A band the weapon cannot reach is a rules fact, not missing data;
            // dimming it keeps the eye on the DVs that can actually be rolled.
            return dv === undefined
              ? <td key={band.id} class="dv-out-of-range" title={`${row.label} cannot reach ${band.label}`}>—</td>
              : <td key={band.id}>{dv}</td>;
          })}</tr>)}</tbody>
        </table>
      </div>
    </section>
  );
}

export function RangeDvDialog({ onClose }: { onClose: () => void }) {
  useScrollLock(true);
  const autofireBands = RANGE_BANDS.slice(0, 5);
  return (
    <div class="encounter-modal-backdrop" onMouseDown={(event: MouseDivEvent) => event.currentTarget === event.target && onClose()}>
      <section class="range-reference-dialog panel" role="dialog" aria-modal="true" aria-labelledby="range-reference-title">
        <header>
          <div>
            <span class="kicker">Quick rules</span>
            <h2 id="range-reference-title">Range DV reference</h2>
            <p>Ranged attack total must beat the listed DV. A defender with REF 8+ may choose to dodge instead when their Evasion base is available.</p>
          </div>
          <button type="button" class="icon-button" onClick={onClose} aria-label="Close range DV reference">×</button>
        </header>
        <div class="range-reference-scroll">
          <DvTable title="Single-shot DVs" rows={SINGLE_SHOT_DVS} />
          <div class="range-reference-two-column">
            <DvTable title="Autofire DVs — Core" rows={AUTOFIRE_CORE_DVS} bands={autofireBands} />
            <DvTable title="Autofire DVs — Edgerunners" rows={AUTOFIRE_EDGERUNNERS_DVS} bands={autofireBands} />
          </div>
          <section class="range-reference-section thrown-reference">
            <h3>Thrown weapons</h3>
            <p>Resolve with Athletics. Thrown weapons cannot be thrown farther than 25 m.</p>
            <div class="range-table-scroll">
              <table class="range-dv-table"><thead><tr><th scope="col">Range</th><th scope="col">DV</th></tr></thead><tbody>{THROWN_WEAPON_DVS.map((row) => <tr key={row.label}><th scope="row">{row.label}</th><td>{row.dv}</td></tr>)}</tbody></table>
            </div>
          </section>
          <section class="range-dodge-rule">
            <strong>Optional ranged dodge</strong>
            <span>Defender’s DEX + Evasion Skill + RED d10. Only a defender with REF 8 or higher may choose this instead of the range-table DV. Ties still fail because the attacker must beat the defense.</span>
          </section>
        </div>
      </section>
    </div>
  );
}
