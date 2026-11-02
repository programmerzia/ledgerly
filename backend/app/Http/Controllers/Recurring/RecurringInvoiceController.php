<?php

declare(strict_types=1);

namespace App\Http\Controllers\Recurring;

use App\Actions\Recurring\ManageRecurringSchedule;
use App\Http\Controllers\Controller;
use App\Http\Requests\Recurring\RecurringInvoiceRequest;
use App\Http\Requests\VersionRequest;
use App\Http\Resources\RecurringScheduleResource;
use App\Http\Support\CursorPage;
use App\Http\Support\RequestActor;
use App\Models\Organisation\Company;
use App\Models\Recurring\RecurringInvoice;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Routing\Attributes\Controllers\Authorize;

/** Recurring invoices and bills (doc 14 E2): templates, dates and owner. Running them is `RecurringRunController`. */
final class RecurringInvoiceController extends Controller
{
    #[Authorize('viewAny', RecurringInvoice::class)]
    public function index(Request $request, Company $company): AnonymousResourceCollection
    {
        $page = CursorPage::fetch(RecurringInvoice::query()->where('company_id', $company->id), $request, 'id', kind: 'uuid');

        return RecurringScheduleResource::collection($page->items)->additional(['meta' => ['next_cursor' => $page->nextCursor, 'prev_cursor' => $page->prevCursor, 'limit' => $page->limit]]);
    }

    #[Authorize('view', 'recurringInvoice')]
    public function show(Company $company, RecurringInvoice $recurringInvoice): RecurringScheduleResource
    {
        return new RecurringScheduleResource($recurringInvoice);
    }

    #[Authorize('create', RecurringInvoice::class)]
    public function store(RecurringInvoiceRequest $request, Company $company, ManageRecurringSchedule $action): JsonResponse
    {
        $schedule = $action->create(RequestActor::from($request, $company->id), ManageRecurringSchedule::INVOICE, $request->toInput());

        return (new RecurringScheduleResource($schedule))->response()->setStatusCode(201);
    }

    #[Authorize('update', 'recurringInvoice')]
    public function update(RecurringInvoiceRequest $request, Company $company, RecurringInvoice $recurringInvoice, ManageRecurringSchedule $action): RecurringScheduleResource
    {
        return new RecurringScheduleResource($action->update(RequestActor::from($request, $company->id), ManageRecurringSchedule::INVOICE, $recurringInvoice->id, $request->version(), $request->toInput()));
    }

    #[Authorize('pause', 'recurringInvoice')]
    public function pause(VersionRequest $request, Company $company, RecurringInvoice $recurringInvoice, ManageRecurringSchedule $action): RecurringScheduleResource
    {
        return new RecurringScheduleResource($action->setActive(RequestActor::from($request, $company->id), ManageRecurringSchedule::INVOICE, $recurringInvoice->id, $request->version(), false));
    }

    #[Authorize('resume', 'recurringInvoice')]
    public function resume(VersionRequest $request, Company $company, RecurringInvoice $recurringInvoice, ManageRecurringSchedule $action): RecurringScheduleResource
    {
        return new RecurringScheduleResource($action->setActive(RequestActor::from($request, $company->id), ManageRecurringSchedule::INVOICE, $recurringInvoice->id, $request->version(), true));
    }
}
