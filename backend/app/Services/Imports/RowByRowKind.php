<?php

declare(strict_types=1);

namespace App\Services\Imports;

use App\Support\Actor;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;

/**
 * A kind where every row is its own record (contacts, accounts): rows are checked and applied independently, so one bad row never
 * stops the others. Rows that repeat a record already earlier in the file (same natural key) are errors on the later row.
 */
abstract class RowByRowKind extends ImportKind
{
    /** @param array<string, string> $cells */
    abstract protected function prepareRow(ImportContext $ctx, array $cells): RowOutcome;

    /** The natural key a row creates, for catching repeats within the file; null when it cannot be known. */
    abstract protected function keyOf(RowOutcome $outcome): ?string;

    /**
     * Writes one record through the Action and answers what to remember about it.
     *
     * @return array<string, mixed>
     */
    abstract protected function create(Actor $actor, ImportContext $ctx, RowOutcome $outcome): array;

    public function prepare(ImportContext $ctx, array $rows): PreparedSet
    {
        $set = new PreparedSet;
        $seen = [];
        foreach ($rows as $number => $cells) {
            $outcome = $this->prepareRow($ctx, $cells);
            $key = $outcome->ok() ? $this->keyOf($outcome) : null;
            if ($key !== null) {
                if (isset($seen[$key])) {
                    $outcome->add(null, 'duplicate_in_file', "{$key} already appears on row {$seen[$key]}.");
                } else {
                    $seen[$key] = $number;
                }
            }
            $set->rows[$number] = $outcome;
        }

        return $set;
    }

    public function apply(ImportContext $ctx, Actor $actor, ImportRunner $run): void
    {
        foreach ($run->pending() as $row) {
            // Re-read the world: rules are checked again by the Action, and the prepared input resolves codes to the ids that exist now.
            $outcome = $this->prepareRow($ctx, $row->cells);
            if (! $outcome->ok()) {
                $run->fail([$row->id], $outcome->errors);

                continue;
            }
            $run->unit([$row->id], fn (LockSet $locks, AuditBuffer $audit, Outbox $outbox): array => $this->create($actor, $ctx, $outcome));
        }
    }
}
