import { Hono } from 'hono'
import { eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { createDb } from '../db'
import { admins, users } from '../db/schema'
import { hashPassword, verifyPassword } from '../lib/password'
import { signAuth } from '../lib/jwt'
import { INTERNAL_USER_ROLES, isInternalUserRole } from '../lib/roles'
import { authMiddleware } from '../middleware/auth'
import type { AppEnv } from '../types'

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(128),
})

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: z.string().min(8).max(128),
})

function normalizeUserRole(role: string) {
  return isInternalUserRole(role) ? role : 'client'
}

function buildUserResponse(user: typeof users.$inferSelect, admin: typeof admins.$inferSelect) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: normalizeUserRole(user.role),
    status: user.status,
    mustChangePassword: user.mustChangePassword,
    adminSlug: admin.slug,
    adminName: admin.name,
    adminLogoUrl: admin.logoUrl ?? null,
    clientId: user.clientId,
    lastLoginAt: user.lastLoginAt ? user.lastLoginAt.toISOString() : null,
  }
}

export const authRoutes = new Hono<AppEnv>()
  .post('/login', async (c) => {
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ success: false, error: 'Invalid JSON' }, 400)
    }
    const parsed = loginSchema.safeParse(body)
    if (!parsed.success) {
      return c.json({ success: false, error: 'Invalid email or password' }, 400)
    }
    const { email, password } = parsed.data
    const db = createDb(c.env.DB)

    const candidates = await db
      .select({ user: users, admin: admins })
      .from(users)
      .innerJoin(admins, eq(users.adminId, admins.id))
      .where(sql`lower(${users.email}) = ${email}`)

    let matchedUser: (typeof users.$inferSelect) | null = null
    let admin: (typeof admins.$inferSelect) | null = null
    let passwordMatches = 0
    for (const row of candidates) {
      const ok = await verifyPassword(password, row.user.passwordHash)
      if (!ok) continue
      passwordMatches += 1
      if (!matchedUser) {
        matchedUser = row.user
        admin = row.admin
      }
    }

    if (passwordMatches > 1) {
      return c.json({ success: false, error: 'That email matches more than one account. Use a different email or ask your admin.' }, 409)
    }
    if (!matchedUser || !admin) {
      return c.json({ success: false, error: 'Invalid email or password' }, 401)
    }
    const user = matchedUser

    if (user.status !== 'active') {
      return c.json({ success: false, error: 'Your account is inactive. Please contact your admin.' }, 403)
    }

    const now = new Date()
    await db.update(users).set({ lastLoginAt: now }).where(eq(users.id, user.id))
    const userWithLogin = { ...user, lastLoginAt: now }

    const secret = c.env.JWT_SECRET || 'dev-only-change-with-wrangler-secret'
    const token = await signAuth(secret, {
      sub: userWithLogin.id,
      adminId: admin.id,
      adminSlug: admin.slug,
      email: userWithLogin.email,
      role: normalizeUserRole(userWithLogin.role),
      clientId: normalizeUserRole(userWithLogin.role) === 'client' ? userWithLogin.clientId : null,
    })

    return c.json({
      success: true,
      token,
      user: buildUserResponse(userWithLogin, admin),
    })
  })
  .get('/me', authMiddleware, async (c) => {
    const u = c.get('user')!
    const db = c.get('db')!
    const admin = (await db.select().from(admins).where(eq(admins.id, u.adminId)).limit(1))[0]
    if (!admin) return c.json({ success: false, error: 'Admin org not found' }, 404)
    const user = (await db.select().from(users).where(eq(users.id, u.sub)).limit(1))[0]
    if (!user) return c.json({ success: false, error: 'User not found' }, 404)
    return c.json({
      success: true,
      user: buildUserResponse(user, admin),
      admin: {
        id: admin.id,
        slug: admin.slug,
        name: admin.name,
        logoUrl: admin.logoUrl,
        primaryColor: admin.primaryColor,
        secondaryColor: admin.secondaryColor,
        navBgColor: admin.navBgColor,
        fontFamily: admin.fontFamily,
      },
    })
  })
  .post('/change-password', authMiddleware, async (c) => {
    const session = c.get('user')!
    const db = c.get('db')!
    const body = await c.req.json().catch(() => null)
    const parsed = changePasswordSchema.safeParse(body)
    if (!parsed.success) {
      return c.json({ success: false, error: 'Invalid password details' }, 400)
    }

    if (parsed.data.currentPassword === parsed.data.newPassword) {
      return c.json({ success: false, error: 'New password must be different from the current password' }, 400)
    }

    const user = (await db.select().from(users).where(eq(users.id, session.sub)).limit(1))[0]
    if (!user) {
      return c.json({ success: false, error: 'User not found' }, 404)
    }

    const matches = await verifyPassword(parsed.data.currentPassword, user.passwordHash)
    if (!matches) {
      return c.json({ success: false, error: 'Current password is incorrect' }, 400)
    }

    const passwordHash = await hashPassword(parsed.data.newPassword)
    await db
      .update(users)
      .set({
        passwordHash,
        mustChangePassword: false,
      })
      .where(eq(users.id, user.id))

    const admin = (await db.select().from(admins).where(eq(admins.id, session.adminId)).limit(1))[0]
    const refreshed = (await db.select().from(users).where(eq(users.id, user.id)).limit(1))[0]
    if (!admin || !refreshed) {
      return c.json({ success: false, error: 'Unable to load updated user' }, 500)
    }

    return c.json({
      success: true,
      message: 'Password updated successfully',
      user: buildUserResponse(refreshed, admin),
    })
  })
