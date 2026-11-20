// ExoscaleClient: the public client. Extends the generated base class (one
// flat method per operationId) and adds hand-written helpers: withRole and
// waitForOperation.

import { ClientCore } from './core.js'
import { GeneratedExoscaleClient } from './generated/operations.js'
import { ENDPOINTS, type Operation } from './generated/schemas.js'

export { ENDPOINTS }

const VERSION = '0.1.0'

export type OperationState = NonNullable<Operation['state']>

export interface ExoscaleClientOptions {
  apiKey?: string
  apiSecret?: string
  /** Zone API endpoint, defaults to ch-gva-2. */
  endpoint?: string
  /** Custom User-Agent. Node.js only; ignored in browsers. */
  userAgent?: string
  /** fetch implementation override (default: global fetch). */
  fetch?: typeof fetch
  /**
   * When set, the value (or the getter's return) is used verbatim as the
   * Authorization header instead of EXO2-HMAC-SHA256 signing with
   * apiKey/apiSecret. A getter that returns undefined falls back to signing.
   */
  authHeader?: string | (() => string | undefined)
}

/** env reads an environment variable when running on Node.js, else undefined. */
function env(name: string): string | undefined {
  return typeof process !== 'undefined' ? process.env[name] : undefined
}

function defaultUserAgent(): string {
  const node =
    typeof process !== 'undefined'
      ? ` (node/${process.version}; ${process.platform}/${process.arch})`
      : ''
  return `exoscale-sdk/${VERSION}${node}`
}

export class ExoscaleClient extends GeneratedExoscaleClient {
  protected core: ClientCore

  constructor(opts: ExoscaleClientOptions = {}) {
    super()
    this.core = new ClientCore({
      // Fall back to the EXOSCALE_API_KEY/EXOSCALE_API_SECRET environment
      // variables when credentials are not passed explicitly (Node.js only).
      apiKey: opts.apiKey ?? env('EXOSCALE_API_KEY'),
      apiSecret: opts.apiSecret ?? env('EXOSCALE_API_SECRET'),
      endpoint: opts.endpoint ?? ENDPOINTS['ch-gva-2'],
      userAgent: opts.userAgent ?? defaultUserAgent(),
      fetchImpl: opts.fetch,
      authHeader: opts.authHeader,
    })
  }

  /**
   * withRole authenticates with the given credentials, assumes the IAM role,
   * and returns a client using the returned ephemeral credentials.
   */
  static async withRole(
    opts: ExoscaleClientOptions & { roleID: string; ttl: number },
  ): Promise<ExoscaleClient> {
    const base = new ExoscaleClient(opts)
    const resp = await base.assumeIAMRole({ id: opts.roleID, ttl: opts.ttl })
    if (resp.key === undefined || resp.secret === undefined) {
      throw new Error('withRole: assume-iam-role response is missing key or secret')
    }
    return new ExoscaleClient({ ...opts, apiKey: resp.key, apiSecret: resp.secret })
  }

  /**
   * waitForOperation polls getOperation until the operation reaches a final
   * state. The final state must be one of states (default: ['success']);
   * pass an empty list to accept any final state.
   */
  async waitForOperation(
    op: Operation,
    states: OperationState[] = ['success'],
  ): Promise<Operation> {
    if (op === undefined || op === null) {
      throw new Error('waitForOperation: operation is nil')
    }
    if (op.state !== 'pending') return op

    const startTime = Date.now()
    let subsequentErrors = 0
    for (;;) {
      await sleep(pollInterval((Date.now() - startTime) / 1000) * 1000)
      let current: Operation
      try {
        current = await this.getOperation({ id: op.id! })
      } catch (e) {
        subsequentErrors++
        if (subsequentErrors >= 5) throw e
        continue
      }
      subsequentErrors = 0
      if (current.state === 'pending') continue
      if (states.length > 0 && !states.includes(current.state!)) {
        const ref = current.reference?.id
        const refPart = ref !== undefined ? ` ${ref}` : ''
        throw new Error(
          `operation "${op.id}"${refPart}, state: ${current.state}, reason: ${current.reason ?? ''}, message: ${
            current.message ?? ''
          }`,
        )
      }
      return current
    }
  }
}

// pollInterval returns the seconds to wait before the next poll: 3s for the
// first 30s, then linearly increasing to 60s at 15min of runtime.
function pollInterval(runTimeSec: number): number {
  const a = 57 / 870
  const b = 3 - 30 * a
  return Math.min(60, Math.max(3, a * runTimeSec + b))
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
