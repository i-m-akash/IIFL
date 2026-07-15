import { useEffect, useState } from 'react'
import { apiUrl } from '@/lib/api'
import { applyPrimaryBrandFromHex, clearPrimaryBrandCss } from '@/lib/brandCss'

const DEFAULT_TITLE = 'Verbalyze'
const DEFAULT_FAVICON = '/favicon.svg'

function getFaviconLink() {
  let link = document.querySelector("link[rel~='icon']") as HTMLLinkElement | null
  if (!link) {
    link = document.createElement('link')
    link.rel = 'icon'
    document.head.appendChild(link)
  }
  return link
}

function applyBrowserBranding(title: string, faviconHref?: string | null) {
  document.title = title || DEFAULT_TITLE
  getFaviconLink().href = faviconHref || DEFAULT_FAVICON
}

function resetBrowserBranding() {
  document.title = DEFAULT_TITLE
  getFaviconLink().href = DEFAULT_FAVICON
}

export function usePublicAdminBranding(adminSlug: string | undefined, enabled = true) {
  const [adminName, setAdminName] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [found, setFound] = useState(true)

  useEffect(() => {
    if (!adminSlug) {
      setAdminName('')
      setLoading(false)
      setFound(true)
      clearPrimaryBrandCss()
      resetBrowserBranding()
      return
    }

    if (!enabled) {
      setAdminName('')
      setLoading(false)
      setFound(true)
      clearPrimaryBrandCss()
      resetBrowserBranding()
      return
    }

    let cancelled = false
    setLoading(true)
    applyBrowserBranding(adminSlug)

    void (async () => {
      try {
        const res = await fetch(apiUrl(`/api/public/admin/${encodeURIComponent(adminSlug)}`))
        const json = (await res.json()) as {
          success?: boolean
          data?: {
            adminName?: string
            name?: string
            primaryColor?: string | null
            logoUrl?: string | null
            navBgColor?: string | null
          }
        }
        if (cancelled) return
        if (json.success && json.data) {
          const nextName = json.data.adminName || json.data.name || adminSlug
          setAdminName(nextName)
          setFound(true)
          applyPrimaryBrandFromHex(json.data.primaryColor ?? undefined, json.data.navBgColor ?? undefined)
          applyBrowserBranding(nextName, json.data.logoUrl)
        } else {
          setAdminName(adminSlug)
          setFound(false)
          clearPrimaryBrandCss()
          applyBrowserBranding(adminSlug)
        }
      } catch {
        if (!cancelled) {
          setAdminName(adminSlug)
          setFound(false)
          clearPrimaryBrandCss()
          applyBrowserBranding(adminSlug)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
      clearPrimaryBrandCss()
      resetBrowserBranding()
    }
  }, [adminSlug, enabled])

  return { adminName, loading, found }
}
