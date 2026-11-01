<?php

declare(strict_types=1);

use App\Actions\Ledger\SetAccountDimensionRules;
use App\Domain\Ledger\DimensionRule;
use App\Domain\Ledger\DraftLine;
use App\Domain\Ledger\JournalStatus;
use App\Domain\Ledger\PostingRejected;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Support\LedgerFixture;

/* Account dimension rules enforced through the PostJournal Action (13 §9): forbidden, required, valid. */

beforeEach(function (): void {
    $this->grant('accounts.manage');
    $this->f = LedgerFixture::create();
    $this->dimension = (string) Str::uuid7();
    $this->fund = (string) Str::uuid7();
    DB::table('dimensions')->insert(['id' => $this->dimension, 'tenant_id' => $this->f->tenantId, 'company_id' => $this->f->companyId, 'code' => 'FUND', 'name' => 'Fund', 'position' => 1]);
    DB::table('dimension_values')->insert(['id' => $this->fund, 'tenant_id' => $this->f->tenantId, 'company_id' => $this->f->companyId, 'dimension_id' => $this->dimension, 'code' => 'RESTRICTED', 'name' => 'Restricted']);
    // Cash must not carry a fund; Sales must.
    app(SetAccountDimensionRules::class)->handle($this->f->actor, $this->f->account('1000'), [$this->dimension => DimensionRule::Forbidden]);
    app(SetAccountDimensionRules::class)->handle($this->f->actor, $this->f->account('4000'), [$this->dimension => DimensionRule::Required]);
});

it('refuses a forbidden dimension and a missing required one, with every violation and its line', function (): void {
    $draft = draftJournal($this->f, [
        new DraftLine($this->f->account('1000'), debit: 900, dims: [1 => $this->fund]),
        new DraftLine($this->f->account('4000'), credit: 900),
    ]);

    try {
        postJournal($this->f, $draft);
        $this->fail('The dimension rules must block the posting.');
    } catch (PostingRejected $e) {
        expect(array_map(fn ($v) => [$v->code, $v->lineNo], $e->violations))->toBe([['dimension_forbidden', 1], ['dimension_required', 2]]);
    }

    expect($draft->fresh()?->status)->toBe(JournalStatus::Draft)
        ->and(DB::table('account_period_balances')->count())->toBe(0)
        ->and(DB::table('journals')->whereNotNull('number')->count())->toBe(0);
});

it('posts when the dimensions follow the rules', function (): void {
    $posted = postJournal($this->f, draftJournal($this->f, [
        new DraftLine($this->f->account('1000'), debit: 900),
        new DraftLine($this->f->account('4000'), credit: 900, dims: [1 => $this->fund]),
    ]));

    expect($posted->status)->toBe(JournalStatus::Posted)
        ->and(DB::table('account_period_balances')->where('account_id', $this->f->account('4000'))->value('dim1_value_id'))->toBe($this->fund);
});
