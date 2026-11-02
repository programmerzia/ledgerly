<?php

declare(strict_types=1);

namespace App\Http\Controllers\Procurement;

use App\Contracts\Clock;
use App\Http\Controllers\Controller;
use App\Http\Requests\Procurement\ProcurementReportRequest;
use App\Http\Resources\AwaitingReceiptResource;
use App\Http\Resources\OpenCommitmentsResource;
use App\Http\Resources\ReceivedNotBilledResource;
use App\Models\Organisation\Company;
use App\Models\Procurement\PurchaseOrder;
use App\Queries\Procurement\OpenCommitments;
use App\Queries\Procurement\OrdersAwaitingReceipt;
use App\Queries\Procurement\ReceivedNotBilled;
use Illuminate\Routing\Attributes\Controllers\Authorize;

/** The three procurement reports (D14): reporting only, nothing is posted. Rights are `purchase_orders.view`. */
final class ProcurementReportController extends Controller
{
    /** Ordered and not yet billed, by supplier and account, net of tax. */
    #[Authorize('viewAny', PurchaseOrder::class)]
    public function openCommitments(ProcurementReportRequest $request, Company $company, OpenCommitments $report): OpenCommitmentsResource
    {
        return new OpenCommitmentsResource($report($company->id, $request->contactId()));
    }

    /** Order lines with goods still to come. */
    #[Authorize('viewAny', PurchaseOrder::class)]
    public function awaitingReceipt(ProcurementReportRequest $request, Company $company, OrdersAwaitingReceipt $report): AwaitingReceiptResource
    {
        return new AwaitingReceiptResource($report($company->id, $request->contactId()));
    }

    /** What the ledger did not know on `as_of` (default today): received, not on a posted bill. */
    #[Authorize('viewAny', PurchaseOrder::class)]
    public function receivedNotBilled(ProcurementReportRequest $request, Company $company, ReceivedNotBilled $report, Clock $clock): ReceivedNotBilledResource
    {
        return new ReceivedNotBilledResource($report($company->id, $request->asOf($clock), $request->contactId()));
    }
}
