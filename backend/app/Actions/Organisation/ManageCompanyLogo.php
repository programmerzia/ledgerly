<?php

declare(strict_types=1);

namespace App\Actions\Organisation;

use App\Actions\Ledger\SetupGuard;
use App\Domain\Shared\DomainRuleViolation;
use App\Models\Organisation\Company;
use App\Services\Documents\LogoStore;
use App\Support\Actor;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;
use App\Support\UnitOfWork\UnitOfWork;

/**
 * The company logo printed on documents (plan 3c.4; `settings.manage`, people only). PNG or JPEG up to 512 KB, checked from
 * the bytes by {@see LogoStore}. Replacing or removing it deletes the old file after the transaction commits.
 */
final class ManageCompanyLogo
{
    public function __construct(private readonly UnitOfWork $uow, private readonly SetupGuard $guard, private readonly LogoStore $logos) {}

    public function set(Actor $actor, string $companyId, string $bytes): Company
    {
        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $companyId, $bytes) {
            $this->allow($actor, $companyId);
            $company = Company::query()->whereKey($companyId)->lockForUpdate()->firstOrFail();
            $old = $company->getAttribute('logo_path');

            $stored = $this->logos->put($actor->tenantId, $companyId, $bytes);
            $company->forceFill(['logo_path' => $stored['path']])->save();
            $audit->add('company.logo_updated', $company, context: ['mime' => $stored['mime'], 'bytes' => strlen($bytes)]);
            $this->uow->afterCommit(fn () => $this->logos->delete(is_string($old) ? $old : null));

            return $company;
        });
    }

    public function remove(Actor $actor, string $companyId): Company
    {
        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $companyId) {
            $this->allow($actor, $companyId);
            $company = Company::query()->whereKey($companyId)->lockForUpdate()->firstOrFail();
            $old = $company->getAttribute('logo_path');
            if ($old === null) {
                return $company;
            }
            $company->forceFill(['logo_path' => null])->save();
            $audit->add('company.logo_removed', $company);
            $this->uow->afterCommit(fn () => $this->logos->delete(is_string($old) ? $old : null));

            return $company;
        });
    }

    private function allow(Actor $actor, string $companyId): void
    {
        if ($actor->isApiClient()) {
            throw DomainRuleViolation::single('forbidden', 'The logo is changed by people.');
        }
        $this->guard->require($actor, 'settings.manage', $companyId);
    }
}
