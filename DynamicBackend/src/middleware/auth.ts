import { createMiddleware } from 'hono/factory'
import { eq } from 'drizzle-orm'
import { createDb } from '../db'
import { admins, users } from '../db/schema'
import { verifyAuth } from '../lib/jwt'
import { isUserRole } from '../lib/roles'
import type { AppEnv } from '../types'

/**
 * Middleware to verify the JWT token and populate the context with full user data from the DB.
 */
export const authMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const auth = c.req.header('Authorization') ?? ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
  const secret = c.env.JWT_SECRET || 'dev-only-change-with-wrangler-secret'
  
  const verified = token ? await verifyAuth(secret, token) : null
  if (!verified) {
    return c.json({ success: false, error: 'Unauthorized' }, 401)
  }

  const db = createDb(c.env.DB)
  const row = await db
    .select({ user: users, admin: admins })
    .from(users)
    .innerJoin(admins, eq(users.adminId, admins.id))
    .where(eq(users.id, verified.sub))
    .limit(1)

  const current = row[0]
  if (!current) {
    return c.json({ success: false, error: 'Unauthorized' }, 401)
  }

  if (current.user.status !== 'active') {
    return c.json({ success: false, error: 'User account is inactive' }, 403)
  }

  const role = isUserRole(current.user.role) ? current.user.role : 'client'

  c.set('user', {
    sub: current.user.id,
    adminId: current.admin.id,
    adminSlug: current.admin.slug,
    email: current.user.email,
    name: current.user.name,
    role,
    status: current.user.status,
    mustChangePassword: current.user.mustChangePassword,
    clientId: current.user.clientId,
    lastLoginAt: current.user.lastLoginAt,
  })
  c.set('db', db)
  await next()
})
