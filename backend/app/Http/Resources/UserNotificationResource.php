<?php

declare(strict_types=1);

namespace App\Http\Resources;

use App\Http\Support\Json;
use App\Models\Notifications\UserNotification;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin UserNotification */
final class UserNotificationResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            /** approval_requested, approval_reminder, document_approved, document_returned, import_finished, import_failed, report_ready, send_failed */
            'kind' => $this->kind,
            'title' => $this->title,
            'body' => $this->body,
            'subject_type' => $this->subject_type,
            'subject_id' => $this->subject_id,
            /** Path inside the company; the SPA puts the company in front. */
            'link' => $this->link,
            'read' => $this->read_at !== null,
            'read_at' => Json::time($this->read_at),
            'created_at' => Json::time($this->created_at),
        ];
    }
}
