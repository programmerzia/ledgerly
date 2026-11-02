<?php

declare(strict_types=1);

namespace App\Models\Recurring;

use App\Domain\Recurring\Frequency;
use App\Models\BaseModel;
use DateTimeImmutable;

/**
 * What an invoice/bill schedule and a journal schedule share.
 *
 * @property string $id
 * @property string $tenant_id
 * @property string $company_id
 * @property string $name
 * @property Frequency $frequency
 * @property int $anchor_day
 * @property DateTimeImmutable $next_date
 * @property DateTimeImmutable|null $end_date
 * @property string $owner_id the maker of every draft it creates
 * @property bool $is_active
 * @property DateTimeImmutable|null $last_run_on
 * @property string|null $last_error
 * @property int $lock_version
 */
abstract class RecurringSchedule extends BaseModel
{
    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'frequency' => Frequency::class, 'anchor_day' => 'integer', 'next_date' => 'immutable_date', 'end_date' => 'immutable_date',
            'is_active' => 'boolean', 'last_run_on' => 'immutable_date', 'lock_version' => 'integer',
        ];
    }

    /** The key of `recurring_runs.schedule_type`. */
    abstract public function scheduleType(): string;

    abstract public function templateId(): string;
}
