<?php

declare(strict_types=1);

namespace App\Http\Controllers\Files;

use App\Contracts\AttachmentStore;
use App\Domain\Files\ScanStatus;
use App\Domain\Shared\DomainRuleViolation;
use App\Http\Controllers\Controller;
use App\Models\Files\Attachment;
use App\Services\Files\LocalAttachmentStore;
use App\Support\Tenancy\TenantContext;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Symfony\Component\HttpFoundation\HeaderUtils;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * The local-disk store's "presigned" endpoints. There is no session or token here: the `signed` middleware (HMAC of the
 * URL with the app key, plus expiry) is the credential, and the tenant id in the URL only selects the RLS context to
 * look the row up in. With an S3 store, clients talk to the bucket and these routes are unused.
 */
final class AttachmentBlobController extends Controller
{
    /** Receives the bytes for a pending upload. Refused once the upload is completed or if it exceeds the announced size. */
    public function put(Request $request, string $tenant, string $file, TenantContext $tenants, AttachmentStore $store): Response
    {
        if (! $store instanceof LocalAttachmentStore) {
            abort(404);
        }

        return $tenants->run($tenant, function () use ($request, $file, $store): Response {
            $row = Attachment::query()->find($file) ?? abort(404);
            if ($row->completed_at !== null) {
                abort(403);
            }
            if ($store->receive($row->path, $request->getContent(true), $row->size) === null) {
                throw DomainRuleViolation::single('upload_too_large', 'The upload is larger than the announced size.');
            }

            return response()->noContent();
        });
    }

    /** Streams a clean file as a download, never inline. */
    public function show(Request $request, string $tenant, string $file, TenantContext $tenants, AttachmentStore $store): StreamedResponse
    {
        return $tenants->run($tenant, function () use ($file, $store): StreamedResponse {
            $row = Attachment::query()->find($file) ?? abort(404);
            if ($row->scan_status !== ScanStatus::Clean) {
                abort(404); // not served until clean, whatever the URL says
            }
            $stream = $store->readStream($row->path) ?? abort(404);

            $name = $row->original_name; // sanitised at intake; the header builder quotes and encodes it again
            $fallback = (string) preg_replace('/[^\x20-\x7e]|[%\\\\"]/', '_', $name);
            $response = new StreamedResponse(function () use ($stream): void {
                fpassthru($stream);
                fclose($stream);
            });
            $response->headers->set('Content-Type', $row->mime);
            $response->headers->set('Content-Length', (string) $row->size);
            $response->headers->set('Content-Disposition', HeaderUtils::makeDisposition(HeaderUtils::DISPOSITION_ATTACHMENT, $name, $fallback));
            $response->headers->set('X-Content-Type-Options', 'nosniff');
            $response->headers->set('Content-Security-Policy', "default-src 'none'; sandbox");
            $response->headers->set('Cache-Control', 'private, no-store');

            return $response;
        });
    }
}
