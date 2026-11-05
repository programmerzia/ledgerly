<?php

declare(strict_types=1);

namespace App\Http\Requests\Documents;

use App\Http\Requests\CompanyRequest;

/** Only statements take parameters: the period, and which side when a contact is both customer and supplier. */
final class DocumentPdfRequest extends CompanyRequest
{
    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'from' => ['sometimes', 'date_format:Y-m-d'],
            'to' => ['sometimes', 'date_format:Y-m-d', 'after_or_equal:from'],
            'side' => ['sometimes', 'string', 'in:customer,supplier'],
        ];
    }
}
