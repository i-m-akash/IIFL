export const USER_ROLES = ['admin', 'campaign_manager', 'sales', 'monitor', 'client'] as const
export const INTERNAL_USER_ROLES = ['admin', 'campaign_manager', 'sales', 'monitor'] as const
export const USER_STATUSES = ['active', 'inactive'] as const

export type UserRole = (typeof USER_ROLES)[number]
export type InternalUserRole = (typeof INTERNAL_USER_ROLES)[number]
export type UserStatus = (typeof USER_STATUSES)[number]

export function isUserRole(value: unknown): value is UserRole {
  return typeof value === 'string' && (USER_ROLES as readonly string[]).includes(value)
}

export function isInternalUserRole(value: unknown): value is InternalUserRole {
  return typeof value === 'string' && (INTERNAL_USER_ROLES as readonly string[]).includes(value)
}

export function isUserStatus(value: unknown): value is UserStatus {
  return typeof value === 'string' && (USER_STATUSES as readonly string[]).includes(value)
}

export function canManageUsers(role: UserRole): boolean {
  return role === 'admin'
}

export function canViewSettings(role: UserRole): boolean {
  return role === 'admin'
}

export function canViewAgents(role: UserRole): boolean {
  return role === 'admin' || role === 'campaign_manager' || role === 'monitor'
}

export function canManageAgents(role: UserRole): boolean {
  return role === 'admin' || role === 'campaign_manager'
}

export function canUseAgentPlayground(role: UserRole): boolean {
  return role === 'admin' || role === 'campaign_manager'
}

export function canViewAgentInsights(role: UserRole): boolean {
  return role === 'admin' || role === 'campaign_manager' || role === 'monitor'
}

export function canViewCampaigns(role: UserRole): boolean {
  return role === 'admin' || role === 'campaign_manager' || role === 'sales' || role === 'client'
}

export function canManageCampaigns(role: UserRole): boolean {
  return role === 'admin' || role === 'campaign_manager'
}
