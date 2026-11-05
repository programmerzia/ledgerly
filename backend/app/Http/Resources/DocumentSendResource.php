<?php

declare(strict_types=1);

namespace App\Http\Resources;

use App\Http\Support\Json;
use App\Models\Documents\DocumentSend;
use App\Models\Platform\User;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * One line of a document's send log: who sent it, when, to whom, and whether the mail server took it.
 *
 * @mixin DocumentSend
 */
final class DocumentSendResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        $by = $this->queued_by === null ? null : User::query()->whereKey($this->queued_by)->value('name');

        return [
            'id' => $this->id,
            'document_type' => $this->document_type,
            'document_id' => $this->document_id,
            'recipients' => $this->recipients,
            'subject' => $this->subject,
            'attachment_name' => $this->attachment_name,
            /** queued, sent (the mail server accepted it) or failed. A later bounce is not tracked. */
            'status' => $this->status,
            /** Why it failed, in the mail system's words; null otherwise. */
            'error' => $this->error,
            'queued_by' => $this->queued_by,
            /** @var string|null */
            'queued_by_name' => is_string($by) ? $by : null,
            'queued_at' => Json::time($this->queued_at),
            'sent_at' => Json::time($this->sent_at),
        ];
    }
}
