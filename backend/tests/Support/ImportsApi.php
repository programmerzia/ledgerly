<?php

declare(strict_types=1);

namespace Tests\Support;

use App\Jobs\Imports\ApplyImportJob;
use App\Models\Platform\User;
use App\Support\Tenancy\TenantContext;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;
use OpenSpout\Common\Entity\Cell\StringCell;
use OpenSpout\Common\Entity\Row;
use OpenSpout\Writer\XLSX\Writer;

/** HTTP helpers for the import tests; used with MakesApiCalls, TradeApi and BankingApi. */
trait ImportsApi
{
    /**
     * Uploads a file as $by (default: the owner) and answers the response.
     *
     * @param  array<string, mixed>  $options
     */
    protected function upload(string $kind, string $content, array $options = [], string $name = 'data.csv', ?User $by = null): TestResponse
    {
        return $this->asPerson($by ?? $this->owner)->post($this->api('imports'), [
            'kind' => $kind, 'file' => UploadedFile::fake()->createWithContent($name, $content),
            ...($options === [] ? [] : ['options' => json_encode($options, JSON_THROW_ON_ERROR)]),
        ], [...$this->key(), 'Accept' => 'application/json']);
    }

    /**
     * Upload, map and preview in one go; answers the previewed import.
     *
     * @param  array<string, string>  $columns
     * @param  array<string, mixed>  $options
     * @return array<string, mixed>
     */
    protected function previewed(string $kind, string $content, array $columns, array $options = [], ?User $by = null, array $defaults = []): array
    {
        $import = $this->upload($kind, $content, $options, by: $by)->assertCreated()->json('data');

        return $this->mapAndPreview($import, $columns, $options, $by, $defaults);
    }

    /**
     * @param  array<string, mixed>  $import
     * @param  array<string, string>  $columns
     * @param  array<string, mixed>  $options
     * @param  array<string, string>  $defaults
     * @return array<string, mixed>
     */
    protected function mapAndPreview(array $import, array $columns, array $options = [], ?User $by = null, array $defaults = []): array
    {
        $by ??= $this->owner;
        $mapped = $this->asPerson($by)->putJson($this->api("imports/{$import['id']}/mapping"), [
            'version' => $import['version'], 'columns' => $columns, 'defaults' => $defaults, ...($options === [] ? [] : ['options' => $options]),
        ], $this->key())->assertOk()->json('data');

        return $this->asPerson($by)->postJson($this->api("imports/{$mapped['id']}/preview"), [], $this->key())->assertOk()->json('data');
    }

    /** @return TestResponse the apply request (signed by default, as the opening balances need) */
    protected function requestApply(string $id, ?User $by = null, bool $signing = true): TestResponse
    {
        return $this->asPerson($by ?? $this->owner, signing: $signing)->postJson($this->api("imports/{$id}/apply"), [], $this->key());
    }

    /** Runs the queued job the way a worker does: no tenant context set beforehand. */
    protected function runJob(string $id): void
    {
        app(TenantContext::class)->clear();
        ApplyImportJob::dispatchSync($this->f->tenantId, $this->f->companyId, $id);
    }

    /** @return array<string, mixed> */
    protected function importOf(string $id, ?User $by = null): array
    {
        return $this->asPerson($by ?? $this->owner)->getJson($this->api("imports/{$id}"))->assertOk()->json('data');
    }

    /** @return array<int, array<string, mixed>> the rows by row number */
    protected function rowsOf(string $id, ?User $by = null): array
    {
        $rows = $this->asPerson($by ?? $this->owner)->getJson($this->api("imports/{$id}/rows?limit=200"))->assertOk()->json('data');

        return array_column($rows, null, 'row_number');
    }

    /** @param list<list<string>> $rows */
    protected function xlsx(array $rows): string
    {
        $path = tempnam(sys_get_temp_dir(), 'imp').'.xlsx';
        $writer = new Writer;
        $writer->openToFile($path);
        foreach ($rows as $row) {
            $writer->addRow(new Row(array_map(fn (string $v) => new StringCell($v, null), $row)));
        }
        $writer->close();
        $bytes = (string) file_get_contents($path);
        unlink($path);

        return $bytes;
    }

    /** @return int rows in a tenant table (RLS applies, so the tenant context is set for the count) */
    protected function rowCount(string $table): int
    {
        return $this->inTenant(fn () => DB::table($table)->count());
    }
}
