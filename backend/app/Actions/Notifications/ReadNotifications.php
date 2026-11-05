<?php

declare(strict_types=1);

namespace App\Actions\Notifications;

use App\Contracts\Clock;
use App\Domain\Shared\DomainRuleViolation;
use App\Models\Notifications\UserNotification;
use App\Support\Actor;
use App\Support\ActorType;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;
use App\Support\UnitOfWork\UnitOfWork;
use Illuminate\Database\Eloquent\Builder;

/**
 * Marks the signed-in person's own notifications read (plan 3c.6). Only the person's rows in the company are touched; someone
 * else's id is a plain "not found". Reading twice changes nothing, so it needs no audit event.
 */
final class ReadNotifications
{
    public function __construct(private readonly UnitOfWork $uow, private readonly Clock $clock) {}

    public function one(Actor $actor, string $companyId, string $id): UserNotification
    {
        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $companyId, $id) {
            $row = $this->mine($actor, $companyId)->whereKey($id)->first();
            if ($row === null) {
                throw DomainRuleViolation::single('not_found', 'That notification does not exist.');
            }
            if ($row->read_at === null) {
                $row->forceFill(['read_at' => $this->clock->now()])->save();
            }

            return $row;
        });
    }

    /** @return int how many were unread */
    public function all(Actor $actor, string $companyId): int
    {
        return $this->uow->run($actor, fn (LockSet $locks, AuditBuffer $audit, Outbox $outbox): int => $this->mine($actor, $companyId)->whereNull('read_at')->update(['read_at' => $this->clock->now()]));
    }

    /** @return Builder<UserNotification> */
    private function mine(Actor $actor, string $companyId): Builder
    {
        if ($actor->type !== ActorType::User || $actor->id === null) {
            throw DomainRuleViolation::single('forbidden', 'Notifications belong to people.');
        }

        return UserNotification::query()->where('user_id', $actor->id)->where('company_id', $companyId);
    }
}
