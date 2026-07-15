import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '@/providers/AuthProvider'
import { getDefaultAuthorizedPath, type UserRole } from '@/lib/roles'

type RequireAccessProps = {
  allow: (role: UserRole) => boolean
  children: ReactNode
}

export default function RequireAccess({ allow, children }: RequireAccessProps) {
  const { user, isAuthenticated, loading } = useAuth()

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center bg-gray-50">
        <p className="text-slate-600">Loading…</p>
      </div>
    )
  }

  if (!isAuthenticated || !user) {
    return <Navigate to="/signin" replace />
  }

  if (!allow(user.role)) {
    return <Navigate to={getDefaultAuthorizedPath(user)} replace />
  }

  return <>{children}</>
}
