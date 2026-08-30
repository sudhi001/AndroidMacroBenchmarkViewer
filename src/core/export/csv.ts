import type { ComparisonReport } from '../compare'
import type { BenchmarkRun } from '../types'

function cell(value: unknown): string {
  if (value === null || value === undefined) return ''
  const s = String(value)
  // Guard against a metric name or label starting with =, +, - or @ being
  // interpreted as a formula when the file is opened in a spreadsheet.
  //
  // Numbers are exempt: nearly every delta in a comparison is negative, and
  // prefixing those would turn the whole column into text.
  const looksLikeFormula = /^[=+\-@\t\r]/.test(s) && !isNumeric(s)
  const escaped = looksLikeFormula ? `'${s}` : s
  return /[",\n\r]/.test(escaped) ? `"${escaped.replace(/"/g, '""')}"` : escaped
}

function isNumeric(s: string): boolean {
  return s.trim() !== '' && Number.isFinite(Number(s))
}

function row(values: unknown[]): string {
  return values.map(cell).join(',')
}

function fixed(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? '' : String(Number(value.toFixed(6)))
}

const RUN_HEADERS = [
  'run',
  'device',
  'benchmark',
  'class',
  'params',
  'metric',
  'unit',
  'kind',
  'iterations',
  'samples',
  'min',
  'median',
  'mean',
  'max',
  'p50',
  'p90',
  'p95',
  'p99',
  'stdDev',
  'cv',
  'betweenIterationCv',
]

/** One row per (run, benchmark, metric) — the shape people pivot in a sheet. */
export function runsToCsv(runs: BenchmarkRun[]): string {
  const lines = [row(RUN_HEADERS)]
  for (const run of runs) {
    for (const b of run.benchmarks) {
      for (const m of b.metrics) {
        lines.push(
          row([
            run.label,
            run.context.model ?? '',
            b.name,
            b.className,
            Object.entries(b.params)
              .map(([k, v]) => `${k}=${v}`)
              .join(';'),
            m.name,
            m.unit,
            m.kind,
            m.stats.n,
            m.stats.sampleCount,
            fixed(m.stats.min),
            fixed(m.stats.median),
            fixed(m.stats.mean),
            fixed(m.stats.max),
            fixed(m.stats.p50),
            fixed(m.stats.p90),
            fixed(m.stats.p95),
            fixed(m.stats.p99),
            fixed(m.stats.stdDev),
            fixed(m.stats.cv),
            fixed(m.betweenIterationCv),
          ]),
        )
      }
    }
  }
  return lines.join('\n')
}

const COMPARE_HEADERS = [
  'benchmark',
  'class',
  'params',
  'metric',
  'unit',
  'verdict',
  'baselineMedian',
  'candidateMedian',
  'deltaAbsolute',
  'deltaPct',
  'deltaP90Pct',
  'deltaP95Pct',
  'deltaP99Pct',
  'pValue',
  'cliffsDelta',
  'effect',
  'baselineIterations',
  'candidateIterations',
  'reasons',
]

export function comparisonToCsv(report: ComparisonReport): string {
  const lines = [row(COMPARE_HEADERS)]
  for (const c of report.comparisons) {
    lines.push(
      row([
        c.benchmarkName,
        c.className,
        Object.entries(c.params)
          .map(([k, v]) => `${k}=${v}`)
          .join(';'),
        c.metricName,
        c.unit,
        c.verdict,
        fixed(c.baseline?.median),
        fixed(c.candidate?.median),
        fixed(c.deltaMedian),
        fixed(c.deltaPct),
        fixed(c.percentileDeltas.p90),
        fixed(c.percentileDeltas.p95),
        fixed(c.percentileDeltas.p99),
        fixed(c.pValue),
        fixed(c.cliffsDelta),
        c.effectMagnitude ?? '',
        c.baseline?.n ?? '',
        c.candidate?.n ?? '',
        c.reasons.join(' '),
      ]),
    )
  }
  return lines.join('\n')
}
