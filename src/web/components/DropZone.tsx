import { useCallback, useRef, useState } from 'react'
import { filesFromDataTransfer, loadFiles, loadText } from '../loadFiles'
import { useStore } from '../state/store'
import type { LoadResult } from '../loadFiles'

/**
 * Order matters: the two most recently captured runs become the default
 * baseline and candidate, so the comparison pair is listed last and the
 * Compare tab shows something meaningful the moment the demo loads.
 */
const DEMO_FILES = [
  'multi-benchmark.json',
  'frame-timing.json',
  'compare-baseline.json',
  'compare-candidate.json',
]

export function DropZone() {
  const { dispatch } = useStore()
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState(false)
  const [pasting, setPasting] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const pasteRef = useRef<HTMLTextAreaElement | null>(null)

  const apply = useCallback(
    (result: LoadResult) => {
      if (result.runs.length > 0) dispatch({ type: 'runs/add', runs: result.runs })
      dispatch({ type: 'errors/set', errors: result.errors })
    },
    [dispatch],
  )

  const ingest = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return
      setBusy(true)
      try {
        apply(await loadFiles(files))
      } finally {
        setBusy(false)
      }
    },
    [apply],
  )

  const loadDemo = useCallback(async () => {
    setBusy(true)
    try {
      const now = Date.now()
      const runs = await Promise.all(
        DEMO_FILES.map(async (name, i) => {
          const res = await fetch(`${import.meta.env.BASE_URL}fixtures/${name}`)
          const text = await res.text()
          return new File([text], name, {
            type: 'application/json',
            // Stagger by an hour so trend ordering is deterministic rather than
            // depending on how fast the four fetches happen to resolve.
            lastModified: now - (DEMO_FILES.length - 1 - i) * 3_600_000,
          })
        }),
      )
      apply(await loadFiles(runs))
    } catch {
      dispatch({
        type: 'errors/set',
        errors: [{ label: 'demo', message: 'Could not load the bundled sample data.' }],
      })
    } finally {
      setBusy(false)
    }
  }, [apply, dispatch])

  return (
    <section aria-label="Load benchmark data">
      <div
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={async (e) => {
          e.preventDefault()
          setDragging(false)
          await ingest(await filesFromDataTransfer(e.dataTransfer))
        }}
        className={`rounded-xl border-2 border-dashed p-6 text-center transition-colors ${
          dragging
            ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/40'
            : 'border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-900'
        }`}
      >
        <p className="text-sm font-medium">
          Drop <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">benchmarkData.json</code>{' '}
          files or a folder here
        </p>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          Drop two to compare them, or several to see a trend. Nothing leaves your browser.
        </p>

        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={busy}
            className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {busy ? 'Reading…' : 'Choose files'}
          </button>
          <button
            type="button"
            onClick={() => setPasting((v) => !v)}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
          >
            Paste JSON
          </button>
          <button
            type="button"
            onClick={loadDemo}
            disabled={busy}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:hover:bg-slate-800"
          >
            Load sample data
          </button>
        </div>

        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".json,application/json"
          className="sr-only"
          onChange={async (e) => {
            await ingest(Array.from(e.target.files ?? []))
            // Reset so re-picking the same file still fires a change event.
            e.target.value = ''
          }}
        />
      </div>

      {pasting && (
        <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
          <label htmlFor="paste" className="text-xs font-medium text-slate-600 dark:text-slate-400">
            Paste the contents of a benchmarkData.json file
          </label>
          <textarea
            id="paste"
            ref={pasteRef}
            rows={6}
            className="mt-2 w-full rounded-lg border border-slate-300 bg-slate-50 p-2 font-mono text-xs dark:border-slate-700 dark:bg-slate-950"
            placeholder='{"context": {…}, "benchmarks": […]}'
          />
          <button
            type="button"
            className="mt-2 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
            onClick={() => {
              const text = pasteRef.current?.value.trim()
              if (!text) return
              apply(loadText(text, 'pasted'))
              setPasting(false)
            }}
          >
            Load
          </button>
        </div>
      )}
    </section>
  )
}
