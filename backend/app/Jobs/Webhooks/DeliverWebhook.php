<?php

declare(strict_types=1);

namespace App\Jobs\Webhooks;

use App\Support\Tenancy\TenantAware;
use App\Support\Tenancy\WithTenantContext;
use App\Support\Webhooks\WebhookDeliverer;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;

/**
 * One delivery attempt (13 §15). Retries are not queue retries: a failed attempt stores its own `next_retry_at`
 * and the `webhooks:sweep` scheduler queues the job again when it is due, so nothing waits in the queue for hours.
 */
final class DeliverWebhook implements ShouldQueue, TenantAware
{
    use Queueable;

    public int $tries = 1;

    public int $timeout = 30;

    public function __construct(public readonly string $tenant, public readonly string $deliveryId)
    {
        $this->onQueue('webhooks');
    }

    public function tenantId(): string
    {
        return $this->tenant;
    }

    public function companyId(): ?string
    {
        return null;
    }

    /** @return list<object> */
    public function middleware(): array
    {
        return [app(WithTenantContext::class)];
    }

    public function handle(WebhookDeliverer $deliverer): void
    {
        $deliverer->deliver($this->tenant, $this->deliveryId);
    }
}
