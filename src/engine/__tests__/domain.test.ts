import { describe, expect, it } from 'vitest';
import { cloneItem, createItem, itemEqualityKey, resetItemSequence } from '../domain';

describe('upstream item compatibility', () => {
  it('preserves the shared dataclass defaults used by non-cloned items', () => {
    resetItemSequence();
    const first = createItem({ name: 'Agent', type: 'equipment', price: 100 });
    const second = createItem({ name: 'Agent', type: 'equipment', price: 100 });

    expect(first.id).toBe(second.id);
    expect(first.creationTime).toBe(second.creationTime);
    expect(itemEqualityKey(first)).toBe(itemEqualityKey(second));
  });

  it('assigns monotonically ordered identities to clones', () => {
    resetItemSequence();
    const template = createItem({ name: 'Cyberarm', type: 'cyberware' });
    const first = cloneItem(template);
    const second = cloneItem(template);

    expect(first.id).not.toBe(second.id);
    expect(second.creationTime).toBeGreaterThan(first.creationTime);
  });
});
