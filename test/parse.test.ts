import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ParseError, benchmarkKey, hashContent, parseBenchmarkFile } from '../src/core/parse'
import type { BenchmarkRun } from '../src/core/types'

function load(name: string): BenchmarkRun {
  const text = readFileSync(new URL(`../public/fixtures/${name}`, import.meta.url), 'utf8')
  return parseBenchmarkFile({ text, label: name, capturedAt: 1_700_000_000_000 })
}

describe('benchmarkKey', () => {
  it('is stable regardless of param key order', () => {
    expect(benchmarkKey('C', 'n', { b: '2', a: '1' })).toBe(benchmarkKey('C', 'n', { a: '1', b: '2' }))
  })

  it('separates the same benchmark run under different params', () => {
    expect(benchmarkKey('C', 'startup', { mode: 'COLD' })).not.toBe(
      benchmarkKey('C', 'startup', { mode: 'WARM' }),
    )
  })

  it('omits the bracket entirely when there are no params', () => {
    expect(benchmarkKey('com.example.Foo', 'bar', {})).toBe('com.example.Foo#bar')
  })
})

describe('hashContent', () => {
  it('is stable and differs for different content', () => {
    expect(hashContent('abc')).toBe(hashContent('abc'))
    expect(hashContent('abc')).not.toBe(hashContent('abd'))
    expect(hashContent('')).toHaveLength(16)
  })
})

describe('the file the old viewer was hardcoded for', () => {
  it('still parses', () => {
    const run = load('legacy-sample.json')
    expect(run.benchmarks).toHaveLength(1)
    expect(run.context.model).toBe('Pixel 3')
    expect(run.context.sdk).toBe(31)
    const m = run.benchmarks[0]!.metrics[0]!
    expect(m.name).toBe('timeToInitialDisplayMs')
    expect(m.unit).toBe('ms')
    expect(m.stats.median).toBeCloseTo(347.881076, 6)
  })

  it('warns that a single iteration cannot support significance testing', () => {
    const run = load('legacy-sample.json')
    expect(run.issues.some((i) => /single iteration/i.test(i.message))).toBe(true)
  })
})

describe('metric coverage', () => {
  it('reads every metric, not just the first', () => {
    const run = load('startup-cold.json')
    expect(run.benchmarks[0]!.metrics.map((m) => m.name)).toEqual([
      'timeToInitialDisplayMs',
      'timeToFullDisplayMs',
    ])
  })

  it('reads sampledMetrics, which the old viewer ignored entirely', () => {
    const run = load('frame-timing.json')
    const names = run.benchmarks[0]!.metrics.map((m) => m.name)
    expect(names).toContain('frameDurationCpuMs')
    expect(names).toContain('frameOverrunMs')
  })

  it('tags measured and sampled metrics distinctly', () => {
    const metrics = load('frame-timing.json').benchmarks[0]!.metrics
    expect(metrics.find((m) => m.name === 'frameCount')!.kind).toBe('measured')
    expect(metrics.find((m) => m.name === 'frameDurationCpuMs')!.kind).toBe('sampled')
  })

  it('normalizes both runs[] shapes to number[][]', () => {
    const metrics = load('frame-timing.json').benchmarks[0]!.metrics
    const measured = metrics.find((m) => m.name === 'frameCount')!
    const sampled = metrics.find((m) => m.name === 'frameDurationCpuMs')!
    // measured: one value per iteration
    expect(measured.iterations.every((it) => it.length === 1)).toBe(true)
    expect(measured.iterations).toHaveLength(8)
    // sampled: many samples per iteration
    expect(sampled.iterations).toHaveLength(8)
    expect(sampled.iterations[0]!.length).toBeGreaterThan(100)
  })

  it('keeps iteration count distinct from sample count for sampled metrics', () => {
    const m = load('frame-timing.json').benchmarks[0]!.metrics.find(
      (x) => x.name === 'frameDurationCpuMs',
    )!
    expect(m.stats.n).toBe(8)
    expect(m.stats.sampleCount).toBe(8 * 210)
    expect(m.stats.p99).toBeGreaterThan(m.stats.p50)
  })

  it('reads every benchmark, not just benchmarks[0]', () => {
    const run = load('multi-benchmark.json')
    expect(run.benchmarks).toHaveLength(4)
    expect(new Set(run.benchmarks.map((b) => b.key)).size).toBe(4)
  })

  it('surfaces the fields the old viewer discarded', () => {
    const b = load('startup-cold.json').benchmarks[0]!
    expect(b.warmupIterations).toBe(3)
    expect(b.repeatIterations).toBe(10)
    expect(b.totalRunTimeNs).toBe(41275598256)
    expect(b.className).toBe('com.example.macrobenchmark.startup.StartupBenchmark')
  })

  it('captures profiler outputs when present', () => {
    const outputs = load('frame-timing.json').benchmarks[0]!.profilerOutputs
    expect(outputs).toHaveLength(1)
    expect(outputs[0]!.filename).toMatch(/\.perfetto-trace$/)
  })
})

describe('unit and direction inference', () => {
  it('infers units from the metric-name suffix', () => {
    const byName = Object.fromEntries(
      load('multi-benchmark.json').benchmarks.flatMap((b) => b.metrics.map((m) => [m.name, m])),
    )
    expect(byName['timeToInitialDisplayMs']!.unit).toBe('ms')
    expect(byName['frameCount']!.unit).toBe('count')
    expect(byName['memoryHeapSizeMaxKb']!.unit).toBe('kb')
  })

  it('treats an fps metric as higher-is-better', () => {
    const m = load('degraded.json').benchmarks[0]!.metrics.find(
      (x) => x.name === 'customThroughputFps',
    )!
    expect(m.lowerIsBetter).toBe(false)
  })

  it('defaults unknown metrics to lower-is-better', () => {
    const m = load('degraded.json').benchmarks[0]!.metrics.find(
      (x) => x.name === 'unknownUnitMetric',
    )!
    expect(m.unit).toBe('unknown')
    expect(m.lowerIsBetter).toBe(true)
  })
})

describe('degradation instead of failure', () => {
  it('renders a file with no context at all', () => {
    const run = load('degraded.json')
    expect(run.context.model).toBeNull()
    expect(run.benchmarks).toHaveLength(1)
    expect(run.issues.some((i) => /device context/i.test(i.message))).toBe(true)
  })

  it('skips malformed individual metrics but keeps the good ones', () => {
    const names = load('degraded.json').benchmarks[0]!.metrics.map((m) => m.name)
    expect(names).toContain('customThroughputFps')
    expect(names).not.toContain('brokenMetric')
    expect(names).not.toContain('emptyMetric')
  })

  it('ignores unknown future fields without throwing', () => {
    expect(() => load('degraded.json')).not.toThrow()
  })

  it('falls back to summary values when runs[] is absent, and says so', () => {
    const run = load('no-runs.json')
    const m = run.benchmarks[0]!.metrics[0]!
    expect(m.synthesized).toBe(true)
    expect(m.stats.median).toBeCloseTo(322.4, 6)
    expect(run.issues.some((i) => /no per-iteration runs/i.test(i.message))).toBe(true)
  })
})

describe('run-quality warnings', () => {
  it('warns about unlocked CPU clocks', () => {
    expect(load('startup-cold.json').issues.some((i) => /clocks were not locked/i.test(i.message))).toBe(true)
  })

  it('warns about thermal throttling when it happened', () => {
    expect(load('multi-benchmark.json').issues.some((i) => /thermal throttling/i.test(i.message))).toBe(true)
    expect(load('startup-cold.json').issues.some((i) => /thermal throttling/i.test(i.message))).toBe(false)
  })

  it('does not warn about locked clocks on a device that locked them', () => {
    expect(load('other-device.json').issues.some((i) => /clocks were not locked/i.test(i.message))).toBe(false)
  })
})

describe('hard failures', () => {
  it('reports malformed JSON with a real message', () => {
    expect(() => load('malformed.json')).toThrow(ParseError)
    expect(() => load('malformed.json')).toThrow(/not valid json/i)
  })

  it('rejects a JSON file that is not benchmark output, and says where to look', () => {
    expect(() =>
      parseBenchmarkFile({ text: '{"hello":"world"}', label: 'x', capturedAt: 0 }),
    ).toThrow(/benchmarkData\.json/)
  })

  it('rejects a top-level array', () => {
    expect(() => parseBenchmarkFile({ text: '[]', label: 'x', capturedAt: 0 })).toThrow(
      /top level/i,
    )
  })

  it('rejects an empty benchmarks array', () => {
    expect(() =>
      parseBenchmarkFile({ text: '{"benchmarks":[]}', label: 'x', capturedAt: 0 }),
    ).toThrow(/empty/i)
  })
})
