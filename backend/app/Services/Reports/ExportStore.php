<?php

declare(strict_types=1);

namespace App\Services\Reports;

use Illuminate\Contracts\Cache\Repository;
use Illuminate\Contracts\Filesystem\Filesystem;
use Illuminate\Support\Facades\Storage;

/**
 * Where a queued export is tracked and kept. The status record lives in the cache under a key that holds
 * tenant and company, so another tenant's id never finds it; the file lives on the export disk under the
 * same path. Both expire after `reports.export_ttl_minutes`; a bucket lifecycle rule removes the files.
 */
final class ExportStore
{
    public function __construct(private readonly Repository $cache) {}

    public function queued(string $tenantId, string $companyId, string $id, ?string $owner, string $report, string $format): void
    {
        $this->put($tenantId, $companyId, $id, ['id' => $id, 'status' => 'queued', 'report' => $report, 'format' => $format, 'owner' => $owner]);
    }

    public function ready(string $tenantId, string $companyId, string $id, string $localFile): void
    {
        $record = $this->find($tenantId, $companyId, $id) ?? [];
        $path = self::path($tenantId, $companyId, $id, (string) ($record['format'] ?? 'bin'));
        $stream = fopen($localFile, 'rb');
        if ($stream === false) {
            throw new \RuntimeException('The export file cannot be read.');
        }
        $this->disk()->put($path, $stream);
        fclose($stream);
        $this->put($tenantId, $companyId, $id, ['status' => 'ready', 'path' => $path] + $record);
    }

    public function failed(string $tenantId, string $companyId, string $id): void
    {
        $this->put($tenantId, $companyId, $id, ['status' => 'failed'] + ($this->find($tenantId, $companyId, $id) ?? []));
    }

    /** @return array<string, mixed>|null */
    public function find(string $tenantId, string $companyId, string $id): ?array
    {
        $record = $this->cache->get(self::key($tenantId, $companyId, $id));

        return is_array($record) ? $record : null;
    }

    public function disk(): Filesystem
    {
        return Storage::disk((string) config('reports.export_disk'));
    }

    /** @param array<string, mixed> $record */
    private function put(string $tenantId, string $companyId, string $id, array $record): void
    {
        $this->cache->put(self::key($tenantId, $companyId, $id), $record, now()->addMinutes((int) config('reports.export_ttl_minutes')));
    }

    private static function key(string $tenantId, string $companyId, string $id): string
    {
        return "report_export:{$tenantId}:{$companyId}:{$id}";
    }

    private static function path(string $tenantId, string $companyId, string $id, string $format): string
    {
        return "report-exports/{$tenantId}/{$companyId}/{$id}.{$format}";
    }
}
