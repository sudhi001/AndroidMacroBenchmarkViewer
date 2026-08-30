import type { Issue } from '../../core/types'

const STYLES: Record<Issue['level'], string> = {
  error: 'border-l-red-500 bg-red-50 text-red-900 dark:bg-red-950/40 dark:text-red-200',
  warning:
    'border-l-amber-500 bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200',
  info: 'border-l-slate-400 bg-slate-50 text-slate-700 dark:bg-slate-800/60 dark:text-slate-300',
}

const ORDER: Record<Issue['level'], number> = { error: 0, warning: 1, info: 2 }

export function IssueList({ issues, title }: { issues: Issue[]; title?: string }) {
  if (issues.length === 0) return null
  const sorted = [...issues].sort((a, b) => ORDER[a.level] - ORDER[b.level])
  return (
    <div className="space-y-1.5">
      {title && (
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          {title}
        </h3>
      )}
      <ul className="space-y-1.5">
        {sorted.map((issue, i) => (
          <li
            key={`${issue.level}-${i}`}
            className={`rounded-r-lg border-l-4 px-3 py-2 text-xs leading-relaxed ${STYLES[issue.level]}`}
          >
            {issue.message}
          </li>
        ))}
      </ul>
    </div>
  )
}
