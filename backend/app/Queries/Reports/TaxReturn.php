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

    /** @return array<string, mixed> */
    public function __invoke(ReportParams $p): array
    {
        $db = $this->runner->db();
        $cur = $p->currency;
        $codes = [];
        foreach ($db->select('SELECT id, code, name, kind::text AS kind, is_recoverable FROM tax_codes WHERE company_id = ?', [$p->companyId]) as $c) {
            $codes[(string) $c->id] = ['id' => (string) $c->id, 'code' => (string) $c->code, 'name' => (string) $c->name, 'kind' => (string) $c->kind, 'recoverable' => (bool) $c->is_recoverable];
        }

        $rows = $db->cursor(<<<'SQL'
            SELECT j.id AS journal_id, (j.reversal_of_id IS NOT NULL) AS is_reversal, i.kind::text AS kind, i.fx_rate, i.tax_total_fc,
              l.line_total_fc, l.tax_code_id, l.tax_detail::text AS tax_detail
            FROM journals j JOIN invoices i ON i.id = j.source_id AND j.source_type = i.kind::text JOIN invoice_lines l ON l.invoice_id = i.id
            WHERE j.company_id = ? AND j.status IN ('posted', 'reversed') AND j.journal_date BETWEEN ? AND ?
            ORDER BY j.id, l.line_no
            SQL, [$p->companyId, (string) $p->from, $p->to]);

        /** @var array<string, array{sales: bool, factor: int, rate: string, net: array<string, int>, taxFc: array<string, int>}> $docs */
        $docs = [];
        foreach ($rows as $r) {
            $sales = in_array($r->kind, ['sales_invoice', 'credit_note'], true);
            $docs[$r->journal_id] ??= [
                'sales' => $sales, 'rate' => (string) $r->fx_rate, 'net' => [], 'taxFc' => [],
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
        foreach ($docs as $d) {
            $side = $d['sales'] ? 'sales' : 'purchases';
            foreach ($d['net'] as $key => $net) {
                $acc[$side][$key] ??= ['net' => 0, 'tax' => 0];
                $acc[$side][$key]['net'] += $d['factor'] * $net;
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
            }
        }

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

        return ['report' => 'tax_return', 'currency' => $cur, 'from' => $p->from, 'to' => $p->to] + $out + ['net_tax_payable' => Json::money($payable, $cur)];
    }
}
