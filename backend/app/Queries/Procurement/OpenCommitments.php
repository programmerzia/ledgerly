<?php

declare(strict_types=1);

namespace App\Queries\Procurement;

use App\Domain\Procurement\Quantity;
use App\Domain\Trade\LineAmount;
use App\Domain\Trade\PostingSupport;
use App\Models\Procurement\PurchaseOrder;

/**
 * Open commitments by supplier and account (D14: reporting only). For every open order line, what is not billed yet,
 * valued net of tax at the order's price and converted at the order's rate. An open revision counts only once approved.
 */
final class OpenCommitments
{
    public function __construct(private readonly OrderLineFigures $figures) {}

    /** @return array{rows: list<array{contact_id: string, contact_name: string, account_id: string, account_code: string, account_name: string, currency: string, open_fc: int, open_base: int}>, total_base: int} */
    public function __invoke(string $companyId, ?string $contactId = null): array
    {
        $orders = PurchaseOrder::query()->where('company_id', $companyId)->whereIn('status', ['approved', 'partly_received', 'received'])
            ->when($contactId !== null, fn ($q) => $q->where('contact_id', $contactId))
            ->with(['lines', 'contact:id,name'])->get();
        $figures = $this->figures->forOrders(array_values($orders->pluck('id')->all()));
        $accounts = ReportLabels::accounts($companyId);

        $groups = [];
        foreach ($orders as $order) {
            foreach ($order->lines as $line) {
                $open = $figures[$line->id]->notBilled();
                if (Quantity::isZero($open)) {
                    continue;
                }
                $fc = LineAmount::net($open, $line->unit_price_fc);
                $key = $order->contact_id.'|'.$line->account_id.'|'.$order->currency;
                $groups[$key] ??= [
                    'contact_id' => $order->contact_id, 'contact_name' => $order->contact->name, 'account_id' => $line->account_id,
                    'account_code' => $accounts[$line->account_id]['code'] ?? '', 'account_name' => $accounts[$line->account_id]['name'] ?? '',
                    'currency' => $order->currency, 'open_fc' => 0, 'open_base' => 0,
                ];
                $groups[$key]['open_fc'] += $fc;
                $groups[$key]['open_base'] += PostingSupport::toBase($fc, (string) $order->fx_rate);
            }
        }
        $rows = array_values($groups);
        usort($rows, fn (array $a, array $b) => [$a['contact_name'], $a['account_code'], $a['currency']] <=> [$b['contact_name'], $b['account_code'], $b['currency']]);

        return ['rows' => $rows, 'total_base' => array_sum(array_column($rows, 'open_base'))];
    }
}
