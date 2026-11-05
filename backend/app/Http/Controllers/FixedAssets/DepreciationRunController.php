<?php

declare(strict_types=1);

namespace App\Http\Controllers\FixedAssets;

use App\Actions\FixedAssets\CreateDepreciationRun;
use App\Actions\FixedAssets\Inputs\ReverseAssetDocumentInput;
use App\Actions\FixedAssets\ReverseDepreciationRun;
use App\Actions\Workflow\ApproveDocument;
use App\Actions\Workflow\Inputs\DocumentRef;
use App\Actions\Workflow\Inputs\ReturnDocumentInput;
use App\Actions\Workflow\Inputs\VoidDocumentInput;
use App\Actions\Workflow\ReturnDocument;
use App\Actions\Workflow\SubmitDocument;
use App\Actions\Workflow\VoidDocument;
use App\Http\Controllers\Controller;
use App\Http\Requests\FixedAssets\DepreciationRunRequest;
use App\Http\Requests\Ledger\ReturnJournalRequest;
use App\Http\Requests\Ledger\ReverseJournalRequest;
use App\Http\Requests\Ledger\VoidJournalRequest;
use App\Http\Requests\TransitionRequest;
use App\Http\Resources\DepreciationPreviewResource;
use App\Http\Resources\DepreciationRunResource;
use App\Http\Support\CursorPage;
use App\Http\Support\RequestActor;
use App\Models\FixedAssets\DepreciationRun;
use App\Models\Organisation\Company;
use App\Queries\FixedAssets\PreviewDepreciation;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Routing\Attributes\Controllers\Authorize;

/**
 * Depreciation runs (`fixed_assets.*`): preview a period, draft the run, then submit and approve it (signed, maker ≠ checker,
 * through the workflow) and it posts one journal. Reversing undoes it and frees the period for another run.
 */
final class DepreciationRunController extends Controller
{
    #[Authorize('viewAny', DepreciationRun::class)]
    public function index(Request $request, Company $company): AnonymousResourceCollection
    {
        $query = DepreciationRun::query()->where('company_id', $company->id);
        if ($request->filled('status')) {
            $query->where('status', (string) $request->query('status'));
        }
        $page = CursorPage::fetch($query, $request, 'as_of', descending: true, kind: 'date');

        return DepreciationRunResource::collection($page->items)->additional(['meta' => ['next_cursor' => $page->nextCursor, 'prev_cursor' => $page->prevCursor, 'limit' => $page->limit]]);
    }

    /** Per asset, what a run for the period would charge, including skipped months; writes nothing. */
    #[Authorize('viewAny', DepreciationRun::class)]
    public function preview(DepreciationRunRequest $request, Company $company, PreviewDepreciation $preview): DepreciationPreviewResource
    {
        return new DepreciationPreviewResource($preview($company->id, $request->periodId(), $request->units()));
    }

    #[Authorize('view', 'depreciationRun')]
    public function show(Company $company, DepreciationRun $depreciationRun): DepreciationRunResource
    {
        return new DepreciationRunResource($this->fresh($depreciationRun->id));
    }

    #[Authorize('create', DepreciationRun::class)]
    public function store(DepreciationRunRequest $request, Company $company, CreateDepreciationRun $action): JsonResponse
    {
        $run = $action->handle(RequestActor::from($request, $company->id), $request->toInput());

        return (new DepreciationRunResource($this->fresh($run->id)))->response()->setStatusCode(201);
    }

    #[Authorize('submit', 'depreciationRun')]
    public function submit(TransitionRequest $request, Company $company, DepreciationRun $depreciationRun, SubmitDocument $action): DepreciationRunResource
    {
        $action->handle(RequestActor::from($request, $company->id), $this->ref($depreciationRun, $request->version()));

        return new DepreciationRunResource($this->fresh($depreciationRun->id));
    }

    #[Authorize('approve', 'depreciationRun')]
    public function approve(TransitionRequest $request, Company $company, DepreciationRun $depreciationRun, ApproveDocument $action): DepreciationRunResource
    {
        $action->handle(RequestActor::from($request, $company->id), $this->ref($depreciationRun, $request->version()), $request->comment());

        return new DepreciationRunResource($this->fresh($depreciationRun->id));
    }

    #[Authorize('return', 'depreciationRun')]
    public function return(ReturnJournalRequest $request, Company $company, DepreciationRun $depreciationRun, ReturnDocument $action): DepreciationRunResource
    {
        $action->handle(RequestActor::from($request, $company->id), new ReturnDocumentInput($this->ref($depreciationRun, $request->version()), $request->comment()));

        return new DepreciationRunResource($this->fresh($depreciationRun->id));
    }

    #[Authorize('void', 'depreciationRun')]
    public function void(VoidJournalRequest $request, Company $company, DepreciationRun $depreciationRun, VoidDocument $action): DepreciationRunResource
    {
        $action->handle(RequestActor::from($request, $company->id), new VoidDocumentInput($this->ref($depreciationRun, $request->version()), $request->reason()));

        return new DepreciationRunResource($this->fresh($depreciationRun->id));
    }

    /** Mirrors the journal and takes each asset's charge back out of the register; refused while later activity stands on the same assets. */
    #[Authorize('reverse', 'depreciationRun')]
    public function reverse(ReverseJournalRequest $request, Company $company, DepreciationRun $depreciationRun, ReverseDepreciationRun $action): DepreciationRunResource
    {
        $in = $request->toInput($depreciationRun->id);
        $action->handle(RequestActor::from($request, $company->id), new ReverseAssetDocumentInput($depreciationRun->id, $in->date, $in->lockVersion, $in->memo));

        return new DepreciationRunResource($this->fresh($depreciationRun->id));
    }

    private function ref(DepreciationRun $run, ?int $version): DocumentRef
    {
        return new DocumentRef('depreciation_run', $run->id, $version);
    }

    private function fresh(string $id): DepreciationRun
    {
        return DepreciationRun::query()->with('lines.asset')->findOrFail($id);
    }
}
