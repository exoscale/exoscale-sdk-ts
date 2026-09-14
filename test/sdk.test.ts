import { describe, expect, it } from 'vitest'
import { ExoscaleClient, APIError } from '../src/index.js'

interface Captured {
  url: string
  init: RequestInit
}

function capture(captured: Captured[], status = 200, body = '') {
  return async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    captured.push({ url: String(url), init: init ?? {} })
    const safeBody = status === 204 || status === 205 ? null : body
    return new Response(safeBody, { status, headers: { 'Content-Type': 'application/json' } })
  }
}

function client(fetchImpl: typeof fetch): ExoscaleClient {
  return new ExoscaleClient({ apiKey: 'key', apiSecret: 'secret', fetch: fetchImpl })
}

describe('generated operations', () => {
  it('createInstance serializes the merged request body to kebab-case JSON', async () => {
    const captured: Captured[] = []
    const c = client(
      capture(
        captured,
        200,
        JSON.stringify({ id: 'op-1', state: 'pending', reference: { id: 'i-1' } }),
      ),
    )
    const op = await c.createInstance({
      name: 'foo',
      diskSize: 10,
      template: { id: 't-1' },
      instanceType: { id: 'e00-c3' },
      autoStart: true,
    })
    expect(op.id).toBe('op-1')
    expect(op.state).toBe('pending')
    expect(op.reference?.id).toBe('i-1')

    expect(captured[0].url).toBe('https://api-ch-gva-2.exoscale.com/v2/instance')
    expect(captured[0].init.method).toBe('POST')
    expect(captured[0].init.body).toBe(
      '{"auto-start":true,"disk-size":10,"instance-type":{"id":"e00-c3"},"name":"foo","template":{"id":"t-1"}}',
    )
  })

  it('omits undefined body fields and keeps explicit null/zero values', async () => {
    const captured: Captured[] = []
    const c = client(capture(captured, 200, JSON.stringify({ id: 'op-1', state: 'pending' })))
    await c.createInstance({
      name: 'foo',
      diskSize: 0,
      template: { id: 't-1' },
      instanceType: { id: 'e00-c3' },
    })
    expect(captured[0].init.body).toBe(
      '{"disk-size":0,"instance-type":{"id":"e00-c3"},"name":"foo","template":{"id":"t-1"}}',
    )
  })

  it('builds templated paths with percent-encoding', async () => {
    const captured: Captured[] = []
    const c = client(capture(captured, 200, JSON.stringify({ id: 'i-1', name: 'x' })))
    await c.getInstance({ id: 'i-1' })
    expect(captured[0].url).toBe('https://api-ch-gva-2.exoscale.com/v2/instance/i-1')
  })

  it('listInstances sends stringified query params sorted', async () => {
    const captured: Captured[] = []
    const c = client(
      capture(
        captured,
        200,
        JSON.stringify({ instances: [{ id: 'i-1', name: 'foo', state: 'running' }] }),
      ),
    )
    const resp = await c.listInstances({ labels: 'web', managerType: 'instance-pool' })
    expect(captured[0].url).toBe(
      'https://api-ch-gva-2.exoscale.com/v2/instance?labels=web&manager-type=instance-pool',
    )
    expect(resp.instances?.[0]).toMatchObject({ id: 'i-1', name: 'foo', state: 'running' })
  })

  it('listZones is unsigned and decodes zone objects', async () => {
    const captured: Captured[] = []
    const c = client(
      capture(
        captured,
        200,
        JSON.stringify({
          zones: [{ name: 'ch-gva-2', 'api-endpoint': 'https://api-ch-gva-2.exoscale.com/v2' }],
        }),
      ),
    )
    const resp = await c.listZones()
    const headers = captured[0].init.headers as Record<string, string>
    expect(headers['Authorization']).toBeUndefined()
    expect(resp.zones?.[0]).toMatchObject({
      name: 'ch-gva-2',
      apiEndpoint: 'https://api-ch-gva-2.exoscale.com/v2',
    })
  })

  it('converts date-time fields to ISO strings in the query', async () => {
    const captured: Captured[] = []
    const c = client(capture(captured, 200, '[]'))
    await c.listEvents({ from: new Date('2026-01-02T03:04:05.999Z') })
    expect(captured[0].url).toBe(
      'https://api-ch-gva-2.exoscale.com/v2/event?from=2026-01-02T03%3A04%3A05Z',
    )
  })

  it('204 responses resolve to undefined', async () => {
    const c = client(capture([], 204, ''))
    await expect(c.deleteVpc({ id: 'v-1' })).resolves.toBeUndefined()
  })

  it('API errors propagate as APIError', async () => {
    const c = client(capture([], 404, JSON.stringify({ message: 'vpc not found' })))
    try {
      await c.getVpc({ id: 'v-1' })
      expect.unreachable()
    } catch (e) {
      expect(APIError.isNotFound(e)).toBe(true)
      expect((e as APIError).message).toBe('Not Found: vpc not found')
    }
  })

  it('uses a custom endpoint when provided', async () => {
    const captured: Captured[] = []
    const c = new ExoscaleClient({
      apiKey: 'k',
      apiSecret: 's',
      endpoint: 'https://api-de-fra-1.exoscale.com/v2',
      fetch: capture(captured, 200, '[]'),
    })
    await c.listInstances()
    expect(captured[0].url).toBe('https://api-de-fra-1.exoscale.com/v2/instance')
  })
})

describe('authHeader', () => {
  it('is used as the Authorization header without API credentials', async () => {
    const captured: Captured[] = []
    const c = new ExoscaleClient({
      authHeader: () => 'session-token',
      fetch: capture(captured, 200, JSON.stringify({ id: 'i-1', name: 'x' })),
    })
    await c.getInstance({ id: 'i-1' })
    const headers = captured[0].init.headers as Record<string, string>
    expect(headers['Authorization']).toBe('session-token')
    expect(headers['Authorization']).not.toContain('EXO2-HMAC-SHA256')
  })

  it('is re-read per request, so a rotated token is picked up', async () => {
    const captured: Captured[] = []
    let token = 't-1'
    const c = new ExoscaleClient({
      authHeader: () => token,
      fetch: capture(captured, 200, JSON.stringify({ id: 'i-1', name: 'x' })),
    })
    await c.getInstance({ id: 'i-1' })
    token = 't-2'
    await c.getInstance({ id: 'i-1' })
    const h0 = captured[0].init.headers as Record<string, string>
    const h1 = captured[1].init.headers as Record<string, string>
    expect(h0['Authorization']).toBe('t-1')
    expect(h1['Authorization']).toBe('t-2')
  })
})

describe('withRole', () => {
  it('assumes the role and returns a client with the ephemeral credentials', async () => {
    const captured: Captured[] = []
    const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
      captured.push({ url: String(url), init: init ?? {} })
      if (String(url).endsWith('/iam-role/role-1/assume')) {
        return new Response(JSON.stringify({ key: 'new-key', secret: 'new-secret', name: 'tmp' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response(JSON.stringify({ id: 'i-1' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const c = await ExoscaleClient.withRole({
      apiKey: 'key',
      apiSecret: 'secret',
      roleID: 'role-1',
      ttl: 3600,
      fetch: fetchImpl,
    })

    // First call: assume-iam-role signed with the original credentials.
    expect(captured[0].url).toBe('https://api-ch-gva-2.exoscale.com/v2/iam-role/role-1/assume')
    expect(captured[0].init.body).toBe('{"ttl":3600}')
    const h0 = captured[0].init.headers as Record<string, string>
    expect(h0['Authorization']).toContain('credential=key,')

    // The returned client signs with the ephemeral credentials.
    await c.getInstance({ id: 'i-1' })
    const h1 = captured[1].init.headers as Record<string, string>
    expect(h1['Authorization']).toContain('credential=new-key,')
  })

  it('throws when the role assumption response is missing credentials', async () => {
    const c = await ExoscaleClient.withRole({
      apiKey: 'key',
      apiSecret: 'secret',
      roleID: 'role-1',
      ttl: 3600,
      fetch: async () =>
        new Response(JSON.stringify({ name: 'tmp' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    }).catch((e: Error) => {
      expect(e.message).toContain('missing key or secret')
      return undefined
    })
    expect(c).toBeUndefined()
  })
})
