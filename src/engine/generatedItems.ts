import type { ItemData } from './types';

/**
 * Items constructed by generator code rather than loaded from an upstream
 * item configuration. Keep these definitions shared with the reference
 * catalog so every generated item has canonical metadata.
 */
export const POCKET_MONEY_ITEM_DATA = {
  name: 'Eddies',
  type: 'junk',
  price: 1,
} satisfies ItemData;

export const CODE_GENERATED_ITEMS: readonly ItemData[] = [POCKET_MONEY_ITEM_DATA];
