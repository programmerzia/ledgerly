<?php

declare(strict_types=1);

namespace App\Services\Fx;

use App\Domain\Fx\MonetaryAccounts;
use App\Domain\Fx\RevaluationPlan;
use App\Domain\Ledger\ControlType;
use App\Domain\Ledger\CurrencyPolicy;
use App\Domain\Shared\Fx;
use App\Domain\Trade\RevaluationItem;
use App\Models\Ledger\JournalLine;
use App\Models\Platform\Currency;
use App\Queries\Fx\FindExchangeRate;

/**
 * Reads posted journal lines and works out the unrealised difference per monetary balance (IAS 21.23):
 * foreign balance × closing rate (one HALF_UP rounding, D1) − the base amount currently carried.
 *
 * A balance is one account × foreign currency (× contact for AR/AP, so each customer and supplier is revalued
 * on its own). The foreign amount ignores the lines of earlier revaluations, which move base only; the carried
 * base includes them, so a run is always correct even while an older revaluation is still unreversed.
 * Pure reads: the Action calls it under the period lock, the preview without any lock.
 */
final class FxRevaluationCalculator
{
    public const string SOURCE = 'fx_revaluation';

    public function __construct(private readonly FindExchangeRate $rates) {}

    public function plan(string $companyId, string $baseCurrency, string $asOf): RevaluationPlan
    {
        $rows = JournalLine::query()->from('journal_lines as l')
            ->join('journals as j', 'j.id', '=', 'l.journal_id')
            ->join('accounts as a', 'a.id', '=', 'l.account_id')
            ->where('l.company_id', $companyId)
            ->whereIn('j.status', ['posted', 'reversed'])
            ->where('j.journal_date', '<=', $asOf)
            ->where('l.currency', '<>', $baseCurrency)
            ->whereIn('a.account_type', ['asset', 'liability'])
            ->groupByRaw("l.account_id, l.currency, CASE WHEN a.control_type IN ('ar', 'ap') THEN l.contact_id END, a.code, a.name, a.account_type, a.control_type, a.currency_policy, a.account_subtype")
            ->orderBy('a.code')->orderBy('l.currency')
            ->selectRaw("l.account_id, l.currency, CASE WHEN a.control_type IN ('ar', 'ap') THEN l.contact_id END AS contact_id, "
                .'a.code, a.name, a.account_type, a.control_type, a.currency_policy, a.account_subtype, '
                .'SUM(CASE WHEN j.source_type IS DISTINCT FROM ? THEN l.amount_fc ELSE 0 END) AS fc, SUM(l.debit - l.credit) AS base', [self::SOURCE])
            ->toBase()->get();

        $scales = Currency::query()->pluck('minor_unit', 'code')->map(fn ($v) => (int) $v)->all();
        $baseScale = $scales[$baseCurrency] ?? 2;

        $items = [];
        $evidence = [];
        $missing = [];
        $residuals = [];
        $quotes = [];
        foreach ($rows as $r) {
            $control = ControlType::from((string) $r->control_type);
            if (! MonetaryAccounts::isRevalued((string) $r->account_type, $control, CurrencyPolicy::from((string) $r->currency_policy), $r->account_subtype === null ? null : (string) $r->account_subtype)) {
                continue;
            }
            $fc = (int) $r->fc;
            $carried = (int) $r->base;
            $currency = (string) $r->currency;
            $contact = $r->contact_id === null ? null : (string) $r->contact_id;
            $key = ['account_id' => (string) $r->account_id, 'account_code' => (string) $r->code, 'currency' => $currency, 'contact_id' => $contact];

            if ($fc === 0) {
                if ($carried !== 0) {
                    $residuals[] = [...$key, 'carried_base' => $carried];
                }

                continue;
            }

            $quote = $quotes[$currency] ??= $this->rates->find($companyId, $currency, $baseCurrency, $asOf);
            if ($quote === null) {
                $missing[$currency] = $currency;

                continue;
            }

            $revalued = Fx::toBase($fc, $quote->rate, $scales[$currency] ?? 2, $baseScale);
            $difference = $revalued - $carried;
            $evidence[] = [
                ...$key, 'amount_fc' => $fc, 'closing_rate' => $quote->rate, 'rate_date' => $quote->date, 'rate_source' => $quote->source,
                'carried_base' => $carried, 'revalued_base' => $revalued, 'unrealised' => $difference,
            ];
            if ($difference !== 0) {
                $items[] = new RevaluationItem((string) $r->account_id, (string) $r->code, (string) $r->name, $currency, $fc, $quote->rate, $difference, $contact);
            }
        }

        return new RevaluationPlan($asOf, $baseCurrency, $items, $evidence, array_values($missing), $residuals);
    }
}
