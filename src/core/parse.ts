import { betweenIterationCv, computeStats, isFiniteNumber } from './stats'
import { inferLowerIsBetter, inferUnit } from './units'
import type {
  Benchmark,
  BenchmarkRun,
  DeviceContext,
  Issue,
  Metric,
  MetricKind,
  ProfilerOutput,
  RunSource,
} from './types'

export class ParseError extends Error {}

export interface ParseInput {
  /** Raw file text. Hashed for the run id, so pass the original string. */
  text: string
  label: string
  capturedAt: number
  source?: RunSource
}

/* -------------------------------------------------------------------------- */
/*  Safe accessors                                                             */
/* -------------------------------------------------------------------------- */

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function num(v: unknown): number | null {
  return isFiniteNumber(v) ? v : null
}

function str(v: unknown): string | null {
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return null
}

function bool(v: unknown): boolean | null {
  return typeof v === 'boolean' ? v : null
}

/**
 * FNV-1a, 32-bit, doubled with a second offset basis for a wider id.
 * Only needs to be stable and collision-resistant enough to dedupe a handful of
 * dropped files, so a sync non-cryptographic hash beats an async crypto.subtle
 * call here.
 */
export function hashContent(text: string): string {
  let h1 = 0x811c9dc5
  let h2 = 0x01000193
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 0x01000193)
    h2 = Math.imul(h2 ^ c, 0x811c9dc5)
  }
  const hex = (n: number) => (n >>> 0).toString(16).padStart(8, '0')
  return hex(h1) + hex(h2)
}

/* -------------------------------------------------------------------------- */
/*  Benchmark identity                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Stable across files, which is what makes comparison and trend possible.
 * Params are sorted so key ordering in the JSON cannot change the identity.
 */
export function benchmarkKey(
  className: string,
  name: string,
  params: Record<string, string>,
): string {
  const entries = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
  return entries.length > 0 ? `${className}#${name}[${entries.join(',')}]` : `${className}#${name}`
}

/* -------------------------------------------------------------------------- */
/*  Metrics                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * `metrics` and `sampledMetrics` differ in shape: the former reports one value
 * per iteration (`runs: number[]`), the latter many (`runs: number[][]`).
 * Both are normalized to `number[][]` so every downstream view is shape-blind.
 */
function normalizeIterations(runs: unknown): number[][] {
  if (!Array.isArray(runs)) return []
  const out: number[][] = []
  for (const entry of runs) {
    if (Array.isArray(entry)) {
      out.push(entry.filter(isFiniteNumber))
    } else if (isFiniteNumber(entry)) {
      out.push([entry])
    }
  }
  return out
}

function readReported(raw: Record<string, unknown>): Metric['reported'] {
  const pick = (...keys: string[]): number | undefined => {
    for (const k of keys) {
      const v = num(raw[k])
      if (v !== null) return v
    }
    return undefined
  }
  const reported: Metric['reported'] = {}
  const minimum = pick('minimum', 'min')
  const maximum = pick('maximum', 'max')
  const med = pick('median')
  // Newer AGP versions emit percentiles directly; older ones do not, in which
  // case they are computed from the raw samples instead.
  const p50 = pick('P50', 'p50')
  const p90 = pick('P90', 'p90')
  const p95 = pick('P95', 'p95')
  const p99 = pick('P99', 'p99')
  if (minimum !== undefined) reported.minimum = minimum
  if (maximum !== undefined) reported.maximum = maximum
  if (med !== undefined) reported.median = med
  if (p50 !== undefined) reported.p50 = p50
  if (p90 !== undefined) reported.p90 = p90
  if (p95 !== undefined) reported.p95 = p95
  if (p99 !== undefined) reported.p99 = p99
  return reported
}

function parseMetric(
  name: string,
  raw: unknown,
  kind: MetricKind,
  path: string,
  issues: Issue[],
): Metric | null {
  if (!isRecord(raw)) {
    issues.push({ level: 'warning', message: `Metric "${name}" is not an object; skipped.`, path })
    return null
  }

  const reported = readReported(raw)
  let iterations = normalizeIterations(raw['runs'])
  let synthesized = false

  if (iterations.length === 0) {
    // No raw samples. Fall back to whatever summary values exist so the metric
    // still appears in tables, but mark it so distribution views can say why
    // they are empty rather than rendering a misleading flat line.
    const fallback = [reported.median, reported.minimum, reported.maximum].filter(isFiniteNumber)
    if (fallback.length === 0) {
      issues.push({
        level: 'warning',
        message: `Metric "${name}" has neither runs nor summary values; skipped.`,
        path,
      })
      return null
    }
    iterations = [fallback]
    synthesized = true
    issues.push({
      level: 'info',
      message: `Metric "${name}" has no per-iteration runs; distribution and significance are unavailable.`,
      path,
    })
  }

  const samples = iterations.flat()
  const stats = computeStats(samples, iterations.length)

  // Prefer percentiles the tool reported over ones computed here, so the app
  // agrees with the Gradle console whenever the source actually provided them.
  if (reported.p50 !== undefined) stats.p50 = reported.p50
  if (reported.p90 !== undefined) stats.p90 = reported.p90
  if (reported.p95 !== undefined) stats.p95 = reported.p95
  if (reported.p99 !== undefined) stats.p99 = reported.p99

  return {
    name,
    kind,
    unit: inferUnit(name),
    lowerIsBetter: inferLowerIsBetter(name),
    iterations,
    samples,
    stats,
    betweenIterationCv: betweenIterationCv(iterations),
    reported,
    synthesized,
  }
}

function parseMetricBag(
  bag: unknown,
  kind: MetricKind,
  path: string,
  issues: Issue[],
): Metric[] {
  if (bag === undefined || bag === null) return []
  if (!isRecord(bag)) {
    issues.push({ level: 'warning', message: `Expected an object at ${path}.`, path })
    return []
  }
  const out: Metric[] = []
  // Iterating entries is the whole point: no metric name is ever hardcoded, so
  // frame timing, startup, memory and future metrics all work without a change.
  for (const [name, raw] of Object.entries(bag)) {
    const metric = parseMetric(name, raw, kind, `${path}.${name}`, issues)
    if (metric) out.push(metric)
  }
  return out
}

function parseProfilerOutputs(raw: unknown): ProfilerOutput[] {
  if (!Array.isArray(raw)) return []
  const out: ProfilerOutput[] = []
  for (const entry of raw) {
    if (!isRecord(entry)) continue
    const filename = str(entry['filename'])
    if (!filename) continue
    out.push({
      filename,
      label: str(entry['label']) ?? filename,
      type: str(entry['type']) ?? 'unknown',
    })
  }
  return out
}

function parseParams(raw: unknown): Record<string, string> {
  if (!isRecord(raw)) return {}
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw)) {
    const s = str(v)
    if (s !== null) out[k] = s
  }
  return out
}

function parseBenchmark(raw: unknown, index: number, issues: Issue[]): Benchmark | null {
  const path = `benchmarks[${index}]`
  if (!isRecord(raw)) {
    issues.push({ level: 'warning', message: `${path} is not an object; skipped.`, path })
    return null
  }

  const name = str(raw['name']) ?? `benchmark-${index}`
  const className = str(raw['className']) ?? '(unknown class)'
  const params = parseParams(raw['params'])

  const metrics = [
    ...parseMetricBag(raw['metrics'], 'measured', `${path}.metrics`, issues),
    ...parseMetricBag(raw['sampledMetrics'], 'sampled', `${path}.sampledMetrics`, issues),
  ]

  if (metrics.length === 0) {
    issues.push({
      level: 'warning',
      message: `Benchmark "${name}" reported no usable metrics.`,
      path,
    })
  }

  return {
    key: benchmarkKey(className, name, params),
    name,
    className,
    params,
    totalRunTimeNs: num(raw['totalRunTimeNs']),
    warmupIterations: num(raw['warmupIterations']),
    repeatIterations: num(raw['repeatIterations']),
    thermalThrottleSleepSeconds: num(raw['thermalThrottleSleepSeconds']),
    metrics,
    profilerOutputs: parseProfilerOutputs(raw['profilerOutputs']),
  }
}

/* -------------------------------------------------------------------------- */
/*  Context                                                                    */
/* -------------------------------------------------------------------------- */

const UNKNOWN_CONTEXT: DeviceContext = {
  brand: null,
  device: null,
  model: null,
  fingerprint: null,
  sdk: null,
  cpuCoreCount: null,
  cpuLocked: null,
  cpuMaxFreqHz: null,
  memTotalBytes: null,
  sustainedPerformanceModeEnabled: null,
  artMainlineVersion: null,
  osCodenameAbbreviated: null,
}

function parseContext(raw: unknown, issues: Issue[]): DeviceContext {
  if (!isRecord(raw)) {
    issues.push({
      level: 'warning',
      message: 'No device context in this file; hardware details are unavailable.',
      path: 'context',
    })
    return { ...UNKNOWN_CONTEXT }
  }
  const build = isRecord(raw['build']) ? raw['build'] : {}
  const version = isRecord(build['version']) ? build['version'] : {}
  const art = raw['artMainlineVersion']

  return {
    brand: str(build['brand']),
    device: str(build['device']),
    model: str(build['model']),
    fingerprint: str(build['fingerprint']),
    sdk: num(version['sdk']),
    cpuCoreCount: num(raw['cpuCoreCount']),
    cpuLocked: bool(raw['cpuLocked']),
    cpuMaxFreqHz: num(raw['cpuMaxFreqHz']),
    memTotalBytes: num(raw['memTotalBytes']),
    sustainedPerformanceModeEnabled: bool(raw['sustainedPerformanceModeEnabled']),
    artMainlineVersion: isFiniteNumber(art) || typeof art === 'string' ? art : null,
    osCodenameAbbreviated: str(raw['osCodenameAbbreviated']),
  }
}

/* -------------------------------------------------------------------------- */
/*  Run-quality warnings                                                       */
/* -------------------------------------------------------------------------- */

/** CV above this is treated as too noisy to draw conclusions from. */
export const NOISY_CV_THRESHOLD = 0.1

export function runQualityIssues(context: DeviceContext, benchmarks: Benchmark[]): Issue[] {
  const issues: Issue[] = []

  if (context.cpuLocked === false) {
    issues.push({
      level: 'warning',
      message:
        'CPU clocks were not locked. Frequency scaling adds run-to-run noise; lock clocks on a rooted device or prefer a physical device at rest.',
    })
  }
  if (context.sustainedPerformanceModeEnabled === false) {
    issues.push({
      level: 'info',
      message:
        'Sustained performance mode was off. Longer runs may drift as the device heats up.',
    })
  }

  const throttled = benchmarks.filter((b) => (b.thermalThrottleSleepSeconds ?? 0) > 0)
  if (throttled.length > 0) {
    const total = throttled.reduce((sum, b) => sum + (b.thermalThrottleSleepSeconds ?? 0), 0)
    issues.push({
      level: 'warning',
      message: `Thermal throttling paused ${throttled.length} benchmark(s) for ${total}s total. Results around those pauses are suspect.`,
    })
  }

  const noisy = benchmarks.flatMap((b) =>
    b.metrics
      .filter(
        (m) =>
          !m.synthesized &&
          m.iterations.length > 1 &&
          Number.isFinite(m.betweenIterationCv) &&
          m.betweenIterationCv > NOISY_CV_THRESHOLD,
      )
      .map((m) => `${b.name}/${m.name}`),
  )
  if (noisy.length > 0) {
    const shown = noisy.slice(0, 3).join(', ')
    const rest = noisy.length > 3 ? ` and ${noisy.length - 3} more` : ''
    issues.push({
      level: 'warning',
      message: `High variance (CV > ${Math.round(NOISY_CV_THRESHOLD * 100)}%) in ${shown}${rest}. Increase iterations before trusting a comparison.`,
    })
  }

  const singleIteration = benchmarks.filter((b) =>
    b.metrics.some((m) => !m.synthesized && m.iterations.length === 1),
  )
  if (singleIteration.length > 0) {
    issues.push({
      level: 'warning',
      message: `${singleIteration.length} benchmark(s) ran a single iteration. Significance testing needs several; raise \`iterations\` in your benchmark rule.`,
    })
  }

  return issues
}

/* -------------------------------------------------------------------------- */
/*  Entry point                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Parse one benchmarkData.json into the normalized model.
 *
 * Throws only when the input is not usable at all (bad JSON, no benchmarks
 * array). Everything else — missing context, unknown metrics, absent runs —
 * degrades into an `Issue` so a partially-odd file still renders.
 */
export function parseBenchmarkFile(input: ParseInput): BenchmarkRun {
  let json: unknown
  try {
    json = JSON.parse(input.text)
  } catch (err) {
    throw new ParseError(
      `Not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    )
  }

  if (!isRecord(json)) {
    throw new ParseError('Expected a JSON object at the top level.')
  }

  const rawBenchmarks = json['benchmarks']
  if (!Array.isArray(rawBenchmarks)) {
    throw new ParseError(
      'No "benchmarks" array found. Expected an Android benchmarkData.json file — ' +
        'look for it under build/outputs/connected_android_test_additional_output/.',
    )
  }

  const issues: Issue[] = []
  const context = parseContext(json['context'], issues)
  const benchmarks = rawBenchmarks
    .map((raw, i) => parseBenchmark(raw, i, issues))
    .filter((b): b is Benchmark => b !== null)

  if (benchmarks.length === 0) {
    throw new ParseError('The "benchmarks" array is empty — nothing to show.')
  }

  issues.push(...runQualityIssues(context, benchmarks))

  return {
    id: hashContent(input.text),
    label: input.label,
    capturedAt: input.capturedAt,
    source: input.source ?? 'file',
    sourceText: input.text,
    context,
    benchmarks,
    issues,
  }
}

/** Every distinct `Benchmark.key` in a set of runs, in first-seen order. */
export function allBenchmarkKeys(runs: BenchmarkRun[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const run of runs) {
    for (const b of run.benchmarks) {
      if (!seen.has(b.key)) {
        seen.add(b.key)
        out.push(b.key)
      }
    }
  }
  return out
}
