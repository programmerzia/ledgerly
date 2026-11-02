<?php

declare(strict_types=1);

namespace App\Http\Requests\Banking;

use App\Http\Requests\CompanyRequest;

/** Start (`statement_id`), finish (optional `version`) or reopen (`reason`, optional `version`) a reconciliation. */
final class ReconciliationRequest extends CompanyRequest
{
    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'statement_id' => [$this->routeIs('*.reopen', '*.finish') ? 'prohibited' : 'required', 'uuid', $this->inCompany('bank_statements')],
            'reason' => [$this->routeIs('*.reopen') ? 'required' : 'prohibited', 'string', 'max:1000'],
            'version' => ['nullable', 'integer', 'min:0'],
        ];
    }

    public function statementId(): string
    {
        return (string) $this->validated()['statement_id'];
    }

    public function reason(): string
    {
        return (string) $this->validated()['reason'];
    }

    public function version(): ?int
    {
        $v = $this->validated();

        return isset($v['version']) ? (int) $v['version'] : null;
    }
}
