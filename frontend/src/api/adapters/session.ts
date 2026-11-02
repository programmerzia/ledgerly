import type { components } from '../schema';
import type { Company, User } from '@/types';

export type ApiSession = components['schemas']['SessionResource'];
export type ApiTenant = ApiSession['tenants'][number];
export type ApiCompany = components['schemas']['CompanyResource'];

export const initials = (name: string): string =>
  name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') || '?';

const ROLE_TITLES: Record<string, string> = { owner: 'Owner', admin: 'Administrator', member: 'Member' };

export const currentTenant = (s: ApiSession): ApiTenant | undefined => s.tenants.find((t) => t.current);

/** Session -> the mock's `User`. Signing PIN is never held by the SPA (server verifies), so it is empty. */
export function toUser(s: ApiSession): User {
  const tenant = currentTenant(s);
  const role = tenant?.role ?? 'member';
  return {
    id: s.id,
    name: s.name,
    email: s.email,
    role,
    roleTitle: ROLE_TITLES[role] ?? role,
    avatar: initials(s.name),
    theme: 'light',
    twoFactorEnabled: s.two_factor_enabled,
    signingPin: '',
    failedPinAttempts: 0,
  };
}

export function toCompany(c: ApiCompany, tenantId: string): Company {
  return {
    id: c.id,
    tenant_id: tenantId,
    name: c.name,
    legal_name: c.legal_name ?? c.name,
    slug: c.slug,
    country: c.country,
    base_currency: c.base_currency,
    timezone: c.timezone,
    locale: 'en',
    fiscal_year_start_month: c.fiscal_year_start_month,
    tax_id: c.tax_id ?? '',
  };
}
