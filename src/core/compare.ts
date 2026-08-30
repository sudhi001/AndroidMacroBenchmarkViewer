import { cliffsDelta, computeStats, mannWhitneyU, medianPerGroup } from './stats'
import type { Benchmark, BenchmarkRun, Issue, Metric, Stats, Unit } from './types'

export type Verdict =
  | 'improved'
  | 'regressed'
  | 'unchanged'
  | 'inconclusive'
  | 'baseline-only'
  | 'candidate-only'

export interface CompareOptions {
  /** Relative change below which a delta is treated as noise. */
  minDeltaPct: number
  /** Significance level for the Mann-Whitney U test. */
  alpha: number
  /** Baseline CV above which no verdict is trusted. */
  maxCv: number
  /** Iterations required per side before a verdict is trusted. */
  minIterations: number
}

export const DEFAULT_COMPARE_OPTIONS: CompareOptions = {
  minDeltaPct: 0.05,
  alpha: 0.05,
  maxCv: 0.1,
  minIterations: 5,
}

export type TailPercentile = 'p90' | 'p95' | 'p99'

export interface TailAlert {
  percentile: TailPercentile
  deltaPct: number
}

export interface PercentileDeltas {
  p50: number | null
  p90: number | null
  p95: number | null
  p99: number | null
}

export interface MetricComparison {
  benchmarkKey: string
  benchmarkName: string
  className: string
  params: Record<string, string>
  metricName: string
  unit: Unit
  lowerIsBetter: boolean
  baseline: Stats | null
  candidate: Stats | null
  /** Absolute change in the pooled median, in the metric's own unit. */
  deltaMedian: number | null
  /** Relative change in the pooled median, as a fraction (0.12 === +12%). */
  deltaPct: number | null
  /** Relative change at each percentile — tail regressions hide here. */
  percentileDeltas: PercentileDeltas
  /** Two-sided p-value over per-iteration medians. */
  pValue: number | null
  cliffsDelta: number | null
  effectMagnitude: 'negligible' | 'small' | 'medium' | 'large' | null
  /**
   * Set when a tail percentile moved materially more than the median did.
   *
   * A jank regression usually shows up here and nowhere else: a handful of
   * dropped frames barely shift the median of two thousand samples while P99
   * moves by a quarter. Without this the row reads "unchanged" and the reader
   * moves on, which is the exact failure this tool exists to prevent.
   */
  tailAlert: TailAlert | null
  verdict: Verdict
  /** Human-readable justification for the verdict, shown in the UI. */
  reasons: string[]
}

export interface ComparisonSummary {
  regressed: number
  improved: number
  unchanged: number
  inconclusive: number
  missing: number
}

export interface ComparisonReport {
  baselineLabel: string
  candidateLabel: string
  options: CompareOptions
  warnings: Issue[]
  comparisons: MetricComparison[]
  summary: ComparisonSummary
}

/**
 * One value per iteration.
 *
 * This is the unit of independent observation. Frames within a single iteration
 * are heavily autocorrelated, so running a significance test over all ~2000 raw
 * frame samples would report a p-value near zero for a change of no practical
 * size. Collapsing to per-iteration medians first keeps n honest.
 */
export function iterationMedians(metric: Metric): number[] {
  return medianPerGroup(metric.iterations)
}

function relativeDelta(base: number, cand: number): number | null {
  if (!Number.isFinite(base) || !Number.isFinite(cand)) return null
  if (base === 0) return cand === 0 ? 0 : null
  return (cand - base) / Math.abs(base)
}

/**
 * Find the tail percentile that moved worst, when the tail clearly diverges
 * from the median. Requires both that the tail move past the caller's own
 * threshold and that it be at least twice the median's movement, so an
 * across-the-board shift does not raise an alert on every metric.
 */
function findTailAlert(
  deltas: PercentileDeltas,
  medianDeltaPct: number | null,
  lowerIsBetter: boolean,
  minDeltaPct: number,
): TailAlert | null {
  const medianMove = Math.abs(medianDeltaPct ?? 0)
  let worst: TailAlert | null = null

  for (const percentile of ['p90', 'p95', 'p99'] as const) {
    const delta = deltas[percentile]
    if (delta == null || !Number.isFinite(delta)) continue
    const worse = lowerIsBetter ? delta > 0 : delta < 0
    if (!worse) continue
    const move = Math.abs(delta)
    if (move < minDeltaPct) continue
    if (move < medianMove * 2) continue
    if (worst === null || move > Math.abs(worst.deltaPct)) {
      worst = { percentile, deltaPct: delta }
    }
  }
  return worst
}

function percentileDeltas(base: Stats, cand: Stats): PercentileDeltas {
  return {
    p50: relativeDelta(base.p50, cand.p50),
    p90: relativeDelta(base.p90, cand.p90),
    p95: relativeDelta(base.p95, cand.p95),
    p99: relativeDelta(base.p99, cand.p99),
  }
}

function metricMap(benchmark: Benchmark | undefined): Map<string, Metric> {
  const map = new Map<string, Metric>()
  if (benchmark) for (const m of benchmark.metrics) map.set(m.name, m)
  return map
}

function benchmarkMap(run: BenchmarkRun): Map<string, Benchmark> {
  return new Map(run.benchmarks.map((b) => [b.key, b]))
}

function compareMetric(
  benchmark: Benchmark,
  metricName: string,
  baseMetric: Metric | undefined,
  candMetric: Metric | undefined,
  options: CompareOptions,
): MetricComparison {
  const shape = baseMetric ?? candMetric!
  const base: MetricComparison = {
    benchmarkKey: benchmark.key,
    benchmarkName: benchmark.name,
    className: benchmark.className,
    params: benchmark.params,
    metricName,
    unit: shape.unit,
    lowerIsBetter: shape.lowerIsBetter,
    baseline: baseMetric?.stats ?? null,
    candidate: candMetric?.stats ?? null,
    deltaMedian: null,
    deltaPct: null,
    percentileDeltas: { p50: null, p90: null, p95: null, p99: null },
    pValue: null,
    cliffsDelta: null,
    effectMagnitude: null,
    tailAlert: null,
    verdict: 'inconclusive',
    reasons: [],
  }

  if (!baseMetric) {
    return { ...base, verdict: 'candidate-only', reasons: ['Not present in the baseline run.'] }
  }
  if (!candMetric) {
    return { ...base, verdict: 'baseline-only', reasons: ['Not present in the candidate run.'] }
  }

  const baseStats = baseMetric.stats
  const candStats = candMetric.stats
  const deltaMedian = candStats.median - baseStats.median
  const deltaPct = relativeDelta(baseStats.median, candStats.median)

  const baseIters = iterationMedians(baseMetric)
  const candIters = iterationMedians(candMetric)
  const mw = mannWhitneyU(baseIters, candIters)
  const cd = cliffsDelta(baseIters, candIters)
  const deltas = percentileDeltas(baseStats, candStats)

  const result: MetricComparison = {
    ...base,
    deltaMedian,
    deltaPct,
    percentileDeltas: deltas,
    pValue: mw?.p ?? null,
    cliffsDelta: cd?.delta ?? null,
    effectMagnitude: cd?.magnitude ?? null,
    tailAlert: baseMetric.synthesized
      ? null
      : findTailAlert(deltas, deltaPct, shape.lowerIsBetter, options.minDeltaPct),
  }

  const reasons: string[] = []

  // 1. Not enough iterations to say anything, whatever the numbers look like.
  const minN = Math.min(baseIters.length, candIters.length)
  if (baseMetric.synthesized || candMetric.synthesized) {
    reasons.push('No per-iteration data; only summary values were available.')
    return { ...result, verdict: 'inconclusive', reasons }
  }
  if (minN < options.minIterations) {
    reasons.push(
      `Only ${minN} iteration(s) per side; ${options.minIterations} are needed. Raise \`iterations\` in your benchmark rule.`,
    )
    return { ...result, verdict: 'inconclusive', reasons }
  }

  // 2. A noisy baseline cannot anchor a comparison.
  const noiseCv = baseMetric.betweenIterationCv
  if (Number.isFinite(noiseCv) && noiseCv > options.maxCv) {
    reasons.push(
      `Baseline is not reproducible run-to-run (between-iteration CV ${(noiseCv * 100).toFixed(1)}% > ${(options.maxCv * 100).toFixed(0)}%). The device is too noisy to trust this delta.`,
    )
    return { ...result, verdict: 'inconclusive', reasons }
  }

  // 3. Below the practical-significance threshold — do not cry wolf.
  if (deltaPct === null) {
    reasons.push('Baseline median is zero; a relative change is undefined.')
    return { ...result, verdict: 'inconclusive', reasons }
  }
  if (Math.abs(deltaPct) < options.minDeltaPct) {
    reasons.push(
      `Median change of ${(deltaPct * 100).toFixed(1)}% is within the ${(options.minDeltaPct * 100).toFixed(0)}% threshold.`,
    )
    if (result.tailAlert) {
      reasons.push(
        `But ${result.tailAlert.percentile.toUpperCase()} moved ${(result.tailAlert.deltaPct * 100).toFixed(1)}% — the slowest cases got worse even though the typical case did not. For frame timing this is what a jank regression looks like.`,
      )
    }
    return { ...result, verdict: 'unchanged', reasons }
  }

  // 4. Big enough to matter, but is it distinguishable from noise?
  if (mw && mw.p > options.alpha) {
    reasons.push(
      `Median moved ${(deltaPct * 100).toFixed(1)}%, but the distributions overlap too much to call it (p = ${mw.p.toFixed(3)}).`,
    )
    return { ...result, verdict: 'inconclusive', reasons }
  }

  // 5. Real, and large enough to act on.
  const worse = shape.lowerIsBetter ? deltaMedian > 0 : deltaMedian < 0
  if (mw) reasons.push(`p = ${mw.p.toFixed(4)} over ${minN} iterations per side.`)
  if (cd) reasons.push(`Cliff's delta ${cd.delta.toFixed(2)} (${cd.magnitude} effect).`)
  if (result.tailAlert) {
    reasons.push(
      `${result.tailAlert.percentile.toUpperCase()} moved ${(result.tailAlert.deltaPct * 100).toFixed(1)}%, well beyond the median — the tail is worse than the headline number suggests.`,
    )
  }
  return { ...result, verdict: worse ? 'regressed' : 'improved', reasons }
}

/** Warn about anything that would make the numbers incomparable in principle. */
function environmentWarnings(baseline: BenchmarkRun, candidate: BenchmarkRun): Issue[] {
  const warnings: Issue[] = []
  const b = baseline.context
  const c = candidate.context

  if (b.fingerprint && c.fingerprint && b.fingerprint !== c.fingerprint) {
    const sameModel = b.model === c.model
    warnings.push({
      level: 'warning',
      message: sameModel
        ? `Both runs report "${b.model}" but the build fingerprints differ. A different OS build can shift results on its own.`
        : `These runs are from different devices (${b.model ?? 'unknown'} vs ${c.model ?? 'unknown'}). Cross-device deltas measure the hardware, not your change.`,
    })
  }
  if (b.sdk !== null && c.sdk !== null && b.sdk !== c.sdk) {
    warnings.push({
      level: 'warning',
      message: `Different Android versions (SDK ${b.sdk} vs ${c.sdk}).`,
    })
  }
  if (b.cpuLocked === false || c.cpuLocked === false) {
    warnings.push({
      level: 'info',
      message: 'CPU clocks were unlocked in at least one run; expect wider confidence intervals.',
    })
  }
  if (baseline.id === candidate.id) {
    warnings.push({
      level: 'info',
      message: 'Both sides are the same file — every metric should read as unchanged.',
    })
  }
  return warnings
}

/**
 * Diff two runs, joining on benchmark key and metric name.
 *
 * Benchmarks present on only one side are reported rather than dropped, because
 * a benchmark disappearing between runs is itself a thing worth seeing.
 */
export function compareRuns(
  baseline: BenchmarkRun,
  candidate: BenchmarkRun,
  options: Partial<CompareOptions> = {},
): ComparisonReport {
  const opts = { ...DEFAULT_COMPARE_OPTIONS, ...options }
  const baseBenchmarks = benchmarkMap(baseline)
  const candBenchmarks = benchmarkMap(candidate)

  const keys: string[] = []
  const seen = new Set<string>()
  for (const key of [...baseBenchmarks.keys(), ...candBenchmarks.keys()]) {
    if (!seen.has(key)) {
      seen.add(key)
      keys.push(key)
    }
  }

  const comparisons: MetricComparison[] = []
  for (const key of keys) {
    const baseBenchmark = baseBenchmarks.get(key)
    const candBenchmark = candBenchmarks.get(key)
    const shape = baseBenchmark ?? candBenchmark!
    const baseMetrics = metricMap(baseBenchmark)
    const candMetrics = metricMap(candBenchmark)

    const metricNames: string[] = []
    const seenMetric = new Set<string>()
    for (const name of [...baseMetrics.keys(), ...candMetrics.keys()]) {
      if (!seenMetric.has(name)) {
        seenMetric.add(name)
        metricNames.push(name)
      }
    }

    for (const name of metricNames) {
      comparisons.push(
        compareMetric(shape, name, baseMetrics.get(name), candMetrics.get(name), opts),
      )
    }
  }

  const summary: ComparisonSummary = {
    regressed: 0,
    improved: 0,
    unchanged: 0,
    inconclusive: 0,
    missing: 0,
  }
  for (const c of comparisons) {
    if (c.verdict === 'regressed') summary.regressed++
    else if (c.verdict === 'improved') summary.improved++
    else if (c.verdict === 'unchanged') summary.unchanged++
    else if (c.verdict === 'inconclusive') summary.inconclusive++
    else summary.missing++
  }

  return {
    baselineLabel: baseline.label,
    candidateLabel: candidate.label,
    options: opts,
    warnings: environmentWarnings(baseline, candidate),
    comparisons,
    summary,
  }
}

/** Sort order for the comparison table: worst news first. */
const VERDICT_RANK: Record<Verdict, number> = {
  regressed: 0,
  improved: 1,
  inconclusive: 2,
  'baseline-only': 3,
  'candidate-only': 4,
  unchanged: 5,
}

export function sortByImpact(comparisons: MetricComparison[]): MetricComparison[] {
  return [...comparisons].sort((a, b) => {
    const rank = VERDICT_RANK[a.verdict] - VERDICT_RANK[b.verdict]
    if (rank !== 0) return rank
    return Math.abs(b.deltaPct ?? 0) - Math.abs(a.deltaPct ?? 0)
  })
}

/** Recompute stats for an arbitrary sample subset — used by the drill-down. */
export function statsFor(samples: number[], iterations: number): Stats {
  return computeStats(samples, iterations)
}
