import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { authRoutes } from './routes/auth'
import { agentsRoutes } from './routes/agents'
import { dashboardRoutes } from './routes/dashboard'
import { campaignsRoutes } from './routes/campaigns'
import { notificationsRoutes } from './routes/notifications'
import { usersRoutes } from './routes/users'
import { publicRoutes } from './routes/public'
import { billingRoutes } from './routes/billing'
import { runCampaignScheduler } from './services/scheduler'
import type { AppEnv } from './types'

const app = new Hono<AppEnv>()

app.use(
  '*',
  cors({
    origin: (origin) => (origin ? origin : '*'),
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    exposeHeaders: ['Content-Length'],
    maxAge: 600,
  })
)

app.get('/', (c) =>
  c.json({
    name: 'dynamic-api',
    version: '0.1.0',
    ok: true,
  })
)

app.route('/api/public', publicRoutes)
app.route('/api/auth', authRoutes)
app.route('/api/agents', agentsRoutes)
app.route('/api/dashboard', dashboardRoutes)
app.route('/api/campaigns', campaignsRoutes)
app.route('/api/notifications', notificationsRoutes)
app.route('/api/users', usersRoutes)
app.route('/api/billing', billingRoutes)

app.onError((err, c) => {
  console.error(err)
  return c.json({ success: false, error: 'Internal server error' }, 500)
})

app.notFound((c) => c.json({ success: false, error: 'Not found' }, 404))

app.get('/api/test-scheduler', async (c) => {
  try {
    const summary = await runCampaignScheduler(c.env)
    return c.json({ success: true, message: 'Scheduler triggered manually', data: summary })
  } catch (err: unknown) {
    console.error(err)
    const message = err instanceof Error ? err.message : 'Scheduler failed'
    return c.json({ success: false, error: message }, 500)
  }
})

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledEvent, env: AppEnv['Bindings'], ctx: ExecutionContext) {
    ctx.waitUntil(runCampaignScheduler(env))
  },
}
