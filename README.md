# Exoscale SDK for TypeScript

A TypeScript SDK for the [Exoscale API](https://community.exoscale.com/reference/api/).

API reference: <https://exoscale.github.io/exoscale-sdk-ts/>

- Exposes a flat `ExoscaleClient` with one method per API operation, driven by
  the upstream API spec.
- One runtime dependency: `@noble/hashes` (pure-JS HMAC-SHA256, browser and Node)
  plus global `fetch`
- ESM only, `Node >= 18`

## Install

```sh
npm install @exoscale/sdk
```

## Quick start

```ts
import { ExoscaleClient } from '@exoscale/sdk'

// Credentials come from the EXOSCALE_API_KEY / EXOSCALE_API_SECRET
// environment variables, or pass them explicitly:
const client = new ExoscaleClient()
// const client = new ExoscaleClient({ apiKey: '...', apiSecret: '...' })

// All parameters (path + query + body) are one object:
const op = await client.createInstance({
  name: 'my-instance',
  diskSize: 10,
  template: { id: '877859b9-f12f-4b16-a3bb-295bc4408db0' },
  instanceType: { id: 'e00-c3' },
})

// Wait until the operation succeeds (rejects on failure/timeout):
const done = await client.waitForOperation(op)
const instance = await client.getInstance({ id: done.reference!.id! })
```

### Zones

The default endpoint is `ch-gva-2`. Other zones:

```ts
const client = new ExoscaleClient({ endpoint: ENDPOINTS['de-fra-1'] })
// or discover them dynamically:
const name = await client.getZoneName('https://api-ch-dk-2.exoscale.com/v2') // 'ch-dk-2'
const endpoint = await client.getZoneAPIEndpoint('de-fra-1')
```

### IAM Assume-role

```ts
const client = await ExoscaleClient.withRole({
  apiKey: '...',
  apiSecret: '...',
  roleID: '0b12cb6b-7e3e-4c0e-9e10-1e5d8a7c4b2a',
  ttl: 3600,
})
```

### Errors

```ts
import { APIError } from '@exoscale/sdk'

try {
  await client.getInstance({ id: 'missing' })
} catch (e) {
  if (APIError.isNotFound(e)) {
    console.log(e.status) // 404
    console.log(e.message) // 'Not Found: ...'
    console.log(e.entries) // structured RFC 9457 error details
  }
}
```

## Development

```sh
npm install
npm run pull-spec   # refresh spec/openapi.json from the API
npm run generate    # regenerate src/generated/ from spec + overrides
npm test            # unit + generator tests (live tests need credentials)
npm run build       # bundle to dist/
```

Live integration tests (`test/integration.test.ts`) create and destroy a real
instance and only run when `EXOSCALE_API_KEY` and `EXOSCALE_API_SECRET` are set.

## How generation works

`generator/` is a small TypeScript generator (dev-only, run via `tsx`) that
reads the committed `spec/openapi.json`, applies `spec/overrides.json`, and
emits `src/generated/schemas.ts` (types + wire transforms) and
`src/generated/operations.ts` (the `GeneratedExoscaleClient` base class with
one method per operation).

`spec/openapi.json` is a verbatim copy of the upstream spec (refreshed by
`npm run pull-spec`). Known upstream spec inaccuracies are not fixed there;
they are recorded in `spec/overrides.json` as an RFC 6902 JSON Patch — a small
set of `add`/`remove`/`replace` ops, each carrying a `reason`. The generator
fails if an override no longer matches the upstream spec, so stale overrides
get removed as soon as upstream is fixed.

Generation is deterministic: sorted iteration everywhere, no timestamps, and
output normalized with a pinned Prettier configuration. `test/generator.test.ts`
verifies byte-identical re-runs, full operation/schema coverage, and that the
committed generated code is in sync with the spec.

Request shapes follow the Exoscale conventions:

- inline request bodies are merged into a generated `<Op>Request` interface
  (path params + query params + body fields);
- `$ref` request bodies reuse the referenced schema type (intersected with
  path/query params when needed);
- responses decode into schema types, with `<Op>Response` types generated for
  inline response bodies.

## License

Apache 2.0 — see [LICENSE](LICENSE).
