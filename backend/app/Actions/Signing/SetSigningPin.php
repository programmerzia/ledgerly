<?php

declare(strict_types=1);

namespace App\Actions\Signing;

use App\Actions\Signing\Inputs\SetSigningPinInput;
use App\Contracts\Clock;
use App\Domain\Shared\DomainRuleViolation;
use App\Domain\Shared\Violation;
use App\Domain\Signing\PinPolicy;
use App\Models\Platform\User;
use App\Support\Actor;
use App\Support\ActorType;
use App\Support\Signing\SigningEvents;
use App\Support\Signing\SigningGrants;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;
use App\Support\UnitOfWork\UnitOfWork;
use Illuminate\Contracts\Hashing\Hasher;

/**
 * Sets or changes the actor's signing PIN (ADR-0004). The controller has already re-confirmed the
 * password. A changed PIN clears the lockout and revokes the session's grant: whoever holds the
 * new PIN signs afresh.
 */
final class SetSigningPin
{
    public function __construct(
        private readonly UnitOfWork $uow,
        private readonly Hasher $hasher,
        private readonly Clock $clock,
        private readonly SigningGrants $grants,
        private readonly SigningEvents $events,
    ) {}

    public function handle(Actor $actor, SetSigningPinInput $in): void
    {
        if ($actor->type !== ActorType::User || $actor->id === null) {
            throw DomainRuleViolation::single('forbidden', 'Only a person can have a signing PIN.');
        }
        $codes = PinPolicy::violations($in->pin);
        if ($codes !== []) {
            throw new DomainRuleViolation('pin_policy', 'Choose six digits that are not all the same or in a row.', array_map(
                fn (string $c) => new Violation($c, 'The PIN does not meet the policy.'), $codes,
            ));
        }

        $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $in): void {
            $user = User::query()->whereKey($actor->id)->lockForUpdate()->firstOrFail();
            $first = $user->signing_pin_hash === null;
            $user->forceFill([
                'signing_pin_hash' => $this->hasher->make($in->pin),
                'signing_pin_set_at' => $this->clock->now(),
                'signing_failed_count' => 0,
                'signing_locked_until' => null,
            ])->save();
            $audit->add($first ? 'signing.pin_set' : 'signing.pin_changed', null, context: ['user_id' => $user->id]);
        });

        $this->grants->revoke($actor->id, $in->sessionId);
        $this->events->record($actor->id, 'pin_changed', $actor->ip);
    }
}
