import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { AlertCircle, CheckCircle2, Circle, FilePlus, XCircle } from 'lucide-react';
import { AccountPicker } from '@/components/domain/AccountPicker';
import { formatMoney } from '@/lib/format';
import { createIntent } from '@/api/idempotency';
import { toInvoiceRequest, type DocLineInput } from '@/api/adapters/invoice';
import { toSettlementRequest } from '@/api/adapters/settlement';
import { bankingErrorText, type LiveBankAccount, type LiveBankLine } from '@/api/adapters/banking';
import { describeError } from '@/api/messages';
import { useRouteCompany } from '@/data/session';
import { useContactDirectory } from '@/data/contacts';
import { useDocActions } from '@/data/invoices';
import { useSettlementActions } from '@/data/settlements';
import { useBankingActions, useChartAccounts } from '@/data/banking';
import { isSigningCancelled } from '@/data/signing';
import { tradeVerdictText } from '@/pages/Sales/live/parts';
import { Field, SimpleSelect, codableAccounts, inputCls } from '../reconcile/shared';

type StepState = 'todo' | 'doing' | 'done' | 'stopped';
interface Step {
  key: string;
  label: string;
  state: StepState;
  note?: string;
}

interface Props {
  line: LiveBankLine;
  bank: LiveBankAccount;
  /** `useSignedRun().run`: the only signing path. */
  run: <T>(fn: () => Promise<T>) => Promise<T>;
  onMatched: () => void;
}

/**
 * Money out becomes a supplier bill and its payment; money in becomes an invoice and its receipt (plan 3c.35). The bill
 * or invoice is made from the line (one line for the whole amount, dated the bank date, no tax), then submitted, then
 * paid from this bank account with a payment or receipt dated the bank date, then that payment is matched to this line.
 * Every step is the existing action with its own server verdict; nothing here bypasses a rule. If a step is refused, or
 * waits for an approver, the steps stop there and say what exists, and nothing is undone behind the person's back.
 */
export const CreateDocFromLine: React.FC<Props> = ({ line, bank, run, onMatched }) => {
  const company = useRouteCompany();
  const out = line.amount < 0;
  const kind = out ? 'supplier' : 'customer';
  const noun = out ? 'bill' : 'invoice';
  const payNoun = out ? 'payment' : 'receipt';
  const amount = Math.abs(line.amount);
  const contacts = useContactDirectory(kind);
  const chart = useChartAccounts();
  const docs = useDocActions(out ? 'bills' : 'invoices');
  const settlements = useSettlementActions();
  const banking = useBankingActions();

  const [contactId, setContactId] = useState<string | undefined>();
  const [accountId, setAccountId] = useState('');
  const [description, setDescription] = useState(line.counterparty ? `${line.counterparty}` : line.description);
  const [reference, setReference] = useState('');
  const [steps, setSteps] = useState<Step[] | null>(null);
  const [error, setError] = useState('');
  const [links, setLinks] = useState<{ docId?: string; settlementId?: string }>({});
  const [busy, setBusy] = useState(false);

  // Expense accounts for a bill, income accounts for an invoice; the server still decides what may be posted.
  const options = useMemo(() => codableAccounts(chart.data).filter((a) => (out ? a.account_type === 'expense' || a.account_type === 'asset' : a.account_type === 'income')), [chart.data, out]);

  const setStep = (list: Step[], key: string, state: StepState, note?: string): Step[] => list.map((s) => (s.key === key ? { ...s, state, note } : s));

  const go = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!contactId) return setError(`Choose the ${kind}.`);
    if (!accountId) return setError(`Choose the account the ${noun} is for.`);
    let list: Step[] = [
      { key: 'draft', label: `Draft the ${noun}`, state: 'doing' },
      { key: 'post', label: `Post the ${noun}`, state: 'todo' },
      { key: 'pay', label: `Record the ${payNoun}`, state: 'todo' },
      { key: 'postpay', label: `Post the ${payNoun}`, state: 'todo' },
      { key: 'match', label: 'Match it to this bank line', state: 'todo' },
    ];
    setSteps(list);
    setBusy(true);
    const update = (key: string, state: StepState, note?: string) => {
      list = setStep(list, key, state, note);
      setSteps(list);
    };
    const stop = (key: string, note: string) => {
      update(key, 'stopped', note);
    };
    try {
      // 1. the document
      const lineInput: DocLineInput = { account_id: accountId, description: description.trim(), quantity: '1', unit_price_fc: amount, discount_pct: '' };
      const docBody = toInvoiceRequest(
        { kind: out ? 'purchase_bill' : 'sales_invoice', contact_id: contactId, issue_date: line.date, due_date: '', currency: line.currency, fx_rate: '', reference, memo: line.description, lines: [lineInput] },
        company.base_currency,
      );
      let doc = await run(() => docs.create(docBody, createIntent()));
      setLinks({ docId: doc.id });
      if (doc.total_fc !== amount) return stop('draft', `The ${noun} came to ${formatMoney(doc.total_fc, doc.currency)}, not ${formatMoney(amount, line.currency)}. It is saved as a draft for you to check.`);
      update('draft', 'done', doc.number ?? 'Draft');

      // 2. post it (or hand it to an approver)
      update('post', 'doing');
      doc = await run(() => docs.submit(doc.id, doc.version, createIntent()));
      if (doc.status !== 'posted') return stop('post', `The ${noun} is waiting for approval. Once it is approved, record its ${payNoun} and match it here.`);
      update('post', 'done', doc.number ?? '');

      // 3. the payment or receipt, from this bank account, dated the bank date, for the whole amount
      update('pay', 'doing');
      const settleBody = toSettlementRequest(
        {
          kind: out ? 'payment' : 'receipt',
          contact_id: contactId,
          cash_account_id: bank.account_id,
          bank_account_id: bank.id,
          settlement_date: line.date,
          amount_fc: amount,
          currency: line.currency,
          fx_rate: '',
          reference: line.reference,
          memo: line.description,
          allocations: [{ invoice_id: doc.id, amount_fc: amount }],
        },
        company.base_currency,
      );
      let pay = await run(() => settlements.create(settleBody, createIntent()));
      setLinks({ docId: doc.id, settlementId: pay.id });
      update('pay', 'done');

      // 4. post it
      update('postpay', 'doing');
      pay = await run(() => settlements.submit(pay.id, pay.version, createIntent()));
      if (pay.status !== 'posted') return stop('postpay', `The ${payNoun} is waiting for approval. When it is approved, match it to this line from the list on the left.`);
      update('postpay', 'done', pay.number ?? '');

      // 5. the match: the server checks the payment and the line add up exactly
      update('match', 'doing');
      await run(() => banking.match({ statement_line_ids: [line.id], settlement_ids: [pay.id] }, createIntent()));
      update('match', 'done');
      toast.success(`${out ? 'Bill' : 'Invoice'} ${doc.number ?? ''} posted, ${payNoun} ${pay.number ?? ''} posted and matched to this line.`);
      onMatched();
    } catch (err) {
      if (isSigningCancelled(err)) {
        const at = list.find((s) => s.state === 'doing');
        if (at) update(at.key, 'stopped', 'Signing was cancelled, so this step did not run.');
      } else {
        const at = list.find((s) => s.state === 'doing');
        const text = bankingErrorText(err, (x) => (at && (at.key === 'draft' || at.key === 'post') ? tradeVerdictText(x, out) : describeError(x)));
        if (at) update(at.key, 'stopped', text);
        else setError(text);
      }
    } finally {
      setBusy(false);
    }
  };

  const stopped = steps?.find((s) => s.state === 'stopped');
  const finished = steps?.every((s) => s.state === 'done') ?? false;

  return (
    <form onSubmit={(e) => void go(e)} className="flex flex-col gap-3 px-4 py-4" data-testid="create-doc-form">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] font-medium text-text-primary">
          {out ? 'Enter the bill this line pays' : 'Raise the invoice this line settles'}
        </span>
        <span className="text-xs tabular-nums text-text-muted">{formatMoney(amount, line.currency)}</span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label={out ? 'Supplier' : 'Customer'}>
          <SimpleSelect aria-label={out ? 'Supplier' : 'Customer'} allowNone={false} value={contactId} onChange={setContactId} placeholder="Choose..." options={contacts.contacts.map((c) => ({ value: c.id, label: c.name }))} />
        </Field>
        <Field label={out ? 'Supplier invoice number (optional)' : 'Reference (optional)'}>
          <input className={inputCls} value={reference} onChange={(e) => setReference(e.target.value)} aria-label="Reference" />
        </Field>
        <Field label={out ? 'Expense account' : 'Income account'} className="col-span-2">
          <AccountPicker accounts={options} value={accountId} onChange={setAccountId} placeholder="Choose an account..." />
        </Field>
        <Field label="Description" className="col-span-2">
          <input className={inputCls} value={description} onChange={(e) => setDescription(e.target.value)} aria-label="Description" />
        </Field>
      </div>
      <p className="text-[11px] text-text-muted">
        One line for the whole {formatMoney(amount, line.currency)}, dated {line.date}, with no tax. If tax applies, make the {noun} from the {out ? 'Bills' : 'Invoices'} screen and match its {payNoun} here. You will be asked for your signing PIN.
      </p>

      {steps && (
        <ol className="flex flex-col gap-1.5 rounded-md border border-border bg-surface-neutral/50 p-3 text-xs" data-testid="create-doc-steps">
          {steps.map((s) => (
            <li key={s.key} className="flex items-start gap-2" data-step={s.key} data-state={s.state}>
              {s.state === 'done' ? <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-success" /> : s.state === 'stopped' ? <XCircle className="mt-0.5 size-3.5 shrink-0 text-warning" /> : <Circle className="mt-0.5 size-3.5 shrink-0 text-text-muted" />}
              <span className={s.state === 'stopped' ? 'text-warning' : 'text-text-primary'}>
                {s.label}
                {s.note && <span className="text-text-muted"> · {s.note}</span>}
              </span>
            </li>
          ))}
        </ol>
      )}
      {stopped && (links.docId || links.settlementId) && (
        <p className="text-xs text-text-secondary">
          What exists so far:{' '}
          {links.docId && (
            <Link to={`/${company.slug}/${out ? 'bills' : 'invoices'}/${links.docId}`} className="text-accent hover:underline">
              the {noun}
            </Link>
          )}
          {links.docId && links.settlementId && ' and '}
          {links.settlementId && (
            <Link to={`/${company.slug}/${out ? 'payments' : 'receipts'}/${links.settlementId}`} className="text-accent hover:underline">
              the {payNoun}
            </Link>
          )}
          .
        </p>
      )}
      {error && (
        <div role="alert" className="flex items-start gap-2 rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">
          <AlertCircle className="mt-0.5 size-3.5 shrink-0" /> {error}
        </div>
      )}
      {!finished && !stopped && (
        <div className="flex justify-end">
          <button type="submit" disabled={busy || !bank.can.reconcile} className="flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-[13px] font-medium text-white transition hover:bg-accent-hover disabled:opacity-60">
            <FilePlus className="size-4" />
            {busy ? 'Working…' : out ? 'Create bill, pay it and match' : 'Create invoice, receive it and match'}
          </button>
        </div>
      )}
    </form>
  );
};
