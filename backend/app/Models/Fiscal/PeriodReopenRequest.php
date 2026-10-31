<?php

declare(strict_types=1);

namespace App\Models\Fiscal;

use App\Domain\Fiscal\ReopenRequestStatus;
use App\Models\BaseModel;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Request to reopen a closed period (13 §10): two distinct approvers, neither the requester, each
 * signed. The database allows one pending request per period.
 *
 * @property string $id
 * @property string $tenant_id
 * @property string $company_id
 * @property string $fiscal_period_id
 * @property string $requested_by
 * @property string $reason
 * @property ReopenRequestStatus $status
 * @property string|null $first_approver
 * @property CarbonImmutable|null $first_signed_at
 * @property string|null $second_approver
 * @property CarbonImmutable|null $second_signed_at
 * @property CarbonImmutable|null $decided_at
 * @property string|null $decision_comment
 * @property-read FiscalPeriod $fiscalPeriod
 */
class PeriodReopenRequest extends BaseModel
{
    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'status' => ReopenRequestStatus::class,
            'first_signed_at' => 'immutable_datetime',
            'second_signed_at' => 'immutable_datetime',
            'decided_at' => 'immutable_datetime',
        ];
    }

    /** @return BelongsTo<FiscalPeriod, $this> */
    public function fiscalPeriod(): BelongsTo
    {
        return $this->belongsTo(FiscalPeriod::class);
    }
}
