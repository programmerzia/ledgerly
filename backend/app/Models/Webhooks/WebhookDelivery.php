<?php

declare(strict_types=1);

namespace App\Models\Webhooks;

use App\Models\BaseModel;
use Carbon\CarbonImmutable;

/**
 * One outbox message for one endpoint (UNIQUE endpoint_id + message_id). `payload` is the signed envelope.
 *
 * @property string $id
 * @property string $tenant_id
 * @property string $endpoint_id
 * @property string $message_id
 * @property string $event_type
 * @property array<string, mixed> $payload
 * @property string $status pending|delivered|failed|cancelled
 * @property int $attempts
 * @property CarbonImmutable $window_started_at
 * @property CarbonImmutable|null $next_retry_at
 * @property CarbonImmutable|null $last_attempt_at
 * @property CarbonImmutable|null $delivered_at
 * @property int|null $response_code
 * @property string|null $response_snippet
 * @property string|null $error
 * @property CarbonImmutable $created_at
 */
class WebhookDelivery extends BaseModel
{
    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'payload' => 'array', 'attempts' => 'integer', 'response_code' => 'integer',
            'window_started_at' => 'immutable_datetime', 'next_retry_at' => 'immutable_datetime',
            'last_attempt_at' => 'immutable_datetime', 'delivered_at' => 'immutable_datetime',
            'created_at' => 'immutable_datetime', 'updated_at' => 'immutable_datetime',
        ];
    }
}
