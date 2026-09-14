import { describe, expect, it } from 'vitest'
import { isoDateTime } from '../src/core.js'
import { registerSigningTests } from './signing.shared.js'

registerSigningTests()

describe('isoDateTime', () => {
  it('formats with second precision (RFC 3339, like Go time.RFC3339)', () => {
    expect(isoDateTime(new Date('2026-01-02T03:04:05Z'))).toBe('2026-01-02T03:04:05Z')
  })

  it('drops millisecond precision', () => {
    expect(isoDateTime(new Date('2026-01-02T03:04:05.678Z'))).toBe('2026-01-02T03:04:05Z')
  })
})
