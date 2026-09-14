// HTTP core: request building, EXO2-HMAC-SHA256 signing, response decoding.

import { APIError, type APIErrorEntry } from './errors.js'

export interface ClientCoreOptions {
  apiKey?: string
  apiSecret?: string
  endpoint: string
  userAgent: string
  fetchImpl?: typeof fetch
  /**
   * When set, the value (or the getter's return) is used verbatim as the
   * Authorization header instead of EXO2-HMAC-SHA256 signing with
   * apiKey/apiSecret. A getter that returns undefined falls back to signing.
   */
  authHeader?: string | (() => string | undefined)
}

export interface RequestOptions {
  /** Wire-serialized request body (JSON-serializable object). */
  body?: unknown
  /** Query parameters, already stringified by the generated code. */
  query?: Record<string, string>
  /** Decodes the parsed JSON response into the returned type. */
  decode?: (w: any) => any
  /** When true, the request is sent without credentials (list-zones). */
  skipAuth?: boolean
}

/**
 * isoDateTime formats a Date as an RFC 3339 string with second precision
 * (truncating sub-second digits), which is the format the API expects.
 */
export function isoDateTime(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z')
}

function isNode(): boolean {
  return typeof process !== 'undefined' && process.versions?.node !== undefined
}

export class ClientCore {
  private opts: ClientCoreOptions

  constructor(opts: ClientCoreOptions) {
    this.opts = opts
  }

  async request<T = any>(method: string, path: string, reqOpts: RequestOptions = {}): Promise<T> {
    const { body, query, decode, skipAuth } = reqOpts
    const bodyStr = body === undefined ? '' : JSON.stringify(body)
    const qs = buildQueryString(query)
    const url = this.opts.endpoint + path + (qs !== '' ? `?${qs}` : '')
    // The API verifies the signature against the full request path as received
    // on the wire, which includes any path prefix in the endpoint (e.g. /v2).
    const wirePath = new URL(url).pathname

    // User-Agent is a CORS forbidden header: browsers set it themselves and
    // refuse to let JS override it, so only send it from Node.js.
    const headers: Record<string, string> = {}
    if (isNode()) headers['User-Agent'] = this.opts.userAgent
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    if (!skipAuth) {
      const custom =
        this.opts.authHeader === undefined
          ? undefined
          : typeof this.opts.authHeader === 'function'
            ? this.opts.authHeader()
            : this.opts.authHeader
      if (custom !== undefined) {
        headers['Authorization'] = custom
      } else {
        if (this.opts.apiKey === undefined || this.opts.apiSecret === undefined) {
          throw new Error('missing API credentials: apiKey and apiSecret are required')
        }
        headers['Authorization'] = await signRequest({
          method,
          path: wirePath,
          body: bodyStr,
          query: query ?? {},
          apiKey: this.opts.apiKey,
          apiSecret: this.opts.apiSecret,
          expires: Math.floor(Date.now() / 1000) + 600,
        })
      }
    }

    const fetchImpl = this.opts.fetchImpl ?? fetch
    const resp = await fetchImpl(url, {
      method,
      headers,
      body: body !== undefined ? bodyStr : undefined,
    })

    if (resp.status >= 400 && resp.status <= 599) {
      throw await toAPIError(resp)
    }

    const text = await resp.text()
    if (text === '') return undefined as T
    const data = JSON.parse(text)
    return (decode !== undefined ? decode(data) : data) as T
  }
}

/**
 * signRequest produces the EXO2-HMAC-SHA256 Authorization header value.
 * The signed payload is
 * "<METHOD> <path>\n<body>\n<concatenated single-valued query params sorted by
 * name>\n\n<expires-unix>" and the header lists the sorted signed-query-args.
 * path must be the full request path as sent on the wire, including any
 * path prefix in the endpoint (e.g. /v2).
 */
export async function signRequest(args: {
  method: string
  path: string
  body: string
  query: Record<string, string>
  apiKey: string
  apiSecret: string
  expires: number
}): Promise<string> {
  const names = Object.keys(args.query).sort()
  const values = names.map((n) => args.query[n]).join('')
  const payload = [`${args.method} ${args.path}`, args.body, values, '', String(args.expires)].join(
    '\n',
  )
  // Imported lazily so that consumers who never sign (e.g. browser bundles
  // using a custom authHeader) do not load node:crypto at module-evaluation
  // time.
  const { createHmac } = await import('node:crypto')
  const signature = createHmac('sha256', args.apiSecret).update(payload, 'utf8').digest('base64')

  const parts = [`EXO2-HMAC-SHA256 credential=${args.apiKey}`]
  if (names.length > 0) parts.push(`signed-query-args=${names.join(';')}`)
  parts.push(`expires=${args.expires}`, `signature=${signature}`)
  return parts.join(',')
}

function buildQueryString(query?: Record<string, string>): string {
  if (query === undefined) return ''
  const names = Object.keys(query).sort()
  if (names.length === 0) return ''
  return names.map((n) => `${encodeURIComponent(n)}=${encodeURIComponent(query[n])}`).join('&')
}

// toAPIError parses an error response body into an APIError.
async function toAPIError(resp: Response): Promise<APIError> {
  const raw = await resp.text()
  let parsed: any
  try {
    parsed = JSON.parse(raw)
  } catch {
    parsed = undefined
  }

  let message: string
  let title: string | undefined
  let detail: string | undefined
  let entries: APIErrorEntry[] | undefined

  if (parsed !== undefined && typeof parsed === 'object' && !Array.isArray(parsed)) {
    message = typeof parsed.message === 'string' ? parsed.message : ''
    if (message === '' && typeof parsed.error === 'string') message = parsed.error
    if (typeof parsed.title === 'string') title = parsed.title
    if (typeof parsed.detail === 'string') detail = parsed.detail
    entries = parseErrorEntries(parsed.errors)
  } else {
    message = raw
  }

  return new APIError(resp.status, message, title, detail, entries)
}

function parseErrorEntries(raw: unknown): APIErrorEntry[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const entries: APIErrorEntry[] = []
  for (const e of raw) {
    if (e !== null && typeof e === 'object') {
      entries.push({
        detail: typeof e.detail === 'string' ? e.detail : '',
        location: typeof e.location === 'string' ? e.location : '',
      })
    } else if (typeof e === 'string') {
      entries.push({ detail: e, location: '' })
    }
  }
  return entries.length > 0 ? entries : undefined
}
