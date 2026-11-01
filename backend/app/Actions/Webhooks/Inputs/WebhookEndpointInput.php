<?php

declare(strict_types=1);

namespace App\Actions\Webhooks\Inputs;

final readonly class WebhookEndpointInput
{
    /** @param list<string> $events */
    public function __construct(public string $url, public array $events, public ?string $description = null) {}
}
