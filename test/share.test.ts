import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  MAX_SHARE_LENGTH,
  buildShareDocument,
  isShareDocument,
  ShareTooLargeError,
  buildShareUrl,
  decodeShare,
  encodeShare,
  measureShare,
  readShareFragment,
} from '../src/core/share'
import { parseBenchmarkFile } from '../src/core/parse'

const fixture = (name: string) =>
  readFileSync(new URL(`../public/fixtures/${name}`, import.meta.url), 'utf8')

describe('share encoding', () => {
  it('round-trips an arbitrary payload', async () => {
    const payload = { a: 1, b: 'two', c: [3, 4, { d: null }], e: 'ünïcødé ✓' }
    expect(await decodeShare(await encodeShare(payload))).toEqual(payload)
  })

  it('round-trips a parsed run without losing data', async () => {
    const run = parseBenchmarkFile({
      text: fixture('startup-cold.json'),
      label: 'startup',
      capturedAt: 1_700_000_000_000,
    })
    expect(await decodeShare(await encodeShare([run]))).toEqual([run])
  })

  it('produces URL-safe output only', async () => {
    const encoded = await encodeShare({ data: 'a'.repeat(500) })
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('compresses the payload it actually encodes', async () => {
    const run = parseBenchmarkFile({
      text: fixture('startup-cold.json'),
      label: 's',
      capturedAt: 0,
    })
    const raw = JSON.stringify([run]).length
    const { length, fits } = await measureShare([run])
    expect(fits).toBe(true)
    // Small payloads barely win: base64 costs 33% and gzip has fixed overhead.
    // The ratio improves sharply with size — see the large-run case below.
    expect(length).toBeLessThan(raw)
  })

  it('compresses a large frame-timing run to well under a third', async () => {
    const run = parseBenchmarkFile({
      text: fixture('frame-timing.json'),
      label: 'f',
      capturedAt: 0,
    })
    const raw = JSON.stringify([run]).length
    const { length, fits } = await measureShare([run])
    expect(fits).toBe(true)
    expect(length / raw).toBeLessThan(0.33)
  })

  it('fits a two-run comparison of realistic size', async () => {
    const doc = buildShareDocument(
      ['compare-baseline.json', 'compare-candidate.json'].map((f, i) => ({
        label: f,
        capturedAt: i,
        text: fixture(f),
      })),
    )
    // ~29k of the 30k budget: real files with more benchmarks will not fit,
    // which is exactly why the HTML export fallback has to exist.
    expect((await measureShare(doc)).fits).toBe(true)
  })

  it('refuses to produce a link that would be truncated', async () => {
    // Random data does not compress, so this reliably exceeds the budget.
    const noise = Array.from({ length: 60_000 }, (_, i) => (i * 2654435761) % 4294967296)
    await expect(encodeShare(noise)).rejects.toBeInstanceOf(ShareTooLargeError)
    await expect(encodeShare(noise)).rejects.toThrow(/self-contained HTML report/)
  })

  it('reports an oversized payload without throwing, so the UI can offer a fallback', async () => {
    const noise = Array.from({ length: 60_000 }, (_, i) => (i * 2654435761) % 4294967296)
    const { fits, length } = await measureShare(noise)
    expect(fits).toBe(false)
    expect(length).toBeGreaterThan(MAX_SHARE_LENGTH)
  })
})

describe('share URLs', () => {
  it('puts the payload in the fragment, never the query string', () => {
    const url = buildShareUrl('https://example.com/viewer', 'ABC123')
    expect(url).toBe('https://example.com/viewer#d=ABC123')
    // The part after # is never transmitted to the server — that is the point.
    expect(new URL(url).search).toBe('')
  })

  it('replaces an existing fragment rather than appending', () => {
    expect(buildShareUrl('https://example.com/v#d=OLD', 'NEW')).toBe('https://example.com/v#d=NEW')
  })

  it('reads its own fragments back', () => {
    expect(readShareFragment('#d=ABC')).toBe('ABC')
    expect(readShareFragment('#other')).toBeNull()
    expect(readShareFragment('')).toBeNull()
  })

  it('survives a full round trip through a URL', async () => {
    const run = parseBenchmarkFile({ text: fixture('no-runs.json'), label: 'n', capturedAt: 5 })
    const url = buildShareUrl('https://example.com/', await encodeShare([run]))
    const decoded = await decodeShare(readShareFragment(new URL(url).hash)!)
    expect(decoded).toEqual([run])
  })
})

describe('share documents', () => {
  it('round-trips source text and labels', async () => {
    const doc = buildShareDocument([
      { label: 'main', capturedAt: 42, text: fixture('startup-cold.json') },
    ])
    const decoded = await decodeShare(await encodeShare(doc))
    expect(isShareDocument(decoded)).toBe(true)
    expect(decoded).toEqual(doc)
  })

  it('re-parses to exactly what the original file produced', async () => {
    const text = fixture('multi-benchmark.json')
    const original = parseBenchmarkFile({ text, label: 'main', capturedAt: 42 })
    const decoded = (await decodeShare(
      await encodeShare(buildShareDocument([{ label: 'main', capturedAt: 42, text }])),
    )) as ReturnType<typeof buildShareDocument>
    const shared = decoded.runs[0]!
    expect(parseBenchmarkFile({ text: shared.text, label: shared.label, capturedAt: shared.capturedAt }))
      .toEqual(original)
  })

  it('rejects anything that is not a share document', () => {
    expect(isShareDocument(null)).toBe(false)
    expect(isShareDocument({ v: 1 })).toBe(false)
    expect(isShareDocument({ v: 1, runs: [{ label: 'x' }] })).toBe(false)
    expect(isShareDocument({ v: 1, runs: [] })).toBe(true)
  })
})
