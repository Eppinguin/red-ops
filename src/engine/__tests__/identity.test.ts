import { allFakers } from '@faker-js/faker';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateIdentity } from '../identity';
import type { Npc, Rank } from '../types';
import type { NumpyRandom } from '../random';

afterEach(() => vi.restoreAllMocks());

describe('generateIdentity', () => {
  it('falls back instead of exposing transliteration placeholders as a name', () => {
    vi.spyOn(allFakers.zh_CN.person, 'firstName').mockReturnValue('_');
    vi.spyOn(allFakers.zh_CN.person, 'lastName').mockReturnValue('_');
    const npc = {} as Npc;
    const rank = { rankNumber: 1 } as Rank;
    const random = {
      choice: () => true,
      normal: () => 25,
    } as unknown as NumpyRandom;

    generateIdentity(npc, rank, 'zh_CN', random, 1234);

    expect(`${npc.name} ${npc.surname}`).toMatch(/^[A-Za-z0-9].* [A-Za-z0-9]/);
    expect(`${npc.name} ${npc.surname}`).not.toContain('_');
  });
});
