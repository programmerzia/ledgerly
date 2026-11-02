<?php

declare(strict_types=1);

namespace App\Http\Resources;

use App\Queries\Audit\AuditChainReport;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin AuditChainReport */
final class AuditChainReportResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        return [
            'intact' => $this->intact,
            'events_checked' => $this->eventsChecked,
            'started_after_id' => $this->startedAfterId,
            'broken_at_id' => $this->brokenAtId,
            'problem' => $this->problem,
            'detail' => $this->detail,
        ];
    }
}
