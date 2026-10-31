<?php

declare(strict_types=1);

use App\Actions\Ledger\Inputs\UpdateJournalDraftInput;
use App\Actions\Ledger\UpdateJournalDraft;
use App\Domain\Ledger\DraftLine;
use App\Domain\Ledger\JournalStatus;
use App\Domain\Ledger\JournalType;
use App\Domain\Ledger\PostingRejected;
use App\Domain\Shared\DomainRuleViolation;
use App\Support\ActorType;
use App\Support\UnitOfWork\VersionConflict;
use Illuminate\Support\Facades\DB;
use Tests\Support\LedgerFixture;

beforeEach(function () {
    $this->f = LedgerFixture::create();
});

it('posts a draft: number, period, totals, balances, audit and outbox', function () {
    $draft = draftJournal($this->f, [
        new DraftLine($this->f->account('1000'), debit: 12500),
        new DraftLine($this->f->account('4000'), credit: 12500),
    ]);
    expect($draft->status)->toBe(JournalStatus::Draft)->and($draft->number)->toBeNull();

    $posted = postJournal($this->f, $draft, version: 0);

    expect($posted->status)->toBe(JournalStatus::Posted)
        ->and($posted->number)->toBe('JV-FY2026-00001')
        ->and($posted->fiscal_period_id)->toBe($this->f->period('2026-03-15')->id)
        ->and($posted->total_debit)->toBe(12500)
        ->and($posted->lock_version)->toBe(1)
        ->and($posted->posted_at?->format('Y-m-d H:i'))->toBe('2026-03-15 09:30')
        ->and(balancesByCode($this->f))->toBe(['1000' => ['debit' => 12500, 'credit' => 0], '4000' => ['debit' => 0, 'credit' => 12500]])
        ->and(DB::table('audit_events')->orderBy('id')->pluck('action')->all())->toBe(['fiscal_year.created', 'journal.created', 'journal.posted'])
        ->and(DB::table('outbox_messages')->value('type'))->toBe('journal.posted');
});

it('numbers postings gaplessly; a rejected post does not consume a number', function () {
    cashSale($this->f);
    $bad = draftJournal($this->f, [
        new DraftLine($this->f->account('1000'), debit: 100),
        new DraftLine($this->f->account('4000'), credit: 99),
    ]);
    expect(fn () => postJournal($this->f, $bad))->toThrow(PostingRejected::class);

    $second = cashSale($this->f);

    expect($second->number)->toBe('JV-FY2026-00002')
        ->and($bad->fresh()?->status)->toBe(JournalStatus::Draft);
});

it('returns every violation with codes', function () {
    $bad = draftJournal($this->f, [
        new DraftLine($this->f->account('1100'), debit: 100),
        new DraftLine($this->f->account('4000'), credit: 90),
    ]);

    try {
        postJournal($this->f, $bad);
        $this->fail('expected rejection');
    } catch (PostingRejected $e) {
        expect(array_map(fn ($v) => $v->code, $e->violations))
            ->toBe(['control_account_direct', 'contact_required', 'journal_unbalanced']);
    }
});

it('rejects posting into closed and locked periods', function (string $status) {
    $draft = draftJournal($this->f, [
        new DraftLine($this->f->account('1000'), debit: 100),
        new DraftLine($this->f->account('4000'), credit: 100),
    ]);
    $this->f->setPeriodStatus('2026-03-15', $status);

    expect(fn () => postJournal($this->f, $draft))->toThrow(fn (PostingRejected $e) => expect($e->errorCode)->toBe('period_closed'));
})->with(['closed', 'locked']);

it('allows a soft-closed period only with periods.post_soft_closed and never for API clients (D5)', function () {
    $lines = [new DraftLine($this->f->account('1000'), debit: 100), new DraftLine($this->f->account('4000'), credit: 100)];
    $this->f->setPeriodStatus('2026-03-15', 'soft_closed');

    expect(fn () => postJournal($this->f, draftJournal($this->f, $lines)))
        ->toThrow(fn (PostingRejected $e) => expect($e->errorCode)->toBe('period_soft_closed'));

    $this->grant('periods.post_soft_closed');
    $api = $this->f->actorAs(ActorType::ApiClient);
    expect(fn () => postJournal($this->f, draftJournal($this->f, $lines), $api))
        ->toThrow(fn (PostingRejected $e) => expect($e->errorCode)->toBe('period_soft_closed'));

    expect(postJournal($this->f, draftJournal($this->f, $lines))->status)->toBe(JournalStatus::Posted);
});

it('detects stale versions and refuses to re-post', function () {
    $draft = draftJournal($this->f, [
        new DraftLine($this->f->account('1000'), debit: 100),
        new DraftLine($this->f->account('4000'), credit: 100),
    ]);

    expect(fn () => postJournal($this->f, $draft, version: 7))
        ->toThrow(fn (VersionConflict $e) => expect($e->serverVersion)->toBe(0));

    postJournal($this->f, $draft);
    expect(fn () => postJournal($this->f, $draft))
        ->toThrow(fn (DomainRuleViolation $e) => expect($e->errorCode)->toBe('journal_not_postable'));
});

it('posts closing journals only into the adjustment period with permission (D7)', function () {
    $adj = $this->f->adjustmentPeriod();
    $lines = [new DraftLine($this->f->account('4000'), debit: 500), new DraftLine($this->f->account('3000'), credit: 500)];

    expect(fn () => postJournal($this->f, draftJournal($this->f, $lines, '2026-12-31', JournalType::Closing, $adj->id)))
        ->toThrow(fn (PostingRejected $e) => expect($e->errorCode)->toBe('period_adjustment_forbidden'));

    $this->grant('periods.post_adjustment');
    $posted = postJournal($this->f, draftJournal($this->f, $lines, '2026-12-31', JournalType::Closing, $adj->id));
    expect($posted->fiscal_period_id)->toBe($adj->id);

    expect(fn () => postJournal($this->f, draftJournal($this->f, $lines, '2026-12-31', JournalType::Manual, $adj->id)))
        ->toThrow(fn (PostingRejected $e) => expect($e->errorCode)->toBe('period_adjustment_only'));
});

it('posts foreign-currency lines keeping fc amounts and rates', function () {
    $posted = postJournal($this->f, draftJournal($this->f, [
        new DraftLine($this->f->account('1300'), debit: 11000, currency: 'EUR', fxRate: '1.10000000', amountFc: 10000),
        new DraftLine($this->f->account('4000'), credit: 11000),
    ]));

    $lines = $posted->lines()->get();
    expect($lines[0]->currency)->toBe('EUR')->and($lines[0]->amount_fc)->toBe(10000)->and($lines[0]->fx_rate)->toBe('1.10000000')
        ->and($lines[1]->currency)->toBe('USD')->and($lines[1]->amount_fc)->toBe(-11000);
});

it('updates drafts under lock_version and rejects edits after posting', function () {
    $draft = draftJournal($this->f, [new DraftLine($this->f->account('1000'), debit: 1), new DraftLine($this->f->account('4000'), credit: 1)]);
    $update = fn (int $v) => app(UpdateJournalDraft::class)->handle($this->f->actor, new UpdateJournalDraftInput(
        $draft->id, $v, new DateTimeImmutable('2026-03-20'),
        [new DraftLine($this->f->account('1000'), debit: 700), new DraftLine($this->f->account('4000'), credit: 700)],
    ));

    $updated = $update(0);
    expect($updated->lock_version)->toBe(1)->and((int) $updated->lines()->sum('debit'))->toBe(700);
    expect(fn () => $update(0))->toThrow(VersionConflict::class);

    postJournal($this->f, $updated);
    expect(fn () => $update(2))->toThrow(fn (DomainRuleViolation $e) => expect($e->errorCode)->toBe('journal_not_editable'));
});
