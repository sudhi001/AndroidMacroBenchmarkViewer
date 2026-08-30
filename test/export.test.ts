import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { comparisonToCsv, runsToCsv } from '../src/core/export/csv'
import { escapeHtml, renderHtmlReport } from '../src/core/export/html'
import { compareRuns } from '../src/core/compare'
import { parseBenchmarkFile } from '../src/core/parse'
import type { BenchmarkRun } from '../src/core/types'

function load(name: string, label = name): BenchmarkRun {
  const text = readFileSync(new URL(`../public/fixtures/${name}`, import.meta.url), 'utf8')
  return parseBenchmarkFile({ text, label, capturedAt: 1_700_000_000_000 })
}

describe('CSV export', () => {
  it('emits one row per run/benchmark/metric plus a header', () => {
    const run = load('multi-benchmark.json')
    const lines = runsToCsv([run]).split('\n')
    const metricCount = run.benchmarks.reduce((n, b) => n + b.metrics.length, 0)
    expect(lines).toHaveLength(metricCount + 1)
    expect(lines[0]).toMatch(/^run,device,benchmark/)
  })

  it('quotes fields containing commas, quotes or newlines', () => {
    const run = load('startup-cold.json', 'branch: feat/a,b "quoted"\nsecond line')
    const csv = runsToCsv([run])
    expect(csv).toContain('"branch: feat/a,b ""quoted""\nsecond line"')
  })

  it('neutralizes spreadsheet formula injection', () => {
    const run = load('startup-cold.json', '=cmd|/c calc')
    expect(runsToCsv([run])).toContain("'=cmd|/c calc")
    expect(runsToCsv([load('startup-cold.json', '@SUM(A1)')])).toContain("'@SUM(A1)")
  })

  it('leaves negative numbers as numbers', () => {
    // Most comparison deltas are negative; quoting them as text would make the
    // export useless in a spreadsheet.
    const report = compareRuns(load('compare-candidate.json'), load('compare-baseline.json'))
    const csv = comparisonToCsv(report)
    expect(csv).toMatch(/,-\d/)
    expect(csv).not.toMatch(/'-\d/)
  })

  it('exports comparison rows with the statistics attached', () => {
    const report = compareRuns(load('compare-baseline.json'), load('compare-candidate.json'))
    const csv = comparisonToCsv(report)
    expect(csv.split('\n')).toHaveLength(report.comparisons.length + 1)
    expect(csv).toMatch(/pValue/)
    expect(csv).toMatch(/regressed/)
  })
})

describe('escapeHtml', () => {
  it('escapes every character that could break out of text or an attribute', () => {
    expect(escapeHtml(`<script>alert("x")</script>`)).toBe(
      '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;',
    )
    expect(escapeHtml("it's")).toBe('it&#39;s')
    expect(escapeHtml('a & b')).toBe('a &amp; b')
  })

  it('handles null and undefined', () => {
    expect(escapeHtml(null)).toBe('')
    expect(escapeHtml(undefined)).toBe('')
  })
})

describe('HTML report', () => {
  const report = renderHtmlReport({
    runs: [load('multi-benchmark.json')],
    generatedAt: 1_700_000_000_000,
  })

  it('is a complete standalone document', () => {
    expect(report.startsWith('<!DOCTYPE html>')).toBe(true)
    expect(report).toContain('</html>')
  })

  it('makes no network requests of any kind', () => {
    expect(report).not.toMatch(/<script/i)
    expect(report).not.toMatch(/https?:\/\//)
    expect(report).not.toMatch(/<link/i)
    expect(report).not.toMatch(/@import/i)
  })

  it('includes every benchmark and metric', () => {
    const run = load('multi-benchmark.json')
    for (const b of run.benchmarks) {
      expect(report).toContain(b.name)
      for (const m of b.metrics) expect(report).toContain(m.name)
    }
  })

  it('renders distributions as inline SVG rather than a chart library', () => {
    expect(report).toContain('<svg')
    expect(report).toContain('polyline')
  })

  it('supports dark mode', () => {
    expect(report).toContain('prefers-color-scheme:dark')
  })

  it('states its statistical method rather than leaving it implicit', () => {
    expect(report).toMatch(/Mann-Whitney U/)
    expect(report).toMatch(/linear interpolation/)
  })

  it('never emits an unescaped value from the source file', () => {
    const hostile = parseBenchmarkFile({
      text: JSON.stringify({
        context: { build: { model: '<img src=x onerror=alert(1)>', version: { sdk: 30 } } },
        benchmarks: [
          {
            name: '</td></tr><script>alert(2)</script>',
            className: 'C',
            metrics: { xMs: { runs: [1, 2, 3] } },
          },
        ],
      }),
      label: '"><script>alert(3)</script>',
      capturedAt: 0,
    })
    const html = renderHtmlReport({ runs: [hostile], generatedAt: 0 })
    expect(html).not.toContain('<script>alert')
    expect(html).not.toContain('<img src=x')
    expect(html).toContain('&lt;script&gt;')
  })

  it('includes the comparison table when one is supplied', () => {
    const comparison = compareRuns(
      load('compare-baseline.json', 'main'),
      load('compare-candidate.json', 'feature'),
    )
    const html = renderHtmlReport({
      runs: [load('compare-baseline.json', 'main'), load('compare-candidate.json', 'feature')],
      comparison,
      generatedAt: 0,
    })
    expect(html).toContain('Comparison')
    expect(html).toContain('regressed')
    expect(html).toContain("Cliff's")
  })
})
