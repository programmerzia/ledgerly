/**
 * Seam for the chart of accounts. Pages call `useAccounts()` and never know which side answers:
 * mock mode reads the zustand store (unchanged behaviour), live mode reads GET /companies/{id}/accounts
 * through React Query and adapts to the view type. Chosen once, at module load, from VITE_API_MODE.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { selectByMode } from './select';
import { http } from '@/api/http';
import { fetchAllPages } from '@/api/cursor';
import { fromApiMoney } from '@/api/adapters/money';
import { toAccount, toAccountRequest, toNewAccountRequest, toDimensionRulesRequest, toVisibilityRequest, type AccountDraft, type DimensionRuleValue } from '@/api/adapters/account';
import { createIntent, type Intent } from '@/api/idempotency';
import { Handled, handleVersionConflict } from '@/api/live/writeProblems';
import { useLedgerStore } from '@/mock/store';
import { useActiveCompany } from './session';
import type { Account } from '@/types';
import type { DataResult } from './types';

export function useMockAccounts(): DataResult<Account[]> {
  const accounts = useLedgerStore((s) => s.accounts);
  return { data: accounts, isLoading: false, error: null, refetch: () => {} };
}

export const accountsKey = (companyId: string) => ['accounts', companyId] as const;

export function useLiveAccounts(): DataResult<Account[]> {
  const { company, known } = useActiveCompany();
  const q = useQuery({
    enabled: known,
    queryKey: accountsKey(company.id),
    queryFn: async () => {
      const rows = await fetchAllPages((cursor) =>
        http.get('/v1/companies/{company}/accounts', { path: { company: company.id }, query: { cursor, limit: 200 } }),
      );
      return rows.map((a) => toAccount(a, { tenantId: company.tenant_id, companyId: company.id }));
    },
  });
  return { data: q.data ?? [], isLoading: q.isLoading, error: q.error, refetch: () => void q.refetch() };
}

export const useAccounts: () => DataResult<Account[]> = selectByMode({ mock: useMockAccounts, live: useLiveAccounts });

/** What the new-account form collects. Everything else is the API's default (or the mock's, below). */
export interface NewAccountInput {
  code: string;
  name: string;
  account_type: Account['account_type'];
  normal_balance: Account['normal_balance'];
  account_subtype: string;
  description: string;
  parent_id?: string | null;
}

/**
 * Writes for the chart of accounts. Mock: the store, exactly as the dialogs did it. Live: intents against the API
 * (13 §11), refetching the list on success. A version conflict opens the ConflictDialog and throws `Handled`.
 * `intent` is the form's own, so a retry after a network error reuses the Idempotency-Key.
 */
export interface AccountActions {
  create: (input: NewAccountInput, intent?: Intent) => Promise<void>;
  /** `changes` are the edited fields; live mode sends the whole account (PUT replaces it). */
  update: (account: Account, changes: Partial<Account>, intent?: Intent) => Promise<void>;
  /** `reason` is kept in the mock only: the API's deactivate takes just the version. */
  deactivate: (account: Account, reason: string, intent?: Intent) => Promise<void>;
  setAllowManual: (account: Account, allow: boolean, intent?: Intent) => Promise<void>;
  /** Hide or show in default lists and pickers. Posting and reports are not affected. Live mode only; the mock has no hidden accounts. */
  setHidden: (account: Account, hidden: boolean, intent?: Intent) => Promise<void>;
  setDimensionRules: (account: Account, rules: Record<string, DimensionRuleValue | 'none'>, intent?: Intent) => Promise<void>;
}

export function useMockAccountActions(): AccountActions {
  return {
    create: async (input) => {
      const s = useLedgerStore.getState();
      s.addAccount({
        id: `acc-${input.code}-${Date.now()}`,
        tenant_id: s.currentCompany.tenant_id,
        company_id: s.currentCompany.id,
        code: input.code,
        name: input.name,
        account_type: input.account_type,
        account_subtype: input.account_subtype || 'General',
        normal_balance: input.normal_balance,
        control_type: null as unknown as Account['control_type'],
        currency_policy: 'base_only',
        is_postable: true,
        is_active: true,
        allow_manual_journals: true,
        description: input.description || undefined,
      });
    },
    update: async (account, changes) => {
      useLedgerStore.getState().updateAccount({ ...account, ...changes });
    },
    deactivate: async (account, reason) => {
      useLedgerStore.getState().updateAccount({
        ...account,
        is_active: false,
        description: `${account.description ? account.description + ' · ' : ''}Deactivated: ${reason.trim()}`,
      });
    },
    setAllowManual: async (account, allow) => {
      const accounts = useLedgerStore.getState().accounts;
      useLedgerStore.setState({ accounts: accounts.map((a) => (a.id === account.id ? { ...a, allow_manual_journals: allow } : a)) });
    },
    setHidden: async () => {},
    setDimensionRules: async () => {},
  };
}

export function useLiveAccountActions(): AccountActions {
  const client = useQueryClient();
  const { company } = useActiveCompany();
  const path = { company: company.id };
  const done = () => client.invalidateQueries({ queryKey: accountsKey(company.id) });
  const guard = async (account: Account, local: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e) {
      if (handleVersionConflict(e, { subject: `Account ${account.code}`, documentId: account.id, local, client, keys: [accountsKey(company.id)] })) throw new Handled(e);
      throw e;
    }
    await done();
  };
  return {
    create: async (input, intent = createIntent()) => {
      await http.post('/v1/companies/{company}/accounts', { path, body: toNewAccountRequest(input), intent });
      await done();
    },
    update: (account, changes, intent = createIntent()) =>
      guard(account, changes.name ?? account.name, () =>
        http.put('/v1/companies/{company}/accounts/{account}', { path: { ...path, account: account.id }, body: toAccountRequest(account, changes), intent }),
      ),
    deactivate: (account, _reason, intent = createIntent()) =>
      guard(account, 'deactivate', () =>
        http.post('/v1/companies/{company}/accounts/{account}/deactivate', { path: { ...path, account: account.id }, body: { version: account.version ?? 0 }, intent }),
      ),
    setAllowManual: (account, allow, intent = createIntent()) =>
      guard(account, `allow manual journals: ${allow ? 'yes' : 'no'}`, () =>
        http.put('/v1/companies/{company}/accounts/{account}', {
          path: { ...path, account: account.id },
          body: toAccountRequest(account, { allow_manual_journals: allow }),
          intent,
        }),
      ),
    setHidden: (account, hidden, intent = createIntent()) =>
      guard(account, `hidden: ${hidden ? 'yes' : 'no'}`, () =>
        http.put('/v1/companies/{company}/accounts/{account}/visibility', {
          path: { ...path, account: account.id },
          body: toVisibilityRequest(account, hidden),
          intent,
        }),
      ),
    setDimensionRules: async (account, rules, intent = createIntent()) => {
      await http.put('/v1/companies/{company}/accounts/{account}/dimension-rules', { path: { ...path, account: account.id }, body: toDimensionRulesRequest(rules), intent });
      await done();
    },
  };
}

export const useAccountActions: () => AccountActions = selectByMode({ mock: useMockAccountActions, live: useLiveAccountActions });

/**
 * Account balances from the trial balance (live only; the mock page uses the store's balanceOf). The server sends
 * debit and credit totals per account; we keep them as two figures and never subtract in the browser.
 */
export interface AccountBalance {
  debit: number;
  credit: number;
  currency: string;
}

export function useLiveAccountBalances(enabled: boolean, asOf: string): DataResult<Record<string, AccountBalance>> {
  const { company, known } = useActiveCompany();
  const q = useQuery({
    queryKey: ['account-balances', company.id, asOf],
    enabled: known && enabled,
    queryFn: async () => {
      const res = (await http.get('/v1/companies/{company}/reports/trial-balance', {
        path: { company: company.id },
        query: { as_of: asOf },
      })) as unknown as {
        data: { rows: { account: { id: string }; debit: { amount: number; currency: string }; credit: { amount: number; currency: string } }[] };
      };
      const out: Record<string, AccountBalance> = {};
      for (const r of res.data.rows) out[r.account.id] = { debit: fromApiMoney(r.debit), credit: fromApiMoney(r.credit), currency: r.debit.currency };
      return out;
    },
  });
  return { data: q.data ?? {}, isLoading: q.isLoading, error: q.error, refetch: () => void q.refetch() };
}

const NO_BALANCES: DataResult<Record<string, AccountBalance>> = { data: {}, isLoading: false, error: null, refetch: () => {} };
/** Mock: nothing here, the page reads the store's balanceOf. Live: the trial balance, fetched only while `enabled`. */
export const useAccountBalances: (enabled: boolean, asOf: string) => DataResult<Record<string, AccountBalance>> = selectByMode({
  mock: () => NO_BALANCES,
  live: useLiveAccountBalances,
});
