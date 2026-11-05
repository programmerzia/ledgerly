<?php

declare(strict_types=1);

namespace App\Models\Documents;

use App\Models\BaseModel;
use Carbon\CarbonImmutable;

/**
 * One email sent (or queued, or failed) from a document page. `document_type` is the template family: invoice,
 * credit_note, statement or payment_advice; `document_id` is the invoice or settlement, or the contact for a statement.
 *
 * @property string $id
 * @property string $tenant_id
 * @property string $company_id
 * @property string $document_type
 * @property string $document_id
 * @property string|null $contact_id
 * @property list<string> $recipients
 * @property string $subject
 * @property string $body
 * @property string $attachment_name
 * @property array<string, string> $parameters statement period and side
 * @property string $status queued | sent | failed
 * @property string|null $error
 * @property string|null $queued_by
 * @property CarbonImmutable $queued_at
 * @property CarbonImmutable|null $sent_at
 */
class DocumentSend extends BaseModel
{
    /** @return array<string, string> */
    protected function casts(): array
    {
        return ['recipients' => 'array', 'parameters' => 'array', 'queued_at' => 'immutable_datetime', 'sent_at' => 'immutable_datetime'];
    }
}
