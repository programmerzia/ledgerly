<?php

declare(strict_types=1);

namespace App\Models\Fiscal;

use App\Domain\Fiscal\CloseCheckStatus;
use App\Models\BaseModel;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Outcome of one pre-close check of a fiscal period (13 §10). Unique per (period, check_code);
 * a failing check can be waived by a user with permission.
 *
 * @property string $id
 * @property string $tenant_id
 * @property string $company_id
 * @property string $fiscal_period_id
 * @property string $check_code
 * @property CloseCheckStatus $status
 * @property array<string, mixed>|null $detail
 * @property CarbonImmutable $checked_at
 * @property string|null $waived_by
 * @property string|null $waived_reason
 * @property-read FiscalPeriod $fiscalPeriod
 */
class PeriodCloseCheck extends BaseModel
{
    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'status' => CloseCheckStatus::class,
            'detail' => 'array',
            'checked_at' => 'immutable_datetime',
        ];
    }

    /** @return BelongsTo<FiscalPeriod, $this> */
    public function fiscalPeriod(): BelongsTo
    {
        return $this->belongsTo(FiscalPeriod::class);
    }
}
