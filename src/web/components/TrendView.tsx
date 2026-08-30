import { useMemo, useState } from 'react'
import type { ChartConfiguration } from 'chart.js'
import { buildTrend, sortByDrift, type TrendSeries } from '../../core/trend'
import { formatPercentDelta, formatValue } from '../../core/units'
import type { BenchmarkRun } from '../../core/types'
import { Chart, chartColors, useIsDark } from './Chart'

export function TrendView({ runs }: { runs: BenchmarkRun[] }) {
  const [showFlaky, setShowFlaky] = useState(true)
  const series = useMemo(() => sortByDrift(buildTrend(runs)), [runs])
  const visible = showFlaky ? series : series.filter((s) => !s.flaky)

  if (runs.length < 2) {
    return (
      <p className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
        Load at least two runs to see a trend. Drop a folder of{' '}
        <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">benchmarkData.json</code>{' '}
        files to add several at once.
      </p>
    )
  }

  const flakyCount = series.filter((s) => s.flaky).length

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold">{series.length} metric series across {runs.length} runs</h2>
            <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
              Ordered by file modification time — benchmarkData.json carries no timestamp of its
              own. Rename a run above if the order looks wrong.
            </p>
          </div>
          {flakyCount > 0 && (
            <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
              <input
                type="checkbox"
                checked={showFlaky}
                onChange={(e) => setShowFlaky(e.target.checked)}
                className="rounded"
              />
              Show {flakyCount} flaky series
            </label>
          )}
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        {visible.map((s) => (
          <TrendCard key={`${s.benchmarkKey}::${s.metricName}`} series={s} />
        ))}
      </div>
    </div>
  )
}

function TrendCard({ series }: { series: TrendSeries }) {
  const dark = useIsDark()
  const colors = chartColors(dark)

  const config = useMemo<ChartConfiguration>(() => {
    const labels = series.points.map((p) => p.label)
    const medians = series.points.map((p) => p.stats?.median ?? null)
    const p90 = series.points.map((p) => p.stats?.p90 ?? null)
    return {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'P90',
            data: p90,
            borderColor: 'transparent',
            backgroundColor: 'rgba(59,130,246,0.12)',
            fill: 'origin',
            pointRadius: 0,
            tension: 0.2,
          },
          {
            label: 'Median',
            data: medians,
            borderColor: colors.series[0],
            backgroundColor: colors.series[0],
            pointRadius: 3,
            tension: 0.2,
            spanGaps: false,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        scales: {
          x: { grid: { color: colors.grid }, ticks: { color: colors.text, maxRotation: 45 } },
          y: { grid: { color: colors.grid }, ticks: { color: colors.text } },
        },
        plugins: { legend: { labels: { color: colors.text, boxWidth: 12 } } },
      },
    }
  }, [series, colors.grid, colors.text, colors.series])

  const driftTone =
    series.netChange == null
      ? ''
      : (series.lowerIsBetter ? series.netChange > 0.05 : series.netChange < -0.05)
        ? 'text-red-600 dark:text-red-400'
        : (series.lowerIsBetter ? series.netChange < -0.05 : series.netChange > 0.05)
          ? 'text-green-600 dark:text-green-400'
          : 'text-slate-500 dark:text-slate-400'

  const last = [...series.points].reverse().find((p) => p.stats)?.stats

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <header className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold">{series.metricName}</h3>
          <p className="truncate text-[11px] text-slate-500 dark:text-slate-400">
            {series.benchmarkName}
            {Object.keys(series.params).length > 0 &&
              ` [${Object.entries(series.params).map(([k, v]) => `${k}=${v}`).join(',')}]`}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className={`tnum text-sm font-semibold ${driftTone}`}>
            {formatPercentDelta(series.netChange)}
          </p>
          <p className="text-[10px] text-slate-400">
            {last ? formatValue(last.median, series.unit) : '—'} now
          </p>
        </div>
      </header>

      {series.flaky && (
        <p className="mb-2 rounded bg-amber-50 px-2 py-1 text-[11px] text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
          Flaky: most runs of this metric are not reproducible run-to-run, so the trend line is
          mostly noise.
        </p>
      )}
      {series.coverage < series.points.length && (
        <p className="mb-2 text-[11px] text-slate-500 dark:text-slate-400">
          Missing from {series.points.length - series.coverage} of {series.points.length} runs.
        </p>
      )}

      <Chart config={config} height={200} ariaLabel={`${series.metricName} over time`} />
    </section>
  )
}
