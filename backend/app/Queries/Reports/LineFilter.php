<?php

declare(strict_types=1);

namespace App\Queries\Reports;

/**
 * Which posted journal lines of one account a drill or ledger request wants. `before` narrows to lines that
 * sort ahead of a (date, line id) position, which is how a ledger page learns its starting balance.
 */
final readonly class LineFilter
{
    /**
     * @param  array<int, list<string>>  $dims  dimension slot → accepted value ids
     * @param  'debit'|'credit'|null  $contactSide  contacts whose net balance up to `to` is a debit or a credit
     * @param  array{string, string}|null  $before
     */
    public function __construct(
        public string $companyId,
        public string $accountId,
        public ?string $from,
        public ?string $to,
        public bool $excludeClosing = false,
        public array $dims = [],
        public ?string $contactSide = null,
        public ?string $contactId = null,
        public ?array $before = null,
    ) {}

    /** @param array{string, string}|null $before */
    public function withBefore(?array $before): self
    {
        return new self($this->companyId, $this->accountId, $this->from, $this->to, $this->excludeClosing, $this->dims, $this->contactSide, $this->contactId, $before);
    }
}
