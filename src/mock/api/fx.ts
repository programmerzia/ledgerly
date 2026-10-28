import { simulatedCall } from './client';
import { useLedgerStore } from '@/mock/store';
import { ExchangeRate, FxRevaluation, FxRevaluationItem } from '@/types';

export async function getExchangeRates(): Promise<ExchangeRate[]> {
  return simulatedCall(() => useLedgerStore.getState().exchangeRates);
}

export async function syncExchangeRates(): Promise<void> {
  return simulatedCall(() => {
    useLedgerStore.getState().syncRatesWithProvider();
  });
}

export async function getFxRevaluationPreview(asOf: string): Promise<FxRevaluationItem[]> {
  return simulatedCall(() => useLedgerStore.getState().generateRevaluationPreview(asOf));
}

export async function postFxRevaluationRun(
  asOf: string,
  periodId: string,
  nextPeriodId: string
): Promise<FxRevaluation> {
  return simulatedCall(() => {
    const state = useLedgerStore.getState();
    return state.postFxRevaluationRun(
      asOf,
      periodId,
      nextPeriodId,
      state.currentUser,
      state.companySettings
    );
  });
}
