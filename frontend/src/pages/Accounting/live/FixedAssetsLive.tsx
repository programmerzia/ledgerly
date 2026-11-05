import React from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageHeader } from '@/components/domain/PageHeader';
import { useAllAssets } from '@/data/fixedAssets';
import { useActiveCompany } from '@/data/session';
import { formatMoney } from '@/lib/format';
import { ErrorLine } from './parts';
import { useWriter } from './assets/parts';
import { RegisterTab } from './assets/RegisterTab';
import { DepreciationTab } from './assets/DepreciationTab';
import { AdjustmentsTab } from './assets/AdjustmentsTab';
import { ScheduleTab } from './assets/ScheduleTab';
import { TaxTab } from './assets/TaxTab';
import { CategoriesTab } from './assets/CategoriesTab';

export const ASSET_TABS = [
  { id: 'register', label: 'Asset list' },
  { id: 'depreciation', label: 'Monthly depreciation' },
  { id: 'adjustments', label: 'Sales and write-downs' },
  { id: 'schedule', label: 'Asset schedule' },
  { id: 'tax', label: 'Tax depreciation' },
  { id: 'categories', label: 'Categories' },
] as const;
export type AssetTabId = (typeof ASSET_TABS)[number]['id'];

export const tabFromParam = (v: string | null): AssetTabId => ASSET_TABS.find((t) => t.id === v)?.id ?? 'register';

/**
 * Fixed assets from the API: the asset list, monthly depreciation runs, sales and write-downs, the asset schedule
 * report, tax depreciation and categories. `?tab=` picks the tab (the close checklist and the approvals inbox link here).
 */
export const FixedAssetsLive: React.FC = () => {
  const [params, setParams] = useSearchParams();
  const tab = tabFromParam(params.get('tab'));
  const { company } = useActiveCompany();
  const cur = company.base_currency;
  const all = useAllAssets();
  const writer = useWriter(() => all.refetch());

  const inUse = all.data.filter((a) => a.status !== 'disposed');
  const cost = inUse.reduce((t, a) => t + a.cost, 0);
  const accumulated = inUse.reduce((t, a) => t + a.accumulated, 0);
  const value = inUse.reduce((t, a) => t + a.carrying, 0);
  const kpi = (label: string, v: number) => (
    <div className="px-5 py-3">
      <div className="text-xs text-text-muted">{label}</div>
      <div className="mt-1 text-[22px] font-medium leading-7 tabular-nums text-text-primary">{all.isLoading ? '…' : formatMoney(v, cur)}</div>
    </div>
  );

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Fixed assets" subtitle="Equipment and property you own, and how much value they lose each month" />

      {all.error ? (
        <div className="rounded-lg border border-border bg-surface"><ErrorLine error={all.error} onRetry={all.refetch} /></div>
      ) : (
        <div className="grid grid-cols-1 divide-y divide-border rounded-lg border border-border bg-surface sm:grid-cols-3 sm:divide-x sm:divide-y-0" data-testid="asset-totals">
          {kpi('Original cost', cost)}
          {kpi('Depreciated so far', accumulated)}
          {kpi('Value today', value)}
        </div>
      )}

      <div className="flex w-fit max-w-full flex-wrap items-center gap-1 rounded-md bg-surface-neutral p-0.5" role="tablist">
        {ASSET_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setParams(t.id === 'register' ? {} : { tab: t.id }, { replace: true })}
            className={`cursor-pointer rounded-[4px] px-3 py-1 text-[13px] font-medium transition ${tab === t.id ? 'bg-surface text-text-primary' : 'text-text-muted hover:text-text-primary'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'register' && <RegisterTab writer={writer} />}
      {tab === 'depreciation' && <DepreciationTab writer={writer} />}
      {tab === 'adjustments' && <AdjustmentsTab writer={writer} />}
      {tab === 'schedule' && <ScheduleTab />}
      {tab === 'tax' && <TaxTab writer={writer} />}
      {tab === 'categories' && <CategoriesTab writer={writer} onChanged={() => all.refetch()} />}

      {writer.dialogs}
    </div>
  );
};
