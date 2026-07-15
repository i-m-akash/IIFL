import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './providers/AuthProvider'
import { AdminLayout } from './layouts/AdminLayout'
import RequireAccess from './components/auth/RequireAccess'
import SignIn from './pages/SignIn'
import AIAgents from './pages/AIAgents'
import Campaigns from './pages/Campaigns'
import ChangePassword from './pages/ChangePassword'
import SettingsUsers from './pages/SettingsUsers'
import SettingsPage from './pages/SettingsPage'
import BillingReportPage from './pages/BillingReportPage'
import QuickSettings from './pages/QuickSettings'
import { useAuth } from './providers/AuthProvider'
import { canViewAgents, canViewCampaigns, canViewSettings, getDefaultAuthorizedPath } from './lib/roles'

function AdminIndexRedirect() {
  const { user, loading } = useAuth()

  if (loading) return null
  if (!user) return <Navigate to="/signin" replace />
  return <Navigate to={getDefaultAuthorizedPath(user)} replace />
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Navigate to="/signin" replace />} />
          <Route path="/signin" element={<SignIn />} />
          <Route path="/:adminSlug" element={<AdminLayout />}>
            <Route path="change-password" element={<ChangePassword />} />
            <Route
              path="ai-agents/*"
              element={
                <RequireAccess allow={canViewAgents}>
                  <AIAgents />
                </RequireAccess>
              }
            />
            <Route
              path="campaigns/*"
              element={
                <RequireAccess allow={canViewCampaigns}>
                  <Campaigns />
                </RequireAccess>
              }
            />
            <Route path="settings">
              <Route
                index
                element={
                  <RequireAccess allow={canViewSettings}>
                    <SettingsPage />
                  </RequireAccess>
                }
              />
              <Route
                path="users"
                element={
                  <RequireAccess allow={canViewSettings}>
                    <SettingsUsers />
                  </RequireAccess>
                }
              />
            </Route>
            <Route
              path="billing-report"
              element={
                <RequireAccess allow={canViewSettings}>
                  <BillingReportPage />
                </RequireAccess>
              }
            />
            <Route index element={<AdminIndexRedirect />} />
            <Route path="*" element={<AdminIndexRedirect />} />
          </Route>
          <Route path="*" element={<Navigate to="/signin" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
