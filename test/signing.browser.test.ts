// @vitest-environment happy-dom
import { createHmac } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { ClientCore } from '../src/core.js'
import { registerSigningTests } from './signing.shared.js'

// Exercises the signing functionality in a browser-like environment
// (happy-dom): same Go reference vectors as test/signing.test.ts, plus a
// request-level check with the process global removed, as in a real browser.
registerSigningTests()

describe('ClientCore.request (browser env)', () => {
  it('signs requests and omits User-Agent without the process global', async () => {
    vi.stubGlobal('process', undefined)
    try {
      let capturedInit: RequestInit | undefined
      const c = new ClientCore({
        apiKey: 'key',
        apiSecret: 'secret',
        endpoint: 'https://api-ch-gva-2.exoscale.com/v2',
        userAgent: 'test-agent',
        fetchImpl: async (_url: string | URL | Request, init?: RequestInit) => {
          capturedInit = init
          return new Response('[]', {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        },
      })
      await c.request('GET', '/instance')
      const headers = capturedInit!.headers as Record<string, string>
      expect(headers['User-Agent']).toBeUndefined()
      const match = headers['Authorization']!.match(
        /^EXO2-HMAC-SHA256 credential=key,expires=(\d+),signature=([A-Za-z0-9+/=]+)$/,
      )
      expect(match).not.toBeNull()
      // Cross-check the noble-produced signature against node:crypto.
      const expected = createHmac('sha256', 'secret')
        .update(['GET /v2/instance', '', '', '', match![1]].join('\n'), 'utf8')
        .digest('base64')
      expect(match![2]).toBe(expected)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
