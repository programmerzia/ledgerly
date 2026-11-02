import type { Violation } from './errors';

/** Plain-language text for a posting violation. Switches on `code`; falls back to the server's own message. */
export function describeViolation(v: Violation): string {
  switch (v.code) {
    case 'journal_empty':
      return 'A journal needs at least two lines.';
    case 'amount_out_of_range':
      return 'Amounts cannot be negative. Use the other column to reduce an account.';
    case 'line_both_sides':
      return 'A line cannot have both a debit and a credit.';
    case 'account_other_company':
      return 'This account belongs to another company.';
    case 'account_not_postable':
      return 'Header accounts cannot be posted to. Pick a detail account.';
    case 'account_inactive':
      return 'This account is inactive.';
    case 'currency_not_allowed':
      return 'This account does not allow that currency.';
    case 'fx_rate_missing':
      return 'There is no exchange rate for this line.';
    case 'control_account_direct':
      return 'Receivable, payable and bank accounts cannot take manual journals unless the account allows it.';
    case 'contact_required':
      return 'A customer or supplier is required for a receivable or payable account.';
    case 'dimension_required':
      return 'A required dimension (such as branch) is missing on this line.';
    case 'dimension_forbidden':
      return 'This dimension is not allowed on this account.';
    case 'dimension_value_invalid':
      return 'This dimension value is not valid for this company.';
    case 'dimension_inactive':
      return 'This dimension value is inactive.';
    case 'journal_unbalanced':
      return 'Debits and credits do not match, so this cannot be posted.';
    case 'journal_unbalanced_fc':
      return 'Foreign-currency amounts must add up to zero when every line shares one currency.';
    case 'period_missing':
      return 'No accounting period covers this date.';
    case 'date_outside_period':
      return 'The date is outside the chosen period.';
    case 'period_soft_closed':
      return 'This period is soft-closed. Only a Finance Manager or Owner can post to it.';
    case 'period_closed':
      return 'This period is closed, so nothing can be posted to it.';
    case 'period_adjustment_only':
      return 'This period only takes closing and adjustment journals.';
    case 'period_adjustment_forbidden':
      return 'You do not have permission to post adjustments.';
    case 'reversal_before_original':
      return 'A reversal cannot be dated before the journal it cancels.';
    default:
      return v.message || v.code;
  }
}
