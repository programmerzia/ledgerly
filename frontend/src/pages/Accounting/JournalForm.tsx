import React, { useState, useEffect, useMemo } from 'react';
import { PageHeader } from '@/components/domain/PageHeader';
import { useNavigate, useLocation } from 'react-router-dom';
import { api } from '@/mock/api';
import { useLedgerStore } from '@/mock/store';
import { LineGrid, GridLineItem } from '@/components/domain/LineGrid';
import { FieldHelp } from '@/components/domain/FieldHelp';
import { DisabledTooltip } from '@/components/domain/DisabledTooltip';
import { ConsequenceDialog, ConsequenceAccountingLine } from '@/components/domain/ConsequenceDialog';
import { formatMoney } from '@/lib/format';
import { Send, AlertTriangle, ShieldAlert, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';

export const JournalForm: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { currentCompany, accounts, dimensions, fiscalYear } = useLedgerStore();
  const coSlug = currentCompany.slug;

  const [journalDate, setJournalDate] = useState('2026-10-28');
  const [explicitPeriodId, setExplicitPeriodId] = useState<string>('');
  const [reference, setReference] = useState('ADJ-OCT-REALLOC');
  const [memo, setMemo] = useState('Monthly departmental expense reallocation');
  const [errorMessage, setErrorMessage] = useState('');
  const [headerViolations, setHeaderViolations] = useState<Array<{ code: string; message: string }>>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showConsequence, setShowConsequence] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);

  // Autosave timer
  const [lastSavedSeconds, setLastSavedSeconds] = useState(2);
  useEffect(() => {
    const timer = setInterval(() => {
      setLastSavedSeconds((prev) => (prev < 60 ? prev + 1 : 1));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Initial balanced sample lines ($250.00 Dr / $250.00 Cr)
  const [lines, setLines] = useState<GridLineItem[]>([
    {
      id: 'jl-1',
      line_no: 1,
      account_id: 'acc-6200', // Utilities
      description: 'Mogadishu Office Internet Connectivity Allocation',
      debit: 25000, // $250.00
      credit: 0,
      dimensions: { branch: 'MG', cost_centre: 'ADMIN' },
    },
    {
      id: 'jl-2',
      line_no: 2,
      account_id: 'acc-1010', // Premier Bank USD
      description: 'Direct Debit Clearing',
      debit: 0,
      credit: 25000, // $250.00
      dimensions: { branch: 'MG', cost_centre: 'ADMIN' },
    },
  ]);

  const totalDebit = lines.reduce((s, l) => s + (l.debit || 0), 0);
  const totalCredit = lines.reduce((s, l) => s + (l.credit || 0), 0);
  const difference = totalDebit - totalCredit;
  const isBalanced = difference === 0 && totalDebit > 0;

  // Resolve period: explicit selection wins; otherwise resolve from date
  const autoResolvedPeriod = fiscalYear.periods.find(
    (p: any) => journalDate >= p.starts_on && journalDate <= p.ends_on && p.kind !== 'adjustment'
  );
  const selectedPeriod = explicitPeriodId
    ? fiscalYear.periods.find((p: any) => p.id === explicitPeriodId) || autoResolvedPeriod
    : autoResolvedPeriod;

  const isPeriodClosed = selectedPeriod && selectedPeriod.status !== 'open';

  const accountsMap = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);

  const accountingPreviewLines: ConsequenceAccountingLine[] = lines.map((l) => {
    const acc = accountsMap.get(l.account_id);
    return {
      accountCode: acc?.code || l.account_id,
      accountName: acc?.name || l.description,
      debit: l.debit || 0,
      credit: l.credit || 0,
    };
  });

  const disabledReason = isPeriodClosed
    ? `Posting blocked: Fiscal period ${selectedPeriod?.name} is Closed`
    : !isBalanced
    ? `Debits must equal credits (${formatMoney(Math.abs(difference))} variance)`
    : undefined;

  // 0.3 Switch on code (never message text)
  const getViolationText = (code: string, fallback?: string): string => {
    switch (code) {
      case 'journal_empty':
        return 'Journal must contain at least 2 balanced lines.';
      case 'amount_out_of_range':
        return 'Amounts must be non-negative. Use the opposite column for reductions.';
      case 'line_both_sides':
        return 'A line cannot have both a debit and a credit amount.';
      case 'account_other_company':
        return 'The selected account belongs to another company entity.';
      case 'account_not_postable':
        return 'Header/summary accounts cannot receive direct postings.';
      case 'account_inactive':
        return 'The selected account is inactive.';
      case 'currency_not_allowed':
        return 'The currency is not permitted by this account policy.';
      case 'fx_rate_missing':
        return 'Exchange rate must be positive and non-zero.';
      case 'control_account_direct':
        return "Direct manual postings to control accounts (AR/AP/Bank) are prohibited unless 'Allow manual journals' is enabled.";
      case 'contact_required':
        return 'A customer or supplier contact is required for postings to AR/AP control accounts.';
      case 'dimension_required':
        return 'Branch dimension is mandatory for revenue and expense lines.';
      case 'dimension_forbidden':
        return 'Dimension not permitted on this account.';
      case 'dimension_value_invalid':
        return 'Dimension value is invalid or belongs to another company.';
      case 'dimension_inactive':
        return 'Selected dimension value is inactive.';
      case 'journal_unbalanced':
        return 'Journal is out of balance. Debits must equal credits in base currency.';
      case 'journal_unbalanced_fc':
        return 'Foreign currency amounts must sum to zero when all lines share the same currency.';
      case 'period_missing':
        return 'Accounting period could not be resolved.';
      case 'date_outside_period':
        return 'Journal date falls outside the selected fiscal period.';
      case 'period_soft_closed':
        return 'Period is soft-closed. Posting requires Finance Manager or Owner authorization.';
      case 'period_closed':
        return 'Period is closed. Ledger postings to closed periods are blocked.';
      case 'period_adjustment_only':
        return 'Period FY2026 Adj only accepts closing and adjustment journals.';
      case 'period_adjustment_forbidden':
        return 'Adjustment period posting requires periods.post_adjustment permission.';
      case 'reversal_before_original':
        return 'Reversal date cannot be earlier than original journal date.';
      case 'version_conflict':
        return 'Document was modified in another tab or session (version conflict).';
      default:
        return fallback || code;
    }
  };

  const handleOpenConsequence = () => {
    setSubmitAttempted(true);
    setErrorMessage('');
    setHeaderViolations([]);
    if (isPeriodClosed) {
      setErrorMessage(
        `${selectedPeriod?.name} is ${selectedPeriod?.status}, so nothing can be posted to it.`
      );
      return;
    }
    if (!isBalanced) {
      setErrorMessage(
        `Debits and credits must match. Out of balance by ${formatMoney(
          Math.abs(difference)
        )}.`
      );
      return;
    }
    setShowConsequence(true);
  };

  const handleConfirmPost = async () => {
    try {
      setIsSubmitting(true);
      setShowConsequence(false);
      setHeaderViolations([]);
      setLines((prev) => prev.map((l) => ({ ...l, errors: undefined })));

      const isAdj = selectedPeriod?.kind === 'adjustment';

      const journal = await api.createJournal({
        fiscal_period_id: selectedPeriod?.id,
        period_id: selectedPeriod?.id,
        journal_date: journalDate,
        reference,
        memo,
        journal_type: isAdj ? 'adjustment' : 'manual',
        total_debit: totalDebit,
        total_credit: totalCredit,
        lines: lines.map((l) => ({
          id: l.id,
          line_no: l.line_no,
          account_id: l.account_id,
          description: l.description,
          debit: l.debit || 0,
          credit: l.credit || 0,
          currency: 'USD',
          fx_rate: 1.0,
          amount_fc: (l.debit || 0) + (l.credit || 0),
          dimensions: l.dimensions,
        })),
      });

      toast.success(`Journal ${journal.number} posted successfully`);
      navigate(`/${coSlug}/journals/${journal.id}`);
    } catch (err: any) {
      const violations = err.violations || (err.code ? [{ code: err.code, message: err.message }] : []);
      if (violations.length > 0) {
        const headers: Array<{ code: string; message: string }> = [];
        const lineErrMap = new Map<number, Record<string, string>>();

        for (const v of violations) {
          const userMsg = getViolationText(v.code, v.message);
          if (v.line_no) {
            const current = lineErrMap.get(v.line_no) || {};
            current[v.code] = userMsg;
            lineErrMap.set(v.line_no, current);
          } else {
            headers.push({ code: v.code, message: userMsg });
          }
        }

        if (lineErrMap.size > 0) {
          setLines((prev) =>
            prev.map((l) => {
              const errs = lineErrMap.get(l.line_no);
              return errs ? { ...l, errors: errs } : l;
            })
          );
        }

        setHeaderViolations(headers);
        setErrorMessage(
          headers.length > 0
            ? headers[0].message
            : `Validation failed with ${violations.length} error(s). Review highlighted lines below.`
        );
      } else {
        setErrorMessage(err.message || 'Failed to post journal');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        breadcrumb={[{ label: 'Journals', to: `/${coSlug}/journals` }, { label: 'New journal' }]}
        title="New manual journal"
        subtitle={`Draft · Saved ${lastSavedSeconds < 5 ? 'just now' : `${lastSavedSeconds}s ago`}`}
        actions={
          <DisabledTooltip disabled={isSubmitting || !isBalanced || isPeriodClosed} reason={disabledReason}>
            <button
              type="button"
              onClick={handleOpenConsequence}
              disabled={isSubmitting || !isBalanced || isPeriodClosed}
              className="flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-[13px] font-medium text-white transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Send className="size-4" />
              <span>Post journal</span>
            </button>
          </DisabledTooltip>
        }
      />

      {/* Blocked Period Warning Banner */}
      {isPeriodClosed && (
        <div className="p-4 bg-danger-soft text-danger border border-danger/40 rounded-lg text-xs flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <ShieldAlert className="w-5 h-5 shrink-0" />
            <div>
              <div className="font-semibold">You cannot post here: {selectedPeriod?.name} is closed</div>
              <div className="text-[11px] opacity-90 mt-0.5">
                Closed months cannot be changed. Ask to reopen it, which needs approval from two people.
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() =>
              navigate(`/${coSlug}/periods`, {
                state: { returnTo: location.pathname, periodId: selectedPeriod?.id },
              })
            }
            className="h-8 px-3 bg-surface border border-danger text-danger hover:bg-danger hover:text-white rounded-md text-[13px] font-medium transition shrink-0 ml-4 cursor-pointer"
          >
            Ask to reopen
          </button>
        </div>
      )}

      {/* Multi-Violation Banner (0.3) */}
      {submitAttempted && (headerViolations.length > 0 || (errorMessage && !isPeriodClosed)) && (
        <div className="p-3 bg-danger-soft text-danger border border-danger/30 rounded-lg text-xs font-medium flex flex-col gap-1.5">
          {headerViolations.length > 0 ? (
            headerViolations.map((v, i) => (
              <div key={i} className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 text-danger" />
                <span>
                  <strong className="font-mono uppercase font-semibold text-[10px] mr-1.5 px-1 bg-danger/10 rounded">
                    {v.code}
                  </strong>
                  {v.message}
                </span>
              </div>
            ))
          ) : (
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 text-danger" />
              <span>{errorMessage}</span>
            </div>
          )}
        </div>
      )}

      {/* Header Fields: Date, Reference, Period */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 p-5 bg-surface border border-border rounded-lg">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-text-secondary flex items-center justify-between">
            <span className="flex items-center">
              Journal date
              <FieldHelp
                help="Posting date determining the fiscal accounting period."
                example="2026-10-28"
              />
            </span>
            <span
              role="button"
              tabIndex={0}
              onClick={() => {
                setJournalDate('2026-09-15');
                setExplicitPeriodId('');
              }}
              className="text-[11px] text-accent cursor-pointer hover:underline"
            >
              Use previous period
            </span>
          </label>
          <input
            type="date"
            value={journalDate}
            onChange={(e) => setJournalDate(e.target.value)}
            className="h-8 px-2.5 bg-surface border border-border rounded-md text-xs text-text-primary focus:outline-none focus:border-accent"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-text-secondary flex items-center">
            Accounting period
            <FieldHelp
              help="Period resolved from date by default. FY2026 Adj must be chosen explicitly."
              example="FY2026 Adj"
            />
          </label>
          <select
            value={explicitPeriodId || ''}
            onChange={(e) => setExplicitPeriodId(e.target.value)}
            className="h-8 px-2 bg-surface border border-border rounded-md text-xs text-text-primary focus:outline-none focus:border-accent"
          >
            <option value="">
              Auto ({autoResolvedPeriod?.name || 'From Date'})
            </option>
            {fiscalYear.periods.map((p: any) => (
              <option key={p.id} value={p.id}>
                {p.name} {p.kind === 'adjustment' ? '★ (Period 13 Adj)' : `(${p.status})`}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-text-secondary flex items-center">
            Reference
            <FieldHelp
              help="Audit voucher reference for internal adjustment tracking."
              example="ADJ-OCT-REALLOC"
            />
          </label>
          <input
            type="text"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder="e.g. ADJ-OCT-REALLOC"
            className="h-8 px-2.5 bg-surface border border-border rounded-md text-xs text-text-primary focus:outline-none focus:border-accent"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-text-secondary flex items-center">
            Currency
            <FieldHelp help="Journals are posted in the company base currency." example="USD" />
          </label>
          <div className="h-8 px-2.5 bg-surface-neutral border border-border rounded-md text-xs flex items-center whitespace-nowrap text-text-secondary">
            {currentCompany.base_currency} · base currency
          </div>
        </div>

        <div className="flex flex-col gap-1 md:col-span-4">
          <label className="text-xs font-medium text-text-secondary flex items-center">
            Memo
            <FieldHelp
              help="Mandatory audit explanation justifying the manual debit/credit reallocation."
              example="Monthly departmental expense reallocation"
            />
          </label>
          <input
            type="text"
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            placeholder="Explain why this entry is needed"
            className="h-8 px-2.5 bg-surface border border-border rounded-md text-xs text-text-primary focus:outline-none focus:border-accent"
          />
        </div>
      </div>

      {/* Line Grid with live balancing pill */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-text-primary">
            Lines
          </span>
          <span className="text-[11px] text-text-muted">
            Tab to move between fields · ⌘ Enter adds a line
          </span>
        </div>

        <LineGrid
          mode="journal"
          lines={lines}
          onChange={setLines}
          accounts={accounts}
          dimensions={dimensions}
          currency="USD"
          showTotals={false}
        />

        <div className="flex items-center justify-end gap-2 text-xs text-text-secondary pt-1">
          <span>
            Debits <span className="tabular-nums text-text-primary">{formatMoney(totalDebit)}</span>
          </span>
          <span className="text-text-muted">·</span>
          <span>
            Credits <span className="tabular-nums text-text-primary">{formatMoney(totalCredit)}</span>
          </span>
          <span className="text-text-muted">·</span>
          {isBalanced ? (
            <span className="flex items-center gap-1 text-success font-medium">
              <CheckCircle2 className="w-3.5 h-3.5" />
              Balanced
            </span>
          ) : (
            <span className="text-danger font-medium">Out of balance by {formatMoney(Math.abs(difference))}</span>
          )}
        </div>
      </div>

      {/* Consequence Modal */}
      <ConsequenceDialog
        isOpen={showConsequence}
        onClose={() => setShowConsequence(false)}
        onConfirm={handleConfirmPost}
        title="Post manual journal"
        actionType="post"
        plainLanguageEffect={`This will immediately post ${lines.length} balanced lines to ${selectedPeriod?.name || 'Oct 2026'}, debiting accounts for ${formatMoney(totalDebit)} and crediting accounts for ${formatMoney(totalCredit)}. Posted journals can't be edited, only reversed.`}
        accountingLines={accountingPreviewLines}
        confirmLabel="Post journal"
        isSubmitting={isSubmitting}
      />
    </div>
  );
};
