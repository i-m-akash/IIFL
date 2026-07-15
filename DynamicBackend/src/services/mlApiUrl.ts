import type { AppEnv } from '../types'

/** Safe to use for fetch — null if missing or placeholder. */
export function validateMlApiUrl(rawUrl: string | undefined) {
  if (!rawUrl) {
    return null
  }

  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new Error(`ML API URL is not valid: ${rawUrl}`)
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error(`ML API URL must use http or https: ${rawUrl}`)
  }

  const hostname = url.hostname.toLowerCase()
  if (
    hostname.includes('your-z99-url.com') ||
    hostname === 'example.com' ||
    hostname.includes('placeholder') ||
    hostname.includes('localhost') ||
    hostname.includes('127.0.0.1')
  ) {
    return null
  }

  return url.toString()
}

export type AdminMlRouting = {
  mlApiUrl?: string | null
  datasourceBinding?: string | null
  slug?: string | null
}

/**
 * Order: `admins.ml_api_url` → env `ML_API_{SLUG}`/`ML_API_URL_{SLUG}` → env `ML_API_URL_{DATASOURCE_BINDING}` → `ML_API_URL`.
 */
export function resolveMlApiUrlForAdmin(env: AppEnv['Bindings'], admin: AdminMlRouting | undefined): string | null {
  const fromAdmin = admin?.mlApiUrl?.trim()
  if (fromAdmin) return validateMlApiUrl(fromAdmin)

  // 1. Resolve by slug (fallback matching variations like ML_API_IIFL, ml_api_iifl, ML_API_URL_IIFL, etc.)
  const slug = admin?.slug?.trim()
  if (slug) {
    const cleanSlug = slug.replace(/[^a-zA-Z0-9_]/g, '')
    const baseSlug = cleanSlug.toUpperCase()
    
    const variations = [baseSlug]
    
    // Support aliases/shorthands for seeded admin names
    if (baseSlug.includes('IIFL')) {
      variations.push('IIFL')
    }
    if (baseSlug.includes('TOWNER')) {
      variations.push('TOWNER')
    }
    if (baseSlug.includes('GENERAL_HVAC')) {
      variations.push('FUJITSU')
      variations.push('GENERAL_HVAC')
    }

    for (const variant of variations) {
      const keys = [
        `ML_API_${variant}`,
        `ML_API_URL_${variant}`,
        `ml_api_${variant.toLowerCase()}`,
        `ml_api_url_${variant.toLowerCase()}`,
      ]
      for (const key of keys) {
        const v = env[key as keyof AppEnv['Bindings']]
        if (typeof v === 'string' && v.trim().length > 0) {
          return validateMlApiUrl(v.trim())
        }
      }
    }
  }

  // 2. Resolve by datasource binding (e.g. ML_API_URL_ACCELBIZ_DB)
  const binding = admin?.datasourceBinding?.trim()
  if (binding) {
    const key = `ML_API_URL_${binding}`
    const v = env[key as keyof AppEnv['Bindings']]
    if (typeof v === 'string' && v.trim().length > 0) {
      return validateMlApiUrl(v.trim())
    }
  }

  return validateMlApiUrl(env.ML_API_URL)
}
