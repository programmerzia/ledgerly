<?php

declare(strict_types=1);

namespace App\Http\Controllers\Documents;

use App\Actions\Documents\RunStatements;
use App\Http\Controllers\Controller;
use App\Http\Requests\Documents\StatementRunRequest;
use App\Http\Resources\SendStatusResource;
use App\Http\Resources\StatementRunCustomerResource;
use App\Http\Resources\StatementRunResultResource;
use App\Http\Support\RequestActor;
use App\Models\Documents\DocumentSend;
use App\Models\Organisation\Company;
use App\Models\Trade\Contact;
use App\Queries\Trade\StatementRunCustomers;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Routing\Attributes\Controllers\Authorize;

/**
 * The statement run (plan 3c.7a): list the customers with a balance for a period, send the chosen ones, follow the results.
 * Needs `documents.send` and `reports.view`. Sends are limited per company per hour; a run over the limit is refused whole.
 */
final class StatementRunController extends Controller
{
    /**
     * Customers with a balance at the end of the period, with `has_email` (a customer without one is flagged and cannot be sent to),
     * when a statement last went out, and the company's hourly email allowance in `meta.allowance`.
     */
    #[Authorize('runStatements', Contact::class)]
    public function index(StatementRunRequest $request, Company $company, StatementRunCustomers $customers, RunStatements $run): AnonymousResourceCollection
    {
        $period = $request->period();

        return StatementRunCustomerResource::collection($customers($company->id, $period->to))
            ->additional(['meta' => ['from' => $period->from, 'to' => $period->to, 'allowance' => $run->allowance($company->id)]]);
    }

    /**
     * Send the chosen customers' statements. 200 with one result per customer (`queued`, `skipped` or `failed`, with a reason), or
     * 422 `statement_run_over_limit` with nothing sent when the run is larger than this hour's allowance.
     */
    #[Authorize('runStatements', Contact::class)]
    public function store(StatementRunRequest $request, Company $company, RunStatements $run): AnonymousResourceCollection
    {
        $results = $run->handle(RequestActor::user($request, $company->id), $company->id, $request->period(), $request->contactIds());
        $queued = count(array_filter($results, fn (array $r): bool => $r['status'] === 'queued'));

        return StatementRunResultResource::collection($results)
            ->additional(['meta' => ['queued' => $queued, 'not_sent' => count($results) - $queued, 'allowance' => $run->allowance($company->id)]]);
    }

    /** How the queued statements ended (`queued`, `sent` or `failed`): poll with the `send_id`s of a run. */
    #[Authorize('runStatements', Contact::class)]
    public function sends(Request $request, Company $company): AnonymousResourceCollection
    {
        /** @var list<string> $ids */
        $ids = $request->validate(['ids' => ['required', 'array', 'min:1', 'max:200'], 'ids.*' => ['uuid']])['ids'];

        return SendStatusResource::collection(DocumentSend::query()->where('company_id', $company->id)->where('document_type', 'statement')->whereIn('id', $ids)->get());
    }
}
