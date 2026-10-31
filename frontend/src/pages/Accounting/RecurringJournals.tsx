import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLedgerStore } from '@/mock/store';
import { formatMoney, formatDate } from '@/lib/format';
import { FieldHelp } from '@/components/domain/FieldHelp';
import { Play } from 'lucide-react';
import { toast } from 'sonner';
import { MoreHorizontal, BookOpen, PauseCircle } from 'lucide-react';
import { PageHeader } from '@/components/domain/PageHeader';
import { cn } from '@/lib/utils';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

interface RecurringTemplate {
  id: string;
  name: string;
  frequency: 'monthly' | 'quarterly' | 'annual';
  postingDay: number;
  totalDebit: number;
  totalCredit: number;
  lines: Array<{
    accountCode: string;
    accountName: string;
    debit: number;
    credit: number;
    branch: string;
  }>;
  lastRunDate?: string;
}

interface PrepaymentSchedule {
  id: string;
  title: string;
  type: 'prepayment' | 'accrual';
  totalAmount: number;
  amortizedAmount: number;
  monthlyAmount: number;
  startDate: string;
  endDate: string;
  periodsTotal: number;
  periodsRecognized: number;
  expenseAccount: string;
  balanceSheetAccount: string;
  status: 'active' | 'completed';
}

export const RecurringJournals: React.FC = () => {
  const navigate = useNavigate();
  const { currentCompany, currentUser, companySettings, postJournalDirect } = useLedgerStore();
  const coSlug = currentCompany.slug;

  const [activeTab, setActiveTab] = useState<'recurring' | 'schedules'>('recurring');

  const [templates, setTemplates] = useState<RecurringTemplate[]>([
    {
      id: 'rec-1',
      name: 'Mogadishu Central Office Rent Accrual',
      frequency: 'monthly',
      postingDay: 1,
      totalDebit: 200000,
      totalCredit: 200000,
      lastRunDate: '2026-09-01',
      lines: [
        { accountCode: '6100', accountName: 'Rent & Occupancy', debit: 200000, credit: 0, branch: 'MG' },
        { accountCode: '2050', accountName: 'Accrued Rent Liabilities', debit: 0, credit: 200000, branch: 'MG' },
      ],
    },
    {
      id: 'rec-2',
      name: 'Telecom Transmission Tower Depreciation',
      frequency: 'monthly',
      postingDay: 28,
      totalDebit: 125000,
      totalCredit: 125000,
      lastRunDate: '2026-09-28',
      lines: [
        { accountCode: '6500', accountName: 'Depreciation Expense', debit: 125000, credit: 0, branch: 'MG' },
        { accountCode: '1510', accountName: 'Accumulated Depreciation', debit: 0, credit: 125000, branch: 'MG' },
      ],
    },
    {
      id: 'rec-3',
      name: 'Cloud Infrastructure & Fiber Maintenance',
      frequency: 'monthly',
      postingDay: 15,
      totalDebit: 85000,
      totalCredit: 85000,
      lastRunDate: '2026-09-15',
      lines: [
        { accountCode: '6200', accountName: 'IT & Software Subscriptions', debit: 85000, credit: 0, branch: 'MG' },
        { accountCode: '2000', accountName: 'Accounts Payable Clearing', debit: 0, credit: 85000, branch: 'MG' },
      ],
    },
  ]);

  const [schedules, setSchedules] = useState<PrepaymentSchedule[]>([
    {
      id: 'sch-1',
      title: 'Commercial Property & Asset All-Risk Insurance',
      type: 'prepayment',
      totalAmount: 1200000, // $12,000.00
      amortizedAmount: 400000, // $4,000.00
      monthlyAmount: 100000, // $1,000.00
      startDate: '2026-07-01',
      endDate: '2027-06-30',
      periodsTotal: 12,
      periodsRecognized: 4,
      expenseAccount: '6250 — Insurance Expense',
      balanceSheetAccount: '1400 — Prepaid Insurance',
      status: 'active',
    },
    {
      id: 'sch-2',
      title: 'Oracle ERP Annual Cloud Enterprise Support',
      type: 'prepayment',
      totalAmount: 2400000, // $24,000.00
      amortizedAmount: 1600000, // $16,000.00
      monthlyAmount: 200000, // $2,000.00
      startDate: '2026-03-01',
      endDate: '2027-02-28',
      periodsTotal: 12,
      periodsRecognized: 8,
      expenseAccount: '6200 — Software & Licensing',
      balanceSheetAccount: '1410 — Prepaid IT Subscriptions',
      status: 'active',
    },
    {
      id: 'sch-3',
      title: 'Annual Statutory Audit & Compliance Fee Accrual',
      type: 'accrual',
      totalAmount: 600000, // $6,000.00
      amortizedAmount: 400000, // $4,000.00
      monthlyAmount: 100000, // $1,000.00
      startDate: '2026-07-01',
      endDate: '2026-12-31',
      periodsTotal: 6,
      periodsRecognized: 4,
      expenseAccount: '6300 — Audit & Professional Fees',
      balanceSheetAccount: '2060 — Accrued Audit Fees',
      status: 'active',
    },
  ]);

  const handleGenerateDrafts = () => {
    toast.success(`Created ${templates.length} draft journals for October from your repeating entries`, {
      action: {
        label: 'View journals',
        onClick: () => navigate(`/${coSlug}/journals`),
      },
    });
  };

  const handleRecognizeMonthlyAmortization = (schId: string) => {
    const sch = schedules.find((s) => s.id === schId);
    if (!sch) return;

    // Post balanced amortization journal entry
    const jDraft = {
      journal_date: '2026-10-28',
      fiscal_period_id: 'per-2026-10',
      source_type: 'accrual_amortization',
      reference: `AMORT-OCT-${sch.id}`,
      memo: `Monthly Amortization: ${sch.title} (Period ${sch.periodsRecognized + 1}/${sch.periodsTotal})`,
      lines: [
        {
          id: `line-amort-1-${Date.now()}`,
          line_no: 1,
          account_id: 'acc-6250',
          description: `Monthly amortization recognition: ${sch.title}`,
          debit: sch.monthlyAmount,
          credit: 0,
          dimensions: { branch: 'MG' },
        },
        {
          id: `line-amort-2-${Date.now()}`,
          line_no: 2,
          account_id: 'acc-1400',
          description: `Prepayment write-down: ${sch.title}`,
          debit: 0,
          credit: sch.monthlyAmount,
          dimensions: { branch: 'MG' },
        },
      ],
    };

    postJournalDirect(jDraft, currentUser, companySettings);

    setSchedules((prev) =>
      prev.map((s) =>
        s.id === schId
          ? {
              ...s,
              amortizedAmount: s.amortizedAmount + s.monthlyAmount,
              periodsRecognized: s.periodsRecognized + 1,
            }
          : s
      )
    );

    toast.success(
      `Posted ${formatMoney(sch.monthlyAmount)} for ${sch.title}`,
      {
        action: {
          label: 'View journal',
          onClick: () => navigate(`/${coSlug}/journals`),
        },
      }
    );
  };

  const MoreMenu: React.FC<{ onRun: () => void; runLabel: string }> = ({ onRun, runLabel }) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label="More actions" className="flex size-8 items-center justify-center rounded-md text-text-muted transition hover:bg-surface-neutral hover:text-text-primary">
          <MoreHorizontal className="size-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem onSelect={onRun}>
          <Play className="size-4 text-text-muted" /> {runLabel}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => navigate(`/${coSlug}/journals`)}>
          <BookOpen className="size-4 text-text-muted" /> View journals
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Repeating entries"
        subtitle="Set up entries you make every month, and spread big costs over the months they cover."
        actions={
          activeTab === 'recurring' ? (
            <button type="button" onClick={handleGenerateDrafts} className="flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-[13px] font-medium text-white transition hover:bg-accent-hover">
              Create October drafts
            </button>
          ) : undefined
        }
      />

      <div className="flex items-center gap-1 border-b border-border" role="tablist">
        {([
          ['recurring', `Repeating entries (${templates.length})`],
          ['schedules', `Spread costs (${schedules.length})`],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={activeTab === key}
            onClick={() => setActiveTab(key)}
            className={cn(
              '-mb-px flex items-center gap-2 border-b-2 px-4 py-2 text-[13px] font-medium transition-colors',
              activeTab === key ? 'border-accent text-accent' : 'border-transparent text-text-muted hover:text-text-primary'
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {activeTab === 'recurring' && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {templates.map((tpl) => (
            <div key={tpl.id} className="flex flex-col justify-between gap-4 rounded-lg border border-border bg-surface p-5 transition hover:border-border-strong">
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="rounded-[3px] bg-surface-neutral px-1.5 py-px text-xs font-medium capitalize text-text-secondary">
                    {tpl.frequency}, day {tpl.postingDay}
                  </span>
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-text-muted">Last run {formatDate(tpl.lastRunDate || '')}</span>
                    <MoreMenu runLabel="Create draft now" onRun={() => toast.success(`Draft created for ${tpl.name}`)} />
                  </div>
                </div>
                <h3 className="text-sm font-semibold text-text-primary">{tpl.name}</h3>
                <div className="mt-1 overflow-hidden rounded-md border border-border">
                  <table className="w-full text-left text-xs">
                    <tbody className="divide-y divide-border tabular-nums">
                      {tpl.lines.map((l, idx) => (
                        <tr key={idx}>
                          <td className="truncate px-3 py-2">
                            <span className="text-text-primary">{l.accountName}</span> <span className="text-text-muted">{l.accountCode}</span>
                          </td>
                          <td className="px-3 py-2 text-right text-text-primary">{l.debit > 0 ? formatMoney(l.debit) : ''}</td>
                          <td className="px-3 py-2 text-right text-text-muted">{l.credit > 0 ? formatMoney(l.credit) : ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              <div className="flex items-center justify-between border-t border-border pt-3">
                <span className="text-base font-medium tabular-nums text-text-primary">{formatMoney(tpl.totalDebit)}</span>
                <button
                  type="button"
                  onClick={() => toast.success(`Draft created for ${tpl.name}`)}
                  className="h-8 rounded-md border border-border bg-surface px-3 text-[13px] font-medium text-text-primary transition hover:bg-surface-neutral"
                >
                  Create draft
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {activeTab === 'schedules' && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {schedules.map((sch) => {
            const remaining = sch.totalAmount - sch.amortizedAmount;
            const progressPct = Math.round((sch.amortizedAmount / sch.totalAmount) * 100);
            return (
              <div key={sch.id} className="flex flex-col justify-between gap-4 rounded-lg border border-border bg-surface p-5 transition hover:border-border-strong">
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <span className={'rounded-[3px] bg-surface-neutral px-1.5 py-px text-xs font-medium text-text-secondary'}>
                      {sch.type === 'prepayment' ? 'Paid in advance' : 'Owed, not billed yet'}
                    </span>
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-text-muted">
                        {sch.periodsRecognized} of {sch.periodsTotal} months
                      </span>
                      <MoreMenu runLabel="Record this month" onRun={() => handleRecognizeMonthlyAmortization(sch.id)} />
                    </div>
                  </div>
                  <h3 className="text-sm font-semibold text-text-primary">{sch.title}</h3>
                  <div className="text-xs text-text-muted">
                    {sch.expenseAccount} <span className="mx-1">/</span> {sch.balanceSheetAccount}
                  </div>
                  <div className="mt-2">
                    <div className="mb-1.5 flex justify-between text-xs text-text-muted">
                      <span>{progressPct}% recorded</span>
                      <span className="tabular-nums">{formatMoney(remaining)} to go</span>
                    </div>
                    <div className="h-1 overflow-hidden rounded-[1px] bg-surface-neutral">
                      <div className="h-full rounded-[1px] bg-accent" style={{ width: `${progressPct}%` }} />
                    </div>
                  </div>
                </div>
                <div className="flex items-center justify-between border-t border-border pt-3">
                  <div>
                    <div className="text-xs text-text-muted">Each month</div>
                    <div className="text-base font-medium tabular-nums text-text-primary">{formatMoney(sch.monthlyAmount)}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRecognizeMonthlyAmortization(sch.id)}
                    className="h-8 rounded-md bg-accent px-3 text-[13px] font-medium text-white transition hover:bg-accent-hover"
                  >
                    Record October
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
