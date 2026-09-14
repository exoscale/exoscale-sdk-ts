import { createHmac } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { ClientCore } from '../src/core.js'
import { APIError } from '../src/errors.js'

interface Captured {
  url: string
  init: RequestInit
}

function mockFetch(
  status: number,
  body: string,
  captured: Captured[],
  contentType = 'application/json',
) {
  return async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    captured.push({ url: String(url), init: init ?? {} })
    const safeBody = status === 204 || status === 205 ? null : body
    return new Response(safeBody, { status, headers: { 'Content-Type': contentType } })
  }
}

function core(fetchImpl: typeof fetch): ClientCore {
  return new ClientCore({
    apiKey: 'key',
    apiSecret: 'secret',
    endpoint: 'https://api-ch-gva-2.exoscale.com/v2',
    userAgent: 'test-agent',
    fetchImpl,
  })
}

describe('ClientCore.request', () => {
  it('sends GET with signed auth header and decodes JSON', async () => {
    const captured: Captured[] = []
    const c = core(mockFetch(200, '{"id":"abc","name":"foo"}', captured))
    const out = await c.request('GET', '/instance/abc', { decode: (w: any) => ({ got: w.name }) })
    expect(out).toEqual({ got: 'foo' })

    expect(captured[0].url).toBe('https://api-ch-gva-2.exoscale.com/v2/instance/abc')
    expect(captured[0].init.method).toBe('GET')
    const headers = captured[0].init.headers as Record<string, string>
    expect(headers['User-Agent']).toBe('test-agent')
    expect(headers['Authorization']).toMatch(
      /^EXO2-HMAC-SHA256 credential=key,expires=\d+,signature=[A-Za-z0-9+/]+=$/,
    )
    expect(headers['Content-Type']).toBeUndefined()
    expect(captured[0].init.body).toBeUndefined()
  })

  it('does not send User-Agent in the browser (no process global)', async () => {
    vi.stubGlobal('process', undefined)
    try {
      const captured: Captured[] = []
      const c = core(mockFetch(200, '{"id":"abc"}', captured))
      await c.request('GET', '/instance/abc')
      const headers = captured[0].init.headers as Record<string, string>
      expect(headers['User-Agent']).toBeUndefined()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('signs the full wire path including the endpoint prefix', async () => {
    const captured: Captured[] = []
    const c = core(mockFetch(200, '[]', captured))
    await c.request('GET', '/instance')
    const headers = captured[0].init.headers as Record<string, string>
    const match = headers['Authorization']!.match(
      /^EXO2-HMAC-SHA256 credential=key,expires=(\d+),signature=([A-Za-z0-9+/=]+)$/,
    )
    expect(match).not.toBeNull()
    const expected = createHmac('sha256', 'secret')
      .update(['GET /v2/instance', '', '', '', match![1]].join('\n'), 'utf8')
      .digest('base64')
    expect(match![2]).toBe(expected)
  })

  it('sends the body as JSON with Content-Type', async () => {
    const captured: Captured[] = []
    const c = core(mockFetch(204, '', captured))
    await c.request('POST', '/instance', { body: { 'disk-size': 10, name: 'foo' } })
    expect(captured[0].init.body).toBe('{"disk-size":10,"name":"foo"}')
    const headers = captured[0].init.headers as Record<string, string>
    expect(headers['Content-Type']).toBe('application/json')
    expect(headers['Authorization']).toMatch(/^EXO2-HMAC-SHA256 /)
  })

  it('skips auth when skipAuth is set', async () => {
    const captured: Captured[] = []
    const c = core(mockFetch(200, '{"zones":[]}', captured))
    await c.request('GET', '/zone', { skipAuth: true })
    const headers = captured[0].init.headers as Record<string, string>
    expect(headers['Authorization']).toBeUndefined()
  })

  it('sends the authHeader even on skipAuth requests', async () => {
    const captured: Captured[] = []
    const c = new ClientCore({
      endpoint: 'https://api-ch-gva-2.exoscale.com/v2',
      userAgent: 'test-agent',
      fetchImpl: mockFetch(200, '{"zones":[]}', captured),
      authHeader: () => 'token-123',
    })
    await c.request('GET', '/zone', { skipAuth: true })
    const headers = captured[0].init.headers as Record<string, string>
    expect(headers['Authorization']).toBe('token-123')
  })

  it('does not require credentials for skipAuth requests', async () => {
    const captured: Captured[] = []
    const c = new ClientCore({
      endpoint: 'https://api-ch-gva-2.exoscale.com/v2',
      userAgent: 'test-agent',
      fetchImpl: mockFetch(200, '{"zones":[]}', captured),
    })
    await c.request('GET', '/zone', { skipAuth: true })
    const headers = captured[0].init.headers as Record<string, string>
    expect(headers['Authorization']).toBeUndefined()
  })

  it('sends a static authHeader value verbatim, without credentials', async () => {
    const captured: Captured[] = []
    const c = new ClientCore({
      endpoint: 'https://api-ch-gva-2.exoscale.com/v2',
      userAgent: 'test-agent',
      fetchImpl: mockFetch(200, '{"zones":[]}', captured),
      authHeader: 'token-123',
    })
    await c.request('GET', '/instance')
    const headers = captured[0].init.headers as Record<string, string>
    expect(headers['Authorization']).toBe('token-123')
  })

  it('re-reads an authHeader getter on every request', async () => {
    const captured: Captured[] = []
    let token = 'token-1'
    const c = new ClientCore({
      endpoint: 'https://api-ch-gva-2.exoscale.com/v2',
      userAgent: 'test-agent',
      fetchImpl: mockFetch(200, '{"zones":[]}', captured),
      authHeader: () => token,
    })
    await c.request('GET', '/instance')
    token = 'token-2'
    await c.request('GET', '/instance')
    expect((captured[0].init.headers as Record<string, string>)['Authorization']).toBe('token-1')
    expect((captured[1].init.headers as Record<string, string>)['Authorization']).toBe('token-2')
  })

  it('falls back to signing when the authHeader getter returns undefined', async () => {
    const captured: Captured[] = []
    const c = new ClientCore({
      apiKey: 'key',
      apiSecret: 'secret',
      endpoint: 'https://api-ch-gva-2.exoscale.com/v2',
      userAgent: 'test-agent',
      fetchImpl: mockFetch(200, '[]', captured),
      authHeader: () => undefined,
    })
    await c.request('GET', '/instance')
    const headers = captured[0].init.headers as Record<string, string>
    expect(headers['Authorization']).toMatch(/^EXO2-HMAC-SHA256 /)
  })

  it('builds the query string sorted and percent-encoded', async () => {
    const captured: Captured[] = []
    const c = core(mockFetch(200, '[]', captured))
    await c.request('GET', '/instance', {
      query: { 'manager-type': 'instance-pool', labels: 'a b' },
    })
    expect(captured[0].url).toBe(
      'https://api-ch-gva-2.exoscale.com/v2/instance?labels=a%20b&manager-type=instance-pool',
    )
  })

  it('fails when credentials are missing', async () => {
    const c = new ClientCore({
      endpoint: 'https://api-ch-gva-2.exoscale.com/v2',
      userAgent: 'test-agent',
      fetchImpl: mockFetch(200, '', []),
    })
    await expect(c.request('GET', '/instance')).rejects.toThrow('missing API credentials')
  })

  it('returns undefined for empty bodies', async () => {
    const c = core(mockFetch(204, '', []))
    const out = await c.request('DELETE', '/instance/abc')
    expect(out).toBeUndefined()
  })

  it('parses JSON error responses into APIError', async () => {
    const c = core(
      mockFetch(
        404,
        JSON.stringify({
          message: 'instance not found',
          title: 'Not Found',
          detail: 'more detail',
          errors: [{ detail: 'bad id', location: 'id' }, 'second error'],
        }),
        [],
      ),
    )
    try {
      await c.request('GET', '/instance/missing')
      expect.unreachable()
    } catch (e) {
      expect(APIError.isNotFound(e)).toBe(true)
      expect((e as APIError).status).toBe(404)
      expect((e as APIError).message).toBe('Not Found: instance not found')
      expect((e as APIError).title).toBe('Not Found')
      expect((e as APIError).detail).toBe('more detail')
      expect((e as APIError).entries).toEqual([
        { detail: 'bad id', location: 'id' },
        { detail: 'second error', location: '' },
      ])
      expect((e as Error).message).toBe('Not Found: instance not found')
    }
  })

  it('falls back to the "error" field when "message" is empty', async () => {
    const c = core(mockFetch(400, JSON.stringify({ error: 'bad request' }), []))
    try {
      await c.request('POST', '/instance')
      expect.unreachable()
    } catch (e) {
      expect((e as APIError).message).toBe('Bad Request: bad request')
    }
  })

  it('keeps the raw body when the error is not JSON', async () => {
    const c = core(mockFetch(500, '<html>boom</html>', [], 'text/html'))
    try {
      await c.request('GET', '/instance')
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(APIError)
      expect((e as Error).message).toBe('Internal Server Error: <html>boom</html>')
    }
  })

  it('does not throw on 3xx-free non-error statuses and decodes scalar values', async () => {
    const c = core(mockFetch(200, '"plain-string"', []))
    const out = await c.request('GET', '/zone-name')
    expect(out).toBe('plain-string')
  })
})
