<?php

declare(strict_types=1);

namespace App\Http\Requests\Webhooks;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/** Filter of GET /webhook-endpoints/{id}/deliveries: `status`; paging is handled by CursorPage. */
final class ListWebhookDeliveriesRequest extends FormRequest
{
    /** Authorization is the route's policy. */
    public function authorize(): bool
    {
        return true;
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return ['status' => ['nullable', 'string', Rule::in(['pending', 'delivered', 'failed', 'cancelled'])]];
    }

    public function status(): ?string
    {
        $v = $this->validated();

        return isset($v['status']) ? (string) $v['status'] : null;
    }
}
