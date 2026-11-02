<?php

declare(strict_types=1);

/*
 * Worker for tests/Concurrency: boots the app in its own process, announces "ready", waits for the
 * parent's "go" line on STDIN (so all workers start together), then runs its operations in order
 * and prints one JSON line per operation: {"ok":true,...} | {"refused":"code","violations":[...]} |
 * {"error":"Class","message":"...","code":"..."} (anything that is not a business refusal).
 * Usage: php race-worker.php '<json spec>' with {tenant, company, ops: [{op, user, delay_ms?, ...}]}
 */

use App\Actions\Banking\CreateBankTransaction;
use App\Actions\Banking\Inputs\BankTransactionInput;
use App\Actions\Banking\Inputs\MatchInput;
use App\Actions\Banking\ManageBankReconciliation;
use App\Actions\Banking\MatchStatementLine;
use App\Actions\Fiscal\ClosePeriod;
use App\Actions\Fiscal\DecidePeriodReopen;
use App\Actions\Fiscal\Inputs\ClosePeriodInput;
use App\Actions\Fiscal\YearEndClose;
use App\Actions\Fx\Inputs\RunFxRevaluationInput;
use App\Actions\Fx\RunFxRevaluation;
use App\Actions\Ledger\Inputs\PostJournalInput;
use App\Actions\Ledger\Inputs\ReverseJournalInput;
use App\Actions\Ledger\PostJournal;
use App\Actions\Ledger\ReverseJournal;
use App\Actions\Recurring\RecurringRunSummary;
use App\Actions\Recurring\RunRecurringSchedules;
use App\Actions\Trade\Inputs\ReverseInvoiceInput;
use App\Actions\Trade\Inputs\ReverseSettlementInput;
use App\Actions\Trade\ReverseInvoice;
use App\Actions\Trade\ReverseSettlement;
use App\Actions\Workflow\ApproveDocument;
use App\Actions\Workflow\BulkApproveDocuments;
use App\Actions\Workflow\Inputs\DocumentRef;
use App\Actions\Workflow\Inputs\ReturnDocumentInput;
use App\Actions\Workflow\Inputs\VoidDocumentInput;
use App\Actions\Workflow\ReturnDocument;
use App\Actions\Workflow\SubmitDocument;
use App\Actions\Workflow\VoidDocument;
use App\Contracts\PermissionChecker;
use App\Contracts\RoleChecker;
use App\Domain\Shared\DomainRuleViolation;
use App\Support\Actor;
use App\Support\ActorType;
use App\Support\Tenancy\TenantContext;
use App\Support\Testing\GrantedPermissions;
use Illuminate\Contracts\Console\Kernel;
use Tests\Support\AllowAllRoles;

require __DIR__.'/../../../vendor/autoload.php';
$app = require __DIR__.'/../../../bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();

/** @var array{tenant: string, company: string, ops: list<array<string, mixed>>} $spec */
$spec = json_decode($argv[1], true, flags: JSON_THROW_ON_ERROR);

// Roles and permissions are not what a race test is about: grant everything, keep the real locking.
$app->instance(PermissionChecker::class, new GrantedPermissions([
    'recurring.manage', 'invoices.create', 'bills.create', 'bills.submit', 'journals.create',
    'journals.submit', 'journals.approve', 'journals.reverse', 'invoices.submit', 'invoices.approve', 'invoices.reverse', 'invoices.void', 'receipts.create', 'payments.create', 'payments.approve', 'receipts.reverse', 'payments.reverse', 'periods.close', 'periods.reopen.request',
    'banking.reconcile', 'banking.transactions.create', 'journals.submit',
    'periods.reopen.approve', 'periods.year_end', 'periods.post_adjustment', 'periods.post_soft_closed',
]));
$app->instance(RoleChecker::class, new AllowAllRoles);
$app->make(TenantContext::class)->set($spec['tenant']);

fwrite(STDOUT, 'ready'.PHP_EOL);
fflush(STDOUT);
fgets(STDIN);

foreach ($spec['ops'] as $op) {
    if (isset($op['delay_ms'])) {
        usleep((int) $op['delay_ms'] * 1000);
    }
    $actor = new Actor(ActorType::User, $op['user'], $spec['tenant'], $spec['company'], hasSigningGrant: true, requestId: 'race');

    $started = microtime(true);
    try {
        $result = match ($op['op']) {
            'post' => $app->make(PostJournal::class)->handle($actor, new PostJournalInput($op['id'])),
            'submit' => $app->make(SubmitDocument::class)->handle($actor, new DocumentRef('journal', $op['id'])),
            'approve' => $app->make(ApproveDocument::class)->handle($actor, new DocumentRef('journal', $op['id'])),
            'return' => $app->make(ReturnDocument::class)->handle($actor, new ReturnDocumentInput(new DocumentRef('journal', $op['id']), 'race')),
            'reverse' => $app->make(ReverseJournal::class)->handle($actor, new ReverseJournalInput($op['id'])),
            'submit_invoice' => $app->make(SubmitDocument::class)->handle($actor, new DocumentRef('invoice', $op['id'])),
            'approve_invoice' => $app->make(ApproveDocument::class)->handle($actor, new DocumentRef('invoice', $op['id'])),
            'void_invoice' => $app->make(VoidDocument::class)->handle($actor, new VoidDocumentInput(new DocumentRef('invoice', $op['id']), 'race')),
            'reverse_invoice' => $app->make(ReverseInvoice::class)->handle($actor, new ReverseInvoiceInput($op['id'])),
            'submit_settlement' => $app->make(SubmitDocument::class)->handle($actor, new DocumentRef('settlement', $op['id'])),
            'approve_settlement' => $app->make(ApproveDocument::class)->handle($actor, new DocumentRef('settlement', $op['id'])),
            'reverse_settlement' => $app->make(ReverseSettlement::class)->handle($actor, new ReverseSettlementInput($op['id'])),
            'submit_run' => $app->make(SubmitDocument::class)->handle($actor, new DocumentRef('payment_run', $op['id'])),
            'approve_run' => $app->make(ApproveDocument::class)->handle($actor, new DocumentRef('payment_run', $op['id'])),
            'bank_match' => $app->make(MatchStatementLine::class)->handle($actor, new MatchInput($spec['company'], $op['lines'], [], $op['settlements'] ?? [])),
            'bank_txn' => $app->make(CreateBankTransaction::class)->handle($actor, new BankTransactionInput($spec['company'], $op['id'], 'spend', $op['account'])),
            'bank_finish' => $app->make(ManageBankReconciliation::class)->finish($actor, $spec['company'], $op['id'], null),
            'revalue' => $app->make(RunFxRevaluation::class)->handle(Actor::system($spec['tenant'], $spec['company']), new RunFxRevaluationInput($spec['company'], $op['id'])),
            'recurring_run' => $app->make(RunRecurringSchedules::class)->handle(Actor::system($spec['tenant'], $spec['company']), $spec['company'], new DateTimeImmutable($op['as_of']), $op['id'] ?? null),
            'bulk_approve' => $app->make(BulkApproveDocuments::class)->handle($actor, array_map(fn (string $id) => new DocumentRef('invoice', $id), $op['ids'])),
            'close' => $app->make(ClosePeriod::class)->handle($actor, new ClosePeriodInput($op['id'], $op['waivers'] ?? [])),
            'year_end' => $app->make(YearEndClose::class)->handle($actor, $op['id']),
            'reopen_approve' => $app->make(DecidePeriodReopen::class)->approve($actor, $op['id']),
            default => throw new InvalidArgumentException('Unknown op '.$op['op']),
        };
        $line = is_array($result)
            ? ['ok' => true, 'id' => null, 'number' => null, 'results' => array_map(fn ($r) => ['id' => $r->document->id, 'ok' => $r->ok, 'code' => $r->code], $result)]
            : ($result instanceof RecurringRunSummary
            ? ['ok' => true, 'id' => null, 'number' => null, 'created' => count($result->runs), 'failures' => $result->failures]
            : ['ok' => true, 'id' => $result?->getKey(), 'number' => $result?->number ?? null]);
    } catch (DomainRuleViolation $e) {
        $line = ['refused' => $e->errorCode, 'violations' => array_map(fn ($v) => $v->code, $e->violations)];
    } catch (Throwable $e) {
        $line = ['error' => $e::class, 'message' => $e->getMessage(), 'code' => (string) $e->getCode()];
    }
    $line['op'] = $op['op'];
    $line['started'] = $started;
    $line['finished'] = microtime(true);
    $line['target'] = $op['id'] ?? null;
    fwrite(STDOUT, json_encode($line, JSON_THROW_ON_ERROR).PHP_EOL);
}
