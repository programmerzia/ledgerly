<?php

declare(strict_types=1);

use App\Actions\Fiscal\ClosePeriod;
use App\Actions\Fiscal\DecidePeriodReopen;
use App\Actions\Fiscal\Inputs\ClosePeriodInput;
use App\Actions\Fiscal\RequestPeriodReopen;
use App\Actions\Ledger\Inputs\ReverseJournalInput;
use App\Actions\Ledger\ReverseJournal;
use App\Actions\Workflow\ApproveDocument;
use App\Actions\Workflow\Inputs\DocumentRef;
use App\Actions\Workflow\Inputs\ReturnDocumentInput;
use App\Actions\Workflow\Inputs\VoidDocumentInput;
use App\Actions\Workflow\ReturnDocument;
use App\Actions\Workflow\SubmitDocument;
use App\Actions\Workflow\VoidDocument;
use App\Contracts\PermissionChecker;
use App\Contracts\RoleChecker;
use App\Domain\Ledger\DraftLine;
use App\Domain\Shared\DomainRuleViolation;
use App\Models\Workflow\ApprovalWorkflow;
use App\Support\Actor;
use App\Support\ActorType;
use App\Support\Testing\GrantedPermissions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Support\AllowAllRoles;
use Tests\Support\LedgerChecks;
use Tests\Support\LedgerFixture;
use Tests\Support\Race;

/*
 * Property-style over the whole document lifecycle: a seeded random mix of create, submit, approve,
 * return, void, reverse, period close and two-person reopen. Whatever the refusals along the way,
 * afterwards every 13 §9 detective is clean (see Tests\Support\LedgerChecks).
 */

it('keeps every ledger invariant through a random mix of workflow, reversal and period operations', function (int $seed): void {
    mt_srand($seed);
    app()->instance(PermissionChecker::class, new GrantedPermissions([
        'journals.submit', 'journals.approve', 'journals.reverse', 'periods.close', 'periods.reopen.request', 'periods.reopen.approve',
    ]));
    app()->instance(RoleChecker::class, new AllowAllRoles);

    $f = LedgerFixture::create();
    $maker = $f->signedActor();
    $approvers = [Race::user($f, 'Amina'), Race::user($f, 'Kenneth')];
    $as = fn (string $id) => new Actor(ActorType::User, $id, $f->tenantId, $f->companyId, hasSigningGrant: true);

    // Large journals need one approval; small ones post straight from submit.
    (new ApprovalWorkflow)->forceFill([
        'id' => (string) Str::uuid7(), 'tenant_id' => $f->tenantId, 'company_id' => $f->companyId, 'document_type' => 'journal',
        'name' => 'Large', 'source' => 'any', 'min_amount' => 400_000, 'max_amount' => null, 'steps' => [['role' => 'Approver', 'count' => 1]], 'is_active' => true,
    ])->save();

    $dimension = (string) Str::uuid7();
    DB::table('dimensions')->insert(['id' => $dimension, 'tenant_id' => $f->tenantId, 'company_id' => $f->companyId, 'code' => 'FUND', 'name' => 'Fund', 'position' => 1]);
    $funds = [];
    foreach (['A', 'B'] as $code) {
        $funds[] = (string) Str::uuid7();
        DB::table('dimension_values')->insert(['id' => end($funds), 'tenant_id' => $f->tenantId, 'company_id' => $f->companyId, 'dimension_id' => $dimension, 'code' => $code, 'name' => "Fund {$code}"]);
    }

    $codes = ['1000', '1300', '4000', '5000'];
    $line = function (bool $debit, int $amount) use ($f, $codes, $funds): DraftLine {
        $dims = mt_rand(0, 2) === 0 ? [1 => $funds[mt_rand(0, 1)]] : [];
        $account = $f->account($codes[mt_rand(0, 3)]);

        return new DraftLine($account, debit: $debit ? $amount : 0, credit: $debit ? 0 : $amount, dims: $dims);
    };
    $ids = fn (string $where, array $bindings = []) => array_map(fn ($r) => $r->id, DB::select("SELECT id FROM journals WHERE {$where}", $bindings));
    $pick = fn (array $list) => $list === [] ? null : $list[mt_rand(0, count($list) - 1)];

    $done = array_fill_keys(['create', 'submit', 'approve', 'return', 'void', 'reverse', 'close', 'reopen'], 0);
    $try = function (string $kind, callable $step) use (&$done): void {
        try {
            $step();
            $done[$kind]++;
        } catch (DomainRuleViolation) {
            // A refusal is a legitimate outcome of a random sequence; the invariants must hold regardless.
        }
    };

    for ($n = 0; $n < 110; $n++) {
        $this->clock->advance('+1 minute');
        $roll = mt_rand(0, 99);

        if ($roll < 30) {
            $total = mt_rand(1, 900_000);
            $lines = [$line(true, $total)];
            $cut = mt_rand(1, max(1, $total - 1));
            if ($total > 1) {
                $lines[] = $line(false, $cut);
                $lines[] = $line(false, $total - $cut);
            } else {
                $lines[] = $line(false, $total);
            }
            draftJournal($f, $lines, sprintf('2026-%02d-%02d', mt_rand(1, 12), mt_rand(1, 28)), actor: $maker);
            $done['create']++;
        } elseif ($roll < 50) {
            if ($id = $pick($ids("status = 'draft'"))) {
                $try('submit', fn () => app(SubmitDocument::class)->handle($maker, new DocumentRef('journal', $id)));
            }
        } elseif ($roll < 64) {
            if ($id = $pick($ids("status = 'pending_approval'"))) {
                $try('approve', fn () => app(ApproveDocument::class)->handle($as($approvers[mt_rand(0, 1)]), new DocumentRef('journal', $id), 'ok'));
            }
        } elseif ($roll < 72) {
            if ($id = $pick($ids("status = 'pending_approval'"))) {
                $try('return', fn () => app(ReturnDocument::class)->handle($as($approvers[0]), new ReturnDocumentInput(new DocumentRef('journal', $id), 'fix it')));
            }
        } elseif ($roll < 77) {
            if ($id = $pick($ids("status IN ('draft', 'pending_approval')"))) {
                $try('void', fn () => app(VoidDocument::class)->handle($maker, new VoidDocumentInput(new DocumentRef('journal', $id), 'mistake')));
            }
        } elseif ($roll < 86) {
            if ($id = $pick($ids("status = 'posted' AND reversal_of_id IS NULL"))) {
                $try('reverse', fn () => app(ReverseJournal::class)->handle($maker, new ReverseJournalInput($id)));
            }
        } elseif ($roll < 93) {
            $open = array_map(fn ($r) => $r->id, DB::select("SELECT id FROM fiscal_periods WHERE kind = 'regular' AND status = 'open'"));
            if ($id = $pick($open)) {
                $try('close', fn () => app(ClosePeriod::class)->handle($maker, new ClosePeriodInput($id, ['DRAFTS' => 'mix', 'APPROVALS' => 'mix'])));
            }
        } else {
            $closed = array_map(fn ($r) => $r->id, DB::select("SELECT id FROM fiscal_periods WHERE kind = 'regular' AND status = 'closed'"));
            if ($id = $pick($closed)) {
                $try('reopen', function () use ($maker, $id, $as, $approvers): void {
                    $request = app(RequestPeriodReopen::class)->handle($maker, $id, 'late invoice');
                    app(DecidePeriodReopen::class)->approve($as($approvers[0]), $request->id);
                    app(DecidePeriodReopen::class)->approve($as($approvers[1]), $request->id);
                });
            }
        }
    }

    // Not vacuous: every kind of operation really happened, and so did some postings.
    expect($done)->each->toBeGreaterThan(0)
        ->and(DB::table('journals')->where('status', 'reversed')->count())->toBeGreaterThan(0)
        ->and(DB::table('approval_requests')->where('status', 'approved')->count())->toBeGreaterThan(0)
        ->and(DB::table('journals')->whereNotNull('number')->count())->toBeGreaterThan(10);

    // Every posted line the dimension fund tags is projected under its own dim_key.
    expect(DB::table('journal_lines')->whereNotNull('dim1_value_id')->count())->toBeGreaterThan(0);

    expect(LedgerChecks::problems())->toBe([])
        ->and(LedgerChecks::postedInsideClosedWindows())->toBe([]);

    // Pending documents carry open approval slots; settled ones carry none.
    expect(DB::select(<<<'SQL'
        SELECT j.id FROM journals j JOIN approval_requests r ON r.document_id = j.id
        WHERE r.status = 'pending' AND j.status <> 'pending_approval'
    SQL))->toBe([]);
})->with([7, 42, 2026, 31337]);
