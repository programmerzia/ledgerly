<?php

declare(strict_types=1);

namespace App\Http\Controllers\Transactions;

use App\Actions\Transactions\ReverseWriteOff;
use App\Actions\Transactions\SaveWriteOffDraft;
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
use App\Http\Requests\Transactions\WriteOffRequest;
use App\Http\Requests\TransitionRequest;
use App\Http\Resources\InvoicePostingPreviewResource;
use App\Http\Resources\WriteOffResource;
use App\Http\Support\CursorPage;
use App\Http\Support\RequestActor;
use App\Models\Organisation\Company;
use App\Models\Transactions\WriteOff;
use App\Queries\Transactions\PreviewWriteOffPosting;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Routing\Attributes\Controllers\Authorize;

/** Write-offs (`write_offs.*`): approved documents against one posted invoice; reversing one gives the invoice its open amount back. Tokens read only. */
final class WriteOffController extends Controller
{
    #[Authorize('viewAny', WriteOff::class)]
    public function index(ListPaymentRunsRequest $request, Company $company): AnonymousResourceCollection
    {
        $query = WriteOff::query()->where('company_id', $company->id);
        if ($request->filled('status')) {
            $query->where('status', (string) $request->query('status'));
        }
        $page = CursorPage::fetch($query, $request, 'write_off_date', descending: true, kind: 'date');

        return WriteOffResource::collection($page->items)->additional(['meta' => ['next_cursor' => $page->nextCursor, 'prev_cursor' => $page->prevCursor, 'limit' => $page->limit]]);
    }

    #[Authorize('view', 'writeOff')]
    public function show(Company $company, WriteOff $writeOff): WriteOffResource
    {
        return new WriteOffResource($writeOff);
    }

    #[Authorize('create', WriteOff::class)]
    public function store(WriteOffRequest $request, Company $company, SaveWriteOffDraft $action): JsonResponse
    {
        return (new WriteOffResource($action->handle(RequestActor::from($request, $company->id), $request->toInput())))->response()->setStatusCode(201);
    }

    #[Authorize('update', 'writeOff')]
    public function update(WriteOffRequest $request, Company $company, WriteOff $writeOff, SaveWriteOffDraft $action): WriteOffResource
    {
        return new WriteOffResource($action->handle(RequestActor::from($request, $company->id), $request->toInput(), $writeOff->id, $request->version()));
    }

    #[Authorize('view', 'writeOff')]
    public function preview(Request $request, Company $company, WriteOff $writeOff, PreviewWriteOffPosting $preview): InvoicePostingPreviewResource
    {
        return new InvoicePostingPreviewResource($preview->of(RequestActor::from($request, $company->id), $writeOff->id));
    }

    #[Authorize('submit', 'writeOff')]
    public function submit(TransitionRequest $request, Company $company, WriteOff $writeOff, SubmitDocument $action): WriteOffResource
    {
        $action->handle(RequestActor::from($request, $company->id), $this->ref($writeOff, $request->version()));

        return new WriteOffResource($this->fresh($writeOff->id));
    }

    #[Authorize('approve', 'writeOff')]
    public function approve(TransitionRequest $request, Company $company, WriteOff $writeOff, ApproveDocument $action): WriteOffResource
    {
        $action->handle(RequestActor::from($request, $company->id), $this->ref($writeOff, $request->version()), $request->comment());

        return new WriteOffResource($this->fresh($writeOff->id));
    }

    #[Authorize('return', 'writeOff')]
    public function return(ReturnJournalRequest $request, Company $company, WriteOff $writeOff, ReturnDocument $action): WriteOffResource
    {
        $action->handle(RequestActor::from($request, $company->id), new ReturnDocumentInput($this->ref($writeOff, $request->version()), $request->comment()));

        return new WriteOffResource($this->fresh($writeOff->id));
    }

    #[Authorize('void', 'writeOff')]
    public function void(VoidJournalRequest $request, Company $company, WriteOff $writeOff, VoidDocument $action): WriteOffResource
    {
        $action->handle(RequestActor::from($request, $company->id), new VoidDocumentInput($this->ref($writeOff, $request->version()), $request->reason()));

        return new WriteOffResource($this->fresh($writeOff->id));
    }

    #[Authorize('reverse', 'writeOff')]
    public function reverse(ReverseJournalRequest $request, Company $company, WriteOff $writeOff, ReverseWriteOff $action): WriteOffResource
    {
        $in = $request->toInput($writeOff->id);
        $action->handle(RequestActor::from($request, $company->id), $writeOff->id, $in->date, $in->lockVersion, $in->memo);

        return new WriteOffResource($this->fresh($writeOff->id));
    }

    private function ref(WriteOff $w, ?int $version): DocumentRef
    {
        return new DocumentRef('write_off', $w->id, $version);
    }

    private function fresh(string $id): WriteOff
    {
        return WriteOff::query()->findOrFail($id);
    }
}
