<?php

declare(strict_types=1);

namespace App\Http\Controllers\Files;

use App\Actions\Files\ManageAttachment;
use App\Contracts\AttachmentStore;
use App\Http\Controllers\Controller;
use App\Http\Requests\Files\ListAttachmentsRequest;
use App\Http\Requests\Files\UploadIntentRequest;
use App\Http\Resources\AttachmentResource;
use App\Http\Support\CursorPage;
use App\Http\Support\Json;
use App\Http\Support\RequestActor;
use App\Models\Files\Attachment;
use App\Models\Organisation\Company;
use App\Queries\Files\ListAttachments;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Response;
use Illuminate\Routing\Attributes\Controllers\Authorize;
use Illuminate\Support\Facades\Gate;

/** Files on documents and contacts: presigned upload → complete → scan → signed download (13 §17). */
final class AttachmentController extends Controller
{
    #[Authorize('viewAny', Attachment::class)]
    public function index(ListAttachmentsRequest $request, Company $company, ListAttachments $attachments): AnonymousResourceCollection
    {
        Gate::authorize('viewFor', [Attachment::class, $request->type(), $request->parent()]);
        $page = CursorPage::fetch($attachments($company->id, $request->type(), (string) $request->validated()['attachable_id']), $request, 'created_at', descending: true, kind: 'timestamp');

        return AttachmentResource::collection($page->items)->additional(['meta' => ['next_cursor' => $page->nextCursor, 'prev_cursor' => $page->prevCursor, 'limit' => $page->limit]]);
    }

    #[Authorize('view', 'attachment')]
    public function show(Company $company, Attachment $attachment): AttachmentResource
    {
        return new AttachmentResource($attachment);
    }

    /** Creates the pending row and answers with the presigned target to PUT the bytes to. */
    #[Authorize('create', Attachment::class)]
    public function store(UploadIntentRequest $request, Company $company, ManageAttachment $action, AttachmentStore $store): JsonResponse
    {
        Gate::authorize('attachTo', [Attachment::class, (string) $request->validated()['attachable_type'], $request->parent()]);
        $attachment = $action->requestUpload(RequestActor::from($request, $company->id), $request->toInput());
        // Carbon's clock, because the framework checks signed-URL expiry against it.
        $expires = now()->addMinutes((int) config('attachments.upload_ttl_minutes'));
        $target = $store->uploadTarget($attachment, $expires);

        return (new AttachmentResource($attachment))->additional(['upload' => [
            'url' => $target->url, 'method' => $target->method, 'headers' => $target->headers, 'expires_at' => Json::time($target->expiresAt),
        ]])->response()->setStatusCode(201);
    }

    /** The client says the bytes are uploaded; size and SHA-256 are verified and the scan is queued. */
    #[Authorize('complete', 'attachment')]
    public function complete(Request $request, Company $company, Attachment $attachment, ManageAttachment $action): AttachmentResource
    {
        return new AttachmentResource($action->complete(RequestActor::from($request, $company->id), $attachment->id));
    }

    /** A 5-minute signed URL; only for a file that is `clean`. */
    #[Authorize('download', 'attachment')]
    public function download(Company $company, Attachment $attachment, AttachmentStore $store): JsonResponse
    {
        $expires = now()->addSeconds((int) config('attachments.download_ttl_seconds'));

        return response()->json(['data' => [
            'url' => $store->downloadUrl($attachment, $expires),
            'expires_at' => Json::time($expires),
            'filename' => (string) $attachment->original_name,
        ]]);
    }

    #[Authorize('delete', 'attachment')]
    public function destroy(Request $request, Company $company, Attachment $attachment, ManageAttachment $action): Response
    {
        $action->delete(RequestActor::from($request, $company->id), $attachment->id);

        return response()->noContent();
    }
}
