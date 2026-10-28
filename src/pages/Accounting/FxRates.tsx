import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLedgerStore } from '@/mock/store';
import { ExchangeRate, FxRevaluationItem } from '@/types';
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
  } = useLedgerStore();
  const coSlug = currentCompany.slug;

  const [activeTab, setActiveTab] = useState<'rates' | 'revaluation'>('rates');
  const [revalDate, setRevalDate] = useState('2026-10-31');
  const [isSyncing, setIsSyncing] = useState(false);
  const [signDialogOpen, setSignDialogOpen] = useState(false);
  const [revalSuccess, setRevalSuccess] = useState<string | null>(null);

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
        `Month-End Revaluation posted successfully (Journal #${res.journal_id}). Automatic reversal scheduled in Period Nov 2026 (Journal #${res.reversal_journal_id}).`
      );
    } catch (err: any) {
      alert(err.message || 'Revaluation failed');
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-y-auto bg-canvas">
      <div className="w-full flex flex-col gap-6">
        {/* Top Header */}
        <div className="flex items-center justify-between pb-4 border-b border-border">
          <div>
            <h1 className="text-xl font-semibold text-text-primary">Foreign Exchange (FX) & Revaluation</h1>
            <p className="text-xs text-text-muted">
              Multi-currency rates, real-time market sync & month-end revaluation controls
            </p>
          </div>

          {/* Module Tabs */}
          <div className="flex items-center gap-1 bg-surface-subtle p-1 rounded-sm border border-line-border text-xs">
            <button
              type="button"
              onClick={() => setActiveTab('rates')}
              className={`px-3 py-1 rounded font-medium transition ${
                activeTab === 'rates'
                  ? 'bg-surface-elevated text-ink-900 font-semibold shadow-2xs'
                  : 'text-ink-muted hover:text-ink-900'
              }`}
            >
              Exchange Rates Table
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('revaluation')}
              className={`px-3 py-1 rounded font-medium transition ${
                activeTab === 'revaluation'
                  ? 'bg-surface-elevated text-ink-900 font-semibold shadow-2xs'
                  : 'text-ink-muted hover:text-ink-900'
              }`}
            >
              Month-End Revaluation Run
            </button>
          </div>
        </div>

        {/* TAB 1: Exchange Rates Table */}
        {activeTab === 'rates' && (
          <div className="flex flex-col gap-4 animate-in fade-in duration-150">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-ink-900 uppercase tracking-wider">
                Current Currency Pairs (Base: {currentCompany.base_currency})
              </span>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleSyncRates}
                  disabled={isSyncing}
                  className="flex items-center gap-1.5 h-8 px-3 rounded-sm border border-line-border bg-surface-elevated hover:bg-surface-neutral text-ink-900 text-xs font-medium transition shadow-2xs"
                >
                  <RefreshCw className={`w-3.5 h-3.5 text-brand-teal ${isSyncing ? 'animate-spin' : ''}`} />
                  <span>{isSyncing ? 'Syncing Rates...' : 'Sync Provider Rates'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => setIsAddRateOpen(true)}
                  className="flex items-center gap-1.5 h-8 px-3 rounded-sm bg-brand-teal hover:bg-brand-teal-hover text-white text-xs font-semibold transition shadow-2xs"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Manual Rate Entry</span>
                </button>
              </div>
            </div>

            <div className="border border-line-border rounded-md overflow-hidden bg-surface-elevated shadow-2xs">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="h-9 bg-surface-neutral border-b border-line-border text-[11px] font-semibold text-ink-muted uppercase tracking-wider">
                    <th className="px-3">Currency Pair</th>
                    <th className="px-3">Date</th>
                    <th className="px-3 text-right">Exchange Rate</th>
                    <th className="px-3">Source / Feed</th>
                    <th className="px-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line-border">
                  {exchangeRates.map((rate) => (
                    <tr key={rate.id} className="h-9 hover:bg-surface-neutral transition">
                      <td className="px-3 font-mono font-medium text-brand-teal">
                        {rate.from_currency} / {rate.to_currency}
                      </td>
                      <td className="px-3 font-mono text-[11px] text-ink-muted">
                        {rate.rate_date}
                      </td>
                      <td className="px-3 text-right font-mono text-num font-semibold text-ink-900">
                        {rate.rate.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
                      </td>
                      <td className="px-3">
                        <span className="capitalize text-ink-muted bg-surface-neutral px-1.5 py-0.5 rounded text-[10px] font-mono">
                          {rate.source}
                        </span>
                      </td>
                      <td className="px-3">
                        <span className="text-[10px] text-success font-medium bg-success/10 px-1.5 py-0.5 rounded">
                          Active
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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
            <div className="p-4 bg-surface-elevated border border-line-border rounded-md shadow-2xs grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-semibold text-ink-muted uppercase tracking-wider flex items-center gap-1">
                  <Calendar className="w-3.5 h-3.5 text-brand-teal" />
                  Revaluation As-Of Date
                </label>
                <input
                  type="date"
                  value={revalDate}
                  onChange={(e) => setRevalDate(e.target.value)}
                  className="h-8 px-2.5 font-mono text-ink-900 rounded-sm border border-line-border bg-surface-subtle focus:outline-none focus:border-brand-teal"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-semibold text-ink-muted uppercase tracking-wider">
                  Target Fiscal Period
                </label>
                <div className="h-8 px-2.5 flex items-center rounded-sm border border-line-border bg-surface-neutral font-medium text-ink-900">
                  October 2026 (per-2026-10)
                </div>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-semibold text-ink-muted uppercase tracking-wider">
                  Automatic Reversal Period
                </label>
                <div className="h-8 px-2.5 flex items-center rounded-sm border border-line-border bg-surface-neutral font-medium text-ink-900">
                  November 2026 (per-2026-11)
                </div>
              </div>
            </div>

            {/* Revaluation Items Table */}
            <div className="p-4 bg-surface-elevated border border-line-border rounded-md shadow-2xs flex flex-col gap-3 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-bold text-ink-900 uppercase tracking-wider text-[11px]">
                  Open Foreign Currency Items Subject to Revaluation
                </span>
                <span className="text-[11px] text-ink-muted">
                  Standard rule: Revalue open AR, AP, and Bank balances to period-end market rate
                </span>
              </div>

              <div className="border border-line-border rounded-sm overflow-hidden">
                <table className="w-full border-collapse text-left text-xs">
                  <thead>
                    <tr className="h-8 bg-surface-neutral border-b border-line-border text-[11px] font-semibold text-ink-muted uppercase">
                      <th className="px-3">Account Code & Name</th>
                      <th className="px-3">Currency</th>
                      <th className="px-3 text-right">Foreign Balance</th>
                      <th className="px-3 text-right">Book Rate</th>
                      <th className="px-3 text-right">Book USD</th>
                      <th className="px-3 text-right">Current Rate</th>
                      <th className="px-3 text-right">Revalued USD</th>
                      <th className="px-3 text-right">Unrealised Gain / (Loss)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line-border">
                    {previewItems.map((item) => {
                      const isGain = item.unrealised_gain_loss >= 0;
                      return (
                        <tr key={item.account_id} className="h-9 hover:bg-surface-neutral transition">
                          <td className="px-3 font-medium text-ink-900">
                            <span className="font-mono text-brand-teal mr-1.5">{item.account_code}</span>
                            {item.account_name}
                          </td>
                          <td className="px-3 font-mono font-medium text-ink-900">{item.currency}</td>
                          <td className="px-3 text-right font-mono text-num text-ink-900">
                            {item.amount_fc.toLocaleString()}
                          </td>
                          <td className="px-3 text-right font-mono text-num text-ink-muted">
                            {item.book_rate.toLocaleString()}
                          </td>
                          <td className="px-3 text-right font-mono text-num text-ink-900">
                            {formatMoney(item.book_amount_base)}
                          </td>
                          <td className="px-3 text-right font-mono text-num text-ink-muted">
                            {item.current_rate.toLocaleString()}
                          </td>
                          <td className="px-3 text-right font-mono text-num text-ink-900">
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
              <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 pt-4 border-t border-line-border">
                <div className="p-3 bg-brand-teal/5 border border-brand-teal/20 rounded-md text-ink-900 max-w-lg">
                  <span className="font-semibold text-[11px] text-brand-teal uppercase tracking-wide block mb-1">
                    Plain-Language Controls Consequence
                  </span>
                  <p className="text-[11px] text-ink-muted leading-relaxed">
                    Executing this run will generate an unrealised FX journal entry for{' '}
                    <strong className="text-num font-mono text-ink-900">{formatMoney(Math.abs(totalUnrealised))}</strong>{' '}
                    in period October 2026. An automated reversal journal will be booked to the first day of November 2026 to ensure proper multi-currency accrual accounting.
                  </p>
                </div>

                <div className="flex flex-col items-end gap-3">
                  <div className="text-right">
                    <span className="text-ink-muted text-xs block">Net Unrealised Gain/(Loss):</span>
                    <span className={`text-xl font-bold font-mono text-num ${totalUnrealised >= 0 ? 'text-success' : 'text-danger'}`}>
                      {totalUnrealised >= 0 ? '+' : ''}
                      {formatMoney(totalUnrealised)}
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => setSignDialogOpen(true)}
                    className="h-8 px-5 bg-brand-teal hover:bg-brand-teal-hover text-white rounded-sm font-semibold text-xs shadow-2xs transition flex items-center gap-1.5"
                  >
                    <ShieldCheck className="w-3.5 h-3.5" />
                    <span>Sign with PIN & Post FX Revaluation</span>
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
              <DialogTitle className="text-sm font-bold text-text-primary">Add Exchange Rate</DialogTitle>
            </DialogHeader>

            <div className="flex flex-col gap-1">
              <label className="text-[11px] text-text-muted font-medium">Currency Pair</label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={newFrom}
                  onChange={(e) => setNewFrom(e.target.value.toUpperCase())}
                  className="w-1/2 h-8 px-2 font-mono rounded-sm border border-border bg-surface text-text-primary"
                />
                <span>/</span>
                <input
                  type="text"
                  value={newTo}
                  onChange={(e) => setNewTo(e.target.value.toUpperCase())}
                  className="w-1/2 h-8 px-2 font-mono rounded-sm border border-border bg-surface text-text-primary"
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
                className="h-8 px-2 font-mono text-right rounded-sm border border-border bg-surface text-text-primary"
                required
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-[11px] text-text-muted font-medium">Effective Date</label>
              <input
                type="date"
                value={newDate}
                onChange={(e) => setNewDate(e.target.value)}
                className="h-8 px-2 font-mono rounded-sm border border-border bg-surface text-text-primary"
                required
              />
            </div>

            <DialogFooter className="gap-2 pt-2 border-t border-border">
              <button
                type="button"
                onClick={() => setIsAddRateOpen(false)}
                className="h-8 px-3 rounded-sm border border-border bg-surface hover:bg-surface-neutral text-text-secondary transition"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="h-8 px-4 rounded-sm bg-accent text-white font-semibold hover:bg-accent-hover transition shadow-xs"
              >
                Save Rate
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
