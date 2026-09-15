import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { generate } from '../generator/main.js'
import { applyPatch } from '../generator/overrides.js'
import { IGNORED_SCHEMAS, loadEffectiveSpec } from '../generator/model.js'
import { toCamel, toLowerCamel } from '../generator/naming.js'

const ROOT = join(fileURLToPath(import.meta.url), '..', '..')
const SPEC_FILE = join(ROOT, 'spec', 'openapi.json')
const OVERRIDES_FILE = join(ROOT, 'spec', 'overrides.json')

describe('generator', () => {
  it('is deterministic: two runs produce byte-identical output', async () => {
    const dir1 = mkdtempSync(join(tmpdir(), 'exo-gen-'))
    const dir2 = mkdtempSync(join(tmpdir(), 'exo-gen-'))
    await generate(SPEC_FILE, OVERRIDES_FILE, dir1)
    await generate(SPEC_FILE, OVERRIDES_FILE, dir2)
    for (const name of ['schemas.ts', 'operations.ts']) {
      expect(readFileSync(join(dir1, name), 'utf8')).toBe(readFileSync(join(dir2, name), 'utf8'))
    }
  })

  it('output is invariant to spec serialization order', async () => {
    const raw = JSON.parse(readFileSync(SPEC_FILE, 'utf8'))
    // Arrays under these keys are structural (their order must not matter);
    // other arrays (e.g. examples) are content and keep their order.
    const STRUCTURAL = new Set(['parameters', 'enum', 'required', 'tags', 'type'])
    const shuffle = (v: any, key: string | undefined): any => {
      if (Array.isArray(v)) {
        const items = v.map((x) => shuffle(x, key))
        return STRUCTURAL.has(key ?? '') ? items.reverse() : items
      }
      if (v !== null && typeof v === 'object') {
        const out: Record<string, any> = {}
        for (const k of Object.keys(v).reverse()) out[k] = shuffle(v[k], k)
        return out
      }
      return v
    }

    const dir = mkdtempSync(join(tmpdir(), 'exo-gen-'))
    const shuffledFile = join(dir, 'shuffled.json')
    writeFileSync(shuffledFile, JSON.stringify(shuffle(raw, undefined)))

    const dirA = mkdtempSync(join(tmpdir(), 'exo-gen-'))
    const dirB = mkdtempSync(join(tmpdir(), 'exo-gen-'))
    await generate(SPEC_FILE, OVERRIDES_FILE, dirA)
    await generate(shuffledFile, OVERRIDES_FILE, dirB)
    for (const name of ['schemas.ts', 'operations.ts']) {
      expect(readFileSync(join(dirA, name), 'utf8')).toBe(readFileSync(join(dirB, name), 'utf8'))
    }
  })

  it('covers every operation and schema from the spec', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'exo-gen-'))
    await generate(SPEC_FILE, OVERRIDES_FILE, dir)
    const operations = readFileSync(join(dir, 'operations.ts'), 'utf8')
    const schemas = readFileSync(join(dir, 'schemas.ts'), 'utf8')
    const spec = loadEffectiveSpec(SPEC_FILE, OVERRIDES_FILE)

    // Every operationId becomes a method.
    expect(spec.operations.length).toBe(371)
    for (const op of spec.operations) {
      const method = new RegExp(`^  ${toLowerCamel(op.operationId)}\\(`, 'm')
      expect(operations, `missing method for ${op.operationId}`).toMatch(method)
    }

    // Every component schema (except the ignored duplicates) becomes a type.
    const names = [...spec.schemas.keys()].filter((n) => !IGNORED_SCHEMAS.has(n))
    expect(names.length).toBe(297)
    for (const name of names) {
      const typeName = toCamel(name)
      const re = new RegExp(`^export (interface|type) ${typeName}[\\s{=]`, 'm')
      expect(schemas, `missing type for ${name}`).toMatch(re)
    }
  })

  it('keeps the committed generated code in sync with the spec', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'exo-gen-'))
    await generate(SPEC_FILE, OVERRIDES_FILE, dir)
    for (const name of ['schemas.ts', 'operations.ts']) {
      const expected = readFileSync(join(ROOT, 'src', 'generated', name), 'utf8')
      expect(readFileSync(join(dir, name), 'utf8')).toBe(expected)
    }
  })
})

describe('spec overrides', () => {
  it('leaves the upstream spec untouched but patches the effective spec', () => {
    const raw = JSON.parse(readFileSync(SPEC_FILE, 'utf8'))
    expect(raw.components.schemas.template.properties.zones).toBeDefined()
    const spec = loadEffectiveSpec(SPEC_FILE, OVERRIDES_FILE)
    expect(spec.schemas.get('template')!.properties.zones).toBeUndefined()
  })

  it('applies add, remove and replace ops without mutating the input', () => {
    const doc = { a: { b: 'x', c: 1 }, list: ['x'] }
    const patched = applyPatch(doc, [
      { op: 'remove', path: '/a/b' },
      { op: 'add', path: '/a/d', value: true },
      { op: 'replace', path: '/a/c', value: 2 },
      { op: 'replace', path: '/list/0', value: 'y' },
    ])
    expect(patched).toEqual({ a: { c: 2, d: true }, list: ['y'] })
    expect(doc).toEqual({ a: { b: 'x', c: 1 }, list: ['x'] })
  })

  it('ignores extra keys such as reason', () => {
    const patched = applyPatch({ a: 1 }, [{ op: 'add', path: '/b', value: 2, reason: 'because' }])
    expect(patched).toEqual({ a: 1, b: 2 })
  })

  it('fails on invalid or stale overrides', () => {
    const doc = { a: { b: 1 } }
    expect(() => applyPatch(doc, 'nope')).toThrow(/JSON array of operations/)
    expect(() => applyPatch(doc, [42])).toThrow(/must be an object/)
    expect(() => applyPatch(doc, [{ op: 'move', path: '/a', from: '/b' }])).toThrow(
      /unsupported op "move"/,
    )
    expect(() => applyPatch(doc, [{ op: 'remove', path: 'a/b' }])).toThrow(/invalid path/)
    expect(() => applyPatch(doc, [{ op: 'add', path: '/a/c' }])).toThrow(/requires a "value"/)
    expect(() => applyPatch(doc, [{ op: 'remove', path: '/a/missing' }])).toThrow(
      /cannot remove "\/a\/missing": not present in spec/,
    )
    expect(() => applyPatch(doc, [{ op: 'replace', path: '/a/missing', value: 2 }])).toThrow(
      /cannot replace "\/a\/missing": not present in spec/,
    )
    expect(() => applyPatch(doc, [{ op: 'remove', path: '/nope/deep' }])).toThrow(
      /path "\/nope\/deep" not found in spec/,
    )
  })
})
