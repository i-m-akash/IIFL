import { Shield, KeyRound, Bell } from 'lucide-react'
import { Link } from 'react-router-dom'
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

export default function SettingsPage() {
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
        <main className="mx-auto max-w-4xl px-4 py-8">
            <div className="mb-8">
                <h1 className="text-2xl font-bold text-slate-900">Workspace Settings</h1>
                <p className="mt-1 text-sm text-slate-500">Configure your workspace and preferences.</p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
                {sections.map((section) => {
                    const Icon = section.icon
                    const inner = (
                        <>
                            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-600 transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                                <Icon className="h-6 w-6" />
                            </span>
                            <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                    <h2 className="text-base font-semibold text-slate-900">{section.title}</h2>
                                    {section.badge && (
                                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">
                                            {section.badge}
                                        </span>
                                    )}
                                </div>
                                <p className="mt-1 text-sm text-slate-500">{section.description}</p>
                            </div>
                        </>
                    )

                    return section.href ? (
                        <Link
                            key={section.id}
                            to={section.href}
                            className={cn(
                                'group flex items-start gap-4 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm transition-all duration-200',
                                'hover:border-primary/20 hover:shadow-md active:scale-[0.99]'
                            )}
                        >
                            {inner}
                        </Link>
                    ) : (
                        <div
                            key={section.id}
                            className="group flex cursor-default items-start gap-4 rounded-3xl border border-slate-200 bg-slate-50 p-6 opacity-70 shadow-sm"
                        >
                            {inner}
                        </div>
                    )
                })}
            </div>
        </main>
    )
}
