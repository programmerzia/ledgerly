import type { components } from '../schema';
import { fromApiMoney, type ApiMoney } from './money';

export type ApiExchangeRate = components['schemas']['ExchangeRateResource'];
export type ApiRevaluationPreview = components['schemas']['FxRevaluationPreviewResource'];
export type ApiRevaluation = components['schemas']['FxRevaluationResource'];

/** Rates stay decimal STRINGS in live mode: no parse, no arithmetic in the browser (docs/15 rule 4). */
export interface LiveRate {
  id: string;
  from_currency: string;
  to_currency: string;
  rate_date: string;
  rate: string;
  source: string;
}

export function toRate(r: ApiExchangeRate): LiveRate {
  return { id: r.id, from_currency: r.from_currency, to_currency: r.to_currency, rate_date: r.rate_date ?? '', rate: r.rate, source: r.source };
}

/** Item shape from FxRevaluationPreviewResource::rows (the generated type is `{}[]`). */
interface ApiRevalItem {
  account_id: string;
  account_code: string;
  contact_id: string | null;
  currency: string;
  amount_fc: ApiMoney;
  closing_rate: string;
  rate_date: string | null;
  rate_source: string | null;
  carried_base: ApiMoney;
  revalued_base: ApiMoney;
  unrealised: ApiMoney;
}
interface ApiRevalResidual {
  account_id: string;
  account_code: string;
  contact_id: string | null;
  currency: string;
  carried_base: ApiMoney;
}

export interface LiveRevalItem {
  account_id: string;
  account_code: string;
  currency: string;
  amount_fc: number;
  closing_rate: string;
  rate_date: string;
  rate_source: string;
  carried_base: number;
  revalued_base: number;
  unrealised: number;
}

export interface LiveRevalPreview {
  period_id: string;
  as_of: string;
  can_run: boolean;
  blockers: string[];
  existing_revaluation_id: string | null;
  total_unrealised: number;
  base_currency: string;
  items: LiveRevalItem[];
  residuals: { account_code: string; currency: string; carried_base: number }[];
  missing_rates: string[];
}

export function toRevalPreview(p: ApiRevaluationPreview): LiveRevalPreview {
  return {
    period_id: p.fiscal_period_id,
    as_of: p.as_of,
    can_run: p.can_run,
    blockers: p.blockers,
    existing_revaluation_id: p.existing_revaluation_id,
    total_unrealised: fromApiMoney(p.total_unrealised),
    base_currency: p.total_unrealised.currency,
    items: (p.items as ApiRevalItem[]).map((i) => ({
      account_id: i.account_id,
      account_code: i.account_code,
      currency: i.currency,
      amount_fc: fromApiMoney(i.amount_fc),
      closing_rate: i.closing_rate,
      rate_date: i.rate_date ?? '',
      rate_source: i.rate_source ?? '',
      carried_base: fromApiMoney(i.carried_base),
      revalued_base: fromApiMoney(i.revalued_base),
      unrealised: fromApiMoney(i.unrealised),
    })),
    residuals: (p.residuals as ApiRevalResidual[]).map((r) => ({ account_code: r.account_code, currency: r.currency, carried_base: fromApiMoney(r.carried_base) })),
    missing_rates: p.missing_rates,
  };
}

export interface LiveRevalRun {
  id: string;
  period_id: string;
  as_of: string;
  status: string;
  journal_id: string | null;
  reversal_journal_id: string | null;
  reversal_pending: boolean;
  total_unrealised: number;
  base_currency: string;
}

export function toRevalRun(r: ApiRevaluation): LiveRevalRun {
  return {
    id: r.id,
    period_id: r.fiscal_period_id,
    as_of: r.as_of ?? '',
    status: r.status,
    journal_id: r.journal_id,
    reversal_journal_id: r.reversal_journal_id,
    reversal_pending: r.reversal_pending,
    total_unrealised: fromApiMoney(r.total_unrealised),
    base_currency: r.total_unrealised.currency,
  };
}

/** Client-side shape check for the manual rate field so a typo never leaves the form; the server still decides (up to 8 decimals). */
export const RATE_PATTERN = /^\d{1,12}(\.\d{1,8})?$/;
export const isRateText = (s: string): boolean => RATE_PATTERN.test(s.trim());

export function toRateRequest(f: { from: string; to: string; date: string; rate: string }) {
  return { from_currency: f.from.trim().toUpperCase(), to_currency: f.to.trim().toUpperCase(), rate_date: f.date, rate: f.rate.trim() };
}
