<?php

declare(strict_types=1);

namespace App\Models\Notifications;

use App\Models\BaseModel;
use Carbon\CarbonImmutable;

/**
 * One in-app notification for one person in one company.
 *
 * @property string $id
 * @property string $tenant_id
 * @property string $company_id
 * @property string $user_id
 * @property string $kind
 * @property string $title
 * @property string|null $body
 * @property string|null $subject_type
 * @property string|null $subject_id
 * @property string|null $link
 * @property string $dedupe_key
 * @property CarbonImmutable|null $read_at
 * @property CarbonImmutable $created_at
 */
class UserNotification extends BaseModel
{
    public $timestamps = false;

    /** @return array<string, string> */
    protected function casts(): array
    {
        return ['read_at' => 'immutable_datetime', 'created_at' => 'immutable_datetime'];
    }
}
