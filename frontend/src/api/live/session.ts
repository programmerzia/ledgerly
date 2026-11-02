/** Live session calls (13 §7): Fortify login under /auth, then /me, tenant switch, companies. */
import { http } from '../http';
import type { ApiCompany, ApiSession } from '../adapters/session';
import { ApiError } from '../errors';

export interface LoginResult {
  twoFactor: boolean;
}

export async function login(email: string, password: string, remember = false): Promise<LoginResult> {
  const res = await http.post('/v1/auth/login', { body: { email, password, remember } });
  return { twoFactor: Boolean(res?.two_factor) };
}

/** Second step after `login()` returned `twoFactor: true`. Exactly one of the two codes. */
export async function submitTwoFactor(input: { code?: string; recoveryCode?: string }): Promise<void> {
  await http.post('/v1/auth/two-factor-challenge', {
    body: input.recoveryCode ? { recovery_code: input.recoveryCode } : { code: input.code ?? '' },
  });
}

export interface RegisterInput {
  name: string;
  email: string;
  password: string;
  password_confirmation: string;
  organisation_name: string;
}

export async function register(input: RegisterInput): Promise<void> {
  // The generated request type only lists Fortify's `remember`; the real fields come from CreateNewUser.
  await http.send('POST', '/v1/auth/register', input);
}

export async function logout(): Promise<void> {
  await http.post('/v1/auth/logout');
}

export async function switchTenant(tenantId: string): Promise<ApiSession> {
  const res = await http.put('/v1/session/tenant', { body: { tenant_id: tenantId } });
  return res.data;
}

/**
 * The signed-in user, or null when there is no session (401 is the normal "not signed in" answer).
 * A user who belongs to organisations but has none selected gets the first one selected.
 */
export async function fetchMe(): Promise<ApiSession | null> {
  let me: ApiSession;
  try {
    me = (await http.get('/v1/me')).data;
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) return null;
    throw e;
  }
  if (me.tenants.length > 0 && !me.tenants.some((t) => t.current)) return switchTenant(me.tenants[0].id);
  return me;
}

export async function fetchCompanies(): Promise<ApiCompany[]> {
  return (await http.get('/v1/companies')).data;
}

export async function createCompany(body: {
  name: string;
  country: string;
  base_currency: string;
  fiscal_year_start_month: number;
  legal_name?: string | null;
  tax_id?: string | null;
}): Promise<ApiCompany> {
  return (await http.post('/v1/companies', { body })).data;
}
