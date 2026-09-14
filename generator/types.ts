// Core type renderer shared by the schemas and operations generators.
//
// Renders OpenAPI schemas to TypeScript types plus deterministic wire
// transform functions (toWire*/fromWire*). TS types use camelCase fields and
// Date for date-time; the wire (JSON) format uses the original kebab-case
// field names and ISO-8601 strings.

import type { JSON, Spec } from './model.js'
import {
  isAlphanumeric,
  renderDoc,
  renderReference,
  toCamel,
  toLowerCamel,
  validJsIdentifier,
} from './naming.js'

export type WireDir = 'to' | 'from' | 'both'

const REF_RE = /^#\/components\/schemas\/(.+)$/

// refName maps a $ref to the generated type name of its target.
export function refName(ref: string): string {
  const m = REF_RE.exec(ref)
  if (!m) throw new Error(`unsupported $ref target: ${ref}`)
  return renderReference(ref)
}

// baseType returns the effective OpenAPI type of a schema, inferring it when
// missing. Note: a non-false additionalProperties turns the schema into a
// record, overriding any explicit type.
export function baseType(schema: JSON): string | null {
  const ap = schema.additionalProperties
  if (ap !== undefined && ap !== false) return 'record'
  if (typeof schema.type === 'string') return schema.type
  if (Array.isArray(schema.type)) {
    const t = schema.type.find((x: string) => x !== 'null')
    return t ?? 'null'
  }
  if (schema.items !== undefined) return 'array'
  if (schema.properties !== undefined) return 'object'
  return null
}

export function isNullable(schema: JSON): boolean {
  if (schema.nullable === true) return true
  return Array.isArray(schema.type) && schema.type.includes('null')
}

// scalarType maps a simple schema to its TS type.
function scalarType(schema: JSON): string {
  if (schema.format === 'date-time') return 'Date'
  if (schema.type === 'boolean') return 'boolean'
  if (schema.type === 'integer' || schema.type === 'number') return 'number'
  return 'string'
}

// enumUnion renders an inline literal union, or null when the values are not
// safe as TS literal identifiers (ported rule: any value containing ',' or
// starting with a non-alphanumeric char disables the enum).
function enumUnion(schema: JSON): string | null {
  if (!Array.isArray(schema.enum)) return null
  for (const v of schema.enum) {
    const s = String(v)
    if (s === '' || s.includes(',') || !isAlphanumeric(s[0])) return null
  }
  return schema.enum
    .map((v: any) =>
      typeof v === 'number' || typeof v === 'boolean' ? String(v) : JSON.stringify(v),
    )
    .join(' | ')
}

// simpleExpr renders a simple (non-object/array/record) schema as a type
// expression. withEnum=true keeps inline unions (property level); array items
// and record values drop enums.
function simpleExpr(schema: JSON, withEnum: boolean): string {
  if (withEnum) {
    const u = enumUnion(schema)
    if (u) return u
  }
  return scalarType(schema)
}

export function sortedProps(schema: JSON): Array<[string, JSON]> {
  const props = (schema.properties ?? {}) as Record<string, JSON>
  return Object.entries(props).sort((a, b) => (a[0] < b[0] ? -1 : 1))
}

// TypeRegistry tracks generated type names (collision detection) and whether
// a named type needs wire transform functions.
export class TypeRegistry {
  private byName = new Map<string, JSON>()
  private wire = new Map<string, boolean>()
  private declared = new Set<string>()
  private visiting = new Set<string>()

  constructor(spec: Spec) {
    for (const [kebab, schema] of spec.schemas) {
      const camel = toCamel(kebab)
      if (this.byName.has(camel)) {
        throw new Error(`duplicate schema type name "${camel}"`)
      }
      this.byName.set(camel, schema)
    }
    for (const name of [...this.byName.keys()].sort()) {
      this.wireFor(name)
    }
  }

  hasWire(name: string): boolean {
    return this.wire.get(name) ?? false
  }

  // declare registers a newly generated type name (collision check) and
  // records whether it needs wire transforms.
  declare(name: string, schema: JSON): void {
    this.checkName(name)
    if (this.declared.has(name)) {
      throw new Error(`duplicate generated type name: "${name}"`)
    }
    this.declared.add(name)
    if (!this.wire.has(name)) {
      this.wire.set(name, this.wireForSchema(schema))
    }
  }

  // declareObject registers a generated object type name that is not rendered
  // by renderNamedType (e.g. merged request types) — it always needs wire
  // transforms.
  declareObject(name: string): void {
    this.checkName(name)
    if (this.declared.has(name)) {
      throw new Error(`duplicate generated type name: "${name}"`)
    }
    this.declared.add(name)
    this.wire.set(name, true)
  }

  private checkName(name: string): void {
    if (!validJsIdentifier(name)) {
      throw new Error(`invalid generated type name: "${name}"`)
    }
  }

  // declaredNames returns all registered names (for collision checks across
  // the generated files).
  declaredNames(): string[] {
    return [...this.declared]
  }

  private wireFor(name: string): boolean {
    if (this.wire.has(name)) return this.wire.get(name)!
    if (this.visiting.has(name)) throw new Error(`$ref cycle at ${name}`)
    this.visiting.add(name)
    const schema = this.byName.get(name)
    if (schema === undefined) throw new Error(`unknown referenced type: ${name}`)
    const w = this.wireForSchema(schema)
    this.visiting.delete(name)
    this.wire.set(name, w)
    return w
  }

  private wireForSchema(schema: JSON): boolean {
    if (schema.$ref !== undefined) return this.wireFor(refName(schema.$ref))
    switch (baseType(schema)) {
      case 'object':
        return schema.properties !== undefined && Object.keys(schema.properties).length > 0
      case 'record': {
        const v = schema.additionalProperties
        return this.wireForSchema(v === true ? {} : (v as JSON))
      }
      case 'array':
        return this.wireForSchema(schema.items)
      default:
        return schema.format === 'date-time'
    }
  }
}

export interface RenderCtx {
  registry: TypeRegistry
  out: string[]
  dir: WireDir
  // When set, every component schema type referenced while rendering is added
  // to it (used to build the import list of the operations file).
  trackTypes?: Set<string>
  // When set, every component schema wire function (toWire*/fromWire*) invoked
  // while rendering is added to it, so the operations file can import it.
  trackWireFns?: Set<string>
}

// simplePropertyExpr renders a simple (scalar) schema as a TS type expression,
// keeping inline enum unions. Used for request/response parameters.
export function simplePropertyExpr(schema: JSON): string {
  if (schema.$ref !== undefined) return refName(schema.$ref)
  const t = baseType(schema)
  if (t === 'object' || t === 'array' || t === 'record') {
    throw new Error('object/array/record parameters are not supported')
  }
  if (t === null) return 'string'
  return simpleExpr(schema, true)
}

// buildPropDesc computes the TS field and the wire expressions for one
// object property. It emits nested type blocks into ctx.out as needed.
export interface PropDesc {
  wireName: string
  tsName: string
  required: boolean
  nullable: boolean
  doc: string
  typeExpr: string
  toExpr: string
  fromExpr: string
}

export function buildPropDesc(
  ctx: RenderCtx,
  parentName: string,
  schema: JSON,
  wireName: string,
  required: boolean,
): PropDesc {
  const base = `${parentName}${toCamel(wireName)}`
  const tsName = toLowerCamel(wireName)
  const tExpr = typeExpr(schema, base, ctx)
  const toExpr = toWireExpr(schema, base, `v.${tsName}`, ctx)
  const fromExpr = fromWireExpr(schema, base, `w['${wireName}']`, ctx)
  return {
    wireName,
    tsName,
    required,
    nullable: isNullable(schema),
    doc: renderDoc(schema.description ?? schema.title),
    typeExpr: tExpr,
    toExpr,
    fromExpr,
  }
}

// typeExpr renders the TS type expression for a schema. Inline complex
// schemas spawn a named type (base) which is emitted into ctx.out.
function typeExpr(schema: JSON, base: string, ctx: RenderCtx): string {
  if (schema.$ref !== undefined) {
    const n = refName(schema.$ref)
    ctx.trackTypes?.add(n)
    return n
  }

  const t = baseType(schema)
  if (t === 'object') {
    if (schema.properties && Object.keys(schema.properties).length > 0) {
      ctx.out.push(
        renderNamedType(base, schema, ctx, renderDoc(schema.description ?? schema.title)),
      )
      return base
    }
    if (schema.additionalProperties !== undefined) return recordExpr(schema, base, ctx)
    return 'Record<string, unknown>' // free-form {type: object}
  }
  if (t === 'record') return recordExpr(schema, base, ctx)
  if (t === 'array') {
    const items = schema.items
    if (items === undefined) throw new Error('array schema without items')
    if (items.$ref !== undefined) {
      const n = refName(items.$ref)
      ctx.trackTypes?.add(n)
      return `${n}[]`
    }
    const it = baseType(items)
    if (it === 'object' || it === 'array' || it === 'record') {
      ctx.out.push(renderNamedType(base, items, ctx, renderDoc(items.description ?? items.title)))
      return `${base}[]`
    }
    return `${simpleExpr(items, false)}[]`
  }
  if (t === null) return schema.format === 'date-time' ? 'Date' : 'unknown'
  return simpleExpr(schema, true)
}

function recordExpr(schema: JSON, base: string, ctx: RenderCtx): string {
  const addl = schema.additionalProperties
  if (addl === true) return 'Record<string, unknown>'
  if (typeof addl === 'object' && addl !== null && Object.keys(addl).length === 0) {
    return 'Record<string, unknown>'
  }
  if (addl.$ref !== undefined) {
    const n = refName(addl.$ref)
    ctx.trackTypes?.add(n)
    return `Record<string, ${n}>`
  }
  const vt = baseType(addl)
  if (vt === 'object' || vt === 'array' || vt === 'record') {
    ctx.out.push(renderNamedType(base, addl, ctx, renderDoc(addl.description ?? addl.title)))
    return `Record<string, ${base}>`
  }
  if (vt === null) return 'Record<string, unknown>'
  return `Record<string, ${simpleExpr(addl, false)}>`
}

// itemWireFn returns the toWire function name to apply to array items or
// record values, or null when the value passes through unchanged, or 'DATE'
// for date-time scalars.
function itemWireFn(items: JSON, base: string, ctx: RenderCtx, dir: 'to' | 'from'): string | null {
  const fnName = (n: string) => (dir === 'to' ? `toWire${n}` : `fromWire${n}`)
  if (items.$ref !== undefined) {
    const n = refName(items.$ref)
    if (ctx.registry.hasWire(n)) {
      const wanted =
        dir === 'to'
          ? ctx.dir === 'to' || ctx.dir === 'both'
          : ctx.dir === 'from' || ctx.dir === 'both'
      if (wanted) ctx.trackWireFns?.add(fnName(n))
      return fnName(n)
    }
    return null
  }
  const t = baseType(items)
  if (t === 'object' || t === 'array' || t === 'record') {
    // A nested type exists (and needs a wire fn) only when it was actually
    // generated — e.g. an array of scalars passes through unchanged.
    return ctx.registry.hasWire(base) ? fnName(base) : null
  }
  if (items.format === 'date-time') return 'DATE'
  return null
}

function toWireExpr(schema: JSON, base: string, valExpr: string, ctx: RenderCtx): string {
  if (schema.$ref !== undefined) {
    const n = refName(schema.$ref)
    if (ctx.registry.hasWire(n)) {
      if (ctx.dir === 'to' || ctx.dir === 'both') ctx.trackWireFns?.add(`toWire${n}`)
      return `toWire${n}(${valExpr})`
    }
    return valExpr
  }

  const t = baseType(schema)
  if (t === 'object') {
    if (schema.properties && Object.keys(schema.properties).length > 0) {
      return ctx.registry.hasWire(base) ? `toWire${base}(${valExpr})` : valExpr
    }
    return valExpr
  }
  if (t === 'record') return recordToExpr(schema, base, valExpr, ctx)
  if (t === 'array') {
    const items = schema.items
    if (items === undefined) throw new Error('array schema without items')
    const fn = itemWireFn(items, base, ctx, 'to')
    if (fn === null) return valExpr
    const inner = fn === 'DATE' ? 'x.toISOString()' : `${fn}(x)`
    return `(${valExpr}).map((x) => ${inner})`
  }
  if (t === null) return valExpr
  if (schema.format === 'date-time') return `${valExpr}.toISOString()`
  return valExpr
}

function recordToExpr(schema: JSON, base: string, valExpr: string, ctx: RenderCtx): string {
  const addl = schema.additionalProperties
  if (
    addl === true ||
    (typeof addl === 'object' && addl !== null && Object.keys(addl).length === 0)
  ) {
    return valExpr
  }
  const fn = itemWireFn(addl, base, ctx, 'to')
  if (fn === null) return valExpr
  const inner = fn === 'DATE' ? 'val.toISOString()' : `${fn}(val)`
  return `Object.fromEntries(Object.entries(${valExpr}).map(([k, val]) => [k, ${inner}]))`
}

function fromWireExpr(schema: JSON, base: string, wAccess: string, ctx: RenderCtx): string {
  if (schema.$ref !== undefined) {
    const n = refName(schema.$ref)
    if (ctx.registry.hasWire(n)) {
      if (ctx.dir === 'from' || ctx.dir === 'both') ctx.trackWireFns?.add(`fromWire${n}`)
      return `fromWire${n}(${wAccess})`
    }
    return wAccess
  }

  const t = baseType(schema)
  if (t === 'object') {
    if (schema.properties && Object.keys(schema.properties).length > 0) {
      return ctx.registry.hasWire(base) ? `fromWire${base}(${wAccess})` : wAccess
    }
    return wAccess
  }
  if (t === 'record') return recordFromExpr(schema, base, wAccess, ctx)
  if (t === 'array') {
    const items = schema.items
    if (items === undefined) throw new Error('array schema without items')
    const fn = itemWireFn(items, base, ctx, 'from')
    if (fn === null) return wAccess
    const inner = fn === 'DATE' ? 'new Date(x)' : `${fn}(x)`
    return `(${wAccess} as any[]).map((x) => ${inner})`
  }
  if (t === null) return wAccess
  if (schema.format === 'date-time') return `new Date(${wAccess})`
  return wAccess
}

function recordFromExpr(schema: JSON, base: string, wAccess: string, ctx: RenderCtx): string {
  const addl = schema.additionalProperties
  if (
    addl === true ||
    (typeof addl === 'object' && addl !== null && Object.keys(addl).length === 0)
  ) {
    return wAccess
  }
  const fn = itemWireFn(addl, base, ctx, 'from')
  if (fn === null) return wAccess
  const inner = fn === 'DATE' ? 'new Date(val)' : `${fn}(val)`
  return `Object.fromEntries(Object.entries(${wAccess} ?? {}).map(([k, val]) => [k, ${inner}]))`
}

// renderNamedType renders the complete block for a named type: nested types
// (post-order), the type definition, and its wire transform functions.
export function renderNamedType(name: string, schema: JSON, ctx: RenderCtx, doc: string): string {
  if (schema.$ref !== undefined) {
    throw new Error(`pure $ref schemas are not supported: ${name}`)
  }
  ctx.registry.declare(name, schema)

  const t = baseType(schema)
  const docStr = doc ? `${doc}\n` : ''
  const parts: string[] = []

  if (t === 'object' && schema.properties && Object.keys(schema.properties).length > 0) {
    const props = sortedProps(schema)
    const required = new Set<string>(schema.required ?? [])
    const descs = props.map(([w, p]) => buildPropDesc(ctx, name, p, w, required.has(w)))

    const fields = descs
      .map((d) => {
        const opt = d.required ? '' : '?'
        const nul = d.nullable ? ' | null' : ''
        return `${d.doc ? `${d.doc}\n` : ''}  ${d.tsName}${opt}: ${d.typeExpr}${nul}`
      })
      .join('\n')
    parts.push(`${docStr}export interface ${name} {\n${fields}\n}\n`)

    if (ctx.dir === 'to' || ctx.dir === 'both') parts.push(renderToWireFn(name, descs))
    if (ctx.dir === 'from' || ctx.dir === 'both') parts.push(renderFromWireObject(name, descs))
    return parts.join('\n')
  }

  if (t === 'array') {
    const items = schema.items
    if (items === undefined) throw new Error('array schema without items')
    const base = `${name}Items`
    const te = typeExpr(items, base, ctx)
    parts.push(`${docStr}export type ${name} = ${te}\n`)
  } else if (t === 'record') {
    const base = `${name}Value`
    parts.push(`${docStr}export type ${name} = ${recordExpr(schema, base, ctx)}\n`)
  } else if (t === null) {
    parts.push(
      `${docStr}export type ${name} = ${schema.format === 'date-time' ? 'Date' : 'unknown'}\n`,
    )
  } else {
    parts.push(`${docStr}export type ${name} = ${enumUnion(schema) ?? scalarType(schema)}\n`)
  }

  if (ctx.registry.hasWire(name)) {
    if (ctx.dir === 'to' || ctx.dir === 'both') parts.push(renderToWireOther(name, schema, ctx))
    if (ctx.dir === 'from' || ctx.dir === 'both') parts.push(renderFromWireOther(name, schema, ctx))
  }
  return parts.join('\n')
}

// renderToWireFn renders a toWire function over a set of field descriptors
// (used for object types and for generated request types).
export function renderToWireFn(
  name: string,
  descs: Array<{ tsName: string; wireName: string; nullable: boolean; toExpr: string }>,
): string {
  const lines = descs
    .map((d) => {
      const val = `v.${d.tsName}`
      const expr = d.nullable ? `${val} === null ? null : ${d.toExpr}` : d.toExpr
      return `  if (${val} !== undefined) o['${d.wireName}'] = ${expr}`
    })
    .join('\n')
  return `/** @internal */\nexport function toWire${name}(v: ${name}): Record<string, unknown> {\n  const o: Record<string, unknown> = {}\n${lines}\n  return o\n}\n`
}

function renderFromWireObject(name: string, descs: PropDesc[]): string {
  const lines = descs
    .map((d) => {
      const w = `w['${d.wireName}']`
      return d.required
        ? `  v.${d.tsName} = ${d.fromExpr}`
        : `  if (${w} !== undefined) v.${d.tsName} = ${d.fromExpr}`
    })
    .join('\n')
  return `/** @internal */\nexport function fromWire${name}(w: any): ${name} {\n  const v = {} as ${name}\n${lines}\n  return v\n}\n`
}

function renderToWireOther(name: string, schema: JSON, ctx: RenderCtx): string {
  const t = baseType(schema)
  if (t === 'array' || t === 'record') {
    return otherWireFn(name, schema, t, 'to', ctx)
  }
  // date alias
  return `/** @internal */\nexport function toWire${name}(v: ${name}): string {\n  return v.toISOString()\n}\n`
}

function renderFromWireOther(name: string, schema: JSON, ctx: RenderCtx): string {
  const t = baseType(schema)
  if (t === 'array' || t === 'record') {
    return otherWireFn(name, schema, t, 'from', ctx)
  }
  return `/** @internal */\nexport function fromWire${name}(w: any): ${name} {\n  return new Date(w)\n}\n`
}

// otherWireFn renders the wire transform for top-level array/record types.
function otherWireFn(
  name: string,
  schema: JSON,
  t: 'array' | 'record',
  dir: 'to' | 'from',
  ctx: RenderCtx,
): string {
  const base = t === 'array' ? `${name}Items` : `${name}Value`
  const valueSchema = t === 'array' ? schema.items : schema.additionalProperties

  const fn = itemWireFn(valueSchema, base, ctx, dir)
  if (dir === 'to') {
    if (fn === null) {
      return `/** @internal */\nexport function toWire${name}(v: ${name}): unknown[] {\n  return v\n}\n`
    }
    const inner = fn === 'DATE' ? 'x.toISOString()' : `${fn}(x)`
    if (t === 'array') {
      return `/** @internal */\nexport function toWire${name}(v: ${name}): unknown[] {\n  return v.map((x) => ${inner})\n}\n`
    }
    return `/** @internal */\nexport function toWire${name}(v: ${name}): Record<string, unknown> {\n  return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, ${inner}]))\n}\n`
  }

  if (fn === null) {
    return `/** @internal */\nexport function fromWire${name}(w: any): ${name} {\n  return w\n}\n`
  }
  const inner = fn === 'DATE' ? 'new Date(x)' : `${fn}(x)`
  if (t === 'array') {
    return `/** @internal */\nexport function fromWire${name}(w: any): ${name} {\n  return (w as any[]).map((x) => ${inner})\n}\n`
  }
  return `/** @internal */\nexport function fromWire${name}(w: any): ${name} {\n  return Object.fromEntries(Object.entries(w ?? {}).map(([k, x]) => [k, ${inner}]))\n}\n`
}
