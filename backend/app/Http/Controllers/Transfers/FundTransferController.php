<?php

declare(strict_types=1);

namespace App\Http\Controllers\Transfers;

use App\Actions\Transfers\ReceiveFundTransfer;
use App\Actions\Transfers\ReverseFundTransfer;
use App\Actions\Transfers\SaveFundTransferDraft;
use App\Actions\Workflow\ApproveDocument;
use App\Actions\Workflow\Inputs\DocumentRef;
use App\Actions\Workflow\Inputs\ReturnDocumentInput;
use App\Actions\Workflow\Inputs\VoidDocumentInput;
use App\Actions\Workflow\ReturnDocument;
use App\Actions\Workflow\SubmitDocument;
use App\Actions\Workflow\VoidDocument;
use App\Http\Controllers\Controller;
use App\Http\Requests\Ledger\ReturnJournalRequest;
use App\Http\Requests\Ledger\ReverseJournalRequest;
use App\Http\Requests\Ledger\VoidJournalRequest;
use App\Http\Requests\Trade\ListPaymentRunsRequest;
use App\Http\Requests\Transfers\FundTransferRequest;
use App\Http\Requests\Transfers\ReceiveFundTransferRequest;
use App\Http\Requests\TransitionRequest;
use App\Http\Resources\FundTransferResource;
use App\Http\Resources\InvoicePostingPreviewResource;
use App\Http\Support\CursorPage;
use App\Http\Support\RequestActor;
use App\Models\Organisation\Company;
use App\Models\Transfers\FundTransfer;
use App\Queries\Transfers\PreviewFundTransferPosting;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Routing\Attributes\Controllers\Authorize;

/**
 * Fund transfers (`transfers.*`): between two bank or cash accounts through funds in transit. Approve posts the send leg
 * (and the receive leg too for a same-day transfer); `receive` books the arrival later; `reverse` undoes the legs.
 * Tokens read only (`fund-transfers:read`).
 */
final class FundTransferController extends Controller
{
    #[Authorize('viewAny', FundTransfer::class)]
    public function index(ListPaymentRunsRequest $request, Company $company): AnonymousResourceCollection
    {
        $query = FundTransfer::query()->where('company_id', $company->id);
        if ($request->filled('status')) {
            $query->where('status', (string) $request->query('status'));
        }
        $page = CursorPage::fetch($query, $request, 'send_date', descending: true, kind: 'date');

        return FundTransferResource::collection($page->items)->additional(['meta' => ['next_cursor' => $page->nextCursor, 'prev_cursor' => $page->prevCursor, 'limit' => $page->limit]]);
    }

    #[Authorize('view', 'fundTransfer')]
    public function show(Company $company, FundTransfer $fundTransfer): FundTransferResource
    {
        return new FundTransferResource($fundTransfer);
    }

    #[Authorize('create', FundTransfer::class)]
    public function store(FundTransferRequest $request, Company $company, SaveFundTransferDraft $action): JsonResponse
    {
        $t = $action->handle(RequestActor::from($request, $company->id), $request->toInput());

        return (new FundTransferResource($t))->response()->setStatusCode(201);
    }

    #[Authorize('update', 'fundTransfer')]
    public function update(FundTransferRequest $request, Company $company, FundTransfer $fundTransfer, SaveFundTransferDraft $action): FundTransferResource
    {
        return new FundTransferResource($action->handle(RequestActor::from($request, $company->id), $request->toInput(), $fundTransfer->id, $request->version()));
    }

    #[Authorize('view', 'fundTransfer')]
    public function preview(Request $request, Company $company, FundTransfer $fundTransfer, PreviewFundTransferPosting $preview): InvoicePostingPreviewResource
    {
        return new InvoicePostingPreviewResource($preview->of(RequestActor::from($request, $company->id), $fundTransfer->id));
    }

    #[Authorize('submit', 'fundTransfer')]
    public function submit(TransitionRequest $request, Company $company, FundTransfer $fundTransfer, SubmitDocument $action): FundTransferResource
    {
        $action->handle(RequestActor::from($request, $company->id), $this->ref($fundTransfer, $request->version()));

        return new FundTransferResource($this->fresh($fundTransfer->id));
    }

    #[Authorize('approve', 'fundTransfer')]
    public function approve(TransitionRequest $request, Company $company, FundTransfer $fundTransfer, ApproveDocument $action): FundTransferResource
    {
        $action->handle(RequestActor::from($request, $company->id), $this->ref($fundTransfer, $request->version()), $request->comment());

        return new FundTransferResource($this->fresh($fundTransfer->id));
    }

    #[Authorize('return', 'fundTransfer')]
    public function return(ReturnJournalRequest $request, Company $company, FundTransfer $fundTransfer, ReturnDocument $action): FundTransferResource
    {
        $action->handle(RequestActor::from($request, $company->id), new ReturnDocumentInput($this->ref($fundTransfer, $request->version()), $request->comment()));

        return new FundTransferResource($this->fresh($fundTransfer->id));
    }

    #[Authorize('void', 'fundTransfer')]
    public function void(VoidJournalRequest $request, Company $company, FundTransfer $fundTransfer, VoidDocument $action): FundTransferResource
    {
        $action->handle(RequestActor::from($request, $company->id), new VoidDocumentInput($this->ref($fundTransfer, $request->version()), $request->reason()));

        return new FundTransferResource($this->fresh($fundTransfer->id));
    }

    #[Authorize('receive', 'fundTransfer')]
    public function receive(ReceiveFundTransferRequest $request, Company $company, FundTransfer $fundTransfer, ReceiveFundTransfer $action): FundTransferResource
    {
        $action->handle(RequestActor::from($request, $company->id), $fundTransfer->id, $request->receivedOn(), $request->toAmount(), $request->rate(), $request->version());

        return new FundTransferResource($this->fresh($fundTransfer->id));
    }

    #[Authorize('reverse', 'fundTransfer')]
    public function reverse(ReverseJournalRequest $request, Company $company, FundTransfer $fundTransfer, ReverseFundTransfer $action): FundTransferResource
    {
        $in = $request->toInput($fundTransfer->id);
        $action->handle(RequestActor::from($request, $company->id), $fundTransfer->id, $in->date, $in->lockVersion, $in->memo);

        return new FundTransferResource($this->fresh($fundTransfer->id));
    }

    private function ref(FundTransfer $t, ?int $version): DocumentRef
    {
        return new DocumentRef('fund_transfer', $t->id, $version);
    }

    private function fresh(string $id): FundTransfer
    {
        return FundTransfer::query()->findOrFail($id);
    }
}
