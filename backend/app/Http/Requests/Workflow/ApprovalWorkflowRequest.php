<?php

declare(strict_types=1);

namespace App\Http\Requests\Workflow;

use App\Actions\Workflow\Inputs\ApprovalWorkflowInput;
use App\Http\Requests\CompanyRequest;
use App\Services\Workflow\Documents;
use Illuminate\Validation\Rule;

/** Create (POST) or replace (PUT, with `version`) an approval workflow; amounts are base-currency minor units. */
final class ApprovalWorkflowRequest extends CompanyRequest
{
    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'document_type' => ['required', 'string', Rule::in(Documents::WORKFLOW_TYPES)],
            'name' => ['required', 'string', 'max:255'],
            'source' => ['required', 'string', Rule::in(['any', 'user', 'api'])],
            'min_amount' => ['required', 'integer', 'min:0', 'max:999999999999999'],
            'max_amount' => ['nullable', 'integer', 'gt:min_amount', 'max:999999999999999'],
            /** Hours (1 to 720) a document may wait on its current step before its approvers are reminded; empty: no reminders. */
            'remind_after_hours' => ['nullable', 'integer', 'between:1,720'],
            'steps' => ['required', 'array', 'min:1', 'max:10'],
            'steps.*.role' => ['required', 'string', 'max:64', $this->inCompany('roles', 'name')],
            'steps.*.count' => ['nullable', 'integer', 'between:1,10'],
            'version' => [$this->isMethod('PUT') ? 'required' : 'prohibited', 'integer', 'min:0'],
        ];
    }

    public function toInput(): ApprovalWorkflowInput
    {
        $v = $this->validated();
        /** @var list<array{role: string, count?: int|null}> $steps */
        $steps = $v['steps'];

        return new ApprovalWorkflowInput(
            companyId: $this->company()->id,
            documentType: (string) $v['document_type'],
            name: trim((string) $v['name']),
            source: (string) $v['source'],
            minAmount: (int) $v['min_amount'],
            maxAmount: isset($v['max_amount']) ? (int) $v['max_amount'] : null,
            remindAfterHours: isset($v['remind_after_hours']) ? (int) $v['remind_after_hours'] : null,
            steps: array_map(fn (array $s): array => ['role' => $s['role'], 'count' => (int) ($s['count'] ?? 1)], $steps),
        );
    }

    public function version(): int
    {
        return (int) $this->validated()['version'];
    }
}
