import type { Violation } from './errors';
import { describeViolation } from './violations';

/**
 * Plain-language text for the codes sales and purchase documents and settlements add to the ledger's own
 * (`describeViolation`). Switches on `code`; anything unknown falls back to the ledger texts, then the server's message.
 */
function tradeText(v: Violation): string | null {
  switch (v.code) {
    case 'posting_account_missing':
      // The server names which account (`posting_accounts.rounding`, `ar_control`, ...) in its own message.
      return v.message || 'A posting account is not set for this company yet. Set it in the company settings before posting.';
    case 'line_account_missing':
      return 'Every line needs an account, or an item or customer that supplies one.';
    case 'line_price_missing':
      return 'A line is missing its price.';
    case 'document_lines_missing':
      return 'Add at least one line.';
    case 'document_not_editable':
      return 'Only a draft can be edited.';
    case 'document_not_postable':
      return 'This document cannot be posted in its current state.';
    case 'document_kind_fixed':
      return 'The kind of a document cannot be changed after it is created.';
    case 'tax_code_invalid':
      return 'This tax code has no rate for the document date.';
    case 'contact_inactive':
      return 'This customer is inactive.';
    case 'contact_invalid':
    case 'contact_kind_invalid':
      return 'This contact cannot be used on this kind of document.';
    case 'item_inactive':
      return 'An item on this document is inactive.';
    case 'item_currency_mismatch':
      return 'An item is priced in a different currency from the document.';
    case 'fx_rate_missing':
      return 'There is no exchange rate for this currency on this date. Enter one on the document or add it on the FX rates screen.';
    case 'fx_rate_invalid':
      return 'There is no valid exchange rate for this document. Enter one or add the rate on the FX rates screen.';
    case 'related_document_invalid':
      return 'The invoice this credit note refers to cannot be used.';
    case 'related_document_not_posted':
      return 'A credit note can only refer to an invoice that is already posted.';
    case 'credit_exceeds_original':
      return 'The credit notes against this invoice would add up to more than the invoice itself.';
    case 'credit_exceeds_available':
      return 'That is more than the credit still available.';
    case 'credit_not_posted':
      return 'Only a posted credit can be applied.';
    case 'credit_source_invalid':
      return 'This credit cannot be applied to that invoice.';
    case 'application_date_too_early':
      return 'The date is earlier than the documents being matched.';
    case 'allocation_exceeds_open_amount':
      return 'An amount is more than what is still owed on that invoice.';
    case 'allocation_exceeds_settlement':
      return 'The amounts applied add up to more than the money received.';
    case 'allocation_contact_mismatch':
      return 'An invoice belongs to a different customer.';
    case 'allocation_currency_mismatch':
      return 'An invoice is in a different currency from the receipt.';
    case 'allocation_duplicate':
      return 'The same invoice is listed twice.';
    case 'allocation_target_invalid':
    case 'allocation_target_not_posted':
      return 'An invoice cannot be paid yet: it must be posted and open.';
    case 'cash_account_invalid':
      return 'The bank account chosen cannot be used for this receipt.';
    case 'bank_account_currency_mismatch':
      return 'The bank account is in a different currency from the receipt.';
    case 'bank_account_inactive':
      return 'That bank account is inactive.';
    case 'invoice_has_settlements':
      return 'Money has been applied to this invoice. Reverse those receipts or credit applications first.';
    case 'invoice_already_reversed':
    case 'settlement_already_reversed':
      return 'This has already been reversed.';
    case 'invoice_not_reversible':
    case 'settlement_not_reversible':
      return 'This cannot be reversed in its current state.';
    case 'settlement_credit_applied':
      return 'Part of this receipt has already been applied to other invoices. Undo those first.';
    case 'amount_invalid':
      return 'The amount must be more than zero.';
    default:
      return null;
  }
}

/**
 * Purchase orders, receipts and the three-way match. Written in purchase words already, so these never go through
 * `toPurchases` (which would turn "receipt" into "payment").
 */
export const MATCH_OVERRIDABLE_CODES: readonly string[] = ['match_price_mismatch', 'match_quantity_exceeds_received', 'purchase_order_required'];
export const MATCH_FIXED_CODES: readonly string[] = ['bill_order_supplier_mismatch', 'bill_order_currency_mismatch', 'bill_order_not_open'];
export const isMatchCode = (code: string): boolean => MATCH_OVERRIDABLE_CODES.includes(code) || MATCH_FIXED_CODES.includes(code) || code === 'match_override_forbidden' || code === 'match_override_self_forbidden';

function procurementText(v: Violation): string | null {
  switch (v.code) {
    case 'match_price_mismatch':
      return 'The price is not the price on the purchase order, and the difference is more than your company allows.';
    case 'match_quantity_exceeds_received':
      return 'More is being billed than has been received on the purchase order. Record the receipt first, or lower the quantity.';
    case 'purchase_order_required':
      return 'Your company only pays bills that come from a purchase order. Create the bill from the order, or ask someone who can pass it with a reason.';
    case 'bill_order_supplier_mismatch':
      return 'The purchase order is for a different supplier from this bill.';
    case 'bill_order_currency_mismatch':
      return 'The purchase order is in a different currency from this bill.';
    case 'bill_order_not_open':
      return 'The purchase order is no longer open for bills.';
    case 'match_override_forbidden':
      return 'You do not have permission to pass a bill that does not match its order. Ask someone with the override permission.';
    case 'match_override_self_forbidden':
      return 'You made this bill, so someone else has to pass it. Ask a colleague with the override permission.';
    case 'order_not_open':
      return 'This order is no longer open for that.';
    case 'order_has_open_revision':
      return 'This order has a revision in progress. Void or finish it first.';
    case 'order_not_cancellable':
      return 'This order can no longer be cancelled.';
    case 'order_has_unbilled_receipts':
      return 'Something received on this order is not billed yet. Bill it or reverse the receipt first.';
    case 'order_nothing_to_bill':
      return 'Everything on this order is already on a bill.';
    case 'order_line_unknown':
    case 'revision_line_unknown':
      return 'A line is not on this order.';
    case 'receipt_quantity_exceeds_open':
      return 'This is more than is still open on the order.';
    case 'receipt_line_invalid':
      return 'This line cannot be received. Check that it is on the order once and has a quantity.';
    case 'receipt_already_billed':
      return 'This quantity is already on a bill. Reverse the bill first.';
    case 'receipt_already_reversed':
      return 'This receipt has already been reversed.';
    case 'requisition_not_approved':
      return 'Only an approved requisition can become an order.';
    case 'requisition_line_invalid':
    case 'requisition_line_converted':
      return 'A line is already on an order, or is not on this requisition.';
    case 'requisition_line_empty':
      return 'Every line needs an item or a description.';
    case 'revision_item_fixed':
      return 'This line already has receipts or bills, so its item cannot change.';
    case 'revision_quantity_below_used':
      return 'This quantity cannot go below what has been received or billed.';
    case 'revision_line_in_use':
      return 'A line with receipts or bills cannot be removed.';
    default:
      return null;
  }
}

export function describeTradeViolation(v: Violation): string {
  return procurementText(v) ?? tradeText(v) ?? describeViolation(v);
}

/** Sales words to purchase words, for the texts written for invoices, credit notes, customers and receipts. */
const toPurchases = (t: string): string =>
  t
    .replace(/credit notes/g, 'debit notes')
    .replace(/credit note/g, 'debit note')
    .replace(/invoices/g, 'bills')
    .replace(/invoice/g, 'bill')
    .replace(/Invoices/g, 'Bills')
    .replace(/customer/g, 'supplier')
    .replace(/receipt/g, 'payment')
    .replace(/\b(a|an|A|An) (?=(?:bills?|debit notes?|suppliers?|payments?)\b)/g, (m, art: string) => `${/^[A-Z]/.test(art) ? 'A' : 'a'} `);

/** The same verdicts for a purchase document or payment: the words are bills, debit notes, suppliers and payments. */
export function describePurchaseViolation(v: Violation): string {
  const own = procurementText(v);
  if (own !== null) return own;
  const t = tradeText(v);
  return t === null ? describeViolation(v) : toPurchases(t);
}

/** A 422/409/403 body's violations as one sentence list, in plain language. */
export const describeTradeViolations = (vs: Violation[]): string => vs.map(describeTradeViolation).join(' ');
