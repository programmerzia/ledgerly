<?php

declare(strict_types=1);

namespace Tests\Support;

use App\Models\Platform\User;
use Illuminate\Support\Facades\DB;

/** HTTP helpers for the procurement tests; used with MakesApiCalls and TradeApi. */
trait ProcurementApi
{
    public ?User $viewer = null;

    /**
     * A requisition body. Lines: [estimated unit price, quantity?, description?, account code?].
     *
     * @param  list<array{0: int, 1?: string, 2?: string, 3?: string}>  $lines
     * @param  array<string, mixed>  $extra
     * @return array<string, mixed>
     */
    protected function reqBody(array $lines = [[5000, '2']], string $date = '2026-03-10', array $extra = []): array
    {
        return [
            'requisition_date' => $date, 'memo' => 'Office needs',
            'lines' => array_map(fn (array $l): array => [
                'description' => $l[2] ?? 'Paper', 'quantity' => $l[1] ?? '1', 'estimated_unit_price' => $l[0], 'account_id' => $this->f->account($l[3] ?? '5000'),
            ], $lines),
            ...$extra,
        ];
    }

    /**
     * An order body. Lines: [unit price, quantity?, tax code?, account code?].
     *
     * @param  list<array{0: int, 1?: string, 2?: string|null, 3?: string}>  $lines
     * @param  array<string, mixed>  $extra
     * @return array<string, mixed>
     */
    protected function orderBody(?string $contact = null, array $lines = [[10000, '10']], string $date = '2026-03-12', array $extra = []): array
    {
        return [
            'contact_id' => $contact ?? $this->t->supplier, 'order_date' => $date, 'reference' => 'Quote 9', 'memo' => 'Stock',
            'lines' => array_map(function (array $l): array {
                $line = ['description' => 'Widget', 'quantity' => $l[1] ?? '1', 'unit_price_fc' => $l[0], 'account_id' => $this->f->account($l[3] ?? '5000')];
                if (($l[2] ?? null) !== null) {
                    $line['tax_code_id'] = $this->t->tax[$l[2]];
                }

                return $line;
            }, $lines),
            ...$extra,
        ];
    }

    /**
     * Drafts and submits an order as the accountant; with no workflow the signing grant approves it at once.
     *
     * @param  array<string, mixed>|null  $body
     * @return array<string, mixed>
     */
    protected function approvedOrder(?array $body = null): array
    {
        $order = $this->draftDoc('purchase-orders', $body ?? $this->orderBody());

        return $this->submitDoc('purchase-orders', $order['id']);
    }

    /** @return array<string, mixed> */
    protected function approvedRequisition(?array $body = null): array
    {
        $pr = $this->draftDoc('purchase-requisitions', $body ?? $this->reqBody());

        return $this->submitDoc('purchase-requisitions', $pr['id']);
    }

    /**
     * Records a receipt as the accountant. Lines: [order line id, quantity].
     *
     * @param  list<array{0: string, 1: string}>  $lines
     * @param  array<string, mixed>  $extra
     * @return \Illuminate\Testing\TestResponse<\Illuminate\Http\JsonResponse>
     */
    protected function receive(string $orderId, array $lines, string $date = '2026-03-20', array $extra = [], ?User $by = null)
    {
        return $this->asPerson($by ?? $this->accountant)->postJson($this->api('goods-receipts'), [
            'purchase_order_id' => $orderId, 'receipt_date' => $date, 'reference' => 'DN-1',
            'lines' => array_map(fn (array $l): array => ['order_line_id' => $l[0], 'quantity' => $l[1]], $lines),
            ...$extra,
        ], $this->key());
    }

    /**
     * Makes a bill draft from an order as the accountant.
     *
     * @param  array<string, mixed>  $extra
     * @return array<string, mixed>
     */
    protected function billOf(string $orderId, array $extra = ['issue_date' => '2026-03-25']): array
    {
        return $this->asPerson($this->accountant)->postJson($this->api("purchase-orders/{$orderId}/bill"), $extra, $this->key())->assertCreated()->json('data');
    }

    /** Submits a bill as the accountant (PIN), with an optional override reason, and answers the response. */
    protected function submitBill(string $billId, ?string $overrideReason = null, ?User $by = null)
    {
        return $this->asPerson($by ?? $this->accountant, signing: true)
            ->postJson($this->api("bills/{$billId}/submit"), $overrideReason === null ? [] : ['match_override_reason' => $overrideReason], $this->key());
    }

    /**
     * A revision body that restates every line of $order, with $changes[line index] overriding fields, or `null` removing the line.
     *
     * @param  array<string, mixed>  $order  an order as the API answered it, with lines
     * @param  array<int, array<string, mixed>|null>  $changes
     * @param  array<string, mixed>  $extra
     * @return array<string, mixed>
     */
    protected function reviseBody(array $order, array $changes = [], array $extra = []): array
    {
        $lines = [];
        foreach ($order['lines'] as $i => $line) {
            if (array_key_exists($i, $changes) && $changes[$i] === null) {
                continue;
            }
            $lines[] = [
                'id' => $line['id'], 'description' => $line['description'], 'quantity' => $line['quantity'],
                'unit_price_fc' => $line['unit_price_fc']['amount'], 'account_id' => $line['account_id'], 'tax_code_id' => $line['tax_code_id'],
                ...($changes[$i] ?? []),
            ];
        }

        return ['reason' => 'Supplier changed the price', 'lines' => $lines, ...$extra];
    }

    /** A person who can only read. */
    protected function viewerUser(): User
    {
        return $this->viewer ??= $this->person('Vic Viewer', ['Viewer']);
    }

    /** Company settings for the match: a tolerance, require_purchase_order. @param array<string, mixed> $values */
    protected function procurementSettings(array $values): void
    {
        $this->inTenant(fn () => DB::table('company_settings')->where('company_id', $this->f->companyId)->update($values));
    }

    /** @return int how many journals the company has */
    protected function journalCount(): int
    {
        return (int) $this->inTenant(fn () => DB::table('journals')->where('company_id', $this->f->companyId)->count());
    }
}
