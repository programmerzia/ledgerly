import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ColumnDef } from '@tanstack/react-table';
import { useLedgerStore } from '@/mock/store';
import { FixedAsset } from '@/types';
import { PageHeader } from '@/components/domain/PageHeader';
import { toast } from 'sonner';
import { DataTable, type RowAction } from '@/components/domain/DataTable';
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
  Trash2,
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
    uiDensity,
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

  const CATEGORY_LABEL: Record<string, string> = {
    'cat-it': 'IT equipment',
    'cat-furn': 'Furniture',
    'cat-equip': 'Equipment',
    'cat-veh': 'Vehicles',
  };
  const categoryLabel = (id: string) => CATEGORY_LABEL[id] ?? id;
  const deprPct = (a: FixedAsset) => {
    const base = a.cost - a.residual;
    return base > 0 ? Math.min(100, Math.max(0, (getAccumDepr(a) / base) * 100)) : 0;
  };

  const columns: ColumnDef<FixedAsset>[] = [
    {
      accessorKey: 'name',
      header: 'Asset',
      cell: ({ row }) => (
        <div className="flex items-center gap-3">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
            <Package className="size-4" />
          </span>
          <div className="min-w-0">
            <div className="truncate font-medium text-text-primary">{row.original.name}</div>
            <div className="font-mono text-[11px] text-text-muted">{row.original.number}</div>
          </div>
        </div>
      ),
    },
    {
      accessorKey: 'category_id',
      header: 'Category',
      cell: ({ row }) => <span className="text-text-secondary">{categoryLabel(row.original.category_id)}</span>,
    },
    {
      accessorKey: 'acquired_on',
      header: 'Bought',
      cell: ({ row }) => <span className="text-text-muted">{row.original.acquired_on}</span>,
    },
    {
      accessorKey: 'cost',
      header: () => <div className="text-right">Cost</div>,
      cell: ({ row }) => <div className="text-right font-mono tabular-nums text-text-primary">{formatMoney(row.original.cost)}</div>,
    },
    {
      id: 'progress',
      header: 'Worn down',
      cell: ({ row }) => {
        const pct = deprPct(row.original);
        return (
          <div className="flex w-36 items-center gap-2" title={`${formatMoney(getAccumDepr(row.original))} depreciated so far`}>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-neutral">
              <div
                className={`h-full rounded-full ${pct > 80 ? 'bg-warning' : 'bg-accent'}`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="w-9 text-right font-mono text-[11px] tabular-nums text-text-muted">{Math.round(pct)}%</span>
          </div>
        );
      },
    },
    {
      id: 'nbv',
      header: () => <div className="text-right">Value today</div>,
      cell: ({ row }) => (
        <div className="text-right font-mono font-semibold tabular-nums text-text-primary">
          {formatMoney(row.original.cost - getAccumDepr(row.original))}
        </div>
      ),
    },
    {
      accessorKey: 'status',
      header: 'Status',
      cell: ({ row }) => (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-success-soft px-2 py-0.5 text-xs font-medium capitalize text-success">
          <span className="size-1.5 rounded-full bg-success" />
          {row.original.status}
        </span>
      ),
    },
  ];

  const totals = useMemo(() => {
    const cost = fixedAssets.reduce((t, a) => t + a.cost, 0);
    const accum = fixedAssets.reduce((t, a) => t + getAccumDepr(a), 0);
    return { cost, accum, nbv: cost - accum };
  }, [fixedAssets]);

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
      toast.error(err.message || 'Depreciation run failed');
    }
  };

  const tabBtn = (id: 'register' | 'depreciation', label: string) => (
    <button
      type="button"
      onClick={() => setActiveTab(id)}
      className={`rounded-md px-3 py-1.5 text-[13px] font-medium transition cursor-pointer ${
        activeTab === id ? 'bg-surface text-text-primary shadow-card font-semibold' : 'text-text-muted hover:text-text-primary'
      }`}
    >
      {label}
    </button>
  );

  const assetActions = (a: FixedAsset): RowAction<FixedAsset>[] => [
    { label: 'View details', icon: Layers, onClick: (r) => setSelectedAssetId(r.id) },
    { label: 'Run depreciation', icon: TrendingDown, onClick: () => setActiveTab('depreciation') },
    { label: 'Copy asset number', icon: FileSpreadsheet, onClick: (r) => { navigator.clipboard?.writeText(r.number); toast.success(`${r.number} copied`); } },
    {
      label: 'Dispose of asset',
      icon: Trash2,
      destructive: true,
      onClick: () => toast.info(`Disposal of ${a.number} needs approval from your finance manager.`),
    },
  ];

  const kpi = (label: string, value: number, tone: string, icon: React.ReactNode) => (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-surface p-4 shadow-card">
      <span className={`flex size-9 items-center justify-center rounded-lg ${tone}`}>{icon}</span>
      <div>
        <div className="text-xs text-text-muted">{label}</div>
        <div className="text-xl font-semibold tabular-nums tracking-tight text-text-primary">{formatMoney(value)}</div>
      </div>
    </div>
  );

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        icon={<Package />}
        title="Fixed assets"
        subtitle="Equipment and property you own, and how much value they lose each month"
        actions={
          <>
            <button
              type="button"
              onClick={() => setIsNewAssetOpen(true)}
              className="flex h-9 items-center gap-1.5 rounded-lg bg-accent px-3.5 text-[13px] font-semibold text-white shadow-sm transition hover:bg-accent-hover cursor-pointer"
            >
              <Plus className="size-4" />
              <span>Add asset</span>
            </button>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {kpi('Original cost', totals.cost, 'bg-accent-soft text-accent', <Coins className="size-4" />)}
        {kpi('Depreciated so far', totals.accum, 'bg-warning-soft text-warning', <TrendingDown className="size-4" />)}
        {kpi('Value today', totals.nbv, 'bg-success-soft text-success', <ShieldCheck className="size-4" />)}
      </div>

      <div className="flex w-fit items-center gap-1 rounded-lg border border-border bg-surface-neutral p-1">
        {tabBtn('register', 'Asset list')}
        {tabBtn('depreciation', 'Monthly depreciation')}
      </div>

      {activeTab === 'register' && (
        <SplitPane
          storageKey="ledgerly_assets_split_width"
          isOpen={Boolean(selectedAsset)}
          onClose={() => setSelectedAssetId(null)}
          title={selectedAsset?.name}
          subtitle={selectedAsset ? `${categoryLabel(selectedAsset.category_id)} · ${selectedAsset.number}` : undefined}
          icon={<Building className="w-4 h-4" />}
          badge={
            selectedAsset && (
              <span className="rounded-full bg-accent-soft px-2 py-0.5 font-mono text-[11px] font-semibold text-accent">
                {selectedAsset.number}
              </span>
            )
          }
          detailContent={
            selectedAsset && (
              <div className="flex flex-col gap-4 text-[13px]">
                <div className="rounded-xl border border-border bg-surface-neutral/50 p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="block text-xs text-text-muted">Value today</span>
                      <span className="font-mono text-xl font-semibold tabular-nums text-text-primary">
                        {formatMoney(selectedAsset.cost - getAccumDepr(selectedAsset))}
                      </span>
                    </div>
                    <div className="text-right">
                      <span className="block text-xs text-text-muted">Loses each month</span>
                      <span className="font-mono text-sm font-semibold text-danger">
                        {formatMoney(calculateMonthlyDepreciation(selectedAsset))}
                      </span>
                    </div>
                  </div>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface-neutral">
                    <div className="h-full rounded-full bg-accent" style={{ width: `${deprPct(selectedAsset)}%` }} />
                  </div>
                  <div className="mt-1 text-xs text-text-muted">{Math.round(deprPct(selectedAsset))}% of its value used up</div>
                </div>

                <dl className="flex flex-col divide-y divide-border rounded-xl border border-border bg-surface px-4">
                  {[
                    ['Category', categoryLabel(selectedAsset.category_id)],
                    ['Bought on', selectedAsset.acquired_on],
                    ['Original cost', formatMoney(selectedAsset.cost)],
                    ['Depreciated so far', formatMoney(getAccumDepr(selectedAsset))],
                    ['Method', selectedAsset.method.replace('_', ' ')],
                    ['Useful life', `${selectedAsset.useful_life_months} months (${Math.round(selectedAsset.useful_life_months / 12)} years)`],
                  ].map(([k, v]) => (
                    <div key={k} className="flex justify-between py-2.5">
                      <dt className="text-text-muted">{k}</dt>
                      <dd className="font-medium capitalize text-text-primary">{v}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            )
          }
        >
          <DataTable
            columns={columns}
            data={filteredAssets}
            activeRowId={selectedAssetId}
            searchPlaceholder="Filter assets by number, name, category..."
            rowDensity={uiDensity}
            onRowClick={(row) => setSelectedAssetId(row.id)}
            rowActions={assetActions}
            contextMenuTitle={(r) => `${r.number} · ${r.name}`}
          />
        </SplitPane>
      )}

      {/* TAB 2: Depreciation Run */}
      {activeTab === 'depreciation' && (
        <div className="flex flex-col gap-5 w-full">
          {deprSuccess && (
            <div className="p-3 bg-success/10 border border-success/30 rounded-md text-success text-xs flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{deprSuccess}</span>
            </div>
          )}

          {/* Config card */}
          <div className="p-4 bg-surface border border-border rounded-xl shadow-card grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-semibold text-text-muted uppercase tracking-wider flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5 text-accent" />
                Run date
              </label>
              <input
                type="date"
                value={asOfDate}
                onChange={(e) => setAsOfDate(e.target.value)}
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
          </div>

          {/* Preview Schedule */}
          <div className="p-4 bg-surface border border-border rounded-xl shadow-card flex flex-col gap-3 text-xs">
            <div className="flex items-center justify-between">
              <span className="font-bold text-text-primary uppercase tracking-wider text-[11px]">
                This month’s depreciation
              </span>
              <span className="text-[11px] text-text-muted">
                {deprPreview.lines.length} assets included
              </span>
            </div>

            <div className="border border-border rounded-lg overflow-hidden">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="h-8 bg-surface-neutral border-b border-border text-[11px] font-semibold text-text-muted uppercase">
                    <th className="px-3">Asset</th>
                    <th className="px-3">Name</th>
                    <th className="px-3 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {deprPreview.lines.map((line) => (
                    <tr key={line.asset_id} className="h-9 hover:bg-surface-neutral transition">
                      <td className="px-3 font-mono text-accent font-medium">{line.asset_number}</td>
                      <td className="px-3 font-medium text-text-primary">{line.asset_name}</td>
                      <td className="px-3 text-right font-mono text-num font-semibold text-danger">
                        {formatMoney(line.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Total and Execute */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 pt-4 border-t border-border">
              <div className="p-3 bg-accent-soft/60 border border-accent/20 rounded-md text-text-primary max-w-md">
                <span className="font-semibold text-[11px] text-accent uppercase tracking-wide block mb-1">
                  What this does
                </span>
                <p className="text-[11px] text-text-muted leading-relaxed">
                  Executing this run will debit Amount (6500) and credit Accumulated Depreciation (1510) for{' '}
                  <strong className="text-num font-mono text-text-primary">
                    {formatMoney(deprPreview.total_depreciation)}
                  </strong>.
                </p>
              </div>

              <div className="flex flex-col items-end gap-3">
                <div className="text-right">
                  <span className="text-text-muted text-xs block">Total this month</span>
                  <span className="text-xl font-bold font-mono text-num text-danger">
                    {formatMoney(deprPreview.total_depreciation)}
                  </span>
                </div>

                <button
                  type="button"
                  onClick={() => setSignDialogOpen(true)}
                  className="h-8 px-5 bg-accent hover:bg-accent-hover text-white rounded-lg font-semibold text-xs shadow-2xs transition flex items-center gap-1.5"
                >
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span>Sign and record depreciation</span>
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
              <DialogTitle className="text-sm font-bold text-text-primary">Add an asset</DialogTitle>
            </DialogHeader>

            <div className="flex flex-col gap-1">
              <label className="text-[11px] text-text-muted font-medium">Asset name *</label>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Core Cisco Fiber Switch 9300"
                className="h-9 px-3 rounded-lg border border-border bg-surface text-[13px] text-text-primary"
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-[11px] text-text-muted font-medium">Category</label>
                <select
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value)}
                  className="h-8 px-2 rounded-lg border border-border bg-surface text-text-primary"
                >
                  <option value="IT & Telecom Equipment">IT & Telecom Equipment</option>
                  <option value="Vehicles & Transport">Vehicles & Transport</option>
                  <option value="Office Furniture & Fixtures">Office Furniture</option>
                  <option value="Generators & Power Units">Generators & Power Units</option>
                </select>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[11px] text-text-muted font-medium">Cost ($)</label>
                <input
                  type="number"
                  step="0.01"
                  value={newCost}
                  onChange={(e) => setNewCost(e.target.value)}
                  className="h-8 px-2 font-mono text-right rounded-lg border border-border bg-surface text-text-primary"
                  required
                />
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-[11px] text-text-muted font-medium">Useful life (months)</label>
              <input
                type="number"
                value={newMonths}
                onChange={(e) => setNewMonths(e.target.value)}
                className="h-8 px-2 font-mono rounded-lg border border-border bg-surface text-text-primary"
                required
              />
            </div>

            <DialogFooter className="gap-2 pt-2 border-t border-border">
              <button
                type="button"
                onClick={() => setIsNewAssetOpen(false)}
                className="h-8 px-3 rounded-lg border border-border bg-surface hover:bg-surface-neutral text-text-secondary transition"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="h-8 px-4 rounded-lg bg-accent text-white font-semibold hover:bg-accent-hover transition shadow-xs"
              >
                Save asset
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
