/**
 * Live contacts, documents (invoices, credit notes; bills and debit notes use the same shapes on /bills), settlements,
 * items, tax codes and bank accounts (13 §10). Transport only: the adapters shape the results.
 */
import { http, buildUrl } from '../http';
import { API_BASE_URL } from '../config';
import { NetworkError, problemToError } from '../errors';
import type { ExportedFile } from './reports';
import type { Intent } from '../idempotency';
import type { CursorPage } from '../cursor';
import type { ApiContact } from '../adapters/contact';
import type { ApiInvoice, ApiInvoicePreview } from '../adapters/invoice';
import type { ApiCreditApplication, ApiSettlement } from '../adapters/settlement';
import type { components } from '../schema';

export type ApiItem = components['schemas']['ItemResource'];
export type ApiTaxCode = components['schemas']['TaxCodeResource'];
export type ApiBankAccount = components['schemas']['BankAccountResource'];

/** The collection a document lives under. Sales documents are `invoices`; the purchases screens use `bills`. */
export type DocResource = 'invoices' | 'bills';

const base = (company: string) => `/v1/companies/${company}`;
type Wrapped<T> = Promise<{ data: T }>;
const post = <T>(path: string, body: unknown, intent: Intent): Wrapped<T> => http.send('POST', path, body, intent);
const getPage = <T>(path: string, query: Record<string, unknown>): Promise<CursorPage<T>> =>
  http.send<CursorPage<T>>('GET', `${path}?${new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined && v !== '' && v !== null).map(([k, v]) => [k, String(v)])).toString()}`);
const getOne = async <T>(path: string): Promise<T> => (await http.send<{ data: T }>('GET', path)).data;

/* ------------------------------------------------------------------ contacts */

export interface ContactQuery {
  kind?: string;
  active?: string;
  search?: string;
}

export const listContacts = (company: string, q: ContactQuery, cursor: string | undefined, limit = 50) =>
  getPage<ApiContact>(`${base(company)}/contacts`, { ...q, cursor, limit });
export const getContact = (company: string, id: string) => getOne<ApiContact>(`${base(company)}/contacts/${id}`);
export const createContact = async (company: string, body: unknown, intent: Intent) => (await post<ApiContact>(`${base(company)}/contacts`, body, intent)).data;
export const updateContact = async (company: string, id: string, body: unknown, intent: Intent) =>
  (await http.send<{ data: ApiContact }>('PUT', `${base(company)}/contacts/${id}`, body, intent)).data;
export const deactivateContact = async (company: string, id: string, version: number, intent: Intent) =>
  (await post<ApiContact>(`${base(company)}/contacts/${id}/deactivate`, { version }, intent)).data;

/* ----------------------------------------------------------------- documents */

export interface DocQuery {
  kind?: string;
  status?: string;
  payment_status?: string;
  overdue?: string;
  contact_id?: string;
  issued_from?: string;
  issued_to?: string;
  search?: string;
}

export const listDocs = (company: string, resource: DocResource, q: DocQuery, cursor: string | undefined, limit = 25) =>
  getPage<ApiInvoice>(`${base(company)}/${resource}`, { ...q, cursor, limit });
export const getDoc = (company: string, resource: DocResource, id: string) => getOne<ApiInvoice>(`${base(company)}/${resource}/${id}`);
export const createDoc = async (company: string, resource: DocResource, body: unknown, intent: Intent) =>
  (await post<ApiInvoice>(`${base(company)}/${resource}`, body, intent)).data;
export const updateDoc = async (company: string, resource: DocResource, id: string, body: unknown, intent: Intent) =>
  (await http.send<{ data: ApiInvoice }>('PUT', `${base(company)}/${resource}/${id}`, body, intent)).data;
export const previewDoc = async (company: string, resource: DocResource, id: string, intent: Intent) =>
  (await post<ApiInvoicePreview>(`${base(company)}/${resource}/${id}/posting-preview`, {}, intent)).data;
export const transitionDoc = async (
  company: string,
  resource: DocResource,
  id: string,
  action: 'submit' | 'approve' | 'return' | 'void' | 'reverse',
  body: Record<string, unknown>,
  intent: Intent,
) => (await post<ApiInvoice>(`${base(company)}/${resource}/${id}/${action}`, body, intent)).data;
/** Applies this posted credit note (or debit note) to an open document of the same contact. */
export const applyCredit = async (company: string, resource: DocResource, id: string, body: { invoice_id: string; amount_fc: number; date?: string }, intent: Intent) =>
  (await post<ApiCreditApplication>(`${base(company)}/${resource}/${id}/allocate`, body, intent)).data;

/* --------------------------------------------------------------- settlements */

export interface SettlementQuery {
  kind?: string;
  status?: string;
  contact_id?: string;
  from?: string;
  to?: string;
  search?: string;
}

export const listSettlements = (company: string, q: SettlementQuery, cursor: string | undefined, limit = 25) =>
  getPage<ApiSettlement>(`${base(company)}/settlements`, { ...q, cursor, limit });
export const getSettlement = (company: string, id: string) => getOne<ApiSettlement>(`${base(company)}/settlements/${id}`);
export const createSettlement = async (company: string, body: unknown, intent: Intent) => (await post<ApiSettlement>(`${base(company)}/settlements`, body, intent)).data;
export const updateSettlement = async (company: string, id: string, body: unknown, intent: Intent) =>
  (await http.send<{ data: ApiSettlement }>('PUT', `${base(company)}/settlements/${id}`, body, intent)).data;
export const previewSettlement = async (company: string, id: string, intent: Intent) =>
  (await post<ApiInvoicePreview>(`${base(company)}/settlements/${id}/posting-preview`, {}, intent)).data;
export const transitionSettlement = async (
  company: string,
  id: string,
  action: 'submit' | 'approve' | 'return' | 'void' | 'reverse',
  body: Record<string, unknown>,
  intent: Intent,
) => (await post<ApiSettlement>(`${base(company)}/settlements/${id}/${action}`, body, intent)).data;
/** Applies the credit on account of a posted receipt to an open document. */
export const applySettlementCredit = async (company: string, id: string, body: { invoice_id: string; amount_fc: number; date?: string }, intent: Intent) =>
  (await post<ApiCreditApplication>(`${base(company)}/settlements/${id}/allocate`, body, intent)).data;

/* ---------------------------------------------------------------- references */

export const listItems = (company: string, cursor: string | undefined) => getPage<ApiItem>(`${base(company)}/items`, { active: 'true', cursor, limit: 200 });
export const listTaxCodes = (company: string, cursor: string | undefined) => getPage<ApiTaxCode>(`${base(company)}/tax-codes`, { active: 'true', cursor, limit: 200 });
export const listBankAccounts = async (company: string): Promise<ApiBankAccount[]> => (await http.send<{ data: ApiBankAccount[] }>('GET', `${base(company)}/bank-accounts`)).data;

/* ----------------------------------------------------------- WHT certificates */

export type ApiWhtCertificate = components['schemas']['WhtCertificateResource'];
export interface WhtQuery {
  contact_id?: string;
  status?: string;
  from?: string;
  to?: string;
}
export const listWhtCertificates = (company: string, q: WhtQuery, cursor: string | undefined, limit = 50) =>
  getPage<ApiWhtCertificate>(`${base(company)}/wht-certificates`, { ...q, cursor, limit });

/* ------------------------------------------------------------- payment runs */

export type ApiPaymentRun = components['schemas']['PaymentRunResource'];

export const listPaymentRuns = (company: string, q: { status?: string }, cursor: string | undefined, limit = 25) =>
  getPage<ApiPaymentRun>(`${base(company)}/payment-runs`, { ...q, cursor, limit });
export const getPaymentRun = (company: string, id: string) => getOne<ApiPaymentRun>(`${base(company)}/payment-runs/${id}`);
export const createPaymentRun = async (company: string, body: unknown, intent: Intent) => (await post<ApiPaymentRun>(`${base(company)}/payment-runs`, body, intent)).data;
export const updatePaymentRun = async (company: string, id: string, body: unknown, intent: Intent) =>
  (await http.send<{ data: ApiPaymentRun }>('PUT', `${base(company)}/payment-runs/${id}`, body, intent)).data;
export const previewPaymentRun = async (company: string, id: string, intent: Intent) =>
  (await post<ApiInvoicePreview>(`${base(company)}/payment-runs/${id}/posting-preview`, {}, intent)).data;
export const transitionPaymentRun = async (company: string, id: string, action: 'submit' | 'approve' | 'return' | 'void', body: Record<string, unknown>, intent: Intent) =>
  (await post<ApiPaymentRun>(`${base(company)}/payment-runs/${id}/${action}`, body, intent)).data;

/** The bank file of a posted run (CSV, generated on demand). */
export async function downloadBankFile(company: string, id: string, fallbackName: string): Promise<ExportedFile> {
  const url = buildUrl(API_BASE_URL, '/v1/companies/{company}/payment-runs/{paymentRun}/export', { company, paymentRun: id });
  let res: Response;
  try {
    res = await fetch(url, { method: 'GET', credentials: 'include', headers: { Accept: 'text/csv, application/json', 'X-Requested-With': 'XMLHttpRequest' } });
  } catch (e) {
    throw new NetworkError(e);
  }
  if (!res.ok) {
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    throw problemToError(res.status, body, res.headers);
  }
  const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(res.headers.get('Content-Disposition') ?? '');
  return { blob: await res.blob(), filename: m ? decodeURIComponent(m[1]) : fallbackName };
}

/* ----------------------------------------------------- tax codes and groups */

export type ApiTaxCodeFull = components['schemas']['TaxCodeResource'];
export type ApiTaxGroup = components['schemas']['TaxGroupResource'];

export const listAllTaxCodes = (company: string, cursor: string | undefined) => getPage<ApiTaxCodeFull>(`${base(company)}/tax-codes`, { cursor, limit: 200 });
export const createTaxCodeFull = async (company: string, body: unknown, intent: Intent) => (await post<ApiTaxCodeFull>(`${base(company)}/tax-codes`, body, intent)).data;
export const updateTaxCode = async (company: string, id: string, body: unknown, intent: Intent) =>
  (await http.send<{ data: ApiTaxCodeFull }>('PUT', `${base(company)}/tax-codes/${id}`, body, intent)).data;
export const addTaxRate = async (company: string, id: string, body: unknown, intent: Intent) => (await post<ApiTaxCodeFull>(`${base(company)}/tax-codes/${id}/rates`, body, intent)).data;
export const deactivateTaxCode = async (company: string, id: string, version: number, intent: Intent) =>
  (await post<ApiTaxCodeFull>(`${base(company)}/tax-codes/${id}/deactivate`, { version }, intent)).data;

export const listTaxGroups = (company: string, cursor: string | undefined) => getPage<ApiTaxGroup>(`${base(company)}/tax-groups`, { cursor, limit: 200 });
export const createTaxGroup = async (company: string, body: unknown, intent: Intent) => (await post<ApiTaxGroup>(`${base(company)}/tax-groups`, body, intent)).data;
export const updateTaxGroup = async (company: string, id: string, body: unknown, intent: Intent) =>
  (await http.send<{ data: ApiTaxGroup }>('PUT', `${base(company)}/tax-groups/${id}`, body, intent)).data;
export const deactivateTaxGroup = async (company: string, id: string, version: number, intent: Intent) =>
  (await post<ApiTaxGroup>(`${base(company)}/tax-groups/${id}/deactivate`, { version }, intent)).data;

/* -------------------------------------------------------------------- items */

export interface ItemQuery {
  kind?: string;
  active?: string;
  search?: string;
}
export const listItemsPage = (company: string, q: ItemQuery, cursor: string | undefined, limit = 50) => getPage<ApiItem>(`${base(company)}/items`, { ...q, cursor, limit });
export const createItem = async (company: string, body: unknown, intent: Intent) => (await post<ApiItem>(`${base(company)}/items`, body, intent)).data;
export const updateItem = async (company: string, id: string, body: unknown, intent: Intent) =>
  (await http.send<{ data: ApiItem }>('PUT', `${base(company)}/items/${id}`, body, intent)).data;
export const deactivateItem = async (company: string, id: string, version: number, intent: Intent) => (await post<ApiItem>(`${base(company)}/items/${id}/deactivate`, { version }, intent)).data;

/* ------------------------------------------------- recurring invoices and bills */

export type ApiSchedule = components['schemas']['RecurringScheduleResource'];
export type ApiScheduleRun = components['schemas']['RecurringRunResource'];

export const listRecurringDocs = (company: string, cursor: string | undefined) => getPage<ApiSchedule>(`${base(company)}/recurring-invoices`, { cursor, limit: 100 });
export const createRecurringDoc = async (company: string, body: unknown, intent: Intent) => (await post<ApiSchedule>(`${base(company)}/recurring-invoices`, body, intent)).data;
export const updateRecurringDoc = async (company: string, id: string, body: unknown, intent: Intent) =>
  (await http.send<{ data: ApiSchedule }>('PUT', `${base(company)}/recurring-invoices/${id}`, body, intent)).data;
export const toggleRecurringDoc = async (company: string, id: string, action: 'pause' | 'resume', version: number, intent: Intent) =>
  (await post<ApiSchedule>(`${base(company)}/recurring-invoices/${id}/${action}`, { version }, intent)).data;
export const runRecurringDocs = async (company: string, body: { as_of?: string; schedule_id?: string }, intent: Intent) =>
  (await post<{ created: ApiScheduleRun[]; failures: string[] }>(`${base(company)}/recurring-runs`, body, intent)).data;
