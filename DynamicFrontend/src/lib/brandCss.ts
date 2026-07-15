const VAR_KEYS = ['--primary', '--primary-foreground', '--ring'] as const

export function hexToHslTriplet(hex: string): string | null {
  let h = hex.trim().replace(/^#/, '')
  if (h.length === 3) {
    h = h
      .split('')
      .map((c) => c + c)
      .join('')
  }
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null
  const r = parseInt(h.slice(0, 2), 16) / 255
  const g = parseInt(h.slice(2, 4), 16) / 255
  const b = parseInt(h.slice(4, 6), 16) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  let H = 0
  let s = 0
  const l = (max + min) / 2
  const d = max - min
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    switch (max) {
      case r:
        H = ((g - b) / d + (g < b ? 6 : 0)) / 6
        break
      case g:
        H = ((b - r) / d + 2) / 6
        break
      default:
        H = ((r - g) / d + 4) / 6
        break
    }
  }
  const Hdeg = Math.round(H * 360 * 10) / 10
  const S = Math.round(s * 100 * 10) / 10
  const L = Math.round(l * 100 * 10) / 10
  return `${Hdeg} ${S}% ${L}%`
}

/** Readable on top of `primary` (shadcn-style slate pairs). */
export function primaryForegroundForTriplet(primaryTriplet: string): string {
  const parts = primaryTriplet.trim().split(/\s+/)
  const lStr = parts[2] ?? '0%'
  const L = parseFloat(lStr.replace('%', ''))
  return L > 52 ? '222.2 47.4% 11.2%' : '210 40% 98%'
}

/** Search fields: tenant primary tints border/ring via CSS vars set in AdminLayout. */
export const brandSearchInputClass =
  'border-primary/30 focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring'

export function applyPrimaryBrandFromHex(primaryHex: string | null | undefined, navHex?: string | null | undefined): void {
  if (!primaryHex) return
  const triplet = hexToHslTriplet(primaryHex)
  if (!triplet) return
  const root = document.documentElement
  root.style.setProperty('--primary', triplet)
  root.style.setProperty('--primary-foreground', primaryForegroundForTriplet(triplet))
  root.style.setProperty('--ring', triplet)

  if (navHex) {
    const navTriplet = hexToHslTriplet(navHex)
    if (navTriplet) {
      root.style.setProperty('--nav', navTriplet)
      root.style.setProperty('--nav-foreground', primaryForegroundForTriplet(navTriplet))
    } else {
      root.style.removeProperty('--nav')
      root.style.removeProperty('--nav-foreground')
    }
  } else {
    root.style.removeProperty('--nav')
    root.style.removeProperty('--nav-foreground')
  }
}

export function clearPrimaryBrandCss(): void {
  const root = document.documentElement
  for (const k of [...VAR_KEYS, '--nav', '--nav-foreground']) {
    root.style.removeProperty(k)
  }
}
