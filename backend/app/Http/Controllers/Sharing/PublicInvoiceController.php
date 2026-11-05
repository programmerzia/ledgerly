<?php

declare(strict_types=1);

namespace App\Http\Controllers\Sharing;

use App\Actions\Sharing\RecordInvoiceLinkView;
use App\Domain\Shared\DomainRuleViolation;
use App\Http\Controllers\Controller;
use App\Http\Resources\PublicInvoiceResource;
use App\Jobs\Documents\RenderDocumentPdf;
use App\Services\Reports\ExportStore;
use App\Services\Sharing\InvoiceLinkAccess;
use App\Services\Sharing\OpenedInvoiceLink;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * The public online invoice page (plan 3c.7b). No sign-in, no session, no tenant or company in the address: the token is the
 * credential and `InvoiceLinkAccess::open` is the only way in. Every token that gives no access answers the same 404, so the page
 * cannot tell which tokens ever existed. The routes carry no-index, no-referrer and no-store headers and an IP rate limit.
 *
 * The PDF is made on the worker like every document PDF, never in the request: the first GET queues it and answers 202 with its
 * status, later GETs answer 202 until it is ready and then stream it. One PDF is kept per link, tagged with the invoice's version and
 * status, so a payment or reversal makes the next GET render a fresh one.
 */
final class PublicInvoiceController extends Controller
{
    /** The invoice, its status and balance due, and how to pay. Opening it is logged. */
    public function show(Request $request, string $token, InvoiceLinkAccess $access, RecordInvoiceLinkView $views): PublicInvoiceResource
    {
        $resource = $access->open($token, function (OpenedInvoiceLink $opened) use ($request, $views): PublicInvoiceResource {
            $views->handle($opened, 'page', $request->ip(), $request->userAgent());

            return PublicInvoiceResource::build($opened);
        });

        return $resource ?? throw self::gone();
    }

    /**
     * The invoice as a PDF. 202 `{data: {status}}` while it is being made (ask again in a moment), 200 with the file when ready,
     * 200 `{data: {status: failed}}` if it could not be made (add `?retry=1` to try again).
     */
    public function pdf(Request $request, string $token, InvoiceLinkAccess $access, RecordInvoiceLinkView $views, ExportStore $store): Response
    {
        $response = $access->open($token, function (OpenedInvoiceLink $o) use ($request, $views, $store): Response {
            $link = $o->link;
            $tag = "link:{$link->id}:{$o->invoice->lock_version}:{$o->invoice->status->value}";
            $record = $store->find($link->tenant_id, $link->company_id, $link->id);
            $current = $record !== null && ($record['report'] ?? null) === $tag;
            if (! $current || (($record['status'] ?? '') === 'failed' && $request->boolean('retry'))) {
                $store->queued($link->tenant_id, $link->company_id, $link->id, null, $tag, 'pdf');
                RenderDocumentPdf::dispatch($link->tenant_id, $link->company_id, $link->id, 'invoice', $o->invoice->id, []);

                return response()->json(['data' => ['status' => 'queued']], 202);
            }
            if (($record['status'] ?? '') !== 'ready') {
                $status = (string) ($record['status'] ?? 'queued');

                return response()->json(['data' => ['status' => $status]], $status === 'failed' ? 200 : 202);
            }

            $views->handle($o, 'pdf', $request->ip(), $request->userAgent());
            $path = (string) $record['path'];
            $disk = $store->disk();

            return response()->streamDownload(function () use ($disk, $path): void {
                $stream = $disk->readStream($path);
                if (is_resource($stream)) {
                    fpassthru($stream);
                    fclose($stream);
                }
            }, (string) ($record['filename'] ?? 'invoice.pdf'), ['Content-Type' => 'application/pdf']);
        });

        return $response ?? throw self::gone();
    }

    private static function gone(): DomainRuleViolation
    {
        return DomainRuleViolation::single('link_not_found', 'This link is not valid or is no longer available.');
    }
}
