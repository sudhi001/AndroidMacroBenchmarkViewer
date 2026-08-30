import { formatValue } from '../../core/units'
import { useStore } from '../state/store'

export function RunList() {
  const { state, dispatch } = useStore()
  if (state.runs.length === 0) return null

  return (
    <section aria-label="Loaded runs" className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          {state.runs.length} run{state.runs.length === 1 ? '' : 's'} loaded
        </h2>
        <button
          type="button"
          onClick={() => dispatch({ type: 'runs/clear' })}
          className="text-xs text-slate-500 underline-offset-2 hover:underline dark:text-slate-400"
        >
          Clear all
        </button>
      </div>

      <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {state.runs.map((run) => {
          const selected = run.id === state.selectedRunId
          const metrics = run.benchmarks.reduce((n, b) => n + b.metrics.length, 0)
          return (
            <li
              key={run.id}
              className={`rounded-lg border p-3 transition-colors ${
                selected
                  ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/30'
                  : 'border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900'
              }`}
            >
              <div className="flex items-start gap-2">
                <input
                  aria-label={`Label for ${run.label}`}
                  value={run.label}
                  onChange={(e) =>
                    dispatch({ type: 'runs/rename', id: run.id, label: e.target.value })
                  }
                  className="min-w-0 flex-1 truncate rounded border border-transparent bg-transparent px-1 py-0.5 text-sm font-medium hover:border-slate-300 focus:border-blue-500 focus:outline-none dark:hover:border-slate-700"
                />
                <button
                  type="button"
                  aria-label={`Remove ${run.label}`}
                  onClick={() => dispatch({ type: 'runs/remove', id: run.id })}
                  className="shrink-0 rounded px-1 text-slate-400 hover:bg-slate-100 hover:text-red-600 dark:hover:bg-slate-800"
                >
                  ✕
                </button>
              </div>

              <p className="mt-1 truncate text-xs text-slate-500 dark:text-slate-400">
                {run.context.model ?? 'Unknown device'}
                {run.context.sdk != null && ` · SDK ${run.context.sdk}`}
              </p>
              <p className="text-xs text-slate-400 dark:text-slate-500">
                {run.benchmarks.length} benchmark{run.benchmarks.length === 1 ? '' : 's'} ·{' '}
                {metrics} metric{metrics === 1 ? '' : 's'} ·{' '}
                {new Date(run.capturedAt).toLocaleString()}
              </p>

              <div className="mt-2 flex flex-wrap gap-1">
                <SelectChip
                  active={selected}
                  label="View"
                  onClick={() => {
                    dispatch({ type: 'select/run', id: run.id })
                    dispatch({ type: 'view/set', view: 'single' })
                  }}
                />
                <SelectChip
                  active={run.id === state.baselineId}
                  label="Baseline"
                  onClick={() => dispatch({ type: 'select/baseline', id: run.id })}
                />
                <SelectChip
                  active={run.id === state.candidateId}
                  label="Candidate"
                  onClick={() => dispatch({ type: 'select/candidate', id: run.id })}
                />
              </div>

              {run.context.memTotalBytes != null && (
                <p className="mt-2 text-[11px] text-slate-400 dark:text-slate-500">
                  {formatValue(run.context.memTotalBytes, 'bytes')} RAM ·{' '}
                  {run.context.cpuCoreCount ?? '?'} cores ·{' '}
                  {run.context.cpuLocked ? 'clocks locked' : 'clocks unlocked'}
                </p>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function SelectChip({
  active,
  label,
  onClick,
}: {
  active: boolean
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors ${
        active
          ? 'bg-blue-600 text-white'
          : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
      }`}
    >
      {label}
    </button>
  )
}
