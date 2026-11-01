<?php

declare(strict_types=1);

namespace App\Policies\Webhooks;

use App\Models\Platform\User;
use App\Models\Webhooks\WebhookEndpoint;
use App\Policies\PolicyContext;
use Illuminate\Contracts\Auth\Authenticatable;

/**
 * Webhook endpoints are organisation-level (13 §7, like API clients): owners and admins, people only. The type
 * check below denies an API client token. The Actions check the role again.
 */
final class WebhookEndpointPolicy
{
    public function __construct(private readonly PolicyContext $context) {}

    public function viewAny(Authenticatable $principal): bool
    {
        return $this->isAdminPerson($principal);
    }

    public function create(Authenticatable $principal): bool
    {
        return $this->isAdminPerson($principal);
    }

    public function update(Authenticatable $principal, WebhookEndpoint $endpoint): bool
    {
        return $this->isAdminPerson($principal);
    }

    public function viewDeliveries(Authenticatable $principal, WebhookEndpoint $endpoint): bool
    {
        return $this->isAdminPerson($principal);
    }

    public function redeliver(Authenticatable $principal, WebhookEndpoint $endpoint): bool
    {
        return $this->isAdminPerson($principal) && $endpoint->is_active;
    }

    private function isAdminPerson(Authenticatable $principal): bool
    {
        return $principal instanceof User && $this->context->isOrgAdmin($principal);
    }
}
