import { ParseError, parseBenchmarkFile } from '../core/parse'
import type { BenchmarkRun } from '../core/types'
import type { LoadError } from './state/store'

export interface LoadResult {
  runs: BenchmarkRun[]
  errors: LoadError[]
}

/**
 * Read and parse dropped or picked files.
 *
 * Deliberately does not check `file.type`: browsers report `application/json`,
 * `text/plain` or `""` for a .json file depending on the OS registry, and the
 * old viewer's MIME check silently discarded valid files. Attempting the parse
 * and reporting a real failure is both more permissive and more honest.
 */
export async function loadFiles(files: File[]): Promise<LoadResult> {
  const runs: BenchmarkRun[] = []
  const errors: LoadError[] = []

  const settled = await Promise.all(
    files.map(async (file) => {
      try {
        return { file, text: await file.text() }
      } catch (err) {
        return { file, error: err instanceof Error ? err.message : String(err) }
      }
    }),
  )

  for (const entry of settled) {
    const label = entry.file.name.replace(/\.json$/i, '')
    if ('error' in entry) {
      errors.push({ label: entry.file.name, message: `Could not read the file: ${entry.error}` })
      continue
    }
    try {
      runs.push(
        parseBenchmarkFile({
          text: entry.text,
          label,
          // benchmarkData.json has no timestamp of its own; the file's own
          // modified time is the only ordering signal available for trends.
          capturedAt: entry.file.lastModified || Date.now(),
          source: 'file',
        }),
      )
    } catch (err) {
      errors.push({
        label: entry.file.name,
        message:
          err instanceof ParseError ? err.message : `Unexpected error: ${String(err)}`,
      })
    }
  }

  return { runs, errors }
}

/** Parse text pasted directly into the app. */
export function loadText(text: string, label: string): LoadResult {
  try {
    return {
      runs: [parseBenchmarkFile({ text, label, capturedAt: Date.now(), source: 'file' })],
      errors: [],
    }
  } catch (err) {
    return {
      runs: [],
      errors: [
        {
          label,
          message: err instanceof ParseError ? err.message : `Unexpected error: ${String(err)}`,
        },
      ],
    }
  }
}

/** Pull every file out of a drop, including one that dropped a whole folder. */
export async function filesFromDataTransfer(dt: DataTransfer): Promise<File[]> {
  const entries = Array.from(dt.items)
    .filter((i) => i.kind === 'file')
    .map((i) => (typeof i.webkitGetAsEntry === 'function' ? i.webkitGetAsEntry() : null))

  if (entries.every((e) => e === null)) return Array.from(dt.files)

  const files: File[] = []
  await Promise.all(entries.map((entry, i) => walk(entry, dt.files[i] ?? null, files)))
  return files
}

async function walk(
  entry: FileSystemEntry | null,
  fallback: File | null,
  out: File[],
): Promise<void> {
  if (!entry) {
    if (fallback) out.push(fallback)
    return
  }
  if (entry.isFile) {
    const file = await new Promise<File | null>((resolve) =>
      (entry as FileSystemFileEntry).file(resolve, () => resolve(null)),
    )
    if (file && /\.json$/i.test(file.name)) out.push(file)
    return
  }
  if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader()
    // readEntries returns at most 100 at a time and must be drained.
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((resolve) =>
        reader.readEntries(resolve, () => resolve([])),
      )
      if (batch.length === 0) break
      await Promise.all(batch.map((child) => walk(child, null, out)))
    }
  }
}

export function triggerDownload(filename: string, contents: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([contents], { type: mime }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  // Revoking immediately can cancel the download in Safari.
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
