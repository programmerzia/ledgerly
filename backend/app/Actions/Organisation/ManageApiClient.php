<?php

declare(strict_types=1);

namespace App\Actions\Organisation;

use App\Actions\Organisation\Inputs\ApiClientInput;
use App\Contracts\Clock;
use App\Contracts\IdGenerator;
use App\Domain\Organisation\ApiTokenAbilities;
use App\Domain\Shared\DomainRuleViolation;
use App\Models\Organisation\ApiClient;
use App\Models\Organisation\Company;
use App\Support\Actor;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;
use App\Support\UnitOfWork\UnitOfWork;
use Laravel\Sanctum\NewAccessToken;

/**
 * API clients and their tokens (organisation owners and admins, people only). A token carries abilities from the fixed
 * list (`ApiTokenAbilities`: never approve, return, reverse, void, close or sign) and works only in the companies the
 * client was issued for. The plain token is returned once, by the call that creates it; only its hash is stored, and the
 * audit trail records names, abilities and expiry, never the secret. Revoking a client deletes its tokens at once.
 */
final class ManageApiClient
{
    public function __construct(private readonly UnitOfWork $uow, private readonly IdGenerator $ids, private readonly Clock $clock) {}

    /** @return array{ApiClient, NewAccessToken} */
    public function create(Actor $actor, ApiClientInput $in): array
    {
        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $in) {
            OrganisationAdmin::require($actor, 'Only organisation owners and admins can manage API clients.');
            $this->validate($in);

            $client = new ApiClient;
            $client->forceFill([
                'id' => $this->ids->next(), 'tenant_id' => $actor->tenantId, 'name' => $in->name,
                'company_ids' => array_values(array_unique($in->companyIds)), 'created_by' => (string) $actor->id,
            ])->save();
            $audit->add('api_client.created', $client, after: $client, context: ['abilities' => $in->abilities]);
            $token = $this->issue($client, $in, $audit);

            return [$client->refresh(), $token];
        });
    }

    /** Another token for an existing client (rotation: issue the new one, then revoke the old by revoking and re-creating, or let it expire). */
    public function issueToken(Actor $actor, string $clientId, ApiClientInput $in): NewAccessToken
    {
        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $clientId, $in) {
            OrganisationAdmin::require($actor, 'Only organisation owners and admins can manage API clients.');
            $client = ApiClient::query()->whereKey($clientId)->lockForUpdate()->firstOrFail();
            if ($client->revoked_at !== null) {
                throw DomainRuleViolation::single('api_client_revoked', 'The API client is revoked.');
            }
            $this->checkAbilities($in->abilities);
            $this->checkExpiry($in);

            return $this->issue($client, $in, $audit);
        });
    }

    public function revoke(Actor $actor, string $clientId): ApiClient
    {
        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $clientId) {
            OrganisationAdmin::require($actor, 'Only organisation owners and admins can manage API clients.');
            $client = ApiClient::query()->whereKey($clientId)->lockForUpdate()->firstOrFail();
            if ($client->revoked_at !== null) {
                return $client;
            }
            $before = $client->attributesToArray();
            $client->forceFill(['revoked_at' => $this->clock->now()])->save();
            $revoked = $client->tokens()->delete();
            $audit->add('api_client.revoked', $client, before: $before, after: $client->refresh(), context: ['tokens_deleted' => $revoked]);

            return $client;
        });
    }

    private function issue(ApiClient $client, ApiClientInput $in, AuditBuffer $audit): NewAccessToken
    {
        $token = $client->createToken($in->tokenName, $in->abilities, $in->expiresAt);
        $audit->add('api_client.token_issued', $client, context: [
            'token_name' => $in->tokenName, 'abilities' => $in->abilities, 'expires_at' => $in->expiresAt?->format('Y-m-d\TH:i:s\Z'),
        ]);

        return $token;
    }

    private function validate(ApiClientInput $in): void
    {
        $this->checkAbilities($in->abilities);
        $this->checkExpiry($in);
        $ids = array_values(array_unique($in->companyIds));
        if ($ids === [] || Company::query()->whereIn('id', $ids)->where('status', 'active')->count() !== count($ids)) {
            throw DomainRuleViolation::single('api_client_companies_invalid', 'Choose at least one company of this organisation, and only active ones.');
        }
    }

    /** @param list<string> $abilities */
    private function checkAbilities(array $abilities): void
    {
        $unknown = ApiTokenAbilities::unknown($abilities);
        if ($abilities === [] || $unknown !== []) {
            throw DomainRuleViolation::single('api_token_ability_invalid', $unknown === [] ? 'Give the token at least one ability.' : 'A token cannot carry: '.implode(', ', $unknown).'.');
        }
    }

    private function checkExpiry(ApiClientInput $in): void
    {
        if ($in->expiresAt !== null && $in->expiresAt <= $this->clock->now()) {
            throw DomainRuleViolation::single('api_token_expiry_invalid', 'The expiry must be in the future.');
        }
    }
}
