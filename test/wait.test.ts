import type { webcrypto } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ExoscaleClient } from '../src/index.js'

// Web Crypto ops (subtle.importKey/sign) settle through real event-loop
// work whose turn count under fake timers is nondeterministic (measured
// 2-100), which stalls the polling loops below. Stub them with
// microtask-resolving mocks so signRequest still runs (payload, header)
// while the fake clock stays in control. Real-crypto correctness is
// covered by test/signing.test.ts against reference vectors.
beforeEach(() => {
  const subtle = globalThis.crypto.subtle
  vi.spyOn(subtle, 'importKey').mockResolvedValue({} as webcrypto.CryptoKey)
  vi.spyOn(subtle, 'sign').mockResolvedValue(new ArrayBuffer(32))
})

function wireOp(state: string, id = 'op-1', extra: Record<string, unknown> = {}) {
  return JSON.stringify({ id, state, ...extra })
}

function pollingClient(states: string[], capturedUrls: string[] = []) {
  let calls = 0
  const fetchImpl = async (url: string | URL | Request): Promise<Response> => {
    capturedUrls.push(String(url))
    const state = states[Math.min(calls, states.length - 1)]
    calls++
    return new Response(wireOp(state), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  return {
    client: new ExoscaleClient({ apiKey: 'k', apiSecret: 's', fetch: fetchImpl }),
    capturedUrls,
  }
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('waitForOperation', () => {
  it('returns immediately for non-pending operations', async () => {
    const { client, capturedUrls } = pollingClient(['success'])
    const op = await client.waitForOperation({ id: 'op-1', state: 'success' })
    expect(op.state).toBe('success')
    expect(capturedUrls).toHaveLength(0)
  })

  it('throws when the operation is nullish', async () => {
    const { client } = pollingClient(['success'])
    await expect(client.waitForOperation(null as any)).rejects.toThrow('operation is nil')
  })

  it('polls until the operation reaches a final state', async () => {
    vi.useFakeTimers()
    const { client, capturedUrls } = pollingClient(['pending', 'pending', 'success'])
    const p = client.waitForOperation({ id: 'op-1', state: 'pending' })
    for (let i = 0; i < 5 && capturedUrls.length < 3; i++) {
      await vi.advanceTimersByTimeAsync(5000)
    }
    const op = await p
    expect(op.state).toBe('success')
    expect(capturedUrls).toHaveLength(3)
    expect(capturedUrls[0]).toBe('https://api-ch-gva-2.exoscale.com/v2/operation/op-1')
  })

  it('rejects when the final state is not in the expected states', async () => {
    vi.useFakeTimers()
    const { client } = pollingClient(['pending', 'failure'], [])
    const p = client.waitForOperation({ id: 'op-1', state: 'pending' }, ['success'])
    // Attach the rejection handler before advancing timers.
    const assertion = expect(p).rejects.toThrow(/state: failure/)
    for (let i = 0; i < 5; i++) {
      await vi.advanceTimersByTimeAsync(5000)
    }
    await assertion
  })

  it('aborts after 5 consecutive polling errors', async () => {
    vi.useFakeTimers()
    const calls: string[] = []
    const client = new ExoscaleClient({
      apiKey: 'k',
      apiSecret: 's',
      fetch: async (url: string | URL | Request) => {
        calls.push(String(url))
        return new Response(JSON.stringify({ message: 'nope' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        })
      },
    })
    const p = client.waitForOperation({ id: 'op-1', state: 'pending' })
    // Attach the rejection handler before advancing timers.
    const assertion = expect(p).rejects.toThrow('nope')
    for (let i = 0; i < 10; i++) {
      await vi.advanceTimersByTimeAsync(5000)
    }
    await assertion
    expect(calls).toHaveLength(5)
  })

  it('resumes polling after transient errors below the abort threshold', async () => {
    vi.useFakeTimers()
    let calls = 0
    const client = new ExoscaleClient({
      apiKey: 'k',
      apiSecret: 's',
      fetch: async () => {
        calls++
        if (calls === 1) {
          return new Response(JSON.stringify({ message: 'nope' }), {
            status: 404,
            headers: { 'Content-Type': 'application/json' },
          })
        }
        return new Response(wireOp('success'), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      },
    })
    const p = client.waitForOperation({ id: 'op-1', state: 'pending' })
    for (let i = 0; i < 10 && calls < 2; i++) {
      await vi.advanceTimersByTimeAsync(5000)
    }
    const op = await p
    expect(op.state).toBe('success')
    expect(calls).toBe(2)
  })
})
