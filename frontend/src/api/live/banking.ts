/** Live banking calls (13 §7, §23). Transport only: adapters shape the results. */
import { http } from '../http';
import type { Intent } from '../idempotency';
import type { CursorPage } from '../cursor';
import type {
  ApiBankAccount,
  ApiBankLine,
  ApiBankMatch,
  ApiBankRule,
  ApiBankStatement,
  ApiBankTransaction,
  ApiReconciliation,
  ApiStatementImport,
} from '../adapters/banking';

type Wrapped<T> = Promise<{ data: T }>;
const base = (company: string) => `/v1/companies/${company}`;
const send = <T>(method: string, path: string, body: unknown, intent: Intent): Wrapped<T> => http.send(method, path, body, intent);
const getJson = <T>(path: string): Promise<T> => http.send<T>('GET', path);

export const listBankAccounts = async (company: string): Promise<ApiBankAccount[]> => (await getJson<{ data: ApiBankAccount[] }>(`${base(company)}/bank-accounts`)).data;

export const createBankAccount = async (company: string, body: unknown, intent: Intent): Promise<ApiBankAccount> =>
  (await send<ApiBankAccount>('POST', `${base(company)}/bank-accounts`, body, intent)).data;

export const updateBankAccount = async (company: string, id: string, body: unknown, intent: Intent): Promise<ApiBankAccount> =>
  (await send<ApiBankAccount>('PUT', `${base(company)}/bank-accounts/${id}`, body, intent)).data;

export const listStatements = async (company: string, bankAccountId: string): Promise<ApiBankStatement[]> =>
  (await getJson<{ data: ApiBankStatement[] }>(`${base(company)}/bank-accounts/${bankAccountId}/statements`)).data;

/** Multipart: the file plus the mapping (as JSON text) and the optional balances. The server answers 201 new, 200 already imported. */
export const importStatement = async (company: string, bankAccountId: string, form: FormData, intent: Intent): Promise<ApiStatementImport> =>
  (await send<ApiStatementImport>('POST', `${base(company)}/bank-accounts/${bankAccountId}/statements`, form, intent)).data;

export interface LineQuery {
  status?: string;
  statement_id?: string;
  from?: string;
  to?: string;
  search?: string;
}

export const listLines = (company: string, bankAccountId: string, q: LineQuery, cursor: string | undefined, limit = 100): Promise<CursorPage<ApiBankLine>> => {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...q, cursor, limit })) if (v !== undefined && v !== '') qs.set(k, String(v));
  return getJson<CursorPage<ApiBankLine>>(`${base(company)}/bank-accounts/${bankAccountId}/lines?${qs.toString()}`);
};

export const getSuggestions = async (company: string, lineId: string) =>
  (await getJson<{ data: { matches: Array<Record<string, unknown>>; rule: unknown } }>(`${base(company)}/bank-statement-lines/${lineId}/suggestions`)).data;

export const codeLine = async (company: string, lineId: string, body: unknown, intent: Intent): Promise<ApiBankTransaction> =>
  (await send<ApiBankTransaction>('POST', `${base(company)}/bank-statement-lines/${lineId}/transactions`, body, intent)).data;

export const applyRule = async (company: string, lineId: string, ruleId: string | undefined, intent: Intent): Promise<ApiBankTransaction> =>
  (await send<ApiBankTransaction>('POST', `${base(company)}/bank-statement-lines/${lineId}/apply-rule`, ruleId ? { rule_id: ruleId } : {}, intent)).data;

export const createMatch = async (company: string, body: { statement_line_ids: string[]; journal_line_ids?: string[]; settlement_ids?: string[] }, intent: Intent): Promise<ApiBankMatch> =>
  (await send<ApiBankMatch>('POST', `${base(company)}/bank-matches`, body, intent)).data;

export const deleteMatch = async (company: string, matchId: string, intent: Intent): Promise<void> => {
  await http.send('DELETE', `${base(company)}/bank-matches/${matchId}`, undefined, intent);
};

export const listReconciliations = async (company: string, bankAccountId: string): Promise<ApiReconciliation[]> =>
  (await getJson<{ data: ApiReconciliation[] }>(`${base(company)}/bank-accounts/${bankAccountId}/reconciliations`)).data;

export const getReconciliation = async (company: string, id: string): Promise<ApiReconciliation> =>
  (await getJson<{ data: ApiReconciliation }>(`${base(company)}/bank-reconciliations/${id}`)).data;

export const startReconciliation = async (company: string, statementId: string, intent: Intent): Promise<ApiReconciliation> =>
  (await send<ApiReconciliation>('POST', `${base(company)}/bank-reconciliations`, { statement_id: statementId }, intent)).data;

export const finishReconciliation = async (company: string, id: string, version: number, intent: Intent): Promise<ApiReconciliation> =>
  (await send<ApiReconciliation>('POST', `${base(company)}/bank-reconciliations/${id}/finish`, { version }, intent)).data;

export const reopenReconciliation = async (company: string, id: string, reason: string, version: number, intent: Intent): Promise<ApiReconciliation> =>
  (await send<ApiReconciliation>('POST', `${base(company)}/bank-reconciliations/${id}/reopen`, { reason, version }, intent)).data;

export const listRules = async (company: string): Promise<ApiBankRule[]> => (await getJson<{ data: ApiBankRule[] }>(`${base(company)}/bank-rules`)).data;

export const createRule = async (company: string, body: unknown, intent: Intent): Promise<ApiBankRule> =>
  (await send<ApiBankRule>('POST', `${base(company)}/bank-rules`, body, intent)).data;

export const updateRule = async (company: string, id: string, body: unknown, intent: Intent): Promise<ApiBankRule> =>
  (await send<ApiBankRule>('PUT', `${base(company)}/bank-rules/${id}`, body, intent)).data;

export const deleteRule = async (company: string, id: string, intent: Intent): Promise<void> => {
  await http.send('DELETE', `${base(company)}/bank-rules/${id}`, undefined, intent);
};

export const reorderRules = async (company: string, ids: string[], intent: Intent): Promise<ApiBankRule[]> =>
  (await send<ApiBankRule[]>('PUT', `${base(company)}/bank-rules/order`, { ids }, intent)).data;

export interface ContactChoice {
  id: string;
  name: string;
  kind: string;
}

export const listContacts = async (company: string): Promise<ContactChoice[]> => {
  const page = await getJson<CursorPage<{ id: string; name: string; kind: string }>>(`${base(company)}/contacts?active=1&limit=200`);
  return page.data.map((c) => ({ id: c.id, name: c.name, kind: c.kind }));
};
