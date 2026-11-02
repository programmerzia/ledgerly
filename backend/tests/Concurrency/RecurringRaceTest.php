<?php

declare(strict_types=1);

use App\Actions\Trade\CreateInvoiceDraft;
use App\Actions\Trade\Inputs\InvoiceDraftInput;
use App\Actions\Trade\Inputs\InvoiceLineInput;
use App\Actions\Workflow\Inputs\DocumentRef;
use App\Actions\Workflow\SubmitDocument;
use App\Domain\Trade\InvoiceKind;
use App\Support\Actor;
use App\Support\ActorType;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Support\LedgerChecks;
use Tests\Support\LedgerFixture;
use Tests\Support\Race;
use Tests\Support\TradeFixture;

/*
 * Recurring schedules (doc 14 E2) run from several processes at once, as when two daily jobs overlap or someone presses
 * "run now" while the job runs. The unique key on `recurring_runs` decides: every occurrence date exists exactly once.
 */

/** A posted template invoice, a schedule for it and an approval workflow, so the copies wait for an approver. */
function recurringWorld(LedgerFixture $f, string $owner, string $next = '2026-01-31'): array
{
    $t = TradeFixture::prepare($f);
    $signer = new Actor(ActorType::User, $owner, $f->tenantId, $f->companyId, hasSigningGrant: true, requestId: 'test');
    $template = app(CreateInvoiceDraft::class)->handle($signer, new InvoiceDraftInput(
        $f->companyId, InvoiceKind::SalesInvoice, $t->customer, new DateTimeImmutable('2026-01-05'),
        [new InvoiceLineInput('2', accountId: $f->account('4000'), unitPriceFc: 5000, taxCodeId: $t->tax['VAT10'], taxCodeGiven: true)],
    ));
    app(SubmitDocument::class)->handle($signer, new DocumentRef('invoice', $template->id));
    Race::workflow($f, [['role' => 'Approver', 'count' => 1]], 'invoice');

    $schedule = (string) Str::uuid7();
    DB::table('recurring_invoices')->insert([
        'id' => $schedule, 'tenant_id' => $f->tenantId, 'company_id' => $f->companyId, 'name' => 'Race', 'template_invoice_id' => $template->id,
        'frequency' => 'monthly', 'anchor_day' => (int) substr($next, 8, 2), 'next_date' => $next, 'owner_id' => $owner, 'is_active' => true,
    ]);

    return [$schedule, $template->id];
}

it('creates each occurrence exactly once however many runners overlap', function (int $runners): void {
    $this->grant('invoices.create', 'invoices.submit');
    $f = LedgerFixture::create();
    $owner = Race::user($f, 'Olive');
    [$schedule, $template] = recurringWorld($f, $owner);

    $flat = Race::flatten(Race::run($f, array_map(fn () => [['op' => 'recurring_run', 'as_of' => '2026-03-31', 'user' => $owner]], range(1, $runners))));

    $runs = DB::table('recurring_runs')->where('schedule_id', $schedule)->orderBy('occurrence_date')->get();
    expect(Race::errors($flat))->toBe([], 'a raw error (unique violation, deadlock) surfaced to the caller')
        ->and(array_sum(array_column(Race::ok($flat), 'created')))->toBe(3)
        ->and($runs->pluck('occurrence_date')->all())->toBe(['2026-01-31', '2026-02-28', '2026-03-31'])
        ->and($runs->pluck('status')->unique()->all())->toBe(['submitted'])
        ->and(DB::table('invoices')->where('id', '!=', $template)->count())->toBe(3)
        ->and(DB::table('invoices')->where('id', '!=', $template)->where('status', 'pending_approval')->count())->toBe(3)
        ->and(DB::table('invoices')->where('id', '!=', $template)->pluck('issue_date')->sort()->values()->all())->toBe(['2026-01-31', '2026-02-28', '2026-03-31'])
        ->and(DB::table('recurring_invoices')->where('id', $schedule)->value('next_date'))->toBe('2026-04-30')
        ->and(DB::table('audit_events')->where('action', 'recurring_schedule.occurrence_created')->count())->toBe(3)
        ->and(DB::table('journals')->where('status', 'posted')->count())->toBe(1, 'only the template is posted')
        ->and(LedgerChecks::problems())->toBe([]);
})->with([
    'two runners' => [2],
    'four runners' => [4],
])->group('concurrency');

it('turns a repeated unique key into a skipped date, never a second draft', function (): void {
    $this->grant('invoices.create', 'invoices.submit');
    $f = LedgerFixture::create();
    $owner = Race::user($f, 'Olive');
    [$schedule, $template] = recurringWorld($f, $owner);

    // An occurrence already taken (for instance by a worker that crashed after its insert committed elsewhere) is not repeated.
    DB::table('recurring_runs')->insert([
        'id' => (string) Str::uuid7(), 'tenant_id' => $f->tenantId, 'company_id' => $f->companyId, 'schedule_type' => 'recurring_invoice', 'schedule_id' => $schedule,
        'occurrence_date' => '2026-01-31', 'document_type' => 'invoice', 'document_id' => $template, 'status' => 'submitted',
    ]);
    expect(fn () => DB::table('recurring_runs')->insert([
        'id' => (string) Str::uuid7(), 'tenant_id' => $f->tenantId, 'company_id' => $f->companyId, 'schedule_type' => 'recurring_invoice', 'schedule_id' => $schedule,
        'occurrence_date' => '2026-01-31', 'document_type' => 'invoice', 'document_id' => $template, 'status' => 'drafted',
    ]))->toThrow(UniqueConstraintViolationException::class);

    $flat = Race::flatten(Race::run($f, [[['op' => 'recurring_run', 'as_of' => '2026-02-15', 'user' => $owner]]]));

    // The taken date makes the worker stop without creating a draft or moving the schedule; it is reported, not duplicated.
    expect(Race::errors($flat))->toBe([])
        ->and(DB::table('invoices')->where('id', '!=', $template)->count())->toBe(0)
        ->and(DB::table('recurring_runs')->where('schedule_id', $schedule)->count())->toBe(1);
})->group('concurrency');
