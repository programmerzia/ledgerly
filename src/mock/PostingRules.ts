/**
 * Centralized Ledger Posting Rules module conforming to 05_Schema.md and 08_Mock_Refactor_Prompt.md Block A.
 * Conforms to 13_Backend_Architecture.md §9, §16, and §23 (Decisions D1 to D7).
 * 
 * Rules:
 * 1. Centralized postJournal is the SOLE code path that creates or writes journal lines.
 * 2. Strict validation: Period must be 'open' (or 'soft_closed' with permission), dimensions required on P&L, debits === credits.
 * 3. Validation collects ALL violations before rejecting and returns them as {code, line_no?, message}.
 * 4. Gapless sequential numbering allocated from sequences (JV-FY2026-00001, etc.).
 * 5. Commercial rounding HALF_UP on base currency conversions, residue to rounding account (D1).
 * 6. Multi-currency balancing in base, and FC balance check when all lines share same non-base currency (D6).
 * 7. 13th adjustment period (FY2026 Adj) accepts only closing/adjustment journals (D7).
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
import { roundHalfUp } from '@/lib/format';

export interface PostingViolation {
  code: string;
  line_no?: number;
  message: string;
}

export interface RFC9457Problem {
  type: string;
  title: string;
  status: number;
  code: string;
  detail: string;
  errors?: Record<string, string[]>;
  violations?: PostingViolation[];
  request_id: string;
}

export class PostingError extends Error {
  code: string;
  status: number;
  field?: string;
  violations?: PostingViolation[];
  errors?: Record<string, string[]>;
  request_id: string;
  problem: RFC9457Problem;

  constructor(
    message: string,
    code: string = 'POSTING_ERROR',
    fieldOrStatus?: string | number,
    violations?: PostingViolation[]
  ) {
    super(message);
    this.name = 'PostingError';
    this.code = code;
    const status = typeof fieldOrStatus === 'number' ? fieldOrStatus : 422;
    this.status = status;
    if (typeof fieldOrStatus === 'string') {
      this.field = fieldOrStatus;
    }
    this.violations = violations;
    this.request_id = `req-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    this.problem = {
      type: `https://ledgerly.app/errors/${code.replace(/_/g, '-')}`,
      title: code
        .split('_')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' '),
      status,
      code,
      detail: message,
      violations,
      request_id: this.request_id,
    };
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
 * Validates a journal draft against all controls-grade accounting rules (13_Backend_Architecture §9).
 * Collects ALL violations before throwing.
 */
export function validateJournalDraft(draft: any, context: PostingContext): void {
  const violations: PostingViolation[] = [];

  const periodId = draft.fiscal_period_id || draft.period_id;
  if (!periodId) {
    violations.push({
      code: 'period_missing',
      message: 'Fiscal period is required to post.',
    });
  }

  const period = periodId ? context.periods.find((p) => p.id === periodId) : undefined;
  if (periodId && !period) {
    violations.push({
      code: 'period_missing',
      message: `Fiscal period '${periodId}' not found.`,
    });
  }

  if (period) {
    // 0.6 Soft-closed & Closed periods (D5)
    if (period.status === 'closed' || period.status === 'locked') {
      violations.push({
        code: 'period_closed',
        message: `Cannot post to period '${period.name}': period is ${period.status.replace('_', ' ')}. Posting is blocked.`,
      });
    } else if (period.status === 'soft_closed') {
      const isApiClient = (context.currentUser as any)?.isApiClient || context.currentUser.role === 'integration';
      const canPostSoftClosed =
        !isApiClient &&
        (context.currentUser.role === 'owner' ||
          context.currentUser.role === 'finance_manager' ||
          context.currentUser.permissions?.includes('periods.post_soft_closed'));

      if (!canPostSoftClosed) {
        violations.push({
          code: 'period_soft_closed',
          message: `Cannot post to period '${period.name}': period is soft-closed. Posting requires permission 'periods.post_soft_closed'.`,
        });
      }
    }

    // 0.9 Adjustment period (D7)
    if (period.kind === 'adjustment') {
      if (draft.journal_type !== 'closing' && draft.journal_type !== 'adjustment') {
        violations.push({
          code: 'period_adjustment_only',
          message: `Adjustment period '${period.name}' accepts only 'closing' and 'adjustment' journals.`,
        });
      }
      const canPostAdj =
        context.currentUser.role === 'owner' ||
        context.currentUser.role === 'finance_manager' ||
        context.currentUser.permissions?.includes('periods.post_adjustment');
      if (!canPostAdj) {
        violations.push({
          code: 'period_adjustment_only',
          message: `Posting to adjustment period '${period.name}' requires permission 'periods.post_adjustment'.`,
        });
      }
    } else {
      // In regular period, closing or adjustment journals are rejected
      if (draft.journal_type === 'closing' || draft.journal_type === 'adjustment') {
        violations.push({
          code: 'period_adjustment_only',
          message: `Closing and adjustment journals cannot be posted to regular period '${period.name}'. They must be posted to the adjustment period.`,
        });
      }
    }

    // Date outside period check (for regular periods)
    if (draft.journal_date && period.kind !== 'adjustment' && period.starts_on && period.ends_on) {
      if (draft.journal_date < period.starts_on || draft.journal_date > period.ends_on) {
        violations.push({
          code: 'date_outside_period',
          message: `Journal date ${draft.journal_date} falls outside period '${period.name}' (${period.starts_on} to ${period.ends_on}).`,
        });
      }
    }
  }

  // 0.3 Journal lines check
  if (!draft.lines || draft.lines.length === 0) {
    violations.push({
      code: 'journal_empty',
      message: 'Journal draft is empty. Double-entry requires at least two balanced lines.',
    });
  } else if (draft.lines.length < 2) {
    violations.push({
      code: 'journal_unbalanced',
      message: 'Double-entry ledger requires at least two lines.',
    });
  }

  if (draft.lines && draft.lines.length > 0) {
    for (let idx = 0; idx < draft.lines.length; idx++) {
      const line = draft.lines[idx];
      const lineNo = line.line_no || idx + 1;

      // Account checks
      if (!line.account_id) {
        violations.push({
          code: 'account_not_postable',
          line_no: lineNo,
          message: `Line ${lineNo} is missing an account.`,
        });
      } else {
        const account = context.accounts.find((a) => a.id === line.account_id);
        if (!account) {
          violations.push({
            code: 'account_not_postable',
            line_no: lineNo,
            message: `Account '${line.account_id}' does not exist.`,
          });
        } else {
          // Company scoping check
          if (account.company_id && draft.company_id && account.company_id !== draft.company_id) {
            violations.push({
              code: 'account_other_company',
              line_no: lineNo,
              message: `Account ${account.code} belongs to another company.`,
            });
          }

          // Header account check
          if (!account.is_postable) {
            violations.push({
              code: 'account_not_postable',
              line_no: lineNo,
              message: `Account ${account.code} (${account.name}) is a header account and cannot accept postings directly.`,
            });
          }

          // Inactive account check
          if (!account.is_active) {
            violations.push({
              code: 'account_inactive',
              line_no: lineNo,
              message: `Account ${account.code} (${account.name}) is inactive.`,
            });
          }

          // 0.4 Control account direct posting check: manual journals cannot post to AR/AP/bank
          const isManual = draft.journal_type === 'manual' || (!draft.journal_type && !draft.source_type);
          const isControl =
            ['ar', 'ap', 'bank'].includes(account.control_type) ||
            account.id === context.settings?.posting_accounts?.ar_control ||
            account.id === context.settings?.posting_accounts?.ap_control;

          if (isManual && isControl && !account.allow_manual_journals) {
            violations.push({
              code: 'control_account_direct',
              line_no: lineNo,
              message: `Direct manual postings to control account ${account.code} (${account.name}) are prohibited unless 'Allow manual journals' is enabled.`,
            });
          }

          // 0.4 Contact required on AR/AP accounts
          const isArAp =
            account.control_type === 'ar' ||
            account.control_type === 'ap' ||
            account.id === context.settings?.posting_accounts?.ar_control ||
            account.id === context.settings?.posting_accounts?.ap_control;

          if (isArAp && !line.contact_id && !draft.contact_id) {
            violations.push({
              code: 'contact_required',
              line_no: lineNo,
              message: `Contact (customer or supplier) is required for AR/AP account ${account.code} on line ${lineNo}.`,
            });
          }

          // Dimension rule: Branch is strictly required on Revenue and Expense accounts
          if (account.account_type === 'income' || account.account_type === 'expense') {
            if (!line.dimensions?.branch) {
              violations.push({
                code: 'dimension_required',
                line_no: lineNo,
                message: `Branch dimension is mandatory for income/expense account ${account.code} - ${account.name} (Line ${lineNo}).`,
              });
            }
          }
        }
      }

      // Currency check
      if (line.currency === '') {
        violations.push({
          code: 'currency_not_allowed',
          line_no: lineNo,
          message: `Currency is invalid or not allowed on line ${lineNo}.`,
        });
      }

      // FX rate check
      if (line.fx_rate !== undefined && line.fx_rate <= 0) {
        violations.push({
          code: 'fx_rate_missing',
          line_no: lineNo,
          message: `Exchange rate must be greater than zero on line ${lineNo}.`,
        });
      }

      // Line amount checks
      const debit = line.debit ?? 0;
      const credit = line.credit ?? 0;

      if (debit < 0 || credit < 0) {
        violations.push({
          code: 'amount_out_of_range',
          line_no: lineNo,
          message: `Negative debit or credit on line ${lineNo}. Use opposite column for reductions.`,
        });
      }

      if (debit > 0 && credit > 0) {
        violations.push({
          code: 'line_both_sides',
          line_no: lineNo,
          message: `Line ${lineNo} cannot have both debit and credit. One side must be zero.`,
        });
      }
    }

    // 0.5 Multi-currency balancing (D6)
    // 1. Every journal balances in base currency
    const totalDebit = draft.lines.reduce((s: number, l: any) => s + (l.debit || 0), 0);
    const totalCredit = draft.lines.reduce((s: number, l: any) => s + (l.credit || 0), 0);
    if (totalDebit !== totalCredit) {
      const diff = Math.abs(totalDebit - totalCredit);
      violations.push({
        code: 'journal_unbalanced',
        message: `Journal is out of balance by ${(diff / 100).toFixed(2)}. Total debits must equal total credits.`,
      });
    }

    // 2. If every line has the same non-base currency, foreign currency amounts must sum to 0
    const baseCurrency = (context.settings as any)?.base_currency || 'USD';
    const currencies = draft.lines.map((l: any) => l.currency || baseCurrency);
    const firstCurrency = currencies[0];
    const allSameCurrency = currencies.every((c: string) => c === firstCurrency);

    if (allSameCurrency && firstCurrency !== baseCurrency) {
      const sumFc = draft.lines.reduce((s: number, l: any) => {
        if (l.amount_fc !== undefined) return s + l.amount_fc;
        return s + (l.debit > 0 ? l.debit : -l.credit);
      }, 0);

      if (sumFc !== 0) {
        violations.push({
          code: 'journal_unbalanced_fc',
          message: `Foreign currency amounts (${firstCurrency}) must sum to 0 when all lines share the same currency. Variance: ${sumFc}.`,
        });
      }
    }
  }

  // If any violations collected, reject with complete RFC 9457 violations list
  if (violations.length > 0) {
    const primary = violations[0];
    throw new PostingError(primary.message, primary.code, 422, violations);
  }
}

/**
 * Central posting function that assigns gapless number, stamps audit, and finalises journal.
 */
export function executePostJournal(
  draft: any,
  context: PostingContext
): { journal: Journal; auditEvent: AuditEvent; nextSequence: number } {
  validateJournalDraft(draft, context);
  const periodId = draft.fiscal_period_id || draft.period_id;

  // 0.10 Sequential numbering: gapless per fiscal year (JV-FY2026-00001)
  const prefix = context.settings.numbering?.journal_prefix || 'JV-';
  const padding = context.settings.numbering?.padding || 5;
  const currentSeq = context.sequences.journal || 1;
  const nextSeq = currentSeq + 1;
  const journalNumber = `${prefix}FY2026-${String(currentSeq).padStart(padding, '0')}`;

  const now = new Date().toISOString();
  const journalId = draft.id || `jrn-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

  const totalDebit = draft.lines.reduce((s: number, l: any) => s + (l.debit || 0), 0);
  const totalCredit = draft.lines.reduce((s: number, l: any) => s + (l.credit || 0), 0);

  const finalJournal: Journal = {
    ...draft,
    id: journalId,
    tenant_id: draft.tenant_id || 'ten-acme',
    company_id: draft.company_id || 'co-1',
    fiscal_period_id: periodId,
    journal_type: draft.journal_type || 'manual',
    number: journalNumber,
    status: 'posted',
    journal_date: draft.journal_date || now.split('T')[0],
    posted_at: now,
    posted_by: context.currentUser.id,
    total_debit: totalDebit,
    total_credit: totalCredit,
    version: (draft.version || 0) + 1,
    lines: (draft.lines || []).map((l: any, idx: number) => ({
      ...l,
      id: l.id || `line-${idx + 1}`,
      line_no: idx + 1,
      currency: l.currency || 'USD',
      fx_rate: l.fx_rate || 1.0,
      amount_fc: l.amount_fc ?? (l.debit > 0 ? l.debit : -l.credit),
      dimensions: l.dimensions || {},
    })),
    created_at: draft.created_at || now,
    updated_at: now,
  };

  const prevHash = context.lastAuditEvent?.hash || '0000000000000000000000000000000000000000000000000000000000000000';
  const auditAction = 'journal.posted';
  const detail = `Posted journal ${journalNumber} (${(totalDebit / 100).toFixed(2)} USD) in period ${periodId}`;
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
 * Builds the balanced journal draft for a sales invoice (0.1, D1, D2).
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

  // 1. AR Control line = roundHalfUp(total_fc * rate) (D1)
  const baseTotal = roundHalfUp(invoice.total_fc * invoice.fx_rate);
  lines.push({
    id: `jl-inv-${invoice.id}-ar`,
    line_no: lineNo++,
    account_id: arAccountId,
    debit: baseTotal,
    credit: 0,
    currency: invoice.currency,
    fx_rate: invoice.fx_rate,
    amount_fc: invoice.total_fc,
    dimensions: invoice.lines[0]?.dimensions || {},
    description: `AR Control: ${invoice.number || 'Invoice'} - Contact Ref #${invoice.reference}`,
    contact_id: invoice.contact_id,
  });

  // 2. Revenue lines (Credit) = roundHalfUp(line_fc * rate) (D1)
  for (const invLine of invoice.lines) {
    const baseLineTotal = roundHalfUp(invLine.line_total_fc * invoice.fx_rate);
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
      description: invLine.description || `Revenue: ${invoice.number || 'Invoice'}`,
      contact_id: invoice.contact_id,
      tax_code_id: invLine.tax_code_id,
    });
  }

  // 3. Tax Output (Credit) = roundHalfUp(tax_fc * rate)
  const taxFc = invoice.tax_total_fc || invoice.tax_total || 0;
  if (taxFc > 0) {
    const baseTaxTotal = roundHalfUp(taxFc * invoice.fx_rate);
    lines.push({
      id: `jl-inv-${invoice.id}-tax`,
      line_no: lineNo++,
      account_id: taxOutputAccountId,
      debit: 0,
      credit: baseTaxTotal,
      currency: invoice.currency,
      fx_rate: invoice.fx_rate,
      amount_fc: -taxFc,
      dimensions: invoice.lines[0]?.dimensions || {},
      description: `Sales Tax Output: ${invoice.number || 'Invoice'}`,
      contact_id: invoice.contact_id,
    });
  }

  // 4. Residue line goes to rounding posting account (0.1, D1)
  const totalDebits = lines.reduce((s, l) => s + l.debit, 0);
  const totalCredits = lines.reduce((s, l) => s + l.credit, 0);
  if (totalDebits !== totalCredits) {
    const diff = totalDebits - totalCredits;
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
      description: `FX Rounding adjustment: ${invoice.number || 'Invoice'}`,
    });
  }

  return {
    tenant_id: invoice.tenant_id,
    company_id: invoice.company_id,
    fiscal_period_id: periodId,
    journal_type: 'sales',
    journal_date: invoice.issue_date,
    reference: invoice.number || invoice.reference,
    memo: `Sales invoice ${invoice.number || 'Draft'}: ${invoice.memo || ''}`,
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
 * Builds the balanced journal draft for a purchase bill (0.1, D1, D2).
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

  const whtAmountBase = bill.wht_amount_fc ? roundHalfUp(bill.wht_amount_fc * bill.fx_rate) : 0;
  const baseTotal = roundHalfUp(bill.total_fc * bill.fx_rate);
  const netApPayable = baseTotal - whtAmountBase;

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
      description: `WHT Withheld on Bill: ${bill.number || 'Bill'}`,
      contact_id: bill.contact_id,
    });
  }

  // 3. Expense lines (Debit)
  for (const bLine of bill.lines) {
    const baseLineTotal = roundHalfUp(bLine.line_total_fc * bill.fx_rate);
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
      description: bLine.description || `Expense: ${bill.number || 'Bill'}`,
      contact_id: bill.contact_id,
      tax_code_id: bLine.tax_code_id,
    });
  }

  // 4. Tax Input (Debit) if recoverable
  const taxFc = bill.tax_total_fc || bill.tax_total || 0;
  if (taxFc > 0) {
    const baseTaxTotal = roundHalfUp(taxFc * bill.fx_rate);
    lines.push({
      id: `jl-bill-${bill.id}-tax`,
      line_no: lineNo++,
      account_id: taxInputAccountId,
      debit: baseTaxTotal,
      credit: 0,
      currency: bill.currency,
      fx_rate: bill.fx_rate,
      amount_fc: taxFc,
      dimensions: bill.lines[0]?.dimensions || {},
      description: `Input VAT Recoverable: ${bill.number || 'Bill'}`,
      contact_id: bill.contact_id,
    });
  }

  // 5. Residue line goes to rounding posting account (0.1, D1)
  const totalDebits = lines.reduce((s, l) => s + l.debit, 0);
  const totalCredits = lines.reduce((s, l) => s + l.credit, 0);
  if (totalDebits !== totalCredits) {
    const diff = totalDebits - totalCredits;
    lines.push({
      id: `jl-bill-${bill.id}-round`,
      line_no: lineNo++,
      account_id: settings.posting_accounts.rounding,
      debit: diff < 0 ? Math.abs(diff) : 0,
      credit: diff > 0 ? diff : 0,
      currency: bill.currency,
      fx_rate: bill.fx_rate,
      amount_fc: 0,
      dimensions: bill.lines[0]?.dimensions || {},
      description: `FX Rounding adjustment: ${bill.number || 'Bill'}`,
    });
  }

  return {
    tenant_id: bill.tenant_id,
    company_id: bill.company_id,
    fiscal_period_id: periodId,
    journal_type: 'purchase',
    journal_date: bill.issue_date,
    reference: bill.number || bill.reference,
    memo: `Purchase bill ${bill.number || 'Draft'}: ${bill.memo || ''}`,
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
 * Builds the balanced journal draft for a settlement (Receipt or Payment) (0.8, D4).
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

    // Realised FX Gain / Loss if any (0.8, D4)
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

  // Ensure settlement journal balances in base currency
  const totalDebits = lines.reduce((s, l) => s + l.debit, 0);
  const totalCredits = lines.reduce((s, l) => s + l.credit, 0);
  if (totalDebits !== totalCredits) {
    const diff = totalDebits - totalCredits;
    lines.push({
      id: `jl-set-${settlement.id}-round`,
      line_no: lineNo++,
      account_id: settings.posting_accounts.rounding,
      debit: diff < 0 ? Math.abs(diff) : 0,
      credit: diff > 0 ? diff : 0,
      currency: settlement.currency,
      fx_rate: settlement.fx_rate,
      amount_fc: 0,
      dimensions: { branch: 'MG' },
      description: `Settlement rounding adjustment`,
    });
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
