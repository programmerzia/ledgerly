<?php

declare(strict_types=1);

namespace App\Http\Requests\Transfers;

use App\Domain\Ledger\PostingValidator;
use App\Http\Requests\CompanyRequest;
use DateTimeImmutable;

/** Records that the money arrived: the date, and (if different from the draft) the amount received and the rate of that day. */
final class ReceiveFundTransferRequest extends CompanyRequest
{
    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'received_on' => ['required', 'date_format:Y-m-d'],
            'to_amount_fc' => ['nullable', 'integer', 'min:1', 'max:'.PostingValidator::MAX_AMOUNT],
            'receive_rate' => ['nullable', 'string', 'regex:/^\d{1,12}(\.\d{1,8})?$/'],
            'version' => ['nullable', 'integer', 'min:0'],
        ];
    }

    public function receivedOn(): DateTimeImmutable
    {
        return new DateTimeImmutable((string) $this->validated()['received_on']);
    }

    public function toAmount(): ?int
    {
        $v = $this->validated();

        return isset($v['to_amount_fc']) ? (int) $v['to_amount_fc'] : null;
    }

    public function rate(): ?string
    {
        $v = $this->validated();

        return isset($v['receive_rate']) ? (string) $v['receive_rate'] : null;
    }

    public function version(): ?int
    {
        $v = $this->validated();

        return isset($v['version']) ? (int) $v['version'] : null;
    }
}
