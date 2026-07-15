import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../providers/AuthProvider'
import { Bell, Menu, X, LogOut } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { canViewAgents, canViewCampaigns, canViewSettings, getDefaultAuthorizedPath } from '@/lib/roles'
import { cn } from '@/lib/utils'
import { apiFetch } from '@/lib/api'
import HamburgerMenu from '@/components/HamburgerMenu'

type NavbarProps = {
  basePath: string
  className?: string
}

type NotificationItem = {
  id: string
  action: string
  title: string
  message: string
  createdAt: string
}

function formatRelativeTime(value: string) {
  const time = new Date(value).getTime()
  const diffMinutes = Math.max(0, Math.round((Date.now() - time) / 60000))
  if (diffMinutes < 1) return 'Just now'
  if (diffMinutes < 60) return `${diffMinutes}m ago`
  const diffHours = Math.round(diffMinutes / 60)
  if (diffHours < 24) return `${diffHours}h ago`
  const diffDays = Math.round(diffHours / 24)
  return `${diffDays}d ago`
}

export default function Navbar({ basePath, className }: NavbarProps) {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false)
  const [notifications, setNotifications] = useState<NotificationItem[]>([])
  const [seenCount, setSeenCount] = useState(0)
  const [failedLogoUrl, setFailedLogoUrl] = useState<string | null>(null)
  const notificationsRef = useRef<HTMLDivElement | null>(null)
  const { user, logout } = useAuth()
  const logoUrl = user?.adminLogoUrl?.trim()
  const showLogo = Boolean(logoUrl) && failedLogoUrl !== logoUrl

  const location = useLocation()
  const navigate = useNavigate()

  const navigation = [
    canViewAgents(user?.role ?? 'admin') ? { name: 'Ai Agents', href: `${basePath}/ai-agents` } : null,
    canViewCampaigns(user?.role ?? 'admin') ? { name: 'Campaigns', href: `${basePath}/campaigns` } : null,
    canViewSettings(user?.role ?? 'admin') ? { name: 'Settings', href: `${basePath}/settings/users`, iconOnly: true } : null,
  ].filter(Boolean) as Array<{ name: string; href: string; iconOnly?: boolean }>

  const handleLogout = () => {
    logout()
    navigate('/signin')
  }

  useEffect(() => {
    if (!user) return
    let cancelled = false

    void (async () => {
      try {
        const response = await apiFetch('/api/notifications?limit=8')
        const result = (await response.json().catch(() => null)) as { success?: boolean; data?: NotificationItem[] } | null
        if (!cancelled && response.ok && result?.success && Array.isArray(result.data)) {
          setNotifications(result.data)
        }
      } catch (error) {
        console.error('Failed to load notifications', error)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [user, location.pathname])

  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      if (notificationsRef.current && !notificationsRef.current.contains(event.target as Node)) {
        setIsNotificationsOpen(false)
      }
    }

    document.addEventListener('mousedown', handleOutsideClick)
    return () => document.removeEventListener('mousedown', handleOutsideClick)
  }, [])

  const isActive = (href: string, iconOnly?: boolean) =>
    iconOnly ? location.pathname.startsWith(`${basePath}/settings`) : location.pathname.startsWith(href)
  const homeHref = user ? getDefaultAuthorizedPath(user) : `${basePath}/ai-agents`
  const unreadCount = useMemo(() => Math.max(0, notifications.length - seenCount), [notifications, seenCount])

  const textNavigation = navigation.filter((item) => !item.iconOnly)
  const iconActionClass =
    'inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-nav-foreground/90 transition-colors hover:bg-nav-foreground/10 hover:text-nav-foreground'
  const iconClass = 'h-[1.125rem] w-[1.125rem] stroke-[2]'

  return (
    <>
      <nav
        className={cn(
          'fixed left-0 right-0 top-0 z-50 border-b border-nav/15 bg-nav text-nav-foreground shadow-md',
          className
        )}
      >
        <div className="w-full">
          <div className="flex h-16 items-center justify-between px-4">
            {/* Logo */}
            <div className="flex shrink-0 items-center">
              <Link to={homeHref} className="flex items-center gap-3">
                {showLogo ? (
                  <img
                    src={logoUrl}
                    alt=""
                    className="h-9 max-w-[140px] object-contain object-left"
                    onError={() => setFailedLogoUrl(logoUrl ?? null)}
                  />
                ) : null}
              </Link>
            </div>

            <div className="hidden min-w-0 flex-1 md:block" />

            {/* Desktop nav: [AI Agents] [Campaigns] | [Bell] [☰] */}
            <div className="hidden h-16 shrink-0 items-center md:flex">
              {/* Text nav links */}
              <div className="flex h-full items-center">
                {textNavigation.map((item, index) => (
                  <div key={item.name} className="flex h-full items-center">
                    <Link
                      to={item.href}
                      className={cn(
                        'inline-flex h-16 items-center px-4 text-base font-medium leading-none text-nav-foreground transition-colors hover:bg-nav-foreground/10',
                        isActive(item.href) ? 'font-semibold' : 'font-normal'
                      )}
                    >
                      {item.name}
                    </Link>
                    {index < textNavigation.length - 1 ? <div className="h-5 w-px bg-nav-foreground/20" /> : null}
                  </div>
                ))}
              </div>

              {/* Divider */}
              <div className="mx-3 h-5 w-px bg-nav-foreground/15" />

              {/* Bell + Hamburger */}
              <div className="flex h-full items-center gap-0.5">
                {/* Notification Bell */}
                <div ref={notificationsRef} className="relative">
                  <button
                    type="button"
                    onClick={() => {
                      setIsNotificationsOpen((current) => {
                        if (!current) setSeenCount(notifications.length)
                        return !current
                      })
                    }}
                    className={cn(iconActionClass, 'relative')}
                    aria-label="Notifications"
                  >
                    <Bell className={iconClass} />
                    {unreadCount > 0 ? (
                      <span className="absolute right-1.5 top-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-emerald-500 px-1 text-[10px] font-semibold text-white">
                        {Math.min(unreadCount, 9)}
                      </span>
                    ) : null}
                  </button>
                  {isNotificationsOpen ? (
                    <div className="absolute right-0 top-12 z-50 w-[320px] rounded-2xl border border-slate-200 bg-white p-3 text-slate-900 shadow-2xl">
                      <div className="mb-2 flex items-center justify-between px-2 py-1">
                        <div>
                          <div className="text-sm font-semibold">Activity Logger</div>
                          <div className="text-xs text-slate-500">Recent agent changes for your workspace</div>
                        </div>
                      </div>
                      <div className="max-h-[360px] space-y-2 overflow-y-auto">
                        {notifications.length === 0 ? (
                          <div className="rounded-xl bg-slate-50 px-3 py-4 text-sm text-slate-500">No recent logger entries.</div>
                        ) : (
                          notifications.map((item) => (
                            <div key={item.id} className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-3">
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <div className="text-sm font-semibold text-slate-900">{item.title}</div>
                                  <div className="mt-1 text-xs leading-relaxed text-slate-600">{item.message}</div>
                                </div>
                                <span className="shrink-0 text-[11px] text-slate-400">{formatRelativeTime(item.createdAt)}</span>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  ) : null}
                </div>

                {/* Hamburger Menu */}
                <HamburgerMenu />
              </div>
            </div>

            {/* Mobile menu toggle */}
            <div className="md:hidden">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                className="text-nav-foreground hover:bg-nav-foreground/10"
                aria-label="Open menu"
              >
                <Menu className="h-6 w-6" />
              </Button>
            </div>
          </div>
        </div>
      </nav>

      <div className="h-16" />

      {isMobileMenuOpen && (
        <motion.div
          initial={{ opacity: 0, x: '100%' }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: '100%' }}
          className="fixed right-0 top-16 z-50 h-full w-64 bg-card text-card-foreground shadow-2xl md:hidden"
        >
          <div className="p-4">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold">Menu</h3>
              <Button type="button" variant="ghost" size="icon" onClick={() => setIsMobileMenuOpen(false)} aria-label="Close menu">
                <X className="h-5 w-5" />
              </Button>
            </div>
            <div className="space-y-2">
              {navigation.map((item) => (
                <Link
                  key={item.name}
                  to={item.href}
                  className={cn(
                    'block rounded-lg px-3 py-2 text-base font-medium transition-colors',
                    isActive(item.href, item.iconOnly) ? 'bg-accent font-semibold text-accent-foreground' : 'text-muted-foreground hover:bg-muted'
                  )}
                  onClick={() => setIsMobileMenuOpen(false)}
                  aria-label={item.iconOnly ? item.name : undefined}
                >
                  <span className="inline-flex items-center gap-2">
                    {item.iconOnly ? 'Users & Access' : item.name}
                  </span>
                </Link>
              ))}
            </div>
            <div className="mt-6 border-t border-border pt-4">
              <Button
                type="button"
                variant="ghost"
                className="w-full justify-start gap-2 text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={() => {
                  handleLogout()
                  setIsMobileMenuOpen(false)
                }}
              >
                <LogOut className="h-4 w-4" />
                Log out
              </Button>
            </div>
          </div>
        </motion.div>
      )}
    </>
  )
}
