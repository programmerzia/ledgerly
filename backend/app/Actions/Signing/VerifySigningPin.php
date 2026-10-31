<?php

declare(strict_types=1);

namespace App\Actions\Signing;

use App\Actions\Signing\Inputs\VerifySigningPinInput;
use App\Contracts\Clock;
use App\Domain\Shared\DomainRuleViolation;
use App\Domain\Signing\PinPolicy;
use App\Models\Platform\User;
use App\Support\Actor;
use App\Support\ActorType;
use App\Support\Audit\DetachedAudit;
use App\Support\Signing\SigningEvents;
use App\Support\Signing\SigningGrants;
use DateTimeImmutable;
use Illuminate\Contracts\Hashing\Hasher;
use Illuminate\Database\DatabaseManager;

/**
 * `POST /signing/verify` (ADR-0004, 13 §10): argon2id check of the PIN. Three failures lock
 * signing for 15 minutes; the failure counter lives on the user row and is updated in its own short
 * transaction, so it survives the error response. Success stores a grant for this session.
 *
 * This is not a UnitOfWork: it changes no ledger data, and its evidence must outlive a failure.
 */
final class VerifySigningPin
{
    public function __construct(
        private readonly DatabaseManager $db,
        private readonly Hasher $hasher,
        private readonly Clock $clock,
        private readonly SigningGrants $grants,
        private readonly SigningEvents $events,
        private readonly DetachedAudit $audit,
    ) {}

    /** @return DateTimeImmutable when the grant expires */
    public function handle(Actor $actor, VerifySigningPinInput $in): DateTimeImmutable
    {
        if ($actor->type !== ActorType::User || $actor->id === null) {
            throw DomainRuleViolation::single('forbidden', 'Only a person can sign.');
        }
        $now = $this->clock->now();

        $outcome = $this->db->connection()->transaction(function () use ($actor, $in, $now): string {
            $user = User::query()->whereKey($actor->id)->lockForUpdate()->firstOrFail();
            if ($user->signing_pin_hash === null) {
                return 'unset';
            }
            if ($user->signing_locked_until !== null && $user->signing_locked_until > $now) {
                return 'locked';
            }
            if (! $this->hasher->check($in->pin, $user->signing_pin_hash)) {
                $failures = $user->signing_failed_count + 1;
                $locked = $failures >= PinPolicy::MAX_FAILURES;
                $user->forceFill([
                    'signing_failed_count' => $locked ? 0 : $failures,
                    'signing_locked_until' => $locked ? $now->modify('+'.PinPolicy::LOCKOUT_MINUTES.' minutes') : null,
                ])->save();

                return $locked ? 'lockout' : 'failure';
            }
            if ($user->signing_failed_count !== 0 || $user->signing_locked_until !== null) {
                $user->forceFill(['signing_failed_count' => 0, 'signing_locked_until' => null])->save();
            }

            return 'success';
        });

        switch ($outcome) {
            case 'unset':
                throw DomainRuleViolation::single('signing_pin_not_set', 'Set a signing PIN in Settings → Security first.');
            case 'locked':
                throw DomainRuleViolation::single('signing_locked', 'Signing is locked after repeated failures. Try again in a few minutes.');
            case 'failure':
            case 'lockout':
                $this->events->record($actor->id, $outcome, $actor->ip);
                $this->audit->record($actor, 'signing.failed', context: ['lockout' => $outcome === 'lockout']);
                throw DomainRuleViolation::single(
                    $outcome === 'lockout' ? 'signing_locked' : 'signing_failed',
                    $outcome === 'lockout' ? 'Wrong PIN. Signing is now locked for 15 minutes.' : 'Wrong PIN.',
                );
        }

        $this->grants->grant($actor->id, $in->sessionId);
        $this->events->record($actor->id, 'success', $actor->ip);

        return $now->modify('+'.PinPolicy::GRANT_MINUTES.' minutes');
    }
}
