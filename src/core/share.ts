/**
 * Encode a payload into something that fits in a URL fragment.
 *
 * The fragment, not the query string, is deliberate: browsers never send the
 * part after `#` to the server, so a shared link keeps the promise that
 * benchmark data stays on the machines of the people looking at it.
 */

/**
 * Practical ceiling for the whole URL. Chrome handles far more, but Safari,
 * corporate proxies and Slack unfurling all start truncating well before their
 * documented limits, and a silently truncated link is worse than no link.
 */
export const MAX_SHARE_LENGTH = 30_000

export class ShareTooLargeError extends Error {
  constructor(
    readonly actual: number,
    readonly limit: number,
  ) {
    super(
      `Encoded data is ${actual.toLocaleString()} characters, over the ${limit.toLocaleString()}-character limit for a shareable link. Export a self-contained HTML report instead.`,
    )
    this.name = 'ShareTooLargeError'
  }
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = ''
  // Chunked to stay clear of the argument-count limit on large payloads.
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

async function streamThrough(bytes: Uint8Array, transform: 'gzip' | 'gunzip'): Promise<Uint8Array> {
  const stream =
    transform === 'gzip' ? new CompressionStream('gzip') : new DecompressionStream('gzip')
  const source = new Blob([bytes as BlobPart]).stream().pipeThrough(stream)
  const buffer = await new Response(source).arrayBuffer()
  return new Uint8Array(buffer)
}

/**
 * gzip + base64url. Benchmark JSON is highly repetitive, so this typically gets
 * a 50KB file under the limit comfortably.
 *
 * @throws ShareTooLargeError when the result will not survive a real URL bar.
 */
export async function encodeShare(payload: unknown): Promise<string> {
  const json = JSON.stringify(payload)
  const compressed = await streamThrough(new TextEncoder().encode(json), 'gzip')
  const encoded = bytesToBase64Url(compressed)
  if (encoded.length > MAX_SHARE_LENGTH) {
    throw new ShareTooLargeError(encoded.length, MAX_SHARE_LENGTH)
  }
  return encoded
}

export async function decodeShare<T = unknown>(encoded: string): Promise<T> {
  const bytes = await streamThrough(base64UrlToBytes(encoded), 'gunzip')
  return JSON.parse(new TextDecoder().decode(bytes)) as T
}

/** How much of the budget a payload would use, without throwing. */
export async function measureShare(payload: unknown): Promise<{ length: number; fits: boolean }> {
  const compressed = await streamThrough(
    new TextEncoder().encode(JSON.stringify(payload)),
    'gzip',
  )
  const length = bytesToBase64Url(compressed).length
  return { length, fits: length <= MAX_SHARE_LENGTH }
}

export const SHARE_FRAGMENT_PREFIX = '#d='

export function buildShareUrl(baseUrl: string, encoded: string): string {
  return `${baseUrl.split('#')[0]}${SHARE_FRAGMENT_PREFIX}${encoded}`
}

export function readShareFragment(hash: string): string | null {
  return hash.startsWith(SHARE_FRAGMENT_PREFIX)
    ? hash.slice(SHARE_FRAGMENT_PREFIX.length)
    : null
}

/* -------------------------------------------------------------------------- */
/*  Share document                                                             */
/* -------------------------------------------------------------------------- */

export const SHARE_VERSION = 1

export interface SharedRun {
  /** User-facing label, preserved across the share. */
  label: string
  capturedAt: number
  /** The original file text. */
  text: string
}

export interface ShareDocument {
  v: number
  runs: SharedRun[]
}

/**
 * Share the source text rather than the parsed model.
 *
 * Not for size — measured across the fixtures the two are within ~5% of each
 * other once gzipped, since the model's duplicated numbers compress about as
 * well as the source file's pretty-printing. The reason is durability: parsing
 * is deterministic, so a link carrying source text keeps working when the
 * internal model gains or renames a field, whereas a link carrying a serialized
 * model would have to be version-migrated forever.
 */
export function buildShareDocument(runs: SharedRun[]): ShareDocument {
  return { v: SHARE_VERSION, runs }
}

export function isShareDocument(value: unknown): value is ShareDocument {
  if (typeof value !== 'object' || value === null) return false
  const doc = value as Partial<ShareDocument>
  return (
    typeof doc.v === 'number' &&
    Array.isArray(doc.runs) &&
    doc.runs.every(
      (r) =>
        typeof r === 'object' &&
        r !== null &&
        typeof (r as SharedRun).text === 'string' &&
        typeof (r as SharedRun).label === 'string',
    )
  )
}
