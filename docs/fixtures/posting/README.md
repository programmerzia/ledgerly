# Posting parity fixtures

Shared by `frontend/tests/posting-parity.test.ts` (runs `frontend/src/mock/PostingRules.ts`) and
`backend/tests/Unit/Trade/PostingParityTest.php` (runs `App\Domain\Trade\*Posting`). Both must produce the
same lines and totals (13 §9). Generated from the mock builders; if a rule changes, regenerate from the mock
and review the diff by hand.

One file per rule: `invoice.json`, `credit_note.json` (key `credit_note`), `bill.json`, `debit_note.json` (key `debit_note`; amounts positive, the rules mirror the parent), `settlement.json`, `revaluation.json`, `depreciation.json`.
Each is an array of cases:

```jsonc
{
  "name": "plain_sale_usd",          // unique per file; used as the test name
  "input": {
    "settings": { "posting_accounts": { "ar_control": "...", "ap_control": "...", "tax_output": "...",
      "tax_input": "...", "fx_realised": "...", "fx_unrealised": "...", "rounding": "...", "wht_payable": "..." } },
    "invoice" | "bill" | "settlement" | "revaluation" | "depreciation": { ... }  // mock document shape, only fields the rule reads
    // settlement: also "bank_account_id"; depreciation: also "depreciation_expense_account", "accumulated_depreciation_account"
  },
  "expected": {
    "journal": { "journal_type", "journal_date", "reference", "memo", "source_type", "source_id" },
    "lines": [ { "account_ref", "debit", "credit", "currency", "fx_rate", "amount_fc", "dimensions",
                 "description", "contact_ref"?, "tax_code_ref"? } ],
    "totals": { "debit": 0, "credit": 0 }
  }
}
```

A refused case has `"expected": { "error": "<code>" }`: both sides must refuse with that code.
`realised_fx.json` is hand-calculated (not generated) and has its own shape, input and
`{ carried_base, fx_gain_loss }`.

Conventions: money is integer minor units (assumes base and foreign currencies share 2 decimals);
`fx_rate` is base units per foreign unit; account, contact and tax-code refs are opaque strings;
`amount_fc` is signed (debit positive); `-0` is normalised to `0`.
Document totals (`line_total_fc`, `tax_total_fc`, `total_fc`, `wht_amount_fc`, allocation base amounts and FX
gain/loss) are inputs: the posting rules do not compute tax or allocations; `realisedFx` computes the last two. Tax in the generated inputs came
from `calculateDocumentTax` (D2).
