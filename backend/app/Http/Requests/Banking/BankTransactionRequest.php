<?php

declare(strict_types=1);

namespace App\Http\Requests\Banking;

use App\Actions\Banking\Inputs\BankTransactionInput;
use App\Http\Requests\CompanyRequest;
use App\Queries\Ledger\DimensionPositions;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

/** Code a statement line: `kind` spend|receive (with `account_id`, optional `tax_code_id`, `contact_id`, `dimensions`, `memo`) or transfer (with `to_bank_account_id`). */
final class BankTransactionRequest extends CompanyRequest
{
    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'kind' => ['required', 'string', Rule::in(['spend', 'receive', 'transfer'])],
            'account_id' => ['required_unless:kind,transfer', 'nullable', 'uuid', $this->inCompany('accounts')->whereNull('deleted_at')],
            'to_bank_account_id' => ['required_if:kind,transfer', 'nullable', 'uuid', $this->inCompany('bank_accounts')],
            'tax_code_id' => ['nullable', 'uuid', $this->inCompany('tax_codes')],
            'contact_id' => ['nullable', 'uuid', $this->inCompany('contacts')->whereNull('deleted_at')],
            'dimensions' => ['nullable', 'array', 'max:8'],
            'memo' => ['nullable', 'string', 'max:5000'],
            'rule_id' => ['nullable', 'uuid', $this->inCompany('bank_rules')],
        ];
    }

    /** @return list<callable(Validator): void> */
    public function after(): array
    {
        return [function (Validator $validator): void {
            $known = array_flip((new DimensionPositions)($this->company()->id));
            foreach ((array) $this->input('dimensions') as $dimensionId => $valueId) {
                if (! isset($known[(string) $dimensionId]) || ! is_string($valueId)) {
                    $validator->errors()->add('dimensions', "Dimension {$dimensionId} is unknown or its value is not an id.");
                }
            }
        }];
    }

    public function toInput(string $lineId): BankTransactionInput
    {
        $v = $this->validated();
        $slots = array_flip((new DimensionPositions)($this->company()->id));
        $dims = [];
        foreach ((array) ($v['dimensions'] ?? []) as $dimensionId => $valueId) {
            $dims[$slots[(string) $dimensionId]] = (string) $valueId;
        }

        return new BankTransactionInput(
            $this->company()->id, $lineId, (string) $v['kind'], isset($v['account_id']) ? (string) $v['account_id'] : null,
            isset($v['to_bank_account_id']) ? (string) $v['to_bank_account_id'] : null, isset($v['tax_code_id']) ? (string) $v['tax_code_id'] : null,
            isset($v['contact_id']) ? (string) $v['contact_id'] : null, $dims, isset($v['memo']) ? (string) $v['memo'] : null, isset($v['rule_id']) ? (string) $v['rule_id'] : null,
        );
    }
}
