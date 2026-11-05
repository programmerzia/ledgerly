<?php

declare(strict_types=1);

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** What happened to one customer in a statement run. The wrapped value is a `RunStatements` result. */
final class StatementRunResultResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        /** @var array{contact_id: string, name: string, status: string, code: string|null, reason: string|null, send_id: string|null} $r */
        $r = $this->resource;

        return [
            /** @var string */
            'contact_id' => $r['contact_id'],
            /** @var string */
            'name' => $r['name'],
            /** @var string queued (on its way; follow it with `send_id`), skipped (no email, no balance, not a customer) or failed (the send path refused it). */
            'status' => $r['status'],
            /** @var string|null */
            'code' => $r['code'],
            /** @var string|null In plain words, for skipped and failed. */
            'reason' => $r['reason'],
            /** @var string|null */
            'send_id' => $r['send_id'],
        ];
    }
}
