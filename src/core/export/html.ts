import type { ComparisonReport, MetricComparison } from '../compare'
import { sortByImpact } from '../compare'
import { formatPercentDelta, formatValue } from '../units'
import type { Benchmark, BenchmarkRun, Issue, Metric } from '../types'

export interface ReportInput {
  runs: BenchmarkRun[]
  comparison?: ComparisonReport | null
  generatedAt: number
}

/**
 * Escape for HTML text and quoted attributes alike.
 *
 * Every value here originates in a user-supplied JSON file, so nothing reaches
 * the output without passing through this.
 */
export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const e = escapeHtml

/* -------------------------------------------------------------------------- */
/*  Inline SVG — no chart library, so the file stays small and offline-safe    */
/* -------------------------------------------------------------------------- */

/** Box-and-whisker across a metric's samples, drawn as bare SVG. */
function boxPlot(metric: Metric, width = 260, height = 44): string {
  const s = metric.stats
  if (!Number.isFinite(s.min) || !Number.isFinite(s.max)) return ''
  const lo = s.min
  const hi = s.max
  const span = hi - lo || 1
  const x = (v: number) => ((v - lo) / span) * (width - 8) + 4
  const mid = height / 2
  const q1 = x(s.p50 - (s.p50 - s.min) / 2)
  const q3 = x(s.p90)
  return [
    `<svg class="box" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="distribution">`,
    `<line x1="${x(lo).toFixed(1)}" y1="${mid}" x2="${x(hi).toFixed(1)}" y2="${mid}" class="whisker"/>`,
    `<rect x="${q1.toFixed(1)}" y="${mid - 9}" width="${Math.max(1, q3 - q1).toFixed(1)}" height="18" class="boxrect"/>`,
    `<line x1="${x(s.median).toFixed(1)}" y1="${mid - 11}" x2="${x(s.median).toFixed(1)}" y2="${mid + 11}" class="medline"/>`,
    `</svg>`,
  ].join('')
}

/** Per-iteration line, so warmup drift and single outliers stay visible. */
function sparkline(metric: Metric, width = 260, height = 44): string {
  const values = metric.iterations.map((it) =>
    it.length === 1 ? it[0]! : it.reduce((a, b) => a + b, 0) / it.length,
  )
  if (values.length < 2) return ''
  const lo = Math.min(...values)
  const hi = Math.max(...values)
  const span = hi - lo || 1
  const points = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * (width - 8) + 4
      const y = height - 6 - ((v - lo) / span) * (height - 14)
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
  return `<svg class="spark" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="per-iteration values"><polyline points="${points}"/></svg>`
}

/* -------------------------------------------------------------------------- */
/*  Fragments                                                                  */
/* -------------------------------------------------------------------------- */

function issueList(issues: Issue[]): string {
  if (issues.length === 0) return ''
  return `<ul class="issues">${issues
    .map((i) => `<li class="issue ${e(i.level)}"><span>${e(i.level)}</span>${e(i.message)}</li>`)
    .join('')}</ul>`
}

function contextTable(run: BenchmarkRun): string {
  const c = run.context
  const rows: Array<[string, string]> = [
    ['Model', c.model ?? '—'],
    ['Brand / device', [c.brand, c.device].filter(Boolean).join(' / ') || '—'],
    ['Android SDK', c.sdk != null ? String(c.sdk) : '—'],
    ['CPU cores', c.cpuCoreCount != null ? String(c.cpuCoreCount) : '—'],
    ['CPU max freq', formatValue(c.cpuMaxFreqHz, 'hz')],
    ['CPU locked', c.cpuLocked == null ? '—' : c.cpuLocked ? 'yes' : 'no'],
    ['Sustained perf', c.sustainedPerformanceModeEnabled == null ? '—' : c.sustainedPerformanceModeEnabled ? 'on' : 'off'],
    ['Memory', formatValue(c.memTotalBytes, 'bytes')],
    ['Fingerprint', c.fingerprint ?? '—'],
  ]
  return `<table class="kv">${rows
    .map(([k, v]) => `<tr><th>${e(k)}</th><td>${e(v)}</td></tr>`)
    .join('')}</table>`
}

const METRIC_COLUMNS = ['Metric', 'n', 'Median', 'Mean', 'Min', 'Max', 'P90', 'P95', 'P99', 'CV', 'Distribution', 'Per iteration']

function metricRows(benchmark: Benchmark): string {
  return benchmark.metrics
    .map((m) => {
      const s = m.stats
      const f = (v: number) => e(formatValue(v, m.unit))
      const cv = Number.isFinite(m.betweenIterationCv)
        ? `${(m.betweenIterationCv * 100).toFixed(1)}%`
        : '—'
      return `<tr>
        <td class="name">${e(m.name)}<span class="kind">${e(m.kind)}</span></td>
        <td class="num">${s.n}${m.kind === 'sampled' ? `<span class="sub">${s.sampleCount} samples</span>` : ''}</td>
        <td class="num strong">${f(s.median)}</td>
        <td class="num">${f(s.mean)}</td>
        <td class="num">${f(s.min)}</td>
        <td class="num">${f(s.max)}</td>
        <td class="num">${f(s.p90)}</td>
        <td class="num">${f(s.p95)}</td>
        <td class="num">${f(s.p99)}</td>
        <td class="num ${m.betweenIterationCv > 0.1 ? 'warn' : ''}">${e(cv)}</td>
        <td>${m.synthesized ? '<span class="muted">summary only</span>' : boxPlot(m)}</td>
        <td>${m.synthesized ? '' : sparkline(m)}</td>
      </tr>`
    })
    .join('')
}

function benchmarkSection(b: Benchmark): string {
  const params = Object.entries(b.params)
    .map(([k, v]) => `${k}=${v}`)
    .join(', ')
  const meta = [
    b.repeatIterations != null ? `${b.repeatIterations} iterations` : null,
    b.warmupIterations != null ? `${b.warmupIterations} warmup` : null,
    b.thermalThrottleSleepSeconds ? `${b.thermalThrottleSleepSeconds}s thermal sleep` : null,
    b.totalRunTimeNs != null ? `${formatValue(b.totalRunTimeNs, 'ns')} total` : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return `<section class="benchmark">
    <h3>${e(b.name)}${params ? `<span class="params">${e(params)}</span>` : ''}</h3>
    <p class="cls">${e(b.className)}</p>
    ${meta ? `<p class="meta">${e(meta)}</p>` : ''}
    <div class="scroll"><table class="metrics">
      <thead><tr>${METRIC_COLUMNS.map((c) => `<th>${e(c)}</th>`).join('')}</tr></thead>
      <tbody>${metricRows(b)}</tbody>
    </table></div>
  </section>`
}

function comparisonSection(report: ComparisonReport): string {
  const s = report.summary
  const chips = [
    ['regressed', s.regressed],
    ['improved', s.improved],
    ['unchanged', s.unchanged],
    ['inconclusive', s.inconclusive],
    ['missing', s.missing],
  ]
    .map(([k, v]) => `<span class="chip ${e(k)}">${e(v)} ${e(k)}</span>`)
    .join('')

  const rows = sortByImpact(report.comparisons)
    .map((c: MetricComparison) => {
      const f = (v: number | null | undefined) =>
        v == null ? '—' : e(formatValue(v, c.unit))
      return `<tr class="v-${e(c.verdict)}">
        <td class="name">${e(c.benchmarkName)}<span class="sub">${e(c.metricName)}</span></td>
        <td class="num">${f(c.baseline?.median)}</td>
        <td class="num">${f(c.candidate?.median)}</td>
        <td class="num strong">${e(formatPercentDelta(c.deltaPct))}</td>
        <td class="num">${e(formatPercentDelta(c.percentileDeltas.p90))}</td>
        <td class="num">${e(formatPercentDelta(c.percentileDeltas.p99))}</td>
        <td class="num">${c.pValue == null ? '—' : e(c.pValue.toFixed(4))}</td>
        <td class="num">${c.cliffsDelta == null ? '—' : e(c.cliffsDelta.toFixed(2))}</td>
        <td><span class="verdict ${e(c.verdict)}">${e(c.verdict)}</span>${
          c.tailAlert
            ? `<span class="verdict tail">tail ${e(c.tailAlert.percentile.toUpperCase())}</span>`
            : ''
        }</td>
        <td class="reason">${e(c.reasons.join(' '))}</td>
      </tr>`
    })
    .join('')

  const o = report.options
  return `<section class="compare">
    <h2>Comparison</h2>
    <p class="sub">
      Baseline <strong>${e(report.baselineLabel)}</strong> → candidate <strong>${e(report.candidateLabel)}</strong>
    </p>
    <p class="chips">${chips}</p>
    ${issueList(report.warnings)}
    <div class="scroll"><table class="metrics">
      <thead><tr>
        <th>Benchmark / metric</th><th>Baseline</th><th>Candidate</th><th>Δ median</th>
        <th>Δ P90</th><th>Δ P99</th><th>p</th><th>Cliff's δ</th><th>Verdict</th><th>Why</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    <p class="fineprint">
      Thresholds: ${(o.minDeltaPct * 100).toFixed(0)}% minimum change, α = ${o.alpha},
      max between-iteration CV ${(o.maxCv * 100).toFixed(0)}%, minimum ${o.minIterations} iterations.
      Significance is a two-sided Mann-Whitney U test over per-iteration medians.
      A &ldquo;tail&rdquo; badge means a high percentile moved far more than the median &mdash;
      the typical case held but the slowest cases got worse.
    </p>
  </section>`
}

/* -------------------------------------------------------------------------- */
/*  Styles                                                                     */
/* -------------------------------------------------------------------------- */

const STYLES = `
:root{--bg:#f7f8fa;--card:#fff;--fg:#16181d;--muted:#666d7a;--line:#e2e5ea;
--good:#0a7d3f;--bad:#c02626;--warn:#a35c00;--accent:#1d4ed8;--chip:#eef1f6}
@media(prefers-color-scheme:dark){:root{--bg:#0f1115;--card:#171a21;--fg:#e7e9ee;
--muted:#98a0ae;--line:#272c36;--good:#4ade80;--bad:#f87171;--warn:#fbbf24;--accent:#7aa2ff;--chip:#212630}}
*{box-sizing:border-box}
body{margin:0;padding:32px 20px;background:var(--bg);color:var(--fg);
font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
.wrap{max-width:1200px;margin:0 auto}
h1{font-size:22px;margin:0 0 4px}h2{font-size:17px;margin:0 0 12px}
h3{font-size:15px;margin:0 0 2px;display:flex;gap:8px;align-items:baseline;flex-wrap:wrap}
.sub,.cls,.meta,.fineprint{color:var(--muted);font-size:12px;margin:0 0 8px}
.cls{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px}
section{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:18px;margin:0 0 16px}
.scroll{overflow-x:auto}
table{border-collapse:collapse;width:100%;font-size:13px}
th,td{text-align:left;padding:7px 10px;border-bottom:1px solid var(--line);vertical-align:middle}
th{font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);font-weight:600;white-space:nowrap}
td.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
td.strong{font-weight:600}td.warn{color:var(--warn)}
td.name{font-weight:500}
.kind,.sub,.params{color:var(--muted);font-weight:400;font-size:11px;margin-left:6px}
.sub{display:block;margin:0}
table.kv{max-width:640px}table.kv th{width:150px;text-transform:none;font-size:12px;letter-spacing:0}
table.kv td{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px;word-break:break-all}
.chips{display:flex;gap:6px;flex-wrap:wrap;margin:0 0 12px}
.chip{background:var(--chip);border-radius:99px;padding:3px 10px;font-size:12px}
.chip.regressed{color:var(--bad)}.chip.improved{color:var(--good)}
.verdict{font-size:11px;padding:2px 8px;border-radius:99px;background:var(--chip);white-space:nowrap}
.verdict.regressed{color:var(--bad)}.verdict.improved{color:var(--good)}
.verdict.inconclusive{color:var(--warn)}
.verdict.tail{color:var(--warn);margin-left:4px}
tr.v-regressed td.strong{color:var(--bad)}tr.v-improved td.strong{color:var(--good)}
td.reason{color:var(--muted);font-size:11.5px;max-width:340px}
.issues{list-style:none;padding:0;margin:0 0 12px;display:grid;gap:6px}
.issue{font-size:12.5px;padding:7px 10px;border-radius:7px;background:var(--chip);border-left:3px solid var(--muted)}
.issue.warning{border-left-color:var(--warn)}.issue.error{border-left-color:var(--bad)}
.issue span{text-transform:uppercase;font-size:10px;letter-spacing:.05em;margin-right:8px;color:var(--muted)}
.muted{color:var(--muted);font-size:11.5px}
svg.box .whisker{stroke:var(--muted);stroke-width:1}
svg.box .boxrect{fill:var(--accent);opacity:.22;stroke:var(--accent);stroke-width:1}
svg.box .medline{stroke:var(--accent);stroke-width:2}
svg.spark polyline{fill:none;stroke:var(--accent);stroke-width:1.5;stroke-linejoin:round}
footer{color:var(--muted);font-size:11.5px;text-align:center;padding:8px 0 0}
`

/* -------------------------------------------------------------------------- */
/*  Document                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Render a fully self-contained HTML report: no scripts, no network requests,
 * no external assets. Safe to attach to a PR, email, or open with the network
 * disabled — which is what makes it a usable stand-in for a CI comment.
 */
export function renderHtmlReport(input: ReportInput): string {
  const { runs, comparison } = input
  const generated = new Date(input.generatedAt).toISOString().replace('T', ' ').slice(0, 16)
  const title =
    comparison != null
      ? `Benchmark comparison — ${comparison.baselineLabel} vs ${comparison.candidateLabel}`
      : runs.length === 1
        ? `Benchmark report — ${runs[0]!.label}`
        : `Benchmark report — ${runs.length} runs`

  const runSections = runs
    .map(
      (run) => `<section>
        <h2>${e(run.label)}</h2>
        <p class="sub">${e(run.context.model ?? 'Unknown device')} · SDK ${e(run.context.sdk ?? '—')} · ${run.benchmarks.length} benchmark(s)</p>
        ${issueList(run.issues)}
        ${contextTable(run)}
      </section>
      ${run.benchmarks.map(benchmarkSection).join('')}`,
    )
    .join('')

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${e(title)}</title>
<style>${STYLES}</style>
</head>
<body><div class="wrap">
<h1>${e(title)}</h1>
<p class="sub">Generated ${e(generated)} UTC by Android Macrobenchmark Viewer · self-contained, no network required</p>
${comparison ? comparisonSection(comparison) : ''}
${runSections}
<footer>Percentiles use linear interpolation. Significance is a two-sided Mann-Whitney U test over per-iteration medians.</footer>
</div></body>
</html>`
}
