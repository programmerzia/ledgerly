<?php

declare(strict_types=1);

use Database\Seeders\ChartLine as L;

/**
 * Non-profit starter chart (plan 2.1): fund balances (designated, restricted, endowment), donations
 * and grants split by restriction, deferred grant income, grants and pledges receivable, and costs
 * split into program, management and fundraising. The Fund dimension tags restricted income and spending;
 * no fund means unrestricted. The year-end close posts the result to the accumulated surplus with the
 * same fund on each line, so each fund's balance survives the close (D13). Transfers between funds and
 * releases from restriction are journals.
 * Two-digit lines are group headers; see Database\Seeders\ChartLine for the line format.
 */
return [
    'code' => 'non_profit',
    // posting key → the line that plays that role, set on the company when the template is applied.
    'posting_accounts' => [
        'ar_control' => '1200', 'ap_control' => '2000', 'tax_output' => '2100', 'tax_input' => '1250',
        'wht_payable' => '2120', 'retained_earnings' => '3900', 'fx_realised' => '4900',
        'fx_realised_loss' => '6900', 'fx_unrealised' => '4800', 'fx_unrealised_loss' => '6800',
        'rounding' => '6890', 'suspense' => '9999',
    ],
    'dimensions' => [
        ['code' => 'FUND', 'name' => 'Fund', 'values' => [['RESTRICTED', 'With donor restrictions'], ['DESIGNATED', 'Board designated'], ['ENDOWMENT', 'Endowment']]],
    ],
    'name' => 'Non-profit',
    'country' => null,
    'standard' => 'Fund accounting (not-for-profit)',
    'lines' => [
        // Assets
        L::make('10', 'Cash and bank', 'asset', 'Cash & Equivalents'),
        L::make('1000', 'Cash on hand', 'asset', 'Cash & Equivalents', '10', control: 'cash', description: 'Petty cash and cash floats held on the premises.'),
        L::make('1010', 'Main bank account', 'asset', 'Bank Account', '10', control: 'bank', description: 'Operating account for unrestricted funds. Add one account per further bank account and currency.'),
        L::make('1020', 'Restricted funds bank account', 'asset', 'Bank Account', '10', control: 'bank', description: 'Holds money received for a restricted purpose, kept apart from operating funds.'),

        L::make('12', 'Receivables and prepayments', 'asset', 'Current Assets'),
        L::make('1200', 'Accounts receivable (AR control)', 'asset', 'Current Assets', '12', control: 'ar', currency: 'any', description: 'Control account for amounts due from customers and service users. Posted by sales documents and receipts, not by manual journals.'),
        L::make('1210', 'Grants receivable', 'asset', 'Current Assets', '12', currency: 'any', description: 'Grant income earned but not yet received.'),
        L::make('1220', 'Pledges and donations receivable', 'asset', 'Current Assets', '12', currency: 'any'),
        L::make('1230', 'Prepayments and deposits', 'asset', 'Prepayments', '12', currency: 'any'),
        L::make('1250', 'Input tax recoverable (VAT/GST)', 'asset', 'Tax Receivable', '12', control: 'tax', currency: 'any', description: 'Tax paid on purchases that can be recovered from the tax authority.'),

        L::make('15', 'Non-current assets', 'asset', 'Non-current Assets'),
        L::make('1500', 'Property and equipment', 'asset', 'Property, Plant & Equipment', '15', control: 'fixed_asset', currency: 'any', description: 'Property, plant and equipment at cost.'),
        L::make('1510', 'Accumulated depreciation', 'asset', 'Contra Asset', '15', control: 'accum_depr', normal: 'credit', description: 'Depreciation charged to date on property and equipment. Carries a credit balance.'),
        L::make('1600', 'Long-term investments', 'asset', 'Non-current Assets', '15', description: 'Investments held for more than a year, including endowment investments.'),

        // Liabilities
        L::make('20', 'Payables and accruals', 'liability', 'Current Liabilities'),
        L::make('2000', 'Accounts payable (AP control)', 'liability', 'Current Liabilities', '20', control: 'ap', currency: 'any', description: 'Control account for supplier balances. Posted by purchase documents and payments, not by manual journals.'),
        L::make('2010', 'Accrued expenses', 'liability', 'Current Liabilities', '20'),
        L::make('2020', 'Payroll liabilities', 'liability', 'Payroll Liabilities', '20', description: 'Wages, social security and payroll taxes owed to employees and authorities.'),
        L::make('2030', 'Funds held for others', 'liability', 'Current Liabilities', '20', description: 'Money collected or held on behalf of other organisations.'),

        L::make('21', 'Tax liabilities', 'liability', 'Tax Payable'),
        L::make('2100', 'Output tax payable (VAT/GST)', 'liability', 'Tax Payable', '21', control: 'tax', currency: 'any', description: 'Sales tax collected from customers and owed to the tax authority.'),
        L::make('2120', 'Withholding tax payable', 'liability', 'Tax Payable', '21', control: 'tax', currency: 'any', description: 'Tax withheld from supplier payments and owed to the tax authority.'),

        L::make('22', 'Deferred grants and loans', 'liability', 'Current Liabilities'),
        L::make('2200', 'Deferred grant income', 'liability', 'Deferred Income', '22', currency: 'any', description: 'Grant money received in advance of the period or conditions it relates to.'),
        L::make('2210', 'Loans payable', 'liability', 'Non-current Liabilities', '22'),

        L::make('9999', 'Suspense account', 'liability', 'Clearing', control: 'suspense', description: 'Holds unidentified items until they are investigated and reclassified. Should be zero at period end.'),

        // Funds
        L::make('30', 'Funds', 'equity', 'Fund Balances'),
        L::make('3000', 'Designated funds', 'equity', 'Fund Balances', '30', description: 'Unrestricted money the board has set aside for a purpose.'),
        L::make('3100', 'Restricted funds', 'equity', 'Fund Balances', '30', description: 'Money restricted by donors or grant agreements to a purpose or a period.'),
        L::make('3200', 'Endowment funds', 'equity', 'Fund Balances', '30', description: 'Gifts held permanently, with only the income spent.'),
        L::make('3900', 'Accumulated surplus (unrestricted funds)', 'equity', 'Retained Earnings', '30', control: 'retained_earnings', description: 'Accumulated unrestricted surplus. The year-end close posts the result of the year here.'),

        // Income
        L::make('40', 'Contributions and grants', 'income', 'Operating Revenue'),
        L::make('4000', 'Donations (unrestricted)', 'income', 'Operating Revenue', '40', currency: 'any'),
        L::make('4010', 'Donations (restricted)', 'income', 'Operating Revenue', '40', currency: 'any'),
        L::make('4020', 'In-kind donations', 'income', 'Operating Revenue', '40', description: 'Donated goods and services.'),
        L::make('4100', 'Grant income (unrestricted)', 'income', 'Operating Revenue', '40', currency: 'any'),
        L::make('4110', 'Grant income (restricted)', 'income', 'Operating Revenue', '40', currency: 'any'),

        L::make('42', 'Earned income', 'income', 'Operating Revenue'),
        L::make('4200', 'Program service fees', 'income', 'Operating Revenue', '42', currency: 'any'),
        L::make('4300', 'Fundraising events', 'income', 'Operating Revenue', '42', currency: 'any'),

        L::make('48', 'Other income', 'income', 'Other Income'),
        L::make('4800', 'Unrealised FX gain', 'income', 'Other Income', '48', description: 'Gains from revaluing open foreign-currency balances at period end.'),
        L::make('4810', 'Investment income', 'income', 'Other Income', '48', currency: 'any', description: 'Interest and dividends.'),
        L::make('4900', 'Realised FX gain', 'income', 'Other Income', '48', description: 'Gains from settling foreign-currency invoices and bills.'),

        // Costs and expenses
        L::make('50', 'Program costs', 'expense', 'Direct Costs'),
        L::make('5000', 'Program supplies and materials', 'expense', 'Direct Costs', '50', currency: 'any'),
        L::make('5100', 'Grants and aid to beneficiaries', 'expense', 'Direct Costs', '50', currency: 'any'),
        L::make('5200', 'Sub-grants to partners', 'expense', 'Direct Costs', '50', currency: 'any'),
        L::make('5300', 'Program staff costs', 'expense', 'Direct Costs', '50', description: 'Salaries and payroll costs of staff who deliver programs.'),
        L::make('5400', 'Program travel and field costs', 'expense', 'Direct Costs', '50', currency: 'any'),

        L::make('60', 'Management, general and fundraising', 'expense', 'Operating Expense'),
        L::make('6000', 'Salaries & wages', 'expense', 'Operating Expense', '60', description: 'Management, administration and fundraising staff.'),
        L::make('6010', 'Employer payroll costs', 'expense', 'Operating Expense', '60', description: 'Employer taxes, social security and benefits.'),
        L::make('6100', 'Rent expense', 'expense', 'Operating Expense', '60', currency: 'any'),
        L::make('6200', 'Utilities & communication', 'expense', 'Operating Expense', '60', currency: 'any'),
        L::make('6210', 'Insurance', 'expense', 'Operating Expense', '60', currency: 'any'),
        L::make('6300', 'Bank charges & fees', 'expense', 'Operating Expense', '60', currency: 'any'),
        L::make('6400', 'Office supplies & stationery', 'expense', 'Operating Expense', '60', currency: 'any'),
        L::make('6410', 'Audit and professional fees', 'expense', 'Operating Expense', '60', currency: 'any'),
        L::make('6430', 'Travel & meetings', 'expense', 'Operating Expense', '60', currency: 'any'),
        L::make('6500', 'Depreciation expense', 'expense', 'Operating Expense', '60'),
        L::make('6600', 'Fundraising costs', 'expense', 'Operating Expense', '60', currency: 'any', description: 'Appeals, events and donor communications.'),

        L::make('68', 'Other expenses', 'expense', 'Other Expense'),
        L::make('6800', 'Unrealised FX loss', 'expense', 'Other Expense', '68', description: 'Losses from revaluing open foreign-currency balances at period end.'),
        L::make('6810', 'Interest expense', 'expense', 'Other Expense', '68', currency: 'any'),
        L::make('6890', 'Rounding differences', 'expense', 'Other Expense', '68', description: 'Receives the rounding residue that foreign-currency documents leave.'),
        L::make('6900', 'Realised FX loss', 'expense', 'Other Expense', '68', description: 'Losses from settling foreign-currency invoices and bills.'),
    ],
];
