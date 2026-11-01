<?php

declare(strict_types=1);

namespace App\Http\Requests\Trade;

use App\Domain\Ledger\PostingValidator;
use App\Http\Requests\CompanyRequest;

/** Apply credit already on the books to an open document: `invoice_id` (the document to clear), `amount_fc`, optional `date`. */
final class ApplyCreditRequest extends CompanyRequest
{
    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'invoice_id' => ['required', 'uuid', $this->inCompany('invoices')],
            'amount_fc' => ['required', 'integer', 'min:1', 'max:'.PostingValidator::MAX_AMOUNT],
            'date' => ['nullable', 'date_format:Y-m-d'],
        ];
    }
}
