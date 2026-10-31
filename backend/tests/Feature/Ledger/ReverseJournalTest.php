<?php

declare(strict_types=1);

use App\Actions\Ledger\Inputs\ReverseJournalInput;
use App\Actions\Ledger\ReverseJournal;
use App\Domain\Ledger\JournalStatus;
use App\Domain\Ledger\JournalType;
use App\Domain\Ledger\PostingRejected;
use App\Domain\Shared\DomainRuleViolation;
use Tests\Support\LedgerFixture;

beforeEach(function () {
    $this->f = LedgerFixture::create();
    $this->reverse = fn (string $id, ?string $date = null) => app(ReverseJournal::class)
        ->handle($this->f->actor, new ReverseJournalInput($id, $date ? new DateTimeImmutable($date) : null));
});

it('posts a mirror on the original date and marks the original reversed (D3)', function () {
    $original = cashSale($this->f, 4200, '2026-03-10');
    $reversal = ($this->reverse)($original->id);
    $original->refresh();

    expect($reversal->journal_type)->toBe(JournalType::Reversal)
        ->and($reversal->journal_date->format('Y-m-d'))->toBe('2026-03-10')
        ->and($reversal->reversal_of_id)->toBe($original->id)
        ->and($reversal->number)->toBe('JV-FY2026-00002')
        ->and($original->status)->toBe(JournalStatus::Reversed)
        ->and($original->reversed_by_id)->toBe($reversal->id)
        ->and($original->lock_version)->toBe(2)
        ->and(balancesByCode($this->f))->toBe([
            '1000' => ['debit' => 4200, 'credit' => 4200],
            '4000' => ['debit' => 4200, 'credit' => 4200],
        ]);
});

it('dates the reversal into the next open period when the original period is closed (D3)', function () {
    $original = cashSale($this->f, 100, '2026-03-10');
    $this->f->setPeriodStatus('2026-03-10', 'closed');
    $this->f->setPeriodStatus('2026-04-10', 'soft_closed');

    $reversal = ($this->reverse)($original->id);

    expect($reversal->journal_date->format('Y-m-d'))->toBe('2026-05-01');
});

it('rejects a reversal dated before the original and a second reversal', function () {
    $original = cashSale($this->f, 100, '2026-03-10');

    expect(fn () => ($this->reverse)($original->id, '2026-03-09'))
        ->toThrow(fn (PostingRejected $e) => expect($e->errorCode)->toBe('reversal_before_original'));

    $reversal = ($this->reverse)($original->id, '2026-04-02');
    expect($reversal->fiscal_period_id)->toBe($this->f->period('2026-04-02')->id);

    expect(fn () => ($this->reverse)($original->id))
        ->toThrow(fn (DomainRuleViolation $e) => expect($e->errorCode)->toBe('journal_already_reversed'))
        ->and(fn () => ($this->reverse)($reversal->id))
        ->toThrow(fn (DomainRuleViolation $e) => expect($e->errorCode)->toBe('journal_not_reversible'));
});
