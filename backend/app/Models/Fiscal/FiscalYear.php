<?php

declare(strict_types=1);

namespace App\Models\Fiscal;

use App\Models\BaseModel;
use DateTimeImmutable;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * @property string $id
 * @property string $company_id
 * @property string $name
 * @property DateTimeImmutable $starts_on
 * @property DateTimeImmutable $ends_on
 * @property string $status
 * @property string $calendar monthly, 4-4-5, 4-5-4 or 5-4-4 (App\Domain\Fiscal\CalendarType)
 * @property int|null $extra_week_period the period that has a 53rd week; null for 52 weeks or a monthly year
 * @property-read Collection<int, FiscalPeriod> $periods
 */
class FiscalYear extends BaseModel
{
    /** @return array<string, string> */
    protected function casts(): array
    {
        return ['starts_on' => 'immutable_date', 'ends_on' => 'immutable_date'];
    }

    /** @return HasMany<FiscalPeriod, $this> */
    public function periods(): HasMany
    {
        return $this->hasMany(FiscalPeriod::class)->orderByRaw("kind = 'adjustment'")->orderBy('number');
    }
}
