<?php

declare(strict_types=1);

namespace App\Http\Controllers\Sharing;

use App\Actions\Sharing\ManageInvoiceLinks;
use App\Http\Controllers\Controller;
use App\Http\Requests\Sharing\CreateInvoiceLinkRequest;
use App\Http\Resources\InvoiceShareLinkResource;
use App\Http\Support\RequestActor;
use App\Models\Organisation\Company;
use App\Models\Sharing\InvoiceShareLink;
use App\Models\Trade\Invoice;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

/**
 * The online link of an invoice, for the people who issue it (plan 3c.7b). Routes carry the invoice's `share` policy
 * (permission `documents.share`) to make or revoke and its `view` policy to list. The address is returned once, when the link is
 * made; the list shows status, expiry and how often it was opened, never the address.
 */
final class InvoiceShareLinkController extends Controller
{
    /** The invoice's links, newest first. */
    public function index(Request $request, Company $company, Invoice $invoice): AnonymousResourceCollection
    {
        return InvoiceShareLinkResource::collection(
            InvoiceShareLink::query()->where('company_id', $company->id)->where('invoice_id', $invoice->id)->orderByDesc('created_at')->orderByDesc('id')->limit(50)->get(),
        );
    }

    /** Make a link. `data.url` is the only time the address is shown. */
    public function store(CreateInvoiceLinkRequest $request, Company $company, Invoice $invoice, ManageInvoiceLinks $action): JsonResponse
    {
        $made = $action->create(RequestActor::user($request, $company->id), $invoice, $request->expiresInDays());

        return response()->json(['data' => [...(new InvoiceShareLinkResource($made['link']))->resolve($request), 'url' => $made['url']]], 201);
    }

    /** Revoke a link: its address stops working at once. Revoking twice is fine. */
    public function revoke(Request $request, Company $company, Invoice $invoice, string $link, ManageInvoiceLinks $action): InvoiceShareLinkResource
    {
        return new InvoiceShareLinkResource($action->revoke(RequestActor::user($request, $company->id), $invoice, $link));
    }
}
