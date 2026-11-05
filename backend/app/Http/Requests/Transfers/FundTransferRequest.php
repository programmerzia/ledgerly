<?php

declare(strict_types=1);

namespace App\Http\Requests\Transfers;

use App\Actions\Transfers\Inputs\FundTransferDraftInput;
use App\Domain\Ledger\PostingValidator;
use App\Http\Requests\CompanyRequest;
use DateTimeImmutable;

/**
 * Create (POST) or replace (PUT, with `version`) a draft fund transfer. Amounts are integer minor units: `from_amount_fc` in the
 * source account's currency, `to_amount_fc` in the destination's (optional between accounts of one currency). Rates are optional
 * decimals; left out, the stored rate on the date is used.
 */
final class FundTransferRequest extends CompanyRequest
{
    /** @return array<string, mixed> */
    public function rules(): array
    {
        $max = PostingValidator::MAX_AMOUNT;

        return [
            'from_bank_account_id' => ['required', 'uuid', $this->inCompany('bank_accounts')],
            'to_bank_account_id' => ['required', 'uuid', 'different:from_bank_account_id', $this->inCompany('bank_accounts')],
            'send_date' => ['required', 'date_format:Y-m-d'],
            'from_amount_fc' => ['required', 'integer', 'min:1', "max:{$max}"],
            'to_amount_fc' => ['nullable', 'integer', 'min:1', "max:{$max}"],
            'send_rate' => ['nullable', 'string', 'regex:/^\d{1,12}(\.\d{1,8})?$/'],
            'receive_rate' => ['nullable', 'string', 'regex:/^\d{1,12}(\.\d{1,8})?$/'],
            'fee_fc' => ['nullable', 'integer', 'min:0', "max:{$max}"],
            'fee_account_id' => ['nullable', 'uuid', $this->inCompany('accounts')->whereNull('deleted_at')],
            'settle_same_day' => ['nullable', 'boolean'],
            'reference' => ['nullable', 'string', 'max:255'],
            'memo' => ['nullable', 'string', 'max:5000'],
            'version' => [$this->isMethod('PUT') ? 'required' : 'prohibited', 'integer', 'min:0'],
        ];
    }

    public function toInput(): FundTransferDraftInput
    {
        $v = $this->validated();

        return new FundTransferDraftInput(
            companyId: $this->company()->id,
            fromBankAccountId: (string) $v['from_bank_account_id'],
            toBankAccountId: (string) $v['to_bank_account_id'],
            sendDate: new DateTimeImmutable((string) $v['send_date']),
            fromAmountFc: (int) $v['from_amount_fc'],
            toAmountFc: isset($v['to_amount_fc']) ? (int) $v['to_amount_fc'] : null,
            sendRate: isset($v['send_rate']) ? (string) $v['send_rate'] : null,
            receiveRate: isset($v['receive_rate']) ? (string) $v['receive_rate'] : null,
            feeFc: (int) ($v['fee_fc'] ?? 0),
            feeAccountId: isset($v['fee_account_id']) ? (string) $v['fee_account_id'] : null,
            settleSameDay: (bool) ($v['settle_same_day'] ?? false),
            reference: isset($v['reference']) ? (string) $v['reference'] : null,
            memo: isset($v['memo']) ? (string) $v['memo'] : null,
        );
    }

    public function version(): int
    {
        return (int) $this->validated()['version'];
    }
}
