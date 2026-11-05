<?php

declare(strict_types=1);

namespace App\Http\Controllers\Documents;

use App\Http\Controllers\Controller;
use App\Http\Requests\Documents\DocumentPdfRequest;
use App\Http\Support\RequestActor;
use App\Jobs\Documents\RenderDocumentPdf;
use App\Models\Organisation\Company;
use App\Services\Documents\DocumentRoutes;
use App\Services\Reports\ExportStore;
use App\Support\Audit\DetachedAudit;
use App\Support\Tenancy\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\Response;

/**
 * PDF of a document (plan 3c.4). The routes sit under the document they print and carry that document's `view` policy, so
 * who may read a document is who may download its PDF. A PDF is always rendered on the `exports` worker: POST queues it,
 * GET returns its status and then the file. The request is audited (a read has no transaction to ride on, so the event goes
 * through DetachedAudit). A draft or voided document prints with a watermark saying so.
 */
final class DocumentPdfController extends Controller
{
    /** Queue the PDF. */
    public function store(DocumentPdfRequest $request, Company $company, ExportStore $store, DetachedAudit $audit, TenantContext $tenant): JsonResponse
    {
        $target = DocumentRoutes::resolve($request, $request->validated());
        $id = (string) Str::uuid7();
        $store->queued($tenant->require(), $company->id, $id, $this->me($request), DocumentRoutes::tag($target['model']), 'pdf');
        $audit->record(RequestActor::from($request, $company->id), 'document.pdf_requested', $target['model'], ['document_type' => $target['type'], ...$target['params']]);
        RenderDocumentPdf::dispatch($tenant->require(), $company->id, $id, $target['type'], (string) $target['model']->getKey(), $target['params']);

        return response()->json(['data' => ['id' => $id, 'status' => 'queued', 'document_type' => $target['type']]], 202);
    }

    /** Status of a queued PDF; the file itself once it is ready. */
    public function show(Request $request, Company $company, ExportStore $store, TenantContext $tenant): Response
    {
        // By name from the route: a bound document parameter in front of it would shift a positional argument.
        $pdfId = (string) $request->route('pdfId');
        $model = DocumentRoutes::model($request);
        $record = $store->find($tenant->require(), $company->id, $pdfId);
        // Only the person who asked, and only through the document it was made for.
        if ($record === null || ($record['owner'] ?? null) !== $this->me($request) || ($record['report'] ?? null) !== DocumentRoutes::tag($model)) {
            abort(404);
        }
        if (($record['status'] ?? '') !== 'ready') {
            return response()->json(['data' => ['id' => $pdfId, 'status' => $record['status'] ?? 'queued']]);
        }

        $path = (string) $record['path'];
        $disk = $store->disk();

        return response()->streamDownload(function () use ($disk, $path): void {
            $stream = $disk->readStream($path);
            if (is_resource($stream)) {
                fpassthru($stream);
                fclose($stream);
            }
        }, (string) ($record['filename'] ?? 'document.pdf'), ['Content-Type' => 'application/pdf', 'X-Content-Type-Options' => 'nosniff']);
    }

    private function me(Request $request): ?string
    {
        $principal = call_user_func($request->getUserResolver());

        return is_object($principal) && method_exists($principal, 'getAuthIdentifier') ? (string) $principal->getAuthIdentifier() : null;
    }
}
