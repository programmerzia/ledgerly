/**
 * Contacts at the API boundary: ContactResource -> the existing `Contact` view type (plus what the screens need
 * from the server), and the form -> ContactRequest. One adapter for customers and suppliers: `kind` is data.
 */
import type { components } from '../schema';
import type { Contact, ContactKind } from '@/types';
import { fromApiMoney, type ApiMoney } from './money';

export type ApiContact = components['schemas']['ContactResource'];

export interface ContactCan {
  update: boolean;
  deactivate: boolean;
}

export interface LiveContact extends Contact {
  version: number;
  /** Receivable and payable the server holds for this contact, base currency, integer minor units. */
  receivable: number;
  payable: number;
  baseCurrency: string;
  creditLimitCurrency?: string;
  notes: string;
  billing_address: string[];
  shipping_address: string[];
  can: ContactCan;
  /** The resource as received; an edit resends what the form does not show (PUT replaces the contact). */
  raw: ApiContact;
}

/** The API answers an address as a list or, for a keyed one, an object; the form edits it as lines. */
export function addressLines(a: unknown): string[] {
  if (Array.isArray(a)) return a.filter((x): x is string => typeof x === 'string');
  if (a && typeof a === 'object') return Object.values(a as Record<string, unknown>).filter((x): x is string => typeof x === 'string');
  return [];
}

export function toContactCan(raw: unknown): ContactCan {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return { update: r.update === true, deactivate: r.deactivate === true };
}

export function toContact(a: ApiContact, scope: { tenantId: string; companyId: string }): LiveContact {
  const balances = a.balances as { receivable?: ApiMoney; payable?: ApiMoney } | undefined;
  return {
    id: a.id,
    tenant_id: scope.tenantId,
    company_id: scope.companyId,
    kind: a.kind as ContactKind,
    code: a.code,
    name: a.name,
    legal_name: a.legal_name ?? undefined,
    tax_id: a.tax_id ?? undefined,
    email: a.email ?? '',
    phone: a.phone ?? undefined,
    default_currency: a.default_currency,
    payment_terms_days: a.payment_terms_days,
    credit_limit: a.credit_limit?.amount != null ? a.credit_limit.amount : undefined,
    creditLimitCurrency: a.credit_limit?.currency,
    wht_code_id: a.wht_code_id ?? undefined,
    default_account_id: a.default_account_id ?? undefined,
    default_tax_code_id: a.default_tax_code_id ?? undefined,
    default_branch: a.default_branch ?? undefined,
    is_active: a.is_active,
    version: a.version,
    receivable: balances?.receivable ? fromApiMoney(balances.receivable) : 0,
    payable: balances?.payable ? fromApiMoney(balances.payable) : 0,
    baseCurrency: balances?.receivable?.currency ?? a.default_currency,
    notes: a.notes ?? '',
    billing_address: addressLines(a.billing_address),
    shipping_address: addressLines(a.shipping_address),
    can: toContactCan(a.can),
    raw: a,
  };
}

/** What the contact form collects. */
export interface ContactDraft {
  kind: ContactKind;
  code: string;
  name: string;
  email: string;
  phone: string;
  tax_id: string;
  default_currency: string;
  payment_terms_days: number;
  /** Minor units of the default currency; null means no limit. */
  credit_limit: number | null;
  billing_address: string[];
  notes: string;
}

const orNull = (s: string): string | null => (s.trim() === '' ? null : s.trim());

/**
 * Create (no `existing`) or replace (with `existing`, which supplies the version and every field the form does not
 * show: accounts, tax code, shipping address, dimensions) a contact.
 */
export function toContactRequest(d: ContactDraft, existing?: LiveContact): Record<string, unknown> {
  const body: Record<string, unknown> = {
    kind: d.kind,
    code: d.code.trim(),
    name: d.name.trim(),
    legal_name: existing?.raw.legal_name ?? null,
    tax_id: orNull(d.tax_id),
    email: orNull(d.email),
    phone: orNull(d.phone),
    billing_address: d.billing_address.map((l) => l.trim()).filter(Boolean),
    default_currency: d.default_currency,
    payment_terms_days: d.payment_terms_days,
    credit_limit: d.credit_limit == null ? null : { amount: d.credit_limit, currency: d.default_currency },
    notes: orNull(d.notes),
  };
  if (existing) {
    const r = existing.raw;
    body.shipping_address = existing.shipping_address;
    body.ar_account_id = r.ar_account_id;
    body.ap_account_id = r.ap_account_id;
    body.wht_code_id = r.wht_code_id;
    body.default_account_id = r.default_account_id;
    body.default_tax_code_id = r.default_tax_code_id;
    body.default_branch = r.default_branch;
    body.default_dims = Object.keys(r.default_dims ?? {}).length ? Object.keys(r.default_dims) : null;
    body.version = existing.version;
  }
  return body;
}

export const draftOf = (c: LiveContact): ContactDraft => ({
  kind: c.kind,
  code: c.code,
  name: c.name,
  email: c.email,
  phone: c.phone ?? '',
  tax_id: c.tax_id ?? '',
  default_currency: c.default_currency,
  payment_terms_days: c.payment_terms_days,
  credit_limit: c.credit_limit ?? null,
  billing_address: c.billing_address,
  notes: c.notes,
});
