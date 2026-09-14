import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ExoscaleClient } from '../src/index.js'

// Live integration tests. They only run when EXOSCALE_API_KEY and
// EXOSCALE_API_SECRET are set, and create/destroy a real instance in ch-gva-2.
const hasCreds = Boolean(process.env.EXOSCALE_API_KEY && process.env.EXOSCALE_API_SECRET)

const ZONE = 'ch-gva-2' as const

describe.runIf(hasCreds)('integration (live API)', () => {
  let client: ExoscaleClient
  let instanceID: string | undefined

  beforeAll(() => {
    client = new ExoscaleClient()
  })

  afterAll(async () => {
    // Best-effort cleanup if the destroy step did not run.
    if (instanceID !== undefined) {
      try {
        const op = await client.deleteInstance({ id: instanceID })
        await client.waitForOperation(op, ['success'])
      } catch {
        // ignore cleanup failures
      }
    }
  })

  it('listZones works without authentication', async () => {
    const resp = await client.listZones()
    expect(resp.zones?.some((z) => z.name === ZONE)).toBe(true)
  })

  it('listInstances returns an array for valid credentials', async () => {
    const resp = await client.listInstances()
    expect(Array.isArray(resp.instances)).toBe(true)
  })

  it('creates, waits for, reads and destroys an instance', { timeout: 300_000 }, async () => {
    // Pick the smallest authorized instance type available in the zone.
    const types = (await client.listInstanceTypes()).instanceTypes ?? []
    const type = types
      .filter((t) => t.authorized && t.zones?.includes(ZONE))
      .sort((a, b) => (a.memory ?? 0) - (b.memory ?? 0))[0]
    expect(type, 'no authorized instance type in ' + ZONE).toBeDefined()

    // Pick a public template.
    const templates = (await client.listTemplates()).templates ?? []
    const template = templates.find((t) => t.visibility === 'public')
    expect(template, 'no public template').toBeDefined()

    const name = `exoscale-sdk-it-${Date.now()}`
    const op = await client.createInstance({
      name,
      // template size is in bytes; disk-size is in GiB (min 10)
      diskSize: Math.max(Math.ceil((template!.size ?? 0) / 2 ** 30), 10),
      template: { id: template!.id! },
      instanceType: { id: type!.id! },
    })
    const done = await client.waitForOperation(op, ['success'])
    instanceID = done.reference?.id
    expect(instanceID, 'operation has no reference id').toBeDefined()

    const instance = await client.getInstance({ id: instanceID! })
    expect(instance.name).toBe(name)

    const del = await client.deleteInstance({ id: instanceID! })
    await client.waitForOperation(del, ['success'])
    instanceID = undefined
  })
})
