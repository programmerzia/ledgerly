<?php

declare(strict_types=1);

namespace App\Queries\Reports;

/** An account as the reports see it. */
final readonly class AccountInfo
{
    /** @param list<string> $tags */
    public function __construct(
        public string $id,
        public string $code,
        public string $name,
        public string $type,
        public ?string $subtype,
        public string $normalBalance,
        public string $controlType,
        public array $tags = [],
        public bool $postable = true,
        public ?string $ifrsElement = null,
    ) {}

    /** The account's balance in its own direction for a presentation: income and liabilities/equity by credit, others by debit. */
    public function natural(int $debit, int $credit): int
    {
        return in_array($this->type, ['liability', 'equity', 'income'], true) ? $credit - $debit : $debit - $credit;
    }

    public function isCash(): bool
    {
        return in_array($this->controlType, ['cash', 'bank'], true);
    }

    /** @return array{id: string, code: string, name: string} */
    public function ref(): array
    {
        return ['id' => $this->id, 'code' => $this->code, 'name' => $this->name];
    }
}
