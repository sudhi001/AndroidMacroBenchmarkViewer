/**
 * Normalized model for Android Macrobenchmark / Benchmark output.
 *
 * Every view in the app reads these types and never the raw JSON. The parser is
 * the single place that knows about the on-disk schema, so AGP changing a field
 * name breaks exactly one file.
 */

export type MetricKind = 'measured' | 'sampled'

export type Unit =
  | 'ms'
  | 'ns'
  | 'us'
  | 's'
  | 'count'
  | 'bytes'
  | 'kb'
  | 'mb'
  | 'percent'
  | 'hz'
  | 'unknown'

export type IssueLevel = 'error' | 'warning' | 'info'

export interface Issue {
  level: IssueLevel
  message: string
  /** Dotted path into the source JSON, when the issue is tied to a field. */
  path?: string
}

export interface Stats {
  /** Number of iterations (outer array length). */
  n: number
  /** Number of raw samples across all iterations. */
  sampleCount: number
  min: number
  max: number
  mean: number
  median: number
  stdDev: number
  /** Coefficient of variation (stdDev / mean). 0 when mean is 0. */
  cv: number
  p50: number
  p90: number
  p95: number
  p99: number
}

export interface Metric {
  /** Raw metric name as emitted, e.g. "frameDurationCpuMs". */
  name: string
  kind: MetricKind
  unit: Unit
  lowerIsBetter: boolean
  /**
   * Per-iteration samples. `measured` metrics yield one value per iteration
   * (`[[v], [v], ...]`); `sampled` metrics yield many (`[[s, s, ...], ...]`).
   * Normalizing both to the same shape lets every downstream view treat them
   * identically.
   */
  iterations: number[][]
  /** `iterations` flattened. Percentiles are computed over this. */
  samples: number[]
  stats: Stats
  /**
   * Coefficient of variation *between* iterations — the run-to-run
   * reproducibility signal. See `betweenIterationCv` for why this is not
   * `stats.cv`.
   */
  betweenIterationCv: number
  /** Summary values as reported by the tool itself, kept for provenance. */
  reported: {
    minimum?: number
    maximum?: number
    median?: number
    p50?: number
    p90?: number
    p95?: number
    p99?: number
  }
  /**
   * True when no `runs` array was present and stats had to be derived from the
   * reported summary alone. Distribution views are meaningless for these.
   */
  synthesized: boolean
}

export interface ProfilerOutput {
  label: string
  filename: string
  type: string
}

export interface Benchmark {
  /**
   * Stable identity across files: `className#name[sorted,params]`.
   * Comparison and trend join on this, so it must not depend on array order.
   */
  key: string
  name: string
  className: string
  params: Record<string, string>
  totalRunTimeNs: number | null
  warmupIterations: number | null
  repeatIterations: number | null
  thermalThrottleSleepSeconds: number | null
  metrics: Metric[]
  profilerOutputs: ProfilerOutput[]
}

export interface DeviceContext {
  brand: string | null
  device: string | null
  model: string | null
  fingerprint: string | null
  sdk: number | null
  cpuCoreCount: number | null
  cpuLocked: boolean | null
  cpuMaxFreqHz: number | null
  memTotalBytes: number | null
  sustainedPerformanceModeEnabled: boolean | null
  artMainlineVersion: number | string | null
  osCodenameAbbreviated: string | null
}

export type RunSource = 'file' | 'url' | 'demo'

export interface BenchmarkRun {
  /** Content hash of the source JSON — used to dedupe accidental re-drops. */
  id: string
  /** User-editable display name; defaults to the filename. */
  label: string
  /**
   * benchmarkData.json carries no timestamp, so this comes from
   * `File.lastModified`. Trend ordering depends on it and users can override.
   */
  capturedAt: number
  source: RunSource
  /**
   * The original file text, retained so a run can be re-shared or re-exported
   * without the app having to reconstruct JSON from the parsed model.
   */
  sourceText: string
  context: DeviceContext
  benchmarks: Benchmark[]
  issues: Issue[]
}
