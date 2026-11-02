/**
 * Live procurement calls: purchase requisitions, purchase orders and their revisions, goods receipts, the reports and the
 * bill match. Transport only: the adapters shape the results. Every write takes an Intent (one per user action).
 */
import { http } from '../http';
import type { Intent } from '../idempotency';
import type { CursorPage } from '../cursor';
import type { ApiInvoice } from '../adapters/invoice';
import type { ApiAwaitingReceipt, ApiBillMatch, ApiOpenCommitments, ApiOrder, ApiReceipt, ApiReceivedNotBilled, ApiRequisition, ApiRevision } from '../adapters/procurement';

const base = (company: string) => `/v1/companies/${company}`;

function qs(query: Record<string, unknown>): string {
  const p = new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined && v !== '' && v !== null).map(([k, v]) => [k, String(v)]));
  const s = p.toString();
  return s ? `?${s}` : '';
}
const getPage = <T>(path: string, query: Record<string, unknown>): Promise<CursorPage<T>> => http.send<CursorPage<T>>('GET', `${path}${qs(query)}`);
const getOne = async <T>(path: string, query: Record<string, unknown> = {}): Promise<T> => (await http.send<{ data: T }>('GET', `${path}${qs(query)}`)).data;
const getList = async <T>(path: string): Promise<T[]> => (await http.send<{ data: T[] }>('GET', path)).data;
const post = async <T>(path: string, body: unknown, intent: Intent): Promise<T> => (await http.send<{ data: T }>('POST', path, body, intent)).data;
const put = async <T>(path: string, body: unknown, intent: Intent): Promise<T> => (await http.send<{ data: T }>('PUT', path, body, intent)).data;

export interface ProcurementQuery {
  status?: string;
  contact_id?: string;
  purchase_order_id?: string;
}

/* -------------------------------------------------------------------- requisitions */

export type RequisitionVerb = 'submit' | 'approve' | 'return' | 'void' | 'reject';
export const listRequisitions = (company: string, q: ProcurementQuery, cursor: string | undefined, limit = 25) => getPage<ApiRequisition>(`${base(company)}/purchase-requisitions`, { ...q, cursor, limit });
export const getRequisition = (company: string, id: string) => getOne<ApiRequisition>(`${base(company)}/purchase-requisitions/${id}`);
export const createRequisition = (company: string, body: unknown, intent: Intent) => post<ApiRequisition>(`${base(company)}/purchase-requisitions`, body, intent);
export const updateRequisition = (company: string, id: string, body: unknown, intent: Intent) => put<ApiRequisition>(`${base(company)}/purchase-requisitions/${id}`, body, intent);
export const transitionRequisition = (company: string, id: string, verb: RequisitionVerb, body: Record<string, unknown>, intent: Intent) =>
  post<ApiRequisition>(`${base(company)}/purchase-requisitions/${id}/${verb}`, body, intent);
export const convertRequisition = (company: string, id: string, body: unknown, intent: Intent) => post<ApiOrder>(`${base(company)}/purchase-requisitions/${id}/convert`, body, intent);

/* ------------------------------------------------------------------------- orders */

export type OrderVerb = 'submit' | 'approve' | 'return' | 'cancel' | 'close';
export const listOrders = (company: string, q: ProcurementQuery, cursor: string | undefined, limit = 25) => getPage<ApiOrder>(`${base(company)}/purchase-orders`, { ...q, cursor, limit });
export const getOrder = (company: string, id: string) => getOne<ApiOrder>(`${base(company)}/purchase-orders/${id}`);
export const createOrder = (company: string, body: unknown, intent: Intent) => post<ApiOrder>(`${base(company)}/purchase-orders`, body, intent);
export const updateOrder = (company: string, id: string, body: unknown, intent: Intent) => put<ApiOrder>(`${base(company)}/purchase-orders/${id}`, body, intent);
export const transitionOrder = (company: string, id: string, verb: OrderVerb, body: Record<string, unknown>, intent: Intent) => post<ApiOrder>(`${base(company)}/purchase-orders/${id}/${verb}`, body, intent);
export const createBillFromOrder = (company: string, id: string, body: unknown, intent: Intent) => post<ApiInvoice>(`${base(company)}/purchase-orders/${id}/bill`, body, intent);
export const listOrderReceipts = (company: string, id: string) => getList<ApiReceipt>(`${base(company)}/purchase-orders/${id}/receipts`);
export const listOrderBills = (company: string, id: string) => getList<ApiInvoice>(`${base(company)}/purchase-orders/${id}/bills`);
export const listOrderRevisions = (company: string, id: string) => getList<ApiRevision>(`${base(company)}/purchase-orders/${id}/revisions`);
export const createRevision = (company: string, id: string, body: unknown, intent: Intent) => post<ApiRevision>(`${base(company)}/purchase-orders/${id}/revisions`, body, intent);

/* ----------------------------------------------------------------------- revisions */

export type RevisionVerb = 'submit' | 'approve' | 'return' | 'void';
export const getRevision = (company: string, id: string) => getOne<ApiRevision>(`${base(company)}/purchase-order-revisions/${id}`);
export const updateRevision = (company: string, id: string, body: unknown, intent: Intent) => put<ApiRevision>(`${base(company)}/purchase-order-revisions/${id}`, body, intent);
export const transitionRevision = (company: string, id: string, verb: RevisionVerb, body: Record<string, unknown>, intent: Intent) =>
  post<ApiRevision>(`${base(company)}/purchase-order-revisions/${id}/${verb}`, body, intent);

/* ----------------------------------------------------------------------- receipts */

export const listReceipts = (company: string, q: ProcurementQuery, cursor: string | undefined, limit = 25) => getPage<ApiReceipt>(`${base(company)}/goods-receipts`, { ...q, cursor, limit });
export const getReceipt = (company: string, id: string) => getOne<ApiReceipt>(`${base(company)}/goods-receipts/${id}`);
export const recordReceipt = (company: string, body: unknown, intent: Intent) => post<ApiReceipt>(`${base(company)}/goods-receipts`, body, intent);
export const reverseReceipt = (company: string, id: string, body: Record<string, unknown>, intent: Intent) => post<ApiReceipt>(`${base(company)}/goods-receipts/${id}/reverse`, body, intent);
export const createBillFromReceipt = (company: string, id: string, body: unknown, intent: Intent) => post<ApiInvoice>(`${base(company)}/goods-receipts/${id}/bill`, body, intent);

/* ------------------------------------------------------------------------ reports */

export const openCommitments = (company: string) => http.send<ApiOpenCommitments>('GET', `${base(company)}/procurement/open-commitments`);
export const awaitingReceipt = (company: string) => http.send<ApiAwaitingReceipt>('GET', `${base(company)}/procurement/awaiting-receipt`);
export const receivedNotBilled = (company: string, asOf: string) => http.send<ApiReceivedNotBilled>('GET', `${base(company)}/procurement/received-not-billed${qs({ as_of: asOf })}`);

/* -------------------------------------------------------------------- bill match */

export const getBillMatch = (company: string, id: string) => getOne<ApiBillMatch>(`${base(company)}/bills/${id}/match`);
