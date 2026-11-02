import type { components } from '../schema';
import type { Account, AccountType, ControlType, NormalBalance } from '@/types';

export type ApiAccount = components['schemas']['AccountResource'];
export type ApiAccountRequest = components['schemas']['AccountRequest'];
export type DimensionRuleValue = 'required' | 'optional' | 'forbidden';

/** The generated type says `can: []`; the real body is an object of booleans (see FiscalApiTest/SetupApiTest). */
export function toCan(raw: unknown): Record<string, boolean> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const out: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(raw)) out[k] = v === true;
  return out;
}

/** The API resource has no tenant/company ids in its body; the caller knows them from the URL and session. */
export function toAccount(a: ApiAccount, scope: { tenantId: string; companyId: string }): Account {
  const can = toCan(a.can);
  const rules = a.dimension_rules && !Array.isArray(a.dimension_rules) ? (a.dimension_rules as Record<string, DimensionRuleValue>) : undefined;
  return {
    id: a.id,
    tenant_id: scope.tenantId,
    company_id: scope.companyId,
    code: a.code,
    name: a.name,
    account_type: a.account_type as AccountType,
    account_subtype: a.account_subtype ?? '',
    normal_balance: a.normal_balance as NormalBalance,
    control_type: a.control_type as ControlType,
    currency_policy: a.currency_policy,
    fixed_currency: a.fixed_currency ?? undefined,
    is_postable: a.is_postable,
    is_active: a.is_active,
    allow_manual_journals: a.allow_manual_journals,
    description: a.description ?? undefined,
    version: a.version,
    parent_id: a.parent_id,
    dimension_rules: rules,
    can: { update: can.update, deactivate: can.deactivate },
  };
}

/**
 * PUT /accounts/{id} replaces the account: whatever the request omits falls back to its default (the control
 * type, currency policy, ...), so an edit must send every field it is not changing (SetupApiTest).
 */
export function toAccountRequest(a: Account, changes: Partial<Account> = {}): ApiAccountRequest {
  const m = { ...a, ...changes };
  return {
    code: m.code,
    name: m.name,
    account_type: m.account_type,
    account_subtype: m.account_subtype || null,
    normal_balance: m.normal_balance,
    parent_id: m.parent_id ?? null,
    currency_policy: m.currency_policy,
    fixed_currency: m.currency_policy === 'fixed' ? (m.fixed_currency ?? null) : null,
    control_type: m.control_type && m.control_type !== null ? m.control_type : 'none',
    allow_manual_journals: m.allow_manual_journals ?? true,
    is_postable: m.is_postable,
    description: m.description ?? null,
    version: m.version ?? 0,
  };
}

export type AccountDraft = Pick<Account, 'code' | 'name' | 'account_type' | 'normal_balance'> &
  Partial<Pick<Account, 'account_subtype' | 'description' | 'parent_id'>>;

/** A new account: the API defaults everything not named (base-only currency, postable, manual journals on). */
export function toNewAccountRequest(d: AccountDraft): ApiAccountRequest {
  return {
    code: d.code,
    name: d.name,
    account_type: d.account_type,
    normal_balance: d.normal_balance,
    account_subtype: d.account_subtype || null,
    description: d.description || null,
    parent_id: d.parent_id ?? null,
  };
}

export function toDimensionRulesRequest(rules: Record<string, DimensionRuleValue | 'none'>): { rules: { dimension_id: string; rule: DimensionRuleValue }[] } {
  return {
    rules: Object.entries(rules)
      .filter((e): e is [string, DimensionRuleValue] => e[1] !== 'none')
      .map(([dimension_id, rule]) => ({ dimension_id, rule })),
  };
}
