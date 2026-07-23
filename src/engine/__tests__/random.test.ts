import { describe, expect, it } from 'vitest';
import { NumpyRandom, pythonRound } from '../random';

describe('NumpyRandom', () => {
  it('matches NumPy RandomState random_sample for seed 101', () => {
    const random = new NumpyRandom(101);
    expect(Array.from({ length: 5 }, () => random.random())).toEqual([
      0.5163986277024462,
      0.5706675868681398,
      0.028474226478096942,
      0.17152165622510307,
      0.6852769816973125,
    ]);
  });

  it('matches NumPy RandomState normal for seed 101', () => {
    const random = new NumpyRandom(101);
    expect(Array.from({ length: 4 }, () => random.normal())).toEqual([
      2.706849839399938,
      0.6281327087844596,
      0.9079694464765431,
      0.5038257538223936,
    ]);
  });
});

describe('pythonRound', () => {
  it('uses bankers rounding', () => {
    expect(pythonRound(2.5)).toBe(2);
    expect(pythonRound(3.5)).toBe(4);
    expect(pythonRound(-1.5)).toBe(-2);
  });
});
