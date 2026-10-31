/**
 * Bank transactions created from statement lines, and bank-rule matching (docs/14 E1).
 *
 * Pure functions: no store access. The store slice (store/automation.ts) supplies the context,
 * decides post-now vs. approval, and matches the line.
 *
 * Treatment (statement amounts are gross, tax-inclusive):
 *   spend:    Dr coding account (net), Dr tax pay account (tax), Cr bank (gross)
 *   receive:  Dr bank (gross), Cr coding account (net), Cr tax collect account (tax)
 *   transfer: Dr destination bank, Cr source bank (money out) — or the reverse for money in
 * net = roundHalfUp(gross / (1 + rate)), tax = gross − net, so the lines always balance.
 */
import type {
  Account,
  BankAccount,
  BankRule,
  BankStatementLine,
  BankTransactionInput,
  FiscalPeriod,
  JournalLine,
  TaxCode,
} from '@/types';
import { roundHalfUp } from '@/lib/format';
import { PostingError } from '@/mock/PostingRules';

/** Control accounts are posted only through their sub-ledgers, never coded from a bank line. */
const CONTROL_TYPES_BLOCKED = new Set(['ar', 'ap', 'tax', 'suspense', 'retained_earnings', 'accum_depr']);

export interface BankTransactionContext {
  accounts: Account[];
  bankAccounts: BankAccount[];
  taxCodes: TaxCode[];
  periods: FiscalPeriod[];
}

export interface BankTransactionDraft {
  fiscal_period_id: string;
  journal_type: 'bank';
  source_type: 'bank_transaction';
  source_id: string;
  journal_date: string;
  reference: string;
  memo: string;
  lines: JournalLine[];
  /** Gross amount moved through the bank (minor units, positive). */
  gross: number;
}

export function lineDirection(line: Pick<BankStatementLine, 'amount'>): 'in' | 'out' {
  return line.amount >= 0 ? 'in' : 'out';
}

/** First active rule (by priority) whose conditions match the line, or undefined. */
export function matchBankRule(line: BankStatementLine, rules: BankRule[]): BankRule | undefined {
  const haystack = `${line.description} ${line.counterparty ?? ''} ${line.reference ?? ''}`.toLowerCase();
  const gross = Math.abs(line.amount);
  return [...rules]
    .filter((r) => r.is_active)
    .sort((a, b) => a.priority - b.priority)
    .find(
      (r) =>
        r.contains.trim() !== '' &&
        haystack.includes(r.contains.toLowerCase()) &&
        (r.direction === 'any' || r.direction === lineDirection(line)) &&
        (r.min_amount === undefined || gross >= r.min_amount) &&
        (r.max_amount === undefined || gross <= r.max_amount),
    );
}

/** Splits a tax-inclusive gross amount into net and tax with the document rounding rule. */
export function splitGross(gross: number, rate: number): { net: number; tax: number } {
  if (!rate) return { net: gross, tax: 0 };
  const net = roundHalfUp(gross / (1 + rate));
  return { net, tax: gross - net };
}

export function buildBankTransaction(
  line: BankStatementLine,
  input: BankTransactionInput,
  ctx: BankTransactionContext,
): BankTransactionDraft {
  if (line.status !== 'unmatched' || line.pending_journal_id) {
    throw new PostingError('This bank line is already matched or waiting for approval.', 'line_not_open', 'lineId');
  }
  const direction = lineDirection(line);
  const gross = Math.abs(line.amount);
  if (gross === 0) throw new PostingError('The bank line has no amount.', 'amount_zero', 'lineId');

  if (input.kind === 'spend' && direction !== 'out') {
    throw new PostingError('Money in cannot be recorded as spend money.', 'direction_mismatch', 'kind');
  }
  if (input.kind === 'receive' && direction !== 'in') {
    throw new PostingError('Money out cannot be recorded as receive money.', 'direction_mismatch', 'kind');
  }

  const bank = ctx.bankAccounts.find((b) => b.id === line.bank_account_id);
  if (!bank) throw new PostingError('Bank account not found.', 'bank_account_not_found', 'lineId');

  const period = ctx.periods.find(
    (p) => p.kind !== 'adjustment' && p.starts_on <= line.txn_date && line.txn_date <= p.ends_on,
  );
  if (!period) throw new PostingError('No fiscal period covers this date.', 'period_not_found', 'lineId');

  const dims = { branch: 'MG', ...(input.dimensions ?? {}) };
  const memo = input.memo?.trim() || line.description;
  const lines: JournalLine[] = [];
  const push = (accountId: string, amount: number, description: string, extra: Partial<JournalLine> = {}) =>
    lines.push({
      id: `jl-bt-${line.id}-${lines.length + 1}`,
      line_no: lines.length + 1,
      account_id: accountId,
      debit: amount > 0 ? amount : 0,
      credit: amount < 0 ? -amount : 0,
      currency: bank.currency,
      fx_rate: 1.0,
      amount_fc: amount,
      dimensions: dims,
      description,
      ...extra,
    });

  if (input.kind === 'transfer') {
    const other = ctx.bankAccounts.find((b) => b.id === input.toBankAccountId);
    if (!other || other.id === bank.id) {
      throw new PostingError('Choose a different bank account to transfer to.', 'transfer_account_invalid', 'toBankAccountId');
    }
    if (other.currency !== bank.currency) {
      throw new PostingError('Transfers between currencies are not supported here yet.', 'transfer_currency_mismatch', 'toBankAccountId');
    }
    const sign = direction === 'out' ? 1 : -1; // money out: Dr destination, Cr this bank
    push(other.account_id, sign * gross, `Transfer ${direction === 'out' ? 'to' : 'from'} ${other.name}`);
    push(bank.account_id, -sign * gross, memo);
  } else {
    const account = ctx.accounts.find((a) => a.id === input.accountId);
    if (!account || !account.is_active || !account.is_postable) {
      throw new PostingError('Choose an active account to code this line to.', 'account_invalid', 'accountId');
    }
    if (CONTROL_TYPES_BLOCKED.has(account.control_type) || account.control_type === 'bank' || account.control_type === 'cash') {
      throw new PostingError(
        `${account.code} ${account.name} is a control account. Record customer and supplier money as a receipt or payment instead.`,
        'control_account_not_allowed',
        'accountId',
      );
    }
    const tax = input.taxCodeId ? ctx.taxCodes.find((t) => t.id === input.taxCodeId) : undefined;
    if (input.taxCodeId && !tax) throw new PostingError('Unknown tax code.', 'tax_code_invalid', 'taxCodeId');
    const rate = tax && tax.kind !== 'wht' ? tax.rate : 0;
    const { net, tax: taxAmount } = splitGross(gross, rate);
    const taxAccountId = input.kind === 'spend' ? tax?.pay_account_id : tax?.collect_account_id;
    if (taxAmount > 0 && !taxAccountId) {
      throw new PostingError('This tax code has no account for this direction.', 'tax_account_missing', 'taxCodeId');
    }
    const s = input.kind === 'spend' ? 1 : -1; // spend: Dr expense/tax, Cr bank
    const contact = input.contactId ? { contact_id: input.contactId } : {};
    push(account.id, s * net, memo, contact);
    if (taxAmount > 0) push(taxAccountId!, s * taxAmount, `${tax!.code} on ${memo}`);
    push(bank.account_id, -s * gross, line.description);
  }

  const dr = lines.reduce((t, l) => t + l.debit, 0);
  const cr = lines.reduce((t, l) => t + l.credit, 0);
  if (dr !== cr) throw new PostingError('Bank transaction does not balance.', 'journal_unbalanced');

  return {
    fiscal_period_id: period.id,
    journal_type: 'bank',
    source_type: 'bank_transaction',
    source_id: line.id,
    journal_date: line.txn_date,
    reference: line.reference || line.id,
    memo,
    lines,
    gross,
  };
}
