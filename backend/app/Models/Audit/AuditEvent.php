<?php

declare(strict_types=1);

namespace App\Models\Audit;

use App\Models\BaseModel;
use DateTimeImmutable;

/**
 * One link of the tenant's hash chain (13 §14). Read-only: events are written by the UnitOfWork's pre-commit flush and
 * the table refuses updates and deletes.
 *
 * @property int $id
 * @property string|null $company_id
 * @property string $actor_type
 * @property string|null $actor_id
 * @property string|null $actor_name Only on the list query (a subselect); never stored or hashed.
 * @property string $action
 * @property string|null $subject_type
 * @property string|null $subject_id
 * @property array<string, mixed>|null $before
 * @property array<string, mixed>|null $after
 * @property array<string, mixed>|null $context
 * @property string|null $ip
 * @property string|null $request_id
 * @property DateTimeImmutable $occurred_at
 * @property string|null $prev_hash
 * @property string $hash
 */
class AuditEvent extends BaseModel
{
    public $incrementing = true;

    protected $keyType = 'int';

    public $timestamps = false;

    /** @return array<string, string> */
    protected function casts(): array
    {
        return ['before' => 'array', 'after' => 'array', 'context' => 'array', 'occurred_at' => 'immutable_datetime'];
    }
}
