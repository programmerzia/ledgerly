<?php

declare(strict_types=1);

namespace App\Http\Controllers\Recurring;

use App\Actions\Recurring\RunRecurringSchedules;
use App\Contracts\Clock;
use App\Http\Controllers\Controller;
use App\Http\Requests\Recurring\ListRecurringRunsRequest;
use App\Http\Requests\Recurring\RunRecurringRequest;
use App\Http\Resources\RecurringRunResource;
use App\Http\Support\CursorPage;
use App\Http\Support\RequestActor;
use App\Models\Organisation\Company;
use App\Models\Recurring\RecurringInvoice;
use App\Models\Recurring\RecurringRun;
use DateTimeImmutable;
use DateTimeZone;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Routing\Attributes\Controllers\Authorize;

/** The occurrences schedules produced, and "run now". */
final class RecurringRunController extends Controller
{
    #[Authorize('viewAny', RecurringInvoice::class)]
    public function index(ListRecurringRunsRequest $request, Company $company): AnonymousResourceCollection
    {
        $query = RecurringRun::query()->where('company_id', $company->id)->when($request->scheduleId() !== null, fn ($q) => $q->where('schedule_id', $request->scheduleId()));
        $page = CursorPage::fetch($query, $request, 'id', descending: true, kind: 'uuid');

        return RecurringRunResource::collection($page->items)->additional(['meta' => ['next_cursor' => $page->nextCursor, 'prev_cursor' => $page->prevCursor, 'limit' => $page->limit]]);
    }

    /** Creates the drafts due up to `as_of` (default: today in the company's time zone). Drafts only; nothing posts. */
    #[Authorize('run', RecurringInvoice::class)]
    public function run(RunRecurringRequest $request, Company $company, RunRecurringSchedules $action, Clock $clock): JsonResponse
    {
        $asOf = $request->asOf() ?? new DateTimeImmutable($clock->now()->setTimezone(new DateTimeZone($company->timezone))->format('Y-m-d'));
        $summary = $action->handle(RequestActor::from($request, $company->id), $company->id, $asOf, $request->scheduleId());

        return response()->json(['data' => [
            'created' => RecurringRunResource::collection(collect($summary->runs))->resolve($request),
            'failures' => $summary->failures,
        ]]);
    }
}
