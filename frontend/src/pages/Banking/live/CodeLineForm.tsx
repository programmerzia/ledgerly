import React, { useRef, useState } from 'react';
import { AlertCircle, Check } from 'lucide-react';
import { toast } from 'sonner';
import { formatMoney } from '@/lib/format';
import { useBankingActions } from '@/data/banking';
import { isSigningCancelled } from '@/data/signing';
import { IntentSlot } from '@/api/intentSlot';
import {
  bankingErrorText,
  toTransactionRequest,
  transactionOutcome,
  type CodeLineForm as CodeLineBody,
  type LiveBankAccount,
  type LiveBankLine,
  type RuleSuggestion,
} from '@/api/adapters/banking';
import { Field, Segmented, SimpleSelect, inputCls } from '../reconcile/shared';
import { CodingFields, type CodingValue } from './CodingFields';
import { verdictText } from '@/pages/Accounting/live/parts';

interface Props {
  line: LiveBankLine;
  /** All bank accounts, for the other side of a transfer. */
  banks: LiveBankAccount[];
  rule: RuleSuggestion | null;
  /** Runs a write through the signing prompt (`useSignedRun().run`). */
  run: <T>(fn: () => Promise<T>) => Promise<T>;
  onDone: () => void;
}

/**
 * Code one statement line as spend, receive or transfer. The server posts it (or holds it for an approver above the
 * company's limit) and decides whether the coding is allowed; this form does no tax or posting arithmetic.
 */
export const CodeLineForm: React.FC<Props> = ({ line, banks, rule, run, onDone }) => {
  const actions = useBankingActions();
  const slot = useRef(new IntentSlot()).current;
  const out = line.amount < 0;
  const [kind, setKind] = useState<CodeLineBody['kind']>(out ? 'spend' : 'receive');
  const [coding, setCoding] = useState<CodingValue>({
    account_id: rule?.action.account_id || null,
    tax_code_id: rule?.action.tax_code_id ?? null,
    contact_id: rule?.action.contact_id ?? null,
    dimensions: rule?.action.dimensions ?? {},
    memo: rule?.action.memo ?? line.description,
  });
  const [toBank, setToBank] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const otherBanks = banks.filter((b) => b.id !== line.bank_account_id && b.is_active);
  const transfer = kind === 'transfer';

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!transfer && !coding.account_id) return setError('Choose the account to code this line to.');
    if (transfer && !toBank) return setError('Choose the other bank or cash account.');
    const body = toTransactionRequest({
      kind,
      account_id: coding.account_id,
      to_bank_account_id: toBank,
      tax_code_id: coding.tax_code_id,
      contact_id: coding.contact_id,
      dimensions: coding.dimensions,
      memo: coding.memo,
      rule_id: null,
    });
    setBusy(true);
    const intent = slot.for(JSON.stringify([line.id, line.version, body]));
    try {
      const t = await run(() => actions.codeLine(line.id, body, intent));
      slot.clear();
      const outcome = transactionOutcome(t);
      toast.success(outcome === 'waiting' ? 'Sent for approval. The line leaves your to-do list until it is approved.' : `Recorded as ${t.journal_number ?? 'a journal entry'}.`);
      onDone();
    } catch (err) {
      if (!isSigningCancelled(err)) setError(bankingErrorText(err, verdictText));
    } finally {
      setBusy(false);
    }
  };

  const currency = line.currency;
  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3 px-4 py-4" data-testid="code-line-form">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Segmented
          value={kind}
          onChange={(v) => setKind(v as CodeLineBody['kind'])}
          options={[
            { value: 'spend', label: 'Spend money', disabled: !out },
            { value: 'receive', label: 'Receive money', disabled: out },
            { value: 'transfer', label: 'Transfer', disabled: otherBanks.length === 0, title: otherBanks.length === 0 ? 'Add another bank account to transfer between' : undefined },
          ]}
        />
        <span className="text-xs tabular-nums text-text-muted">{formatMoney(line.amount, currency)}</span>
      </div>

      {transfer ? (
        <>
          <Field label={out ? 'Money went to' : 'Money came from'}>
            <SimpleSelect
              aria-label="Other account"
              allowNone={false}
              value={toBank ?? undefined}
              onChange={(v) => setToBank(v ?? null)}
              placeholder="Choose a bank account..."
              options={otherBanks.map((b) => ({ value: b.id, label: `${b.name} (${b.currency})${b.currency !== currency ? ' - different currency' : ''}` }))}
            />
          </Field>
          <Field label="Memo (optional)">
            <input className={inputCls} value={coding.memo} onChange={(e) => setCoding({ ...coding, memo: e.target.value })} aria-label="Memo" />
          </Field>
        </>
      ) : (
        <CodingFields value={coding} onChange={setCoding} />
      )}

      <p className="text-[11px] text-text-muted">It posts straight away when it is under your approval limit. Larger amounts wait for an approver. You will be asked for your signing PIN.</p>

      {error && (
        <div role="alert" className="flex items-start gap-2 rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">
          <AlertCircle className="mt-0.5 size-3.5 shrink-0" /> {error}
        </div>
      )}
      <div className="flex justify-end">
        <button type="submit" disabled={busy} className="flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-[13px] font-medium text-white transition hover:bg-accent-hover disabled:opacity-60">
          <Check className="size-4" />
          {busy ? 'Recording…' : `Record ${formatMoney(Math.abs(line.amount), currency)}`}
        </button>
      </div>
    </form>
  );
};

