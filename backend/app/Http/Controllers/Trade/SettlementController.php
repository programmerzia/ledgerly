<?php

declare(strict_types=1);

namespace App\Http\Controllers\Trade;

use App\Actions\Trade\ApplyCredit;
use App\Actions\Trade\CreateSettlementDraft;
use App\Actions\Trade\Inputs\ApplyCreditInput;
use App\Actions\Trade\Inputs\ReverseSettlementInput;
use App\Actions\Trade\Inputs\UpdateSettlementDraftInput;
use App\Actions\Trade\ReverseSettlement;
use App\Actions\Trade\UpdateSettlementDraft;
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
use App\Http\Requests\Trade\ApplyCreditRequest;
use App\Http\Requests\Trade\ListSettlementsRequest;
use App\Http\Requests\Trade\SettlementRequest;
use App\Http\Requests\TransitionRequest;
use App\Http\Resources\CreditApplicationResource;
use App\Http\Resources\InvoicePostingPreviewResource;
use App\Http\Resources\SettlementResource;
use App\Http\Support\CursorPage;
use App\Http\Support\RequestActor;
use App\Models\Organisation\Company;
use App\Models\Trade\CreditApplication;
use App\Models\Trade\Invoice;
use App\Models\Trade\Settlement;
use App\Queries\Trade\ListSettlements;
use App\Queries\Trade\PreviewSettlementPosting;
use DateTimeImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Routing\Attributes\Controllers\Authorize;

/** Receipts, payments and refunds (`receipts.*`, `payments.*`; tokens `settlements:read|write|submit`). */
final class SettlementController extends Controller
{
    #[Authorize('viewAny', Settlement::class)]
    public function index(ListSettlementsRequest $request, Company $company, ListSettlements $settlements): AnonymousResourceCollection
    {
        /** @var array{kind?: string|null, status?: string|null, contact_id?: string|null, from?: string|null, to?: string|null, search?: string|null} $filter */
        $filter = $request->validated();
        $page = CursorPage::fetch($settlements($company->id, $filter), $request, 'settlement_date', descending: true, kind: 'date');

        return SettlementResource::collection($page->items)->additional(['meta' => ['next_cursor' => $page->nextCursor, 'prev_cursor' => $page->prevCursor, 'limit' => $page->limit]]);
    }

    #[Authorize('view', 'settlement')]
    public function show(Company $company, Settlement $settlement): SettlementResource
    {
        return new SettlementResource($this->fresh($settlement->id));
    }

    #[Authorize('create', Settlement::class)]
    public function store(SettlementRequest $request, Company $company, CreateSettlementDraft $action): JsonResponse
    {
        $s = $action->handle(RequestActor::from($request, $company->id), $request->toInput());

        return (new SettlementResource($this->fresh($s->id)))->response()->setStatusCode(201);
    }

    #[Authorize('update', 'settlement')]
    public function update(SettlementRequest $request, Company $company, Settlement $settlement, UpdateSettlementDraft $action): SettlementResource
    {
        $action->handle(RequestActor::from($request, $company->id), new UpdateSettlementDraftInput($settlement->id, $request->version(), $request->toInput($settlement->kind)));

        return new SettlementResource($this->fresh($settlement->id));
    }

    /** What posting this draft would do (the journal lines), or why it cannot. Writes nothing. */
    #[Authorize('view', 'settlement')]
    public function preview(Request $request, Company $company, Settlement $settlement, PreviewSettlementPosting $preview): InvoicePostingPreviewResource
    {
        return new InvoicePostingPreviewResource($preview->of(RequestActor::from($request, $company->id), $settlement->id));
    }

    /** Posts at once when no workflow applies (a person needs a signing grant), else waits for approval. */
    #[Authorize('submit', 'settlement')]
    public function submit(TransitionRequest $request, Company $company, Settlement $settlement, SubmitDocument $action): SettlementResource
    {
        $action->handle(RequestActor::from($request, $company->id), $this->ref($settlement, $request->version()));

        return new SettlementResource($this->fresh($settlement->id));
    }

    #[Authorize('approve', 'settlement')]
    public function approve(TransitionRequest $request, Company $company, Settlement $settlement, ApproveDocument $action): SettlementResource
    {
        $action->handle(RequestActor::from($request, $company->id), $this->ref($settlement, $request->version()), $request->comment());

        return new SettlementResource($this->fresh($settlement->id));
    }

    #[Authorize('return', 'settlement')]
    public function return(ReturnJournalRequest $request, Company $company, Settlement $settlement, ReturnDocument $action): SettlementResource
    {
        $action->handle(RequestActor::from($request, $company->id), new ReturnDocumentInput($this->ref($settlement, $request->version()), $request->comment()));

        return new SettlementResource($this->fresh($settlement->id));
    }

    #[Authorize('void', 'settlement')]
    public function void(VoidJournalRequest $request, Company $company, Settlement $settlement, VoidDocument $action): SettlementResource
    {
        $action->handle(RequestActor::from($request, $company->id), new VoidDocumentInput($this->ref($settlement, $request->version()), $request->reason()));

        return new SettlementResource($this->fresh($settlement->id));
    }

    /** Reverses the posted settlement; documents get their open amounts back. Refused while its credit is applied elsewhere. */
    #[Authorize('reverse', 'settlement')]
    public function reverse(ReverseJournalRequest $request, Company $company, Settlement $settlement, ReverseSettlement $action): SettlementResource
    {
        $in = $request->toInput($settlement->id);
        $action->handle(RequestActor::from($request, $company->id), new ReverseSettlementInput($settlement->id, $in->date, $in->lockVersion, $in->memo));

        return new SettlementResource($this->fresh($settlement->id));
    }

    /** Applies the credit on account of a posted receipt or payment to an open document (D9). */
    #[Authorize('allocate', 'settlement')]
    public function allocate(ApplyCreditRequest $request, Company $company, Settlement $settlement, ApplyCredit $action): JsonResponse
    {
        $v = $request->validated();
        $application = $action->handle(RequestActor::from($request, $company->id), new ApplyCreditInput(
            (string) $v['invoice_id'], (int) $v['amount_fc'], settlementId: $settlement->id,
            date: isset($v['date']) ? new DateTimeImmutable((string) $v['date']) : null,
        ));

        return $this->application($application, 201);
    }

    private function application(CreditApplication $application, int $status): JsonResponse
    {
        $application->setAttribute('currency', Invoice::query()->whereKey($application->invoice_id)->value('currency'));

        return (new CreditApplicationResource($application))->response()->setStatusCode($status);
    }

    private function ref(Settlement $settlement, ?int $version): DocumentRef
    {
        return new DocumentRef('settlement', $settlement->id, $version);
    }

    private function fresh(string $id): Settlement
    {
        return Settlement::query()->with('allocations')->findOrFail($id);
    }
}
