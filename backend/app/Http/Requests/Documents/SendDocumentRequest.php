<?php

declare(strict_types=1);

namespace App\Http\Requests\Documents;

use App\Actions\Documents\Inputs\SendDocumentInput;
use App\Http\Requests\CompanyRequest;

/** Recipients, and optionally the subject and message as edited; absent means the company's template. */
final class SendDocumentRequest extends CompanyRequest
{
    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'recipients' => ['required', 'array', 'min:1', 'max:'.(int) config('documents.max_recipients')],
            'recipients.*' => ['required', 'string', 'max:254'],
            'subject' => ['sometimes', 'nullable', 'string', 'max:200'],
            'body' => ['sometimes', 'nullable', 'string', 'max:5000'],
            /** Statements only: the period, and the side when the contact is both customer and supplier. */
            'from' => ['sometimes', 'date_format:Y-m-d'],
            'to' => ['sometimes', 'date_format:Y-m-d', 'after_or_equal:from'],
            'side' => ['sometimes', 'string', 'in:customer,supplier'],
        ];
    }

    public function toInput(): SendDocumentInput
    {
        $v = $this->validated();

        return new SendDocumentInput(
            $this->company()->id,
            array_values(array_map('strval', (array) $v['recipients'])),
            isset($v['subject']) ? (string) $v['subject'] : null,
            isset($v['body']) ? (string) $v['body'] : null,
            array_map('strval', array_intersect_key($v, array_flip(['from', 'to', 'side']))),
        );
    }
}
