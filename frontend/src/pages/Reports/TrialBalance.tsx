import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, Copy, ExternalLink } from 'lucide-react';
import { useLedgerStore } from '@/mock/store';
import { formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';
import { ReportShell, defaultReportParameters, useSelectedPeriod, type ReportParameters } from './ReportShell';
import { CheckBadge, ReportCard, moneyFmt, longDate } from './ReportParts';
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from '@/components/ui/context-menu';
import { toast } from 'sonner';

const GROUPS = [
  { type: 'asset', title: 'Assets' },
  { type: 'liability', title: 'Liabilities' },
  { type: 'equity', title: 'Equity' },
  { type: 'income', title: 'Income' },
  { type: 'expense', title: 'Expenses' },
] as const;

const GRID = 'grid grid-cols-[1fr_8rem_8rem] gap-3';

export const TrialBalance: React.FC = () => {
  const navigate = useNavigate();
  const { currentCompany, trialBalance, journals } = useLedgerStore();
  const cur = currentCompany.base_currency;
  const money = moneyFmt(cur);
  const [parameters, setParameters] = useState<ReportParameters>({ ...defaultReportParameters(), hideZeroRows: true });
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const period = useSelectedPeriod(parameters.periodTo);

  const tb = useMemo(
    () => trialBalance(undefined, period?.ends_on),
    // journals changes whenever postings change
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [trialBalance, period?.ends_on, journals]
  );

  const rows = tb.rows.filter((r) => !parameters.hideZeroRows || r.closingDebit !== 0 || r.closingCredit !== 0);
  const diff = tb.totalDebit - tb.totalCredit;
  const go = (code: string) => navigate(`/${currentCompany.slug}/reports/general-ledger?account=${code}`);
  const cell = (n: number) => (n === 0 ? <span className="text-text-muted">—</span> : money(n));

  return (
    <ReportShell
      title="Trial balance"
      asOfMode
      parameters={parameters}
      onParametersChange={setParameters}
      toolbar={
        <CheckBadge
          ok={diff === 0}
          okLabel="Debits equal credits"
          badLabel={`Out of balance by ${formatMoney(Math.abs(diff), cur)}`}
        />
      }
    >
      <ReportCard>
        <div className="min-w-[520px]">
          <div className={`${GRID} px-2 pb-2 border-b border-border text-[11px] font-semibold text-text-muted`}>
            <span>Account</span>
            <span className="text-right">Debit</span>
            <span className="text-right">Credit</span>
          </div>

          {GROUPS.map((g) => {
            const list = rows.filter((r) => r.account.account_type === g.type);
            if (list.length === 0) return null;
            const open = !collapsed[g.type];
            const dr = list.reduce((s, r) => s + r.closingDebit, 0);
            const cr = list.reduce((s, r) => s + r.closingCredit, 0);
            return (
              <div key={g.type} className="flex flex-col">
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() => setCollapsed((c) => ({ ...c, [g.type]: open }))}
                  className={`${GRID} items-baseline px-2 pt-4 pb-1 text-[13px] font-semibold text-text-primary text-left cursor-pointer`}
                >
                  <span className="flex items-center gap-1.5">
                    <ChevronRight className={cn('size-3.5 text-text-muted transition-transform', open && 'rotate-90')} />
                    {g.title}
                    <span className="font-normal text-xs text-text-muted">{list.length} accounts</span>
                  </span>
                  {!open ? (
                    <>
                      <span className="text-right font-mono tabular-nums">{cell(dr)}</span>
                      <span className="text-right font-mono tabular-nums">{cell(cr)}</span>
                    </>
                  ) : (
                    <><span /><span /></>
                  )}
                </button>
                {open && (
                  <div className="divide-y divide-border/60">
                    {list.map((r) => (
                      <ContextMenu key={r.account.id}>
                        <ContextMenuTrigger asChild>
                          <div
                            role="link"
                            tabIndex={0}
                            onClick={() => go(r.account.code)}
                            onKeyDown={(e) => e.key === 'Enter' && go(r.account.code)}
                            title="View transactions"
                            className={`${GRID} items-baseline px-2 py-1.5 text-xs cursor-pointer hover:bg-accent-soft/40 rounded-md group focus-visible:outline-2 outline-accent`}
                          >
                            <span className="text-text-primary group-hover:text-accent group-hover:underline">
                              <span className="font-mono text-text-muted mr-2">{r.account.code}</span>
                              {r.account.name}
                            </span>
                            <span className="text-right font-mono tabular-nums text-text-primary">{cell(r.closingDebit)}</span>
                            <span className="text-right font-mono tabular-nums text-text-primary">{cell(r.closingCredit)}</span>
                          </div>
                        </ContextMenuTrigger>
                        <ContextMenuContent>
                          <ContextMenuItem onClick={() => go(r.account.code)}>
                            <ExternalLink className="size-4 text-text-muted" />
                            <span>View transactions</span>
                          </ContextMenuItem>
                          <ContextMenuSeparator />
                          <ContextMenuItem
                            onClick={() => {
                              navigator.clipboard?.writeText(r.account.code);
                              toast.success('Account code copied');
                            }}
                          >
                            <Copy className="size-4 text-text-muted" />
                            <span>Copy account code</span>
                          </ContextMenuItem>
                        </ContextMenuContent>
                      </ContextMenu>
                    ))}
                  </div>
                )}
                {open && (
                  <div className={`${GRID} items-baseline px-2 py-2 border-t border-border text-[13px] font-semibold`}>
                    <span className="text-text-primary">Total {g.title.toLowerCase()}</span>
                    <span className="text-right font-mono tabular-nums">{cell(dr)}</span>
                    <span className="text-right font-mono tabular-nums">{cell(cr)}</span>
                  </div>
                )}
              </div>
            );
          })}

          <div className={`${GRID} items-baseline px-2 py-3 mt-2 border-y-2 border-border bg-surface-neutral/50 text-sm font-semibold`}>
            <span className="text-text-primary">
              Total
              <span className="ml-2 font-normal text-xs text-text-muted">
                {period ? `as of ${longDate(period.ends_on)}` : ''}
              </span>
            </span>
            <span className="text-right font-mono tabular-nums">{money(tb.totalDebit)}</span>
            <span className="text-right font-mono tabular-nums">{money(tb.totalCredit)}</span>
          </div>
          {diff !== 0 && (
            <div className="mt-3 flex justify-between px-2 text-xs font-semibold text-danger" role="alert">
              <span>Difference (debits less credits)</span>
              <span className="font-mono tabular-nums">{money(diff)}</span>
            </div>
          )}
        </div>
      </ReportCard>
    </ReportShell>
  );
};
