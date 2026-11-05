<?php

declare(strict_types=1);

namespace App\Http\Controllers\FixedAssets;

use App\Actions\FixedAssets\CreateAssetTransaction;
use App\Actions\FixedAssets\Inputs\ReverseAssetDocumentInput;
use App\Actions\FixedAssets\ReverseAssetTransaction;
use App\Actions\Workflow\ApproveDocument;
use App\Actions\Workflow\Inputs\DocumentRef;
use App\Actions\Workflow\Inputs\ReturnDocumentInput;
use App\Actions\Workflow\Inputs\VoidDocumentInput;
use App\Actions\Workflow\ReturnDocument;
use App\Actions\Workflow\SubmitDocument;
use App\Actions\Workflow\VoidDocument;
use App\Http\Controllers\Controller;
use App\Http\Requests\FixedAssets\AssetTransactionRequest;
use App\Http\Requests\Ledger\ReturnJournalRequest;
use App\Http\Requests\Ledger\ReverseJournalRequest;
use App\Http\Requests\Ledger\VoidJournalRequest;
use App\Http\Requests\TransitionRequest;
use App\Http\Resources\AssetTransactionPreviewResource;
use App\Http\Resources\AssetTransactionResource;
use App\Http\Support\CursorPage;
use App\Http\Support\RequestActor;
use App\Models\FixedAssets\AssetTransaction;
use App\Models\Organisation\Company;
use App\Queries\FixedAssets\PreviewAssetTransaction;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Routing\Attributes\Controllers\Authorize;

/**
 * Disposals, impairments, impairment reversals and category revaluations: preview, draft, then submit and approve (signed, maker ≠
 * checker, through the workflow) and one journal posts. Reversing undoes the journal and the register.
 */
final class AssetTransactionController extends Controller
{
    #[Authorize('viewAny', AssetTransaction::class)]
    public function index(Request $request, Company $company): AnonymousResourceCollection
    {
        $query = AssetTransaction::query()->where('company_id', $company->id);
        foreach (['kind', 'status'] as $filter) {
            if ($request->filled($filter)) {
                $query->where($filter, (string) $request->query($filter));
            }
        }
        $page = CursorPage::fetch($query->with('lines.asset'), $request, 'tx_date', descending: true, kind: 'date');

        return AssetTransactionResource::collection($page->items)->additional(['meta' => ['next_cursor' => $page->nextCursor, 'prev_cursor' => $page->prevCursor, 'limit' => $page->limit]]);
    }

    /** What the document would do, per asset, with its journal lines; writes nothing. */
    #[Authorize('create', AssetTransaction::class)]
    public function preview(AssetTransactionRequest $request, Company $company, PreviewAssetTransaction $preview): AssetTransactionPreviewResource
    {
        return new AssetTransactionPreviewResource($preview($request->toInput()));
    }

    #[Authorize('view', 'assetTransaction')]
    public function show(Company $company, AssetTransaction $assetTransaction): AssetTransactionResource
    {
        return new AssetTransactionResource($this->fresh($assetTransaction->id));
    }

    #[Authorize('create', AssetTransaction::class)]
    public function store(AssetTransactionRequest $request, Company $company, CreateAssetTransaction $action): JsonResponse
    {
        $tx = $action->handle(RequestActor::from($request, $company->id), $request->toInput());

        return (new AssetTransactionResource($this->fresh($tx->id)))->response()->setStatusCode(201);
    }

    #[Authorize('submit', 'assetTransaction')]
    public function submit(TransitionRequest $request, Company $company, AssetTransaction $assetTransaction, SubmitDocument $action): AssetTransactionResource
    {
        $action->handle(RequestActor::from($request, $company->id), $this->ref($assetTransaction, $request->version()));

        return new AssetTransactionResource($this->fresh($assetTransaction->id));
    }

    #[Authorize('approve', 'assetTransaction')]
    public function approve(TransitionRequest $request, Company $company, AssetTransaction $assetTransaction, ApproveDocument $action): AssetTransactionResource
    {
        $action->handle(RequestActor::from($request, $company->id), $this->ref($assetTransaction, $request->version()), $request->comment());

        return new AssetTransactionResource($this->fresh($assetTransaction->id));
    }

    #[Authorize('return', 'assetTransaction')]
    public function return(ReturnJournalRequest $request, Company $company, AssetTransaction $assetTransaction, ReturnDocument $action): AssetTransactionResource
    {
        $action->handle(RequestActor::from($request, $company->id), new ReturnDocumentInput($this->ref($assetTransaction, $request->version()), $request->comment()));

        return new AssetTransactionResource($this->fresh($assetTransaction->id));
    }

    #[Authorize('void', 'assetTransaction')]
    public function void(VoidJournalRequest $request, Company $company, AssetTransaction $assetTransaction, VoidDocument $action): AssetTransactionResource
    {
        $action->handle(RequestActor::from($request, $company->id), new VoidDocumentInput($this->ref($assetTransaction, $request->version()), $request->reason()));

        return new AssetTransactionResource($this->fresh($assetTransaction->id));
    }

    /** Mirrors the journal and puts the register back (a disposed asset is active again); refused while later activity stands on the same assets. */
    #[Authorize('reverse', 'assetTransaction')]
    public function reverse(ReverseJournalRequest $request, Company $company, AssetTransaction $assetTransaction, ReverseAssetTransaction $action): AssetTransactionResource
    {
        $in = $request->toInput($assetTransaction->id);
        $action->handle(RequestActor::from($request, $company->id), new ReverseAssetDocumentInput($assetTransaction->id, $in->date, $in->lockVersion, $in->memo));

        return new AssetTransactionResource($this->fresh($assetTransaction->id));
    }

    private function ref(AssetTransaction $tx, ?int $version): DocumentRef
    {
        return new DocumentRef('asset_transaction', $tx->id, $version);
    }

    private function fresh(string $id): AssetTransaction
    {
        return AssetTransaction::query()->with('lines.asset')->findOrFail($id);
    }
}
