<?php

declare(strict_types=1);

namespace App\Models\Files;

use App\Domain\Files\ScanStatus;
use App\Models\BaseModel;
use Carbon\CarbonImmutable;

/**
 * @property string $id
 * @property string $tenant_id
 * @property string $company_id
 * @property string $attachable_type journal | invoice | bill | contact | settlement
 * @property string $attachable_id
 * @property string $disk
 * @property string $path object key; never shown to clients
 * @property string $original_name sanitised
 * @property string $mime
 * @property int $size
 * @property string $sha256
 * @property ScanStatus $scan_status
 * @property string|null $scan_detail
 * @property CarbonImmutable|null $completed_at
 * @property CarbonImmutable|null $scanned_at
 * @property int $scan_attempts
 * @property CarbonImmutable|null $scan_checked_at
 * @property bool $added_after_posting
 * @property string|null $uploaded_by
 * @property int $lock_version
 * @property CarbonImmutable $created_at
 */
class Attachment extends BaseModel
{
    /** @var list<string> */
    protected $hidden = ['path', 'disk'];

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'scan_status' => ScanStatus::class, 'size' => 'integer', 'scan_attempts' => 'integer', 'lock_version' => 'integer',
            'added_after_posting' => 'boolean', 'completed_at' => 'immutable_datetime', 'scanned_at' => 'immutable_datetime',
            'scan_checked_at' => 'immutable_datetime', 'created_at' => 'immutable_datetime', 'updated_at' => 'immutable_datetime',
        ];
    }
}
