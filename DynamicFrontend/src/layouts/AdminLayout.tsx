import { Navigate, Outlet, useLocation, useParams } from 'react-router-dom'
import { useAuth } from '../providers/AuthProvider'
import Navbar from '../components/Navbar'
import { usePublicAdminBranding } from '@/hooks/usePublicAdminBranding'
import { getDefaultAuthorizedPath } from '@/lib/roles'

export function AdminLayout() {
  const { adminSlug } = useParams()
  const { user, isAuthenticated, loading } = useAuth()
  const location = useLocation()
  const base = `/${adminSlug}`
  const changePasswordPath = `${base}/change-password`

  const brandingEnabled = !loading && isAuthenticated && !!user && user.adminSlug === adminSlug
  usePublicAdminBranding(adminSlug, brandingEnabled)

  if (!adminSlug) return <Navigate to="/" replace />

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-slate-600">Loading…</p>
      </div>
    )
  }

  if (!isAuthenticated || !user) {
    return <Navigate to="/signin" replace />
  }

  if (user.adminSlug !== adminSlug) {
    return <Navigate to={getDefaultAuthorizedPath(user)} replace />
  }

  if (user.mustChangePassword && location.pathname !== changePasswordPath) {
    return <Navigate to={changePasswordPath} replace />
  }

  const showNavbar = !(user.mustChangePassword && location.pathname === changePasswordPath)

  return (
    <div className="min-h-screen bg-gray-50">
      {showNavbar ? <Navbar basePath={base} /> : null}
      <Outlet />
    </div>
  )
}
