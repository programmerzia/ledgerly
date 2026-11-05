<?php

declare(strict_types=1);

namespace App\Actions\Organisation;

use App\Domain\Shared\DomainRuleViolation;
use App\Models\Platform\Tenant;
use App\Support\Actor;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;
use App\Support\UnitOfWork\UnitOfWork;

/** Changes the organisation's display name (plan 3c.26). The slug stays: links and sign-in addresses keep working. Owners and admins only. */
final class RenameOrganisation
{
    public const int MAX_NAME = 120;

    public function __construct(private readonly UnitOfWork $uow) {}

    public function handle(Actor $actor, string $name): Tenant
    {
        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $name) {
            OrganisationAdmin::require($actor, 'Only organisation owners and admins can change the organisation.');
            $name = trim((string) preg_replace('/\s+/', ' ', $name));
            if ($name === '' || mb_strlen($name) > self::MAX_NAME) {
                throw DomainRuleViolation::single('organisation_name_invalid', 'The name is 1 to '.self::MAX_NAME.' characters.');
            }

            $tenant = Tenant::query()->whereKey($actor->tenantId)->lockForUpdate()->firstOrFail();
            if ($tenant->name === $name) {
                return $tenant;
            }
            $before = ['name' => $tenant->name];
            $tenant->forceFill(['name' => $name])->save();
            $audit->add('organisation.renamed', $tenant, before: $before, after: ['name' => $name]);

            return $tenant;
        });
    }
}
