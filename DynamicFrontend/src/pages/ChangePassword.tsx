import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertCircle } from 'lucide-react'
import { useAuth } from '@/providers/AuthProvider'
import { getDefaultAuthorizedPath } from '@/lib/roles'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'

export default function ChangePassword() {
  const navigate = useNavigate()
  const { user, changePassword } = useAuth()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const isForcedChange = Boolean(user?.mustChangePassword)
  const backHref = user ? `/${user.adminSlug}/settings/users` : '/signin'
  const helpText = isForcedChange
    ? 'You are using a temporary password. Set a new password to continue.'
    : 'Update your password here.'

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError('')

    if (newPassword.length < 8) {
      setError('New password must be at least 8 characters long.')
      return
    }

    if (newPassword !== confirmPassword) {
      setError('New password and confirm password do not match.')
      return
    }

    setLoading(true)
    const result = await changePassword(currentPassword, newPassword)
    setLoading(false)

    if (!result.success) {
      setError(result.error || 'Unable to change password.')
      return
    }

    toast.success('Password updated successfully.')
    navigate(getDefaultAuthorizedPath(result.user), { replace: true })
  }

  return (
    <div className={isForcedChange ? 'flex min-h-screen items-center justify-center bg-muted/40 p-4' : 'mx-auto max-w-3xl p-4 md:p-6'}>
      <Card className="w-full max-w-lg shadow-lg">
        <CardHeader className="space-y-2">
          {!isForcedChange ? (
            <div className="text-sm text-slate-500">
              <button type="button" className="hover:text-slate-900 hover:underline" onClick={() => navigate(backHref)}>
                Users &amp; Access
              </button>
              <span className="mx-2">/</span>
              <span className="font-medium text-slate-700">Change Password</span>
            </div>
          ) : null}
          <CardTitle className="text-2xl">Change password</CardTitle>
          <CardDescription>{helpText}</CardDescription>
        </CardHeader>
        <form onSubmit={onSubmit}>
          <CardContent className="space-y-4">
            {error ? (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Could not update password</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}

            <div className="space-y-2">
              <Label htmlFor="currentPassword">Current password</Label>
              <Input
                id="currentPassword"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="newPassword">New password</Label>
              <Input
                id="newPassword"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
                minLength={8}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Confirm new password</Label>
              <Input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                minLength={8}
                required
              />
            </div>
          </CardContent>

          <CardFooter className="flex justify-end gap-3">
            {!isForcedChange ? (
              <Button type="button" variant="outline" onClick={() => navigate(backHref)}>
                Back
              </Button>
            ) : null}
            <Button type="submit" disabled={loading}>
              {loading ? 'Saving…' : 'Update password'}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  )
}
