<?php

declare(strict_types=1);

namespace App\Queries\Trade;

use App\Models\Trade\Invoice;
use Illuminate\Database\DatabaseManager;
use stdClass;

/**
 * What has been applied to a document: posted settlements allocated to it, and credit notes applied to it or from it.
 * Reversed ones are left out, since they no longer count towards what is settled.
 */
final class ListDocumentPayments
{
    public function __construct(private readonly DatabaseManager $db) {}

    /** @return list<array{type: string, id: string, kind: string, number: string|null, date: string, amount_fc: int, amount: int, fx_gain_loss: int}> */
    public function __invoke(Invoice $doc): array
    {
        $c = $this->db->connection();
        $settlements = $c->table('settlement_allocations as a')->join('settlements as s', 's.id', '=', 'a.settlement_id')
            ->where('a.invoice_id', $doc->id)->where('s.status', 'posted')
            ->select(['s.id', 's.kind', 's.number', 's.settlement_date as date', 'a.amount_fc', 'a.amount', 'a.fx_gain_loss'])->get();
        $select = ['ca.id', 'other.kind', 'other.number', 'ca.applied_on as date', 'ca.amount_fc', 'ca.amount', 'ca.fx_gain_loss'];
        $received = $c->table('credit_applications as ca')->join('invoices as other', 'other.id', '=', 'ca.note_id')
            ->where('ca.invoice_id', $doc->id)->whereNull('ca.reversed_at')->select($select)->get();
        $given = $c->table('credit_applications as ca')->join('invoices as other', 'other.id', '=', 'ca.invoice_id')
            ->where('ca.note_id', $doc->id)->whereNull('ca.reversed_at')->select($select)->get();

        $row = fn (string $type, stdClass $r): array => [
            'type' => $type, 'id' => (string) $r->id, 'kind' => (string) $r->kind, 'number' => $r->number === null ? null : (string) $r->number,
            'date' => substr((string) $r->date, 0, 10), 'amount_fc' => (int) $r->amount_fc, 'amount' => (int) $r->amount, 'fx_gain_loss' => (int) $r->fx_gain_loss,
        ];

        /** @var list<array{type: string, id: string, kind: string, number: string|null, date: string, amount_fc: int, amount: int, fx_gain_loss: int}> $rows */
        $rows = collect($settlements)->map(fn (stdClass $r) => $row('settlement', $r))
            ->concat(collect($received)->concat($given)->map(fn (stdClass $r) => $row('credit_application', $r)))
            ->sortBy('date')->values()->all();

        return $rows;
    }
}
