<?php

declare(strict_types=1);

namespace Tests\Support;

use App\Actions\Fiscal\ClosePeriod;
use App\Actions\Fiscal\Inputs\ClosePeriodInput;
use App\Actions\Fiscal\YearEndClose;
use App\Actions\Ledger\CreateJournalDraft;
use App\Actions\Ledger\Inputs\JournalDraftInput;
use App\Actions\Ledger\Inputs\PostJournalInput;
use App\Actions\Ledger\PostJournal;
use App\Domain\Ledger\DraftLine;
use App\Domain\Ledger\JournalType;
use App\Models\Ledger\Journal;
use App\Models\Organisation\Company;
use App\Support\Actor;
use App\Support\ActorType;
use DateTimeImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Chart extras and posting helpers for the report tests. The LedgerFixture chart gets report subtypes, and
 * the accounts the cash flow and balance sheet rules look at: fixed assets, accumulated depreciation, a loan,
 * share capital, other income and expense, cost of sales and depreciation expense.
 */
final class ReportScenario
{
    /** @var array<string, string> contact name → id */
    public array $contacts = [];

    /** Who posts; the fixture's owner unless a test says otherwise. */
    public ?Actor $actor = null;

    private bool $monthsClosed = false;

    public function __construct(public readonly LedgerFixture $f) {}

    public static function create(string $slug = 'acme'): self
    {
        $s = new self(LedgerFixture::create('USD', $slug));
        $s->chart();

        return $s;
    }

    public function chart(): void
    {
        $f = $this->f;
        foreach ([
            '1000' => ['Cash & Equivalents', true], '1100' => ['Current Assets', true], '1300' => ['Prepayments', true],
            '2000' => ['Current Liabilities', true], '3000' => ['Retained Earnings', false], '4000' => ['Operating Revenue', false],
            '5000' => ['Operating Expense', false],
        ] as $code => [$subtype, $manual]) {
            DB::table('accounts')->where('id', $f->account((string) $code))->update(['account_subtype' => $subtype, 'allow_manual_journals' => $manual]);
        }
        foreach ([
            ['1500', 'Fixed assets', 'asset', 'debit', 'fixed_asset', 'Property, Plant & Equipment'],
            ['1510', 'Accumulated depreciation', 'asset', 'credit', 'accum_depr', 'Contra Asset'],
            ['2200', 'Long-term loan', 'liability', 'credit', 'none', 'Non-current Liabilities'],
            ['3100', 'Share capital', 'equity', 'credit', 'none', 'Contributed Capital'],
            ['4800', 'Interest income', 'income', 'credit', 'none', 'Other Income'],
            ['5100', 'Cost of sales', 'expense', 'debit', 'none', 'Direct Costs'],
            ['6500', 'Depreciation expense', 'expense', 'debit', 'none', 'Operating Expense'],
            ['6800', 'Interest expense', 'expense', 'debit', 'none', 'Other Expense'],
        ] as [$code, $name, $type, $normal, $control, $subtype]) {
            $f->accounts[$code] = (string) Str::uuid7();
            DB::table('accounts')->insert([
                'id' => $f->accounts[$code], 'tenant_id' => $f->tenantId, 'company_id' => $f->companyId, 'code' => $code, 'name' => $name,
                'account_type' => $type, 'account_subtype' => $subtype, 'normal_balance' => $normal, 'control_type' => $control,
                'currency_policy' => 'base_only', 'allow_manual_journals' => true,
            ]);
        }
    }

    public function contact(string $name, string $kind = 'customer'): string
    {
        return $this->contacts[$name] ??= (function () use ($name, $kind): string {
            $id = (string) Str::uuid7();
            DB::table('contacts')->insert(['id' => $id, 'tenant_id' => $this->f->tenantId, 'company_id' => $this->f->companyId, 'kind' => $kind, 'code' => strtoupper(substr(md5($name), 0, 6)), 'name' => $name, 'default_currency' => 'USD']);

            return $id;
        })();
    }

    public function company(): Company
    {
        return Company::query()->findOrFail($this->f->companyId);
    }

    /**
     * Posts a balanced journal. Lines: [code, debit, credit] or [code, debit, credit, contact name or dims array].
     *
     * @param  list<array{0: string, 1: int, 2: int, 3?: array<int, string>|string|null}>  $lines
     */
    public function post(string $date, array $lines, JournalType $type = JournalType::Manual, ?string $periodId = null): Journal
    {
        $draft = [];
        foreach ($lines as $l) {
            $extra = $l[3] ?? null;
            $draft[] = new DraftLine(
                $this->f->account($l[0]), debit: $l[1], credit: $l[2],
                dims: is_array($extra) ? $extra : [], contactId: is_string($extra) ? $this->contact($extra, in_array($l[0], ['2000'], true) ? 'supplier' : 'customer') : null,
            );
        }
        $journal = app(CreateJournalDraft::class)->handle($this->actor ?? $this->f->actor, new JournalDraftInput($this->f->companyId, $type, new DateTimeImmutable($date), $draft, 'REF', 'memo', $periodId));

        return app(PostJournal::class)->handle($this->actor ?? $this->f->actor, new PostJournalInput($journal->id, null));
    }

    /** The hand-calculated January/February story of the report tests (amounts in cents). */
    public function story(): void
    {
        $this->post('2026-01-05', [['1000', 100_000, 0], ['3100', 0, 100_000]]);
        $this->post('2026-01-10', [['1500', 30_000, 0], ['1000', 0, 30_000]]);
        $this->post('2026-01-15', [['1000', 50_000, 0], ['2200', 0, 50_000]]);
        $this->post('2026-01-20', [['1100', 40_000, 0, 'Customer A'], ['4000', 0, 40_000]]);
        $this->post('2026-01-25', [['1000', 20_000, 0], ['4000', 0, 20_000]]);
        $this->post('2026-01-28', [['5100', 12_000, 0], ['2000', 0, 12_000, 'Supplier S']]);
        $this->post('2026-01-30', [['6500', 1_000, 0], ['1510', 0, 1_000]]);
        $this->post('2026-01-31', [['5000', 5_000, 0], ['1000', 0, 5_000]]);
        $this->post('2026-02-05', [['1000', 25_000, 0], ['1100', 0, 25_000, 'Customer A']]);
        $this->post('2026-02-10', [['6800', 2_000, 0], ['1000', 0, 2_000]]);
        $this->post('2026-02-12', [['1000', 500, 0], ['4800', 0, 500]]);
        $this->post('2026-02-15', [['1000', 3_000, 0], ['1100', 0, 3_000, 'Customer B']]);
        $this->post('2026-02-20', [['2000', 4_000, 0, 'Supplier T'], ['1000', 0, 4_000]]);
    }

    public function signer(): Actor
    {
        return new Actor(ActorType::User, $this->f->userId, $this->f->tenantId, $this->f->companyId, hasSigningGrant: true);
    }

    /** Closes the twelve months of 2026 (once), then runs the year-end close, which may be run again. */
    public function closeYear(): ?Journal
    {
        if (! $this->monthsClosed) {
            foreach (range(1, 12) as $m) {
                app(ClosePeriod::class)->handle($this->signer(), new ClosePeriodInput($this->f->period(sprintf('2026-%02d-15', $m))->id));
            }
            $this->monthsClosed = true;
        }

        return app(YearEndClose::class)->handle($this->signer(), $this->f->period('2026-01-15')->fiscal_year_id);
    }

    public function periodId(string $date): string
    {
        return $this->f->period($date)->id;
    }
}
