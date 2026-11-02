import React, { useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { AlertCircle, ArrowRight, CheckCircle2, Pencil, Plus, Upload } from 'lucide-react';
import { PageHeader } from '@/components/domain/PageHeader';
import { EmptyState } from '@/components/domain/EmptyState';
import { StatusPill } from '@/components/domain/StatusPill';
import { Avatar } from '@/components/ui/avatar';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { ConflictDialog, type VersionConflict } from '@/components/domain/ConflictDialog';
import { formatDate, formatDateTime, formatMoney } from '@/lib/format';
import { useRouteCompany } from '@/data/session';
import { useBankAccounts, useBankingActions, useRecentLines, useReconciliations, useStatements, useChartAccounts } from '@/data/banking';
import { IntentSlot } from '@/api/intentSlot';
import { ApiError } from '@/api/errors';
import { describeError, fieldError } from '@/api/messages';
import {
  bankingErrorText,
  blankAccountForm,
  describeImportWarning,
  lineTitle,
  toBankAccountForm,
  toBankAccountRequest,
  type BankAccountForm,
  type LiveBankAccount,
} from '@/api/adapters/banking';
import { ErrorLine, LoadingLine } from '@/pages/Accounting/live/parts';
import { Field, SimpleSelect, inputCls } from '../reconcile/shared';

const KINDS = [
  { value: 'bank', label: 'Bank account' },
  { value: 'cash', label: 'Cash' },
  { value: 'card', label: 'Card' },
];

const buttonSecondary =
  'flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[13px] font-medium text-text-secondary transition-colors hover:bg-surface-neutral hover:text-text-primary';
const buttonPrimary = 'flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-[13px] font-medium text-white transition hover:bg-accent-hover disabled:opacity-50';

/** The live bank accounts page. Balances, the statement balance and the unreconciled count are the server's figures. */
export const BankAccountsLive: React.FC = () => {
  const navigate = useNavigate();
  const company = useRouteCompany();
  const banks = useBankAccounts();
  const [editing, setEditing] = useState<LiveBankAccount | 'new' | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const opened = banks.data.find((b) => b.id === openId) ?? null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Bank & cash accounts"
        subtitle={`${company.name} · balances, statements and reconciliation`}
        actions={
          <>
            <Link to={`/${company.slug}/banking/rules`} className={buttonSecondary}>
              Rules
            </Link>
            <Link to={`/${company.slug}/banking/import`} className={buttonSecondary}>
              <Upload className="size-4 text-text-muted" />
              Import statement
            </Link>
            <button type="button" onClick={() => setEditing('new')} className={buttonPrimary}>
              <Plus className="size-4" />
              Add account
            </button>
          </>
        }
      />

      {banks.isLoading ? (
        <LoadingLine what="bank accounts" />
      ) : banks.error ? (
        <ErrorLine error={banks.error} onRetry={banks.refetch} />
      ) : banks.data.length === 0 ? (
        <EmptyState
          title="No bank or cash accounts yet"
          description="Add the accounts you hold, then import a statement to start reconciling."
          actionLabel="Add account"
          onAction={() => setEditing('new')}
        />
      ) : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          {banks.data.map((b) => (
            <AccountCard key={b.id} bank={b} onOpen={() => setOpenId(b.id)} onEdit={() => setEditing(b)} onReconcile={() => navigate(`/${company.slug}/banking/${b.id}/reconcile`)} />
          ))}
        </div>
      )}

      <AccountSheet bank={opened} onClose={() => setOpenId(null)} />
      <AccountDialog target={editing} onClose={() => setEditing(null)} />
    </div>
  );
};

const AccountCard: React.FC<{ bank: LiveBankAccount; onOpen: () => void; onEdit: () => void; onReconcile: () => void }> = ({ bank, onOpen, onEdit, onReconcile }) => {
  const open = bank.unreconciled_count ?? 0;
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onOpen();
        }
      }}
      className="group flex cursor-pointer flex-col gap-5 rounded-lg border border-border bg-surface p-5 transition-colors hover:border-border-strong focus-visible:outline-2 focus-visible:outline-accent"
      data-testid={`bank-card-${bank.name}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar name={bank.bank_name || bank.name} size="lg" square />
          <div className="min-w-0">
            <h3 className="truncate text-[15px] font-semibold text-text-primary">{bank.name}</h3>
            <div className="text-xs text-text-muted">
              {bank.bank_name}
              {bank.bank_name && bank.account_number_masked ? <span className="mx-0.5">·</span> : null}
              <span className="font-mono tracking-wide">{bank.account_number_masked}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {!bank.is_active && <span className="rounded-[3px] bg-surface-neutral px-2 py-0.5 text-[11px] font-medium text-text-muted">Switched off</span>}
          <span className="rounded-[3px] border border-border bg-surface-neutral px-2 py-0.5 text-[11px] font-semibold text-text-secondary">{bank.currency}</span>
        </div>
      </div>

      <div>
        <div className="text-xs text-text-muted">Balance in your books</div>
        <div className="mt-0.5 text-[22px] leading-7 font-medium tabular-nums text-text-primary">{bank.book_balance === null ? '—' : formatMoney(bank.book_balance, bank.currency)}</div>
      </div>

      <div className="flex items-center justify-between rounded-lg bg-surface-neutral/70 px-3 py-2 text-xs">
        <div>
          <span className="text-text-muted">Last statement </span>
          <span className="font-medium tabular-nums text-text-primary">{bank.last_statement_balance === null ? 'none imported' : formatMoney(bank.last_statement_balance, bank.currency)}</span>
        </div>
        {bank.last_statement_date && <span className="text-text-muted tabular-nums">to {formatDate(bank.last_statement_date)}</span>}
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-border pt-3">
        {bank.last_statement_date === null && open === 0 ? (
          <span className="text-xs text-text-muted">No statement imported yet</span>
        ) : open > 0 ? (
          <span className="flex items-center gap-1 text-xs font-medium text-warning">
            <AlertCircle className="size-3.5" /> {open} {open === 1 ? 'line' : 'lines'} to match
          </span>
        ) : (
          <span className="flex items-center gap-1 text-xs font-medium text-success">
            <CheckCircle2 className="size-3.5" /> Nothing to match
          </span>
        )}
        <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
          {bank.can.update && (
            <button type="button" onClick={onEdit} aria-label={`Edit ${bank.name}`} className="flex size-8 items-center justify-center rounded-md border border-border text-text-muted hover:bg-surface-neutral hover:text-text-primary">
              <Pencil className="size-3.5" />
            </button>
          )}
          {bank.can.reconcile && (
            <button
              type="button"
              onClick={onReconcile}
              className={
                open > 0
                  ? 'flex h-8 items-center gap-1.5 rounded-lg bg-accent px-3 text-xs font-semibold text-white transition hover:bg-accent-hover'
                  : 'flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-xs font-semibold text-text-primary transition hover:bg-surface-neutral'
              }
            >
              Reconcile
              <ArrowRight className="size-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

/** Statements, reconciliations and latest lines for one account, all read from the server. */
const AccountSheet: React.FC<{ bank: LiveBankAccount | null; onClose: () => void }> = ({ bank, onClose }) => {
  const company = useRouteCompany();
  const statements = useStatements(bank?.id);
  const recs = useReconciliations(bank?.id);
  const lines = useRecentLines(bank?.id, Boolean(bank));
  return (
    <Sheet open={Boolean(bank)} onOpenChange={(o) => !o && onClose()}>
      {bank && (
        <SheetContent className="flex w-full flex-col gap-5 overflow-y-auto sm:max-w-xl">
          <SheetHeader className="border-b border-border pb-4">
            <SheetTitle className="text-base font-semibold text-text-primary">{bank.name}</SheetTitle>
            <SheetDescription className="text-xs text-text-muted">
              {[bank.bank_name, bank.account_number_masked, bank.iban].filter(Boolean).join(' · ') || bank.currency}
            </SheetDescription>
          </SheetHeader>

          <section className="flex flex-col gap-2">
            <h3 className="text-xs font-semibold text-text-primary">Statements</h3>
            {statements.isLoading ? (
              <LoadingLine what="statements" />
            ) : statements.error ? (
              <ErrorLine error={statements.error} onRetry={statements.refetch} />
            ) : statements.data.length === 0 ? (
              <p className="text-xs text-text-muted">Nothing imported yet.</p>
            ) : (
              <ul className="divide-y divide-border rounded-md border border-border text-xs">
                {statements.data.map((s) => (
                  <li key={s.id} className="flex flex-col gap-0.5 px-3 py-2">
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-medium text-text-primary">
                        {formatDate(s.period_from)} to {formatDate(s.period_to)}
                      </span>
                      <span className="tabular-nums text-text-secondary">{s.closing_balance === null ? 'no closing balance' : `closing ${formatMoney(s.closing_balance, bank.currency)}`}</span>
                    </div>
                    <div className="text-text-muted">
                      {s.file_name || s.source} · {s.line_count} {s.line_count === 1 ? 'line' : 'lines'}
                      {s.imported_at ? ` · imported ${formatDateTime(s.imported_at)}` : ''}
                    </div>
                    {s.warnings.map((w) => (
                      <div key={w} className="text-warning">
                        {describeImportWarning(w)}
                      </div>
                    ))}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="flex flex-col gap-2">
            <h3 className="text-xs font-semibold text-text-primary">Reconciliations</h3>
            {recs.error ? (
              <ErrorLine error={recs.error} onRetry={recs.refetch} />
            ) : recs.data.length === 0 ? (
              <p className="text-xs text-text-muted">None started.</p>
            ) : (
              <ul className="divide-y divide-border rounded-md border border-border text-xs">
                {recs.data.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-3 px-3 py-2">
                    <span className="text-text-primary">As of {formatDate(r.as_of)}</span>
                    <span className="flex items-center gap-2 text-text-muted">
                      {r.status === 'finished' ? `finished ${formatDate(r.finished_at)}` : 'in progress'}
                      {r.reopen_count > 0 && <span>reopened {r.reopen_count}×</span>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="flex flex-col gap-2">
            <h3 className="text-xs font-semibold text-text-primary">Latest statement lines</h3>
            {lines.data.length === 0 ? (
              <p className="text-xs text-text-muted">No imported statement lines for this account.</p>
            ) : (
              <div className="overflow-hidden rounded-md border border-border">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-border bg-surface-neutral text-[11px] font-semibold uppercase text-text-muted">
                    <tr>
                      <th className="px-2.5 py-1.5">Date</th>
                      <th className="px-2.5 py-1.5">Description</th>
                      <th className="px-2 py-1.5 text-right">Amount</th>
                      <th className="px-2.5 py-1.5 text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {lines.data.map((l) => (
                      <tr key={l.id}>
                        <td className="px-2.5 py-1.5 tabular-nums text-text-muted">{formatDate(l.date)}</td>
                        <td className="max-w-[180px] truncate px-2.5 py-1.5 text-text-primary">{lineTitle(l)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-text-primary">{formatMoney(l.amount, l.currency)}</td>
                        <td className="px-2.5 py-1.5 text-center">
                          <StatusPill status={l.pending_journal_id ? 'pending_approval' : l.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <div className="mt-auto flex items-center justify-between pt-2">
            <Link to={`/${company.slug}/banking/import?account=${bank.id}`} className={buttonSecondary}>
              <Upload className="size-4 text-text-muted" /> Import statement
            </Link>
            {bank.can.reconcile && (
              <Link to={`/${company.slug}/banking/${bank.id}/reconcile`} className={buttonPrimary}>
                Open reconciliation <ArrowRight className="size-3.5" />
              </Link>
            )}
          </div>
        </SheetContent>
      )}
    </Sheet>
  );
};

/** Create or change a bank account. The ledger account is chosen from the chart: only bank or cash accounts qualify. */
const AccountDialog: React.FC<{ target: LiveBankAccount | 'new' | null; onClose: () => void }> = ({ target, onClose }) => {
  const company = useRouteCompany();
  const accounts = useChartAccounts();
  const actions = useBankingActions();
  const slot = useRef(new IntentSlot()).current;
  const [form, setForm] = useState<BankAccountForm>(() => blankAccountForm(company.base_currency));
  const [seen, setSeen] = useState<typeof target>(null);
  const [error, setError] = useState<unknown>(null);
  const [local, setLocal] = useState('');
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState<VersionConflict | null>(null);

  // Reset the form when a different target is opened.
  if (target !== seen) {
    setSeen(target);
    setError(null);
    setLocal('');
    slot.clear();
    setForm(target && target !== 'new' ? toBankAccountForm(target) : blankAccountForm(company.base_currency));
  }

  const glChoices = useMemo(
    () =>
      accounts.data
        .filter((a) => a.is_active && a.is_postable && (a.control_type === 'bank' || a.control_type === 'cash'))
        .map((a) => ({ value: a.id, label: `${a.code} ${a.name}` })),
    [accounts.data],
  );
  const editing = target && target !== 'new' ? target : null;
  const set = <K extends keyof BankAccountForm>(k: K, v: BankAccountForm[K]) => setForm((f) => ({ ...f, [k]: v }));

  const save = async (versionOverride?: number) => {
    setLocal('');
    if (!form.name.trim()) return setLocal('Give the account a name.');
    if (!form.account_id) return setLocal('Choose the ledger account this one posts to.');
    setBusy(true);
    setError(null);
    const version = versionOverride ?? editing?.version;
    const body = toBankAccountRequest(form, editing ? version : undefined);
    const intent = slot.for(JSON.stringify([editing?.id ?? 'new', body]));
    try {
      if (editing) await actions.updateAccount(editing.id, body, intent);
      else await actions.createAccount(body, intent);
      slot.clear();
      toast.success(editing ? 'Account saved.' : `Account "${form.name.trim()}" added.`);
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.isVersionConflict && editing) {
        setConflict({
          noun: 'bank account',
          serverVersion: err.serverVersion,
          localVersion: editing.version,
          onReload: () => {
            setConflict(null);
            onClose();
          },
          onOverwrite:
            typeof err.serverVersion === 'number'
              ? () => {
                  setConflict(null);
                  void save(err.serverVersion as number);
                }
              : undefined,
          onClose: () => setConflict(null),
        });
      } else {
        // A 5xx may still have saved the change; show the server's current state behind the dialog.
        if (err instanceof ApiError && err.status >= 500) actions.refresh();
        setError(err);
      }
    } finally {
      setBusy(false);
    }
  };

  const message = local || (error ? bankingErrorText(error, describeError) : '');
  return (
    <>
      <Dialog open={Boolean(target)} onOpenChange={(o) => !o && !busy && onClose()}>
        <DialogContent className="max-w-[520px] p-5">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold text-text-primary">{editing ? 'Edit account' : 'Add a bank or cash account'}</DialogTitle>
            <DialogDescription className="text-xs text-text-muted">
              {editing ? 'The ledger account and currency stay fixed once statement lines exist.' : 'Pick the ledger account its balance lives in. Statements are imported afterwards.'}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={(e) => { e.preventDefault(); void save(); }} className="flex flex-col gap-3 text-xs">
            <Field label="Name">
              <input className={inputCls} value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Operating account" autoFocus aria-label="Name" />
              {fieldError(error, 'name') && <span className="text-[11px] text-danger">{fieldError(error, 'name')}</span>}
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Type">
                <SimpleSelect aria-label="Type" allowNone={false} value={form.kind} onChange={(v) => set('kind', (v ?? 'bank') as BankAccountForm['kind'])} options={KINDS} />
              </Field>
              <Field label="Currency">
                <input className={inputCls} value={form.currency} maxLength={3} onChange={(e) => set('currency', e.target.value.toUpperCase())} aria-label="Currency" />
              </Field>
            </div>
            <Field label="Ledger account" hint={glChoices.length === 0 && !accounts.isLoading ? 'No bank or cash account exists in the chart yet. Add one under Chart of accounts first.' : undefined}>
              <SimpleSelect aria-label="Ledger account" allowNone={false} value={form.account_id} onChange={(v) => set('account_id', v ?? '')} options={glChoices} placeholder="Choose a ledger account..." />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Bank">
                <input className={inputCls} value={form.bank_name} onChange={(e) => set('bank_name', e.target.value)} aria-label="Bank" />
              </Field>
              <Field label="Account number (last digits)">
                <input className={inputCls} value={form.account_number_masked} onChange={(e) => set('account_number_masked', e.target.value)} placeholder="e.g. ••••8821" aria-label="Account number" />
              </Field>
              <Field label="IBAN (optional)">
                <input className={inputCls} value={form.iban} maxLength={34} onChange={(e) => set('iban', e.target.value.toUpperCase())} aria-label="IBAN" />
              </Field>
              <Field label="SWIFT (optional)">
                <input className={inputCls} value={form.swift} maxLength={11} onChange={(e) => set('swift', e.target.value.toUpperCase())} aria-label="SWIFT" />
              </Field>
            </div>
            {editing && (
              <label className="flex items-center gap-2 text-text-secondary">
                <input type="checkbox" checked={form.is_active} onChange={(e) => set('is_active', e.target.checked)} />
                In use (switch off to stop importing and reconciling)
              </label>
            )}
            {message && (
              <p role="alert" className="text-[13px] text-danger">
                {message}
              </p>
            )}
            <DialogFooter className="mt-2 gap-2">
              <button type="button" onClick={onClose} disabled={busy} className="h-8 rounded-md border border-border px-3 text-[13px] font-medium text-text-secondary hover:bg-surface-neutral">
                Cancel
              </button>
              <button type="submit" disabled={busy} className={buttonPrimary}>
                {busy ? 'Saving…' : editing ? 'Save' : 'Add account'}
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <ConflictDialog conflict={conflict} />
    </>
  );
};
