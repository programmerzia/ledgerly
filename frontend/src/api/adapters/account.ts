import type { components } from '../schema';
import type { Account, AccountType, ControlType, NormalBalance } from '@/types';

export type ApiAccount = components['schemas']['AccountResource'];

/** The API resource has no tenant/company ids in its body; the caller knows them from the URL and session. */
export function toAccount(a: ApiAccount, scope: { tenantId: string; companyId: string }): Account {
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
  };
}
