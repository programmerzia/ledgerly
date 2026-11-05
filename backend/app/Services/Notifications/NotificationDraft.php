<?php

declare(strict_types=1);

namespace App\Services\Notifications;

/** One notification to store for one person, before it gets an id. */
final readonly class NotificationDraft
{
    public function __construct(
        public string $userId,
        public string $companyId,
        public string $kind,
        public string $title,
        public ?string $body,
        public ?string $subjectType,
        public ?string $subjectId,
        public ?string $link,
        public string $dedupeKey,
    ) {}
}
