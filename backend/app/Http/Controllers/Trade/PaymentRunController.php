<?php

declare(strict_types=1);

namespace App\Http\Controllers\Trade;

use App\Actions\Trade\CreatePaymentRunDraft;
use App\Actions\Trade\UpdatePaymentRunDraft;
use App\Actions\Workflow\ApproveDocument;
use App\Actions\Workflow\Inputs\DocumentRef;
use App\Actions\Workflow\Inputs\ReturnDocumentInput;
use App\Actions\Workflow\Inputs\VoidDocumentInput;
use App\Actions\Workflow\ReturnDocument;
use App\Actions\Workflow\SubmitDocument;
use App\Actions\Workflow\VoidDocument;
use App\Domain\Shared\DomainRuleViolation;
use App\Http\Controllers\Controller;
use App\Http\Requests\Ledger\ReturnJournalRequest;
use App\Http\Requests\Ledger\VoidJournalRequest;
use App\Http\Requests\Trade\ListPaymentRunsRequest;
use App\Http\Requests\Trade\PaymentRunRequest;
use App\Http\Requests\TransitionRequest;
use App\Http\Resources\InvoicePostingPreviewResource;
use App\Http\Resources\PaymentRunResource;
use App\Http\Support\CursorPage;
use App\Http\Support\RequestActor;
use App\Models\Organisation\Company;
use App\Models\Trade\Contact;
use App\Models\Trade\Invoice;
use App\Models\Trade\PaymentRun;
use App\Queries\Trade\PreviewSettlementPosting;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Routing\Attributes\Controllers\Authorize;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * Payment runs (`payments.*`): select bills, group by supplier, approve (signed, maker ≠ checker, through the workflow), and
 * one payment per supplier posts in one transaction. Tokens read only (`payment-runs:read`).
 */
final class PaymentRunController extends Controller
{
    #[Authorize('viewAny', PaymentRun::class)]
    public function index(ListPaymentRunsRequest $request, Company $company): AnonymousResourceCollection
    {
        $query = PaymentRun::query()->where('company_id', $company->id);
        if ($request->filled('status')) {
            $query->where('status', (string) $request->query('status'));
        }
        $page = CursorPage::fetch($query, $request, 'run_date', descending: true, kind: 'date');

        return PaymentRunResource::collection($page->items)->additional(['meta' => ['next_cursor' => $page->nextCursor, 'prev_cursor' => $page->prevCursor, 'limit' => $page->limit]]);
    }

    #[Authorize('view', 'paymentRun')]
    public function show(Company $company, PaymentRun $paymentRun): PaymentRunResource
    {
        return new PaymentRunResource($this->fresh($paymentRun->id));
    }

    #[Authorize('create', PaymentRun::class)]
    public function store(PaymentRunRequest $request, Company $company, CreatePaymentRunDraft $action): JsonResponse
    {
        $run = $action->handle(RequestActor::from($request, $company->id), $request->toInput());

        return (new PaymentRunResource($this->fresh($run->id)))->response()->setStatusCode(201);
    }

    #[Authorize('update', 'paymentRun')]
    public function update(PaymentRunRequest $request, Company $company, PaymentRun $paymentRun, UpdatePaymentRunDraft $action): PaymentRunResource
    {
        $action->handle(RequestActor::from($request, $company->id), $paymentRun->id, $request->version(), $request->toInput());

        return new PaymentRunResource($this->fresh($paymentRun->id));
    }

    #[Authorize('view', 'paymentRun')]
    public function preview(Request $request, Company $company, PaymentRun $paymentRun, PreviewSettlementPosting $preview): InvoicePostingPreviewResource
    {
        return new InvoicePostingPreviewResource($preview->ofRun(RequestActor::from($request, $company->id), $paymentRun->id));
    }

    #[Authorize('submit', 'paymentRun')]
    public function submit(TransitionRequest $request, Company $company, PaymentRun $paymentRun, SubmitDocument $action): PaymentRunResource
    {
        $action->handle(RequestActor::from($request, $company->id), $this->ref($paymentRun, $request->version()));

        return new PaymentRunResource($this->fresh($paymentRun->id));
    }

    #[Authorize('approve', 'paymentRun')]
    public function approve(TransitionRequest $request, Company $company, PaymentRun $paymentRun, ApproveDocument $action): PaymentRunResource
    {
        $action->handle(RequestActor::from($request, $company->id), $this->ref($paymentRun, $request->version()), $request->comment());

        return new PaymentRunResource($this->fresh($paymentRun->id));
    }

    #[Authorize('return', 'paymentRun')]
    public function return(ReturnJournalRequest $request, Company $company, PaymentRun $paymentRun, ReturnDocument $action): PaymentRunResource
    {
        $action->handle(RequestActor::from($request, $company->id), new ReturnDocumentInput($this->ref($paymentRun, $request->version()), $request->comment()));

        return new PaymentRunResource($this->fresh($paymentRun->id));
    }

    #[Authorize('void', 'paymentRun')]
    public function void(VoidJournalRequest $request, Company $company, PaymentRun $paymentRun, VoidDocument $action): PaymentRunResource
    {
        $action->handle(RequestActor::from($request, $company->id), new VoidDocumentInput($this->ref($paymentRun, $request->version()), $request->reason()));

        return new PaymentRunResource($this->fresh($paymentRun->id));
    }

    /**
     * The bank file (PRD 4.6): one CSV row per supplier payment of a posted run, generated on demand from the run
     * (nothing is stored; `export_file_path` stays free for a later file format). Columns: payee code, payee name, bills, amount, currency, date, run.
     */
    #[Authorize('view', 'paymentRun')]
    public function export(Company $company, PaymentRun $paymentRun): StreamedResponse
    {
        if ($paymentRun->status->value !== 'posted') {
            throw DomainRuleViolation::single('payment_run_not_posted', 'The bank file is available once the run is approved and posted.');
        }
        $run = $this->fresh($paymentRun->id);
        $bills = Invoice::query()->whereIn('id', $run->items->pluck('invoice_id'))->get()->keyBy('id');
        $contacts = Contact::query()->whereIn('id', $run->items->pluck('contact_id')->unique())->withTrashed()->get()->keyBy('id');

        return response()->streamDownload(function () use ($run, $bills, $contacts): void {
            $out = fopen('php://output', 'w') ?: throw new \RuntimeException('Cannot open the output stream.');
            fputcsv($out, ['payee_code', 'payee_name', 'bills', 'amount', 'currency', 'payment_date', 'run_number'], ',', '"', '');
            foreach ($run->items->groupBy('contact_id') as $contactId => $items) {
                $contact = $contacts[$contactId] ?? null;
                $total = (int) $items->sum('amount_fc');
                fputcsv($out, [
                    $contact?->code, $contact?->name, $items->map(fn ($i) => $bills[$i->invoice_id]->number ?? '')->implode(' '),
                    number_format($total / 100, 2, '.', ''), $run->currency, $run->run_date->format('Y-m-d'), $run->number,
                ], ',', '"', '');
            }
            fclose($out);
        }, 'Bank_Payment_Run_'.$run->number.'.csv', ['Content-Type' => 'text/csv; charset=utf-8']);
    }

    private function ref(PaymentRun $run, ?int $version): DocumentRef
    {
        return new DocumentRef('payment_run', $run->id, $version);
    }

    private function fresh(string $id): PaymentRun
    {
        return PaymentRun::query()->with('items')->findOrFail($id);
    }
}
