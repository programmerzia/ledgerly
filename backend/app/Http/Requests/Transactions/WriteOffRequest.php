<?php

declare(strict_types=1);

namespace App\Http\Requests\Transactions;

use App\Actions\Transactions\Inputs\WriteOffDraftInput;
use App\Domain\Ledger\PostingValidator;
use App\Http\Requests\CompanyRequest;
use DateTimeImmutable;

/** Create (POST) or replace (PUT, with `version`) a draft write-off: one posted invoice, the amount in its currency (up to what is open) and the reason. */
final class WriteOffRequest extends CompanyRequest
{
    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'invoice_id' => ['required', 'uuid', $this->inCompany('invoices')],
            'write_off_date' => ['required', 'date_format:Y-m-d'],
            'amount_fc' => ['required', 'integer', 'min:1', 'max:'.PostingValidator::MAX_AMOUNT],
            'reason' => ['required', 'string', 'min:3', 'max:2000'],
            'reference' => ['nullable', 'string', 'max:255'],
            'memo' => ['nullable', 'string', 'max:5000'],
            'version' => [$this->isMethod('PUT') ? 'required' : 'prohibited', 'integer', 'min:0'],
        ];
    }

    public function toInput(): WriteOffDraftInput
    {
        $v = $this->validated();

        return new WriteOffDraftInput(
            $this->company()->id, (string) $v['invoice_id'], new DateTimeImmutable((string) $v['write_off_date']), (int) $v['amount_fc'], (string) $v['reason'],
            isset($v['reference']) ? (string) $v['reference'] : null, isset($v['memo']) ? (string) $v['memo'] : null,
        );
    }

    public function version(): int
    {
        return (int) $this->validated()['version'];
    }
}
