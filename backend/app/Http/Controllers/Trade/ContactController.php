<?php

declare(strict_types=1);

namespace App\Http\Controllers\Trade;

use App\Actions\Trade\ManageContact;
use App\Http\Controllers\Controller;
use App\Http\Requests\Trade\ContactRequest;
use App\Http\Requests\Trade\ListContactsRequest;
use App\Http\Requests\VersionRequest;
use App\Http\Resources\ContactResource;
use App\Http\Support\CursorPage;
use App\Http\Support\RequestActor;
use App\Models\Organisation\Company;
use App\Models\Trade\Contact;
use App\Queries\Trade\ContactBalances;
use App\Queries\Trade\ListContacts;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Routing\Attributes\Controllers\Authorize;

/** Customers and suppliers of a company. */
final class ContactController extends Controller
{
    #[Authorize('viewAny', Contact::class)]
    public function index(ListContactsRequest $request, Company $company, ListContacts $contacts, ContactBalances $balances): AnonymousResourceCollection
    {
        $page = CursorPage::fetch($contacts($company->id, $request->kind(), $request->active(), $request->search()), $request, 'code');
        $open = $balances($company->id, array_values($page->items->map(fn ($c) => (string) $c->getKey())->all()));
        $page->items->each(fn ($c) => $c->setAttribute('open_balances', $open[(string) $c->getKey()] ?? ['receivable' => 0, 'payable' => 0]));

        return ContactResource::collection($page->items)->additional(['meta' => ['next_cursor' => $page->nextCursor, 'prev_cursor' => $page->prevCursor, 'limit' => $page->limit]]);
    }

    #[Authorize('view', 'contact')]
    public function show(Company $company, Contact $contact, ContactBalances $balances): ContactResource
    {
        $contact->setAttribute('open_balances', $balances($company->id, [$contact->id])[$contact->id] ?? ['receivable' => 0, 'payable' => 0]);

        return new ContactResource($contact);
    }

    #[Authorize('create', Contact::class)]
    public function store(ContactRequest $request, Company $company, ManageContact $action): JsonResponse
    {
        $contact = $action->create(RequestActor::from($request, $company->id), $request->toInput());

        return (new ContactResource($contact))->response()->setStatusCode(201);
    }

    #[Authorize('update', 'contact')]
    public function update(ContactRequest $request, Company $company, Contact $contact, ManageContact $action): ContactResource
    {
        return new ContactResource($action->update(RequestActor::from($request, $company->id), $contact->id, $request->version(), $request->toInput()));
    }

    #[Authorize('deactivate', 'contact')]
    public function deactivate(VersionRequest $request, Company $company, Contact $contact, ManageContact $action): ContactResource
    {
        return new ContactResource($action->deactivate(RequestActor::from($request, $company->id), $contact->id, $request->version()));
    }
}
