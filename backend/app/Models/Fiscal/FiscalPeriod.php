<?php

declare(strict_types=1);

namespace App\Models\Fiscal;

use App\Domain\Fiscal\PeriodKind;
use App\Domain\Fiscal\PeriodStatus;
use App\Domain\Ledger\PeriodInfo;
use App\Models\BaseModel;
use DateTimeImmutable;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * @property string $id
 * @property string $company_id
 * @property string $fiscal_year_id
 * @property int $number
 * @property string $name
 * @property string $kind
 * @property DateTimeImmutable $starts_on
 * @property DateTimeImmutable $ends_on
 * @property PeriodStatus $status
 * @property-read FiscalYear $fiscalYear
 */
class FiscalPeriod extends BaseModel
{
    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'starts_on' => 'immutable_date',
            'ends_on' => 'immutable_date',
            'status' => PeriodStatus::class,
            'number' => 'integer',
        ];
    }

    /** @return BelongsTo<FiscalYear, $this> */
    public function fiscalYear(): BelongsTo
    {
        return $this->belongsTo(FiscalYear::class);
    }

    public function toInfo(): PeriodInfo
    {
        return new PeriodInfo($this->id, $this->status, PeriodKind::from($this->kind), $this->starts_on, $this->ends_on);
    }
}
