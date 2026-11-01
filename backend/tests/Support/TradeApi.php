<?php

declare(strict_types=1);

namespace Tests\Support;

use App\Models\Platform\User;
use Illuminate\Support\Facades\DB;

/** HTTP helpers for the sales and purchase tests; used with MakesApiCalls (the world, people, tokens). */
trait TradeApi
{
    public TradeFixture $t;

    public User $accountant;

    public User $approver;

    public User $owner;

    public User $assistant;

    /** The world plus the trade fixture and one person per role that matters. */
    protected function setUpTrade(): void
    {
        $this->setUpWorld();
        $this->t = TradeFixture::prepare($this->f);
        $this->accountant = $this->person('Ann Accountant', ['Accountant']);
        $this->approver = $this->person('Abe Approver', ['Approver']);
        $this->owner = $this->person('Olga Owner', ['Owner']);
        $this->assistant = $this->person('Sam Sales', ['Sales Assistant']);
    }

    /** Creates a draft as $by (the accountant) and answers its JSON.
     * @param  array<string, mixed>  $body
     * @return array<string, mixed>
     */
    protected function draftDoc(string $path, array $body, ?User $by = null): array
    {
        return $this->asPerson($by ?? $this->accountant)->postJson($this->api($path), $body, $this->key())->assertCreated()->json('data');
    }

    /**
     * Submits as $by with a signing grant; with no workflow the document posts.
     *
     * @return array<string, mixed>
     */
    protected function submitDoc(string $path, string $id, ?User $by = null): array
    {
        return $this->asPerson($by ?? $this->accountant, signing: true)->postJson($this->api("{$path}/{$id}/submit"), [], $this->key())->assertOk()->json('data');
    }

    /**
     * Draft and post in one go.
     *
     * @param  array<string, mixed>  $body
     * @return array<string, mixed>
     */
    protected function postedDoc(string $path, array $body, ?User $by = null): array
    {
        $doc = $this->draftDoc($path, $body, $by);

        return $this->submitDoc($path, $doc['id'], $by);
    }

    /** One approver step for every document of $type. */
    protected function workflow(string $type): void
    {
        $this->asPerson($this->owner)->postJson($this->api('approval-workflows'), [
            'document_type' => $type, 'name' => "All {$type}s", 'source' => 'any', 'min_amount' => 0, 'steps' => [['role' => 'Approver']],
        ], $this->key())->assertCreated();
    }

    /**
     * A settlement body. Allocations: [document id, amount] pairs.
     *
     * @param  list<array{0: string, 1: int}>  $allocations
     * @param  array<string, mixed>  $extra
     * @return array<string, mixed>
     */
    protected function settlementBody(string $kind, string $contact, int $amount, array $allocations = [], string $date = '2026-03-20', string $cash = '1000', array $extra = []): array
    {
        return [
            'kind' => $kind, 'contact_id' => $contact, 'cash_account_id' => $this->f->account($cash), 'settlement_date' => $date, 'amount_fc' => $amount,
            'reference' => 'BANK-1',
            'allocations' => array_map(fn (array $a): array => ['invoice_id' => $a[0], 'amount_fc' => $a[1]], $allocations),
            ...$extra,
        ];
    }

    /**
     * Draft and post a settlement as the accountant (no workflow).
     *
     * @param  list<array{0: string, 1: int}>  $allocations
     * @param  array<string, mixed>  $extra
     * @return array<string, mixed>
     */
    protected function postedSettlement(string $kind, string $contact, int $amount, array $allocations = [], string $date = '2026-03-20', string $cash = '1000', array $extra = []): array
    {
        return $this->postedDoc('settlements', $this->settlementBody($kind, $contact, $amount, $allocations, $date, $cash, $extra));
    }

    /** @return array<string, mixed> */
    protected function document(string $path, string $id): array
    {
        return $this->asPerson($this->owner)->getJson($this->api("{$path}/{$id}"))->assertOk()->json('data');
    }

    /** Net debit balance of an account code over every posted journal line (base). */
    protected function balance(string $code): int
    {
        return $this->inTenant(fn (): int => (int) DB::table('journal_lines')->where('account_id', $this->f->account($code))->sum(DB::raw('debit - credit')));
    }

    /** A posted customer invoice with one 10%-VAT line: `$price` becomes `$price × 1.1`. @param array<string, mixed> $extra @return array<string, mixed> */
    protected function sale(int $price = 10000, string $date = '2026-03-15', array $extra = []): array
    {
        return $this->postedDoc('invoices', $this->t->body($this->t->customer, [[$price, '1', 'VAT10']], $date, $extra));
    }

    /** @param list<array{0: string, 1: int}> $items bill id and amount @return array<string, mixed> */
    protected function runBody(array $items, string $date = '2026-03-25'): array
    {
        return ['cash_account_id' => $this->f->account('1000'), 'run_date' => $date, 'reference' => 'Weekly', 'items' => array_map(fn (array $i): array => ['invoice_id' => $i[0], 'amount_fc' => $i[1]], $items)];
    }

    /**
     * Posted bills: S1 5,000 and 3,000 (no tax), S2 10,000 withheld at 10% (open 9,000).
     *
     * @return list<array<string, mixed>>
     */
    protected function threeBills(): array
    {
        $t = $this->t;

        return [
            $this->postedDoc('bills', $t->body($t->supplier, [[5000, '1', null, '0', '5000']], '2026-03-01')),
            $this->postedDoc('bills', $t->body($t->supplier, [[3000, '1', null, '0', '5000']], '2026-03-02')),
            $this->postedDoc('bills', $t->body($t->supplierWht, [[10000, '1', null, '0', '5000']], '2026-03-03')),
        ];
    }
}
