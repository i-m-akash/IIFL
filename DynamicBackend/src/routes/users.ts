import { Hono } from 'hono'
import { and, asc, eq, ne } from 'drizzle-orm'
import { z } from 'zod'
import { users } from '../db/schema'
import { hashPassword } from '../lib/password'
import { canManageUsers, INTERNAL_USER_ROLES, USER_STATUSES } from '../lib/roles'
import { authMiddleware } from '../middleware/auth'
import type { AppEnv } from '../types'

const createUserSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().toLowerCase().email(),
  role: z.enum(INTERNAL_USER_ROLES),
  tempPassword: z.string().min(8).max(128),
})

const updateUserSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    role: z.enum(INTERNAL_USER_ROLES).optional(),
    status: z.enum(USER_STATUSES).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'No changes provided' })

const resetPasswordSchema = z.object({
  tempPassword: z.string().min(8).max(128),
})

function mapUser(row: typeof users.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    status: row.status,
    mustChangePassword: row.mustChangePassword,
    clientId: row.clientId,
    lastLoginAt: row.lastLoginAt ? row.lastLoginAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  }
}

export const usersRoutes = new Hono<AppEnv>()

usersRoutes.use('*', authMiddleware)

usersRoutes.get('/', async (c) => {
  const session = c.get('user')!
  if (!canManageUsers(session.role)) {
    return c.json({ success: false, error: 'Forbidden' }, 403)
  }

  const db = c.get('db')!
  const rows = await db
    .select()
    .from(users)
    .where(and(eq(users.adminId, session.adminId), ne(users.role, 'client')))
    .orderBy(asc(users.createdAt), asc(users.email))

  return c.json({ success: true, data: rows.map(mapUser) })
})

usersRoutes.post('/', async (c) => {
  const session = c.get('user')!
  if (!canManageUsers(session.role)) {
    return c.json({ success: false, error: 'Forbidden' }, 403)
  }

  const body = await c.req.json().catch(() => null)
  const parsed = createUserSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ success: false, error: 'Invalid user details' }, 400)
  }

  const db = c.get('db')!
  const { name, email, role, tempPassword } = parsed.data
  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.adminId, session.adminId), eq(users.email, email)))
    .limit(1)

  if (existing[0]) {
    return c.json({ success: false, error: 'A user with that email already exists' }, 409)
  }

  const now = new Date()
  const passwordHash = await hashPassword(tempPassword)
  const id = crypto.randomUUID()
  await db.insert(users).values({
    id,
    adminId: session.adminId,
    name,
    email,
    passwordHash,
    role,
    status: 'active',
    mustChangePassword: true,
    clientId: null,
    lastLoginAt: null,
    createdAt: now,
  })

  const created = (await db.select().from(users).where(eq(users.id, id)).limit(1))[0]
  return c.json({ success: true, data: created ? mapUser(created) : null }, 201)
})

usersRoutes.patch('/:id', async (c) => {
  const session = c.get('user')!
  if (!canManageUsers(session.role)) {
    return c.json({ success: false, error: 'Forbidden' }, 403)
  }

  const body = await c.req.json().catch(() => null)
  const parsed = updateUserSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ success: false, error: parsed.error.issues[0]?.message || 'Invalid user update' }, 400)
  }

  const userId = c.req.param('id')
  const db = c.get('db')!
  const existing = (await db.select().from(users).where(eq(users.id, userId)).limit(1))[0]
  if (!existing || existing.adminId !== session.adminId || existing.role === 'client') {
    return c.json({ success: false, error: 'User not found' }, 404)
  }

  if (existing.id === session.sub && (parsed.data.role || parsed.data.status)) {
    return c.json({ success: false, error: 'You cannot change your own role or status here' }, 400)
  }

  await db
    .update(users)
    .set({
      ...(parsed.data.name ? { name: parsed.data.name } : {}),
      ...(parsed.data.role ? { role: parsed.data.role } : {}),
      ...(parsed.data.status ? { status: parsed.data.status } : {}),
    })
    .where(eq(users.id, userId))

  const updated = (await db.select().from(users).where(eq(users.id, userId)).limit(1))[0]
  return c.json({ success: true, data: updated ? mapUser(updated) : null })
})

usersRoutes.post('/:id/reset-password', async (c) => {
  const session = c.get('user')!
  if (!canManageUsers(session.role)) {
    return c.json({ success: false, error: 'Forbidden' }, 403)
  }

  const body = await c.req.json().catch(() => null)
  const parsed = resetPasswordSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ success: false, error: 'Invalid temporary password' }, 400)
  }

  const userId = c.req.param('id')
  const db = c.get('db')!
  const existing = (await db.select().from(users).where(eq(users.id, userId)).limit(1))[0]
  if (!existing || existing.adminId !== session.adminId || existing.role === 'client') {
    return c.json({ success: false, error: 'User not found' }, 404)
  }

  if (existing.id === session.sub) {
    return c.json({ success: false, error: 'Use change password to update your own password' }, 400)
  }

  const passwordHash = await hashPassword(parsed.data.tempPassword)
  await db
    .update(users)
    .set({
      passwordHash,
      mustChangePassword: true,
      status: 'active',
    })
    .where(eq(users.id, userId))

  const updated = (await db.select().from(users).where(eq(users.id, userId)).limit(1))[0]
  return c.json({ success: true, data: updated ? mapUser(updated) : null })
})