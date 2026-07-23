import type { ComponentChildren } from 'preact';
import { GLOSSARY } from '../content/glossary';

export function GlossaryTerm({ id, children }: { id: keyof typeof GLOSSARY; children?: ComponentChildren }) {
  const entry = GLOSSARY[id]!;
  return (
    <span class="glossary-term" tabIndex={0} data-tooltip={entry.definition} aria-label={`${entry.term}: ${entry.definition}`}>
      {children ?? entry.term}
    </span>
  );
}
