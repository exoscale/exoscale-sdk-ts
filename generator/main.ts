// Generator entry point.
//
// Usage: tsx generator/main.ts <openapi-spec.json> <overrides.json> <out-dir>
//
// Deterministic by construction: sorted iteration everywhere, fixed header,
// no timestamps, and output normalized with a pinned prettier configuration.

import { mkdirSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'
import * as prettier from 'prettier'

import { loadEffectiveSpec } from './model.js'
import { generateSchemas } from './schemas.js'
import { generateOperations } from './operations.js'
import { TypeRegistry } from './types.js'

// Must stay in sync with prettier.config.js.
const PRETTIER_OPTIONS = {
  parser: 'typescript',
  semi: false,
  singleQuote: true,
  printWidth: 100,
  trailingComma: 'all',
  arrowParens: 'always',
} as const

export async function generate(
  specFile: string,
  overridesFile: string,
  outDir: string,
): Promise<void> {
  const spec = loadEffectiveSpec(specFile, overridesFile)
  const registry = new TypeRegistry(spec)
  const schemas = generateSchemas(spec, registry)
  const operations = generateOperations(spec, registry)

  mkdirSync(outDir, { recursive: true })
  const files: Array<[string, string]> = [
    ['schemas.ts', schemas],
    ['operations.ts', operations],
  ]
  for (const [name, src] of files) {
    const formatted = await prettier.format(src, { ...PRETTIER_OPTIONS })
    writeFileSync(join(outDir, name), formatted)
  }
}

const isMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (isMain) {
  const [specFile, overridesFile, outDir] = process.argv.slice(2)
  if (specFile === undefined || overridesFile === undefined || outDir === undefined) {
    console.error('usage: main.ts <openapi-spec.json> <overrides.json> <out-dir>')
    process.exit(1)
  }
  generate(specFile, overridesFile, outDir).catch((e: unknown) => {
    console.error(e)
    process.exit(1)
  })
}
