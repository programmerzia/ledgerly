<?php

declare(strict_types=1);

namespace App\Http\Controllers\Documents;

use App\Actions\Documents\SendDocumentByEmail;
use App\Domain\Documents\MessageTemplate;
use App\Http\Controllers\Controller;
use App\Http\Requests\Documents\DocumentPdfRequest;
use App\Http\Requests\Documents\SendDocumentRequest;
use App\Http\Resources\DocumentSendResource;
use App\Http\Support\RequestActor;
use App\Models\Documents\DocumentSend;
use App\Models\Organisation\Company;
use App\Models\Platform\User;
use App\Models\Trade\Contact;
use App\Models\Trade\Invoice;
use App\Services\Documents\DocumentLook;
use App\Services\Documents\DocumentRoutes;
use App\Services\Documents\EmailTargets;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\Gate;

/**
 * Sending invoices, credit notes, statements and payment advices by email (plan 3c.5). The routes sit under the document and
 * carry its `send` policy (permission `documents.send`); the Action checks again and refuses anything that is not posted.
 * Sends are limited per company (the `document-emails` limiter).
 */
final class DocumentEmailController extends Controller
{
    /** The message as it would go out, with the contact's address as the default recipient. Nothing is sent. */
    public function draft(DocumentPdfRequest $request, Company $company, EmailTargets $targets, DocumentLook $look): JsonResponse
    {
        $model = DocumentRoutes::model($request);
        $input = $request->validated();
        $target = $targets->resolve($model, $company, $input, $this->senderName($request));
        $template = $look->for($company->id)['email'][$target->family];
        $email = $target->contact->email;

        return response()->json(['data' => [
            'document_type' => $target->family,
            'recipients' => $email === null || $email === '' ? [] : [$email],
            'subject' => trim(MessageTemplate::render($template['subject'], $target->values)),
            'body' => trim(MessageTemplate::render($template['body'], $target->values)),
            'contact_name' => $target->contact->name,
            'can_send' => Gate::allows('send', $model),
            /** May add an online link to the message (the invoice_link placeholder): invoices only, and needs the right to share. */
            'can_share' => $model instanceof Invoice && Gate::allows('share', $model),
        ]]);
    }

    /** Queue the email. */
    public function store(SendDocumentRequest $request, Company $company, SendDocumentByEmail $action): JsonResponse
    {
        $send = $action->handle(RequestActor::user($request, $company->id), DocumentRoutes::model($request), $request->toInput());

        return (new DocumentSendResource($send))->response()->setStatusCode(202);
    }

    /** The send log of this document, newest first. */
    public function index(Request $request, Company $company): AnonymousResourceCollection
    {
        $model = DocumentRoutes::model($request);
        $type = $model instanceof Contact ? 'statement' : null;

        return DocumentSendResource::collection(
            DocumentSend::query()->where('company_id', $company->id)->where('document_id', $model->getKey())
                ->when($type !== null, fn ($q) => $q->where('document_type', $type))
                ->orderByDesc('queued_at')->orderByDesc('id')->limit(50)->get(),
        );
    }

    private function senderName(Request $request): string
    {
        $user = call_user_func($request->getUserResolver());

        return $user instanceof User ? (string) $user->getAttribute('name') : '';
    }
}
