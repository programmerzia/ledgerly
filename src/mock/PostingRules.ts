/**
 * Centralized Ledger Posting Rules module conforming to 05_Schema.md and 08_Mock_Refactor_Prompt.md Block A.
 * 
 * Rules:
 * 1. Centralized postJournal is the SOLE code path that creates or writes journal lines.
 * 2. Strict validation: Period must be 'open', dimensions required on P&L accounts, debits === credits.
 * 3. Gapless sequential numbering allocated from sequences.
 * 4. SHA-256 audit chaining on every posting event.
 * 5. Every line carries currency, fx_rate, amount_fc, and base debit/credit.
 */

import {
  Journal,
  JournalLine,
  Invoice,
  Bill,
  Settlement,
  FxRevaluation,
  DepreciationRun,
  CompanySettings,
  FiscalPeriod,
  Account,
  AuditEvent,
  User,
} from '@/types';
import { generateAuditHash } from '@/lib/hash';

export class PostingError extends Error {
  code: string;
  field?: string;

  constructor(message: string, code: string = 'POSTING_ERROR', field?: string) {
    super(message);
    this.name = 'PostingError';
    this.code = code;
    this.field = field;
  }
}

export interface PostingContext {
  periods: FiscalPeriod[];
  accounts: Account[];
  settings: CompanySettings;
  sequences: Record<string, number>;
  lastAuditEvent?: AuditEvent;
  currentUser: User;
}

/**
 * Validates a journal draft against all controls-grade accounting rules.
 */
export function validateJournalDraft(draft: Partial<Journal>, context: PostingContext): void {
  if (!draft.fiscal_period_id) {
    throw new PostingError('Fiscal period is required to post.', 'PERIOD_REQUIRED');
  }

  const period = context.periods.find((p) => p.id === draft.fiscal_period_id);
  if (!period) {
    throw new PostingError(`Fiscal period '${draft.fiscal_period_id}' not found.`, 'PERIOD_NOT_FOUND');
  }

  if (period.status !== 'open') {
    throw new PostingError(
      `Cannot post to period '${period.name}': period is ${period.status.replace('_', ' ')}. Posting is blocked.`,
      'PERIOD_CLOSED'
    );
  }

  if (!draft.lines || draft.lines.length === 0) {
    throw new PostingError('Journal must contain at least two balanced lines.', 'NO_LINES');
  }

  if (draft.lines.length < 2) {
    throw new PostingError('Double-entry ledger requires at least two lines.', 'MIN_LINES');
  }

  let totalDebit = 0;
  let totalCredit = 0;

  for (const line of draft.lines) {
    if (!line.account_id) {
      throw new PostingError(`Line ${line.line_no} is missing an account.`, 'ACCOUNT_REQUIRED', `line_${line.line_no}`);
    }

    const account = context.accounts.find((a) => a.id === line.account_id);
    if (!account) {
      throw new PostingError(`Account '${line.account_id}' does not exist.`, 'INVALID_ACCOUNT');
    }

    if (!account.is_postable) {
      throw new PostingError(
        `Account ${account.code} (${account.name}) is a header account and cannot accept postings directly.`,
        'HEADER_ACCOUNT'
      );
    }

    // Dimension rule: Branch is strictly required on Revenue and Expense accounts
    if (account.account_type === 'income' || account.account_type === 'expense') {
      if (!line.dimensions?.branch) {
        throw new PostingError(
          `Branch dimension is mandatory for income/expense account ${account.code} - ${account.name} (Line ${line.line_no}).`,
          'BRANCH_REQUIRED',
          `line_${line.line_no}_branch`
        );
      }
    }

    if (line.debit < 0 || line.credit < 0) {
      throw new PostingError(
        `Negative debit or credit on line ${line.line_no}. Use opposite column for reductions.`,
        'NEGATIVE_AMOUNT'
      );
    }

    if (line.debit > 0 && line.credit > 0) {
      throw new PostingError(
        `Line ${line.line_no} cannot have both debit and credit. One side must be zero.`,
        'BOTH_SIDES'
      );
    }

    totalDebit += line.debit;
    totalCredit += line.credit;
  }

  if (totalDebit !== totalCredit) {
    const diff = Math.abs(totalDebit - totalCredit);
    throw new PostingError(
      `Journal is out of balance by ${(diff / 100).toFixed(2)}. Total debits must equal total credits.`,
      'UNBALANCED_JOURNAL'
    );
  }
}

/**
 * Central posting function that assigns gapless number, stamps audit, and finalises journal.
 */
export function executePostJournal(
  draft: Omit<Journal, 'id' | 'number' | 'status' | 'posted_at' | 'posted_by'> & { id?: string },
  context: PostingContext
): { journal: Journal; auditEvent: AuditEvent; nextSequence: number } {
  validateJournalDraft(draft, context);

  const prefix = context.settings.numbering.journal_prefix || 'JRN-';
  const padding = context.settings.numbering.padding || 4;
  const currentSeq = context.sequences.journal || 103;
  const nextSeq = currentSeq + 1;
  const journalNumber = `${prefix}2026-${String(currentSeq).padStart(padding, '0')}`;

  const now = new Date().toISOString();
  const journalId = draft.id || `jrn-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

  const totalDebit = draft.lines.reduce((s, l) => s + l.debit, 0);
  const totalCredit = draft.lines.reduce((s, l) => s + l.credit, 0);

  const finalJournal: Journal = {
    ...draft,
    id: journalId,
    tenant_id: draft.tenant_id || 'ten-acme',
    company_id: draft.company_id || 'co-1',
    fiscal_period_id: draft.fiscal_period_id,
    journal_type: draft.journal_type || 'manual',
    number: journalNumber,
    status: 'posted',
    journal_date: draft.journal_date || now.split('T')[0],
    posted_at: now,
    posted_by: context.currentUser.id,
    total_debit: totalDebit,
    total_credit: totalCredit,
    lines: draft.lines.map((l, idx) => ({
      ...l,
      line_no: idx + 1,
      currency: l.currency || 'USD',
      fx_rate: l.fx_rate || 1.0,
      amount_fc: l.amount_fc ?? (l.debit > 0 ? l.debit : -l.credit),
    })),
    created_at: draft.created_at || now,
    updated_at: now,
  };

  const prevHash = context.lastAuditEvent?.hash || '0000000000000000000000000000000000000000000000000000000000000000';
  const auditAction = 'journal.posted';
  const detail = `Posted journal ${journalNumber} (${(totalDebit / 100).toFixed(2)} USD) in period ${draft.fiscal_period_id}`;
  const auditHash = generateAuditHash(
    prevHash,
    now,
    context.currentUser.id,
    auditAction,
    'journal',
    journalId,
    detail
  );

  const auditEvent: AuditEvent = {
    id: `aud-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    occurred_at: now,
    actor_id: context.currentUser.id,
    actor_name: context.currentUser.name,
    action: auditAction,
    subject_type: 'journal',
    subject_id: journalId,
    subject_number: journalNumber,
    detail,
    prev_hash: prevHash,
    hash: auditHash,
  };

  return { journal: finalJournal, auditEvent, nextSequence: nextSeq };
}

/**
 * Builds the balanced journal draft for a sales invoice.
 */
export function buildJournalFromInvoice(
  invoice: Invoice,
  settings: CompanySettings,
  periodId: string,
  user: User
): Omit<Journal, 'id' | 'number' | 'status' | 'posted_at' | 'posted_by'> {
  const arAccountId = settings.posting_accounts.ar_control;
  const taxOutputAccountId = settings.posting_accounts.tax_output;

  const lines: JournalLine[] = [];
  let lineNo = 1;

  // 1. AR Control (Debit) for the total invoice amount in base currency
  lines.push({
    id: `jl-inv-${invoice.id}-ar`,
    line_no: lineNo++,
    account_id: arAccountId,
    debit: invoice.total,
    credit: 0,
    currency: invoice.currency,
    fx_rate: invoice.fx_rate,
    amount_fc: invoice.total_fc,
    dimensions: invoice.lines[0]?.dimensions || {},
    description: `AR Control: ${invoice.number || 'Invoice'} - Contact Ref #${invoice.reference}`,
    contact_id: invoice.contact_id,
  });

  // 2. Revenue lines (Credit)
  for (const invLine of invoice.lines) {
    const baseLineTotal = Math.round(invLine.line_total_fc * invoice.fx_rate);
    lines.push({
      id: `jl-inv-${invoice.id}-rev-${invLine.id}`,
      line_no: lineNo++,
      account_id: invLine.account_id,
      debit: 0,
      credit: baseLineTotal,
      currency: invoice.currency,
      fx_rate: invoice.fx_rate,
      amount_fc: -invLine.line_total_fc,
      dimensions: invLine.dimensions,
      description: invLine.description || `Revenue: ${invoice.number}`,
      contact_id: invoice.contact_id,
      tax_code_id: invLine.tax_code_id,
    });
  }

  // 3. Tax Output (Credit) if applicable
  if (invoice.tax_total > 0) {
    lines.push({
      id: `jl-inv-${invoice.id}-tax`,
      line_no: lineNo++,
      account_id: taxOutputAccountId,
      debit: 0,
      credit: invoice.tax_total,
      currency: invoice.currency,
      fx_rate: invoice.fx_rate,
      amount_fc: -invoice.tax_total_fc,
      dimensions: invoice.lines[0]?.dimensions || {},
      description: `Sales Tax Output: ${invoice.number}`,
      contact_id: invoice.contact_id,
    });
  }

  // Check rounding discrepancy between AR debit and sum of credits
  const totalDebits = lines.reduce((s, l) => s + l.debit, 0);
  const totalCredits = lines.reduce((s, l) => s + l.credit, 0);
  if (totalDebits !== totalCredits) {
    const diff = totalDebits - totalCredits;
    // Plug rounding difference into rounding account
    lines.push({
      id: `jl-inv-${invoice.id}-round`,
      line_no: lineNo++,
      account_id: settings.posting_accounts.rounding,
      debit: diff < 0 ? Math.abs(diff) : 0,
      credit: diff > 0 ? diff : 0,
      currency: invoice.currency,
      fx_rate: invoice.fx_rate,
      amount_fc: 0,
      dimensions: invoice.lines[0]?.dimensions || {},
      description: `FX Rounding adjustment: ${invoice.number}`,
    });
  }

  return {
    tenant_id: invoice.tenant_id,
    company_id: invoice.company_id,
    fiscal_period_id: periodId,
    journal_type: 'sales',
    journal_date: invoice.issue_date,
    reference: invoice.number || invoice.reference,
    memo: `Sales invoice ${invoice.number}: ${invoice.memo || ''}`,
    source_type: 'sales_invoice',
    source_id: invoice.id,
    total_debit: lines.reduce((s, l) => s + l.debit, 0),
    total_credit: lines.reduce((s, l) => s + l.credit, 0),
    lines,
    created_by: user.id,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

/**
 * Builds the balanced journal draft for a purchase bill.
 */
export function buildJournalFromBill(
  bill: Bill,
  settings: CompanySettings,
  periodId: string,
  user: User
): Omit<Journal, 'id' | 'number' | 'status' | 'posted_at' | 'posted_by'> {
  const apAccountId = settings.posting_accounts.ap_control;
  const taxInputAccountId = settings.posting_accounts.tax_input;
  const whtPayableAccountId = settings.posting_accounts.wht_payable;

  const lines: JournalLine[] = [];
  let lineNo = 1;

  const whtAmountBase = bill.wht_amount_fc ? Math.round(bill.wht_amount_fc * bill.fx_rate) : 0;
  const netApPayable = bill.total - whtAmountBase;

  // 1. AP Control (Credit) for the payable net of WHT
  lines.push({
    id: `jl-bill-${bill.id}-ap`,
    line_no: lineNo++,
    account_id: apAccountId,
    debit: 0,
    credit: netApPayable,
    currency: bill.currency,
    fx_rate: bill.fx_rate,
    amount_fc: -(bill.total_fc - (bill.wht_amount_fc || 0)),
    dimensions: bill.lines[0]?.dimensions || {},
    description: `AP Control: ${bill.number || 'Bill'} - ${bill.reference}`,
    contact_id: bill.contact_id,
  });

  // 2. WHT Payable (Credit) if applicable
  if (whtAmountBase > 0) {
    lines.push({
      id: `jl-bill-${bill.id}-wht`,
      line_no: lineNo++,
      account_id: whtPayableAccountId,
      debit: 0,
      credit: whtAmountBase,
      currency: bill.currency,
      fx_rate: bill.fx_rate,
      amount_fc: -(bill.wht_amount_fc || 0),
      dimensions: bill.lines[0]?.dimensions || {},
      description: `WHT Withheld on Bill: ${bill.number}`,
      contact_id: bill.contact_id,
    });
  }

  // 3. Expense lines (Debit)
  for (const bLine of bill.lines) {
    const baseLineTotal = Math.round(bLine.line_total_fc * bill.fx_rate);
    lines.push({
      id: `jl-bill-${bill.id}-exp-${bLine.id}`,
      line_no: lineNo++,
      account_id: bLine.account_id,
      debit: baseLineTotal,
      credit: 0,
      currency: bill.currency,
      fx_rate: bill.fx_rate,
      amount_fc: bLine.line_total_fc,
      dimensions: bLine.dimensions,
      description: bLine.description || `Expense: ${bill.number}`,
      contact_id: bill.contact_id,
      tax_code_id: bLine.tax_code_id,
    });
  }

  // 4. Tax Input (Debit) if recoverable
  if (bill.tax_total > 0) {
    lines.push({
      id: `jl-bill-${bill.id}-tax`,
      line_no: lineNo++,
      account_id: taxInputAccountId,
      debit: bill.tax_total,
      credit: 0,
      currency: bill.currency,
      fx_rate: bill.fx_rate,
      amount_fc: bill.tax_total_fc,
      dimensions: bill.lines[0]?.dimensions || {},
      description: `Input VAT Recoverable: ${bill.number}`,
      contact_id: bill.contact_id,
    });
  }

  return {
    tenant_id: bill.tenant_id,
    company_id: bill.company_id,
    fiscal_period_id: periodId,
    journal_type: 'purchase',
    journal_date: bill.issue_date,
    reference: bill.number || bill.reference,
    memo: `Purchase bill ${bill.number}: ${bill.memo || ''}`,
    source_type: 'purchase_bill',
    source_id: bill.id,
    total_debit: lines.reduce((s, l) => s + l.debit, 0),
    total_credit: lines.reduce((s, l) => s + l.credit, 0),
    lines,
    created_by: user.id,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

/**
 * Builds the balanced journal draft for a settlement (Receipt or Payment).
 */
export function buildJournalFromSettlement(
  settlement: Settlement,
  bankAccountId: string,
  settings: CompanySettings,
  periodId: string,
  user: User
): Omit<Journal, 'id' | 'number' | 'status' | 'posted_at' | 'posted_by'> {
  const isReceipt = settlement.kind === 'receipt';
  const controlAccountId = isReceipt ? settings.posting_accounts.ar_control : settings.posting_accounts.ap_control;
  const fxRealisedAccountId = settings.posting_accounts.fx_realised;

  const lines: JournalLine[] = [];
  let lineNo = 1;

  // 1. Bank Account entry
  lines.push({
    id: `jl-set-${settlement.id}-bank`,
    line_no: lineNo++,
    account_id: bankAccountId,
    debit: isReceipt ? settlement.amount : 0,
    credit: isReceipt ? 0 : settlement.amount,
    currency: settlement.currency,
    fx_rate: settlement.fx_rate,
    amount_fc: isReceipt ? settlement.amount_fc : -settlement.amount_fc,
    dimensions: { branch: 'MG' },
    description: `${isReceipt ? 'Receipt' : 'Payment'} ${settlement.number} - Ref: ${settlement.reference}`,
    contact_id: settlement.contact_id,
  });

  // 2. Control Account entries from allocations
  for (const alloc of settlement.allocations) {
    lines.push({
      id: `jl-set-${settlement.id}-alloc-${alloc.id}`,
      line_no: lineNo++,
      account_id: controlAccountId,
      debit: isReceipt ? 0 : alloc.allocated_amount_base,
      credit: isReceipt ? alloc.allocated_amount_base : 0,
      currency: settlement.currency,
      fx_rate: settlement.fx_rate,
      amount_fc: isReceipt ? -alloc.allocated_amount_fc : alloc.allocated_amount_fc,
      dimensions: { branch: 'MG' },
      description: `Settlement for ${alloc.invoice_number}`,
      contact_id: settlement.contact_id,
    });

    // Realised FX Gain / Loss if any
    if (alloc.fx_gain_loss !== 0) {
      const isGain = alloc.fx_gain_loss > 0;
      lines.push({
        id: `jl-set-${settlement.id}-fx-${alloc.id}`,
        line_no: lineNo++,
        account_id: fxRealisedAccountId,
        debit: isGain ? 0 : Math.abs(alloc.fx_gain_loss),
        credit: isGain ? alloc.fx_gain_loss : 0,
        currency: 'USD',
        fx_rate: 1.0,
        amount_fc: alloc.fx_gain_loss,
        dimensions: { branch: 'MG', cost_centre: 'FIN' },
        description: `Realised FX ${isGain ? 'Gain' : 'Loss'} on ${alloc.invoice_number}`,
      });
    }
  }

  return {
    tenant_id: settlement.tenant_id,
    company_id: settlement.company_id,
    fiscal_period_id: periodId,
    journal_type: isReceipt ? 'receipt' : 'payment',
    journal_date: settlement.settlement_date,
    reference: settlement.number,
    memo: settlement.memo || `${isReceipt ? 'Customer Receipt' : 'Supplier Payment'} ${settlement.number}`,
    source_type: 'settlement',
    source_id: settlement.id,
    total_debit: lines.reduce((s, l) => s + l.debit, 0),
    total_credit: lines.reduce((s, l) => s + l.credit, 0),
    lines,
    created_by: user.id,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

/**
 * Builds the balanced journal draft for FX Revaluation run.
 */
export function buildJournalFromRevaluation(
  reval: FxRevaluation,
  settings: CompanySettings,
  periodId: string,
  user: User
): Omit<Journal, 'id' | 'number' | 'status' | 'posted_at' | 'posted_by'> {
  const fxUnrealisedAccountId = settings.posting_accounts.fx_unrealised;
  const lines: JournalLine[] = [];
  let lineNo = 1;

  for (const item of reval.items) {
    if (item.unrealised_gain_loss === 0) continue;

    const isGain = item.unrealised_gain_loss > 0;
    const diff = Math.abs(item.unrealised_gain_loss);

    // Balance Sheet account adjustment
    lines.push({
      id: `jl-reval-${reval.id}-${item.account_id}-bs`,
      line_no: lineNo++,
      account_id: item.account_id,
      debit: isGain ? diff : 0,
      credit: isGain ? 0 : diff,
      currency: item.currency,
      fx_rate: item.current_rate,
      amount_fc: item.amount_fc,
      dimensions: { branch: 'MG' },
      description: `FX Revaluation as of ${reval.as_of} (${item.account_name})`,
    });

    // P&L Unrealised FX Gain/Loss
    lines.push({
      id: `jl-reval-${reval.id}-${item.account_id}-pl`,
      line_no: lineNo++,
      account_id: fxUnrealisedAccountId,
      debit: isGain ? 0 : diff,
      credit: isGain ? diff : 0,
      currency: 'USD',
      fx_rate: 1.0,
      amount_fc: item.unrealised_gain_loss,
      dimensions: { branch: 'MG', cost_centre: 'FIN' },
      description: `Unrealised FX ${isGain ? 'Gain' : 'Loss'} on ${item.account_code}`,
    });
  }

  return {
    tenant_id: 'ten-acme',
    company_id: reval.company_id,
    fiscal_period_id: periodId,
    journal_type: 'fx',
    journal_date: reval.as_of,
    reference: `REVAL-${reval.as_of}`,
    memo: `Month-end FX Revaluation as of ${reval.as_of}`,
    source_type: 'fx_revaluation',
    source_id: reval.id,
    total_debit: lines.reduce((s, l) => s + l.debit, 0),
    total_credit: lines.reduce((s, l) => s + l.credit, 0),
    lines,
    created_by: user.id,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

/**
 * Builds the balanced journal draft for a Fixed Asset Depreciation Run.
 */
export function buildJournalFromDepreciation(
  run: DepreciationRun,
  deprExpenseAccountId: string,
  accumDeprAccountId: string,
  periodId: string,
  user: User
): Omit<Journal, 'id' | 'number' | 'status' | 'posted_at' | 'posted_by'> {
  const lines: JournalLine[] = [];
  let lineNo = 1;

  for (const item of run.lines) {
    if (item.amount <= 0) continue;

    // Debit Depreciation Expense
    lines.push({
      id: `jl-depr-${run.id}-${item.asset_id}-exp`,
      line_no: lineNo++,
      account_id: deprExpenseAccountId,
      debit: item.amount,
      credit: 0,
      currency: 'USD',
      fx_rate: 1.0,
      amount_fc: item.amount,
      dimensions: { branch: 'MG', cost_centre: 'ADMIN' },
      description: `Depreciation: ${item.asset_number} - ${item.asset_name}`,
    });

    // Credit Accumulated Depreciation
    lines.push({
      id: `jl-depr-${run.id}-${item.asset_id}-acc`,
      line_no: lineNo++,
      account_id: accumDeprAccountId,
      debit: 0,
      credit: item.amount,
      currency: 'USD',
      fx_rate: 1.0,
      amount_fc: -item.amount,
      dimensions: { branch: 'MG', cost_centre: 'ADMIN' },
      description: `Accum. Depr: ${item.asset_number} - ${item.asset_name}`,
    });
  }

  return {
    tenant_id: 'ten-acme',
    company_id: run.company_id,
    fiscal_period_id: periodId,
    journal_type: 'depreciation',
    journal_date: run.as_of,
    reference: `DEPR-${run.as_of}`,
    memo: `Monthly Fixed Asset Depreciation Run as of ${run.as_of}`,
    source_type: 'depreciation_run',
    source_id: run.id,
    total_debit: lines.reduce((s, l) => s + l.debit, 0),
    total_credit: lines.reduce((s, l) => s + l.credit, 0),
    lines,
    created_by: user.id,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}
