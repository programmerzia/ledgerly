<?php

declare(strict_types=1);

namespace Tests\Support;

use App\Contracts\VirusScanner;
use App\Jobs\Files\ScanAttachment;
use App\Support\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Testing\TestResponse;

/** The attachment flow over HTTP, with a fake scanner and a fake disk. Used with MakesApiCalls and TradeApi. */
trait UploadsAttachments
{
    public FakeVirusScanner $scanner;

    protected const string PDF = "%PDF-1.4\n1 0 obj<< /Type /Catalog >>endobj\ntrailer<< /Root 1 0 R >>\n%%EOF\n";

    protected function setUpAttachments(): void
    {
        $this->setUpTrade();
        Storage::fake('attachments');
        $this->scanner = new FakeVirusScanner;
        app()->instance(VirusScanner::class, $this->scanner);
    }

    /**
     * Announces an upload (does not send the bytes).
     *
     * @param  array<string, mixed>  $override
     */
    protected function announce(string $type, string $id, string $content = self::PDF, string $filename = 'receipt.pdf', string $mime = 'application/pdf', array $override = []): TestResponse
    {
        return $this->postJson($this->api('attachments/uploads'), [
            'attachable_type' => $type, 'attachable_id' => $id, 'filename' => $filename, 'mime' => $mime,
            'size' => strlen($content), 'sha256' => hash('sha256', $content), ...$override,
        ], $this->key());
    }

    protected function putBytes(string $url, string $content): TestResponse
    {
        return $this->call('PUT', $url, [], [], [], ['CONTENT_TYPE' => 'application/octet-stream'], $content);
    }

    /**
     * Announce, upload and complete as the current principal; answers the attachment JSON.
     *
     * @return array<string, mixed>
     */
    protected function uploaded(string $type, string $id, string $content = self::PDF, string $filename = 'receipt.pdf', string $mime = 'application/pdf'): array
    {
        $intent = $this->announce($type, $id, $content, $filename, $mime)->assertCreated();
        $this->putBytes($intent->json('upload.url'), $content)->assertNoContent();

        return $this->postJson($this->api("attachments/{$intent->json('data.id')}/complete"), [], $this->key())->assertOk()->json('data');
    }

    /** Runs the scan job the way a worker does: no tenant context beforehand. */
    protected function runScan(string $attachmentId): void
    {
        app(TenantContext::class)->clear();
        ScanAttachment::dispatchSync($this->f->tenantId, $this->f->companyId, $attachmentId);
    }

    /** @return array<string, mixed> the row, read as the owner of the tenant */
    protected function row(string $attachmentId): array
    {
        return (array) $this->inTenant(fn () => DB::table('attachments')->where('id', $attachmentId)->first());
    }

    /** @return list<string> */
    protected function storedFiles(): array
    {
        return Storage::disk('attachments')->allFiles();
    }
}
