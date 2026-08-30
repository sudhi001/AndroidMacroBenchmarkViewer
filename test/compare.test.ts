import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { compareRuns, iterationMedians, sortByImpact } from '../src/core/compare'
import { parseBenchmarkFile } from '../src/core/parse'
import type { BenchmarkRun } from '../src/core/types'

function load(name: string, label = name): BenchmarkRun {
  const text = readFileSync(new URL(`../public/fixtures/${name}`, import.meta.url), 'utf8')
  return parseBenchmarkFile({ text, label, capturedAt: 1_700_000_000_000 })
}

const find = (r: ReturnType<typeof compareRuns>, benchmark: string, metric: string) =>
  r.comparisons.find((c) => c.benchmarkName === benchmark && c.metricName === metric)!

describe('iterationMedians', () => {
  it('collapses a sampled metric to one value per iteration', () => {
    const m = load('frame-timing.json').benchmarks[0]!.metrics.find(
      (x) => x.name === 'frameDurationCpuMs',
    )!
    expect(m.samples.length).toBe(1680)
    // The unit of independent observation is the iteration, not the frame.
    expect(iterationMedians(m)).toHaveLength(8)
  })
})

describe('comparing a run against itself', () => {
  const report = compareRuns(load('compare-baseline.json'), load('compare-baseline.json'))

  it('finds nothing changed', () => {
    expect(report.summary.regressed).toBe(0)
    expect(report.summary.improved).toBe(0)
    expect(report.comparisons.every((c) => c.verdict === 'unchanged')).toBe(true)
  })

  it('reports a zero delta', () => {
    for (const c of report.comparisons) expect(c.deltaPct).toBeCloseTo(0, 12)
  })

  it('notices both sides are the same file', () => {
    expect(report.warnings.some((w) => /same file/i.test(w.message))).toBe(true)
  })
})

describe('a real regression', () => {
  const report = compareRuns(
    load('compare-baseline.json', 'main'),
    load('compare-candidate.json', 'my-branch'),
  )

  it('flags the 12% startup regression', () => {
    const c = find(report, 'startup', 'timeToInitialDisplayMs')
    expect(c.verdict).toBe('regressed')
    expect(c.deltaPct).toBeGreaterThan(0.08)
    expect(c.pValue).toBeLessThan(0.05)
    expect(c.effectMagnitude).toBe('large')
  })

  it('explains itself rather than just colouring a cell red', () => {
    const c = find(report, 'startup', 'timeToInitialDisplayMs')
    expect(c.reasons.join(' ')).toMatch(/p = /)
    expect(c.reasons.join(' ')).toMatch(/Cliff's delta/)
  })

  it('does not flag the frame count that did not move', () => {
    expect(find(report, 'scroll', 'frameCount').verdict).toBe('unchanged')
  })

  it('exposes tail movement separately from the median', () => {
    const c = find(report, 'scroll', 'frameDurationCpuMs')
    // Jank rate tripled, so the tail should move far more than the median.
    expect(c.percentileDeltas.p99!).toBeGreaterThan(c.percentileDeltas.p50!)
  })

  it('carries the labels through for reporting', () => {
    expect(report.baselineLabel).toBe('main')
    expect(report.candidateLabel).toBe('my-branch')
  })
})

describe('direction of change', () => {
  it('treats a higher fps as an improvement, not a regression', () => {
    const mk = (values: number[]) =>
      parseBenchmarkFile({
        text: JSON.stringify({
          context: {},
          benchmarks: [
            {
              name: 'b',
              className: 'C',
              metrics: { renderFps: { runs: values } },
            },
          ],
        }),
        label: 'x',
        capturedAt: 0,
      })
    const slow = mk([50, 51, 52, 50, 51, 49, 50, 51])
    const fast = mk([60, 61, 62, 60, 61, 59, 60, 61])
    expect(find(compareRuns(slow, fast), 'b', 'renderFps').verdict).toBe('improved')
    expect(find(compareRuns(fast, slow), 'b', 'renderFps').verdict).toBe('regressed')
  })

  it('treats a lower duration as an improvement', () => {
    const report = compareRuns(
      load('compare-candidate.json'),
      load('compare-baseline.json'),
    )
    expect(find(report, 'startup', 'timeToInitialDisplayMs').verdict).toBe('improved')
  })
})

describe('refusing to guess', () => {
  it('will not judge a single-iteration run', () => {
    const report = compareRuns(load('legacy-sample.json'), load('legacy-sample.json'))
    const c = report.comparisons[0]!
    expect(c.verdict).toBe('inconclusive')
    expect(c.reasons.join(' ')).toMatch(/iteration/i)
  })

  it('will not judge summary-only data', () => {
    const report = compareRuns(load('no-runs.json'), load('no-runs.json'))
    expect(report.comparisons[0]!.verdict).toBe('inconclusive')
    expect(report.comparisons[0]!.reasons.join(' ')).toMatch(/summary values/i)
  })

  it('calls a large but statistically indistinguishable move inconclusive', () => {
    // Huge spread, medians ~20% apart, distributions almost entirely overlapping.
    const mk = (values: number[]) =>
      parseBenchmarkFile({
        text: JSON.stringify({
          context: {},
          benchmarks: [{ name: 'b', className: 'C', metrics: { xMs: { runs: values } } }],
        }),
        label: 'x',
        capturedAt: 0,
      })
    const a = mk([100, 180, 90, 200, 110, 190])
    const b = mk([180, 100, 200, 95, 210, 105])
    const c = find(compareRuns(a, b), 'b', 'xMs')
    expect(['inconclusive', 'unchanged']).toContain(c.verdict)
  })

  it('respects a caller-supplied threshold', () => {
    const base = load('compare-baseline.json')
    const cand = load('compare-candidate.json')
    // A 50% threshold should swallow the 12% startup regression.
    const lax = compareRuns(base, cand, { minDeltaPct: 0.5 })
    expect(find(lax, 'startup', 'timeToInitialDisplayMs').verdict).toBe('unchanged')
    const strict = compareRuns(base, cand, { minDeltaPct: 0.01 })
    expect(find(strict, 'startup', 'timeToInitialDisplayMs').verdict).toBe('regressed')
  })
})

describe('asymmetric runs', () => {
  const report = compareRuns(load('compare-baseline.json'), load('multi-benchmark.json'))

  it('reports benchmarks that exist on only one side instead of dropping them', () => {
    const verdicts = new Set(report.comparisons.map((c) => c.verdict))
    expect(verdicts.has('baseline-only')).toBe(true)
    expect(verdicts.has('candidate-only')).toBe(true)
    expect(report.summary.missing).toBeGreaterThan(0)
  })

  it('keeps parameterized variants distinct', () => {
    const cold = report.comparisons.filter((c) => c.params['mode'] === 'COLD')
    const warm = report.comparisons.filter((c) => c.params['mode'] === 'WARM')
    expect(cold.length).toBeGreaterThan(0)
    expect(warm.length).toBeGreaterThan(0)
  })
})

describe('environment warnings', () => {
  it('warns loudly when the two runs are from different devices', () => {
    const report = compareRuns(load('compare-baseline.json'), load('other-device.json'))
    expect(report.warnings.some((w) => /different devices/i.test(w.message))).toBe(true)
    expect(report.warnings.some((w) => w.level === 'warning')).toBe(true)
  })

  it('does not warn when the devices match', () => {
    const report = compareRuns(load('compare-baseline.json'), load('compare-candidate.json'))
    expect(report.warnings.some((w) => /different devices/i.test(w.message))).toBe(false)
  })
})

describe('sortByImpact', () => {
  it('puts regressions first and unchanged last', () => {
    const report = compareRuns(load('compare-baseline.json'), load('compare-candidate.json'))
    const sorted = sortByImpact(report.comparisons)
    expect(sorted[0]!.verdict).toBe('regressed')
    expect(sorted[sorted.length - 1]!.verdict).toBe('unchanged')
  })

  it('does not mutate its input', () => {
    const report = compareRuns(load('compare-baseline.json'), load('compare-candidate.json'))
    const before = report.comparisons.map((c) => c.metricName)
    sortByImpact(report.comparisons)
    expect(report.comparisons.map((c) => c.metricName)).toEqual(before)
  })
})

describe('noise is measured between iterations, not within them', () => {
  // Regression guard. Gating on the CV of pooled samples marks every
  // frame-timing metric "too noisy to judge" — the pooled spread of
  // frameDurationCpuMs is ~48% purely because frames legitimately differ,
  // while its run-to-run reproducibility is ~2%.
  const run = load('compare-baseline.json')
  const frameMetric = run.benchmarks
    .flatMap((b) => b.metrics)
    .find((m) => m.name === 'frameDurationCpuMs')!

  it('sees a large pooled spread on a sampled metric', () => {
    expect(frameMetric.stats.cv).toBeGreaterThan(0.3)
  })

  it('but a small between-iteration spread', () => {
    expect(frameMetric.betweenIterationCv).toBeLessThan(0.1)
  })

  it('so a frame-timing metric is still judged rather than dismissed', () => {
    const report = compareRuns(run, run)
    expect(find(report, 'scroll', 'frameDurationCpuMs').verdict).toBe('unchanged')
  })

  it('treats the two as identical for a measured metric', () => {
    const startup = run.benchmarks
      .flatMap((b) => b.metrics)
      .find((m) => m.name === 'timeToInitialDisplayMs')!
    expect(startup.betweenIterationCv).toBeCloseTo(startup.stats.cv, 10)
  })

  it('still refuses a genuinely irreproducible baseline', () => {
    const mk = (values: number[], label: string) =>
      parseBenchmarkFile({
        text: JSON.stringify({
          context: {},
          benchmarks: [{ name: 'b', className: 'C', metrics: { xMs: { runs: values } } }],
        }),
        label,
        capturedAt: 0,
      })
    // Same benchmark on both sides, but the baseline swings by 80x run to run.
    const noisy = mk([10, 400, 25, 800, 15, 600], 'noisy')
    const other = mk([12, 380, 30, 760, 18, 590], 'other')
    const c = find(compareRuns(noisy, other), 'b', 'xMs')
    expect(c.verdict).toBe('inconclusive')
    expect(c.reasons.join(' ')).toMatch(/not reproducible/i)
  })
})

describe('tail regressions the median hides', () => {
  const report = compareRuns(
    load('compare-baseline.json'),
    load('compare-candidate.json'),
  )

  it('flags frame timing whose tail moved far more than its median', () => {
    const c = find(report, 'scroll', 'frameDurationCpuMs')
    // Jank rate tripled: median +3%, but P95 doubles and P99 moves +26%.
    expect(c.verdict).toBe('unchanged')
    expect(Math.abs(c.deltaPct!)).toBeLessThan(0.05)
    expect(c.tailAlert).not.toBeNull()
    expect(c.tailAlert!.deltaPct).toBeGreaterThan(0.1)
  })

  it('reports whichever tail percentile moved worst', () => {
    const c = find(report, 'scroll', 'frameDurationCpuMs')
    const { p90, p95, p99 } = c.percentileDeltas
    const worst = Math.max(p90!, p95!, p99!)
    expect(c.tailAlert!.deltaPct).toBeCloseTo(worst, 12)
  })

  it('does not flag a metric whose tail simply tracks its median', () => {
    // Startup regressed ~11% uniformly: median +11.1%, P99 +12.7%. That is one
    // shift, not a tail problem, and alerting on it would be noise.
    expect(find(report, 'startup', 'timeToInitialDisplayMs').tailAlert).toBeNull()
  })

  it('explains the tail movement in the row reasons', () => {
    const c = find(report, 'scroll', 'frameDurationCpuMs')
    expect(c.reasons.join(' ')).toMatch(/jank regression/i)
  })

  it('does not flag a metric whose tail tracks its median', () => {
    expect(find(report, 'scroll', 'frameCount').tailAlert).toBeNull()
  })

  it('does not flag a tail that moved in the better direction', () => {
    // Comparing in reverse: the tail improves, which is not an alert.
    const reversed = compareRuns(load('compare-candidate.json'), load('compare-baseline.json'))
    expect(find(reversed, 'scroll', 'frameDurationCpuMs').tailAlert).toBeNull()
  })

  it('does not flag summary-only metrics that have no real distribution', () => {
    const report = compareRuns(load('no-runs.json'), load('no-runs.json'))
    expect(report.comparisons[0]!.tailAlert).toBeNull()
  })
})
