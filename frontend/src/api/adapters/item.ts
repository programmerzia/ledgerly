/** Items (products and services) at the API boundary. Prices are integer minor units of the item's own currency. */
import type { components } from '../schema';
import { fromApiMoney } from './money';

export type ApiItemResource = components['schemas']['ItemResource'];

export interface LiveItem {
  id: string;
  code: string;
  name: string;
  description: string;
  kind: 'service' | 'good';
  currency: string;
  sales_account_id: string | null;
  purchase_account_id: string | null;
  sales_price: number;
  purchase_price: number;
  tax_code_id: string | null;
  is_active: boolean;
  version: number;
  can: { update: boolean; deactivate: boolean };
}

export function toLiveItem(a: ApiItemResource): LiveItem {
  const can = (a.can && typeof a.can === 'object' ? a.can : {}) as Record<string, unknown>;
  return {
    id: a.id,
    code: a.code,
    name: a.name,
    description: a.description ?? '',
    kind: a.kind === 'good' ? 'good' : 'service',
    currency: a.currency,
    sales_account_id: a.sales_account_id,
    purchase_account_id: a.purchase_account_id,
    sales_price: fromApiMoney(a.sales_price),
    purchase_price: fromApiMoney(a.purchase_price),
    tax_code_id: a.tax_code_id,
    is_active: a.is_active,
    version: a.version,
    can: { update: can.update === true, deactivate: can.deactivate === true },
  };
}

export interface ItemDraft {
  code: string;
  name: string;
  description: string;
  kind: 'service' | 'good';
  currency: string;
  sales_account_id: string;
  purchase_account_id: string;
  /** Minor units; 0 means no default price. */
  sales_price: number;
  purchase_price: number;
  tax_code_id: string;
}

export const draftOfItem = (i: LiveItem): ItemDraft => ({
  code: i.code,
  name: i.name,
  description: i.description,
  kind: i.kind,
  currency: i.currency,
  sales_account_id: i.sales_account_id ?? '',
  purchase_account_id: i.purchase_account_id ?? '',
  sales_price: i.sales_price,
  purchase_price: i.purchase_price,
  tax_code_id: i.tax_code_id ?? '',
});

/** Create (no version) or replace (version of the copy it was based on). */
export function toItemRequest(d: ItemDraft, version?: number): Record<string, unknown> {
  const body: Record<string, unknown> = {
    code: d.code.trim(),
    name: d.name.trim(),
    description: d.description.trim() || null,
    kind: d.kind,
    currency: d.currency,
    sales_account_id: d.sales_account_id || null,
    purchase_account_id: d.purchase_account_id || null,
    sales_price: d.sales_price > 0 ? d.sales_price : null,
    purchase_price: d.purchase_price > 0 ? d.purchase_price : null,
    tax_code_id: d.tax_code_id || null,
  };
  if (version !== undefined) body.version = version;
  return body;
}
