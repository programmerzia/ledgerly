<?php

declare(strict_types=1);

namespace App\Http\Controllers\Ledger;

use App\Actions\Ledger\CreateJournalDraft;
use App\Actions\Ledger\ReverseJournal;
use App\Actions\Ledger\UpdateJournalDraft;
use App\Actions\Workflow\ApproveDocument;
use App\Actions\Workflow\Inputs\DocumentRef;
use App\Actions\Workflow\Inputs\ReturnDocumentInput;
use App\Actions\Workflow\Inputs\VoidDocumentInput;
use App\Actions\Workflow\ReturnDocument;
use App\Actions\Workflow\SubmitDocument;
use App\Actions\Workflow\VoidDocument;
use App\Http\Controllers\Controller;
use App\Http\Requests\Ledger\JournalRequest;
use App\Http\Requests\Ledger\ListJournalsRequest;
use App\Http\Requests\Ledger\ReturnJournalRequest;
use App\Http\Requests\Ledger\ReverseJournalRequest;
use App\Http\Requests\Ledger\VoidJournalRequest;
use App\Http\Requests\TransitionRequest;
use App\Http\Resources\JournalResource;
use App\Http\Resources\PostingPreviewResource;
use App\Http\Support\CursorPage;
use App\Http\Support\RequestActor;
use App\Models\Ledger\Journal;
use App\Models\Organisation\Company;
use App\Queries\Ledger\ListJournals;
use App\Queries\Ledger\PreviewJournalPosting;
use App\Queries\Ledger\ShowJournal;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Routing\Attributes\Controllers\Authorize;

/** Journals and their document transitions (13 §10, §16). The Actions enforce the rules; the policies drive `can`. */
final class JournalController extends Controller
{
    #[Authorize('viewAny', Journal::class)]
    public function index(ListJournalsRequest $request, Company $company, ListJournals $journals): AnonymousResourceCollection
    {
        $page = CursorPage::fetch($journals($company->id, $request->filter()), $request, 'journal_date', descending: true, kind: 'date');

        return JournalResource::collection($page->items)->additional(['meta' => ['next_cursor' => $page->nextCursor, 'prev_cursor' => $page->prevCursor, 'limit' => $page->limit]]);
    }

    #[Authorize('view', 'journal')]
    public function show(Company $company, Journal $journal, ShowJournal $show): JournalResource
    {
        return new JournalResource($show($journal->id));
    }

    #[Authorize('create', Journal::class)]
    public function store(JournalRequest $request, Company $company, CreateJournalDraft $action, ShowJournal $show): JsonResponse
    {
        $journal = $action->handle(RequestActor::from($request, $company->id), $request->toInput());

        return (new JournalResource($show($journal->id)))->response()->setStatusCode(201);
    }

    #[Authorize('update', 'journal')]
    public function update(JournalRequest $request, Company $company, Journal $journal, UpdateJournalDraft $action, ShowJournal $show): JournalResource
    {
        $action->handle(RequestActor::from($request, $company->id), $request->toUpdate($journal->id));

        return new JournalResource($show($journal->id));
    }

    /** What posting this draft would do, or why it cannot. Writes nothing. */
    #[Authorize('view', 'journal')]
    public function preview(Request $request, Company $company, Journal $journal, PreviewJournalPosting $preview): PostingPreviewResource
    {
        return new PostingPreviewResource($preview->of(RequestActor::from($request, $company->id), $journal->id));
    }

    /** Posts at once when no workflow applies (a person needs a signing grant), else waits for approval. */
    #[Authorize('submit', 'journal')]
    public function submit(TransitionRequest $request, Company $company, Journal $journal, SubmitDocument $action, ShowJournal $show): JournalResource
    {
        $action->handle(RequestActor::from($request, $company->id), new DocumentRef('journal', $journal->id, $request->version()));

        return new JournalResource($show($journal->id));
    }

    /** One signature of the current step; the last one posts the journal. People only, with a signing grant. */
    #[Authorize('approve', 'journal')]
    public function approve(TransitionRequest $request, Company $company, Journal $journal, ApproveDocument $action, ShowJournal $show): JournalResource
    {
        $action->handle(RequestActor::from($request, $company->id), new DocumentRef('journal', $journal->id, $request->version()), $request->comment());

        return new JournalResource($show($journal->id));
    }

    #[Authorize('return', 'journal')]
    public function return(ReturnJournalRequest $request, Company $company, Journal $journal, ReturnDocument $action, ShowJournal $show): JournalResource
    {
        $action->handle(RequestActor::from($request, $company->id), new ReturnDocumentInput(new DocumentRef('journal', $journal->id, $request->version()), $request->comment()));

        return new JournalResource($show($journal->id));
    }

    #[Authorize('void', 'journal')]
    public function void(VoidJournalRequest $request, Company $company, Journal $journal, VoidDocument $action, ShowJournal $show): JournalResource
    {
        $action->handle(RequestActor::from($request, $company->id), new VoidDocumentInput(new DocumentRef('journal', $journal->id, $request->version()), $request->reason()));

        return new JournalResource($show($journal->id));
    }

    /** Posts the mirror journal and answers it (201); the original becomes `reversed`. */
    #[Authorize('reverse', 'journal')]
    public function reverse(ReverseJournalRequest $request, Company $company, Journal $journal, ReverseJournal $action, ShowJournal $show): JsonResponse
    {
        $reversal = $action->handle(RequestActor::from($request, $company->id), $request->toInput($journal->id));

        return (new JournalResource($show($reversal->id)))->response()->setStatusCode(201);
    }
}
