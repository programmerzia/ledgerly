<?php

declare(strict_types=1);

namespace App\Support\Webhooks;

use App\Contracts\OutboxHandler;
use App\Support\Outbox\OutboxMessage;
use DateTimeImmutable;
use DateTimeZone;

/**
 * The event types an endpoint can subscribe to (`*` = all) and the envelope each delivery carries (13 §15).
 * A new domain event that integrators should see is added to TYPES; config/outbox.php registers the webhook
 * handler for every type listed here.
 */
final class WebhookEvents
{
    public const string ALL = '*';

    /** @var list<string> */
    public const array TYPES = [
        'journal.posted', 'journal.reversed',
        'invoice.posted', 'invoice.reversed', 'bill.posted', 'bill.reversed',
        'document.submitted', 'document.approved', 'document.returned', 'document.voided',
        'period.soft_closed', 'period.closed', 'period.reopened',
        'fiscal_year.closed', 'fiscal_year.locked',
    ];

    /** @return list<string> what the API accepts in an endpoint's `events` */
    public static function subscribable(): array
    {
        return [self::ALL, ...self::TYPES];
    }

    /**
     * Event id = outbox message id, so receivers can de-duplicate; `resource.version` and `occurred_at` let them
     * discard stale events, since delivery order is not guaranteed.
     *
     * @return array<string, mixed>
     */
    public static function envelope(OutboxMessage $m): array
    {
        $p = $m->payload;
        $kind = explode('.', $m->type, 2)[0];
        $resourceType = $kind === 'document' && is_string($p['document_type'] ?? null) ? $p['document_type'] : $kind;
        $id = $p['journal_id'] ?? $p['document_id'] ?? $p['id'] ?? null;
        $version = $p['version'] ?? null;

        return [
            'event_id' => $m->id,
            'type' => $m->type,
            'occurred_at' => (new DateTimeImmutable($m->occurredAt))->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d\TH:i:s.u\Z'),
            'data' => [
                'resource' => [
                    'type' => $resourceType,
                    'id' => is_string($id) ? $id : null,
                    'version' => is_int($version) ? $version : null,
                ],
                ...$p,
            ],
        ];
    }

    /** @return array<string, list<class-string<OutboxHandler>>> */
    public static function handlerMap(string $handler): array
    {
        if (! is_a($handler, OutboxHandler::class, true)) {
            throw new \InvalidArgumentException("{$handler} is not an outbox handler.");
        }

        return array_fill_keys(self::TYPES, [$handler]);
    }
}
