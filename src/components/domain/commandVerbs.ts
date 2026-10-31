/**
 * Command palette verbs: turns typed phrases such as "pay BILL-2026-0012" or
 * "new invoice for hormuud" into a concrete action plus the entities it recognised.
 * Pure: it never touches the store; the palette decides how to run the result.
 */
import { amountDue } from '@/lib/docStatus';

export type VerbEntity = { kind: 'bill' | 'invoice' | 'journal' | 'contact' | 'bank' | 'period'; label: string };

export type VerbAction =
  | { type: 'navigate'; path: string; message?: string }
  | { type: 'runRecurring' };

export interface VerbMatch {
  id: string;
  title: string;
  hint: string;
  entities: VerbEntity[];
  action: VerbAction;
}

export interface VerbContext {
  invoices: { id: string; number: string | null; contact_id: string; total: number; settled: number; wht_amount_fc?: number; fx_rate?: number; status: string }[];
  bills: { id: string; number: string | null; status: string }[];
  journals: { id: string; number: string | null; status: string }[];
  contacts: { id: string; name: string; code: string; kind: string }[];
  bankAccounts: { id: string; name: string; bank_name?: string }[];
}

const norm = (s: string) => s.toLowerCase().trim();

const findByNumber = <T extends { number: string | null }>(list: T[], token: string): T | undefined =>
  list.find((x) => x.number && norm(x.number) === norm(token));

const findContact = (ctx: VerbContext, q: string, kind?: string) => {
  const n = norm(q);
  if (n.length < 2) return undefined;
  const pool = kind ? ctx.contacts.filter((c) => c.kind === kind || c.kind === 'both') : ctx.contacts;
  return (
    pool.find((c) => norm(c.name).startsWith(n)) ??
    pool.find((c) => norm(c.name).includes(n)) ??
    ctx.contacts.find((c) => norm(c.name).includes(n))
  );
};

const NUMBER_RE = /[a-z]{2,6}-\d{4}-\d{3,6}/i;

export function parseVerb(input: string, ctx: VerbContext): VerbMatch[] {
  const text = input.trim();
  if (text.length < 3) return [];
  const out: VerbMatch[] = [];
  const num = text.match(NUMBER_RE)?.[0];

  const isRecord = /^(record\s+payment|receive|receipt)\b/i.test(text);
  const isPay = /^pay\b/i.test(text);

  if ((isPay || isRecord) && num) {
    const bill = findByNumber(ctx.bills, num);
    const inv = findByNumber(ctx.invoices, num);
    if (bill && !isRecord) {
      out.push({
        id: 'verb-pay-bill',
        title: `Pay bill ${bill.number}`,
        hint: 'Open the bill ready to record the payment',
        entities: [{ kind: 'bill', label: bill.number ?? num }],
        action: { type: 'navigate', path: `/bills/${bill.id}?pay=1`, message: `Opened ${bill.number}` },
      });
    } else if (inv) {
      const contact = ctx.contacts.find((c) => c.id === inv.contact_id);
      const ents: VerbEntity[] = [{ kind: 'invoice', label: inv.number ?? num }];
      if (contact) ents.push({ kind: 'contact', label: contact.name });
      out.push({
        id: 'verb-record-payment',
        title: `Record payment for ${inv.number}`,
        hint: 'Open a receipt filled in with this customer and invoice',
        entities: ents,
        action: {
          type: 'navigate',
          path: `/receipts/new?invoice=${inv.id}&contact=${inv.contact_id}&amount=${amountDue(inv)}`,
          message: `Receipt form opened for ${inv.number}`,
        },
      });
    }
  }

  const approveMatch = text.match(/^approve\b\s*(.*)$/i);
  if (approveMatch) {
    const token = num ?? approveMatch[1].trim();
    const bill = token ? findByNumber(ctx.bills, token) : undefined;
    const inv = token ? findByNumber(ctx.invoices, token) : undefined;
    const jrn = token ? findByNumber(ctx.journals, token) : undefined;
    const doc = inv
      ? { kind: 'invoice' as const, path: `/invoices/${inv.id}`, number: inv.number }
      : bill
      ? { kind: 'bill' as const, path: `/bills/${bill.id}`, number: bill.number }
      : jrn
      ? { kind: 'journal' as const, path: `/journals/${jrn.id}`, number: jrn.number }
      : undefined;
    if (doc) {
      out.push({
        id: 'verb-approve',
        title: `Approve ${doc.number}`,
        hint: 'Open the document, then confirm with your PIN',
        entities: [{ kind: doc.kind, label: doc.number ?? token }],
        action: { type: 'navigate', path: doc.path },
      });
    } else {
      out.push({
        id: 'verb-approve-inbox',
        title: 'Review what is waiting for approval',
        hint: 'Open the approvals inbox',
        entities: [],
        action: { type: 'navigate', path: '/approvals' },
      });
    }
  }

  const reconcileMatch = text.match(/^reconcile\b\s*(.*)$/i);
  if (reconcileMatch) {
    const q = norm(reconcileMatch[1]);
    const bank = q
      ? ctx.bankAccounts.find((b) => norm(`${b.name} ${b.bank_name ?? ''}`).includes(q))
      : ctx.bankAccounts[0];
    if (bank) {
      out.push({
        id: 'verb-reconcile',
        title: `Reconcile ${bank.name}`,
        hint: 'Match statement lines with your books',
        entities: [{ kind: 'bank', label: bank.name }],
        action: { type: 'navigate', path: `/banking/${bank.id}/reconcile` },
      });
    }
  }

  const newMatch = text.match(/^(new|create|add)\s+(invoice|bill)(?:\s+(?:for|to|from)\s+(.+))?$/i);
  if (newMatch) {
    const isBill = newMatch[2].toLowerCase() === 'bill';
    const who = newMatch[3] ? findContact(ctx, newMatch[3], isBill ? 'supplier' : 'customer') : undefined;
    const ents: VerbEntity[] = who ? [{ kind: 'contact', label: who.name }] : [];
    out.push({
      id: 'verb-new-doc',
      title: who ? `New ${isBill ? 'bill from' : 'invoice for'} ${who.name}` : `New ${isBill ? 'supplier bill' : 'sales invoice'}`,
      hint: who ? 'Start a draft with the contact already chosen' : 'Start a blank draft',
      entities: ents,
      action: { type: 'navigate', path: `/${isBill ? 'bills' : 'invoices'}/new${who ? `?contact=${who.id}` : ''}` },
    });
  }

  if (/^run\s+recurring\b/i.test(text) || /^(generate|process)\s+recurring\b/i.test(text)) {
    out.push({
      id: 'verb-run-recurring',
      title: 'Run recurring invoices now',
      hint: 'Creates every invoice that is due; each one waits for approval',
      entities: [],
      action: { type: 'runRecurring' },
    });
  }

  return out;
}
