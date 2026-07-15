import { useCallback, useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { AlertCircle, ChevronDown, KeyRound, Plus, Shield } from 'lucide-react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { apiFetch, toUserFriendlyMessage } from '@/lib/api'
import { INTERNAL_USER_ROLES, USER_STATUSES, type InternalUserRole, type UserStatus } from '@/lib/roles'
import { useAuth } from '@/providers/AuthProvider'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'

type ManagedUser = {
  id: string
  name: string
  email: string
  role: InternalUserRole
  status: UserStatus
  mustChangePassword: boolean
  clientId: string | null
  createdAt: string
}

type UserDraft = {
  name: string
  role: InternalUserRole
  status: UserStatus
  tempPassword: string
}

type CreateUserForm = {
  name: string
  email: string
  role: InternalUserRole
  tempPassword: string
}

const EMPTY_CREATE_FORM: CreateUserForm = {
  name: '',
  email: '',
  role: 'campaign_manager',
  tempPassword: '',
}

function makeDraft(user: ManagedUser): UserDraft {
  return {
    name: user.name,
    role: user.role,
    status: user.status,
    tempPassword: '',
  }
}

function formatDateTime(value: string | null) {
  if (!value) return 'Never'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

function formatLabel(value: string) {
  return value
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

export default function SettingsUsers() {
  const { user } = useAuth()
  const [users, setUsers] = useState<ManagedUser[]>([])
  const [drafts, setDrafts] = useState<Record<string, UserDraft>>({})
  const [createForm, setCreateForm] = useState<CreateUserForm>(EMPTY_CREATE_FORM)
  const [loading, setLoading] = useState(true)
  const [savingUserId, setSavingUserId] = useState<string | null>(null)
  const [resettingUserId, setResettingUserId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [pageError, setPageError] = useState('')

  const hydrateDrafts = useCallback((nextUsers: ManagedUser[]) => {
    setDrafts(Object.fromEntries(nextUsers.map((item) => [item.id, makeDraft(item)])))
  }, [])

  const loadUsers = useCallback(async () => {
    setLoading(true)
    setPageError('')
    try {
      const res = await apiFetch('/api/users')
      const data = (await res.json()) as { success?: boolean; data?: ManagedUser[]; error?: string }
      if (!res.ok || !data.success || !data.data) {
        setPageError(toUserFriendlyMessage(data.error, 'Unable to load users.', res.status))
        return
      }
      setUsers(data.data)
      hydrateDrafts(data.data)
    } catch {
      setPageError('Unable to load users.')
    } finally {
      setLoading(false)
    }
  }, [hydrateDrafts])

  useEffect(() => {
    void loadUsers()
  }, [loadUsers])

  const userCountLabel = useMemo(() => `${users.length} internal user${users.length === 1 ? '' : 's'}`, [users.length])

  function updateDraft(userId: string, patch: Partial<UserDraft>) {
    setDrafts((current) => ({
      ...current,
      [userId]: {
        ...current[userId],
        ...patch,
      },
    }))
  }

  async function handleCreateUser(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setCreating(true)
    setPageError('')

    try {
      const res = await apiFetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createForm),
      })
      const data = (await res.json()) as { success?: boolean; error?: string }
      if (!res.ok || !data.success) {
        setPageError(toUserFriendlyMessage(data.error, 'Unable to create user.', res.status))
        return
      }

      setCreateForm(EMPTY_CREATE_FORM)
      setShowCreateForm(false)
      setPageError('')
      toast.success('Internal user created successfully.')
      await loadUsers()
    } catch {
      setPageError('Unable to create user.')
    } finally {
      setCreating(false)
    }
  }

  async function handleSaveUser(userId: string) {
    const draft = drafts[userId]
    if (!draft) return

    setSavingUserId(userId)
    setPageError('')
    try {
      const res = await apiFetch(`/api/users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: draft.name,
          role: draft.role,
          status: draft.status,
        }),
      })
      const data = (await res.json()) as { success?: boolean; error?: string }
      if (!res.ok || !data.success) {
        setPageError(toUserFriendlyMessage(data.error, 'Unable to update user.', res.status))
        return
      }

      setPageError('')
      toast.success('User details updated successfully.')
      await loadUsers()
    } catch {
      setPageError('Unable to update user.')
    } finally {
      setSavingUserId(null)
    }
  }

  async function handleResetPassword(userId: string) {
    const draft = drafts[userId]
    if (userId === user?.id) {
      setPageError('Use Change admin password for your own account.')
      return
    }

    if (!draft?.tempPassword) {
      setPageError('Enter a temporary password before resetting.')
      return
    }

    setResettingUserId(userId)
    setPageError('')
    try {
      const res = await apiFetch(`/api/users/${userId}/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tempPassword: draft.tempPassword }),
      })
      const data = (await res.json()) as { success?: boolean; error?: string }
      if (!res.ok || !data.success) {
        setPageError(toUserFriendlyMessage(data.error, 'Unable to reset password.', res.status))
        return
      }

      setDrafts((current) => ({
        ...current,
        [userId]: {
          ...current[userId],
          tempPassword: '',
        },
      }))
      setPageError('')
      toast.success('Temporary password reset successfully.')
      await loadUsers()
    } catch {
      setPageError('Unable to reset password.')
    } finally {
      setResettingUserId(null)
    }
  }

  return (
    <div className="w-full space-y-4 px-3 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Users &amp; Access</h1>
          <p className="mt-1 text-sm text-slate-500">{userCountLabel}</p>
        </div>
        <Button
          type="button"
          variant="outline"
          className="gap-2 rounded-full border-slate-200 bg-white shadow-sm"
          onClick={() => setShowCreateForm((open) => !open)}
        >
          <Plus className="h-4 w-4" />
          Add internal user
          <ChevronDown className={cn('h-4 w-4 transition-transform duration-200', showCreateForm && 'rotate-180')} />
        </Button>
      </div>

      <AnimatePresence initial={false}>
        {showCreateForm ? (
          <motion.div
            key="create-user-panel"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.28, ease: [0.4, 0, 0.2, 1] }}
            className="overflow-hidden"
          >
            <Card className="rounded-2xl border-slate-200/80 shadow-sm">
              <CardHeader className="space-y-1 pb-3">
                <CardTitle className="text-lg">New team member</CardTitle>
                <CardDescription>Temporary password + role — they change password on first login.</CardDescription>
              </CardHeader>
              <CardContent>
                <form className="grid gap-4 md:grid-cols-2 xl:grid-cols-4" onSubmit={handleCreateUser}>
                  <div className="space-y-2">
                    <Label htmlFor="new-user-name">Name</Label>
                    <Input
                      id="new-user-name"
                      value={createForm.name}
                      onChange={(e) => setCreateForm((current) => ({ ...current, name: e.target.value }))}
                      placeholder="e.g. Priya Sharma"
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="new-user-email">Email</Label>
                    <Input
                      id="new-user-email"
                      type="email"
                      value={createForm.email}
                      onChange={(e) => setCreateForm((current) => ({ ...current, email: e.target.value }))}
                      placeholder="user@company.com"
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="new-user-role">Role</Label>
                    <select
                      id="new-user-role"
                      className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
                      value={createForm.role}
                      onChange={(e) => setCreateForm((current) => ({ ...current, role: e.target.value as InternalUserRole }))}
                    >
                      {INTERNAL_USER_ROLES.map((role) => (
                        <option key={role} value={role}>
                          {formatLabel(role)}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="new-user-temp-password">Temporary password</Label>
                    <Input
                      id="new-user-temp-password"
                      type="password"
                      minLength={8}
                      value={createForm.tempPassword}
                      onChange={(e) => setCreateForm((current) => ({ ...current, tempPassword: e.target.value }))}
                      placeholder="Min 8 characters"
                      required
                    />
                  </div>

                  <div className="md:col-span-2 xl:col-span-4">
                    <Button type="submit" className="rounded-full px-6" disabled={creating}>
                      {creating ? 'Creating…' : 'Create user'}
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <Card className="rounded-2xl border-slate-200/80 shadow-sm">
          <CardHeader className="space-y-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div className="space-y-2">
                <CardTitle>Internal users</CardTitle>
                <CardDescription>{userCountLabel}. Admins can edit roles, status, and reset passwords here.</CardDescription>
              </div>
              <Button asChild variant="outline" size="sm">
                <Link to={user ? `/${user.adminSlug}/change-password` : '/signin'}>Change admin password</Link>
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <Alert className="border-slate-200 bg-slate-50 text-slate-700">
              <Shield className="h-4 w-4" />
              <AlertDescription>
                Resetting password forces that user to choose new one on next sign in. Use Change admin password for admins
              </AlertDescription>
            </Alert>
            {pageError ? (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Action failed</AlertTitle>
                <AlertDescription>{pageError}</AlertDescription>
              </Alert>
            ) : null}

            {loading ? (
              <div className="flex min-h-[280px] items-center justify-center text-sm text-slate-600">Loading users…</div>
            ) : users.length === 0 ? (
              <div className="flex min-h-[280px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed bg-slate-50/70 p-8 text-center">
                <Shield className="h-10 w-10 text-primary/70" />
                <h3 className="text-lg font-semibold text-slate-900">No internal users yet</h3>
                <p className="max-w-md text-sm text-slate-600">Create the first internal user from the panel on the left to start managing access for your team.</p>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-slate-200/80">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>User</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Temporary password</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {users.map((managedUser) => {
                      const draft = drafts[managedUser.id] ?? makeDraft(managedUser)
                      const isSelf = managedUser.id === user?.id
                      const hasChanges =
                        draft.name !== managedUser.name || draft.role !== managedUser.role || draft.status !== managedUser.status

                      return (
                        <TableRow key={managedUser.id} className="align-top">
                          <TableCell className="min-w-[220px] align-top">
                            <div className="space-y-2">
                              <Input
                                value={draft.name}
                                onChange={(e) => updateDraft(managedUser.id, { name: e.target.value })}
                                placeholder="Name"
                              />
                              <div className="text-xs text-muted-foreground">
                                <div>{managedUser.email}</div>
                                <div>Created {formatDateTime(managedUser.createdAt)}</div>
                                {managedUser.mustChangePassword ? (
                                  <span className="inline-flex rounded-full bg-amber-100 px-2 py-1 text-[11px] font-medium text-amber-800">
                                    Must change password
                                  </span>
                                ) : null}
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="min-w-[170px] align-top">
                            <select
                              className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
                              value={draft.role}
                              onChange={(e) => updateDraft(managedUser.id, { role: e.target.value as InternalUserRole })}
                              disabled={isSelf}
                            >
                              {INTERNAL_USER_ROLES.map((role) => (
                                <option key={role} value={role}>
                                  {formatLabel(role)}
                                </option>
                              ))}
                            </select>
                          </TableCell>
                          <TableCell className="min-w-[150px] align-top">
                            <select
                              className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
                              value={draft.status}
                              onChange={(e) => updateDraft(managedUser.id, { status: e.target.value as UserStatus })}
                              disabled={isSelf}
                            >
                              {USER_STATUSES.map((status) => (
                                <option key={status} value={status}>
                                  {formatLabel(status)}
                                </option>
                              ))}
                            </select>
                            <div className="mt-2 min-h-8 text-xs text-muted-foreground">
                              {isSelf ? 'You cannot change your own role or status here.' : ''}
                            </div>
                          </TableCell>
                          <TableCell className="min-w-[220px] align-top">
                            <div className="space-y-2">
                              <Input
                                type="password"
                                minLength={8}
                                value={draft.tempPassword}
                                onChange={(e) => updateDraft(managedUser.id, { tempPassword: e.target.value })}
                                placeholder="New temporary password"
                              />
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="gap-2"
                                disabled={resettingUserId === managedUser.id || isSelf}
                                onClick={() => void handleResetPassword(managedUser.id)}
                              >
                                <KeyRound className="h-4 w-4" />
                                {resettingUserId === managedUser.id ? 'Resetting…' : 'Reset password'}
                              </Button>
                              <div className="min-h-5 text-xs text-muted-foreground">
                                {isSelf ? 'Use Change admin password for your own account.' : ''}
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="min-w-[140px] align-top text-right">
                            <Button
                              type="button"
                              size="sm"
                              disabled={savingUserId === managedUser.id || !hasChanges}
                              onClick={() => void handleSaveUser(managedUser.id)}
                            >
                              {savingUserId === managedUser.id ? 'Saving…' : 'Save'}
                            </Button>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
    </div>
  )
}
