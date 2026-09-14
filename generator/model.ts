// OpenAPI spec loading and validation.
// The spec is treated as plain JSON; validation fails fast on anything the
// generator does not support, keeping generation deterministic and total.

import { readFileSync } from 'node:fs'

import { applyPatch } from './overrides.js'

export type JSON = Record<string, any>

export interface Parameter {
  name: string
  in: 'path' | 'query'
  required: boolean
  schema: JSON
  description?: string
}

export interface Operation {
  path: string
  method: string
  operationId: string
  summary?: string
  description?: string
  parameters: Parameter[]
  requestBody?: JSON // application/json body schema
  response200?: JSON // application/json 200 schema
  has200Content: boolean
}

export interface Spec {
  openapi: string
  info: { title: string; version: string }
  paths: Array<{ path: string; operations: Operation[] }>
  schemas: Map<string, JSON>
  operations: Operation[]
}

const METHODS = ['delete', 'get', 'head', 'options', 'patch', 'post', 'put']
const HTTP_METHODS = new Set(['delete', 'get', 'patch', 'post', 'put'])

// Schemas that are intentionally not rendered: `snapshot-export` duplicates
// the inline `snapshot.export` property, which wins the generated type name
// (SnapshotExport), so the duplicate top-level schema is dropped.
export const IGNORED_SCHEMAS = new Set(['snapshot-export'])

export function loadSpec(file: string): Spec {
  const raw = JSON.parse(readFileSync(file, 'utf8')) as JSON
  return parseSpec(raw)
}

// loadEffectiveSpec loads the upstream spec, applies the overrides patch, and
// parses the result. This is what generation (and the tests) operate on.
export function loadEffectiveSpec(specFile: string, overridesFile: string): Spec {
  const raw = JSON.parse(readFileSync(specFile, 'utf8')) as JSON
  const overrides = JSON.parse(readFileSync(overridesFile, 'utf8'))
  return parseSpec(applyPatch(raw, overrides))
}

export function parseSpec(raw: JSON): Spec {
  if (typeof raw.openapi !== 'string') throw new Error('invalid spec: missing "openapi" version')
  if (raw.openapi !== '3.0.0') {
    throw new Error(`unsupported spec: openapi ${raw.openapi} (only 3.0.x is supported)`)
  }

  const schemas = new Map<string, JSON>()
  const components = raw.components ?? {}
  for (const [name, schema] of Object.entries(components.schemas ?? {})) {
    if (typeof schema !== 'object' || schema === null)
      throw new Error(`schema ${name}: not an object`)
    schemas.set(name, schema)
  }
  for (const name of IGNORED_SCHEMAS) {
    if (schemas.has(name)) {
      assertNotReferenced(name, schemas)
      schemas.delete(name)
    }
  }

  const paths: Spec['paths'] = []
  const operations: Operation[] = []
  const seenOpIds = new Map<string, string>()

  for (const path of Object.keys(raw.paths ?? {}).sort()) {
    const item = raw.paths[path]
    const ops: Operation[] = []
    for (const method of METHODS) {
      const op = item[method]
      if (op === undefined) continue
      if (!HTTP_METHODS.has(method)) {
        throw new Error(`${method.toUpperCase()} ${path}: unsupported HTTP method`)
      }
      ops.push(parseOperation(path, method, op, schemas, seenOpIds))
    }
    if (ops.length > 0) paths.push({ path, operations: ops })
    operations.push(...ops)
  }

  return {
    openapi: raw.openapi,
    info: { title: raw.info?.title ?? '', version: raw.info?.version ?? '' },
    paths,
    schemas,
    operations,
  }
}

function parseOperation(
  path: string,
  method: string,
  op: JSON,
  schemas: Map<string, JSON>,
  seenOpIds: Map<string, string>,
): Operation {
  const operationId = op.operationId
  if (typeof operationId !== 'string' || operationId === '') {
    throw new Error(`${method.toUpperCase()} ${path}: missing operationId`)
  }
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(operationId)) {
    throw new Error(
      `${method.toUpperCase()} ${path}: operationId "${operationId}" is not kebab-case`,
    )
  }
  const existing = seenOpIds.get(operationId)
  if (existing !== undefined) {
    throw new Error(
      `duplicate operationId "${operationId}" (${existing} and ${method.toUpperCase()} ${path})`,
    )
  }
  seenOpIds.set(operationId, `${method.toUpperCase()} ${path}`)

  const parameters: Parameter[] = []
  for (const p of op.parameters ?? []) {
    if (p.in !== 'path' && p.in !== 'query') {
      throw new Error(`${operationId}: unsupported parameter location "${p.in}"`)
    }
    parameters.push({
      name: p.name,
      in: p.in,
      required: p.required === true,
      schema: p.schema ?? {},
      description: p.description,
    })
  }

  // Every path template segment must be declared as a required path parameter.
  const templateVars = [...path.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]!)
  const pathParams = parameters.filter((p) => p.in === 'path')
  for (const v of templateVars) {
    const pp = pathParams.find((p) => p.name === v)
    if (!pp) throw new Error(`${operationId}: path variable "{${v}}" has no path parameter`)
    if (!pp.required) throw new Error(`${operationId}: path parameter "${v}" must be required`)
  }
  for (const pp of pathParams) {
    if (!templateVars.includes(pp.name)) {
      throw new Error(`${operationId}: path parameter "${pp.name}" not present in path template`)
    }
  }

  let requestBody: JSON | undefined
  if (op.requestBody !== undefined) {
    const content = op.requestBody.content ?? {}
    if (!('application/json' in content)) {
      throw new Error(`${operationId}: unsupported request content type (only application/json)`)
    }
    for (const ct of Object.keys(content)) {
      if (ct !== 'application/json') {
        throw new Error(`${operationId}: unsupported request content type "${ct}"`)
      }
    }
    requestBody = content['application/json']?.schema
    if (requestBody === undefined) throw new Error(`${operationId}: request body has no schema`)
  }

  let response200: JSON | undefined
  let has200Content = false
  const responses = op.responses ?? {}
  for (const code of Object.keys(responses)) {
    const content = responses[code].content
    if (content === undefined) continue
    for (const ct of Object.keys(content)) {
      if (ct !== 'application/json') {
        throw new Error(`${operationId}: unsupported response content type "${ct}"`)
      }
    }
    if (code === '200' && content['application/json']?.schema !== undefined) {
      response200 = content['application/json'].schema
      has200Content = true
    }
  }

  // No parameter may share a name with a request body property: the generated
  // request type merges all of them into a single object.
  if (requestBody !== undefined) {
    const bodyProps = resolveRefChain(requestBody, schemas, new Set()).properties ?? {}
    for (const p of parameters) {
      if (p.name in bodyProps) {
        throw new Error(
          `${operationId}: parameter "${p.name}" collides with a request body property`,
        )
      }
    }
  }

  return {
    path,
    method,
    operationId,
    summary: op.summary,
    description: op.description,
    parameters,
    requestBody,
    response200,
    has200Content,
  }
}

// assertNotReferenced fails if any schema node references the given schema
// name (an ignored schema must be unreferenced to be safely skipped).
function assertNotReferenced(name: string, schemas: Map<string, JSON>): void {
  const ref = `#/components/schemas/${name}`
  const walk = (schema: JSON, where: string): void => {
    if (typeof schema !== 'object' || schema === null) return
    if (schema.$ref === ref) {
      throw new Error(`schema "${name}" is ignored but referenced by ${where}`)
    }
    for (const [k, v] of Object.entries(schema)) {
      if (typeof v === 'object' && v !== null) walk(v as JSON, `${where}.${k}`)
    }
  }
  for (const [n, s] of schemas) walk(s, `schema ${n}`)
}

// resolveRef resolves a $ref to the schema object it points to.
export function resolveRef(ref: string, schemas: Map<string, JSON>): JSON {
  const m = /^#\/components\/schemas\/(.+)$/.exec(ref)
  if (!m) throw new Error(`unsupported $ref target: ${ref}`)
  const target = schemas.get(m[1]!)
  if (target === undefined) throw new Error(`unknown $ref target: ${ref}`)
  return target
}

// resolveRefChain resolves a $ref chain to the final schema object (cycle-safe).
// Used for the parameter/body collision check where the full property set is
// required; the renderer keeps $refs as refs.
export function resolveRefChain(
  schema: JSON,
  schemas: Map<string, JSON>,
  visiting: Set<string>,
): JSON {
  if (schema.$ref === undefined) return schema
  if (visiting.has(schema.$ref)) return {}
  visiting.add(schema.$ref)
  return resolveRefChain(resolveRef(schema.$ref, schemas), schemas, visiting)
}
