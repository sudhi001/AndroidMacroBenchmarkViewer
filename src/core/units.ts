import type { Unit } from './types'

/**
 * Metric names are the only signal available for units — the JSON carries no
 * unit field — so they are inferred from the suffix. Order matters: longer
 * suffixes must be tested before shorter ones that they end with.
 */
const SUFFIX_UNITS: ReadonlyArray<readonly [string, Unit]> = [
  ['Percent', 'percent'],
  ['Bytes', 'bytes'],
  ['Count', 'count'],
  ['Frames', 'count'],
  ['Hz', 'hz'],
  ['Kb', 'kb'],
  ['Mb', 'mb'],
  ['Ms', 'ms'],
  ['Ns', 'ns'],
  ['Us', 'us'],
  ['Sec', 's'],
  ['S', 's'],
]

export function inferUnit(metricName: string): Unit {
  // Strip the aggregation suffixes androidx.benchmark appends to some metrics
  // (e.g. "gcCountAvg", "memoryHeapSizeMaxKb") so the unit is still found.
  const base = metricName.replace(/(Avg|Average|Max|Min|Median|Sum|Total)$/, '')
  for (const [suffix, unit] of SUFFIX_UNITS) {
    if (base.endsWith(suffix)) return unit
  }
  return 'unknown'
}

/**
 * Essentially every Macrobenchmark metric is a duration, a count of bad things,
 * or a memory figure — all lower-is-better. Only the exceptions are listed.
 */
const HIGHER_IS_BETTER = [/fps$/i, /framerate$/i, /throughput$/i, /hitrate$/i, /score$/i]

export function inferLowerIsBetter(metricName: string): boolean {
  return !HIGHER_IS_BETTER.some((re) => re.test(metricName))
}

export const UNIT_LABEL: Record<Unit, string> = {
  ms: 'ms',
  ns: 'ns',
  us: 'µs',
  s: 's',
  count: '',
  bytes: 'B',
  kb: 'KB',
  mb: 'MB',
  percent: '%',
  hz: 'Hz',
  unknown: '',
}

function round(value: number, digits: number): string {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

/** Compact human formatting for a single value, e.g. `347.88 ms`, `3.5 GB`. */
export function formatValue(value: number | null | undefined, unit: Unit): string {
  if (value == null || !Number.isFinite(value)) return '—'

  switch (unit) {
    case 'bytes':
      return formatBytes(value)
    case 'kb':
      return formatBytes(value * 1024)
    case 'mb':
      return formatBytes(value * 1024 * 1024)
    case 'hz':
      return `${round(value / 1e9, 2)} GHz`
    case 'ns':
      // Nanosecond metrics span microbenchmark territory; scale for readability.
      if (Math.abs(value) >= 1e9) return `${round(value / 1e9, 2)} s`
      if (Math.abs(value) >= 1e6) return `${round(value / 1e6, 2)} ms`
      if (Math.abs(value) >= 1e3) return `${round(value / 1e3, 2)} µs`
      return `${round(value, 1)} ns`
    case 'count':
      return Number.isInteger(value) ? value.toLocaleString() : round(value, 2)
    case 'percent':
      return `${round(value, 1)}%`
    default: {
      const label = UNIT_LABEL[unit]
      const digits = Math.abs(value) >= 100 ? 1 : Math.abs(value) >= 1 ? 2 : 3
      return label ? `${round(value, digits)} ${label}` : round(value, digits)
    }
  }
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes)) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = Math.abs(bytes)
  let i = 0
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024
    i++
  }
  const sign = bytes < 0 ? '-' : ''
  return `${sign}${round(value, i === 0 ? 0 : 2)} ${units[i]}`
}

export function formatPercentDelta(fraction: number | null): string {
  if (fraction == null || !Number.isFinite(fraction)) return '—'
  const pct = fraction * 100
  const sign = pct > 0 ? '+' : ''
  return `${sign}${round(pct, Math.abs(pct) >= 10 ? 1 : 2)}%`
}

export function formatDuration(ns: number | null): string {
  if (ns == null || !Number.isFinite(ns)) return '—'
  return formatValue(ns, 'ns')
}
