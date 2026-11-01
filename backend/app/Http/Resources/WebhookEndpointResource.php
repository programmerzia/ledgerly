<?php

declare(strict_types=1);

namespace App\Http\Resources;

use App\Http\Support\Json;
use App\Models\Webhooks\WebhookEndpoint;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * @mixin WebhookEndpoint
 *
 * The signing secret appears only in the create and rotate responses (`revealingSecret`), never in a read.
 */
final class WebhookEndpointResource extends JsonResource
{
    private bool $reveal = false;

    public function revealingSecret(): self
    {
        $this->reveal = true;

        return $this;
    }

    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'url' => $this->url,
            'description' => $this->description,
            'events' => $this->events,
            'is_active' => $this->is_active,
            'disabled_at' => Json::time($this->disabled_at),
            'disabled_reason' => $this->disabled_reason,
            'secret_rotated_at' => Json::time($this->secret_rotated_at),
            'created_at' => Json::time($this->created_at),
            'version' => $this->lock_version,
            'secret' => $this->when($this->reveal, fn (): string => $this->secret),
            'can' => Json::can($request, $this->resource, ['update' => 'update', 'view_deliveries' => 'viewDeliveries', 'redeliver' => 'redeliver']),
        ];
    }
}
