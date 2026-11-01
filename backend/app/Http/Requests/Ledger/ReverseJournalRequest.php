<?php

declare(strict_types=1);

namespace App\Http\Requests\Ledger;

use App\Actions\Ledger\Inputs\ReverseJournalInput;
use App\Http\Requests\CompanyRequest;
use DateTimeImmutable;

/** Optional `date` (YYYY-MM-DD; default per D3), `memo` and the `version` the reversal is based on. */
final class ReverseJournalRequest extends CompanyRequest
{
    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'date' => ['nullable', 'date_format:Y-m-d'],
            'memo' => ['nullable', 'string', 'max:5000'],
            'version' => ['nullable', 'integer', 'min:0'],
        ];
    }

    public function toInput(string $journalId): ReverseJournalInput
    {
        $v = $this->validated();

        return new ReverseJournalInput(
            $journalId,
            isset($v['date']) ? new DateTimeImmutable((string) $v['date']) : null,
            isset($v['version']) ? (int) $v['version'] : null,
            isset($v['memo']) ? (string) $v['memo'] : null,
        );
    }
}
