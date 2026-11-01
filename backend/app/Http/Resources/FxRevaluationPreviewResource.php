<?php

declare(strict_types=1);

namespace App\Http\Resources;

use App\Http\Support\Json;
use App\Queries\Fx\RevaluationPreview;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin RevaluationPreview */
final class FxRevaluationPreviewResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        $base = $this->plan->baseCurrency;

        return [
            'fiscal_period_id' => $this->periodId,
            'as_of' => $this->plan->asOf,
            'can_run' => $this->canRun(),
            'blockers' => $this->blockers,
            'existing_revaluation_id' => $this->existingRevaluationId,
            'total_unrealised' => Json::money($this->plan->total(), $base),
            'items' => self::rows($this->plan->rows, $base),
            'residuals' => self::residuals($this->plan->residuals, $base),
            'missing_rates' => $this->plan->missingRates,
        ];
    }

    /**
     * @param  list<array<string, mixed>>  $rows
     * @return list<array<string, mixed>>
     */
    public static function rows(array $rows, string $base): array
    {
        return array_map(static fn (array $r): array => [
            'account_id' => $r['account_id'], 'account_code' => $r['account_code'], 'contact_id' => $r['contact_id'],
            'currency' => $r['currency'],
            'amount_fc' => Json::money((int) $r['amount_fc'], (string) $r['currency']),
            'closing_rate' => $r['closing_rate'], 'rate_date' => $r['rate_date'], 'rate_source' => $r['rate_source'],
            'carried_base' => Json::money((int) $r['carried_base'], $base),
            'revalued_base' => Json::money((int) $r['revalued_base'], $base),
            'unrealised' => Json::money((int) $r['unrealised'], $base),
        ], $rows);
    }

    /**
     * @param  list<array<string, mixed>>  $residuals
     * @return list<array<string, mixed>>
     */
    public static function residuals(array $residuals, string $base): array
    {
        return array_map(static fn (array $r): array => [
            'account_id' => $r['account_id'], 'account_code' => $r['account_code'], 'contact_id' => $r['contact_id'],
            'currency' => $r['currency'], 'carried_base' => Json::money((int) $r['carried_base'], $base),
        ], $residuals);
    }
}
