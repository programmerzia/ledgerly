<?php

declare(strict_types=1);

use App\Domain\Ledger\DraftLine;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Tests\Support\LedgerFixture;

beforeEach(function () {
    $this->f = LedgerFixture::create();
});

function sqlState(callable $fn): ?string
{
    try {
        $fn();
    } catch (QueryException|PDOException $e) {
        return (string) $e->getCode();
    }

    return null;
}

it('rejects any change to lines of a posted journal (journal_lines_guard)', function () {
    $j = cashSale($this->f);
    $line = DB::table('journal_lines')->where('journal_id', $j->id)->first();

    expect(sqlState(fn () => DB::table('journal_lines')->where('id', $line->id)->update(['debit' => 1])))->toBe('LG001')
        ->and(sqlState(fn () => DB::table('journal_lines')->where('id', $line->id)->delete()))->toBe('LG001')
        ->and(sqlState(fn () => DB::table('journal_lines')->insert([...(array) $line, 'id' => (string) Str::uuid7(), 'line_no' => 9])))->toBe('LG001');
});

it('allows only whitelisted column changes on posted journals (posted_row_guard)', function () {
    $j = cashSale($this->f);

    expect(sqlState(fn () => DB::table('journals')->where('id', $j->id)->update(['memo' => 'edited'])))->toBe('LG002')
        ->and(sqlState(fn () => DB::table('journals')->where('id', $j->id)->update(['status' => 'draft'])))->toBe('LG002')
        ->and(sqlState(fn () => DB::table('journals')->where('id', $j->id)->delete()))->toBe('LG002')
        ->and(sqlState(fn () => DB::table('journals')->where('id', $j->id)->update(['lock_version' => 5, 'updated_at' => now()])))->toBeNull();
});

it('fails at commit when a posted journal does not balance (journal_balanced, deferred)', function () {
    $draft = draftJournal($this->f, [
        new DraftLine($this->f->account('1000'), debit: 100),
        new DraftLine($this->f->account('4000'), credit: 90),
    ]);
    $period = $this->f->period('2026-03-15');

    $state = sqlState(fn () => DB::transaction(function () use ($draft, $period) {
        DB::table('journals')->where('id', $draft->id)->update([
            'status' => 'posted', 'number' => 'X-1', 'fiscal_period_id' => $period->id,
            'posted_at' => now(), 'total_debit' => 100, 'total_credit' => 100,
        ]);
        // the statement itself succeeds; the constraint fires at COMMIT
    }));

    expect($state)->toBe('LG003')
        ->and(DB::table('journals')->where('id', $draft->id)->value('status'))->toBe('draft');
});

it('rejects a single-line or zero-line posted journal at commit', function () {
    $draft = draftJournal($this->f, [new DraftLine($this->f->account('1000'), debit: 0)]);

    expect(sqlState(fn () => DB::transaction(fn () => DB::table('journals')->where('id', $draft->id)->update([
        'status' => 'posted', 'number' => 'X-2', 'fiscal_period_id' => $this->f->period('2026-03-15')->id, 'posted_at' => now(),
    ]))))->toBe('LG003');
});

it('rejects posting into a closed period even when the app layer is bypassed (journal_period_open)', function () {
    $draft = draftJournal($this->f, [new DraftLine($this->f->account('1000'), debit: 5), new DraftLine($this->f->account('4000'), credit: 5)]);
    $period = $this->f->period('2026-03-15');
    $this->f->setPeriodStatus('2026-03-15', 'closed');
    $post = fn () => DB::transaction(fn () => DB::table('journals')->where('id', $draft->id)->update([
        'status' => 'posted', 'number' => 'X-3', 'fiscal_period_id' => $period->id, 'posted_at' => now(), 'total_debit' => 5, 'total_credit' => 5,
    ]));

    expect(sqlState($post))->toBe('LG004');

    $this->f->setPeriodStatus('2026-03-15', 'soft_closed');
    expect(sqlState($post))->toBe('LG004');
    expect(sqlState(fn () => DB::transaction(function () use ($post) {
        DB::statement("SET LOCAL app.allow_soft_closed = 'on'");
        $post();
    })))->toBeNull();
    // SET LOCAL ended with its transaction
    expect(DB::selectOne("SELECT current_setting('app.allow_soft_closed', true) AS v")->v)->not->toBe('on');
});

it('keeps the audit log append-only', function () {
    cashSale($this->f);

    expect(sqlState(fn () => DB::table('audit_events')->limit(1)->update(['action' => 'x'])))->toBe('LG010')
        ->and(sqlState(fn () => DB::table('audit_events')->delete()))->toBe('LG010');
});

it('rejects references to another company\'s account via composite FKs', function () {
    $other = (string) Str::uuid7();
    DB::table('companies')->insert(['id' => $other, 'tenant_id' => $this->f->tenantId, 'name' => 'Other', 'slug' => 'other', 'country' => 'US', 'base_currency' => 'USD']);
    $draft = draftJournal($this->f, [new DraftLine($this->f->account('1000'), debit: 5), new DraftLine($this->f->account('4000'), credit: 5)]);

    expect(sqlState(fn () => DB::table('journal_lines')->insert([
        'id' => (string) Str::uuid7(), 'tenant_id' => $this->f->tenantId, 'company_id' => $other, 'journal_id' => $draft->id,
        'line_no' => 3, 'account_id' => $this->f->account('1000'), 'debit' => 1, 'currency' => 'USD', 'amount_fc' => 1,
    ])))->toBe('23503');
});

it('enforces maker-checker in the database', function () {
    $draft = draftJournal($this->f, [new DraftLine($this->f->account('1000'), debit: 5), new DraftLine($this->f->account('4000'), credit: 5)]);

    expect(sqlState(fn () => DB::table('journals')->where('id', $draft->id)->update(['approved_by' => $this->f->userId])))->toBe('23514');
});
