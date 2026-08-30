import { useMemo, useState } from 'react'
import { compareRuns, sortByImpact, type MetricComparison, type Verdict } from '../../core/compare'
import { formatPercentDelta, formatValue } from '../../core/units'
import type { BenchmarkRun } from '../../core/types'
import { useStore } from '../state/store'
import { IssueList } from './IssueList'

const VERDICT_STYLE: Record<Verdict, string> = {
  regressed: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300',
  improved: 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300',
  unchanged: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
  inconclusive: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  'baseline-only': 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
  'candidate-only': 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
}

export function CompareView({
  baseline,
  candidate,
}: {
  baseline: BenchmarkRun
  candidate: BenchmarkRun
}) {
  const { state, dispatch } = useStore()
  const [hideUnchanged, setHideUnchanged] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)

  const report = useMemo(
    () => compareRuns(baseline, candidate, state.compareOptions),
    [baseline, candidate, state.compareOptions],
  )

  const rows = useMemo(() => {
    const sorted = sortByImpact(report.comparisons)
    return hideUnchanged ? sorted.filter((c) => c.verdict !== 'unchanged') : sorted
  }, [report, hideUnchanged])

  const o = state.compareOptions
  const s = report.summary

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <p className="text-sm">
          <span className="text-slate-500 dark:text-slate-400">Baseline</span>{' '}
          <strong>{baseline.label}</strong>
          <span className="mx-2 text-slate-400">→</span>
          <span className="text-slate-500 dark:text-slate-400">Candidate</span>{' '}
          <strong>{candidate.label}</strong>
        </p>

        <div className="mt-3 flex flex-wrap gap-1.5">
          <Chip label="regressed" count={s.regressed} tone="bad" />
          <Chip label="improved" count={s.improved} tone="good" />
          <Chip label="unchanged" count={s.unchanged} tone="muted" />
          <Chip label="inconclusive" count={s.inconclusive} tone="warn" />
          {s.missing > 0 && <Chip label="only in one run" count={s.missing} tone="muted" />}
        </div>

        {report.warnings.length > 0 && (
          <div className="mt-3">
            <IssueList issues={report.warnings} />
          </div>
        )}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <details>
          <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Thresholds
          </summary>
          <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Slider
              label="Minimum change"
              hint="Deltas smaller than this are called unchanged."
              value={o.minDeltaPct * 100}
              min={1}
              max={50}
              step={1}
              suffix="%"
              onChange={(v) => dispatch({ type: 'compare/options', options: { minDeltaPct: v / 100 } })}
            />
            <Slider
              label="Significance (α)"
              hint="Maximum p-value for a verdict."
              value={o.alpha * 100}
              min={1}
              max={20}
              step={1}
              suffix="%"
              onChange={(v) => dispatch({ type: 'compare/options', options: { alpha: v / 100 } })}
            />
            <Slider
              label="Max baseline CV"
              hint="Run-to-run noise above this makes a verdict untrustworthy."
              value={o.maxCv * 100}
              min={1}
              max={50}
              step={1}
              suffix="%"
              onChange={(v) => dispatch({ type: 'compare/options', options: { maxCv: v / 100 } })}
            />
            <Slider
              label="Minimum iterations"
              hint="Fewer than this per side and no verdict is given."
              value={o.minIterations}
              min={2}
              max={20}
              step={1}
              suffix=""
              onChange={(v) => dispatch({ type: 'compare/options', options: { minIterations: v } })}
            />
          </div>
        </details>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Metrics</h2>
          <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
            <input
              type="checkbox"
              checked={hideUnchanged}
              onChange={(e) => setHideUnchanged(e.target.checked)}
              className="rounded"
            />
            Hide unchanged
          </label>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800">
                <th scope="col" className="pb-2 text-left font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Benchmark / metric
                </th>
                {['Baseline', 'Candidate', 'Δ median', 'Δ P90', 'Δ P99', 'p', "Cliff's δ"].map((h) => (
                  <th key={h} scope="col" className="pb-2 text-right font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    {h}
                  </th>
                ))}
                <th scope="col" className="pb-2 pl-4 text-left font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Verdict
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => {
                const id = `${c.benchmarkKey}::${c.metricName}`
                return (
                  <CompareRow
                    key={id}
                    c={c}
                    expanded={expanded === id}
                    onToggle={() => setExpanded(expanded === id ? null : id)}
                  />
                )
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={9} className="py-6 text-center text-slate-500 dark:text-slate-400">
                    Nothing to show with the current filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <p className="mt-3 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
          Significance is a two-sided Mann-Whitney U test over per-iteration medians — frames
          within one iteration are correlated, so pooling them would inflate the result. Cliff's δ
          is the effect size; a change can be statistically detectable and still too small to care
          about. A <strong>tail</strong> badge means a high percentile moved far more than the
          median did — the typical case held but the slowest cases got worse, which is what a jank
          regression looks like.
        </p>
      </section>
    </div>
  )
}

function CompareRow({
  c,
  expanded,
  onToggle,
}: {
  c: MetricComparison
  expanded: boolean
  onToggle: () => void
}) {
  const f = (v: number | null | undefined) => (v == null ? '—' : formatValue(v, c.unit))
  const deltaTone =
    c.verdict === 'regressed'
      ? 'text-red-600 dark:text-red-400'
      : c.verdict === 'improved'
        ? 'text-green-600 dark:text-green-400'
        : ''

  return (
    <>
      <tr className="border-b border-slate-100 dark:border-slate-800/60">
        <th scope="row" className="py-2 text-left font-medium">
          {c.benchmarkName}
          {Object.keys(c.params).length > 0 && (
            <span className="ml-1 font-normal text-slate-400">
              [{Object.entries(c.params).map(([k, v]) => `${k}=${v}`).join(',')}]
            </span>
          )}
          <span className="block font-mono text-[11px] font-normal text-slate-500 dark:text-slate-400">
            {c.metricName}
          </span>
        </th>
        <td className="tnum py-2 text-right">{f(c.baseline?.median)}</td>
        <td className="tnum py-2 text-right">{f(c.candidate?.median)}</td>
        <td className={`tnum py-2 text-right font-semibold ${deltaTone}`}>
          {formatPercentDelta(c.deltaPct)}
        </td>
        <td
          className={`tnum py-2 text-right ${c.tailAlert?.percentile === 'p90' ? 'font-semibold text-amber-600 dark:text-amber-400' : ''}`}
        >
          {formatPercentDelta(c.percentileDeltas.p90)}
        </td>
        <td
          className={`tnum py-2 text-right ${c.tailAlert?.percentile === 'p99' ? 'font-semibold text-amber-600 dark:text-amber-400' : ''}`}
        >
          {formatPercentDelta(c.percentileDeltas.p99)}
        </td>
        <td className="tnum py-2 text-right">{c.pValue == null ? '—' : c.pValue.toFixed(4)}</td>
        <td className="tnum py-2 text-right">
          {c.cliffsDelta == null ? '—' : c.cliffsDelta.toFixed(2)}
          {c.effectMagnitude && (
            <span className="block text-[10px] text-slate-400">{c.effectMagnitude}</span>
          )}
        </td>
        <td className="py-2 pl-4">
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={expanded}
            className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${VERDICT_STYLE[c.verdict]}`}
          >
            {c.verdict}
          </button>
          {c.tailAlert && (
            <span
              title={`${c.tailAlert.percentile.toUpperCase()} moved ${(c.tailAlert.deltaPct * 100).toFixed(1)}% — far more than the median`}
              className="ml-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300"
            >
              tail {c.tailAlert.percentile.toUpperCase()}
            </span>
          )}
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={9} className="bg-slate-50 px-3 py-2 dark:bg-slate-950/50">
            <p className="text-[11px] leading-relaxed text-slate-600 dark:text-slate-300">
              {c.reasons.join(' ')}
            </p>
            {c.baseline && c.candidate && (
              <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-[11px] sm:grid-cols-4">
                <Detail k="Baseline iterations" v={String(c.baseline.n)} />
                <Detail k="Candidate iterations" v={String(c.candidate.n)} />
                <Detail
                  k="Baseline P95"
                  v={formatValue(c.baseline.p95, c.unit)}
                />
                <Detail
                  k="Candidate P95"
                  v={formatValue(c.candidate.p95, c.unit)}
                />
                <Detail k="Δ P95" v={formatPercentDelta(c.percentileDeltas.p95)} />
                <Detail
                  k="Absolute Δ"
                  v={c.deltaMedian == null ? '—' : formatValue(c.deltaMedian, c.unit)}
                />
                <Detail k="Direction" v={c.lowerIsBetter ? 'lower is better' : 'higher is better'} />
              </dl>
            )}
          </td>
        </tr>
      )}
    </>
  )
}

function Detail({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-slate-500 dark:text-slate-400">{k}</dt>
      <dd className="tnum font-medium">{v}</dd>
    </div>
  )
}

function Chip({
  label,
  count,
  tone,
}: {
  label: string
  count: number
  tone: 'good' | 'bad' | 'warn' | 'muted'
}) {
  const styles = {
    good: 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300',
    bad: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300',
    warn: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
    muted: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
  }[tone]
  return (
    <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${styles}`}>
      {count} {label}
    </span>
  )
}

function Slider({
  label,
  hint,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
}: {
  label: string
  hint: string
  value: number
  min: number
  max: number
  step: number
  suffix: string
  onChange: (v: number) => void
}) {
  return (
    <label className="block text-xs">
      <span className="flex items-baseline justify-between">
        <span className="font-medium">{label}</span>
        <span className="tnum text-slate-500 dark:text-slate-400">
          {value}
          {suffix}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 w-full accent-blue-600"
      />
      <span className="mt-0.5 block text-[10px] leading-snug text-slate-500 dark:text-slate-400">
        {hint}
      </span>
    </label>
  )
}
