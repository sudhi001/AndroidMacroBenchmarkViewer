import { useMemo, useState } from 'react'
import type { ChartConfiguration } from 'chart.js'
import { NOISY_CV_THRESHOLD } from '../../core/parse'
import { formatValue } from '../../core/units'
import type { Benchmark, Metric } from '../../core/types'
import { Chart, chartColors, useIsDark } from './Chart'

const COLUMNS = ['Metric', 'n', 'Median', 'Mean', 'Min', 'Max', 'P90', 'P95', 'P99', 'CV'] as const

export function BenchmarkPanel({ benchmark }: { benchmark: Benchmark }) {
  const [expanded, setExpanded] = useState<string | null>(null)
  const params = Object.entries(benchmark.params)
    .map(([k, v]) => `${k}=${v}`)
    .join(', ')

  const meta = [
    benchmark.repeatIterations != null ? `${benchmark.repeatIterations} iterations` : null,
    benchmark.warmupIterations != null ? `${benchmark.warmupIterations} warmup` : null,
    benchmark.thermalThrottleSleepSeconds
      ? `${benchmark.thermalThrottleSleepSeconds}s thermal sleep`
      : null,
    benchmark.totalRunTimeNs != null
      ? `${formatValue(benchmark.totalRunTimeNs, 'ns')} total`
      : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <header className="mb-3">
        <h3 className="flex flex-wrap items-baseline gap-2 text-sm font-semibold">
          {benchmark.name}
          {params && (
            <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] font-normal text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              {params}
            </span>
          )}
        </h3>
        <p className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
          {benchmark.className}
        </p>
        {meta && <p className="mt-0.5 text-[11px] text-slate-400 dark:text-slate-500">{meta}</p>}
      </header>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-xs">
          <thead>
            <tr className="border-b border-slate-200 dark:border-slate-800">
              {COLUMNS.map((c) => (
                <th
                  key={c}
                  scope="col"
                  className={`pb-2 font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 ${
                    c === 'Metric' ? 'text-left' : 'text-right'
                  }`}
                >
                  {c}
                </th>
              ))}
              <th className="pb-2" />
            </tr>
          </thead>
          <tbody>
            {benchmark.metrics.map((m) => (
              <MetricRow
                key={m.name}
                metric={m}
                expanded={expanded === m.name}
                onToggle={() => setExpanded(expanded === m.name ? null : m.name)}
              />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function MetricRow({
  metric,
  expanded,
  onToggle,
}: {
  metric: Metric
  expanded: boolean
  onToggle: () => void
}) {
  const s = metric.stats
  const f = (v: number) => formatValue(v, metric.unit)
  const noisy = metric.betweenIterationCv > NOISY_CV_THRESHOLD

  return (
    <>
      <tr className="border-b border-slate-100 last:border-0 dark:border-slate-800/60">
        <th scope="row" className="py-2 text-left font-medium">
          {metric.name}
          <span className="ml-2 rounded bg-slate-100 px-1 py-px text-[10px] font-normal text-slate-500 dark:bg-slate-800 dark:text-slate-400">
            {metric.kind}
          </span>
          {metric.synthesized && (
            <span className="ml-1 text-[10px] font-normal text-amber-600 dark:text-amber-400">
              summary only
            </span>
          )}
        </th>
        <td className="tnum py-2 text-right text-slate-500 dark:text-slate-400">
          {s.n}
          {metric.kind === 'sampled' && (
            <span className="block text-[10px]">{s.sampleCount.toLocaleString()} samples</span>
          )}
        </td>
        <td className="tnum py-2 text-right font-semibold">{f(s.median)}</td>
        <td className="tnum py-2 text-right">{f(s.mean)}</td>
        <td className="tnum py-2 text-right">{f(s.min)}</td>
        <td className="tnum py-2 text-right">{f(s.max)}</td>
        <td className="tnum py-2 text-right">{f(s.p90)}</td>
        <td className="tnum py-2 text-right">{f(s.p95)}</td>
        <td className="tnum py-2 text-right">{f(s.p99)}</td>
        <td
          className={`tnum py-2 text-right ${noisy ? 'font-semibold text-amber-600 dark:text-amber-400' : ''}`}
          title="Between-iteration coefficient of variation: run-to-run reproducibility"
        >
          {Number.isFinite(metric.betweenIterationCv)
            ? `${(metric.betweenIterationCv * 100).toFixed(1)}%`
            : '—'}
        </td>
        <td className="py-2 text-right">
          {!metric.synthesized && (
            <button
              type="button"
              onClick={onToggle}
              aria-expanded={expanded}
              className="rounded px-2 py-0.5 text-[11px] text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950/40"
            >
              {expanded ? 'Hide' : 'Distribution'}
            </button>
          )}
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={COLUMNS.length + 1} className="pb-4">
            <MetricDetail metric={metric} />
          </td>
        </tr>
      )}
    </>
  )
}

function MetricDetail({ metric }: { metric: Metric }) {
  const dark = useIsDark()
  const colors = chartColors(dark)

  const perIteration = useMemo<ChartConfiguration>(() => {
    const labels = metric.iterations.map((_, i) => `#${i + 1}`)
    const medians = metric.iterations.map((it) =>
      it.length === 1 ? it[0]! : [...it].sort((a, b) => a - b)[Math.floor(it.length / 2)]!,
    )
    return {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: metric.kind === 'sampled' ? 'Iteration median' : 'Value',
            data: medians,
            borderColor: colors.series[0],
            backgroundColor: colors.series[0],
            pointRadius: 3,
            tension: 0.15,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { grid: { color: colors.grid }, ticks: { color: colors.text } },
          y: { grid: { color: colors.grid }, ticks: { color: colors.text } },
        },
        plugins: { legend: { labels: { color: colors.text } } },
      },
    }
  }, [metric, colors.grid, colors.text, colors.series])

  const distribution = useMemo<ChartConfiguration>(
    () =>
      ({
        type: 'boxplot',
        data: {
          labels: metric.iterations.map((_, i) => `#${i + 1}`),
          datasets: [
            {
              label: metric.name,
              data: metric.iterations,
              borderColor: colors.series[0],
              backgroundColor: 'rgba(59,130,246,0.25)',
              outlierBackgroundColor: colors.series[4],
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            x: { grid: { color: colors.grid }, ticks: { color: colors.text } },
            y: { grid: { color: colors.grid }, ticks: { color: colors.text } },
          },
          plugins: { legend: { display: false } },
        },
      }) as unknown as ChartConfiguration,
    [metric, colors.grid, colors.text, colors.series],
  )

  return (
    <div className="grid gap-4 rounded-lg bg-slate-50 p-3 lg:grid-cols-2 dark:bg-slate-950/50">
      <div>
        <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Per iteration
        </h4>
        <p className="mb-2 text-[11px] text-slate-500 dark:text-slate-400">
          A rising line means the device drifted during the run — warmup or thermal.
        </p>
        <Chart config={perIteration} height={220} ariaLabel={`${metric.name} per iteration`} />
      </div>
      {metric.kind === 'sampled' && (
        <div>
          <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Distribution within each iteration
          </h4>
          <p className="mb-2 text-[11px] text-slate-500 dark:text-slate-400">
            Outliers above the whisker are the janky frames.
          </p>
          <Chart config={distribution} height={220} ariaLabel={`${metric.name} distribution`} />
        </div>
      )}
    </div>
  )
}
