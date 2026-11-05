<?php

declare(strict_types=1);

namespace App\Services\Ledger;

use App\Contracts\Clock;
use App\Contracts\IdGenerator;
use Illuminate\Database\Connection;
use LogicException;

/**
 * The only path that allocates document numbers (13 §9). A single UPDATE … RETURNING takes the
 * row lock inside the posting transaction, so a rollback returns the number: no gaps.
 */
final class SequenceAllocator
{
    private readonly NumberingRules $rules;

    public function __construct(private readonly Clock $clock, private readonly IdGenerator $ids, ?NumberingRules $rules = null)
    {
        $this->rules = $rules ?? new NumberingRules;
    }

    public function next(Connection $db, string $tenantId, string $companyId, string $key, string $prefix, int $padding = 5): string
    {
        if ($db->transactionLevel() === 0) {
            throw new LogicException('Sequence numbers must be allocated inside the posting transaction.');
        }

        $row = $this->increment($db, $tenantId, $companyId, $key);
        if ($row === null) {
            // First number of this key: the company's numbering rule for this year applies now, and never again (D15 item 6).
            [$prefix, $padding] = $this->rules->forNewSequence($db, $tenantId, $companyId, $key, $prefix, $padding);
            $now = $this->clock->now()->format('Y-m-d H:i:s.uP');
            $db->statement(
                'INSERT INTO sequences (id, tenant_id, company_id, sequence_key, prefix, next_value, padding, created_at, updated_at) '
                .'VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?) ON CONFLICT (tenant_id, company_id, sequence_key) DO NOTHING',
                [$this->ids->next(), $tenantId, $companyId, $key, $prefix, $padding, $now, $now],
            );
            $row = $this->increment($db, $tenantId, $companyId, $key)
                ?? throw new LogicException("Sequence {$key} could not be created.");
        }

        return $row->prefix.str_pad((string) $row->value, (int) $row->padding, '0', STR_PAD_LEFT);
    }

    /** @return object{value: int, prefix: string, padding: int}|null */
    private function increment(Connection $db, string $tenantId, string $companyId, string $key): ?object
    {
        /** @var object{value: int, prefix: string, padding: int}|null */
        return $db->selectOne(
            'UPDATE sequences SET next_value = next_value + 1 WHERE tenant_id = ? AND company_id = ? AND sequence_key = ? '
            .'RETURNING next_value - 1 AS value, prefix, padding',
            [$tenantId, $companyId, $key],
        );
    }
}
