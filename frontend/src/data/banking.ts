/**
 * Banking seam, live side (plan 3.7, docs/15). The three mock banking pages keep reading the store; the live pages
 * (`pages/Banking/live/*`) read these hooks. Query keys start with the resource name then the company id.
 * Money stays as the server's integer minor units; no hook adds money up.
 */
import { useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchAllPages } from '@/api/cursor';
import * as live from '@/api/live/banking';
import {
  toBankAccount,
  toBankLine,
  toBankRule,
  toReconciliation,
  toStatement,
  toStatementImport,
  toSuggestions,
  type LineSuggestions,
  type LiveBankAccount,
  type LiveBankLine,
  type LiveBankRule,
  type LiveReconciliation,
  type LiveStatement,
  type StatementImportResult,
} from '@/api/adapters/banking';
import type { Intent } from '@/api/idempotency';
import { useRouteCompany } from './session';
import { approvalsKey, journalsKey } from './journals';
import { accountsKey } from './accounts';
import { http } from '@/api/http';
import { toAccount } from '@/api/adapters/account';
import type { Account } from '@/types';
import type { DataResult } from './types';

export const bankingKey = (companyId: string) => ['banking', companyId] as const;

function useCompanyId(): string {
  return useRouteCompany().id;
}

// One shared empty list, so a hook's `data` keeps the same identity while nothing has loaded (effects and memos depend on it).
const EMPTY: never[] = [];

function result<T>(q: { data: T | undefined; isLoading: boolean; error: unknown; refetch: () => unknown }, empty: T): DataResult<T> {
  return { data: q.data ?? empty, isLoading: q.isLoading, error: q.error, refetch: () => void q.refetch() };
}

/**
 * GET /bank-accounts/{id}/reconciliations answers 500 once any reconciliation exists (the collection resource reads an
 * attribute only the single-item path sets). Until that is fixed the id a person started is remembered in this browser,
 * so the page can still open it. The server's list wins whenever it answers.
 */
const recKey = (companyId: string, statementId: string) => `recon:${companyId}:${statementId}`;
export const rememberReconciliation = (companyId: string, statementId: string, id: string): void => {
  try {
    localStorage.setItem(recKey(companyId, statementId), id);
  } catch {
    /* storage unavailable: the list endpoint is then the only way to find it */
  }
};
export const recalledReconciliation = (companyId: string, statementId: string | undefined): string | undefined => {
  if (!statementId) return undefined;
  try {
    return localStorage.getItem(recKey(companyId, statementId)) ?? undefined;
  } catch {
    return undefined;
  }
};

/** The chart of accounts for the company in the URL (the mirrored store value is one render behind after a reload). */
export function useChartAccounts(): DataResult<Account[]> {
  const company = useRouteCompany();
  const q = useQuery({
    queryKey: accountsKey(company.id),
    queryFn: async () => {
      const rows = await fetchAllPages((cursor) => http.get('/v1/companies/{company}/accounts', { path: { company: company.id }, query: { cursor, limit: 200 } }));
      return rows.map((a) => toAccount(a, { tenantId: company.tenant_id, companyId: company.id }));
    },
  });
  return result(q, EMPTY);
}

export function useBankAccounts(): DataResult<LiveBankAccount[]> {
  const companyId = useCompanyId();
  const q = useQuery({ queryKey: [...bankingKey(companyId), 'accounts'], queryFn: async () => (await live.listBankAccounts(companyId)).map(toBankAccount) });
  return result(q, EMPTY);
}

export function useStatements(bankAccountId: string | undefined): DataResult<LiveStatement[]> {
  const companyId = useCompanyId();
  const q = useQuery({
    queryKey: [...bankingKey(companyId), 'statements', bankAccountId],
    queryFn: async () => (await live.listStatements(companyId, bankAccountId as string)).map(toStatement),
    enabled: Boolean(bankAccountId),
    staleTime: 0,
  });
  return result(q, EMPTY);
}

export function useReconciliations(bankAccountId: string | undefined): DataResult<LiveReconciliation[]> {
  const companyId = useCompanyId();
  const q = useQuery({
    queryKey: [...bankingKey(companyId), 'reconciliations', bankAccountId],
    queryFn: async () => (await live.listReconciliations(companyId, bankAccountId as string)).map(toReconciliation),
    enabled: Boolean(bankAccountId),
    staleTime: 0,
    retry: false,
  });
  return result(q, EMPTY);
}

/** One reconciliation with the server's live report (book items, unmatched statement items, difference). */
export function useReconciliation(id: string | undefined): DataResult<LiveReconciliation | null> {
  const companyId = useCompanyId();
  const q = useQuery({
    queryKey: [...bankingKey(companyId), 'reconciliation', id],
    queryFn: async () => toReconciliation(await live.getReconciliation(companyId, id as string)),
    enabled: Boolean(id),
    staleTime: 0,
  });
  return result(q, null);
}

/**
 * Every line of the account (an account holds at most a few thousand), as the server lists them. A reconciliation covers
 * the lines of every statement up to and including its own, so the page filters this list by statement, not the server.
 */
export function useAccountLines(bankAccountId: string | undefined): DataResult<LiveBankLine[]> {
  const companyId = useCompanyId();
  const q = useQuery({
    queryKey: [...bankingKey(companyId), 'lines', bankAccountId],
    queryFn: async () => (await fetchAllPages((cursor) => live.listLines(companyId, bankAccountId as string, {}, cursor, 200), 30)).map(toBankLine),
    enabled: Boolean(bankAccountId),
    staleTime: 0,
  });
  return result(q, EMPTY);
}

/** The latest lines of an account, for the account drawer. */
export function useRecentLines(bankAccountId: string | undefined, enabled: boolean): DataResult<LiveBankLine[]> {
  const companyId = useCompanyId();
  const q = useQuery({
    queryKey: [...bankingKey(companyId), 'recent-lines', bankAccountId],
    queryFn: async () => (await live.listLines(companyId, bankAccountId as string, {}, undefined, 12)).data.map(toBankLine),
    enabled: enabled && Boolean(bankAccountId),
    staleTime: 0,
  });
  return result(q, EMPTY);
}

export function useLineSuggestions(lineId: string | undefined): DataResult<LineSuggestions | null> {
  const companyId = useCompanyId();
  const q = useQuery({
    queryKey: [...bankingKey(companyId), 'suggestions', lineId],
    queryFn: async () => toSuggestions(await live.getSuggestions(companyId, lineId as string)),
    enabled: Boolean(lineId),
    staleTime: 0,
  });
  return result(q, null);
}

export function useBankRules(): DataResult<LiveBankRule[]> {
  const companyId = useCompanyId();
  const q = useQuery({ queryKey: [...bankingKey(companyId), 'rules'], queryFn: async () => (await live.listRules(companyId)).map(toBankRule) });
  return result(q, EMPTY);
}

export function useContactChoices(): DataResult<live.ContactChoice[]> {
  const companyId = useCompanyId();
  const q = useQuery({ queryKey: ['contacts', companyId, 'choices'], queryFn: () => live.listContacts(companyId), retry: false, staleTime: 60_000 });
  return result(q, EMPTY);
}

/** Every banking write. Each takes the caller's intent (one per user action). Success refreshes the banking queries. */
export function useBankingActions() {
  const companyId = useCompanyId();
  const qc = useQueryClient();
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: bankingKey(companyId) });
  };
  // A coded line makes a journal that may wait for an approver, and posting changes the chart's balances.
  const refreshLedger = () => {
    refresh();
    void qc.invalidateQueries({ queryKey: journalsKey(companyId) });
    void qc.invalidateQueries({ queryKey: approvalsKey(companyId) });
    void qc.invalidateQueries({ queryKey: accountsKey(companyId) });
  };
  const done = async <T,>(p: Promise<T>, ledger = false): Promise<T> => {
    const r = await p;
    if (ledger) refreshLedger();
    else refresh();
    return r;
  };
  return useMemo(
    () => ({
      /** Re-reads everything banking, for when a write may have gone through although its answer did not arrive. */
      refresh,
      createAccount: (body: unknown, intent: Intent) => done(live.createBankAccount(companyId, body, intent).then(toBankAccount)),
      updateAccount: (id: string, body: unknown, intent: Intent) => done(live.updateBankAccount(companyId, id, body, intent).then(toBankAccount)),
      importStatement: (bankAccountId: string, form: FormData, intent: Intent): Promise<StatementImportResult> =>
        done(live.importStatement(companyId, bankAccountId, form, intent).then(toStatementImport)),
      match: (body: { statement_line_ids: string[]; journal_line_ids?: string[]; settlement_ids?: string[] }, intent: Intent) => done(live.createMatch(companyId, body, intent)),
      unmatch: (matchId: string, intent: Intent) => done(live.deleteMatch(companyId, matchId, intent)),
      codeLine: (lineId: string, body: unknown, intent: Intent) => done(live.codeLine(companyId, lineId, body, intent), true),
      applyRule: (lineId: string, ruleId: string | undefined, intent: Intent) => done(live.applyRule(companyId, lineId, ruleId, intent), true),
      startReconciliation: (statementId: string, intent: Intent) => done(live.startReconciliation(companyId, statementId, intent).then(toReconciliation)),
      finishReconciliation: (id: string, version: number, intent: Intent) => done(live.finishReconciliation(companyId, id, version, intent).then(toReconciliation), true),
      reopenReconciliation: (id: string, reason: string, version: number, intent: Intent) => done(live.reopenReconciliation(companyId, id, reason, version, intent).then(toReconciliation)),
      createRule: (body: unknown, intent: Intent) => done(live.createRule(companyId, body, intent).then(toBankRule)),
      updateRule: (id: string, body: unknown, intent: Intent) => done(live.updateRule(companyId, id, body, intent).then(toBankRule)),
      deleteRule: (id: string, intent: Intent) => done(live.deleteRule(companyId, id, intent)),
      reorderRules: (ids: string[], intent: Intent) => done(live.reorderRules(companyId, ids, intent).then((r) => r.map(toBankRule))),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [companyId, qc],
  );
}
