import { Shield, KeyRound, Bell, ArrowLeft } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '@/providers/AuthProvider'
import { cn } from '@/lib/utils'

type SettingsSection = {
    id: string
    icon: React.ElementType
    title: string
    description: string
    href?: string
    badge?: string
}

export default function QuickSettings() {
    const navigate = useNavigate()
    const { user } = useAuth()
    const adminSlug = user?.adminSlug ?? ''

    const sections: SettingsSection[] = [
        {
            id: 'users-access',
            icon: Shield,
            title: 'Users & Access',
            description: 'Manage roles, statuses, and team member passwords.',
            href: `/${adminSlug}/settings/users`,
        },
        {
            id: 'change-password',
            icon: KeyRound,
            title: 'Change Password',
            description: 'Update your admin account password.',
            href: `/${adminSlug}/change-password`,
        },
        {
            id: 'notifications',
            icon: Bell,
            title: 'Notifications',
            description: 'Activity log and workspace change history.',
            badge: 'View only',
        },
    ]

    return (
        <div className="flex h-full flex-col bg-slate-50">
            {/* Header */}
            <div className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-white px-6 py-4 shadow-sm">
                <div className="flex items-center gap-4">
                    <button
                        onClick={() => navigate(-1)}
                        className="flex h-10 w-10 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
                        aria-label="Go back"
                    >
                        <ArrowLeft className="h-5 w-5" />
                    </button>
                    <div>
                        <h1 className="text-lg font-semibold text-slate-900">Settings</h1>
                        <p className="text-sm text-slate-500">Workspace configuration</p>
                    </div>
                </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto">
                <div className="p-6">
                    <div className="space-y-3 max-w-2xl">
                        {sections.map((section) => {
                            const Icon = section.icon
                            const inner = (
                                <>
                                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-600 transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                                        <Icon className="h-5 w-5" />
                                    </span>
                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-center gap-2">
                                            <p className="text-sm font-semibold text-slate-900">{section.title}</p>
                                            {section.badge && (
                                                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">
                                                    {section.badge}
                                                </span>
                                            )}
                                        </div>
                                        <p className="mt-0.5 text-xs text-slate-500">{section.description}</p>
                                    </div>
                                </>
                            )

                            return section.href ? (
                                <Link
                                    key={section.id}
                                    id={`settings-item-${section.id}`}
                                    to={section.href}
                                    className={cn(
                                        'group flex items-center gap-4 rounded-2xl border border-slate-100 bg-white p-4 transition-all duration-150',
                                        'hover:border-primary/20 hover:bg-slate-50 hover:shadow-sm active:scale-[0.99]'
                                    )}
                                >
                                    {inner}
                                </Link>
                            ) : (
                                <div
                                    key={section.id}
                                    id={`settings-item-${section.id}`}
                                    className="group flex cursor-default items-center gap-4 rounded-2xl border border-slate-100 bg-white p-4 opacity-70"
                                >
                                    {inner}
                                </div>
                            )
                        })}
                    </div>
                </div>
            </div>
        </div>
    )
}
