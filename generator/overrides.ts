// Spec overrides: an RFC 6902 JSON Patch (subset) applied to the raw upstream
// spec before parsing. `spec/openapi.json` is a verbatim upstream copy
// refreshed by `npm run pull-spec`; known upstream spec inaccuracies are fixed
// here instead, so they survive spec refreshes.
//
// Supported ops: add, remove, replace. A stale override (path that no longer
// matches upstream) fails the build on purpose: it means upstream changed and
// the override needs reviewing. Extra keys such as "reason" are ignored.

import type { JSON } from './model.js'

export interface PatchOp {
  op: 'add' | 'remove' | 'replace'
  path: string
  value?: unknown
}

export function applyPatch(doc: JSON, patch: unknown): JSON {
  if (!Array.isArray(patch)) throw new Error('overrides: expected a JSON array of operations')
  const out = structuredClone(doc)
  patch.forEach((op, i) => applyOp(out, op, i))
  return out
}

function applyOp(doc: JSON, rawOp: unknown, i: number): void {
  if (typeof rawOp !== 'object' || rawOp === null) {
    throw new Error(`overrides[${i}]: each override must be an object`)
  }
  const { op, path, value } = rawOp as Partial<PatchOp>
  if (op !== 'add' && op !== 'remove' && op !== 'replace') {
    throw new Error(
      `overrides[${i}]: unsupported op "${String(op)}" (supported: add, remove, replace)`,
    )
  }
  if (typeof path !== 'string' || !path.startsWith('/')) {
    throw new Error(
      `overrides[${i}]: invalid path "${String(path)}" (expected a JSON pointer, e.g. /components/schemas/foo/properties/bar)`,
    )
  }
  if (op !== 'remove' && value === undefined) {
    throw new Error(`overrides[${i}]: op "${op}" requires a "value"`)
  }
  // RFC 6901: unescape ~1 (slash) before ~0 (tilde).
  const segments = path
    .slice(1)
    .split('/')
    .map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'))
  const parent = segments.slice(0, -1).reduce((node, seg) => {
    const next = node[seg]
    if (typeof next !== 'object' || next === null) {
      throw new Error(`overrides[${i}]: path "${path}" not found in spec`)
    }
    return next
  }, doc)
  const last = segments[segments.length - 1]
  if (!(last in parent) && op !== 'add') {
    throw new Error(`overrides[${i}]: cannot ${op} "${path}": not present in spec`)
  }
  if (op === 'remove') {
    delete parent[last]
  } else {
    parent[last] = value
  }
}
