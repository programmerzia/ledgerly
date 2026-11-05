import React, { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { CheckCircle, Clock, Copy, FilePlus, Link2, Pencil, Receipt, RotateCcw, Send, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/domain/PageHeader';
import { SignDialog } from '@/components/domain/SignDialog';
import { AttachmentsPanel } from '@/components/live/AttachmentsPanel';
import { EmailButton, PdfButton, SendLog } from '@/components/live/DocumentActions';
import { InvoiceLinks } from '@/components/live/InvoiceLinks';
import { MoneyInput } from '@/components/domain/MoneyInput';
import { ConflictDialog, type VersionConflict } from '@/components/domain/ConflictDialog';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { BTN_SECONDARY, CARD } from '@/pages/Sales/invoice-view/shared';
import { cn } from '@/lib/utils';
import { formatDate, formatMoney } from '@/lib/format';
import { useRouteCompany } from '@/data/session';
import { useLedgerStore } from '@/mock/store';
import { useAccounts } from '@/data/accounts';
import { useContactDirectory } from '@/data/contacts';
import { useDoc, useDocActions, useDocPayments, useOpenDocs } from '@/data/invoices';
import { useTradeRefs } from '@/data/tradeRefs';
import { useMemberNames } from '@/data/approvals';
import { useBillMatch } from '@/data/procurement';
import { isSigningCancelled, useSignedRun } from '@/data/signing';
import { ApiError } from '@/api/errors';
import { IntentSlot } from '@/api/intentSlot';
import { rateForDisplay } from '@/api/adapters/money';
import { toCopyInput, toInvoiceRequest, type LiveDoc } from '@/api/adapters/invoice';
import { toApiDate } from '@/api/adapters/dates';
import { matchOverrideRefusal, matchLineFor, matchRefusal, type MatchRefusal } from '@/api/adapters/procurement';
import { describePurchaseViolation } from '@/api/tradeViolations';
import { BillMatchPanel, MatchRefusalNotice } from '@/pages/Purchases/live/MatchPanels';
import type { LiveDocPayment } from '@/api/adapters/settlement';
import { DocPayments, paymentTitle } from './DocPayments';
import { DocStatusPill, ErrorLine, LoadingLine, inputClass, tradeVerdictText } from './parts';
import { SIDES, isCreditKind, type Side } from './side';

type Pending = 'approve' | 'reverse' | 'submit' | 'apply' | 'undo';

export const InvoiceViewLive: React.FC<{ side?: Side }> = ({ side = 'sales' }) => {
  const S = SIDES[side];
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const company = useRouteCompany();
  const me = useLedgerStore((s) => s.currentUser);
  const coSlug = company.slug;
  const docQ = useDoc(id, S.resource);
  const accounts = useAccounts();
  const customers = useContactDirectory(S.contactKind, true);
  const refs = useTradeRefs();
  const names = useMemberNames();
  const actions = useDocActions(S.resource);
  const { run, signProps } = useSignedRun();

  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState<VersionConflict | null>(null);
  const [dialog, setDialog] = useState<null | 'return' | 'void' | 'reverse' | 'apply' | 'undo'>(null);
  const [undoTarget, setUndoTarget] = useState<LiveDocPayment | null>(null);
  const [text, setText] = useState('');
  const [reverseDate, setReverseDate] = useState('');
  const [applyTo, setApplyTo] = useState('');
  const [applyAmount, setApplyAmount] = useState(0);
  const [applyDate, setApplyDate] = useState('');
  const [problem, setProblem] = useState('');
  const [refusal, setRefusal] = useState<MatchRefusal | null>(null);
  const slots = useRef(new Map<string, IntentSlot>());
  const slotFor = (name: string) => {
    let s = slots.current.get(name);
    if (!s) slots.current.set(name, (s = new IntentSlot()));
    return s;
  };

  const doc = docQ.data;
  const open = useOpenDocs(doc?.status === 'posted' && isCreditKind(doc.kind) ? doc.contact_id : undefined, S.mainKind, S.resource);

  const payments = useDocPayments(id, S.resource, docQ.data?.status === 'posted' || docQ.data?.status === 'reversed');
  // Only a bill can be on an order. Everything else (sales documents, debit notes) never asks.
  const match = useBillMatch(id, side === 'purchases' && docQ.data?.kind === 'purchase_bill');

  if (docQ.isLoading || accounts.isLoading) return <LoadingLine what="document" />;
  if (docQ.error || !doc) {
    const notFound = docQ.error instanceof ApiError && docQ.error.status === 404;
    return notFound ? (
      <div className="rounded-lg border border-border bg-surface p-6 text-[13px] text-text-secondary">
        This document does not exist in this company.{' '}
        <button type="button" onClick={() => navigate(`/${coSlug}/${S.docsPath}`)} className="text-accent hover:underline">
          Back to {S.mains}
        </button>
      </div>
    ) : (
      <ErrorLine error={docQ.error} onRetry={docQ.refetch} />
    );
  }

  const isCredit = isCreditKind(doc.kind);
  const words = isCredit ? { one: S.credit, Title: S.Credit } : { one: S.main, Title: S.Main };
  const numberLabel = doc.number ?? (doc.status === 'draft' ? 'Draft' : 'No number yet');
  const customer = customers.byId.get(doc.contact_id);
  const makerName = names.get(doc.submitted_by ?? doc.created_by ?? '');
  const isMine = doc.created_by === me.id || doc.submitted_by === me.id;
  const base = doc.baseCurrency;
  const foreign = doc.currency !== base;
  const accountName = (aid: string) => {
    const a = accounts.data.find((x) => x.id === aid);
    return a ? `${a.code} ${a.name}` : '';
  };
  const taxCode = (tid: string | null) => refs.taxCodes.find((t) => t.id === tid)?.code ?? '';

  const onError = (e: unknown) => {
    if (isSigningCancelled(e)) return;
    if (e instanceof ApiError && e.isVersionConflict) {
      setDialog(null);
      setConflict({ noun: words.one, serverVersion: e.serverVersion, localVersion: doc.version, onClose: () => setConflict(null), onReload: () => { setConflict(null); docQ.refetch(); } });
      return;
    }
    const refused = side === 'purchases' ? matchRefusal(e) : null;
    if (refused) {
      setRefusal(refused);
      return;
    }
    const overrideRefused = matchOverrideRefusal(e);
    if (overrideRefused) {
      toast.error(describePurchaseViolation({ code: overrideRefused, message: '' }));
      return;
    }
    const msg = tradeVerdictText(e, side === 'purchases');
    if (dialog) setProblem(msg);
    else toast.error(msg);
  };

  /** One user action = one intent, kept until it succeeds, signed through the dialog if the server asks. */
  async function perform<T>(name: string, signature: string, sign: Pending | null, call: (intent: ReturnType<IntentSlot['for']>) => Promise<T>): Promise<T | undefined> {
    const slot = slotFor(name);
    const intent = slot.for(signature);
    setPending(sign);
    setBusy(true);
    setProblem('');
    try {
      const r = await run(() => call(intent));
      slot.clear();
      return r;
    } catch (e) {
      onError(e);
      return undefined;
    } finally {
      setBusy(false);
    }
  }

  const sig = `${doc.id}:${doc.version}`;
  const doSubmit = async (matchOverrideReason?: string) => {
    const r = await perform('submit', `${sig}:${matchOverrideReason ?? ''}`, 'submit', (intent) => actions.submit(doc.id, doc.version, intent, matchOverrideReason));
    if (r) {
      setRefusal(null);
      toast.success(r.status === 'posted' ? `Posted as ${r.number}` : 'Sent for approval');
    }
  };
  /** Same pattern as a journal's Duplicate: a draft made at once from the source, today's date, then the form opens on it. */
  const doCopy = async () => {
    const today = toApiDate(new Date());
    const body = toInvoiceRequest(toCopyInput(doc, today), base);
    const copy = await perform('copy', `${doc.id}:${today}`, null, (intent) => actions.create(body, intent));
    if (copy) {
      toast.success('Draft copy created. Check the date, prices and tax before you submit.');
      navigate(`/${coSlug}/${isCredit ? S.creditsPath : S.docsPath}/new?draft=${copy.id}`);
    }
  };
  const doApprove = async () => {
    const r = await perform('approve', sig, 'approve', (intent) => actions.approve(doc.id, doc.version, intent));
    if (r) toast.success(r.status === 'posted' ? `Approved and posted as ${r.number}` : 'Your approval is recorded. Another step is still to come.');
  };
  const doReturn = async () => {
    const comment = text.trim();
    if (!comment) return;
    const r = await perform('return', `${sig}:${comment}`, null, (intent) => actions.sendBack(doc.id, comment, doc.version, intent));
    if (r) {
      setDialog(null);
      setText('');
      toast.success('Sent back to the maker as a draft');
    }
  };
  const doVoid = async () => {
    const reason = text.trim();
    const r = await perform('void', `${sig}:${reason}`, null, (intent) => actions.voidDraft(doc.id, reason, doc.version, intent));
    if (r) {
      setDialog(null);
      setText('');
      toast.success('Draft discarded');
      navigate(`/${coSlug}/${S.docsPath}`);
    }
  };
  const doReverse = async () => {
    const memo = text.trim();
    if (!memo) return;
    const body = { memo, version: doc.version, ...(reverseDate ? { date: reverseDate } : {}) };
    const r = await perform('reverse', `${sig}:${memo}:${reverseDate}`, 'reverse', (intent) => actions.reverse(doc.id, body, intent));
    if (r) {
      setDialog(null);
      setText('');
      setReverseDate('');
      toast.success(`${words.Title} ${doc.number ?? ''} reversed.`);
    }
  };
  const doApply = async () => {
    if (!applyTo || applyAmount <= 0) return;
    const body = { invoice_id: applyTo, amount_fc: applyAmount, ...(applyDate ? { date: applyDate } : {}) };
    const r = await perform('apply', `${doc.id}:${applyTo}:${applyAmount}:${applyDate}`, 'apply', (intent) => actions.applyCredit(doc.id, body, intent));
    if (r) {
      setDialog(null);
      setApplyTo('');
      setApplyAmount(0);
      toast.success(`Credit applied to the ${S.main}`);
      docQ.refetch();
    }
  };

  const doUndo = async () => {
    if (!undoTarget) return;
    const r = await perform('undo', undoTarget.id, 'undo', (intent) => actions.undoCredit(undoTarget.id, intent));
    if (r) {
      setDialog(null);
      setUndoTarget(null);
      docQ.refetch();
      payments.refetch();
      toast.success(`Credit taken back. The ${S.main} owes that amount again.`);
    }
  };

  const can = doc.can;
  const pendingApproval = doc.status === 'pending_approval';
  const posted = doc.status === 'posted';
  const targetInvoice = open.docs.find((d) => d.id === applyTo);
  const sameCurrency = (d: LiveDoc | undefined) => Boolean(d) && d?.currency === base && doc.currency === base;
  const sign =
    pending === 'undo'
      ? { action: 'Undo credit', text: `This takes the credit back off the ${S.main}. What it covered is owed again, and any withholding certificate it issued is voided.` }
      : pending === 'apply'
      ? { action: 'Apply credit', text: side === 'sales' ? 'This puts the credit against the invoice you chose. The invoice owes that much less. Undo it later if it was a mistake.' : 'This puts the credit against the bill you chose. You owe that much less on it.' }
      : pending === 'reverse'
      ? { action: `Reverse ${words.one}`, text: `Reversing adds an equal and opposite entry and gives the ${S.main} back its open amounts.` }
      : pending === 'submit'
        ? { action: 'Sign and post', text: `Nobody else needs to approve this ${words.one} under your company rules, so it posts now with the next number.` }
        : { action: 'Approve and post', text: `Approving posts this ${words.one} to your books with the next number. Mistakes are fixed later with a reversal.` };

  return (
    <div className="flex flex-col gap-6 pb-20">
      <PageHeader
        breadcrumb={[{ label: isCredit ? S.Credits : S.Mains, to: `/${coSlug}/${S.docsPath}` }, { label: numberLabel }]}
        title={doc.number || (doc.status === 'draft' ? `Draft ${words.one}` : words.Title)}
        subtitle={customer?.name}
        meta={<DocStatusPill doc={doc} />}
        actions={
          <>
            <PdfButton family={side === 'sales' ? 'invoices' : 'bills'} id={doc.id} />
            {side === 'sales' && doc.can.send && (
              <EmailButton family="invoices" id={doc.id} disabled={doc.status !== 'posted'} why="Post it first, then send it." />
            )}
          </>
        }
      />

      {doc.status === 'reversed' && (
        <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-neutral px-4 py-3 text-[13px] font-medium text-text-secondary">
          This {words.one} was reversed.
          {doc.reversal_journal_id && (
            <Link className="underline" to={`/${coSlug}/journals/${doc.reversal_journal_id}`}>
              View the reversing entry
            </Link>
          )}
        </div>
      )}
      {doc.related_invoice_id && (
        <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-neutral px-4 py-3 text-[13px] font-medium text-text-secondary">
          <Link2 className="size-4" /> This {words.one} refers to another {S.main}.{' '}
          <Link className="underline" to={`/${coSlug}/${S.docsPath}/${doc.related_invoice_id}`}>
            View it
          </Link>
        </div>
      )}

      {refusal && <MatchRefusalNotice refusal={refusal} canOverride={doc.can.override_match} busy={busy} onSubmitAnyway={(reason) => void doSubmit(reason)} />}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <article aria-label={`${words.Title} ${doc.number ?? 'draft'}`} className="rounded-lg border border-border bg-surface px-6 py-8 sm:px-10 sm:py-10" data-testid="doc-paper">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div className="leading-tight">
              <div className="text-[15px] font-semibold text-text-primary">{company.name}</div>
              {company.legal_name && company.legal_name !== company.name && <div className="text-xs text-text-muted">{company.legal_name}</div>}
            </div>
            <div className="text-right">
              <h2 className="text-3xl font-semibold text-text-primary">{words.Title}</h2>
              <div className="mt-1 text-sm font-medium tabular-nums text-text-secondary">{numberLabel}</div>
            </div>
          </div>
          <div className="mt-8 grid gap-6 sm:grid-cols-2">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.04em] text-text-muted">{side === 'sales' ? 'Bill to' : 'From'}</div>
              <div className="mt-1 text-[13px] font-semibold text-text-primary">{customer?.name ?? '—'}</div>
              {customer?.billing_address.map((l, i) => (
                <div key={i} className="text-xs text-text-secondary">
                  {l}
                </div>
              ))}
              {customer?.email && <div className="text-xs text-text-secondary">{customer.email}</div>}
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:justify-self-end">
              <dt className="text-text-muted">Date</dt>
              <dd className="tabular-nums text-text-primary">{formatDate(doc.issue_date)}</dd>
              {!isCredit && (
                <>
                  <dt className="text-text-muted">Due</dt>
                  <dd className="tabular-nums text-text-primary">{doc.due_date ? formatDate(doc.due_date) : '—'}</dd>
                </>
              )}
              <dt className="text-text-muted">Currency</dt>
              <dd className="text-text-primary">{doc.currency}</dd>
              {foreign && (
                <>
                  <dt className="text-text-muted">Rate</dt>
                  <dd className="tabular-nums text-text-primary">{rateForDisplay(doc.fx_rate)}</dd>
                </>
              )}
              {doc.reference && (
                <>
                  <dt className="text-text-muted">Reference</dt>
                  <dd className="text-text-primary">{doc.reference}</dd>
                </>
              )}
            </dl>
          </div>

          <table className="mt-8 w-full text-left text-xs">
            <thead>
              <tr className="border-b border-border text-[10px] font-semibold uppercase tracking-[0.04em] text-text-muted">
                <th className="py-2 pr-2">Description</th>
                <th className="w-16 px-2 py-2 text-right">Qty</th>
                <th className="w-28 px-2 py-2 text-right">Unit price</th>
                <th className="w-16 px-2 py-2 text-right">Disc.</th>
                <th className="w-16 px-2 py-2">Tax</th>
                <th className="w-28 py-2 pl-2 text-right">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {doc.lines.map((l) => (
                <tr key={l.line_no}>
                  <td className="py-2 pr-2">
                    <div className="text-text-primary">{l.description || '—'}</div>
                    <div className="text-[11px] text-text-muted">{accountName(l.account_id)}</div>
                    {matchLineFor(match.data, l.line_no)?.order_number && (
                      <div className="text-[11px] text-text-muted">
                        On order{' '}
                        <Link className="font-medium text-accent hover:underline" to={`/${coSlug}/purchase-orders/${matchLineFor(match.data, l.line_no)?.purchase_order_id}`}>
                          {matchLineFor(match.data, l.line_no)?.order_number}
                        </Link>
                      </div>
                    )}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">{Number(l.quantity)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{formatMoney(l.unit_price_fc, doc.currency)}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-text-muted">{Number(l.discount_pct) ? `${Number(l.discount_pct)}%` : ''}</td>
                  <td className="px-2 py-2 text-text-muted">{taxCode(l.tax_code_id)}</td>
                  <td className="py-2 pl-2 text-right tabular-nums text-text-primary">{formatMoney(l.line_total_fc, doc.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <dl className="ml-auto mt-6 flex max-w-xs flex-col gap-1.5 text-[13px]" data-testid="doc-paper-totals">
            <div className="flex justify-between"><dt className="text-text-secondary">Subtotal</dt><dd className="tabular-nums">{formatMoney(doc.subtotal_fc, doc.currency)}</dd></div>
            <div className="flex justify-between"><dt className="text-text-secondary">Tax</dt><dd className="tabular-nums">{formatMoney(doc.tax_total_fc, doc.currency)}</dd></div>
            <div className="flex justify-between border-t border-border pt-1.5 text-sm font-semibold"><dt>Total</dt><dd className="tabular-nums">{formatMoney(doc.total_fc, doc.currency)}</dd></div>
            {doc.wht_code_id && (
              <div className="flex justify-between text-text-secondary"><dt>Withheld when paid ({refs.taxCodes.find((t) => t.id === doc.wht_code_id)?.code ?? 'WHT'})</dt><dd className="tabular-nums" data-testid="doc-wht">{formatMoney(doc.wht_amount_fc, doc.currency)}</dd></div>
            )}
            {foreign && <div className="flex justify-between text-xs text-text-muted"><dt>In {base}</dt><dd className="tabular-nums">{formatMoney(doc.total, base)}</dd></div>}
            {posted && (
              <>
                <div className="flex justify-between text-text-secondary"><dt>{isCredit ? 'Applied so far' : 'Paid so far'}</dt><dd className="tabular-nums">{formatMoney(doc.settled_fc, doc.currency)}</dd></div>
                <div className="flex justify-between font-semibold"><dt>{isCredit ? 'Credit left' : side === 'sales' ? 'Still owed' : 'Still to pay'}{foreign ? ` (${base})` : ''}</dt><dd className="tabular-nums" data-testid="doc-amount-due">{formatMoney(doc.amount_due, base)}</dd></div>
              </>
            )}
          </dl>
          {doc.memo && <p className="mt-6 text-xs text-text-secondary">{doc.memo}</p>}
        </article>

        <aside className="flex flex-col gap-4 lg:sticky lg:top-4 lg:self-start">
          <section className={cn(CARD, 'flex flex-col gap-4 p-5')} aria-label="Status and actions">
            <div>
              <div className="text-xs text-text-muted">Total</div>
              <div className="mt-1 text-[22px] font-medium tabular-nums text-text-primary">{formatMoney(doc.total_fc, doc.currency)}</div>
              <div className="mt-1 text-[13px] text-text-muted">{doc.lines.length} {doc.lines.length === 1 ? 'line' : 'lines'} · {posted ? 'in the books' : doc.status === 'reversed' ? 'cancelled by a reversal' : 'not in the books yet'}</div>
              {makerName && <div className="mt-1 text-xs text-text-muted">Prepared by {makerName}</div>}
            </div>

            {pendingApproval &&
              (can.approve ? (
                <div className="grid grid-cols-2 gap-2">
                  {can.return && (
                    <button type="button" onClick={() => { setProblem(''); setDialog('return'); }} disabled={busy} className={cn(BTN_SECONDARY, 'hover:border-danger/50 hover:text-danger')}>
                      <RotateCcw className="size-4" /> Return
                    </button>
                  )}
                  <button type="button" onClick={() => void doApprove()} disabled={busy} className="flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-md bg-success px-3 text-[13px] font-medium text-white transition hover:opacity-90 disabled:opacity-50">
                    <CheckCircle className="size-4" /> Approve
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2 rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-[13px] font-medium text-warning">
                  <Clock className="size-4 shrink-0" />
                  {isMine ? 'Waiting for someone else to approve' : 'Waiting for approval'}
                </div>
              ))}

            {doc.status === 'draft' && (
              <div className="flex flex-col gap-2">
                {can.submit && (
                  <button type="button" onClick={() => void doSubmit()} disabled={busy} className="flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-md bg-accent px-3 text-[13px] font-medium text-white transition hover:bg-accent-hover disabled:opacity-50">
                    <Send className="size-4" /> Submit
                  </button>
                )}
                <div className="grid grid-cols-2 gap-2">
                  {can.update && (
                    <button type="button" onClick={() => navigate(`/${coSlug}/${S.docsPath}/new?draft=${doc.id}`)} className={BTN_SECONDARY}>
                      <Pencil className="size-4 text-text-muted" /> Edit draft
                    </button>
                  )}
                  {can.void && (
                    <button type="button" onClick={() => { setProblem(''); setDialog('void'); }} className={cn(BTN_SECONDARY, 'hover:border-danger/50 hover:text-danger')}>
                      <Trash2 className="size-4" /> Discard
                    </button>
                  )}
                </div>
              </div>
            )}

            {posted && (
              <div className="flex flex-col gap-2">
                {!isCredit && doc.amount_due > 0 && (
                  <button type="button" onClick={() => navigate(`/${coSlug}/${S.settlementPath}/new?contactId=${doc.contact_id}&invoiceId=${doc.id}`)} className="flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-md bg-accent px-3 text-[13px] font-medium text-white transition hover:bg-accent-hover">
                    <Receipt className="size-4" /> Record {S.settlement}
                  </button>
                )}
                {isCredit && doc.amount_due > 0 && (
                  <button type="button" onClick={() => { setProblem(''); setApplyTo(''); setApplyAmount(0); setDialog('apply'); }} className="flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-md bg-accent px-3 text-[13px] font-medium text-white transition hover:bg-accent-hover">
                    <FilePlus className="size-4" /> Apply to {side === 'sales' ? 'an invoice' : 'a bill'}
                  </button>
                )}
                <div className="grid grid-cols-2 gap-2">
                  {!isCredit && (
                    <button type="button" onClick={() => navigate(`/${coSlug}/${S.creditsPath}/new?invoice=${doc.id}`)} className={BTN_SECONDARY}>
                      <FilePlus className="size-4 text-text-muted" /> {S.Credit}
                    </button>
                  )}
                  {can.reverse && (
                    <button type="button" onClick={() => { setProblem(''); setDialog('reverse'); }} className={cn(BTN_SECONDARY, 'border-danger/40 text-danger hover:border-danger/60 hover:bg-danger-soft')}>
                      <RotateCcw className="size-4" /> Reverse
                    </button>
                  )}
                </div>
              </div>
            )}

            <button type="button" onClick={() => void doCopy()} disabled={busy} className={BTN_SECONDARY}>
              <Copy className="size-4 text-text-muted" /> Copy to a new draft
            </button>

            {doc.journal_id && (
              <Link to={`/${coSlug}/journals/${doc.journal_id}`} className="text-xs text-accent hover:underline">
                View the journal entry
              </Link>
            )}
          </section>
        </aside>
      </div>

      {match.data && <BillMatchPanel match={match.data} doc={doc} co={coSlug} />}

      <DocPayments
        rows={payments.data}
        isLoading={payments.isLoading}
        error={payments.error}
        onRetry={payments.refetch}
        slug={coSlug}
        settlementPath={S.settlementPath}
        side={side}
        busy={busy}
        onUndo={(p) => { setProblem(''); setUndoTarget(p); setDialog('undo'); }}
      />

      {side === 'sales' && !isCredit && <InvoiceLinks invoiceId={doc.id} posted={doc.status === 'posted'} canShare={doc.can.share} />}
      {side === 'sales' && <SendLog family="invoices" id={doc.id} />}

      <AttachmentsPanel type={side === 'sales' ? 'invoice' : 'bill'} parentId={doc.id} posted={doc.status === 'posted' || doc.status === 'reversed'} />

      <Dialog open={dialog === 'return'} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent className="max-w-md rounded-lg border border-border bg-surface-elevated p-6 shadow-popover">
          <DialogHeader><DialogTitle className="text-base font-semibold text-text-primary">Send back for changes</DialogTitle></DialogHeader>
          <label htmlFor="iv-return" className="text-xs font-semibold text-text-primary">Why are you sending it back?</label>
          <textarea id="iv-return" autoFocus rows={3} value={text} onChange={(e) => setText(e.target.value)} className="w-full rounded-lg border border-border bg-surface p-2 text-xs text-text-primary focus:outline-none focus:ring-1 focus:ring-accent" />
          {problem && <p role="alert" className="text-xs text-danger">{problem}</p>}
          <DialogFooter className="mt-2 flex justify-end gap-2">
            <button type="button" onClick={() => setDialog(null)} className="h-9 rounded-md border border-border bg-surface px-3 text-xs hover:bg-surface-neutral">Cancel</button>
            <button type="button" onClick={() => void doReturn()} disabled={!text.trim() || busy} className="h-9 rounded-md bg-warning px-3 text-xs font-semibold text-white disabled:opacity-50">Send back</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === 'void'} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent className="max-w-md rounded-lg border border-border bg-surface-elevated p-6 shadow-popover">
          <DialogHeader><DialogTitle className="text-base font-semibold text-text-primary">Discard this draft</DialogTitle></DialogHeader>
          <p className="text-xs text-text-secondary">A discarded draft is marked void and kept for the record. It never reaches the books.</p>
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Reason (optional)" aria-label="Reason" className={cn(inputClass, 'w-full')} />
          {problem && <p role="alert" className="text-xs text-danger">{problem}</p>}
          <DialogFooter className="mt-2 flex justify-end gap-2">
            <button type="button" onClick={() => setDialog(null)} className="h-9 rounded-md border border-border bg-surface px-3 text-xs hover:bg-surface-neutral">Keep it</button>
            <button type="button" onClick={() => void doVoid()} disabled={busy} className="h-9 rounded-md bg-danger px-3 text-xs font-semibold text-white disabled:opacity-50">Discard draft</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === 'reverse'} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent className="max-w-lg rounded-lg border border-border bg-surface-elevated p-6 shadow-popover">
          <DialogHeader><DialogTitle className="text-base font-semibold text-text-primary">Reverse {doc.number}</DialogTitle></DialogHeader>
          <div className="mt-2 flex flex-col gap-3 text-xs text-text-secondary">
            <div className="rounded-md border border-danger/30 bg-danger-soft p-3 text-danger">
              <p className="font-semibold">A posted {words.one} cannot be edited</p>
              <p className="mt-1 text-[11px]">We add an equal and opposite entry that cancels this one. Both stay visible in your records. If money has been applied to it, that has to be undone first.</p>
            </div>
            <label className="flex flex-col gap-1 font-semibold text-text-primary">
              <span>Why are you reversing it? <span className="text-danger">*</span></span>
              <input value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. entered against the wrong {S.contact}" className={cn(inputClass, 'w-full font-normal')} />
            </label>
            <label className="flex flex-col gap-1 font-semibold text-text-primary">
              Reversal date (optional)
              <input type="date" value={reverseDate} onChange={(e) => setReverseDate(e.target.value)} className={cn(inputClass, 'w-44 font-normal')} />
              <span className="text-[11px] font-normal text-text-muted">Left empty, the server picks the date.</span>
            </label>
            <p className="text-[11px] text-text-muted">You may be asked for your signing PIN.</p>
            {problem && <p role="alert" className="text-xs font-medium text-danger">{problem}</p>}
          </div>
          <DialogFooter className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={() => setDialog(null)} className="h-8 rounded-md border border-border bg-surface px-3 text-[13px] font-medium hover:bg-surface-neutral">Cancel</button>
            <button type="button" disabled={!text.trim() || busy} onClick={() => void doReverse()} className="h-8 rounded-md bg-danger px-3 text-[13px] font-medium text-white hover:bg-danger/90 disabled:opacity-50">Reverse {words.one}</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === 'undo'} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent className="max-w-md rounded-lg border border-border bg-surface-elevated p-6 shadow-popover">
          <DialogHeader><DialogTitle className="text-base font-semibold text-text-primary">Undo this credit</DialogTitle></DialogHeader>
          <p className="text-xs text-text-secondary">
            {undoTarget ? `${paymentTitle(undoTarget)}, ${formatMoney(undoTarget.amount_fc, undoTarget.currency)}. ` : ''}
            The credit goes back to the note and this {S.main} owes that amount again. You may be asked for your signing PIN.
          </p>
          {problem && <p role="alert" className="text-xs text-danger">{problem}</p>}
          <DialogFooter className="mt-2 flex justify-end gap-2">
            <button type="button" onClick={() => setDialog(null)} className="h-9 rounded-md border border-border bg-surface px-3 text-xs hover:bg-surface-neutral">Keep it</button>
            <button type="button" onClick={() => void doUndo()} disabled={busy} className="h-9 rounded-md bg-danger px-3 text-xs font-semibold text-white disabled:opacity-50">Undo credit</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === 'apply'} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent className="max-w-lg rounded-lg border border-border bg-surface-elevated p-6 shadow-popover">
          <DialogHeader><DialogTitle className="text-base font-semibold text-text-primary">Apply {doc.number} to {side === 'sales' ? 'an invoice' : 'a bill'}</DialogTitle></DialogHeader>
          <div className="flex flex-col gap-3 text-xs text-text-secondary">
            <p>Credit left on this note: <span className="font-semibold tabular-nums text-text-primary">{formatMoney(doc.amount_due, base)}</span></p>
            {open.isLoading ? (
              <p>Loading this {S.contact}’s open {S.mains}…</p>
            ) : open.docs.length === 0 ? (
              <p>This {S.contact} has no open {S.mains} to apply it to.</p>
            ) : (
              <>
                <label className="flex flex-col gap-1 font-semibold text-text-primary">
                  {S.Main}
                  <select value={applyTo} onChange={(e) => { setApplyTo(e.target.value); setApplyAmount(0); }} className={cn(inputClass, 'w-full font-normal')} aria-label={`${S.Main} to apply to`}>
                    <option value="">Choose {side === 'sales' ? 'an invoice' : 'a bill'}</option>
                    {open.docs.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.number} · owed {formatMoney(d.amount_due, d.baseCurrency)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 font-semibold text-text-primary">
                  Amount ({doc.currency})
                  <MoneyInput value={applyAmount} onChange={setApplyAmount} currency={doc.currency} allowNegative={false} size="sm" />
                </label>
                {sameCurrency(targetInvoice) && targetInvoice && (
                  <div className="flex gap-2">
                    <button type="button" onClick={() => setApplyAmount(doc.amount_due)} className="rounded border border-border px-2 py-1 text-[11px] hover:bg-surface-neutral">Use the credit left</button>
                    <button type="button" onClick={() => setApplyAmount(targetInvoice.amount_due)} className="rounded border border-border px-2 py-1 text-[11px] hover:bg-surface-neutral">{side === 'sales' ? 'Use what the invoice owes' : 'Use what is still to pay'}</button>
                  </div>
                )}
                <label className="flex flex-col gap-1 font-semibold text-text-primary">
                  Date (optional)
                  <input type="date" value={applyDate} onChange={(e) => setApplyDate(e.target.value)} className={cn(inputClass, 'w-44 font-normal')} />
                </label>
              </>
            )}
            {problem && <p role="alert" className="text-xs font-medium text-danger">{problem}</p>}
          </div>
          <DialogFooter className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={() => setDialog(null)} className="h-8 rounded-md border border-border bg-surface px-3 text-[13px] font-medium hover:bg-surface-neutral">Cancel</button>
            <button type="button" disabled={!applyTo || applyAmount <= 0 || busy} onClick={() => void doApply()} className="h-8 rounded-md bg-accent px-3 text-[13px] font-medium text-white hover:bg-accent-hover disabled:opacity-50">Apply credit</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <SignDialog
        {...signProps}
        documentTitle={`${words.Title}: ${doc.number || 'Draft'}`}
        documentNumber={doc.number || 'Draft'}
        amount={doc.total}
        currency={base}
        makerName={makerName}
        actionTitle={sign.action}
        consequenceText={sign.text}
      />
      <ConflictDialog conflict={conflict} />
    </div>
  );
};
