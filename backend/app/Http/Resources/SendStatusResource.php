<?php

declare(strict_types=1);

namespace App\Http\Resources;

use App\Models\Documents\DocumentSend;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * How one queued email ended.
 *
 * @mixin DocumentSend
 */
final class SendStatusResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'contact_id' => $this->contact_id,
            /** queued, sent (the mail server accepted it) or failed */
            'status' => $this->status,
            'error' => $this->error,
        ];
    }
}
