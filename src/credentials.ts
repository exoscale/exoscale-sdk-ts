// Credentials helpers.

export interface Credentials {
  apiKey: string
  apiSecret: string
}

/**
 * envCredentials reads credentials from the EXOSCALE_API_KEY and
 * EXOSCALE_API_SECRET environment variables.
 */
export function envCredentials(): Credentials {
  const apiKey = process.env.EXOSCALE_API_KEY
  const apiSecret = process.env.EXOSCALE_API_SECRET
  if (!apiKey || !apiSecret) {
    throw new Error('incomplete credentials: set EXOSCALE_API_KEY and EXOSCALE_API_SECRET')
  }
  return { apiKey, apiSecret }
}
