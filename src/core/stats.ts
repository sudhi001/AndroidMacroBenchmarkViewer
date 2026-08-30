import type { Stats } from './types'

export const EMPTY_STATS: Stats = {
  n: 0,
  sampleCount: 0,
  min: NaN,
  max: NaN,
  mean: NaN,
  median: NaN,
  stdDev: NaN,
  cv: NaN,
  p50: NaN,
  p90: NaN,
  p95: NaN,
  p99: NaN,
}

export function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

/**
 * Linear-interpolation percentile (the "type 7" definition used by NumPy, R and
 * Excel). `sorted` must already be ascending.
 *
 * Note this can differ in the last decimal from the P50/P90/P95/P99 that the
 * Gradle console prints, because androidx.benchmark picks a nearest rank rather
 * than interpolating. The method is surfaced in the UI so the difference is
 * explainable rather than looking like a bug.
 */
export function percentileSorted(sorted: number[], p: number): number {
  const n = sorted.length
  if (n === 0) return NaN
  if (n === 1) return sorted[0]!
  const rank = (p / 100) * (n - 1)
  const lo = Math.floor(rank)
  const hi = Math.ceil(rank)
  if (lo === hi) return sorted[lo]!
  const frac = rank - lo
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * frac
}

export function percentile(values: number[], p: number): number {
  return percentileSorted([...values].sort((a, b) => a - b), p)
}

export function mean(values: number[]): number {
  if (values.length === 0) return NaN
  let sum = 0
  for (const v of values) sum += v
  return sum / values.length
}

/** Sample standard deviation (n-1 denominator). Returns 0 for a single value. */
export function stdDev(values: number[]): number {
  const n = values.length
  if (n === 0) return NaN
  if (n === 1) return 0
  const m = mean(values)
  let acc = 0
  for (const v of values) acc += (v - m) ** 2
  return Math.sqrt(acc / (n - 1))
}

export function median(values: number[]): number {
  return percentile(values, 50)
}

/**
 * Build a full stats summary.
 *
 * @param samples     every raw sample, used for percentiles and spread
 * @param iterations  how many iterations produced them (n for the run-quality
 *                    signal; for sampled metrics this is far smaller than
 *                    samples.length and is the number that actually matters
 *                    when judging whether a comparison is trustworthy)
 */
export function computeStats(samples: number[], iterations: number): Stats {
  const clean = samples.filter(isFiniteNumber)
  if (clean.length === 0) return { ...EMPTY_STATS, n: iterations }
  const sorted = [...clean].sort((a, b) => a - b)
  const m = mean(clean)
  const sd = stdDev(clean)
  return {
    n: iterations,
    sampleCount: clean.length,
    min: sorted[0]!,
    max: sorted[sorted.length - 1]!,
    mean: m,
    median: percentileSorted(sorted, 50),
    stdDev: sd,
    cv: m === 0 ? 0 : Math.abs(sd / m),
    p50: percentileSorted(sorted, 50),
    p90: percentileSorted(sorted, 90),
    p95: percentileSorted(sorted, 95),
    p99: percentileSorted(sorted, 99),
  }
}

/* -------------------------------------------------------------------------- */
/*  Significance testing                                                       */
/* -------------------------------------------------------------------------- */

/** Abramowitz & Stegun 7.1.26 approximation of the error function. */
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1
  const ax = Math.abs(x)
  const t = 1 / (1 + 0.3275911 * ax)
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t +
      0.254829592) *
      t *
      Math.exp(-ax * ax)
  return sign * y
}

/** Standard normal CDF. */
export function normalCdf(z: number): number {
  return 0.5 * (1 + erf(z / Math.SQRT2))
}

/** Average ranks, with ties sharing their mean rank. */
function rank(values: number[]): { ranks: number[]; tieCorrection: number } {
  const indexed = values.map((v, i) => ({ v, i }))
  indexed.sort((a, b) => a.v - b.v)
  const ranks = new Array<number>(values.length)
  let tieCorrection = 0
  let i = 0
  while (i < indexed.length) {
    let j = i
    while (j + 1 < indexed.length && indexed[j + 1]!.v === indexed[i]!.v) j++
    const avgRank = (i + j) / 2 + 1
    const groupSize = j - i + 1
    if (groupSize > 1) tieCorrection += groupSize ** 3 - groupSize
    for (let k = i; k <= j; k++) ranks[indexed[k]!.i] = avgRank
    i = j + 1
  }
  return { ranks, tieCorrection }
}

export interface MannWhitneyResult {
  u: number
  z: number
  /** Two-sided p-value. */
  p: number
}

/**
 * Mann-Whitney U test, normal approximation with tie and continuity correction.
 *
 * Chosen over a t-test because benchmark iteration samples are small, skewed and
 * outlier-prone (one thermal blip ruins a mean), and this test assumes neither
 * normality nor equal variance.
 *
 * The normal approximation is unreliable below roughly n=8 per group; callers
 * should gate on iteration count separately rather than trusting a small-n
 * p-value on its own.
 */
export function mannWhitneyU(a: number[], b: number[]): MannWhitneyResult | null {
  const x = a.filter(isFiniteNumber)
  const y = b.filter(isFiniteNumber)
  const n1 = x.length
  const n2 = y.length
  if (n1 === 0 || n2 === 0) return null

  const { ranks, tieCorrection } = rank([...x, ...y])
  let r1 = 0
  for (let i = 0; i < n1; i++) r1 += ranks[i]!

  const u1 = r1 - (n1 * (n1 + 1)) / 2
  const u2 = n1 * n2 - u1
  const u = Math.min(u1, u2)

  const N = n1 + n2
  const mu = (n1 * n2) / 2
  const tieTerm = tieCorrection / (N * (N - 1))
  const variance = ((n1 * n2) / 12) * (N + 1 - tieTerm)
  if (variance <= 0) return { u, z: 0, p: 1 }

  // Continuity correction pulls U half a step toward the mean.
  const z = (u - mu + 0.5) / Math.sqrt(variance)
  const p = Math.min(1, 2 * normalCdf(-Math.abs(z)))
  return { u, z, p }
}

export type EffectMagnitude = 'negligible' | 'small' | 'medium' | 'large'

export interface CliffsDeltaResult {
  delta: number
  magnitude: EffectMagnitude
}

/**
 * Cliff's delta: the probability that a candidate value exceeds a baseline
 * value, minus the reverse. Non-parametric, unitless, and unlike a percentage
 * delta it does not collapse when the distributions overlap heavily.
 *
 * Thresholds are Romano et al.'s conventional cutoffs.
 */
export function cliffsDelta(baseline: number[], candidate: number[]): CliffsDeltaResult | null {
  const x = baseline.filter(isFiniteNumber)
  const y = candidate.filter(isFiniteNumber)
  if (x.length === 0 || y.length === 0) return null

  // Sort once and sweep, so this is O(n log n) rather than the O(n*m) that a
  // naive double loop would cost on sampled metrics with thousands of frames.
  const sortedX = [...x].sort((a, b) => a - b)
  let greater = 0
  let less = 0
  for (const v of y) {
    greater += lowerBound(sortedX, v)
    less += sortedX.length - upperBound(sortedX, v)
  }
  const delta = (greater - less) / (x.length * y.length)
  const a = Math.abs(delta)
  const magnitude: EffectMagnitude =
    a < 0.147 ? 'negligible' : a < 0.33 ? 'small' : a < 0.474 ? 'medium' : 'large'
  return { delta, magnitude }
}

/** Count of entries strictly less than `target`. */
function lowerBound(sorted: number[], target: number): number {
  let lo = 0
  let hi = sorted.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (sorted[mid]! < target) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** Count of entries less than or equal to `target`. */
function upperBound(sorted: number[], target: number): number {
  let lo = 0
  let hi = sorted.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (sorted[mid]! <= target) lo = mid + 1
    else hi = mid
  }
  return lo
}

/**
 * One representative value per group. Used to collapse a sampled metric's
 * per-iteration sample arrays down to the level at which observations are
 * actually independent.
 */
export function medianPerGroup(groups: number[][]): number[] {
  return groups.filter((g) => g.length > 0).map((g) => (g.length === 1 ? g[0]! : percentile(g, 50)))
}

/**
 * Run-to-run reproducibility: the coefficient of variation *between* iterations.
 *
 * Deliberately not the CV of the pooled samples. For a frame-timing metric the
 * pooled spread is dominated by legitimate frame-to-frame variation (often
 * ~50%), which says nothing about whether a second run would reproduce the
 * result. The between-iteration figure is what decides whether a delta is
 * trustworthy, and for a measured metric the two are identical anyway.
 */
export function betweenIterationCv(iterations: number[][]): number {
  const per = medianPerGroup(iterations)
  if (per.length < 2) return 0
  const m = mean(per)
  if (m === 0) return 0
  return Math.abs(stdDev(per) / m)
}
