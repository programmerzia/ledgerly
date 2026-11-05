<?php

declare(strict_types=1);

namespace App\Http\Resources;

use App\Http\Support\Json;
use App\Models\Transactions\ProvisionRun;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A provisioning run. `buckets` is the stored detail: per aging bucket the receivable balance, the rate and the allowance it needs. All
 * amounts are in the company's base currency; `difference` is signed (positive raises the allowance).
 *
 * @mixin ProvisionRun
 */
final class ProvisionRunResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        $base = Json::baseCurrency($request);

        return [
            'id' => $this->id,
            'number' => $this->number,
            'status' => $this->status->value,
            'fiscal_period_id' => $this->fiscal_period_id,
            'as_of' => Json::date($this->as_of),
            'required' => Json::money($this->required, $base),
            'existing' => Json::money($this->existing, $base),
            'difference' => Json::money($this->difference, $base),
            'buckets' => self::buckets((array) ($this->detail['rows'] ?? []), $base),
            'memo' => $this->memo,
            'journal_id' => $this->journal_id,
            'reversal_journal_id' => $this->reversal_journal_id,
            'created_by' => $this->created_by,
            'submitted_by' => $this->submitted_by,
            'approved_by' => $this->approved_by,
            'posted_by' => $this->posted_by,
            'posted_at' => Json::time($this->posted_at),
            'version' => $this->lock_version,
            'can' => Json::can($request, $this->resource, ['submit' => 'submit', 'approve' => 'approve', 'return' => 'return', 'void' => 'void', 'reverse' => 'reverse']),
        ];
    }

    /**
     * @param  array<int, array<string, mixed>>  $rows
     * @return list<array<string, mixed>>
     */
    public static function buckets(array $rows, string $base): array
    {
        return array_values(array_map(fn (array $r): array => [
            'bucket' => (string) $r['bucket'], 'label' => (string) $r['label'], 'balance' => Json::money((int) $r['balance'], $base),
            'rate_pct' => (string) $r['rate_pct'], 'amount' => Json::money((int) $r['amount'], $base),
        ], $rows));
    }
}
