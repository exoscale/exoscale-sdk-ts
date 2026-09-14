// ExoscaleClient: the public client. Extends the generated base class (one
// flat method per operationId) and adds hand-written helpers: withRole,
// waitForOperation, and zone discovery.

import { ClientCore } from './core.js'
import { APIError } from './errors.js'
import { GeneratedExoscaleClient } from './generated/operations.js'
import type { Operation, Zone, ZoneName } from './generated/schemas.js'

const VERSION = '0.1.0'

/** Zone API endpoints. */
export const ENDPOINTS = {
  'ch-gva-2': 'https://api-ch-gva-2.exoscale.com/v2',
  'ch-dk-2': 'https://api-ch-dk-2.exoscale.com/v2',
  'de-fra-1': 'https://api-de-fra-1.exoscale.com/v2',
  'de-muc-1': 'https://api-de-muc-1.exoscale.com/v2',
  'at-vie-1': 'https://api-at-vie-1.exoscale.com/v2',
  'at-vie-2': 'https://api-at-vie-2.exoscale.com/v2',
  'bg-sof-1': 'https://api-bg-sof-1.exoscale.com/v2',
  'hr-zag-1': 'https://api-hr-zag-1.exoscale.com/v2',
} as const satisfies Record<ZoneName, string>

export type OperationState = NonNullable<Operation['state']>

export interface ExoscaleClientOptions {
  apiKey?: string
  apiSecret?: string
  /** Zone API endpoint, defaults to ch-gva-2. */
  endpoint?: string
  userAgent?: string
  /** fetch implementation override (default: global fetch). */
  fetch?: typeof fetch
}

function defaultUserAgent(): string {
  return `exoscale-sdk/${VERSION} (node/${process.version}; ${process.platform}/${process.arch})`
}

export class ExoscaleClient extends GeneratedExoscaleClient {
  protected core: ClientCore

  constructor(opts: ExoscaleClientOptions = {}) {
    super()
    this.core = new ClientCore({
      // Fall back to the EXOSCALE_API_KEY/EXOSCALE_API_SECRET environment
      // variables when credentials are not passed explicitly.
      apiKey: opts.apiKey ?? process.env.EXOSCALE_API_KEY,
      apiSecret: opts.apiSecret ?? process.env.EXOSCALE_API_SECRET,
      endpoint: opts.endpoint ?? ENDPOINTS['ch-gva-2'],
      userAgent: opts.userAgent ?? defaultUserAgent(),
      fetchImpl: opts.fetch,
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
   * state. When states are given, the final state must be one of them.
   */
  async waitForOperation(op: Operation, states?: OperationState[]): Promise<Operation> {
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
      if (states !== undefined && states.length > 0 && !states.includes(current.state!)) {
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

  /** getZoneName returns the zone name matching a zone API endpoint. */
  async getZoneName(endpoint: string): Promise<ZoneName> {
    const zone = await this.lookupZone((z) => z.apiEndpoint === endpoint)
    if (zone.name === undefined) {
      throw new APIError(500, `zone for endpoint ${endpoint} has no name`)
    }
    return zone.name
  }

  /** getZoneAPIEndpoint returns the API endpoint of a zone name. */
  async getZoneAPIEndpoint(zoneName: ZoneName): Promise<string> {
    const zone = await this.lookupZone((z) => z.name === zoneName)
    if (zone.apiEndpoint === undefined) {
      throw new APIError(500, `zone ${zoneName} has no API endpoint`)
    }
    return zone.apiEndpoint
  }

  private async lookupZone(match: (z: Zone) => boolean): Promise<Zone> {
    const zones = (await this.listZones()).zones ?? []
    const zone = zones.find(match)
    if (zone === undefined) {
      throw new APIError(404, 'zone not found')
    }
    return zone
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
