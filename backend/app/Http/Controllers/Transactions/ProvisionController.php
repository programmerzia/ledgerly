<?php

declare(strict_types=1);

namespace App\Http\Controllers\Transactions;

use App\Actions\Transactions\ManageProvisioning;
use App\Actions\Transactions\ReverseProvisionRun;
use App\Actions\Workflow\ApproveDocument;
use App\Actions\Workflow\Inputs\DocumentRef;
use App\Actions\Workflow\Inputs\ReturnDocumentInput;
use App\Actions\Workflow\Inputs\VoidDocumentInput;
use App\Actions\Workflow\ReturnDocument;
use App\Actions\Workflow\SubmitDocument;
use App\Actions\Workflow\VoidDocument;
use App\Domain\Transactions\ProvisionMatrix;
use App\Http\Controllers\Controller;
use App\Http\Requests\Ledger\ReturnJournalRequest;
use App\Http\Requests\Ledger\ReverseJournalRequest;
use App\Http\Requests\Ledger\VoidJournalRequest;
use App\Http\Requests\Trade\ListPaymentRunsRequest;
use App\Http\Requests\Transactions\ProvisionRatesRequest;
use App\Http\Requests\Transactions\ProvisionRunRequest;
use App\Http\Requests\TransitionRequest;
use App\Http\Resources\ProvisionPreviewResource;
use App\Http\Resources\ProvisionRunResource;
use App\Http\Support\CursorPage;
use App\Http\Support\RequestActor;
use App\Models\Organisation\Company;
use App\Models\Transactions\ProvisionRun;
use App\Queries\Transactions\ProvisionPreview;
use App\Services\Transactions\ProvisionService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Routing\Attributes\Controllers\Authorize;
use Illuminate\Support\Facades\DB;

/**
 * Bad-debt provisioning (`provisions.*`): rates per aging bucket, a read-only preview for an as-of date, and approved runs that post only
 * the difference between the allowance required and the allowance held. Tokens read only.
 */
final class ProvisionController extends Controller
{
    #[Authorize('viewAny', ProvisionRun::class)]
    public function rates(Company $company, ProvisionService $service): JsonResponse
    {
        $stored = DB::table('provision_rates')->where('company_id', $company->id)->pluck('rate_pct', 'bucket')->map(fn ($v): string => (string) $v)->all();

        return new JsonResponse(['data' => [
            'buckets' => array_map(fn (string $b): array => ['bucket' => $b, 'label' => ProvisionMatrix::LABELS[$b], 'rate_pct' => $stored[$b] ?? null], ProvisionMatrix::BUCKETS),
            'configured' => count($stored) === count(ProvisionMatrix::BUCKETS),
        ]]);
    }

    #[Authorize('manageRates', ProvisionRun::class)]
    public function saveRates(ProvisionRatesRequest $request, Company $company, ManageProvisioning $action): JsonResponse
    {
        $saved = $action->saveRates(RequestActor::from($request, $company->id), $company->id, $request->rates());

        return new JsonResponse(['data' => [
            'buckets' => array_map(fn (string $b): array => ['bucket' => $b, 'label' => ProvisionMatrix::LABELS[$b], 'rate_pct' => $saved[$b]], ProvisionMatrix::BUCKETS),
            'configured' => true,
        ]]);
    }

    /** What a run for this date would be, without saving anything: receivables by bucket, the rates, the allowance held and the difference. */
    #[Authorize('viewAny', ProvisionRun::class)]
    public function preview(ProvisionRunRequest $request, Company $company, ProvisionService $service): ProvisionPreviewResource
    {
        $n = $service->compute($company, $request->asOf());

        return new ProvisionPreviewResource(new ProvisionPreview($request->asOf()->format('Y-m-d'), $n['detail']['rows'], $n['required'], $n['existing'], $n['difference']));
    }

    #[Authorize('viewAny', ProvisionRun::class)]
    public function index(ListPaymentRunsRequest $request, Company $company): AnonymousResourceCollection
    {
        $query = ProvisionRun::query()->where('company_id', $company->id);
        if ($request->filled('status')) {
            $query->where('status', (string) $request->query('status'));
        }
        $page = CursorPage::fetch($query, $request, 'as_of', descending: true, kind: 'date');

        return ProvisionRunResource::collection($page->items)->additional(['meta' => ['next_cursor' => $page->nextCursor, 'prev_cursor' => $page->prevCursor, 'limit' => $page->limit]]);
    }

    #[Authorize('view', 'provisionRun')]
    public function show(Company $company, ProvisionRun $provisionRun): ProvisionRunResource
    {
        return new ProvisionRunResource($provisionRun);
    }

    #[Authorize('create', ProvisionRun::class)]
    public function store(ProvisionRunRequest $request, Company $company, ManageProvisioning $action): JsonResponse
    {
        $run = $action->createRun(RequestActor::from($request, $company->id), $company->id, $request->asOf(), $request->memo());

        return (new ProvisionRunResource($run))->response()->setStatusCode(201);
    }

    #[Authorize('submit', 'provisionRun')]
    public function submit(TransitionRequest $request, Company $company, ProvisionRun $provisionRun, SubmitDocument $action): ProvisionRunResource
    {
        $action->handle(RequestActor::from($request, $company->id), $this->ref($provisionRun, $request->version()));

        return new ProvisionRunResource($this->fresh($provisionRun->id));
    }

    #[Authorize('approve', 'provisionRun')]
    public function approve(TransitionRequest $request, Company $company, ProvisionRun $provisionRun, ApproveDocument $action): ProvisionRunResource
    {
        $action->handle(RequestActor::from($request, $company->id), $this->ref($provisionRun, $request->version()), $request->comment());

        return new ProvisionRunResource($this->fresh($provisionRun->id));
    }

    #[Authorize('return', 'provisionRun')]
    public function return(ReturnJournalRequest $request, Company $company, ProvisionRun $provisionRun, ReturnDocument $action): ProvisionRunResource
    {
        $action->handle(RequestActor::from($request, $company->id), new ReturnDocumentInput($this->ref($provisionRun, $request->version()), $request->comment()));

        return new ProvisionRunResource($this->fresh($provisionRun->id));
    }

    #[Authorize('void', 'provisionRun')]
    public function void(VoidJournalRequest $request, Company $company, ProvisionRun $provisionRun, VoidDocument $action): ProvisionRunResource
    {
        $action->handle(RequestActor::from($request, $company->id), new VoidDocumentInput($this->ref($provisionRun, $request->version()), $request->reason()));

        return new ProvisionRunResource($this->fresh($provisionRun->id));
    }

    #[Authorize('reverse', 'provisionRun')]
    public function reverse(ReverseJournalRequest $request, Company $company, ProvisionRun $provisionRun, ReverseProvisionRun $action): ProvisionRunResource
    {
        $in = $request->toInput($provisionRun->id);
        $action->handle(RequestActor::from($request, $company->id), $provisionRun->id, $in->date, $in->lockVersion, $in->memo);

        return new ProvisionRunResource($this->fresh($provisionRun->id));
    }

    private function ref(ProvisionRun $run, ?int $version): DocumentRef
    {
        return new DocumentRef('provision_run', $run->id, $version);
    }

    private function fresh(string $id): ProvisionRun
    {
        return ProvisionRun::query()->findOrFail($id);
    }
}
