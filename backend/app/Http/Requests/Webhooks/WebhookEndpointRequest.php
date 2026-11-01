<?php

declare(strict_types=1);

namespace App\Http\Requests\Webhooks;

use App\Actions\Webhooks\Inputs\WebhookEndpointInput;
use App\Support\Webhooks\SsrfGuard;
use App\Support\Webhooks\UnsafeWebhookTarget;
use App\Support\Webhooks\WebhookEvents;
use Closure;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/** Create or update an endpoint. `version` is required on update (the route has a webhook id). */
final class WebhookEndpointRequest extends FormRequest
{
    /** Authorization is the route's policy and the Action's role check. */
    public function authorize(): bool
    {
        return true;
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        $guard = app(SsrfGuard::class);

        return [
            'url' => ['required', 'string', 'max:2048', function (string $attribute, mixed $value, Closure $fail) use ($guard): void {
                try {
                    $guard->assertShape((string) $value);
                } catch (UnsafeWebhookTarget $e) {
                    $fail($e->getMessage());
                }
            }],
            'description' => ['nullable', 'string', 'max:255'],
            'events' => ['required', 'array', 'min:1', 'max:50'],
            'events.*' => ['required', 'string', 'distinct', Rule::in(WebhookEvents::subscribable())],
            'version' => [$this->route('webhook') === null ? 'prohibited' : 'required', 'integer', 'min:0'],
        ];
    }

    public function version(): int
    {
        return (int) $this->validated()['version'];
    }

    public function toInput(): WebhookEndpointInput
    {
        $v = $this->validated();

        /** @var list<string> $events */
        $events = array_values(array_map('strval', (array) $v['events']));

        return new WebhookEndpointInput((string) $v['url'], $events, isset($v['description']) ? (string) $v['description'] : null);
    }
}
