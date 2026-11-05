<?php

declare(strict_types=1);

namespace App\Queries\Notifications;

use App\Models\Notifications\UserNotification;
use App\Support\Actor;
use Illuminate\Database\Eloquent\Builder;

/** The signed-in person's own notifications in one company. Nobody else's rows are ever in the query. */
final class ListNotifications
{
    /** @return Builder<UserNotification> */
    public function __invoke(Actor $actor, string $companyId, bool $unreadOnly = false): Builder
    {
        return UserNotification::query()->where('user_id', (string) $actor->id)->where('company_id', $companyId)
            ->when($unreadOnly, fn (Builder $q) => $q->whereNull('read_at'));
    }

    public function unreadCount(Actor $actor, string $companyId): int
    {
        return $this($actor, $companyId, true)->count();
    }
}
