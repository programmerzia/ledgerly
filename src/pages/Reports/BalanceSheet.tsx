import React, { useState, useMemo } from 'react';
import { useLedgerStore } from '@/mock/store';
import { ReportShell, ReportParameters } from './ReportShell';
import { formatMoney } from '@/lib/format';
import { DrillDownDrawer } from '@/components/domain/DrillDownDrawer';
import { Account, JournalLine } from '@/types';
import { Layers, ArrowRight, ShieldCheck, ChevronRight, Copy, ExternalLink } from 'lucide-react';
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from '@/components/ui/context-menu';

export const BalanceSheet: React.FC = () => {
  const { currentCompany, accounts, balanceOf, movements, openTab } = useLedgerStore();
  const coSlug = currentCompany.slug;

  const [parameters, setParameters] = useState<ReportParameters>({
    periodFrom: 'per-2026-01',
    periodTo: 'per-2026-10',
    comparison: 'none',
    pivotDimension: 'none',
    hideZeroRows: false,
    presentationCurrency: 'USD',
    levelOfDetail: 'summary',
  });

  // Drilldown state
  const [drillDownAccount, setDrillDownAccount] = useState<Account | null>(null);

  const assetAccounts = useMemo(() => accounts.filter((a) => a.account_type === 'asset'), [accounts]);
  const liabilityAccounts = useMemo(() => accounts.filter((a) => a.account_type === 'liability'), [accounts]);
  const equityAccounts = useMemo(() => accounts.filter((a) => a.account_type === 'equity'), [accounts]);

  // Dynamic balance helper with branch dimension support
  const getBal = (accId: string, branch?: string) => {
    return balanceOf(accId, undefined, branch ? { branch } : undefined);
  };

  const isPivotBranch = parameters.pivotDimension === 'branch';

  // Compute Asset Totals
  const assetRows = useMemo(() => {
    return assetAccounts
      .map((acc) => {
        const total = getBal(acc.id);
        const mg = isPivotBranch ? getBal(acc.id, 'MG') : 0;
        const hr = isPivotBranch ? getBal(acc.id, 'HR') : 0;
        return { acc, total, mg, hr };
      })
      .filter((r) => !parameters.hideZeroRows || r.total !== 0);
  }, [assetAccounts, balanceOf, isPivotBranch, parameters.hideZeroRows]);

  const totalAssets = assetRows.reduce((s, r) => s + r.total, 0);
  const totalAssetsMg = assetRows.reduce((s, r) => s + r.mg, 0);
  const totalAssetsHr = assetRows.reduce((s, r) => s + r.hr, 0);

  // Compute Liability Totals
  const liabilityRows = useMemo(() => {
    return liabilityAccounts
      .map((acc) => {
        const total = getBal(acc.id);
        const mg = isPivotBranch ? getBal(acc.id, 'MG') : 0;
        const hr = isPivotBranch ? getBal(acc.id, 'HR') : 0;
        return { acc, total, mg, hr };
      })
      .filter((r) => !parameters.hideZeroRows || r.total !== 0);
  }, [liabilityAccounts, balanceOf, isPivotBranch, parameters.hideZeroRows]);

  const totalLiabilities = liabilityRows.reduce((s, r) => s + r.total, 0);
  const totalLiabilitiesMg = liabilityRows.reduce((s, r) => s + r.mg, 0);
  const totalLiabilitiesHr = liabilityRows.reduce((s, r) => s + r.hr, 0);

  // Compute Equity Totals
  const equityRows = useMemo(() => {
    return equityAccounts
      .map((acc) => {
        const total = getBal(acc.id);
        const mg = isPivotBranch ? getBal(acc.id, 'MG') : 0;
        const hr = isPivotBranch ? getBal(acc.id, 'HR') : 0;
        return { acc, total, mg, hr };
      })
      .filter((r) => !parameters.hideZeroRows || r.total !== 0);
  }, [equityAccounts, balanceOf, isPivotBranch, parameters.hideZeroRows]);

  // Current year earnings (Revenue - Expense)
  const currentEarnings = useMemo(() => {
    const rev = accounts
      .filter((a) => a.account_type === 'income')
      .reduce((sum, a) => sum + balanceOf(a.id), 0);
    const exp = accounts
      .filter((a) => a.account_type === 'expense')
      .reduce((sum, a) => sum + balanceOf(a.id), 0);
    return rev - exp;
  }, [accounts, balanceOf]);

  const totalEquity = equityRows.reduce((s, r) => s + r.total, 0) + currentEarnings;
  const isBalanced = totalAssets === totalLiabilities + totalEquity;

  const drillDownLines = useMemo(() => {
    if (!drillDownAccount) return [];
    return movements(drillDownAccount.id).map((l) => ({
      id: l.id,
      date: l.journal_date,
      journal_number: l.journal_number,
      source_type: 'journal',
      source_id: l.journal_number,
      source_number: l.journal_number,
      description: l.description,
      debit: l.debit,
      credit: l.credit,
      dimensions: l.dimensions,
    }));
  }, [drillDownAccount, movements]);

  return (
    <ReportShell
      title="Statement of Financial Position (Balance Sheet)"
      subtitle={`${currentCompany.legal_name} • As of October 31, 2026`}
      asOfMode={true}
      parameters={parameters}
      onParametersChange={setParameters}
    >
      <div className="w-full flex flex-col gap-6">
        {/* Balance Sheet Statement Card */}
        <div className="bg-surface-elevated border border-border rounded-lg p-6 shadow-xs flex flex-col gap-6">
          <div className="text-center pb-4 border-b border-border">
            <h2 className="text-base font-bold text-text-primary">{currentCompany.legal_name}</h2>
            <div className="text-xs text-text-muted mt-0.5">
              Balance Sheet as at October 31, 2026 • Presentation: USD
            </div>
            {isPivotBranch && (
              <div className="text-[11px] font-mono text-accent mt-1 font-semibold">
                [ Pivoted by Dimension: Branch (MG Mogadishu vs HR Hargeisa) ]
              </div>
            )}
          </div>

          {/* 1. ASSETS SECTION */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between pb-1 border-b border-border">
              <span className="text-xs font-bold uppercase tracking-wider text-text-primary">
                1. Assets (Debit Normal Balance)
              </span>
              {isPivotBranch && (
                <div className="flex items-center gap-8 text-[11px] font-mono font-semibold text-text-muted">
                  <span className="w-24 text-right">Mogadishu (MG)</span>
                  <span className="w-24 text-right">Hargeisa (HR)</span>
                  <span className="w-28 text-right text-text-primary">Total USD</span>
                </div>
              )}
            </div>

            <div className="divide-y divide-border/60 text-xs">
              {assetRows.map((row) => (
                <ContextMenu key={row.acc.id}>
                  <ContextMenuTrigger asChild>
                    <div
                      onClick={() => setDrillDownAccount(row.acc)}
                      className="py-1.5 px-2 flex items-center justify-between hover:bg-surface-neutral cursor-pointer rounded-sm transition group"
                    >
                      <span className="text-text-primary flex items-center gap-2">
                        <strong className="font-mono text-accent">{row.acc.code}</strong>
                        <span>{row.acc.name}</span>
                        <ChevronRight className="w-3 h-3 text-text-muted opacity-0 group-hover:opacity-100 transition" />
                      </span>

                      {isPivotBranch ? (
                        <div className="flex items-center gap-8 font-mono text-num">
                          <span className="w-24 text-right text-text-muted">{formatMoney(row.mg)}</span>
                          <span className="w-24 text-right text-text-muted">{formatMoney(row.hr)}</span>
                          <span className="w-28 text-right font-semibold text-text-primary">{formatMoney(row.total)}</span>
                        </div>
                      ) : (
                        <span className="font-mono text-num font-semibold text-text-primary">
                          {formatMoney(row.total)}
                        </span>
                      )}
                    </div>
                  </ContextMenuTrigger>
                  <ContextMenuContent>
                    <ContextMenuItem onClick={() => setDrillDownAccount(row.acc)}>
                      <ExternalLink className="mr-2 h-3.5 w-3.5" />
                      <span>Drill Down to GL Lines</span>
                    </ContextMenuItem>
                    <ContextMenuItem
                      onClick={() =>
                        navigator.clipboard.writeText(`${row.acc.code} - ${row.acc.name}`)
                      }
                    >
                      <Copy className="mr-2 h-3.5 w-3.5" />
                      <span>Copy Account Code & Name</span>
                    </ContextMenuItem>
                    <ContextMenuItem
                      onClick={() =>
                        navigator.clipboard.writeText((row.total / 100).toFixed(2))
                      }
                    >
                      <Copy className="mr-2 h-3.5 w-3.5" />
                      <span>Copy Balance (${(row.total / 100).toFixed(2)})</span>
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
              ))}

              {/* Assets Total Row */}
              <div className="py-2.5 px-2 flex items-center justify-between font-bold text-xs bg-surface-neutral rounded-sm mt-1">
                <span className="text-text-primary uppercase">Total Assets:</span>
                {isPivotBranch ? (
                  <div className="flex items-center gap-8 font-mono text-num text-accent">
                    <span className="w-24 text-right">{formatMoney(totalAssetsMg)}</span>
                    <span className="w-24 text-right">{formatMoney(totalAssetsHr)}</span>
                    <span className="w-28 text-right">{formatMoney(totalAssets)}</span>
                  </div>
                ) : (
                  <span className="font-mono text-num text-accent">{formatMoney(totalAssets)}</span>
                )}
              </div>
            </div>
          </div>

          {/* 2. LIABILITIES SECTION */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between pb-1 border-b border-border">
              <span className="text-xs font-bold uppercase tracking-wider text-text-primary">
                2. Liabilities (Credit Normal Balance)
              </span>
              {isPivotBranch && (
                <div className="flex items-center gap-8 text-[11px] font-mono font-semibold text-text-muted">
                  <span className="w-24 text-right">Mogadishu (MG)</span>
                  <span className="w-24 text-right">Hargeisa (HR)</span>
                  <span className="w-28 text-right text-text-primary">Total USD</span>
                </div>
              )}
            </div>

            <div className="divide-y divide-border/60 text-xs">
              {liabilityRows.map((row) => (
                <ContextMenu key={row.acc.id}>
                  <ContextMenuTrigger asChild>
                    <div
                      onClick={() => setDrillDownAccount(row.acc)}
                      className="py-1.5 px-2 flex items-center justify-between hover:bg-surface-neutral cursor-pointer rounded-sm transition group"
                    >
                      <span className="text-text-primary flex items-center gap-2">
                        <strong className="font-mono text-accent">{row.acc.code}</strong>
                        <span>{row.acc.name}</span>
                        <ChevronRight className="w-3 h-3 text-text-muted opacity-0 group-hover:opacity-100 transition" />
                      </span>

                      {isPivotBranch ? (
                        <div className="flex items-center gap-8 font-mono text-num">
                          <span className="w-24 text-right text-text-muted">{formatMoney(row.mg)}</span>
                          <span className="w-24 text-right text-text-muted">{formatMoney(row.hr)}</span>
                          <span className="w-28 text-right font-semibold text-text-primary">{formatMoney(row.total)}</span>
                        </div>
                      ) : (
                        <span className="font-mono text-num font-semibold text-text-primary">
                          {formatMoney(row.total)}
                        </span>
                      )}
                    </div>
                  </ContextMenuTrigger>
                  <ContextMenuContent>
                    <ContextMenuItem onClick={() => setDrillDownAccount(row.acc)}>
                      <ExternalLink className="mr-2 h-3.5 w-3.5" />
                      <span>Drill Down to GL Lines</span>
                    </ContextMenuItem>
                    <ContextMenuItem
                      onClick={() =>
                        navigator.clipboard.writeText(`${row.acc.code} - ${row.acc.name}`)
                      }
                    >
                      <Copy className="mr-2 h-3.5 w-3.5" />
                      <span>Copy Account Code & Name</span>
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
              ))}

              {/* Liabilities Total Row */}
              <div className="py-2.5 px-2 flex items-center justify-between font-bold text-xs bg-surface-neutral rounded-sm mt-1">
                <span className="text-text-primary uppercase">Total Liabilities:</span>
                {isPivotBranch ? (
                  <div className="flex items-center gap-8 font-mono text-num text-danger">
                    <span className="w-24 text-right">{formatMoney(totalLiabilitiesMg)}</span>
                    <span className="w-24 text-right">{formatMoney(totalLiabilitiesHr)}</span>
                    <span className="w-28 text-right">{formatMoney(totalLiabilities)}</span>
                  </div>
                ) : (
                  <span className="font-mono text-num text-danger">{formatMoney(totalLiabilities)}</span>
                )}
              </div>
            </div>
          </div>

          {/* 3. EQUITY SECTION */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between pb-1 border-b border-border">
              <span className="text-xs font-bold uppercase tracking-wider text-text-primary">
                3. Equity (Credit Normal Balance)
              </span>
            </div>

            <div className="divide-y divide-border/60 text-xs">
              {equityRows.map((row) => (
                <ContextMenu key={row.acc.id}>
                  <ContextMenuTrigger asChild>
                    <div
                      onClick={() => setDrillDownAccount(row.acc)}
                      className="py-1.5 px-2 flex items-center justify-between hover:bg-surface-neutral cursor-pointer rounded-sm transition group"
                    >
                      <span className="text-text-primary flex items-center gap-2">
                        <strong className="font-mono text-accent">{row.acc.code}</strong>
                        <span>{row.acc.name}</span>
                      </span>
                      <span className="font-mono text-num font-semibold text-text-primary">
                        {formatMoney(row.total)}
                      </span>
                    </div>
                  </ContextMenuTrigger>
                  <ContextMenuContent>
                    <ContextMenuItem onClick={() => setDrillDownAccount(row.acc)}>
                      <ExternalLink className="mr-2 h-3.5 w-3.5" />
                      <span>Drill Down to GL Lines</span>
                    </ContextMenuItem>
                    <ContextMenuItem
                      onClick={() =>
                        navigator.clipboard.writeText(`${row.acc.code} - ${row.acc.name}`)
                      }
                    >
                      <Copy className="mr-2 h-3.5 w-3.5" />
                      <span>Copy Account Code & Name</span>
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
              ))}

              {/* Retained Net Income row */}
              <div className="py-1.5 px-2 flex items-center justify-between">
                <span className="text-text-primary flex items-center gap-2">
                  <strong className="font-mono text-accent">INC-2026</strong>
                  <span>Current Period Operating Net Profit (P&L)</span>
                </span>
                <span className="font-mono text-num font-semibold text-success">
                  {formatMoney(currentEarnings)}
                </span>
              </div>

              {/* Total Equity */}
              <div className="py-2.5 px-2 flex items-center justify-between font-bold text-xs bg-surface-neutral rounded-sm mt-1">
                <span className="text-text-primary uppercase">Total Equity:</span>
                <span className="font-mono text-num text-accent">{formatMoney(totalEquity)}</span>
              </div>
            </div>
          </div>

          {/* 4. BALANCING VERIFICATION FOOTER */}
          <div
            className={`p-4 rounded-md border flex items-center justify-between text-xs font-bold ${
              isBalanced
                ? 'bg-success-soft border-success/30 text-success'
                : 'bg-danger-soft border-danger/30 text-danger'
            }`}
          >
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 shrink-0" />
              <span>
                {isBalanced
                  ? 'Balance Sheet Equation Balanced: Total Assets = Total Liabilities + Equity'
                  : 'Ledger Out of Balance! Check journal entries.'}
              </span>
            </div>
            <div className="flex items-center gap-6 font-mono text-sm">
              <span>Assets: {formatMoney(totalAssets)}</span>
              <span>Liab + Eq: {formatMoney(totalLiabilities + totalEquity)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* DrillDown Drawer for any clicked line */}
      {drillDownAccount && (
        <DrillDownDrawer
          isOpen={Boolean(drillDownAccount)}
          onClose={() => setDrillDownAccount(null)}
          accountCode={drillDownAccount.code}
          accountName={drillDownAccount.name}
          lines={drillDownLines}
          companySlug={coSlug}
        />
      )}
    </ReportShell>
  );
};
