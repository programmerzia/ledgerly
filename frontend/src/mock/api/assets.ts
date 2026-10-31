import { simulatedCall } from './client';
import { useLedgerStore } from '@/mock/store';
import { FixedAsset, DepreciationRun } from '@/types';

export async function getFixedAssets(): Promise<FixedAsset[]> {
  return simulatedCall(() => useLedgerStore.getState().fixedAssets);
}

export async function addFixedAsset(asset: FixedAsset): Promise<FixedAsset> {
  return simulatedCall(() => {
    useLedgerStore.getState().addFixedAsset(asset);
    return asset;
  });
}

export async function previewDepreciationRun(asOf: string, periodId: string): Promise<DepreciationRun> {
  return simulatedCall(() => useLedgerStore.getState().previewDepreciationRun(asOf, periodId));
}

export async function postDepreciationRun(asOf: string, periodId: string): Promise<DepreciationRun> {
  return simulatedCall(() => {
    const state = useLedgerStore.getState();
    return state.postDepreciationRun(asOf, periodId, state.currentUser, state.companySettings);
  });
}
