/**
 * FX Slice: Manages currency exchange rates, rate sync, and month-end FX revaluation runs
 * with automatic next-period reversal journals per 08_Mock_Refactor_Prompt.md Block F.2.
 */

import { StateCreator } from 'zustand';
import { ExchangeRate, FxRevaluation, FxRevaluationItem, User, CompanySettings } from '@/types';
import { mockExchangeRates } from '@/mock/data';
import { buildJournalFromRevaluation } from '@/mock/PostingRules';

export interface FxSlice {
  exchangeRates: ExchangeRate[];
  fxRevaluations: FxRevaluation[];

  addExchangeRate: (rate: ExchangeRate) => void;
  syncRatesWithProvider: () => void;
  generateRevaluationPreview: (asOf: string) => FxRevaluationItem[];
  postFxRevaluationRun: (
    asOf: string,
    periodId: string,
    nextPeriodId: string,
    actor: User,
    settings: CompanySettings
  ) => FxRevaluation;
}

export const createFxSlice: StateCreator<any, [], [], FxSlice> = (set, get) => ({
  exchangeRates: [...mockExchangeRates],
  fxRevaluations: [],

  addExchangeRate: (rate) => {
    set((s: any) => ({
      exchangeRates: [rate, ...s.exchangeRates],
    }));
  },

  syncRatesWithProvider: () => {
    const today = new Date().toISOString().split('T')[0];
    const updatedRates: ExchangeRate[] = [
      { id: `fx-${Date.now()}-1`, company_id: 'co-1', from_currency: 'USD', to_currency: 'SOS', rate_date: today, rate: 26150, source: 'provider' },
      { id: `fx-${Date.now()}-2`, company_id: 'co-1', from_currency: 'USD', to_currency: 'KES', rate_date: today, rate: 129.80, source: 'provider' },
      { id: `fx-${Date.now()}-3`, company_id: 'co-1', from_currency: 'EUR', to_currency: 'USD', rate_date: today, rate: 1.0820, source: 'provider' },
      { id: `fx-${Date.now()}-4`, company_id: 'co-1', from_currency: 'GBP', to_currency: 'USD', rate_date: today, rate: 1.2980, source: 'provider' },
    ];
    set((s: any) => ({
      exchangeRates: [...updatedRates, ...s.exchangeRates],
    }));
  },

  generateRevaluationPreview: (asOf) => {
    const state = get();
    const sosBankAcc = state.accounts.find((a: any) => a.id === 'acc-1020');
    if (!sosBankAcc) return [];

    // Evaluate open foreign currency balance
    const sosRate = state.exchangeRates.find((r: any) => r.from_currency === 'USD' && r.to_currency === 'SOS')?.rate || 26000;
    const currentRate = 26150; // New market rate at period end
    const amountFc = 109460000; // SOS 109,460,000 (~$4,210.00 at book rate 26,000)
    const bookAmountBase = Math.round((amountFc / sosRate) * 100);
    const revaluedAmountBase = Math.round((amountFc / currentRate) * 100);
    const unrealisedGainLoss = revaluedAmountBase - bookAmountBase;

    return [
      {
        account_id: sosBankAcc.id,
        account_code: sosBankAcc.code,
        account_name: sosBankAcc.name,
        currency: 'SOS',
        amount_fc: amountFc,
        book_rate: sosRate,
        book_amount_base: bookAmountBase,
        current_rate: currentRate,
        revalued_amount_base: revaluedAmountBase,
        unrealised_gain_loss: unrealisedGainLoss,
      },
    ];
  },

  postFxRevaluationRun: (asOf, periodId, nextPeriodId, actor, settings) => {
    const state = get();
    const items = state.generateRevaluationPreview(asOf);
    const totalGainLoss = items.reduce((s: number, i: FxRevaluationItem) => s + i.unrealised_gain_loss, 0);

    const reval: FxRevaluation = {
      id: `reval-${Date.now()}`,
      company_id: state.currentCompany?.id || 'co-1',
      period_id: periodId,
      as_of: asOf,
      status: 'posted',
      total_unrealised_gain_loss: totalGainLoss,
      items,
    };

    // 1. Post revaluation journal
    const jDraft = buildJournalFromRevaluation(reval, settings, periodId, actor);
    const { journal } = state.postJournalDirect(jDraft, actor, settings, state.auditEvents?.[0]);
    reval.journal_id = journal.id;

    // 2. Post automatic reversal in next period
    const { reversalJournal } = state.reverseJournal(
      journal.id,
      `Automatic reversal of month-end FX revaluation in next period`,
      actor,
      settings,
      state.auditEvents?.[0]
    );
    reval.reversal_journal_id = reversalJournal.id;

    set((s: any) => ({
      fxRevaluations: [reval, ...s.fxRevaluations],
    }));

    return reval;
  },
});
