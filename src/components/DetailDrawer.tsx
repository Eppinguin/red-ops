import type { TargetedEvent } from 'preact';
import type { CatalogEntry, MechanicsSummary } from '../content/types';
import { GlossaryTerm } from './GlossaryTerm';
import { useScrollLock } from './useScrollLock';

export interface SelectedReference {
  entry: CatalogEntry;
  reason?: string;
}

function pretty(value: string): string {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function Mechanics({ mechanics }: { mechanics: MechanicsSummary }) {
  if (mechanics.kind === 'weapon') {
    return <dl class="drawer-facts">
      <dt>Damage</dt><dd>{mechanics.damage ?? '—'}</dd>
      <dt><GlossaryTerm id="ROF" /></dt><dd>{mechanics.rateOfFire ?? '—'}</dd>
      <dt>Magazine</dt><dd>{mechanics.magazine ?? '—'}</dd>
      <dt>Skill</dt><dd>{mechanics.skill ?? '—'}</dd>
      <dt>Ammo</dt><dd>{mechanics.ammoTypes.join(', ') || 'None'}</dd>
      <dt><GlossaryTerm id="Quality" /></dt><dd>{mechanics.quality ? pretty(mechanics.quality) : 'Standard / unspecified'}</dd>
      <dt>Hands</dt><dd>{mechanics.hands ?? '—'}</dd>
      <dt>Concealability</dt><dd>{mechanics.concealability ?? '—'}</dd>
    </dl>;
  }
  if (mechanics.kind === 'armor') {
    return <dl class="drawer-facts">
      <dt><GlossaryTerm id="SP" /></dt><dd>{mechanics.stoppingPower ?? '—'}</dd>
      <dt>Penalty</dt><dd>{mechanics.penalty ?? 'None listed'}</dd>
      <dt>Locations</dt><dd>{mechanics.locations.map(pretty).join(', ') || 'Item-specific'}</dd>
    </dl>;
  }
  if (mechanics.kind === 'cyberware') {
    return <>
      <dl class="drawer-facts">
        <dt><GlossaryTerm id="Humanity" /></dt><dd>{mechanics.humanityLoss ?? '—'}</dd>
        <dt><GlossaryTerm id="Foundational" /></dt><dd>{mechanics.foundational ? 'Yes' : 'No / unspecified'}</dd>
        <dt>Capacity</dt><dd>{mechanics.installation.capacity ?? '—'}</dd>
        <dt>Option size</dt><dd>{mechanics.installation.size ?? '—'}</dd>
        <dt>Install in</dt><dd>{mechanics.installation.requiredContainers.join(', ') || '—'}</dd>
      </dl>
      {mechanics.weapon && <div class="drawer-subsection"><h4>Integrated weapon</h4><Mechanics mechanics={mechanics.weapon} /></div>}
    </>;
  }
  if (mechanics.kind === 'skill') {
    return <dl class="drawer-facts">
      <dt>Linked stat</dt><dd>{mechanics.linkedStat ?? '—'}</dd>
      <dt>Category</dt><dd>{mechanics.skillType ? pretty(mechanics.skillType) : '—'}</dd>
      <dt>Multiplier</dt><dd>{mechanics.multiplier ?? 1}</dd>
    </dl>;
  }
  return <dl class="drawer-facts">
    <dt>Brand</dt><dd>{mechanics.brand ?? '—'}</dd>
    <dt><GlossaryTerm id="Electronic" /></dt><dd>{mechanics.electronic === undefined ? 'Not specified' : mechanics.electronic ? 'Yes' : 'No'}</dd>
    <dt>Quantity</dt><dd>{mechanics.quantity ?? '—'}</dd>
    <dt>Capacity</dt><dd>{mechanics.installation?.capacity ?? '—'}</dd>
  </dl>;
}

export function DetailDrawer({ selected, onClose }: { selected: SelectedReference | null; onClose: () => void }) {
  // Called before the early return so the hook order stays stable across renders.
  useScrollLock(selected !== null);
  if (!selected) return null;
  const { entry, reason } = selected;
  return (
    <div class="drawer-backdrop" role="presentation" onClick={onClose}>
      <aside class="detail-drawer" role="dialog" aria-modal="true" aria-labelledby="detail-title" onClick={(event: TargetedEvent<HTMLElement, MouseEvent>) => event.stopPropagation()}>
        <header>
          <div>
            <span class="kicker">{pretty(entry.type)}</span>
            <h2 id="detail-title">{entry.name}</h2>
          </div>
          <button type="button" class="drawer-close" onClick={onClose} aria-label="Close details">×</button>
        </header>
        <div class="drawer-body">
          <p class="drawer-summary">{entry.summary}</p>
          {entry.usage && <section><h3>Usage</h3><p>{entry.usage}</p></section>}
          {reason && <section class="selection-reason"><h3>Why this NPC has it</h3><p>{reason}</p></section>}
          <section><h3>Mechanics</h3><Mechanics mechanics={entry.mechanics} /></section>
          {entry.price && <section><h3>Price</h3><p>{entry.price.amount !== undefined ? `${entry.price.amount}eb` : 'Amount not listed'}{entry.price.category ? ` · ${pretty(entry.price.category)}` : ''}</p></section>}
          {entry.tags.length > 0 && <section><h3>Tags</h3><div class="tags">{entry.tags.map((tag) => <span key={tag}>{tag}</span>)}</div></section>}
          <section><h3>Source</h3>
            <p>{entry.source?.book ?? 'No book reference available'}{entry.source?.page ? `, p. ${entry.source.page}` : ''}</p>
          </section>
          <p class="content-boundary">Check the cited rulebook for the complete rules.</p>
        </div>
      </aside>
    </div>
  );
}
