import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { generate } from '../generator/main.js'
import { IGNORED_SCHEMAS, loadSpec } from '../generator/model.js'
import { toCamel, toLowerCamel } from '../generator/naming.js'

const ROOT = join(fileURLToPath(import.meta.url), '..', '..')
const SPEC_FILE = join(ROOT, 'spec', 'openapi.json')

describe('generator', () => {
  it('is deterministic: two runs produce byte-identical output', async () => {
    const dir1 = mkdtempSync(join(tmpdir(), 'exo-gen-'))
    const dir2 = mkdtempSync(join(tmpdir(), 'exo-gen-'))
    await generate(SPEC_FILE, dir1)
    await generate(SPEC_FILE, dir2)
    for (const name of ['schemas.ts', 'operations.ts']) {
      expect(readFileSync(join(dir1, name), 'utf8')).toBe(readFileSync(join(dir2, name), 'utf8'))
    }
  })

  it('covers every operation and schema from the spec', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'exo-gen-'))
    await generate(SPEC_FILE, dir)
    const operations = readFileSync(join(dir, 'operations.ts'), 'utf8')
    const schemas = readFileSync(join(dir, 'schemas.ts'), 'utf8')
    const spec = loadSpec(SPEC_FILE)

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
    await generate(SPEC_FILE, dir)
    for (const name of ['schemas.ts', 'operations.ts']) {
      const expected = readFileSync(join(ROOT, 'src', 'generated', name), 'utf8')
      expect(readFileSync(join(dir, name), 'utf8')).toBe(expected)
    }
  })
})
