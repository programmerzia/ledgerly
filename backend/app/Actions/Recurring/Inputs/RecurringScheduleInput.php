<?php

declare(strict_types=1);

namespace App\Actions\Recurring\Inputs;

use App\Domain\Recurring\Frequency;
use DateTimeImmutable;

final readonly class RecurringScheduleInput
{
    public function __construct(
        public string $companyId,
        public string $name,
        public Frequency $frequency,
        public DateTimeImmutable $nextDate,
        /** Creating only: the posted invoice, bill or journal to copy. */
        public ?string $templateId = null,
        public ?DateTimeImmutable $endDate = null,
        /** The maker of the drafts; default: the person creating the schedule. */
        public ?string $ownerId = null,
    ) {}
}
