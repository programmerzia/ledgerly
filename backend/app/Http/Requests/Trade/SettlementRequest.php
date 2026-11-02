<?php

declare(strict_types=1);

namespace App\Http\Requests\Trade;

use App\Actions\Trade\Inputs\SettlementAllocationInput;
use App\Actions\Trade\Inputs\SettlementDraftInput;
use App\Domain\Ledger\PostingValidator;
use App\Http\Requests\CompanyRequest;
use App\Models\Ledger\DimensionValue;
use App\Queries\Ledger\DimensionPositions;
use App\Services\Trade\SettlementWriter;
use DateTimeImmutable;
use Illuminate\Contracts\Validation\Validator;
use Illuminate\Validation\Rule;

/**
 * Create (POST) or replace (PUT, with `version`) a draft receipt, payment or refund. Shape only: ids exist in this company, the
 * rate is a decimal string, the amount whole minor units. The base amount, the carried amounts and the exchange differences are the
 * server's. Allocations name an `invoice_id` or, for a refund of credit on account, a `source_settlement_id`. Dimensions are
 * `{"<dimension id>": "<dimension value id>"}`. `bank_account_id` (optional) names the bank account; it must be linked to `cash_account_id` and be in the settlement's currency.
 */
final class SettlementRequest extends CompanyRequest
{
    /** @return array<string, mixed> */
    public function rules(): array
    {
        $update = $this->isMethod('PUT');

        return [
            'kind' => [$update ? 'prohibited' : 'required', 'string', Rule::in(SettlementWriter::KINDS)],
            'contact_id' => ['required', 'uuid', $this->inCompany('contacts')->whereNull('deleted_at')],
            'cash_account_id' => ['required', 'uuid', $this->inCompany('accounts')->whereNull('deleted_at')],
            'bank_account_id' => ['nullable', 'uuid', $this->inCompany('bank_accounts')],
            'settlement_date' => ['required', 'date_format:Y-m-d'],
            'amount_fc' => ['required', 'integer', 'min:1', 'max:'.PostingValidator::MAX_AMOUNT],
            'currency' => ['nullable', 'string', 'size:3', Rule::exists('currencies', 'code')],
            'fx_rate' => ['nullable', 'string', 'regex:/^\d{1,12}(\.\d{1,8})?$/'],
            'reference' => ['nullable', 'string', 'max:255'],
            'memo' => ['nullable', 'string', 'max:5000'],
            'version' => [$update ? 'required' : 'prohibited', 'integer', 'min:0'],
            'dimensions' => ['nullable', 'array', 'max:8'],
            'allocations' => ['nullable', 'array', 'max:200'],
            'allocations.*.invoice_id' => ['nullable', 'uuid', $this->inCompany('invoices')],
            'allocations.*.source_settlement_id' => ['nullable', 'uuid', $this->inCompany('settlements')],
            'allocations.*.amount_fc' => ['required', 'integer', 'min:1', 'max:'.PostingValidator::MAX_AMOUNT],
        ];
    }

    /** @return list<callable(Validator): void> */
    public function after(): array
    {
        return [function (Validator $validator): void {
            if ($validator->errors()->isNotEmpty()) {
                return;
            }
            foreach (array_values((array) $this->input('allocations')) as $i => $a) {
                $a = (array) $a;
                if (isset($a['invoice_id']) === isset($a['source_settlement_id'])) {
                    $validator->errors()->add("allocations.{$i}", 'Name either invoice_id or source_settlement_id.');
                }
            }
            $known = array_flip((new DimensionPositions)($this->company()->id));
            $valueIds = [];
            foreach ((array) $this->input('dimensions') as $dimensionId => $valueId) {
                if (! isset($known[(string) $dimensionId])) {
                    $validator->errors()->add('dimensions', "Dimension {$dimensionId} does not exist in this company.");
                } elseif (! is_string($valueId)) {
                    $validator->errors()->add("dimensions.{$dimensionId}", 'Name a dimension value id.');
                } else {
                    $valueIds[(string) $dimensionId] = $valueId;
                }
            }
            if ($valueIds !== []) {
                $found = DimensionValue::query()->where('company_id', $this->company()->id)->whereIn('id', array_values($valueIds))->pluck('dimension_id', 'id')->all();
                foreach ($valueIds as $dimensionId => $valueId) {
                    if (($found[$valueId] ?? null) !== $dimensionId) {
                        $validator->errors()->add("dimensions.{$dimensionId}", 'This value does not belong to the dimension in this company.');
                    }
                }
            }
        }];
    }

    public function toInput(?string $fixedKind = null): SettlementDraftInput
    {
        $v = $this->validated();
        $slots = array_flip((new DimensionPositions)($this->company()->id));
        $dims = [];
        foreach ((array) ($v['dimensions'] ?? []) as $dimensionId => $valueId) {
            $dims[$slots[(string) $dimensionId]] = (string) $valueId;
        }

        return new SettlementDraftInput(
            companyId: $this->company()->id,
            kind: $fixedKind ?? (string) $v['kind'],
            contactId: (string) $v['contact_id'],
            cashAccountId: (string) $v['cash_account_id'],
            settlementDate: new DateTimeImmutable((string) $v['settlement_date']),
            amountFc: (int) $v['amount_fc'],
            allocations: array_map(fn (array $a): SettlementAllocationInput => new SettlementAllocationInput(
                (int) $a['amount_fc'], isset($a['invoice_id']) ? (string) $a['invoice_id'] : null, isset($a['source_settlement_id']) ? (string) $a['source_settlement_id'] : null,
            ), array_values((array) ($v['allocations'] ?? []))),
            currency: isset($v['currency']) ? (string) $v['currency'] : null,
            fxRate: isset($v['fx_rate']) ? (string) $v['fx_rate'] : null,
            reference: isset($v['reference']) ? (string) $v['reference'] : null,
            memo: isset($v['memo']) ? (string) $v['memo'] : null,
            dims: $dims,
            bankAccountId: isset($v['bank_account_id']) ? (string) $v['bank_account_id'] : null,
        );
    }

    public function version(): int
    {
        return (int) $this->validated()['version'];
    }
}
