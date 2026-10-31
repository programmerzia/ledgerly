<?php

declare(strict_types=1);

namespace App\Actions\Organisation;

use App\Actions\Organisation\Inputs\RegisterOrganisationInput;
use App\Contracts\Clock;
use App\Domain\Shared\DomainRuleViolation;
use App\Models\Platform\Tenant;
use App\Models\Platform\TenantUser;
use App\Models\Platform\User;
use App\Support\Actor;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;
use App\Support\UnitOfWork\UnitOfWork;
use Illuminate\Support\Str;
use LogicException;

/**
 * Sign-up (02_AppFlow §2): a new user, their organisation (trial) and the owner membership, in one
 * transaction. The first company is created by the onboarding wizard (`CreateCompany`).
 */
final class RegisterOrganisation
{
    public function __construct(private readonly UnitOfWork $uow, private readonly Clock $clock) {}

    public function handle(Actor $actor, RegisterOrganisationInput $in): User
    {
        if ($actor->tenantId !== $in->tenantId || $actor->id !== $in->userId) {
            throw new LogicException('Registration must run as the new owner inside the new tenant.');
        }

        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($in) {
            $email = mb_strtolower($in->email);
            if (User::query()->whereRaw('lower(email) = ?', [$email])->exists()) {
                throw DomainRuleViolation::single('email_taken', 'An account with this email already exists. Sign in instead.');
            }

            $tenant = new Tenant;
            $tenant->forceFill([
                'id' => $in->tenantId,
                'name' => $in->organisationName,
                'slug' => $this->uniqueSlug($in->organisationName),
                'lifecycle' => 'trial',
            ])->save();

            $user = new User;
            $user->forceFill([
                'id' => $in->userId,
                'name' => $in->name,
                'email' => $email,
                'password' => $in->passwordHash,
            ])->save();

            (new TenantUser)->forceFill([
                'tenant_id' => $tenant->id,
                'user_id' => $user->id,
                'role' => 'owner',
                'status' => 'active',
                'joined_at' => $this->clock->now(),
            ])->save();

            $audit->add('organisation.registered', $tenant, after: [
                'name' => $tenant->name, 'slug' => $tenant->slug, 'owner_id' => $user->id,
            ]);

            return $user;
        });
    }

    private function uniqueSlug(string $name): string
    {
        $base = Str::limit(Str::slug($name), 48, '') ?: 'organisation';
        $slug = $base;
        while (Tenant::query()->where('slug', $slug)->exists()) {
            $slug = $base.'-'.Str::lower(Str::random(5));
        }

        return $slug;
    }
}
