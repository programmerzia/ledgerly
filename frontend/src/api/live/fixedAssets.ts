/** Live fixed asset calls (step 3c.16). Transport only: adapters in ../adapters/fixedAssets shape the results. */
import { API_BASE_URL } from '../config';
import { buildUrl, http } from '../http';
import type { Intent } from '../idempotency';
import type { CursorPage } from '../cursor';
import type { ApiAssetCategory, ApiAssetTaxClass, ApiAssetTransaction, ApiDepreciationRun, ApiFixedAsset } from '../adapters/fixedAssets';

type One<T> = { data: T };
const base = (company: string) => `/v1/companies/${company}`;
const send = async <T>(method: string, path: string, body: unknown, intent: Intent): Promise<T> => (await http.send<One<T>>(method, path, body, intent)).data;
const getOne = async <T>(company: string, path: string, query?: Record<string, unknown>): Promise<T> =>
  (await http.request<One<T>>('GET', buildUrl(API_BASE_URL, `/v1/companies/{company}${path}`, { company }, query), undefined)).data;
const getPage = <T>(company: string, path: string, query: Record<string, unknown>): Promise<CursorPage<T>> =>
  http.request<CursorPage<T>>('GET', buildUrl(API_BASE_URL, `/v1/companies/{company}${path}`, { company }, query), undefined);

/* categories */
export const listCategories = (company: string, cursor?: string) => getPage<ApiAssetCategory>(company, '/asset-categories', { cursor, limit: 100 });
export const createCategory = (company: string, body: unknown, intent: Intent) => send<ApiAssetCategory>('POST', `${base(company)}/asset-categories`, body, intent);
export const updateCategory = (company: string, id: string, body: unknown, intent: Intent) => send<ApiAssetCategory>('PUT', `${base(company)}/asset-categories/${id}`, body, intent);

/* tax classes and schedule */
export const listTaxClasses = (company: string, cursor?: string) => getPage<ApiAssetTaxClass>(company, '/asset-tax-classes', { cursor, limit: 100 });
export const createTaxClass = (company: string, body: unknown, intent: Intent) => send<ApiAssetTaxClass>('POST', `${base(company)}/asset-tax-classes`, body, intent);
export const updateTaxClass = (company: string, id: string, body: unknown, intent: Intent) => send<ApiAssetTaxClass>('PUT', `${base(company)}/asset-tax-classes/${id}`, body, intent);
export const getTaxSchedule = (company: string, from?: number, to?: number) => getOne<unknown>(company, '/fixed-assets/tax-schedule', { from_year: from, to_year: to });

/* register */
export const listAssets = (company: string, q: { category_id?: string; status?: string; q?: string }, cursor?: string, limit = 50) =>
  getPage<ApiFixedAsset>(company, '/fixed-assets', { ...q, cursor, limit });
export const createAsset = (company: string, body: unknown, intent: Intent) => send<ApiFixedAsset>('POST', `${base(company)}/fixed-assets`, body, intent);
export const updateAsset = (company: string, id: string, body: unknown, intent: Intent) => send<ApiFixedAsset>('PUT', `${base(company)}/fixed-assets/${id}`, body, intent);
export const getCapitalisable = (company: string) => getOne<unknown[]>(company, '/fixed-assets/capitalisable');
export const getReconciliation = (company: string, asOf?: string) => getOne<unknown>(company, '/fixed-assets/reconciliation', { as_of: asOf });

/* depreciation runs */
export const listRuns = (company: string, cursor?: string) => getPage<ApiDepreciationRun>(company, '/depreciation-runs', { cursor, limit: 50 });
export const previewRun = (company: string, periodId: string, units: Record<string, string>) =>
  getOne<unknown>(company, '/depreciation-runs/preview', { period_id: periodId, ...units });
export const createRun = (company: string, body: unknown, intent: Intent) => send<ApiDepreciationRun>('POST', `${base(company)}/depreciation-runs`, body, intent);
export const transitionRun = (company: string, id: string, action: 'submit' | 'approve' | 'return' | 'void' | 'reverse', body: Record<string, unknown>, intent: Intent) =>
  send<ApiDepreciationRun>('POST', `${base(company)}/depreciation-runs/${id}/${action}`, body, intent);

/* disposals, impairments, revaluations */
export const listTransactions = (company: string, q: { kind?: string; status?: string }, cursor?: string) =>
  getPage<ApiAssetTransaction>(company, '/asset-transactions', { ...q, cursor, limit: 50 });
export const previewTransaction = (company: string, body: unknown, intent: Intent) => send<unknown>('POST', `${base(company)}/asset-transactions/preview`, body, intent);
export const createTransaction = (company: string, body: unknown, intent: Intent) => send<ApiAssetTransaction>('POST', `${base(company)}/asset-transactions`, body, intent);
export const transitionTransaction = (company: string, id: string, action: 'submit' | 'approve' | 'return' | 'void' | 'reverse', body: Record<string, unknown>, intent: Intent) =>
  send<ApiAssetTransaction>('POST', `${base(company)}/asset-transactions/${id}/${action}`, body, intent);

/* asset schedule report */
export const getAssetSchedule = (company: string, query: Record<string, string>, signal?: AbortSignal) =>
  http.request<One<unknown>>('GET', buildUrl(API_BASE_URL, '/v1/companies/{company}/reports/asset-schedule', { company }, query), undefined, undefined, signal).then((r) => r.data);
