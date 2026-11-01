<?php

declare(strict_types=1);

namespace App\Http\Resources;

use App\Http\Support\Json;
use App\Models\Webhooks\WebhookDelivery;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin WebhookDelivery */
final class WebhookDeliveryResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'endpoint_id' => $this->endpoint_id,
            'event_id' => $this->message_id,
            'event_type' => $this->event_type,
            'status' => $this->status,
            'attempts' => $this->attempts,
            'next_retry_at' => Json::time($this->next_retry_at),
            'last_attempt_at' => Json::time($this->last_attempt_at),
            'delivered_at' => Json::time($this->delivered_at),
            'response_code' => $this->response_code,
            'response_snippet' => $this->response_snippet,
            'error' => $this->error,
            'created_at' => Json::time($this->created_at),
        ];
    }
}
