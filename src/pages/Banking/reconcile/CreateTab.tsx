import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Check, Wand2 } from 'lucide-react';
import { toast } from 'sonner';
import { useLedgerStore } from '@/mock/store';
import { splitGross } from '@/mock/BankTransactions';
import { formatMoney } from '@/lib/format';
import { AccountPicker } from '@/components/domain/AccountPicker';
import { Checkbox } from '@/components/ui/checkbox';
import { Kbd } from '@/components/ui/kbd';
import type { BankStatementLine, BankTransactionKind, BankTransactionResult } from '@/types';
import { Field, Segmented, SimpleSelect, codableAccounts, dimOptions, inputCls, suggestKeyword } from './shared';

interface Props {
  line: BankStatementLine;
  onDone: (result: BankTransactionResult) => void;
}

/** Compact "code this line" form. Re-mounted per line (keyed by line id) so defaults are always fresh. */
export const CreateTab: React.FC<Props> = ({ line, onDone }) => {
  const {
    accounts, taxCodes, contacts, dimensions, bankAccounts, bankRules,
    ruleSuggestionFor, createBankTransaction, addBankRule, currentUser, companySettings,
  } = useLedgerStore();
  const rule = ruleSuggestionFor(line.id);
  const bank = bankAccounts.find((b) => b.id === line.bank_account_id);
  const out = line.amount < 0;
  const gross = Math.abs(line.amount);
  const currency = bank?.currency;
  const vat0 = taxCodes.find((t) => t.code === 'VAT0')?.id;

  const [kind, setKind] = useState<BankTransactionKind>(out ? 'spend' : 'receive');
  const [accountId, setAccountId] = useState<string | undefined>(rule?.account_id);
  const [taxCodeId, setTaxCodeId] = useState<string | undefined>(
    rule?.tax_code_id ?? contacts.find((c) => c.id === rule?.contact_id)?.default_tax_code_id ?? vat0
  );
  const [contactId, setContactId] = useState<string | undefined>(rule?.contact_id);
  const [dims, setDims] = useState<Record<string, string>>({ branch: 'MG', ...(rule?.dimensions ?? {}) });
  const [memo, setMemo] = useState(rule?.memo ?? line.description);
  const [toBankId, setToBankId] = useState<string | undefined>();
  const [makeRule, setMakeRule] = useState(false);
  const [keyword, setKeyword] = useState(() => suggestKeyword(line));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      const el = formRef.current?.querySelector<HTMLElement>(rule ? 'input[name=memo]' : 'button[role=combobox]');
      el?.focus();
    }, 30);
    return () => clearTimeout(t);
  }, [rule]);

  const coding = kind !== 'transfer';
  const accountOptions = useMemo(() => codableAccounts(accounts), [accounts]);
  const taxOptions = taxCodes.filter((t) => t.is_active && t.kind !== 'wht').map((t) => ({ value: t.id, label: `${t.code} · ${Math.round(t.rate * 100)}%` }));
  const contactOptions = contacts.filter((c) => c.is_active).map((c) => ({ value: c.id, label: c.name }));
  const otherBanks = bankAccounts.filter((b) => b.id !== line.bank_account_id);
  const tax = taxCodes.find((t) => t.id === taxCodeId);
  const accName = (id?: string) => {
    const a = accounts.find((x) => x.id === id);
    return a ? `${a.code} ${a.name}` : 'Choose an account';
  };

  const chooseContact = (id: string | undefined) => {
    setContactId(id);
    const c = contacts.find((x) => x.id === id);
    if (!c) return;
    if (c.default_account_id) setAccountId(c.default_account_id);
    if (c.default_tax_code_id) setTaxCodeId(c.default_tax_code_id);
    if (c.default_branch) setDims((d) => ({ ...d, branch: c.default_branch! }));
  };

  // Live journal preview, same arithmetic as the posting draft (net = gross / (1 + rate), rounded half up).
  const preview = useMemo(() => {
    const rows: { label: string; dr?: number; cr?: number }[] = [];
    const bankName = bank ? accName(bank.account_id) : 'Bank';
    if (kind === 'transfer') {
      const other = bankAccounts.find((b) => b.id === toBankId);
      const to = other ? accName(other.account_id) : 'Destination bank';
      rows.push(out ? { label: to, dr: gross } : { label: bankName, dr: gross });
      rows.push(out ? { label: bankName, cr: gross } : { label: to, cr: gross });
      return rows;
    }
    const { net, tax: t } = splitGross(gross, tax && tax.kind !== 'wht' ? tax.rate : 0);
    const taxAcc = kind === 'spend' ? tax?.pay_account_id : tax?.collect_account_id;
    if (kind === 'spend') {
      rows.push({ label: accName(accountId), dr: net });
      if (t > 0) rows.push({ label: `${accName(taxAcc)} (${tax?.code})`, dr: t });
      rows.push({ label: bankName, cr: gross });
    } else {
      rows.push({ label: bankName, dr: gross });
      rows.push({ label: accName(accountId), cr: net });
      if (t > 0) rows.push({ label: `${accName(taxAcc)} (${tax?.code})`, cr: t });
    }
    return rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, gross, tax, accountId, toBankId, bank, accounts, out]);

  const submit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (busy) return;
    setError(null);
    if (coding && !accountId) return setError('Choose the account this money belongs to, then record it.');
    if (!coding && !toBankId) return setError('Choose the bank account this money moves to or from.');
    setBusy(true);
    try {
      const result = createBankTransaction(
        {
          lineId: line.id,
          kind,
          accountId: coding ? accountId : undefined,
          toBankAccountId: coding ? undefined : toBankId,
          taxCodeId: coding ? taxCodeId : undefined,
          contactId: coding ? contactId : undefined,
          dimensions: dims,
          memo: memo.trim() || undefined,
          ruleId: rule && coding && accountId === rule.account_id ? rule.id : undefined,
        },
        currentUser,
        companySettings
      );
      if (makeRule && coding && accountId && keyword.trim()) {
        addBankRule({
          name: keyword.trim().toLowerCase().replace(/^./, (c) => c.toUpperCase()),
          priority: Math.max(0, ...bankRules.map((r) => r.priority)) + 10,
          is_active: true,
          direction: out ? 'out' : 'in',
          contains: keyword.trim(),
          account_id: accountId,
          tax_code_id: taxCodeId,
          contact_id: contactId,
          dimensions: dims,
          memo: memo.trim() || undefined,
        });
        toast.success(`Rule saved: lines containing "${keyword.trim()}" will be suggested next time.`);
      }
      toast.success(
        result.outcome === 'posted'
          ? `Recorded ${formatMoney(gross, currency)} and matched the line.`
          : 'Sent for approval. The line leaves your to-do list until it is approved.'
      );
      onDone(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record this line.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form ref={formRef} onSubmit={submit} className="flex flex-col gap-3 p-4" data-testid="create-tab">
      {rule && (
        <div className="flex items-center gap-1.5 rounded-lg bg-violet-soft px-2.5 py-1.5 text-xs text-violet">
          <Wand2 className="size-3.5" /> Filled in from rule "{rule.name}". Check it, then press Enter.
        </div>
      )}
      <Segmented
        value={kind}
        onChange={(v) => {
          setKind(v as BankTransactionKind);
          setError(null);
        }}
        options={[
          { value: 'spend', label: 'Spend', disabled: !out, title: out ? undefined : 'This line is money in' },
          { value: 'receive', label: 'Receive', disabled: out, title: out ? 'This line is money out' : undefined },
          { value: 'transfer', label: 'Transfer' },
        ]}
      />

      {coding ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={kind === 'spend' ? 'Spent on (account)' : 'Received for (account)'} className="sm:col-span-2">
            <AccountPicker accounts={accountOptions} value={accountId} onChange={(id) => setAccountId(id)} placeholder="Choose an account..." />
          </Field>
          <Field label="Tax">
            <SimpleSelect aria-label="Tax code" value={taxCodeId} onChange={setTaxCodeId} options={taxOptions} noneLabel="No tax" />
          </Field>
          <Field label="Contact (optional)">
            <SimpleSelect aria-label="Contact" value={contactId} onChange={chooseContact} options={contactOptions} placeholder="Choose..." noneLabel="No contact" />
          </Field>
        </div>
      ) : (
        <Field label={out ? 'Transfer to' : 'Transfer from'}>
          <SimpleSelect
            aria-label="Other bank account"
            value={toBankId}
            onChange={setToBankId}
            allowNone={false}
            placeholder="Choose a bank account..."
            options={otherBanks.map((b) => ({
              value: b.id,
              label: `${b.name} (${b.currency})${b.currency !== bank?.currency ? ' - different currency' : ''}`,
            }))}
          />
        </Field>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Branch">
          <SimpleSelect aria-label="Branch" value={dims.branch} onChange={(v) => setDims((d) => ({ ...d, branch: v ?? 'MG' }))} options={dimOptions(dimensions, 'branch')} allowNone={false} />
        </Field>
        <Field label="Memo">
          <input name="memo" className={inputCls} value={memo} onChange={(e) => setMemo(e.target.value)} />
        </Field>
      </div>

      <div className="overflow-hidden rounded-lg border border-border" data-testid="create-preview">
        <div className="bg-surface-neutral/60 px-3 py-1.5 text-[11px] font-medium text-text-muted">This will post</div>
        <table className="w-full text-xs">
          <tbody className="divide-y divide-border/60">
            {preview.map((r, i) => (
              <tr key={i}>
                <td className="w-8 px-3 py-1.5 font-medium text-text-muted">{r.dr ? 'Dr' : 'Cr'}</td>
                <td className={`truncate py-1.5 text-text-primary ${r.cr ? 'pl-4' : ''}`}>{r.label}</td>
                <td className="px-3 py-1.5 text-right tabular-nums text-text-primary">{formatMoney(r.dr ?? r.cr ?? 0, currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {coding && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-text-secondary">
          <label className="flex cursor-pointer items-center gap-2">
            <Checkbox checked={makeRule} onCheckedChange={(v) => setMakeRule(v === true)} aria-label="Create a rule for lines like this" />
            Create a rule for lines like this
          </label>
          {makeRule && (
            <span className="flex items-center gap-1.5">
              containing
              <input aria-label="Rule keyword" className={`${inputCls} !h-7 !w-40`} value={keyword} onChange={(e) => setKeyword(e.target.value)} />
            </span>
          )}
        </div>
      )}

      {error && (
        <div role="alert" className="flex items-start gap-2 rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">
          <AlertCircle className="mt-0.5 size-3.5 shrink-0" /> {error}
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <span className="hidden items-center gap-1.5 text-xs text-text-muted sm:flex">
          <Kbd>Enter</Kbd> record
        </span>
        <button
          type="submit"
          disabled={busy}
          className="ml-auto flex h-9 items-center gap-1.5 rounded-lg bg-accent px-4 text-[13px] font-semibold text-white transition hover:bg-accent-hover disabled:opacity-60"
        >
          <Check className="size-4" />
          Record {formatMoney(gross, currency)}
        </button>
      </div>
    </form>
  );
};
