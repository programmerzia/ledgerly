<?php

declare(strict_types=1);

namespace App\Http\Requests\Procurement;

use App\Actions\Procurement\Inputs\RevisionInput;
use App\Http\Requests\CompanyRequest;
use App\Http\Requests\Concerns\ShapesOrderLines;
use DateTimeImmutable;
use Illuminate\Contracts\Validation\Validator;

/**
 * Propose (POST /purchase-orders/{id}/revisions) or replace (PUT /purchase-order-revisions/{id}) a revision of an approved
 * order. Supplier, currency, rate and order date are fixed. `version` is the order's version on POST (optional) and the
 * revision's on PUT (required). Lines carry the `id` of the order line they change; a line without one is new.
 */
final class RevisionRequest extends CompanyRequest
{
    use ShapesOrderLines;

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'reason' => ['required', 'string', 'max:2000'],
            'expected_date' => ['nullable', 'date_format:Y-m-d'],
            'reference' => ['nullable', 'string', 'max:255'],
            'memo' => ['nullable', 'string', 'max:5000'],
            'version' => [$this->isMethod('PUT') ? 'required' : 'nullable', 'integer', 'min:0'],
            ...$this->orderLineRules(),
        ];
    }

    /** @return list<callable(Validator): void> */
    public function after(): array
    {
        return [fn (Validator $validator) => $this->checkOrderLines($validator)];
    }

    public function toInput(): RevisionInput
    {
        $v = $this->validated();

        return new RevisionInput(
            reason: trim((string) $v['reason']),
            lines: $this->orderLineInputs(),
            expectedDate: isset($v['expected_date']) ? new DateTimeImmutable((string) $v['expected_date']) : null,
            reference: isset($v['reference']) ? (string) $v['reference'] : null,
            memo: isset($v['memo']) ? (string) $v['memo'] : null,
        );
    }

    public function version(): ?int
    {
        $v = $this->validated();

        return isset($v['version']) ? (int) $v['version'] : null;
    }
}
