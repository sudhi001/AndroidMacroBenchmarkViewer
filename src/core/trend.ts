import { NOISY_CV_THRESHOLD } from './parse'
import { betweenIterationCv } from './stats'
import type { BenchmarkRun, Stats, Unit } from './types'

export interface TrendPoint {
  runId: string
  label: string
  capturedAt: number
  stats: Stats | null
  /** Run-to-run reproducibility for this point; drives the flakiness flag. */
  cv: number | null
}

export interface TrendSeries {
  benchmarkKey: string
  benchmarkName: string
  className: string
  params: Record<string, string>
  metricName: string
  unit: Unit
  lowerIsBetter: boolean
  points: TrendPoint[]
  /** Number of runs that actually contain this metric. */
  coverage: number
  /** True when most points are too irreproducible to read a trend from. */
  flaky: boolean
  /** Relative change from the first point that has data to the last. */
  netChange: number | null
}

export interface TrendOptions {
  /** Order runs by capture time rather than the caller's order. */
  sortByTime: boolean
}

export const DEFAULT_TREND_OPTIONS: TrendOptions = { sortByTime: true }

/**
 * Build one series per (benchmark, metric) across N runs.
 *
 * benchmarkData.json has no timestamp of its own, so ordering relies on the
 * `capturedAt` the caller supplied (File.lastModified in the browser). Callers
 * that let the user reorder runs manually should pass `sortByTime: false`.
 */
export function buildTrend(
  runs: BenchmarkRun[],
  options: Partial<TrendOptions> = {},
): TrendSeries[] {
  const opts = { ...DEFAULT_TREND_OPTIONS, ...options }
  const ordered = opts.sortByTime
    ? [...runs].sort((a, b) => a.capturedAt - b.capturedAt)
    : [...runs]

  // Seed the series list in first-seen order so the UI ordering is stable.
  const series = new Map<string, TrendSeries>()
  for (const run of ordered) {
    for (const benchmark of run.benchmarks) {
      for (const metric of benchmark.metrics) {
        const id = `${benchmark.key}::${metric.name}`
        if (!series.has(id)) {
          series.set(id, {
            benchmarkKey: benchmark.key,
            benchmarkName: benchmark.name,
            className: benchmark.className,
            params: benchmark.params,
            metricName: metric.name,
            unit: metric.unit,
            lowerIsBetter: metric.lowerIsBetter,
            points: [],
            coverage: 0,
            flaky: false,
            netChange: null,
          })
        }
      }
    }
  }

  // Every series gets a point for every run, so a metric that disappears leaves
  // a visible gap rather than silently shortening the line.
  for (const s of series.values()) {
    for (const run of ordered) {
      const benchmark = run.benchmarks.find((b) => b.key === s.benchmarkKey)
      const metric = benchmark?.metrics.find((m) => m.name === s.metricName)
      s.points.push({
        runId: run.id,
        label: run.label,
        capturedAt: run.capturedAt,
        stats: metric?.stats ?? null,
        cv: metric ? betweenIterationCv(metric.iterations) : null,
      })
    }

    const present = s.points.filter((p) => p.stats !== null)
    s.coverage = present.length

    const cvs = present.map((p) => p.cv).filter((c): c is number => c !== null && Number.isFinite(c))
    s.flaky =
      cvs.length > 0 && cvs.filter((c) => c > NOISY_CV_THRESHOLD).length > cvs.length / 2

    const first = present[0]?.stats?.median
    const last = present[present.length - 1]?.stats?.median
    s.netChange =
      first !== undefined && last !== undefined && Number.isFinite(first) && first !== 0
        ? (last - first) / Math.abs(first)
        : null
  }

  return [...series.values()]
}

/** Series whose net movement is worst first — the drift worth investigating. */
export function sortByDrift(series: TrendSeries[]): TrendSeries[] {
  const badness = (s: TrendSeries) => {
    if (s.netChange === null) return -Infinity
    return s.lowerIsBetter ? s.netChange : -s.netChange
  }
  return [...series].sort((a, b) => badness(b) - badness(a))
}
