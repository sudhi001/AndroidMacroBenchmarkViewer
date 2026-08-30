import { useEffect, useState } from 'react'
import { parseBenchmarkFile } from '../core/parse'
import { decodeShare, isShareDocument, readShareFragment } from '../core/share'
import type { BenchmarkRun } from '../core/types'
import { ContextCard } from './components/ContextCard'
import { CompareView } from './components/CompareView'
import { DropZone } from './components/DropZone'
import { IssueList } from './components/IssueList'
import { BenchmarkPanel } from './components/MetricTable'
import { RunList } from './components/RunList'
import { Toolbar } from './components/Toolbar'
import { TrendView } from './components/TrendView'
import { useRun, useStore, type View } from './state/store'

const VIEWS: Array<{ id: View; label: string; hint: string }> = [
  { id: 'single', label: 'Inspect', hint: 'Every benchmark and metric in one run' },
  { id: 'compare', label: 'Compare', hint: 'Baseline vs candidate with significance testing' },
  { id: 'trend', label: 'Trend', hint: 'One metric across many runs' },
]

export function App() {
  const { state, dispatch } = useStore()
  const selected = useRun(state.selectedRunId)
  const baseline = useRun(state.baselineId)
  const candidate = useRun(state.candidateId)
  const [restoring, setRestoring] = useState(false)

  // Restore a shared link. The payload lives in the fragment, which the browser
  // never transmits, so opening a shared link still uploads nothing.
  useEffect(() => {
    const encoded = readShareFragment(window.location.hash)
    if (!encoded) return
    setRestoring(true)
    void (async () => {
      try {
        const doc = await decodeShare(encoded)
        if (!isShareDocument(doc)) throw new Error('Unrecognized share link format.')
        const runs: BenchmarkRun[] = doc.runs.map((r) =>
          parseBenchmarkFile({
            text: r.text,
            label: r.label,
            capturedAt: r.capturedAt,
            source: 'url',
          }),
        )
        dispatch({ type: 'runs/add', runs })
        if (runs.length >= 2) dispatch({ type: 'view/set', view: 'compare' })
      } catch (err) {
        dispatch({
          type: 'errors/set',
          errors: [
            {
              label: 'shared link',
              message: `Could not read the shared data: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
        })
      } finally {
        setRestoring(false)
      }
    })()
  }, [dispatch])

  const hasRuns = state.runs.length > 0

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="mx-auto flex max-w-7xl flex-wrap items-baseline justify-between gap-2 px-4 py-3">
          <h1 className="text-base font-semibold">Android Macrobenchmark Viewer</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Runs entirely in your browser — no upload, no server, no telemetry.
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-5 px-4 py-5">
        <DropZone />

        {restoring && (
          <p className="text-xs text-slate-500 dark:text-slate-400">Restoring shared data…</p>
        )}

        {state.errors.length > 0 && (
          <section className="rounded-xl border border-red-200 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950/30">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-red-800 dark:text-red-300">
                {state.errors.length} file{state.errors.length === 1 ? '' : 's'} could not be read
              </h2>
              <button
                type="button"
                onClick={() => dispatch({ type: 'errors/dismiss' })}
                className="text-xs text-red-700 underline-offset-2 hover:underline dark:text-red-400"
              >
                Dismiss
              </button>
            </div>
            <ul className="space-y-1">
              {state.errors.map((e, i) => (
                <li key={i} className="text-xs text-red-800 dark:text-red-300">
                  <span className="font-medium">{e.label}</span> — {e.message}
                </li>
              ))}
            </ul>
          </section>
        )}

        <RunList />

        {hasRuns && (
          <>
            <Toolbar />

            <div role="tablist" aria-label="View" className="flex flex-wrap gap-1 border-b border-slate-200 dark:border-slate-800">
              {VIEWS.map((v) => (
                <button
                  key={v.id}
                  role="tab"
                  type="button"
                  aria-selected={state.view === v.id}
                  title={v.hint}
                  onClick={() => dispatch({ type: 'view/set', view: v.id })}
                  className={`-mb-px rounded-t-lg border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
                    state.view === v.id
                      ? 'border-blue-600 text-blue-700 dark:text-blue-400'
                      : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
                  }`}
                >
                  {v.label}
                </button>
              ))}
            </div>

            {state.view === 'single' && selected && (
              <div className="space-y-4">
                <IssueList issues={selected.issues} title="Run quality" />
                <ContextCard run={selected} />
                {selected.benchmarks.map((b) => (
                  <BenchmarkPanel key={b.key} benchmark={b} />
                ))}
              </div>
            )}

            {state.view === 'compare' &&
              (baseline && candidate && baseline.id !== candidate.id ? (
                <CompareView baseline={baseline} candidate={candidate} />
              ) : (
                <p className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
                  Load a second run, then pick a <strong>Baseline</strong> and a{' '}
                  <strong>Candidate</strong> above.
                </p>
              ))}

            {state.view === 'trend' && <TrendView runs={state.runs} />}
          </>
        )}
      </main>

      <footer className="mx-auto max-w-7xl px-4 py-6 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
        Percentiles use linear interpolation, so they can differ in the last decimal from the
        nearest-rank values the Gradle console prints. Significance is a two-sided Mann-Whitney U
        test over per-iteration medians.
      </footer>
    </div>
  )
}
