<?php

declare(strict_types=1);

namespace App\Http\Requests\Banking;

use App\Actions\Banking\Inputs\MatchInput;
use App\Http\Requests\CompanyRequest;
use Illuminate\Validation\Validator;

/** Match statement lines to book lines (`journal_line_ids`) or settlements; many-to-one and one-to-many when the sums are equal. */
final class MatchRequest extends CompanyRequest
{
    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'statement_line_ids' => ['required', 'array', 'min:1', 'max:50'],
            'statement_line_ids.*' => ['uuid', $this->inCompany('bank_statement_lines')],
            'journal_line_ids' => ['nullable', 'array', 'max:50'],
            'journal_line_ids.*' => ['uuid', $this->inCompany('journal_lines')],
            'settlement_ids' => ['nullable', 'array', 'max:50'],
            'settlement_ids.*' => ['uuid', $this->inCompany('settlements')],
        ];
    }

    /** @return list<callable(Validator): void> */
    public function after(): array
    {
        return [function (Validator $validator): void {
            if ((array) $this->input('journal_line_ids') === [] && (array) $this->input('settlement_ids') === []) {
                $validator->errors()->add('journal_line_ids', 'Name at least one book line or settlement.');
            }
        }];
    }

    public function toInput(): MatchInput
    {
        $v = $this->validated();

        return new MatchInput($this->company()->id, array_values((array) $v['statement_line_ids']), array_values((array) ($v['journal_line_ids'] ?? [])), array_values((array) ($v['settlement_ids'] ?? [])));
    }
}
