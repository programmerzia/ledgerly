<?php

declare(strict_types=1);

namespace App\Jobs\Documents;

use App\Models\Organisation\Company;
use App\Services\Documents\DocumentPdf;
use App\Services\Reports\ExportStore;
use App\Support\Tenancy\TenantContext;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Throwable;

/**
 * A document PDF, rendered on the `exports` worker (Chromium is not available to web processes). The tenant context is
 * held for the whole job and the document is read inside it, so row-level security applies exactly as on a request. The
 * request that queued it was authorised against the document; the file is fetched through the same document route.
 */
final class RenderDocumentPdf implements ShouldQueue
{
    use Queueable;

    public int $tries = 1;

    /** @param array<string, mixed> $params */
    public function __construct(
        public readonly string $tenantId,
        public readonly string $companyId,
        public readonly string $pdfId,
        public readonly string $type,
        public readonly string $documentId,
        public readonly array $params = [],
    ) {
        $this->onQueue('exports');
    }

    public function handle(TenantContext $tenant, DocumentPdf $pdf, ExportStore $store): void
    {
        $tenant->run($this->tenantId, function () use ($pdf, $store): void {
            $company = Company::query()->findOrFail($this->companyId);
            $built = $pdf->render($this->type, $company, $this->documentId, $this->params);
            $file = tempnam(sys_get_temp_dir(), 'document-pdf-');
            if ($file === false) {
                throw new \RuntimeException('No temporary file for the PDF.');
            }
            try {
                file_put_contents($file, $built['pdf']);
                $store->ready($this->tenantId, $this->companyId, $this->pdfId, $file, ['filename' => $built['filename']]);
            } finally {
                @unlink($file);
            }
        });
    }

    public function failed(Throwable $e): void
    {
        app(ExportStore::class)->failed($this->tenantId, $this->companyId, $this->pdfId);
    }
}
