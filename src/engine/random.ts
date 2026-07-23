/** NumPy RandomState-compatible MT19937 subset used by the original generator. */
export class NumpyRandom {
  private readonly mt = new Uint32Array(624);
  private index = 624;
  private hasGaussian = false;
  private gaussian = 0;

  constructor(seed: number) {
    this.seed(seed);
  }

  seed(seed: number): void {
    this.mt[0] = seed >>> 0;
    for (let i = 1; i < 624; i += 1) {
      const previous = this.mt[i - 1]!;
      const value = previous ^ (previous >>> 30);
      this.mt[i] = (Math.imul(1812433253, value) + i) >>> 0;
    }
    this.index = 624;
    this.hasGaussian = false;
    this.gaussian = 0;
  }

  private twist(): void {
    for (let i = 0; i < 624; i += 1) {
      const y = (this.mt[i]! & 0x80000000) | (this.mt[(i + 1) % 624]! & 0x7fffffff);
      let next = this.mt[(i + 397) % 624]! ^ (y >>> 1);
      if ((y & 1) !== 0) next ^= 0x9908b0df;
      this.mt[i] = next >>> 0;
    }
    this.index = 0;
  }

  uint32(): number {
    if (this.index >= 624) this.twist();
    let y = this.mt[this.index++]!;
    y ^= y >>> 11;
    y ^= (y << 7) & 0x9d2c5680;
    y ^= (y << 15) & 0xefc60000;
    y ^= y >>> 18;
    return y >>> 0;
  }

  random(): number {
    const a = this.uint32() >>> 5;
    const b = this.uint32() >>> 6;
    return (a * 67_108_864 + b) / 9_007_199_254_740_992;
  }

  uniform(low = 0, high = 1): number {
    return low + (high - low) * this.random();
  }

  /** Equivalent to RandomState.randint(low, high) for scalar non-negative bounds. */
  randint(low: number, high?: number): number {
    const actualHigh = high ?? low;
    const actualLow = high === undefined ? 0 : low;
    if (!Number.isInteger(actualLow) || !Number.isInteger(actualHigh) || actualHigh <= actualLow) {
      throw new RangeError(`Invalid randint range: [${actualLow}, ${actualHigh})`);
    }
    return actualLow + this.interval(actualHigh - actualLow - 1);
  }

  private interval(max: number): number {
    if (max === 0) return 0;
    let mask = max >>> 0;
    mask |= mask >>> 1;
    mask |= mask >>> 2;
    mask |= mask >>> 4;
    mask |= mask >>> 8;
    mask |= mask >>> 16;
    let value: number;
    do {
      value = this.uint32() & mask;
    } while (value > max);
    return value;
  }

  choice<T>(items: readonly T[], probabilities?: readonly number[]): T {
    if (items.length === 0) throw new RangeError('Cannot choose from an empty sequence');
    if (!probabilities) return items[this.randint(items.length)]!;
    if (probabilities.length !== items.length) throw new RangeError('Probability count does not match item count');

    let total = 0;
    const cumulative = probabilities.map((probability) => {
      total += probability;
      return total;
    });
    if (!(total > 0)) throw new RangeError('Probabilities must have a positive sum');
    const sample = this.random();
    for (let i = 0; i < cumulative.length; i += 1) {
      if (sample < cumulative[i]! / total) return items[i]!;
    }
    return items[items.length - 1]!;
  }

  normal(mean = 0, standardDeviation = 1): number {
    if (standardDeviation < 0) throw new RangeError('standardDeviation must be non-negative');
    if (this.hasGaussian) {
      this.hasGaussian = false;
      return mean + standardDeviation * this.gaussian;
    }

    let x1 = 0;
    let x2 = 0;
    let radiusSquared = 0;
    do {
      x1 = 2 * this.random() - 1;
      x2 = 2 * this.random() - 1;
      radiusSquared = x1 * x1 + x2 * x2;
    } while (radiusSquared >= 1 || radiusSquared === 0);

    const scale = Math.sqrt((-2 * Math.log(radiusSquared)) / radiusSquared);
    this.gaussian = scale * x1;
    this.hasGaussian = true;
    return mean + standardDeviation * (scale * x2);
  }
}

export function pythonRound(value: number): number {
  if (!Number.isFinite(value)) return value;
  const floor = Math.floor(value);
  const fraction = value - floor;
  if (fraction < 0.5) return floor;
  if (fraction > 0.5) return floor + 1;
  return floor % 2 === 0 ? floor : floor + 1;
}

export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function chooseExponentialRandomElement<T>(random: NumpyRandom, elements: readonly T[]): T {
  if (elements.length === 0) throw new RangeError('Cannot choose from an empty sequence');
  const weights = elements.map((_, index) => 0.2 * Math.exp(-0.2 * (index * 20 / elements.length)));
  return random.choice(elements, weights);
}

export function getAllowedItems<T>(items: readonly T[], normalizedIndex: number): T[] {
  const index = Math.floor((items.length - 1) * normalizedIndex);
  return items.slice(index);
}
