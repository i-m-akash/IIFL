import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

export const admins = sqliteTable(
  'admins',
  {
    id: text('id').primaryKey(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    logoUrl: text('logo_url'),
    primaryColor: text('primary_color').notNull().default('#8248A5'),
    secondaryColor: text('secondary_color').notNull().default('#a855f7'),
    navBgColor: text('nav_bg_color').notNull().default('#F2F7FA'),
    fontFamily: text('font_family').notNull().default('Poppins, system-ui, sans-serif'),
    analyticsSource: text('analytics_source').notNull().default('d1'),
    datasourceBinding: text('datasource_binding'),
    postgresSchema: text('postgres_schema'),
    postgresLeadTable: text('postgres_lead_table'),
    /** Full URL to `call_customers` for this tenant (e.g. Accelbiz host). Falls back to env ML_API_URL_* / ML_API_URL. */
    mlApiUrl: text('ml_api_url'),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [uniqueIndex('admins_slug_unique').on(t.slug)]
)

export const clients = sqliteTable(
  'clients',
  {
    id: text('id').primaryKey(),
    adminId: text('admin_id')
      .notNull()
      .references(() => admins.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index('clients_admin_idx').on(t.adminId)]
)

export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(),
    adminId: text('admin_id')
      .notNull()
      .references(() => admins.id, { onDelete: 'cascade' }),
    name: text('name').notNull().default(''),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    role: text('role').notNull(),
    status: text('status').notNull().default('active'),
    mustChangePassword: integer('must_change_password', { mode: 'boolean' }).notNull().default(true),
    clientId: text('client_id').references(() => clients.id, { onDelete: 'cascade' }),
    lastLoginAt: integer('last_login_at', { mode: 'timestamp' }),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [uniqueIndex('users_admin_email_unique').on(t.adminId, t.email), index('users_admin_idx').on(t.adminId)]
)

export const bots = sqliteTable(
  'bots',
  {
    id: text('id').primaryKey(),
    adminId: text('admin_id')
      .notNull()
      .references(() => admins.id, { onDelete: 'cascade' }),
    clientId: text('client_id').references(() => clients.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    externalRef: text('external_ref').notNull(),
    metaJson: text('meta_json'),
    dashboardAnalyticsQuery: text('dashboard_analytics_query'),
    dashboardLogsQuery: text('dashboard_logs_query'),
    campaignListQuery: text('campaign_list_query'),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    index('bots_admin_idx').on(t.adminId),
    index('bots_client_idx').on(t.clientId),
    uniqueIndex('bots_admin_external_unique').on(t.adminId, t.externalRef),
  ]
)

export const agentActivityLogs = sqliteTable(
  'agent_activity_logs',
  {
    id: text('id').primaryKey(),
    adminId: text('admin_id')
      .notNull()
      .references(() => admins.id, { onDelete: 'cascade' }),
    clientId: text('client_id').references(() => clients.id, { onDelete: 'set null' }),
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    botId: text('bot_id').references(() => bots.id, { onDelete: 'cascade' }),
    action: text('action').notNull(),
    title: text('title').notNull(),
    message: text('message').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    index('agent_activity_logs_admin_idx').on(t.adminId, t.createdAt),
    index('agent_activity_logs_client_idx').on(t.clientId, t.createdAt),
    index('agent_activity_logs_bot_idx').on(t.botId, t.createdAt),
  ]
)

export const uiConfigs = sqliteTable(
  'ui_configs',
  {
    id: text('id').primaryKey(),
    adminId: text('admin_id')
      .notNull()
      .references(() => admins.id, { onDelete: 'cascade' }),
    clientId: text('client_id').references(() => clients.id, { onDelete: 'cascade' }),
    page: text('page').notNull(),
    configJson: text('config_json').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index('ui_configs_admin_page_idx').on(t.adminId, t.page)]
)

export const botCallLogs = sqliteTable(
  'bot_call_logs',
  {
    id: text('id').primaryKey(),
    adminId: text('admin_id')
      .notNull()
      .references(() => admins.id, { onDelete: 'cascade' }),
    botId: text('bot_id')
      .notNull()
      .references(() => bots.id, { onDelete: 'cascade' }),
    clientId: text('client_id').references(() => clients.id, { onDelete: 'set null' }),
    occurredAt: integer('occurred_at', { mode: 'timestamp' }).notNull(),
    direction: text('direction').notNull().default('outbound'),
    customerNumber: text('customer_number'),
    durationSec: integer('duration_sec'),
    actionSummary: text('action_summary'),
    metaJson: text('meta_json'),
  },
  (t) => [index('bot_call_logs_bot_occurred').on(t.botId, t.occurredAt)]
)

export const botAnalyticsRows = sqliteTable(
  'bot_analytics_rows',
  {
    id: text('id').primaryKey(),
    adminId: text('admin_id')
      .notNull()
      .references(() => admins.id, { onDelete: 'cascade' }),
    botId: text('bot_id')
      .notNull()
      .references(() => bots.id, { onDelete: 'cascade' }),
    clientId: text('client_id').references(() => clients.id, { onDelete: 'set null' }),
    occurredAt: integer('occurred_at', { mode: 'timestamp' }).notNull(),
    metaJson: text('meta_json').notNull(),
  },
  (t) => [index('bot_analytics_bot_occurred').on(t.botId, t.occurredAt)]
)

export const campaigns = sqliteTable(
  'campaigns',
  {
    id: text('id').primaryKey(),
    adminId: text('admin_id')
      .notNull()
      .references(() => admins.id, { onDelete: 'cascade' }),
    clientId: text('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    botId: text('bot_id')
      .notNull()
      .references(() => bots.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    status: text('status').notNull().default('pending'),
    languagesJson: text('languages_json').notNull().default('[]'),
    columnsSchemaJson: text('columns_schema_json').notNull(),
    scheduledAt: integer('scheduled_at', { mode: 'timestamp' }),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    index('campaigns_admin_created').on(t.adminId, t.createdAt),
    index('campaigns_client').on(t.clientId),
    index('campaigns_bot').on(t.botId),
  ]
)

export const campaignLeads = sqliteTable(
  'campaign_leads',
  {
    id: text('id').primaryKey(),
    adminId: text('admin_id')
      .notNull()
      .references(() => admins.id, { onDelete: 'cascade' }),
    clientId: text('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    campaignId: text('campaign_id').references(() => campaigns.id, { onDelete: 'cascade' }),
    botId: text('bot_id')
      .notNull()
      .references(() => bots.id, { onDelete: 'cascade' }),
    referenceId: text('reference_id').notNull(),
    partyName: text('party_name'),
    partyMobile: text('party_mobile'),
    emiAmount: text('emi_amount'),
    emiDate: text('emi_date'),
    loanType: text('loan_type'),
    preferredLanguage: text('preferred_language'),
    dataJson: text('data_json'),
    extraDataJson: text('extra_data_json'),
    callStatus: text('call_status').notNull().default('pending'),
    scheduledAt: integer('scheduled_at', { mode: 'timestamp' }),
    fileName: text('file_name'),
    uploadBatchId: text('upload_batch_id').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    index('campaign_leads_admin_created').on(t.adminId, t.createdAt),
    index('campaign_leads_client').on(t.clientId),
    index('campaign_leads_campaign').on(t.campaignId),
    uniqueIndex('campaign_leads_admin_campaign_ref_unique').on(t.adminId, t.campaignId, t.referenceId),
  ]
)
