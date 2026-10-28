import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLedgerStore } from '@/mock/store';
import { FixedAsset } from '@/types';
import { formatMoney } from '@/lib/format';
import { SplitPane } from '@/components/domain/SplitPane';
import { SignDialog } from '@/components/domain/SignDialog';
import {
  Package,
  Plus,
  Search,
  Calendar,
  Building,
  CheckCircle2,
  AlertCircle,
  Coins,
  ShieldCheck,
  TrendingDown,
  Layers,
  FileSpreadsheet,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';

export const FixedAssets: React.FC = () => {
  const navigate = useNavigate();
  const {
    currentCompany,
    currentUser,
    companySettings,
    fixedAssets,
    depreciationRuns,
    calculateMonthlyDepreciation,
    previewDepreciationRun,
    postDepreciationRun,
    addFixedAsset,
  } = useLedgerStore();
  const coSlug = currentCompany.slug;

  const [activeTab, setActiveTab] = useState<'register' | 'depreciation'>('register');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [asOfDate, setAsOfDate] = useState('2026-10-31');
  const [signDialogOpen, setSignDialogOpen] = useState(false);
  const [deprSuccess, setDeprSuccess] = useState<string | null>(null);

  // New asset modal
  const [isNewAssetOpen, setIsNewAssetOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newCost, setNewCost] = useState('12000');
  const [newMonths, setNewMonths] = useState('36');
  const [newCategory, setNewCategory] = useState('cat-equip');

  const getAccumDepr = (a: FixedAsset) => {
    const deprBase = a.cost - a.residual;
    if (a.useful_life_months <= 0) return 0;
    return Math.round((deprBase / a.useful_life_months) * 12);
  };

  const filteredAssets = useMemo(() => {
    if (!searchQuery) return fixedAssets;
    const q = searchQuery.toLowerCase();
    return fixedAssets.filter(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        a.number.toLowerCase().includes(q) ||
        a.category_id.toLowerCase().includes(q)
    );
  }, [fixedAssets, searchQuery]);

  const selectedAsset = useMemo(() => {
    return fixedAssets.find((a) => a.id === selectedAssetId) || null;
  }, [fixedAssets, selectedAssetId]);

  // Preview depreciation run
  const deprPreview = useMemo(() => {
    return previewDepreciationRun(asOfDate, 'per-2026-10');
  }, [previewDepreciationRun, asOfDate, fixedAssets]);

  const handleCreateAsset = (e: React.FormEvent) => {
    e.preventDefault();
    const costMinor = Math.round((parseFloat(newCost) || 0) * 100);
    const months = parseInt(newMonths, 10) || 36;

    addFixedAsset({
      id: `fa-${Date.now()}`,
      company_id: currentCompany.id,
      number: `FA-2026-${String(fixedAssets.length + 1).padStart(3, '0')}`,
      name: newName,
      category_id: newCategory,
      acquired_on: '2026-10-01',
      cost: costMinor,
      residual: 0,
      asset_account_id: 'acc-1500',
      accum_depr_account_id: 'acc-1510',
      depr_expense_account_id: 'acc-6500',
      method: 'straight_line',
      useful_life_months: months,
      status: 'active',
    });

    setIsNewAssetOpen(false);
    setNewName('');
  };

  const handleExecuteDepreciation = async (pin: string) => {
    try {
      const run = postDepreciationRun(asOfDate, 'per-2026-10', currentUser, companySettings);
      setSignDialogOpen(false);
      setDeprSuccess(
        `Monthly depreciation run executed successfully (Journal #${run.journal_id}). Total depreciation of ${formatMoney(
          run.total_depreciation
        )} posted to P&L (6500).`
      );
    } catch (err: any) {
      alert(err.message || 'Depreciation run failed');
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-surface-canvas">
      {/* Top Header */}
      <div className="h-12 border-b border-border px-4 flex items-center justify-between shrink-0 bg-surface-elevated">
        <div className="flex items-center gap-3">
          <div className="flex items-baseline gap-2">
            <h1 className="text-xl font-semibold text-text-primary">Fixed Assets Register & Schedules</h1>
            <span className="text-xs text-text-muted">Asset lifecycle, capitalization & monthly depreciation</span>
          </div>

          <span className="text-border">|</span>

          {/* Tabs */}
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setActiveTab('register')}
              className={`px-2.5 py-1 text-xs rounded-sm font-medium transition ${
                activeTab === 'register'
                  ? 'bg-surface-neutral text-ink-900 font-semibold'
                  : 'text-ink-muted hover:text-ink-900'
              }`}
            >
              Assets Register
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('depreciation')}
              className={`px-2.5 py-1 text-xs rounded-sm font-medium transition ${
                activeTab === 'depreciation'
                  ? 'bg-surface-neutral text-ink-900 font-semibold'
                  : 'text-ink-muted hover:text-ink-900'
              }`}
            >
              Depreciation Run
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {activeTab === 'register' && (
            <>
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-ink-muted absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Search assets, categories..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="h-8 pl-8 pr-3 text-xs rounded-sm border border-line-border bg-surface-subtle focus:bg-surface-elevated focus:outline-none focus:border-brand-teal w-60"
                />
              </div>

              <button
                type="button"
                onClick={() => setIsNewAssetOpen(true)}
                className="flex items-center gap-1.5 h-8 px-3 rounded-sm bg-brand-teal text-white text-xs font-semibold hover:bg-brand-teal-hover transition shadow-2xs"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Fixed Asset</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* TAB 1: Asset Register */}
      {activeTab === 'register' && (
        <SplitPane
          storageKey="ledgerly_assets_split_width"
          isOpen={Boolean(selectedAsset)}
          onClose={() => setSelectedAssetId(null)}
          title={selectedAsset?.name}
          badge={
            selectedAsset && (
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-surface-neutral font-semibold text-brand-teal">
                {selectedAsset.number}
              </span>
            )
          }
          detailContent={
            selectedAsset && (
              <div className="flex flex-col gap-4 text-xs">
                {/* Book value card */}
                <div className="p-3 bg-surface-subtle border border-line-border rounded-sm flex items-center justify-between">
                  <div>
                    <span className="text-[10px] uppercase font-bold text-ink-muted block">
                      Net Book Value (NBV)
                    </span>
                    <span className="text-lg font-bold font-mono text-num text-ink-900">
                      {formatMoney(selectedAsset.cost - getAccumDepr(selectedAsset))}
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="text-[10px] text-ink-muted block">Monthly Amortisation</span>
                    <span className="font-mono text-xs font-semibold text-danger">
                      {formatMoney(calculateMonthlyDepreciation(selectedAsset))}/mo
                    </span>
                  </div>
                </div>

                {/* Details */}
                <div className="p-3 bg-surface-neutral border border-line-border rounded-sm flex flex-col gap-2 text-[11px]">
                  <div className="flex justify-between">
                    <span className="text-ink-muted">Category:</span>
                    <span className="font-medium text-ink-900">{selectedAsset.category_id}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-ink-muted">Acquisition Date:</span>
                    <span className="font-mono text-ink-900">{selectedAsset.acquired_on}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-ink-muted">Initial Capitalized Cost:</span>
                    <span className="font-mono text-num text-ink-900 font-semibold">{formatMoney(selectedAsset.cost)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-ink-muted">Accumulated Depreciation:</span>
                    <span className="font-mono text-num text-danger">{formatMoney(getAccumDepr(selectedAsset))}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-ink-muted">Depreciation Method:</span>
                    <span className="font-medium text-ink-900 capitalize">{selectedAsset.method.replace('_', ' ')}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-ink-muted">Useful Life:</span>
                    <span className="font-medium text-ink-900">{selectedAsset.useful_life_months} Months ({Math.round(selectedAsset.useful_life_months / 12)} Yrs)</span>
                  </div>
                </div>

                {/* GL Mapping */}
                <div className="p-3 bg-surface-subtle border border-line-border rounded-sm flex flex-col gap-1.5 text-[11px] font-mono">
                  <span className="font-bold text-ink-900 uppercase font-sans text-[10px]">
                    General Ledger Mapping
                  </span>
                  <div className="flex justify-between text-ink-muted">
                    <span>Asset Cost Acc:</span>
                    <span className="text-ink-900">{selectedAsset.asset_account_id} (1500)</span>
                  </div>
                  <div className="flex justify-between text-ink-muted">
                    <span>Accum Depr Acc:</span>
                    <span className="text-ink-900">{selectedAsset.accum_depr_account_id} (1510)</span>
                  </div>
                  <div className="flex justify-between text-ink-muted">
                    <span>Depr Expense Acc:</span>
                    <span className="text-ink-900">{selectedAsset.depr_expense_account_id} (6500)</span>
                  </div>
                </div>
              </div>
            )
          }
        >
          {/* Table */}
          <div className="p-4 flex flex-col gap-3">
            <div className="border border-line-border rounded-md overflow-hidden bg-surface-elevated shadow-2xs">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="h-9 bg-surface-neutral border-b border-line-border text-[11px] font-semibold text-ink-muted uppercase tracking-wider">
                    <th className="px-3">Asset #</th>
                    <th className="px-3">Asset Name</th>
                    <th className="px-3">Category</th>
                    <th className="px-3">Acquired</th>
                    <th className="px-3 text-right">Cost</th>
                    <th className="px-3 text-right">Accum Depr</th>
                    <th className="px-3 text-right">Net Book Value</th>
                    <th className="px-3 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line-border">
                  {filteredAssets.map((asset) => {
                    const isSelected = selectedAssetId === asset.id;
                    const accum = getAccumDepr(asset);
                    const nbv = asset.cost - accum;

                    return (
                      <tr
                        key={asset.id}
                        onClick={() => setSelectedAssetId(asset.id)}
                        className={`h-9 cursor-pointer transition select-none ${
                          isSelected ? 'bg-brand-teal/10 font-medium' : 'hover:bg-surface-neutral'
                        }`}
                      >
                        <td className="px-3 font-mono font-medium text-brand-teal">
                          {asset.number}
                        </td>
                        <td className="px-3 font-medium text-ink-900">
                          {asset.name}
                        </td>
                        <td className="px-3 text-ink-muted">
                          {asset.category_id}
                        </td>
                        <td className="px-3 font-mono text-[11px] text-ink-muted">
                          {asset.acquired_on}
                        </td>
                        <td className="px-3 text-right font-mono text-num font-medium text-ink-900">
                          {formatMoney(asset.cost)}
                        </td>
                        <td className="px-3 text-right font-mono text-num text-danger">
                          {formatMoney(accum)}
                        </td>
                        <td className="px-3 text-right font-mono text-num font-semibold text-ink-900">
                          {formatMoney(nbv)}
                        </td>
                        <td className="px-3 text-center">
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-success/10 text-success capitalize">
                            {asset.status}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between text-[11px] text-ink-muted px-1">
              <span>Showing {filteredAssets.length} fixed assets</span>
              <span>Straight-line and declining balance depreciation schedules</span>
            </div>
          </div>
        </SplitPane>
      )}

      {/* TAB 2: Depreciation Run */}
      {activeTab === 'depreciation' && (
        <div className="p-6 flex flex-col gap-6 w-full overflow-y-auto">
          {deprSuccess && (
            <div className="p-3 bg-success/10 border border-success/30 rounded-md text-success text-xs flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{deprSuccess}</span>
            </div>
          )}

          {/* Config card */}
          <div className="p-4 bg-surface-elevated border border-line-border rounded-md shadow-2xs grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-semibold text-ink-muted uppercase tracking-wider flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5 text-brand-teal" />
                Depreciation Run Date
              </label>
              <input
                type="date"
                value={asOfDate}
                onChange={(e) => setAsOfDate(e.target.value)}
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
          </div>

          {/* Preview Schedule */}
          <div className="p-4 bg-surface-elevated border border-line-border rounded-md shadow-2xs flex flex-col gap-3 text-xs">
            <div className="flex items-center justify-between">
              <span className="font-bold text-ink-900 uppercase tracking-wider text-[11px]">
                Monthly Depreciation Amortization Schedule
              </span>
              <span className="text-[11px] text-ink-muted">
                {deprPreview.lines.length} Active Capital Assets
              </span>
            </div>

            <div className="border border-line-border rounded-sm overflow-hidden">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="h-8 bg-surface-neutral border-b border-line-border text-[11px] font-semibold text-ink-muted uppercase">
                    <th className="px-3">Asset Number</th>
                    <th className="px-3">Asset Description</th>
                    <th className="px-3 text-right">Depreciation Expense</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line-border">
                  {deprPreview.lines.map((line) => (
                    <tr key={line.asset_id} className="h-9 hover:bg-surface-neutral transition">
                      <td className="px-3 font-mono text-brand-teal font-medium">{line.asset_number}</td>
                      <td className="px-3 font-medium text-ink-900">{line.asset_name}</td>
                      <td className="px-3 text-right font-mono text-num font-semibold text-danger">
                        {formatMoney(line.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Total and Execute */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 pt-4 border-t border-line-border">
              <div className="p-3 bg-brand-teal/5 border border-brand-teal/20 rounded-md text-ink-900 max-w-md">
                <span className="font-semibold text-[11px] text-brand-teal uppercase tracking-wide block mb-1">
                  Accounting Effect
                </span>
                <p className="text-[11px] text-ink-muted leading-relaxed">
                  Executing this run will debit Depreciation Expense (6500) and credit Accumulated Depreciation (1510) for{' '}
                  <strong className="text-num font-mono text-ink-900">
                    {formatMoney(deprPreview.total_depreciation)}
                  </strong>.
                </p>
              </div>

              <div className="flex flex-col items-end gap-3">
                <div className="text-right">
                  <span className="text-ink-muted text-xs block">Total Monthly Depreciation:</span>
                  <span className="text-xl font-bold font-mono text-num text-danger">
                    {formatMoney(deprPreview.total_depreciation)}
                  </span>
                </div>

                <button
                  type="button"
                  onClick={() => setSignDialogOpen(true)}
                  className="h-8 px-5 bg-brand-teal hover:bg-brand-teal-hover text-white rounded-sm font-semibold text-xs shadow-2xs transition flex items-center gap-1.5"
                >
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span>Sign with PIN & Post Depreciation Run</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add Asset Modal */}
      <Dialog open={isNewAssetOpen} onOpenChange={setIsNewAssetOpen}>
        <DialogContent className="max-w-[480px] p-5">
          <form onSubmit={handleCreateAsset} className="flex flex-col gap-4 text-xs">
            <DialogHeader>
              <DialogTitle className="text-sm font-bold text-text-primary">Capitalize New Fixed Asset</DialogTitle>
            </DialogHeader>

            <div className="flex flex-col gap-1">
              <label className="text-[11px] text-text-muted font-medium">Asset Name / Description *</label>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Core Cisco Fiber Switch 9300"
                className="h-8 px-2.5 rounded-sm border border-border bg-surface text-text-primary"
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-[11px] text-text-muted font-medium">Category</label>
                <select
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value)}
                  className="h-8 px-2 rounded-sm border border-border bg-surface text-text-primary"
                >
                  <option value="IT & Telecom Equipment">IT & Telecom Equipment</option>
                  <option value="Vehicles & Transport">Vehicles & Transport</option>
                  <option value="Office Furniture & Fixtures">Office Furniture</option>
                  <option value="Generators & Power Units">Generators & Power Units</option>
                </select>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[11px] text-text-muted font-medium">Capitalized Cost ($)</label>
                <input
                  type="number"
                  step="0.01"
                  value={newCost}
                  onChange={(e) => setNewCost(e.target.value)}
                  className="h-8 px-2 font-mono text-right rounded-sm border border-border bg-surface text-text-primary"
                  required
                />
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-[11px] text-text-muted font-medium">Useful Life (Months)</label>
              <input
                type="number"
                value={newMonths}
                onChange={(e) => setNewMonths(e.target.value)}
                className="h-8 px-2 font-mono rounded-sm border border-border bg-surface text-text-primary"
                required
              />
            </div>

            <DialogFooter className="gap-2 pt-2 border-t border-border">
              <button
                type="button"
                onClick={() => setIsNewAssetOpen(false)}
                className="h-8 px-3 rounded-sm border border-border bg-surface hover:bg-surface-neutral text-text-secondary transition"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="h-8 px-4 rounded-sm bg-accent text-white font-semibold hover:bg-accent-hover transition shadow-xs"
              >
                Save Asset
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* 6-Digit PIN SignDialog */}
      <SignDialog
        isOpen={signDialogOpen}
        onClose={() => setSignDialogOpen(false)}
        onConfirm={handleExecuteDepreciation}
        documentTitle="Monthly Depreciation Run"
        documentNumber="DEPR-RUN-2026-10"
        periodName="October 2026"
        amount={deprPreview.total_depreciation}
        consequenceText={`This will post a depreciation journal of ${formatMoney(
          deprPreview.total_depreciation
        )} in period October 2026 to recognize asset wear & tear.`}
      />
    </div>
  );
};
