<?php

declare(strict_types=1);

namespace App\Http\Resources;

use App\Http\Support\Json;
use App\Models\Files\Attachment;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin Attachment */
final class AttachmentResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'attachable_type' => $this->attachable_type,
            'attachable_id' => $this->attachable_id,
            'filename' => $this->original_name,
            'mime' => $this->mime,
            'size' => $this->size,
            'sha256' => $this->sha256,
            'scan_status' => $this->scan_status->value,
            'scan_detail' => $this->scan_detail,
            'upload_completed' => $this->completed_at !== null,
            'added_after_posting' => $this->added_after_posting,
            'uploaded_by' => $this->uploaded_by,
            'created_at' => Json::time($this->created_at),
            'can' => Json::can($request, $this->resource, ['download' => 'download', 'delete' => 'delete']),
        ];
    }
}
