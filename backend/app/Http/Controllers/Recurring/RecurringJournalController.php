<?php

declare(strict_types=1);

namespace App\Http\Controllers\Recurring;

use App\Actions\Recurring\ManageRecurringSchedule;
use App\Http\Controllers\Controller;
use App\Http\Requests\Recurring\RecurringJournalRequest;
use App\Http\Requests\VersionRequest;
use App\Http\Resources\RecurringScheduleResource;
use App\Http\Support\CursorPage;
use App\Http\Support\RequestActor;
use App\Models\Organisation\Company;
use App\Models\Recurring\RecurringJournal;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Routing\Attributes\Controllers\Authorize;

/** Recurring journals (doc 14 E2): templates, dates and owner. Running them is `RecurringRunController`. */
final class RecurringJournalController extends Controller
{
    #[Authorize('viewAny', RecurringJournal::class)]
    public function index(Request $request, Company $company): AnonymousResourceCollection
    {
        $page = CursorPage::fetch(RecurringJournal::query()->where('company_id', $company->id), $request, 'id', kind: 'uuid');

        return RecurringScheduleResource::collection($page->items)->additional(['meta' => ['next_cursor' => $page->nextCursor, 'prev_cursor' => $page->prevCursor, 'limit' => $page->limit]]);
    }

    #[Authorize('view', 'recurringJournal')]
    public function show(Company $company, RecurringJournal $recurringJournal): RecurringScheduleResource
    {
        return new RecurringScheduleResource($recurringJournal);
    }

    #[Authorize('create', RecurringJournal::class)]
    public function store(RecurringJournalRequest $request, Company $company, ManageRecurringSchedule $action): JsonResponse
    {
        $schedule = $action->create(RequestActor::from($request, $company->id), ManageRecurringSchedule::JOURNAL, $request->toInput());

        return (new RecurringScheduleResource($schedule))->response()->setStatusCode(201);
    }

    #[Authorize('update', 'recurringJournal')]
    public function update(RecurringJournalRequest $request, Company $company, RecurringJournal $recurringJournal, ManageRecurringSchedule $action): RecurringScheduleResource
    {
        return new RecurringScheduleResource($action->update(RequestActor::from($request, $company->id), ManageRecurringSchedule::JOURNAL, $recurringJournal->id, $request->version(), $request->toInput()));
    }

    #[Authorize('pause', 'recurringJournal')]
    public function pause(VersionRequest $request, Company $company, RecurringJournal $recurringJournal, ManageRecurringSchedule $action): RecurringScheduleResource
    {
        return new RecurringScheduleResource($action->setActive(RequestActor::from($request, $company->id), ManageRecurringSchedule::JOURNAL, $recurringJournal->id, $request->version(), false));
    }

    #[Authorize('resume', 'recurringJournal')]
    public function resume(VersionRequest $request, Company $company, RecurringJournal $recurringJournal, ManageRecurringSchedule $action): RecurringScheduleResource
    {
        return new RecurringScheduleResource($action->setActive(RequestActor::from($request, $company->id), ManageRecurringSchedule::JOURNAL, $recurringJournal->id, $request->version(), true));
    }
}
