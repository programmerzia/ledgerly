<?php

declare(strict_types=1);

namespace App\Models\Webhooks;

use App\Models\BaseModel;
use App\Models\Casts\PgTextArray;
use Carbon\CarbonImmutable;

/**
 * An organisation's webhook receiver. `secret` is encrypted at rest and hidden from every array/JSON
 * form (audit included); only the create and rotate responses reveal it, once.
 *
 * @property string $id
 * @property string $tenant_id
 * @property string $url
 * @property string|null $description
 * @property string $secret
 * @property list<string> $events
 * @property bool $is_active
 * @property CarbonImmutable|null $disabled_at
 * @property string|null $disabled_reason
 * @property CarbonImmutable|null $secret_rotated_at
 * @property string|null $created_by
 * @property int $lock_version
 * @property CarbonImmutable $created_at
 */
class WebhookEndpoint extends BaseModel
{
    /** @var list<string> */
    protected $hidden = ['secret'];

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'secret' => 'encrypted', 'events' => PgTextArray::class, 'is_active' => 'boolean',
            'disabled_at' => 'immutable_datetime', 'secret_rotated_at' => 'immutable_datetime',
            'created_at' => 'immutable_datetime', 'updated_at' => 'immutable_datetime',
        ];
    }

    public function subscribesTo(string $type): bool
    {
        return in_array('*', $this->events, true) || in_array($type, $this->events, true);
    }
}
