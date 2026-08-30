import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseBenchmarkFile } from '../src/core/parse'
import { buildTrend, sortByDrift } from '../src/core/trend'
import type { BenchmarkRun } from '../src/core/types'

function load(name: string, label: string, capturedAt: number): BenchmarkRun {
  const text = readFileSync(new URL(`../public/fixtures/${name}`, import.meta.url), 'utf8')
  return parseBenchmarkFile({ text, label, capturedAt })
}

function synthetic(label: string, capturedAt: number, values: number[]): BenchmarkRun {
  return parseBenchmarkFile({
    text: JSON.stringify({
      context: {},
      benchmarks: [{ name: 'startup', className: 'C', metrics: { xMs: { runs: values } } }],
    }),
    label,
    capturedAt,
  })
}

describe('buildTrend', () => {
  const runs = [
    load('compare-baseline.json', 'run-1', 3_000),
    load('compare-candidate.json', 'run-2', 1_000),
  ]

  it('orders points by capture time, not argument order', () => {
    const series = buildTrend(runs)
    expect(series[0]!.points.map((p) => p.label)).toEqual(['run-2', 'run-1'])
  })

  it('honours the caller order when asked', () => {
    const series = buildTrend(runs, { sortByTime: false })
    expect(series[0]!.points.map((p) => p.label)).toEqual(['run-1', 'run-2'])
  })

  it('creates one series per benchmark and metric', () => {
    const series = buildTrend(runs)
    const ids = series.map((s) => `${s.benchmarkKey}::${s.metricName}`)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.some((i) => i.includes('timeToInitialDisplayMs'))).toBe(true)
    expect(ids.some((i) => i.includes('frameDurationCpuMs'))).toBe(true)
  })

  it('gives every series a point per run so gaps stay visible', () => {
    const series = buildTrend([...runs, load('other-device.json', 'run-3', 5_000)])
    for (const s of series) expect(s.points).toHaveLength(3)
  })

  it('marks a metric absent from a run as a null point rather than dropping it', () => {
    const series = buildTrend([
      synthetic('a', 1, [10, 11, 12, 10, 11, 12]),
      load('other-device.json', 'b', 2),
    ])
    const xms = series.find((s) => s.metricName === 'xMs')!
    expect(xms.points[0]!.stats).not.toBeNull()
    expect(xms.points[1]!.stats).toBeNull()
    expect(xms.coverage).toBe(1)
  })

  it('computes net change across the first and last points that have data', () => {
    const series = buildTrend([
      synthetic('a', 1, [100, 100, 100, 100, 100, 100]),
      synthetic('b', 2, [110, 110, 110, 110, 110, 110]),
    ])
    expect(series[0]!.netChange).toBeCloseTo(0.1, 6)
  })

  it('flags a consistently irreproducible metric as flaky', () => {
    const noisy = [
      synthetic('a', 1, [10, 400, 20, 800, 15, 600]),
      synthetic('b', 2, [12, 380, 25, 760, 18, 590]),
      synthetic('c', 3, [11, 420, 22, 810, 16, 610]),
    ]
    expect(buildTrend(noisy)[0]!.flaky).toBe(true)
  })

  it('does not flag a stable metric as flaky', () => {
    const stable = [
      synthetic('a', 1, [100, 101, 99, 100, 102, 98]),
      synthetic('b', 2, [101, 100, 100, 99, 101, 100]),
    ]
    expect(buildTrend(stable)[0]!.flaky).toBe(false)
  })

  it('handles a single run without dividing by zero', () => {
    const series = buildTrend([synthetic('only', 1, [5, 5, 5, 5, 5, 5])])
    expect(series[0]!.points).toHaveLength(1)
    expect(series[0]!.netChange).toBeCloseTo(0, 12)
  })

  it('returns nothing for no runs', () => {
    expect(buildTrend([])).toEqual([])
  })
})

describe('sortByDrift', () => {
  it('puts the worst upward drift first for a lower-is-better metric', () => {
    const series = buildTrend([
      parseBenchmarkFile({
        text: JSON.stringify({
          context: {},
          benchmarks: [
            {
              name: 'b',
              className: 'C',
              metrics: {
                slowMs: { runs: [100, 100, 100, 100, 100, 100] },
                fastMs: { runs: [100, 100, 100, 100, 100, 100] },
              },
            },
          ],
        }),
        label: 'a',
        capturedAt: 1,
      }),
      parseBenchmarkFile({
        text: JSON.stringify({
          context: {},
          benchmarks: [
            {
              name: 'b',
              className: 'C',
              metrics: {
                slowMs: { runs: [150, 150, 150, 150, 150, 150] },
                fastMs: { runs: [80, 80, 80, 80, 80, 80] },
              },
            },
          ],
        }),
        label: 'b',
        capturedAt: 2,
      }),
    ])
    const sorted = sortByDrift(series)
    expect(sorted[0]!.metricName).toBe('slowMs')
    expect(sorted[sorted.length - 1]!.metricName).toBe('fastMs')
  })

  it('does not mutate its input', () => {
    const series = buildTrend([synthetic('a', 1, [1, 2, 3, 4, 5, 6])])
    const before = series.map((s) => s.metricName)
    sortByDrift(series)
    expect(series.map((s) => s.metricName)).toEqual(before)
  })
})
