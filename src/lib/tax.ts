import { TaxCode } from '@/types';
import { roundHalfUp } from './format';

export interface TaxLineInput {
  line_no?: number;
  amount_fc?: number;
  line_total_fc?: number;
  tax_code_id?: string;
  [key: string]: any;
}

export interface TaxCalculationResult {
  lineTaxes: number[];
  taxTotal: number;
  totalTax: number;
  taxesByCode: Record<string, number>;
  lines: Array<{ tax_amount_fc: number }>;
}

/**
 * Calculates document sales or purchase tax according to IAS/ERP standards (D2).
 *
 * Modes:
 * - 'document_per_code' (default):
 *   Line taxes are calculated unrounded, summed per tax code, each sum is rounded once (HALF_UP),
 *   and allocated back to lines by largest remainder.
 * - 'line':
 *   Each line tax is rounded independently (HALF_UP), and summed.
 */
export function calculateDocumentTax(
  lines: TaxLineInput[],
  taxCodes: TaxCode[],
  roundingMode: 'document_per_code' | 'line' = 'document_per_code'
): TaxCalculationResult {
  const taxCodeMap = new Map(taxCodes.map((tc) => [tc.id, tc]));
  const lineTaxes = new Array<number>(lines.length).fill(0);
  const taxesByCode: Record<string, number> = {};

  if (roundingMode === 'line') {
    let taxTotal = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line.tax_code_id) continue;
      const tc = taxCodeMap.get(line.tax_code_id);
      if (!tc || !tc.rate) continue;

      const lineAmt = line.amount_fc ?? line.line_total_fc ?? 0;
      const lineTax = roundHalfUp(lineAmt * tc.rate);
      lineTaxes[i] = lineTax;
      taxTotal += lineTax;
      taxesByCode[tc.id] = (taxesByCode[tc.id] || 0) + lineTax;
    }
    return {
      lineTaxes,
      taxTotal,
      totalTax: taxTotal,
      taxesByCode,
      lines: lineTaxes.map((t) => ({ tax_amount_fc: t })),
    };
  }

  // 'document_per_code' mode (Default - D2)
  // Group line indices by tax_code_id
  const groups = new Map<string, number[]>();
  for (let i = 0; i < lines.length; i++) {
    const codeId = lines[i].tax_code_id;
    if (!codeId) continue;
    const tc = taxCodeMap.get(codeId);
    if (!tc || !tc.rate) continue;

    if (!groups.has(codeId)) groups.set(codeId, []);
    groups.get(codeId)!.push(i);
  }

  let taxTotal = 0;

  for (const [codeId, indices] of groups.entries()) {
    const tc = taxCodeMap.get(codeId)!;
    const unrounded: number[] = [];
    let groupSumUnrounded = 0;

    for (const idx of indices) {
      const lineAmt = lines[idx].amount_fc ?? lines[idx].line_total_fc ?? 0;
      const lineUnrounded = lineAmt * tc.rate;
      unrounded.push(lineUnrounded);
      groupSumUnrounded += lineUnrounded;
    }

    const groupTotalRounded = roundHalfUp(groupSumUnrounded);
    taxesByCode[codeId] = groupTotalRounded;
    taxTotal += groupTotalRounded;

    // Largest remainder allocation
    const integerAllocations = unrounded.map((u) => Math.floor(u));
    const remainders = unrounded.map((u, i) => ({
      indexInGroup: i,
      globalIndex: indices[i],
      remainder: u - integerAllocations[i],
    }));

    const sumFloor = integerAllocations.reduce((s, a) => s + a, 0);
    const leftover = groupTotalRounded - sumFloor;

    // Sort by remainder descending, tie-breaker: keep earlier line order
    remainders.sort((a, b) => b.remainder - a.remainder);

    const bonusSet = new Set(
      remainders.slice(0, Math.max(0, leftover)).map((r) => r.indexInGroup)
    );

    for (let i = 0; i < indices.length; i++) {
      const globalIdx = indices[i];
      const alloc = integerAllocations[i] + (bonusSet.has(i) ? 1 : 0);
      lineTaxes[globalIdx] = alloc;
    }
  }

  return {
    lineTaxes,
    taxTotal,
    totalTax: taxTotal,
    taxesByCode,
    lines: lineTaxes.map((t) => ({ tax_amount_fc: t })),
  };
}
