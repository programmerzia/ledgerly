<?php

declare(strict_types=1);

namespace App\Http\Requests\Trade;

use App\Actions\Trade\Inputs\PaymentRunDraftInput;
use App\Domain\Ledger\PostingValidator;
use App\Http\Requests\CompanyRequest;
use DateTimeImmutable;
use Illuminate\Validation\Rule;

/** Create (POST) or replace (PUT, with `version`) a draft payment run: the bills and how much of each to pay (net of tax withheld when the bill posted). */
final class PaymentRunRequest extends CompanyRequest
{
    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'cash_account_id' => ['required', 'uuid', $this->inCompany('accounts')->whereNull('deleted_at')],
            'run_date' => ['required', 'date_format:Y-m-d'],
            'currency' => ['nullable', 'string', 'size:3', Rule::exists('currencies', 'code')],
            'fx_rate' => ['nullable', 'string', 'regex:/^\d{1,12}(\.\d{1,8})?$/'],
            'reference' => ['nullable', 'string', 'max:255'],
            'memo' => ['nullable', 'string', 'max:5000'],
            'version' => [$this->isMethod('PUT') ? 'required' : 'prohibited', 'integer', 'min:0'],
            'items' => ['required', 'array', 'min:1', 'max:500'],
            'items.*.invoice_id' => ['required', 'uuid', $this->inCompany('invoices')],
            'items.*.amount_fc' => ['required', 'integer', 'min:1', 'max:'.PostingValidator::MAX_AMOUNT],
        ];
    }

    public function toInput(): PaymentRunDraftInput
    {
        $v = $this->validated();

        return new PaymentRunDraftInput(
            companyId: $this->company()->id,
            cashAccountId: (string) $v['cash_account_id'],
            runDate: new DateTimeImmutable((string) $v['run_date']),
            items: array_map(fn (array $i): array => ['invoice_id' => (string) $i['invoice_id'], 'amount_fc' => (int) $i['amount_fc']], array_values($v['items'])),
            currency: isset($v['currency']) ? (string) $v['currency'] : null,
            fxRate: isset($v['fx_rate']) ? (string) $v['fx_rate'] : null,
            reference: isset($v['reference']) ? (string) $v['reference'] : null,
            memo: isset($v['memo']) ? (string) $v['memo'] : null,
        );
    }

    public function version(): int
    {
        return (int) $this->validated()['version'];
    }
}
