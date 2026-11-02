/**
 * Procurement seam, live side only (docs/15; there is no mock): requisitions, purchase orders and revisions, goods
 * receipts, the three reports and the bill match. Query keys start with the resource name then the company id.
 */
import { useMemo } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { cursorPaging, type CursorPage } from '@/api/cursor';
import * as live from '@/api/live/procurement';
import type { ProcurementQuery } from '@/api/live/procurement';
import {
  toAwaitingReceipt,
  toBillMatch,
  toOpenCommitments,
  toOrder,
  toReceipt,
  toReceivedNotBilled,
  toRequisition,
  toRevision,
  type ApiOrder,
  type ApiReceipt,
  type ApiRequisition,
  type BillMatch,
  type GoodsReceipt,
  type OrderRevision,
  type PurchaseOrder,
  type Requisition,
} from '@/api/adapters/procurement';
import { toDoc, type LiveDoc } from '@/api/adapters/invoice';
import type { ApprovalItem } from '@/api/adapters/journal';
import type { Intent } from '@/api/idempotency';
import { approvalsKey } from './journals';
import { docsKey } from './invoices';
import { useRouteCompany } from './session';
import type { DataResult } from './types';

export const requisitionsKey = (companyId: string) => ['purchase-requisitions', companyId] as const;
export const ordersKey = (companyId: string) => ['purchase-orders', companyId] as const;
export const revisionsKey = (companyId: string) => ['purchase-order-revisions', companyId] as const;
export const receiptsKey = (companyId: string) => ['goods-receipts', companyId] as const;
export const procurementReportsKey = (companyId: string) => ['procurement-reports', companyId] as const;
export const billMatchKey = (companyId: string, id: string) => ['bill-match', companyId, id] as const;

const clean = (f: ProcurementQuery): ProcurementQuery => Object.fromEntries(Object.entries(f).filter(([, v]) => v)) as ProcurementQuery;

/** The shape of a paged list hook: rows, state, "load more". */
function useCursorList<A, V>(key: readonly unknown[], fetchPage: (cursor: string | undefined) => Promise<CursorPage<A>>, map: (a: A) => V) {
  const q = useInfiniteQuery({
    queryKey: key,
    queryFn: ({ pageParam }) => fetchPage(pageParam),
    ...cursorPaging,
    getNextPageParam: (last: CursorPage<A>) => last.meta.next_cursor ?? undefined,
  });
  const rows = useMemo(() => (q.data?.pages ?? []).flatMap((p) => p.data).map(map), [q.data, map]);
  return {
    rows,
    isLoading: q.isLoading,
    error: q.error,
    refetch: () => void q.refetch(),
    hasMore: Boolean(q.hasNextPage),
    loadMore: () => void q.fetchNextPage(),
    isLoadingMore: q.isFetchingNextPage,
  };
}

/** Everything a procurement write can change: the documents, the approvals inbox and the bills made from them. */
function useRefreshAll() {
  const company = useRouteCompany();
  const qc = useQueryClient();
  return () => {
    for (const key of [requisitionsKey(company.id), ordersKey(company.id), revisionsKey(company.id), receiptsKey(company.id), procurementReportsKey(company.id), approvalsKey(company.id), docsKey(company.id, 'bills')]) {
      void qc.invalidateQueries({ queryKey: key });
    }
  };
}

/* -------------------------------------------------------------------- requisitions */

export function useRequisitionList(filters: ProcurementQuery) {
  const company = useRouteCompany();
  const f = clean(filters);
  return useCursorList<ApiRequisition, Requisition>([...requisitionsKey(company.id), 'list', f], (cursor) => live.listRequisitions(company.id, f, cursor), toRequisition);
}

export function useRequisition(id: string | undefined): DataResult<Requisition | null> {
  const company = useRouteCompany();
  const q = useQuery({ queryKey: [...requisitionsKey(company.id), 'one', id], queryFn: () => live.getRequisition(company.id, id as string), enabled: Boolean(id), staleTime: 0 });
  const data = useMemo(() => (q.data ? toRequisition(q.data) : null), [q.data]);
  return { data, isLoading: q.isLoading, error: q.error, refetch: () => void q.refetch() };
}

export function useRequisitionActions() {
  const company = useRouteCompany();
  const qc = useQueryClient();
  const refresh = useRefreshAll();
  // What the server answered is the document now: put it in the cache so the next screen never shows the old state.
  const after = async (p: Promise<ApiRequisition>): Promise<Requisition> => {
    const r = await p;
    if (r.id && r.lines) qc.setQueryData([...requisitionsKey(company.id), 'one', r.id], r);
    refresh();
    return toRequisition(r);
  };
  return {
    create: (body: unknown, intent: Intent) => after(live.createRequisition(company.id, body, intent)),
    update: (id: string, body: unknown, intent: Intent) => after(live.updateRequisition(company.id, id, body, intent)),
    submit: (id: string, version: number, intent: Intent) => after(live.transitionRequisition(company.id, id, 'submit', { version }, intent)),
    approve: (id: string, version: number, intent: Intent) => after(live.transitionRequisition(company.id, id, 'approve', { version }, intent)),
    sendBack: (id: string, comment: string, version: number, intent: Intent) => after(live.transitionRequisition(company.id, id, 'return', { comment, version }, intent)),
    reject: (id: string, reason: string, version: number, intent: Intent) => after(live.transitionRequisition(company.id, id, 'reject', { reason, version }, intent)),
    voidDoc: (id: string, reason: string, version: number, intent: Intent) => after(live.transitionRequisition(company.id, id, 'void', { ...(reason ? { reason } : {}), version }, intent)),
    /** Makes a draft order from lines of this approved requisition. */
    convert: async (id: string, body: unknown, intent: Intent): Promise<PurchaseOrder> => {
      const o = await live.convertRequisition(company.id, id, body, intent);
      if (o.id && o.lines) qc.setQueryData([...ordersKey(company.id), 'one', o.id], o);
      refresh();
      return toOrder(o);
    },
  };
}

/* ------------------------------------------------------------------------- orders */

export function useOrderList(filters: ProcurementQuery) {
  const company = useRouteCompany();
  const f = clean(filters);
  return useCursorList<ApiOrder, PurchaseOrder>([...ordersKey(company.id), 'list', f], (cursor) => live.listOrders(company.id, f, cursor), toOrder);
}

export function useOrder(id: string | undefined): DataResult<PurchaseOrder | null> {
  const company = useRouteCompany();
  const q = useQuery({ queryKey: [...ordersKey(company.id), 'one', id], queryFn: () => live.getOrder(company.id, id as string), enabled: Boolean(id), staleTime: 0 });
  const data = useMemo(() => (q.data ? toOrder(q.data) : null), [q.data]);
  return { data, isLoading: q.isLoading, error: q.error, refetch: () => void q.refetch() };
}

/** One-off fetch (reload after a 409) through the same adapter as the screens. */
export function useFetchOrder() {
  const company = useRouteCompany();
  return async (id: string): Promise<PurchaseOrder> => toOrder(await live.getOrder(company.id, id));
}

export function useOrderActions() {
  const company = useRouteCompany();
  const qc = useQueryClient();
  const refresh = useRefreshAll();
  const after = async (p: Promise<ApiOrder>): Promise<PurchaseOrder> => {
    const r = await p;
    if (r.id && r.lines) qc.setQueryData([...ordersKey(company.id), 'one', r.id], r);
    refresh();
    return toOrder(r);
  };
  const afterBill = async (p: Promise<Parameters<typeof toDoc>[0]>): Promise<LiveDoc> => {
    const b = await p;
    refresh();
    return toDoc(b);
  };
  return {
    create: (body: unknown, intent: Intent) => after(live.createOrder(company.id, body, intent)),
    update: (id: string, body: unknown, intent: Intent) => after(live.updateOrder(company.id, id, body, intent)),
    submit: (id: string, version: number, intent: Intent) => after(live.transitionOrder(company.id, id, 'submit', { version }, intent)),
    approve: (id: string, version: number, intent: Intent) => after(live.transitionOrder(company.id, id, 'approve', { version }, intent)),
    sendBack: (id: string, comment: string, version: number, intent: Intent) => after(live.transitionOrder(company.id, id, 'return', { comment, version }, intent)),
    cancel: (id: string, reason: string, version: number, intent: Intent) => after(live.transitionOrder(company.id, id, 'cancel', { reason, version }, intent)),
    close: (id: string, version: number, intent: Intent) => after(live.transitionOrder(company.id, id, 'close', { version }, intent)),
    /** A bill draft from what was received and not yet billed. */
    createBill: (id: string, body: unknown, intent: Intent) => afterBill(live.createBillFromOrder(company.id, id, body, intent)),
  };
}

export function useOrderReceipts(id: string | undefined, enabled = true): DataResult<GoodsReceipt[]> {
  const company = useRouteCompany();
  const q = useQuery({ queryKey: [...receiptsKey(company.id), 'of-order', id], queryFn: () => live.listOrderReceipts(company.id, id as string), enabled: Boolean(id) && enabled, staleTime: 0 });
  const data = useMemo(() => (q.data ?? []).map(toReceipt), [q.data]);
  return { data, isLoading: q.isLoading, error: q.error, refetch: () => void q.refetch() };
}

export function useOrderBills(id: string | undefined, enabled = true): DataResult<LiveDoc[]> {
  const company = useRouteCompany();
  const q = useQuery({ queryKey: [...ordersKey(company.id), 'bills', id], queryFn: () => live.listOrderBills(company.id, id as string), enabled: Boolean(id) && enabled, staleTime: 0 });
  const data = useMemo(() => (q.data ?? []).map(toDoc), [q.data]);
  return { data, isLoading: q.isLoading, error: q.error, refetch: () => void q.refetch() };
}

export function useOrderRevisions(id: string | undefined, enabled = true): DataResult<OrderRevision[]> {
  const company = useRouteCompany();
  const q = useQuery({ queryKey: [...revisionsKey(company.id), 'of-order', id], queryFn: () => live.listOrderRevisions(company.id, id as string), enabled: Boolean(id) && enabled, staleTime: 0 });
  const data = useMemo(() => (q.data ?? []).map(toRevision), [q.data]);
  return { data, isLoading: q.isLoading, error: q.error, refetch: () => void q.refetch() };
}

/* ----------------------------------------------------------------------- revisions */

export function useRevision(id: string | undefined): DataResult<OrderRevision | null> {
  const company = useRouteCompany();
  const q = useQuery({ queryKey: [...revisionsKey(company.id), 'one', id], queryFn: () => live.getRevision(company.id, id as string), enabled: Boolean(id), staleTime: 0 });
  const data = useMemo(() => (q.data ? toRevision(q.data) : null), [q.data]);
  return { data, isLoading: q.isLoading, error: q.error, refetch: () => void q.refetch() };
}

export function useRevisionActions() {
  const company = useRouteCompany();
  const qc = useQueryClient();
  const refresh = useRefreshAll();
  const after = async (p: Promise<Parameters<typeof toRevision>[0]>): Promise<OrderRevision> => {
    const r = await p;
    qc.setQueryData([...revisionsKey(company.id), 'one', r.id], r);
    refresh();
    return toRevision(r);
  };
  return {
    /** Proposes a change to an approved order; `version` is the order's. */
    create: (orderId: string, body: unknown, intent: Intent) => after(live.createRevision(company.id, orderId, body, intent)),
    update: (id: string, body: unknown, intent: Intent) => after(live.updateRevision(company.id, id, body, intent)),
    submit: (id: string, version: number, intent: Intent) => after(live.transitionRevision(company.id, id, 'submit', { version }, intent)),
    approve: (id: string, version: number, intent: Intent) => after(live.transitionRevision(company.id, id, 'approve', { version }, intent)),
    sendBack: (id: string, comment: string, version: number, intent: Intent) => after(live.transitionRevision(company.id, id, 'return', { comment, version }, intent)),
    voidDoc: (id: string, reason: string, version: number, intent: Intent) => after(live.transitionRevision(company.id, id, 'void', { ...(reason ? { reason } : {}), version }, intent)),
  };
}

/* ----------------------------------------------------------------------- receipts */

export function useReceiptList(filters: ProcurementQuery) {
  const company = useRouteCompany();
  const f = clean(filters);
  return useCursorList<ApiReceipt, GoodsReceipt>([...receiptsKey(company.id), 'list', f], (cursor) => live.listReceipts(company.id, f, cursor), toReceipt);
}

export function useReceipt(id: string | undefined): DataResult<GoodsReceipt | null> {
  const company = useRouteCompany();
  const q = useQuery({ queryKey: [...receiptsKey(company.id), 'one', id], queryFn: () => live.getReceipt(company.id, id as string), enabled: Boolean(id), staleTime: 0 });
  const data = useMemo(() => (q.data ? toReceipt(q.data) : null), [q.data]);
  return { data, isLoading: q.isLoading, error: q.error, refetch: () => void q.refetch() };
}

export function useReceiptActions() {
  const company = useRouteCompany();
  const qc = useQueryClient();
  const refresh = useRefreshAll();
  const after = async (p: Promise<ApiReceipt>): Promise<GoodsReceipt> => {
    const r = await p;
    if (r.id && r.lines) qc.setQueryData([...receiptsKey(company.id), 'one', r.id], r);
    refresh();
    return toReceipt(r);
  };
  return {
    record: (body: unknown, intent: Intent) => after(live.recordReceipt(company.id, body, intent)),
    reverse: (id: string, reason: string, version: number, intent: Intent) => after(live.reverseReceipt(company.id, id, { reason, version }, intent)),
    createBill: async (id: string, body: unknown, intent: Intent): Promise<LiveDoc> => {
      const b = await live.createBillFromReceipt(company.id, id, body, intent);
      refresh();
      return toDoc(b);
    },
  };
}

/* ------------------------------------------------------------------------ reports */

export function useOpenCommitments() {
  const company = useRouteCompany();
  const q = useQuery({ queryKey: [...procurementReportsKey(company.id), 'open-commitments'], queryFn: async () => toOpenCommitments(await live.openCommitments(company.id)), staleTime: 0 });
  return { data: q.data, isLoading: q.isLoading, error: q.error, refetch: () => void q.refetch() };
}

export function useAwaitingReceipt() {
  const company = useRouteCompany();
  const q = useQuery({ queryKey: [...procurementReportsKey(company.id), 'awaiting-receipt'], queryFn: async () => toAwaitingReceipt(await live.awaitingReceipt(company.id)), staleTime: 0 });
  return { data: q.data, isLoading: q.isLoading, error: q.error, refetch: () => void q.refetch() };
}

export function useReceivedNotBilled(asOf: string) {
  const company = useRouteCompany();
  const q = useQuery({
    queryKey: [...procurementReportsKey(company.id), 'received-not-billed', asOf],
    queryFn: async () => toReceivedNotBilled(await live.receivedNotBilled(company.id, asOf)),
    enabled: Boolean(asOf),
    staleTime: 0,
  });
  return { data: q.data, isLoading: q.isLoading, error: q.error, refetch: () => void q.refetch() };
}

/* -------------------------------------------------------------------- bill match */

/** The three-way match of one bill. `applies: false` means there is nothing to show. */
export function useBillMatch(id: string | undefined, enabled: boolean): DataResult<BillMatch | null> {
  const company = useRouteCompany();
  const q = useQuery({ queryKey: billMatchKey(company.id, id ?? ''), queryFn: () => live.getBillMatch(company.id, id as string), enabled: Boolean(id) && enabled, staleTime: 0, retry: false });
  const data = useMemo(() => (q.data ? toBillMatch(q.data) : null), [q.data]);
  return { data, isLoading: q.isLoading, error: q.error, refetch: () => void q.refetch() };
}

/* ------------------------------------------------------------- approvals inbox */

/** Sends a requisition, order or order revision from the approvals inbox back to its maker, by the document's own route. */
export function useReturnProcurementDoc() {
  const company = useRouteCompany();
  const refresh = useRefreshAll();
  return async (item: ApprovalItem, comment: string, intent: Intent): Promise<void> => {
    const body = { comment, version: item.version };
    if (item.api_type === 'purchase_requisition') await live.transitionRequisition(company.id, item.document_id, 'return', body, intent);
    else if (item.api_type === 'purchase_order') await live.transitionOrder(company.id, item.document_id, 'return', body, intent);
    else if (item.api_type === 'purchase_order_revision') await live.transitionRevision(company.id, item.document_id, 'return', body, intent);
    refresh();
  };
}

/** The document types the inbox can send back through a procurement route. */
export const isProcurementApproval = (t: ApprovalItem['document_type']): boolean => t === 'purchase_requisition' || t === 'purchase_order' || t === 'purchase_order_revision';
