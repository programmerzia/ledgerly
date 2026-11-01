<?php

declare(strict_types=1);

namespace Tests\Support;

use App\Actions\Fx\Inputs\ExchangeRateInput;
use App\Actions\Fx\RecordExchangeRate;
use App\Actions\Ledger\Inputs\RecordJournalInput;
use App\Actions\Ledger\RecordJournal;
use App\Domain\Ledger\DraftLine;
use App\Domain\Ledger\JournalDraft;
use App\Domain\Ledger\JournalType;
use App\Models\Ledger\Journal;
use App\Support\Actor;
use DateTimeImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/** Shared setup for the FX tests: the unrealised-FX account in the company settings, foreign postings and rates. */
final class FxScenario
{
    public const string C1 = '11111111-1111-4111-8111-111111111111';

    public const string C2 = '22222222-2222-4222-8222-222222222222';

    public const string C3 = '33333333-3333-4333-8333-333333333333';

    public static function prepare(LedgerFixture $f): void
    {
        foreach ([['7900', 'Unrealised FX', 'income', 'credit', 'none', 'base_only', null], ['1500', 'Equipment', 'asset', 'debit', 'fixed_asset', 'any', null]] as [$code, $name, $type, $normal, $control, $policy, $fixed]) {
            $f->accounts[$code] = (string) Str::uuid7();
            DB::table('accounts')->insert([
                'id' => $f->accounts[$code], 'tenant_id' => $f->tenantId, 'company_id' => $f->companyId, 'code' => $code, 'name' => $name,
                'account_type' => $type, 'normal_balance' => $normal, 'control_type' => $control, 'currency_policy' => $policy, 'fixed_currency' => $fixed,
            ]);
        }
        DB::table('company_settings')->insert([
            'tenant_id' => $f->tenantId, 'company_id' => $f->companyId,
            'posting_accounts' => json_encode(['fx_unrealised' => $f->account('7900')], JSON_THROW_ON_ERROR),
        ]);
    }

    /** A foreign line: $base minor units of base for $fc minor units of $currency at $rate; debit when positive, credit when negative. */
    public static function fc(LedgerFixture $f, string $code, string $currency, int $fc, string $rate, int $base, ?string $contact = null): DraftLine
    {
        return new DraftLine($f->account($code), max($base, 0), max(-$base, 0), $currency, $rate, $fc, contactId: $contact);
    }

    /** @param list<DraftLine> $lines */
    public static function post(LedgerFixture $f, JournalType $type, array $lines, string $date): Journal
    {
        return app(RecordJournal::class)->handle(
            Actor::system($f->tenantId, $f->companyId),
            new RecordJournalInput(new JournalDraft($f->companyId, $type, new DateTimeImmutable($date), $lines, 'T', 'test')),
        );
    }

    public static function rate(LedgerFixture $f, string $from, string $date, string $rate, string $to = 'USD'): void
    {
        app(RecordExchangeRate::class)->handle(Actor::system($f->tenantId, $f->companyId), new ExchangeRateInput($f->companyId, $from, $to, $date, $rate));
    }

    /** @return list<array{account: string, debit: int, credit: int, currency: string, contact: string|null}> */
    public static function lines(LedgerFixture $f, string $journalId): array
    {
        $codes = array_flip($f->accounts);

        return DB::table('journal_lines')->where('journal_id', $journalId)->orderBy('line_no')->get()
            ->map(fn ($l) => ['account' => (string) $codes[$l->account_id], 'debit' => (int) $l->debit, 'credit' => (int) $l->credit, 'currency' => $l->currency, 'contact' => $l->contact_id])
            ->all();
    }

    /** Base carrying amount (debit − credit) per account code over all posted/reversed journals. */
    public static function base(LedgerFixture $f, string $code): int
    {
        return (int) DB::table('journal_lines as l')->join('journals as j', 'j.id', '=', 'l.journal_id')
            ->where('l.account_id', $f->account($code))->whereIn('j.status', ['posted', 'reversed'])->sum(DB::raw('l.debit - l.credit'));
    }
}
