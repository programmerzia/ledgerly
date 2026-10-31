import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ColumnDef } from '@tanstack/react-table';
import { useLedgerStore } from '@/mock/store';
import { ExchangeRate, FxRevaluationItem } from '@/types';
import { PageHeader } from '@/components/domain/PageHeader';
import { toast } from 'sonner';
import { DataTable } from '@/components/domain/DataTable';
import { formatMoney } from '@/lib/format';
import { SignDialog } from '@/components/domain/SignDialog';
import {
  Coins,
  RefreshCw,
  Plus,
  Calendar,
  Building,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  TrendingUp,
  TrendingDown,
  Layers,
  ShieldCheck,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';

export const FxRates: React.FC = () => {
  const navigate = useNavigate();
  const {
    currentCompany,
    currentUser,
    companySettings,
    exchangeRates,
    fxRevaluations,
    syncRatesWithProvider,
    addExchangeRate,
    generateRevaluationPreview,
    postFxRevaluationRun,
    uiDensity,
  } = useLedgerStore();
  const coSlug = currentCompany.slug;

  const [activeTab, setActiveTab] = useState<'rates' | 'revaluation'>('rates');
  const [revalDate, setRevalDate] = useState('2026-10-31');
  const [isSyncing, setIsSyncing] = useState(false);
  const [signDialogOpen, setSignDialogOpen] = useState(false);
  const [revalSuccess, setRevalSuccess] = useState<string | null>(null);

  const fmtRate = (r: number) => r.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 });

  const rateColumns: ColumnDef<ExchangeRate>[] = [
    {
      id: 'pair',
      header: 'Currencies',
      cell: ({ row }) => (
        <span className="font-mono font-semibold text-text-primary">
          {row.original.from_currency} <span className="text-text-muted">to</span> {row.original.to_currency}
        </span>
      ),
    },
    {
      accessorKey: 'rate_date',
      header: 'Date',
      cell: ({ row }) => <span className="text-text-muted">{row.original.rate_date}</span>,
    },
    {
      accessorKey: 'rate',
      header: () => <div className="text-right">Rate</div>,
      cell: ({ row }) => <div className="text-right font-mono font-semibold tabular-nums text-text-primary">{fmtRate(row.original.rate)}</div>,
    },
    {
      accessorKey: 'source',
      header: 'Source',
      cell: ({ row }) => (
        <span className="rounded-full bg-surface-neutral px-2 py-0.5 text-xs font-medium capitalize text-text-secondary">
          {row.original.source}
        </span>
      ),
    },
  ];

  /** One card per currency pair, newest rate with change and trend. */
  const rateCards = useMemo(() => {
    const byPair = new Map<string, ExchangeRate[]>();
    for (const r of exchangeRates) {
      const k = `${r.from_currency}/${r.to_currency}`;
      byPair.set(k, [...(byPair.get(k) ?? []), r]);
    }
    return [...byPair.entries()].map(([pair, list]) => {
      const sorted = [...list].sort((a, b) => a.rate_date.localeCompare(b.rate_date));
      const last = sorted[sorted.length - 1];
      const prev = sorted.length > 1 ? sorted[sorted.length - 2] : null;
      const change = prev ? ((last.rate - prev.rate) / prev.rate) * 100 : 0;
      return { pair, series: sorted.map((r) => r.rate), last, change };
    });
  }, [exchangeRates]);

  const Trend: React.FC<{ series: number[]; up: boolean }> = ({ series, up }) => {
    const w = 120, h = 36;
    const min = Math.min(...series), max = Math.max(...series);
    const pts = (series.length > 1 ? series : [series[0], series[0]]).map((v, i, arr) => {
      const x = (i / (arr.length - 1)) * (w - 4) + 2;
      const y = max === min ? h / 2 : h - 4 - ((v - min) / (max - min)) * (h - 8);
      return `${x},${y}`;
    });
    return (
      <svg width={w} height={h} aria-hidden className={up ? 'text-success' : 'text-danger'}>
        <polyline fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" points={pts.join(' ')} />
      </svg>
    );
  };

  // Manual rate modal
  const [isAddRateOpen, setIsAddRateOpen] = useState(false);
  const [newFrom, setNewFrom] = useState('USD');
  const [newTo, setNewTo] = useState('SOS');
  const [newRate, setNewRate] = useState('26150');
  const [newDate, setNewDate] = useState('2026-10-28');

  // Preview items
  const previewItems = useMemo(() => {
    return generateRevaluationPreview(revalDate);
  }, [generateRevaluationPreview, revalDate, exchangeRates]);

  const totalUnrealised = useMemo(() => {
    return previewItems.reduce((s, i) => s + i.unrealised_gain_loss, 0);
  }, [previewItems]);

  const handleSyncRates = () => {
    setIsSyncing(true);
    setTimeout(() => {
      syncRatesWithProvider();
      setIsSyncing(false);
    }, 600);
  };

  const handleAddRateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = parseFloat(newRate);
    if (isNaN(parsed) || parsed <= 0) return;

    addExchangeRate({
      id: `fx-manual-${Date.now()}`,
      company_id: currentCompany.id,
      from_currency: newFrom,
      to_currency: newTo,
      rate_date: newDate,
      rate: parsed,
      source: 'manual',
    });

    setIsAddRateOpen(false);
  };

  const handleExecuteRevaluation = async (pin: string) => {
    try {
      const res = postFxRevaluationRun(
        revalDate,
        'per-2026-10',
        'per-2026-11',
        currentUser,
        companySettings
      );
      setSignDialogOpen(false);
      setRevalSuccess(
        `Month-end adjustment recorded (journal ${res.journal_id}). It will be reversed automatically in November 2026.`
      );
    } catch (err: any) {
      toast.error(err.message || 'Adjustment failed');
    }
  };

  const tabBtn = (id: 'rates' | 'revaluation', label: string) => (
    <button
      type="button"
      onClick={() => setActiveTab(id)}
      className={`rounded-md px-3 py-1.5 text-[13px] font-medium transition cursor-pointer ${
        activeTab === id ? 'bg-surface text-text-primary font-semibold shadow-card' : 'text-text-muted hover:text-text-primary'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        icon={<Coins />}
        title="Exchange rates"
        subtitle={`Rates used to convert other currencies into ${currentCompany.base_currency}, and the month-end adjustment`}
        actions={
          <>
            <button
              type="button"
              onClick={handleSyncRates}
              disabled={isSyncing}
              className="flex h-9 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-[13px] font-medium text-text-primary transition hover:bg-surface-neutral cursor-pointer disabled:opacity-60"
            >
              <RefreshCw className={`size-4 text-accent ${isSyncing ? 'animate-spin' : ''}`} />
              <span>{isSyncing ? 'Updating…' : 'Update rates'}</span>
            </button>
            <button
              type="button"
              onClick={() => setIsAddRateOpen(true)}
              className="flex h-9 items-center gap-1.5 rounded-lg bg-accent px-3.5 text-[13px] font-semibold text-white shadow-sm transition hover:bg-accent-hover cursor-pointer"
            >
              <Plus className="size-4" />
              <span>Add rate</span>
            </button>
          </>
        }
      />

      <div className="flex w-fit items-center gap-1 rounded-lg border border-border bg-surface-neutral p-1">
        {tabBtn('rates', 'Rates')}
        {tabBtn('revaluation', 'Month-end adjustment')}
      </div>

      <div className="flex flex-col gap-6">
        {activeTab === 'rates' && (
          <div className="ui-rise-in flex flex-col gap-5">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {rateCards.map((c) => {
                const up = c.change >= 0;
                return (
                  <div key={c.pair} className="rounded-xl border border-border bg-surface p-4 shadow-card transition hover:border-border-strong hover:shadow-card-hover">
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="font-mono text-[13px] font-semibold text-text-primary">
                          {c.last.from_currency} / {c.last.to_currency}
                        </div>
                        <div className="mt-1 text-2xl font-semibold tabular-nums tracking-tight text-text-primary">{fmtRate(c.last.rate)}</div>
                      </div>
                      <Trend series={c.series} up={up} />
                    </div>
                    <div className="mt-2 flex items-center justify-between text-xs text-text-muted">
                      <span>
                        {c.last.rate_date} · <span className="capitalize">{c.last.source}</span>
                      </span>
                      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium ${up ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger'}`}>
                        {up ? <TrendingUp className="size-3" /> : <TrendingDown className="size-3" />}
                        {up ? '+' : ''}
                        {c.change.toFixed(2)}%
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

            <DataTable
              columns={rateColumns}
              data={exchangeRates}
              searchPlaceholder="Filter rates by currency or date..."
              rowDensity={uiDensity}
              rowActions={(r: ExchangeRate) => [
                {
                  label: 'Use as new rate',
                  icon: Plus,
                  onClick: (row: ExchangeRate) => {
                    setNewFrom(row.from_currency);
                    setNewTo(row.to_currency);
                    setNewRate(String(row.rate));
                    setIsAddRateOpen(true);
                  },
                },
                { label: 'Copy rate', icon: Layers, onClick: (row: ExchangeRate) => { navigator.clipboard?.writeText(String(row.rate)); toast.success('Rate copied'); } },
              ]}
              contextMenuTitle={(r: ExchangeRate) => `${r.from_currency}/${r.to_currency} · ${r.rate_date}`}
            />
          </div>
        )}

        {/* TAB 2: Month-End FX Revaluation Run */}
        {activeTab === 'revaluation' && (
          <div className="flex flex-col gap-5 animate-in fade-in duration-150">
            {revalSuccess && (
              <div className="p-3 bg-success/10 border border-success/30 rounded-md text-success text-xs flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>{revalSuccess}</span>
              </div>
            )}

            {/* Config & Dates */}
            <div className="p-4 bg-surface border border-border rounded-xl shadow-card grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-semibold text-text-muted uppercase tracking-wider flex items-center gap-1">
                  <Calendar className="w-3.5 h-3.5 text-accent" />
                  Adjust as of
                </label>
                <input
                  type="date"
                  value={revalDate}
                  onChange={(e) => setRevalDate(e.target.value)}
                  className="h-8 px-2.5 font-mono text-text-primary rounded-lg border border-border bg-surface focus:outline-none focus:border-accent"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">
                  Accounting period
                </label>
                <div className="h-8 px-2.5 flex items-center rounded-lg border border-border bg-surface-neutral font-medium text-text-primary">
                  October 2026
                </div>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">
                  Automatically reversed in
                </label>
                <div className="h-8 px-2.5 flex items-center rounded-lg border border-border bg-surface-neutral font-medium text-text-primary">
                  November 2026
                </div>
              </div>
            </div>

            {/* Revaluation Items Table */}
            <div className="p-4 bg-surface border border-border rounded-xl shadow-card flex flex-col gap-3 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-text-primary text-[15px] tracking-tight">
                  Foreign-currency balances to adjust
                </span>
                <span className="text-[11px] text-text-muted">
                  Open customer, supplier and bank balances are restated at the month-end rate
                </span>
              </div>

              <div className="border border-border rounded-lg overflow-hidden">
                <table className="w-full border-collapse text-left text-xs">
                  <thead>
                    <tr className="h-8 bg-surface-neutral border-b border-border text-[11px] font-semibold text-text-muted uppercase">
                      <th className="px-3">Account</th>
                      <th className="px-3">Currency</th>
                      <th className="px-3 text-right">Balance</th>
                      <th className="px-3 text-right">Rate used</th>
                      <th className="px-3 text-right">Value then</th>
                      <th className="px-3 text-right">Rate now</th>
                      <th className="px-3 text-right">Value now</th>
                      <th className="px-3 text-right">Gain / (loss)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {previewItems.map((item) => {
                      const isGain = item.unrealised_gain_loss >= 0;
                      return (
                        <tr key={item.account_id} className="h-9 hover:bg-surface-neutral transition">
                          <td className="px-3 font-medium text-text-primary">
                            <span className="font-mono text-accent mr-1.5">{item.account_code}</span>
                            {item.account_name}
                          </td>
                          <td className="px-3 font-mono font-medium text-text-primary">{item.currency}</td>
                          <td className="px-3 text-right font-mono text-num text-text-primary">
                            {item.amount_fc.toLocaleString()}
                          </td>
                          <td className="px-3 text-right font-mono text-num text-text-muted">
                            {item.book_rate.toLocaleString()}
                          </td>
                          <td className="px-3 text-right font-mono text-num text-text-primary">
                            {formatMoney(item.book_amount_base)}
                          </td>
                          <td className="px-3 text-right font-mono text-num text-text-muted">
                            {item.current_rate.toLocaleString()}
                          </td>
                          <td className="px-3 text-right font-mono text-num text-text-primary">
                            {formatMoney(item.revalued_amount_base)}
                          </td>
                          <td className="px-3 text-right font-mono text-num font-semibold">
                            <span className={isGain ? 'text-success' : 'text-danger'}>
                              {isGain ? '+' : ''}
                              {formatMoney(item.unrealised_gain_loss)}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Consequence Preview & Action */}
              <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 pt-4 border-t border-border">
                <div className="p-3 bg-accent-soft/60 border border-accent/20 rounded-md text-text-primary max-w-lg">
                  <span className="font-semibold text-[11px] text-accent uppercase tracking-wide block mb-1">
                    What this does
                  </span>
                  <p className="text-[11px] text-text-muted leading-relaxed">
                    This records an exchange gain or loss of{' '}
                    <strong className="text-num font-mono text-text-primary">{formatMoney(Math.abs(totalUnrealised))}</strong>{' '}
                    for October 2026. It is automatically reversed on 1 November so the gain or loss is not counted twice.
                  </p>
                </div>

                <div className="flex flex-col items-end gap-3">
                  <div className="text-right">
                    <span className="text-text-muted text-xs block">Net gain / (loss)</span>
                    <span className={`text-xl font-bold font-mono text-num ${totalUnrealised >= 0 ? 'text-success' : 'text-danger'}`}>
                      {totalUnrealised >= 0 ? '+' : ''}
                      {formatMoney(totalUnrealised)}
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => setSignDialogOpen(true)}
                    className="h-8 px-5 bg-accent hover:bg-accent-hover text-white rounded-lg font-semibold text-xs shadow-2xs transition flex items-center gap-1.5"
                  >
                    <ShieldCheck className="w-3.5 h-3.5" />
                    <span>Sign and record adjustment</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Manual Rate Entry Modal */}
      <Dialog open={isAddRateOpen} onOpenChange={setIsAddRateOpen}>
        <DialogContent className="max-w-[420px] p-5">
          <form onSubmit={handleAddRateSubmit} className="flex flex-col gap-4 text-xs">
            <DialogHeader>
              <DialogTitle className="text-sm font-bold text-text-primary">Add exchange rate</DialogTitle>
            </DialogHeader>

            <div className="flex flex-col gap-1">
              <label className="text-[11px] text-text-muted font-medium">Currencies</label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={newFrom}
                  onChange={(e) => setNewFrom(e.target.value.toUpperCase())}
                  className="w-1/2 h-8 px-2 font-mono rounded-lg border border-border bg-surface text-text-primary"
                />
                <span>/</span>
                <input
                  type="text"
                  value={newTo}
                  onChange={(e) => setNewTo(e.target.value.toUpperCase())}
                  className="w-1/2 h-8 px-2 font-mono rounded-lg border border-border bg-surface text-text-primary"
                />
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-[11px] text-text-muted font-medium">Rate</label>
              <input
                type="number"
                step="0.0001"
                value={newRate}
                onChange={(e) => setNewRate(e.target.value)}
                className="h-8 px-2 font-mono text-right rounded-lg border border-border bg-surface text-text-primary"
                required
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-[11px] text-text-muted font-medium">Effective date</label>
              <input
                type="date"
                value={newDate}
                onChange={(e) => setNewDate(e.target.value)}
                className="h-8 px-2 font-mono rounded-lg border border-border bg-surface text-text-primary"
                required
              />
            </div>

            <DialogFooter className="gap-2 pt-2 border-t border-border">
              <button
                type="button"
                onClick={() => setIsAddRateOpen(false)}
                className="h-8 px-3 rounded-lg border border-border bg-surface hover:bg-surface-neutral text-text-secondary transition"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="h-8 px-4 rounded-lg bg-accent text-white font-semibold hover:bg-accent-hover transition shadow-xs"
              >
                Save rate
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* 6-Digit PIN SignDialog */}
      <SignDialog
        isOpen={signDialogOpen}
        onClose={() => setSignDialogOpen(false)}
        onConfirm={handleExecuteRevaluation}
        documentTitle="FX Month-End Revaluation"
        documentNumber={`FX-REVAL-${revalDate}`}
        periodName="October 2026"
        amount={Math.abs(totalUnrealised)}
        consequenceText={`This will post an unrealised FX gain/loss journal of ${formatMoney(
          Math.abs(totalUnrealised)
        )} in October 2026 and schedule an automatic reversal in November 2026.`}
      />
    </div>
  );
};
