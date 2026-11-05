<?php

declare(strict_types=1);

namespace App\Models\Trade;

use App\Models\BaseModel;

/**
 * One step of a company's overdue-invoice reminders: send this wording `days_after_due` days after the due date.
 *
 * @property string $id
 * @property string $tenant_id
 * @property string $company_id
 * @property int $days_after_due
 * @property string $subject
 * @property string $body
 */
class DunningStage extends BaseModel
{
    protected $table = 'dunning_stages';

    /** @return array<string, string> */
    protected function casts(): array
    {
        return ['days_after_due' => 'integer'];
    }
}
