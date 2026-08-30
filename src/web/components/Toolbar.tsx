import { useCallback, useState } from 'react'
import { compareRuns } from '../../core/compare'
import { comparisonToCsv, runsToCsv } from '../../core/export/csv'
import { renderHtmlReport } from '../../core/export/html'
import {
  ShareTooLargeError,
  buildShareDocument,
  buildShareUrl,
  encodeShare,
} from '../../core/share'
import { triggerDownload } from '../loadFiles'
import { useRun, useStore, type Theme } from '../state/store'

type Status = { tone: 'ok' | 'error'; message: string } | null

export function Toolbar() {
  const { state, dispatch } = useStore()
  const baseline = useRun(state.baselineId)
  const candidate = useRun(state.candidateId)
  const [status, setStatus] = useState<Status>(null)

  const hasRuns = state.runs.length > 0
  const comparison =
    baseline && candidate && baseline.id !== candidate.id
      ? compareRuns(baseline, candidate, state.compareOptions)
      : null

  /**
   * Share what is on screen, not everything loaded.
   *
   * A URL fragment tops out around 30k characters and a single realistic
   * frame-timing run already costs ~13k, so bundling every loaded run makes the
   * button fail exactly when someone has enough data to want to share it.
   * Scoping to the current view keeps the common cases — one run, or one
   * comparison pair — comfortably inside the budget.
   */
  const runsToShare = useCallback(() => {
    if (state.view === 'compare' && baseline && candidate && baseline.id !== candidate.id) {
      return [baseline, candidate]
    }
    if (state.view === 'single') {
      const selected = state.runs.find((r) => r.id === state.selectedRunId)
      if (selected) return [selected]
    }
    return state.runs
  }, [state.view, state.runs, state.selectedRunId, baseline, candidate])

  const share = useCallback(async () => {
    setStatus(null)
    try {
      const scoped = runsToShare()
      const doc = buildShareDocument(
        scoped.map((r) => ({
          label: r.label,
          capturedAt: r.capturedAt,
          // The share carries the source text, so a link survives changes to
          // the internal model.
          text: r.sourceText,
        })),
      )
      const url = buildShareUrl(window.location.href, await encodeShare(doc))
      history.replaceState(null, '', url)
      const noun = scoped.length === 1 ? '1 run' : `${scoped.length} runs`
      try {
        await navigator.clipboard.writeText(url)
        setStatus({
          tone: 'ok',
          message: `Link to ${noun} copied. The data rides in the URL fragment, which browsers never send to a server.`,
        })
      } catch {
        // Clipboard access can be denied; the URL bar already holds the link.
        setStatus({
          tone: 'ok',
          message: `Link to ${noun} is now in the address bar — copy it from there. Clipboard access was denied.`,
        })
      }
    } catch (err) {
      setStatus({
        tone: 'error',
        message:
          err instanceof ShareTooLargeError
            ? `${err.message}`
            : `Could not create a link: ${err instanceof Error ? err.message : String(err)}`,
      })
    }
  }, [runsToShare])

  const exportHtml = useCallback(() => {
    const html = renderHtmlReport({
      runs: state.runs,
      comparison,
      generatedAt: Date.now(),
    })
    triggerDownload('benchmark-report.html', html, 'text/html')
    setStatus({ tone: 'ok', message: 'Self-contained report downloaded — it opens with no network.' })
  }, [state.runs, comparison])

  const exportCsv = useCallback(() => {
    if (state.view === 'compare' && comparison) {
      triggerDownload('benchmark-comparison.csv', comparisonToCsv(comparison), 'text/csv')
    } else {
      triggerDownload('benchmark-metrics.csv', runsToCsv(state.runs), 'text/csv')
    }
    setStatus({ tone: 'ok', message: 'CSV downloaded.' })
  }, [state.runs, state.view, comparison])

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={share}
          disabled={!hasRuns}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium hover:bg-slate-100 disabled:opacity-40 dark:border-slate-700 dark:hover:bg-slate-800"
        >
          Copy share link
        </button>
        <button
          type="button"
          onClick={exportHtml}
          disabled={!hasRuns}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium hover:bg-slate-100 disabled:opacity-40 dark:border-slate-700 dark:hover:bg-slate-800"
        >
          Export HTML report
        </button>
        <button
          type="button"
          onClick={exportCsv}
          disabled={!hasRuns}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium hover:bg-slate-100 disabled:opacity-40 dark:border-slate-700 dark:hover:bg-slate-800"
        >
          Export CSV
        </button>
        <ThemeToggle theme={state.theme} onChange={(t) => dispatch({ type: 'theme/set', theme: t })} />
      </div>

      {status && (
        <p
          role="status"
          className={`rounded-lg px-3 py-2 text-[11px] ${
            status.tone === 'ok'
              ? 'bg-green-50 text-green-800 dark:bg-green-950/40 dark:text-green-300'
              : 'bg-red-50 text-red-800 dark:bg-red-950/40 dark:text-red-300'
          }`}
        >
          {status.message}
        </p>
      )}
    </div>
  )
}

const THEMES: Array<{ value: Theme; label: string }> = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'Auto' },
]

function ThemeToggle({ theme, onChange }: { theme: Theme; onChange: (t: Theme) => void }) {
  return (
    <div
      role="radiogroup"
      aria-label="Colour theme"
      className="ml-auto flex rounded-lg border border-slate-300 p-0.5 dark:border-slate-700"
    >
      {THEMES.map((t) => (
        <button
          key={t.value}
          type="button"
          role="radio"
          aria-checked={theme === t.value}
          onClick={() => onChange(t.value)}
          className={`rounded px-2 py-1 text-[11px] font-medium transition-colors ${
            theme === t.value
              ? 'bg-slate-200 text-slate-900 dark:bg-slate-700 dark:text-slate-100'
              : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}
