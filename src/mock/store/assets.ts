/**
 * Fixed Assets slice: Register, schedules, and monthly depreciation run per 08_Mock_Refactor_Prompt.md Block F.3.
 */

import { StateCreator } from 'zustand';
import { FixedAsset, DepreciationRun, User, CompanySettings } from '@/types';
import { mockFixedAssets } from '@/mock/data';
import { buildJournalFromDepreciation } from '@/mock/PostingRules';

export interface AssetsSlice {
  fixedAssets: FixedAsset[];
  depreciationRuns: DepreciationRun[];

  addFixedAsset: (asset: FixedAsset) => void;
  calculateMonthlyDepreciation: (asset: FixedAsset) => number;
  previewDepreciationRun: (asOf: string, periodId: string) => DepreciationRun;
  postDepreciationRun: (
    asOf: string,
    periodId: string,
    actor: User,
    settings: CompanySettings
  ) => DepreciationRun;
}

export const createAssetsSlice: StateCreator<any, [], [], AssetsSlice> = (set, get) => ({
  fixedAssets: [...mockFixedAssets],
  depreciationRuns: [],

  addFixedAsset: (asset) => {
    set((s: any) => ({
      fixedAssets: [asset, ...s.fixedAssets],
    }));
  },

  calculateMonthlyDepreciation: (asset) => {
    if (asset.status !== 'active') return 0;
    const depreciableBase = asset.cost - asset.residual;
    if (depreciableBase <= 0 || asset.useful_life_months <= 0) return 0;
    return Math.round(depreciableBase / asset.useful_life_months);
  },

  previewDepreciationRun: (asOf, periodId) => {
    const state = get();
    const lines = state.fixedAssets
      .filter((a: FixedAsset) => a.status === 'active')
      .map((a: FixedAsset) => {
        const amount = state.calculateMonthlyDepreciation(a);
        return {
          asset_id: a.id,
          asset_number: a.number,
          asset_name: a.name,
          amount,
        };
      });

    const total = lines.reduce((s: number, l: any) => s + l.amount, 0);

    return {
      id: `depr-preview-${Date.now()}`,
      company_id: state.currentCompany?.id || 'co-1',
      period_id: periodId,
      as_of: asOf,
      status: 'draft',
      total_depreciation: total,
      lines,
    };
  },

  postDepreciationRun: (asOf, periodId, actor, settings) => {
    const state = get();
    const run = state.previewDepreciationRun(asOf, periodId);
    run.id = `depr-${Date.now()}`;
    run.status = 'posted';

    const deprExpenseAccountId = 'acc-6500';
    const accumDeprAccountId = 'acc-1510';

    const jDraft = buildJournalFromDepreciation(run, deprExpenseAccountId, accumDeprAccountId, periodId, actor);
    const { journal } = state.postJournalDirect(jDraft, actor, settings, state.auditEvents?.[0]);
    run.journal_id = journal.id;

    set((s: any) => ({
      depreciationRuns: [run, ...s.depreciationRuns],
    }));

    return run;
  },
});
