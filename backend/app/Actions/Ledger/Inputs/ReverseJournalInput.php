<?php

declare(strict_types=1);

namespace App\Actions\Ledger\Inputs;

use App\Support\UnitOfWork\LockSet;
use Closure;
use DateTimeImmutable;

final readonly class ReverseJournalInput
{
    public function __construct(
        public string $journalId,
        /** Null = default per D3. */
        public ?DateTimeImmutable $date = null,
        public ?int $lockVersion = null,
        public ?string $memo = null,
        /** The permission a person needs; a document reversing its own journal (invoice, bill) names its own. */
        public string $permission = 'journals.reverse',
        /**
         * Runs right after the journal is locked, before anything later in the lock order is taken: lets the
         * owning document lock itself and refuse (13 §8 level 2, journals before invoices).
         *
         * @var (Closure(LockSet): void)|null
         */
        public ?Closure $whileLocked = null,
    ) {}
}
