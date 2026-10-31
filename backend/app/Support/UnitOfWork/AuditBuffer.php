<?php

declare(strict_types=1);

namespace App\Support\UnitOfWork;

use BackedEnum;
use DateTimeInterface;
use Illuminate\Database\Eloquent\Model;
use InvalidArgumentException;
use Stringable;

/** Audit events collected during a UnitOfWork; flushed and chained just before commit (13 §14). */
final class AuditBuffer
{
    /** @var list<array{action: string, company_id: string|null, subject_type: string|null, subject_id: string|null, before: mixed, after: mixed, context: mixed}> */
    private array $events = [];

    /**
     * @param  Model|array<string, mixed>|null  $before
     * @param  Model|array<string, mixed>|null  $after
     * @param  array<string, mixed>  $context
     */
    public function add(string $action, ?Model $subject, Model|array|null $before = null, Model|array|null $after = null, array $context = []): void
    {
        // Read raw attributes: not every subject has a company_id column (tenants, invitations).
        $companyId = $subject?->getAttributes()['company_id'] ?? null;
        $this->events[] = [
            'action' => $action,
            'company_id' => is_string($companyId) ? $companyId : null,
            'subject_type' => $subject?->getTable(),
            'subject_id' => $subject === null ? null : (string) $subject->getKey(),
            'before' => self::normalise($before instanceof Model ? $before->attributesToArray() : $before),
            'after' => self::normalise($after instanceof Model ? $after->attributesToArray() : $after),
            'context' => $context === [] ? null : self::normalise($context),
        ];
    }

    /** @return list<array{action: string, company_id: string|null, subject_type: string|null, subject_id: string|null, before: mixed, after: mixed, context: mixed}> */
    public function events(): array
    {
        return $this->events;
    }

    /** Make a value JCS-safe: no floats, no objects. */
    public static function normalise(mixed $value): mixed
    {
        return match (true) {
            $value === null, is_bool($value), is_int($value), is_string($value) => $value,
            is_float($value) => throw new InvalidArgumentException('Audit payloads must not contain floats.'),
            is_array($value) => array_map(self::normalise(...), $value),
            $value instanceof DateTimeInterface => $value->format('Y-m-d\TH:i:s.uP'),
            $value instanceof BackedEnum => $value->value,
            $value instanceof Stringable => (string) $value,
            default => throw new InvalidArgumentException('Unsupported audit value '.get_debug_type($value)),
        };
    }
}
