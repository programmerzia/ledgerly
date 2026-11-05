<?php

declare(strict_types=1);

namespace App\Queries\Reports;

use App\Domain\Shared\Fx;
use App\Http\Support\Json;
use App\Support\Reports\ReportRunner;

/**
 * Tax return by tax code and period: TOTALS PER TAX CODE only, for sales (output tax) and purchases (input tax). The docs
 * define no jurisdiction boxes, so none are invented here.
 *
 * Source: the posted sales and purchase journals dated in the period (originals and their reversals alike, so a reversed
 * document nets out; a reversal counts negative). Credit and debit notes count negative as well. Per journal, the document's
 * lines give the base net per tax code (each line converted at the document rate as the posting converts it) and the tax per
 * code from `invoice_lines.tax_detail` (the journal's tax lines carry no tax code). The document's total tax in base is the
 * ledger's tax line, so any rounding residue of the per-code split goes to the code with the most tax and the sum over codes
 * always equals the tax accounts. Tax of a non-recoverable purchase code is cost, not input tax: it is shown on its row
 * (`recoverable` false) but left out of the tax totals and the net payable.
 */
final class TaxReturn
{
    public function __construct(private readonly ReportRunner $runner) {}

    /**
     * Self-assessed tax on bills (reverse charge, D15 item 4), by tax code: the base it applies to, the output booked on it and the input
     * claimed (recoverable codes only; the rest is cost). Debit notes and reversals count negative. It is a separate section so a country
     * pack can later map it to its own boxes; `net` (output less input) is also part of `net_tax_payable`.
     *
     * @param  array<string, array{id: string, code: string, name: string, kind: string, recoverable: bool}>  $codes
     * @return array{rows: list<array{tax_code: array<string, string>|null, recoverable: bool, base: int, output: int, input: int}>, base: int, output: int, input: int, net: int}
     */
    private function reverseCharge(ReportParams $p, array $codes): array
    {
        $acc = [];
        $rows = $this->runner->db()->cursor(<<<'SQL'
            SELECT (j.reversal_of_id IS NOT NULL) AS is_reversal, i.kind::text AS kind, i.fx_rate, l.line_total_fc, l.reverse_charge_fc, l.tax_code_id
            FROM journals j JOIN invoices i ON i.id = j.source_id AND j.source_type = i.kind::text JOIN invoice_lines l ON l.invoice_id = i.id
            WHERE j.company_id = ? AND j.status IN ('posted', 'reversed') AND j.journal_date BETWEEN ? AND ? AND l.reverse_charge_fc > 0
              AND i.kind::text IN ('purchase_bill', 'debit_note')
            SQL, [$p->companyId, (string) $p->from, $p->to]);
        foreach ($rows as $r) {
            $factor = ($r->is_reversal ? -1 : 1) * ($r->kind === 'debit_note' ? -1 : 1);
            $key = (string) $r->tax_code_id;
            $tax = Fx::toBase((int) $r->reverse_charge_fc, (string) $r->fx_rate, 2, 2);
            $acc[$key] ??= ['base' => 0, 'output' => 0, 'input' => 0];
            $acc[$key]['base'] += $factor * Fx::toBase((int) $r->line_total_fc, (string) $r->fx_rate, 2, 2);
            $acc[$key]['output'] += $factor * $tax;
            $acc[$key]['input'] += ($codes[$key]['recoverable'] ?? false) ? $factor * $tax : 0;
        }
        $list = [];
        $total = ['base' => 0, 'output' => 0, 'input' => 0];
        foreach ($acc as $key => $v) {
            $code = $codes[$key] ?? null;
            $list[] = [
                'tax_code' => $code === null ? null : ['id' => $code['id'], 'code' => $code['code'], 'name' => $code['name'], 'kind' => $code['kind']],
                'recoverable' => $code['recoverable'] ?? false, ...$v,
            ];
            foreach ($total as $k => $_) {
                $total[$k] += $v[$k];
            }
        }
        usort($list, fn (array $a, array $b): int => strcmp((string) ($a['tax_code']['code'] ?? ''), (string) ($b['tax_code']['code'] ?? '')));

        return ['rows' => $list, ...$total, 'net' => $total['output'] - $total['input']];
    }

    /** @return array<string, mixed> */
    public function __invoke(ReportParams $p): array
    {
        $cur = $p->currency;
        ['codes' => $codes, 'acc' => $acc] = $this->compute($p);

        return $this->present($p, $codes, $acc, $cur);
    }

    /**
     * The documents behind one row of the tax return (3c.21): the journals of the period that carry the tax code (`none`
     * for lines without one) on the sales or the purchases side, each with its net and tax. The nets and taxes add up to
     * exactly the row, because the row is built from the same list. A reversal is listed as its own entry with the sign
     * the return gives it.
     *
     * @return array<string, mixed>
     */
    public function documents(ReportParams $p, string $side, string $taxCodeId): array
    {
        $cur = $p->currency;
        ['codes' => $codes, 'detail' => $detail] = $this->compute($p);
        $key = $taxCodeId === 'none' ? '' : $taxCodeId;
        $items = array_values(array_filter($detail[$side][$key] ?? [], fn (array $i): bool => $i['net'] !== 0 || $i['tax'] !== 0));
        usort($items, fn (array $a, array $b): int => [$a['date'], $a['journal_number']] <=> [$b['date'], $b['journal_number']]);
        $code = $codes[$key] ?? null;

        return [
            'report' => 'tax_return_documents', 'currency' => $cur, 'from' => $p->from, 'to' => $p->to, 'side' => $side,
            'tax_code' => $code === null ? null : ['id' => (string) $code['id'], 'code' => (string) $code['code'], 'name' => (string) $code['name'], 'kind' => (string) $code['kind']],
            'recoverable' => $side === 'sales' ? null : (bool) ($code['recoverable'] ?? true),
            'documents' => array_map(fn (array $i): array => [
                'document' => ['type' => $i['kind'], 'id' => $i['invoice_id'], 'number' => $i['number']],
                'journal' => ['id' => $i['journal_id'], 'number' => $i['journal_number']],
                'date' => $i['date'], 'is_reversal' => $i['reversal'],
                'net' => Json::money($i['net'], $cur), 'tax' => Json::money($i['tax'], $cur),
            ], $items),
            'totals' => ['net' => Json::money(array_sum(array_column($items, 'net')), $cur), 'tax' => Json::money(array_sum(array_column($items, 'tax')), $cur)],
        ];
    }

    /**
     * @return array{codes: array<string, array{id: string, code: string, name: string, kind: string, recoverable: bool}>, acc: array{sales: array<string, array{net: int, tax: int}>, purchases: array<string, array{net: int, tax: int}>}, detail: array<string, array<string, list<array<string, mixed>>>>}
     */
    private function compute(ReportParams $p): array
    {
        $db = $this->runner->db();
        $codes = [];
        foreach ($db->select('SELECT id, code, name, kind::text AS kind, is_recoverable FROM tax_codes WHERE company_id = ?', [$p->companyId]) as $c) {
            $codes[(string) $c->id] = ['id' => (string) $c->id, 'code' => (string) $c->code, 'name' => (string) $c->name, 'kind' => (string) $c->kind, 'recoverable' => (bool) $c->is_recoverable];
        }

        $rows = $db->cursor(<<<'SQL'
            SELECT j.id AS journal_id, j.number AS journal_number, j.journal_date, i.id AS invoice_id, i.number AS invoice_number, (j.reversal_of_id IS NOT NULL) AS is_reversal, i.kind::text AS kind, i.fx_rate, i.tax_total_fc,
              l.line_total_fc, l.tax_code_id, l.tax_detail::text AS tax_detail
            FROM journals j JOIN invoices i ON i.id = j.source_id AND j.source_type = i.kind::text JOIN invoice_lines l ON l.invoice_id = i.id
            WHERE j.company_id = ? AND j.status IN ('posted', 'reversed') AND j.journal_date BETWEEN ? AND ?
            ORDER BY j.id, l.line_no
            SQL, [$p->companyId, (string) $p->from, $p->to]);

        /** @var array<string, array{sales: bool, factor: int, rate: string, net: array<string, int>, taxFc: array<string, int>, meta: array<string, mixed>}> $docs */
        $docs = [];
        foreach ($rows as $r) {
            $sales = in_array($r->kind, ['sales_invoice', 'credit_note'], true);
            $docs[$r->journal_id] ??= [
                'sales' => $sales, 'rate' => (string) $r->fx_rate, 'net' => [], 'taxFc' => [],
                'meta' => ['kind' => (string) $r->kind, 'invoice_id' => (string) $r->invoice_id, 'number' => $r->invoice_number, 'journal_id' => (string) $r->journal_id, 'journal_number' => $r->journal_number, 'date' => (string) $r->journal_date, 'reversal' => (bool) $r->is_reversal],
                'factor' => ($r->is_reversal ? -1 : 1) * (in_array($r->kind, ['credit_note', 'debit_note'], true) ? -1 : 1),
            ];
            $key = $r->tax_code_id === null ? '' : (string) $r->tax_code_id;
            $docs[$r->journal_id]['net'][$key] = ($docs[$r->journal_id]['net'][$key] ?? 0) + Fx::toBase((int) $r->line_total_fc, (string) $r->fx_rate, 2, 2);
            /** @var array<string, int> $detail */
            $detail = json_decode((string) $r->tax_detail, true, 8, JSON_THROW_ON_ERROR);
            foreach ($detail as $codeId => $amount) {
                $docs[$r->journal_id]['taxFc'][$codeId] = ($docs[$r->journal_id]['taxFc'][$codeId] ?? 0) + (int) $amount;
            }
        }

        /** @var array{sales: array<string, array{net: int, tax: int}>, purchases: array<string, array{net: int, tax: int}>} $acc */
        $acc = ['sales' => [], 'purchases' => []];
        /** @var array<string, array<string, array<string, array<string, mixed>>>> $perDoc side → tax code ('' = none) → one entry per document */
        $perDoc = ['sales' => [], 'purchases' => []];
        foreach ($docs as $d) {
            $side = $d['sales'] ? 'sales' : 'purchases';
            foreach ($d['net'] as $key => $net) {
                $acc[$side][$key] ??= ['net' => 0, 'tax' => 0];
                $acc[$side][$key]['net'] += $d['factor'] * $net;
                $perDoc[$side][$key][$d['meta']['journal_id']] = $d['meta'] + ['net' => $d['factor'] * $net, 'tax' => 0];
            }
            // Tax that reaches the tax account: all of it on sales, only the recoverable codes on purchases.
            $counted = array_filter($d['taxFc'], fn (string $id): bool => $d['sales'] || ($codes[$id]['recoverable'] ?? false), ARRAY_FILTER_USE_KEY);
            $target = Fx::toBase(array_sum($counted), $d['rate'], 2, 2);
            $base = [];
            foreach ($d['taxFc'] as $id => $fc) {
                $base[$id] = Fx::toBase($fc, $d['rate'], 2, 2);
            }
            $residue = $target - array_sum(array_intersect_key($base, $counted));
            if ($residue !== 0 && $counted !== []) {
                arsort($counted);
                $base[(string) array_key_first($counted)] += $residue;
            }
            foreach ($base as $id => $amount) {
                $acc[$side][$id] ??= ['net' => 0, 'tax' => 0];
                $acc[$side][$id]['tax'] += $d['factor'] * $amount;
                $perDoc[$side][$id][$d['meta']['journal_id']] = ($perDoc[$side][$id][$d['meta']['journal_id']] ?? $d['meta'] + ['net' => 0]) + ['tax' => 0];
                $perDoc[$side][$id][$d['meta']['journal_id']]['tax'] += $d['factor'] * $amount;
            }
        }

        return ['codes' => $codes, 'acc' => $acc, 'detail' => array_map(fn (array $bySide): array => array_map(fn (array $byDoc): array => array_values($byDoc), $bySide), $perDoc)];
    }

    /**
     * @param  array<string, array{id: string, code: string, name: string, kind: string, recoverable: bool}>  $codes
     * @param  array{sales: array<string, array{net: int, tax: int}>, purchases: array<string, array{net: int, tax: int}>}  $acc
     * @return array<string, mixed>
     */
    private function present(ReportParams $p, array $codes, array $acc, string $cur): array
    {

        $out = [];
        $payable = 0;
        foreach (['sales' => 'output', 'purchases' => 'input'] as $side => $label) {
            $list = [];
            $net = 0;
            $tax = 0;
            foreach ($acc[$side] as $key => $v) {
                if ($v['net'] === 0 && $v['tax'] === 0) {
                    continue;
                }
                $code = $key === '' ? null : ($codes[$key] ?? null);
                $counts = $side === 'sales' || ($code['recoverable'] ?? true);
                $list[] = [
                    'tax_code' => $code === null ? null : ['id' => $code['id'], 'code' => $code['code'], 'name' => $code['name'], 'kind' => $code['kind']],
                    'recoverable' => $side === 'sales' ? null : $counts,
                    'net' => Json::money($v['net'], $cur),
                    'tax' => Json::money($v['tax'], $cur),
                ];
                $net += $v['net'];
                $tax += $counts ? $v['tax'] : 0;
            }
            usort($list, fn (array $a, array $b): int => strcmp((string) ($a['tax_code']['code'] ?? ''), (string) ($b['tax_code']['code'] ?? '')));
            $out[$side] = ['tax_type' => $label, 'rows' => $list, 'totals' => ['net' => Json::money($net, $cur), 'tax' => Json::money($tax, $cur)]];
            $payable += ($side === 'sales' ? 1 : -1) * $tax;
        }

        $reverse = $this->reverseCharge($p, $codes);
        $payable += $reverse['net'];

        return ['report' => 'tax_return', 'currency' => $cur, 'from' => $p->from, 'to' => $p->to] + $out + [
            'reverse_charge' => [
                'rows' => array_map(fn (array $r): array => [
                    'tax_code' => $r['tax_code'], 'recoverable' => $r['recoverable'], 'base' => Json::money($r['base'], $cur),
                    'output' => Json::money($r['output'], $cur), 'input' => Json::money($r['input'], $cur),
                ], $reverse['rows']),
                'totals' => [
                    'base' => Json::money($reverse['base'], $cur), 'output' => Json::money($reverse['output'], $cur),
                    'input' => Json::money($reverse['input'], $cur), 'net' => Json::money($reverse['net'], $cur),
                ],
            ],
            'net_tax_payable' => Json::money($payable, $cur),
        ];
    }
}
