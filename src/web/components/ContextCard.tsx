import { formatValue } from '../../core/units'
import type { BenchmarkRun } from '../../core/types'

export function ContextCard({ run }: { run: BenchmarkRun }) {
  const c = run.context
  const rows: Array<[string, string]> = [
    ['Model', c.model ?? '—'],
    ['Brand / device', [c.brand, c.device].filter(Boolean).join(' / ') || '—'],
    ['Android SDK', c.sdk != null ? String(c.sdk) : '—'],
    ['OS codename', c.osCodenameAbbreviated ?? '—'],
    ['CPU cores', c.cpuCoreCount != null ? String(c.cpuCoreCount) : '—'],
    ['CPU max frequency', formatValue(c.cpuMaxFreqHz, 'hz')],
    ['CPU clocks locked', c.cpuLocked == null ? '—' : c.cpuLocked ? 'yes' : 'no'],
    [
      'Sustained performance',
      c.sustainedPerformanceModeEnabled == null
        ? '—'
        : c.sustainedPerformanceModeEnabled
          ? 'enabled'
          : 'disabled',
    ],
    ['Total memory', formatValue(c.memTotalBytes, 'bytes')],
    ['ART mainline', c.artMainlineVersion != null ? String(c.artMainlineVersion) : '—'],
    ['Fingerprint', c.fingerprint ?? '—'],
  ]

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        Device &amp; build
      </h3>
      <dl className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
        {rows.map(([k, v]) => (
          <div key={k} className="flex min-w-0 gap-2 text-xs">
            <dt className="w-36 shrink-0 text-slate-500 dark:text-slate-400">{k}</dt>
            <dd className="min-w-0 break-all font-mono text-[11px] text-slate-800 dark:text-slate-200">
              {v}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
