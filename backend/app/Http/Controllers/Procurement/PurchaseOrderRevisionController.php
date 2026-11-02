<?php

declare(strict_types=1);

namespace App\Http\Controllers\Procurement;

use App\Actions\Procurement\UpdateOrderRevision;
use App\Actions\Workflow\ApproveDocument;
use App\Actions\Workflow\ReturnDocument;
use App\Actions\Workflow\SubmitDocument;
use App\Actions\Workflow\VoidDocument;
use App\Http\Controllers\Controller;
use App\Http\Requests\Ledger\ReturnJournalRequest;
use App\Http\Requests\Ledger\VoidJournalRequest;
use App\Http\Requests\Procurement\RevisionRequest;
use App\Http\Requests\TransitionRequest;
use App\Http\Resources\PurchaseOrderRevisionResource;
use App\Http\Support\RequestActor;
use App\Models\Organisation\Company;
use App\Models\Procurement\PurchaseOrderRevision;
use Illuminate\Routing\Attributes\Controllers\Authorize;

/**
 * Revisions of approved orders. A revision follows the `purchase_order` workflow on its new total; when the last approval is
 * given it is applied to the order. Rights are the order's (`purchase_orders.*`).
 */
final class PurchaseOrderRevisionController extends Controller
{
    use RunsDocumentTransitions;

    private const string TYPE = 'purchase_order_revision';

    #[Authorize('view', 'purchaseOrderRevision')]
    public function show(Company $company, PurchaseOrderRevision $purchaseOrderRevision): PurchaseOrderRevisionResource
    {
        return $this->fresh($purchaseOrderRevision->id);
    }

    #[Authorize('update', 'purchaseOrderRevision')]
    public function update(RevisionRequest $request, Company $company, PurchaseOrderRevision $purchaseOrderRevision, UpdateOrderRevision $action): PurchaseOrderRevisionResource
    {
        $action->handle(RequestActor::from($request, $company->id), $purchaseOrderRevision->id, (int) $request->version(), $request->toInput());

        return $this->fresh($purchaseOrderRevision->id);
    }

    #[Authorize('submit', 'purchaseOrderRevision')]
    public function submit(TransitionRequest $request, Company $company, PurchaseOrderRevision $purchaseOrderRevision, SubmitDocument $action): PurchaseOrderRevisionResource
    {
        $this->submitDocument($request, $company, self::TYPE, $purchaseOrderRevision->id, $action);

        return $this->fresh($purchaseOrderRevision->id);
    }

    #[Authorize('approve', 'purchaseOrderRevision')]
    public function approve(TransitionRequest $request, Company $company, PurchaseOrderRevision $purchaseOrderRevision, ApproveDocument $action): PurchaseOrderRevisionResource
    {
        $this->approveDocument($request, $company, self::TYPE, $purchaseOrderRevision->id, $action);

        return $this->fresh($purchaseOrderRevision->id);
    }

    #[Authorize('return', 'purchaseOrderRevision')]
    public function return(ReturnJournalRequest $request, Company $company, PurchaseOrderRevision $purchaseOrderRevision, ReturnDocument $action): PurchaseOrderRevisionResource
    {
        $this->returnDocument($request, $company, self::TYPE, $purchaseOrderRevision->id, $action);

        return $this->fresh($purchaseOrderRevision->id);
    }

    #[Authorize('void', 'purchaseOrderRevision')]
    public function void(VoidJournalRequest $request, Company $company, PurchaseOrderRevision $purchaseOrderRevision, VoidDocument $action): PurchaseOrderRevisionResource
    {
        $this->voidDocument($request, $company, self::TYPE, $purchaseOrderRevision->id, $action);

        return $this->fresh($purchaseOrderRevision->id);
    }

    private function fresh(string $id): PurchaseOrderRevisionResource
    {
        return new PurchaseOrderRevisionResource(PurchaseOrderRevision::query()->findOrFail($id));
    }
}
