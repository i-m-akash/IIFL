import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Menu, Settings, BarChart3, LogOut } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/providers/AuthProvider'
import { cn } from '@/lib/utils'

type HamburgerMenuProps = {
    className?: string
}

type MenuItem = {
    id: string
    label: string
    icon: React.ElementType
    description: string
    href?: string
    action?: () => void
    isDanger?: boolean
}

export default function HamburgerMenu({ className }: HamburgerMenuProps) {
    const navigate = useNavigate()
    const { user, logout } = useAuth()
    const [isOpen, setIsOpen] = useState(false)
    const menuRef = useRef<HTMLDivElement | null>(null)
    const adminSlug = user?.adminSlug ?? ''

    // Close on outside click
    useEffect(() => {
        const handleOutsideClick = (event: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                setIsOpen(false)
            }
        }
        document.addEventListener('mousedown', handleOutsideClick)
        return () => document.removeEventListener('mousedown', handleOutsideClick)
    }, [])

    // Close on Escape key
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setIsOpen(false)
        }
        document.addEventListener('keydown', handleKeyDown)
        return () => document.removeEventListener('keydown', handleKeyDown)
    }, [])

    const handleLogout = () => {
        logout()
        navigate('/signin')
        setIsOpen(false)
    }

    const menuItems: MenuItem[] = [
        {
            id: 'settings',
            label: 'Settings',
            icon: Settings,
            description: 'Manage your workspace settings',
            href: `/${adminSlug}/settings`,
        },
        {
            id: 'billing-report',
            label: 'Billing Report',
            icon: BarChart3,
            description: 'View billing and usage reports',
            href: `/${adminSlug}/billing-report`,
        },
    ]

    const logoutItem: MenuItem = {
        id: 'logout',
        label: 'Logout',
        icon: LogOut,
        description: 'Sign out of your account',
        isDanger: true,
        action: handleLogout,
    }

    const iconActionClass =
        'inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-nav-foreground/90 transition-colors hover:bg-nav-foreground/10 hover:text-nav-foreground'

    const handleMenuItemClick = (item: MenuItem) => {
        if (item.action) {
            item.action()
        } else if (item.href) {
            navigate(item.href)
            setIsOpen(false)
        }
    }

    return (
        <div ref={menuRef} className={cn('relative', className)}>
            {/* Trigger button */}
            <button
                id="hamburger-menu-trigger"
                type="button"
                aria-label="Open menu"
                aria-haspopup="true"
                aria-expanded={isOpen}
                aria-controls="hamburger-menu-dropdown"
                onClick={() => setIsOpen((prev) => !prev)}
                className={cn(
                    iconActionClass,
                    isOpen && 'bg-nav-foreground/10 text-nav-foreground'
                )}
            >
                <motion.div
                    animate={{ rotate: isOpen ? 90 : 0 }}
                    transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
                >
                    <Menu className="h-[1.125rem] w-[1.125rem] stroke-[2]" />
                </motion.div>
            </button>

            {/* Dropdown */}
            <AnimatePresence>
                {isOpen && (
                    <motion.div
                        id="hamburger-menu-dropdown"
                        role="menu"
                        aria-label="Navigation menu"
                        initial={{ opacity: 0, y: -8, scale: 0.96 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -8, scale: 0.96 }}
                        transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
                        className="absolute right-0 top-[calc(100%+8px)] z-50 w-60 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
                    >
                        {/* Header */}
                        <div className="border-b border-slate-100 px-4 py-3">
                            <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">
                                Quick Access
                            </p>
                        </div>

                        {/* Menu items */}
                        <div className="p-2">
                            {menuItems.map((item) => {
                                const Icon = item.icon
                                return (
                                    <button
                                        key={item.id}
                                        id={`hamburger-menu-item-${item.id}`}
                                        type="button"
                                        role="menuitem"
                                        onClick={() => handleMenuItemClick(item)}
                                        className="group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-all duration-150 hover:bg-slate-50 active:scale-[0.98]"
                                    >
                                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600 transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                                            <Icon className="h-4 w-4" />
                                        </span>
                                        <div className="min-w-0">
                                            <p className="text-sm font-medium text-slate-900">{item.label}</p>
                                            <p className="truncate text-xs text-slate-500">{item.description}</p>
                                        </div>
                                    </button>
                                )
                            })}
                        </div>

                        {/* Divider */}
                        <div className="mx-2 border-t border-slate-100" />

                        {/* Logout item */}
                        <div className="p-2">
                            <button
                                id="hamburger-menu-item-logout"
                                type="button"
                                role="menuitem"
                                onClick={() => handleMenuItemClick(logoutItem)}
                                className="group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-all duration-150 hover:bg-red-50 active:scale-[0.98]"
                            >
                                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-red-50 text-red-500 transition-colors group-hover:bg-red-100">
                                    <LogOut className="h-4 w-4" />
                                </span>
                                <div className="min-w-0">
                                    <p className="text-sm font-medium text-red-600">Logout</p>
                                    <p className="truncate text-xs text-slate-500">Sign out of your account</p>
                                </div>
                            </button>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    )
}
