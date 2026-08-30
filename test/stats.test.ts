import { describe, expect, it } from 'vitest'
import {
  cliffsDelta,
  computeStats,
  mannWhitneyU,
  mean,
  median,
  normalCdf,
  percentile,
  stdDev,
} from '../src/core/stats'

describe('percentile', () => {
  // Cross-checked against numpy.percentile (linear interpolation, type 7).
  it('interpolates linearly', () => {
    const v = [1, 2, 3, 4, 5]
    expect(percentile(v, 0)).toBe(1)
    expect(percentile(v, 50)).toBe(3)
    expect(percentile(v, 90)).toBeCloseTo(4.6, 10)
    expect(percentile(v, 95)).toBeCloseTo(4.8, 10)
    expect(percentile(v, 100)).toBe(5)
  })

  it('sorts its input rather than assuming order', () => {
    expect(percentile([5, 1, 4, 2, 3], 50)).toBe(3)
  })

  it('handles the degenerate sizes the bundled sample file has', () => {
    expect(percentile([], 50)).toBeNaN()
    expect(percentile([42], 50)).toBe(42)
    expect(percentile([42], 99)).toBe(42)
  })
})

describe('mean / stdDev / median', () => {
  it('computes a sample standard deviation with an n-1 denominator', () => {
    expect(stdDev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.13809, 4)
  })

  it('reports zero spread for a single value rather than NaN', () => {
    expect(stdDev([5])).toBe(0)
  })

  it('returns NaN for empty input', () => {
    expect(mean([])).toBeNaN()
    expect(median([])).toBeNaN()
  })
})

describe('computeStats', () => {
  it('summarizes a distribution', () => {
    const s = computeStats([10, 20, 30, 40, 50], 5)
    expect(s.n).toBe(5)
    expect(s.sampleCount).toBe(5)
    expect(s.min).toBe(10)
    expect(s.max).toBe(50)
    expect(s.mean).toBe(30)
    expect(s.median).toBe(30)
    expect(s.p90).toBeCloseTo(46, 10)
    expect(s.cv).toBeCloseTo(stdDev([10, 20, 30, 40, 50]) / 30, 10)
  })

  it('keeps iteration count separate from sample count', () => {
    // A sampled metric: 3 iterations, 4 frames each.
    const s = computeStats([1, 2, 3, 4, 1, 2, 3, 4, 1, 2, 3, 4], 3)
    expect(s.n).toBe(3)
    expect(s.sampleCount).toBe(12)
  })

  it('drops non-finite samples instead of poisoning the whole summary', () => {
    const s = computeStats([1, 2, NaN, 3, Infinity], 5)
    expect(s.sampleCount).toBe(3)
    expect(s.median).toBe(2)
  })

  it('survives an all-empty metric', () => {
    const s = computeStats([], 0)
    expect(s.sampleCount).toBe(0)
    expect(s.median).toBeNaN()
  })

  it('reports cv of 0 rather than Infinity when the mean is 0', () => {
    expect(computeStats([0, 0, 0], 3).cv).toBe(0)
  })
})

describe('normalCdf', () => {
  it('matches known values', () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 6)
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 4)
    expect(normalCdf(-1.96)).toBeCloseTo(0.025, 4)
    expect(normalCdf(2.5758)).toBeCloseTo(0.995, 4)
  })
})

describe('mannWhitneyU', () => {
  it('finds fully separated groups significant', () => {
    const r = mannWhitneyU([1, 2, 3, 4, 5], [6, 7, 8, 9, 10])!
    expect(r.u).toBe(0)
    expect(r.p).toBeLessThan(0.05)
  })

  it('finds identical groups non-significant', () => {
    const r = mannWhitneyU([1, 2, 3, 4, 5], [1, 2, 3, 4, 5])!
    expect(r.p).toBeGreaterThan(0.5)
  })

  it('is symmetric in its arguments', () => {
    const a = [3, 1, 4, 1, 5, 9, 2, 6]
    const b = [2, 7, 1, 8, 2, 8, 1, 8]
    expect(mannWhitneyU(a, b)!.p).toBeCloseTo(mannWhitneyU(b, a)!.p, 12)
  })

  it('handles all-tied input without dividing by zero', () => {
    const r = mannWhitneyU([5, 5, 5], [5, 5, 5])!
    expect(Number.isFinite(r.p)).toBe(true)
    expect(r.p).toBe(1)
  })

  it('returns null when a group is empty', () => {
    expect(mannWhitneyU([], [1, 2, 3])).toBeNull()
  })

  it('does not call a small overlapping shift significant', () => {
    const r = mannWhitneyU([100, 101, 102, 103, 104], [101, 102, 103, 104, 105])!
    expect(r.p).toBeGreaterThan(0.05)
  })
})

describe('cliffsDelta', () => {
  it('returns +1 when every candidate value exceeds every baseline value', () => {
    const r = cliffsDelta([1, 2, 3], [4, 5, 6])!
    expect(r.delta).toBe(1)
    expect(r.magnitude).toBe('large')
  })

  it('returns -1 in the reverse case', () => {
    expect(cliffsDelta([4, 5, 6], [1, 2, 3])!.delta).toBe(-1)
  })

  it('returns 0 for identical distributions', () => {
    const r = cliffsDelta([1, 2, 3], [1, 2, 3])!
    expect(r.delta).toBe(0)
    expect(r.magnitude).toBe('negligible')
  })

  it('agrees with a brute-force count on overlapping data', () => {
    const x = [1, 3, 5, 7, 9, 2, 4]
    const y = [2, 3, 6, 8, 1, 5]
    let greater = 0
    let less = 0
    for (const b of y) for (const a of x) {
      if (b > a) greater++
      else if (b < a) less++
    }
    expect(cliffsDelta(x, y)!.delta).toBeCloseTo((greater - less) / (x.length * y.length), 12)
  })

  it('returns null when a group is empty', () => {
    expect(cliffsDelta([1], [])).toBeNull()
  })
})
