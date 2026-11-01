<?php

declare(strict_types=1);

use Database\Seeders\ChartLine as L;

/**
 * IFRS for SMEs starter chart (plan 2.1). General trading and services company, current and
 * non-current layout, with the control and posting accounts the ledger looks up (AR, AP, tax,
 * cash and bank, fixed assets, retained earnings, FX results, rounding, suspense).
 * Two-digit lines are group headers; see Database\Seeders\ChartLine for the line format.
 */
return [
    'code' => 'ifrs_sme',
    'name' => 'IFRS for SMEs',
    'country' => null,
    'standard' => 'IFRS for SMEs',
    'lines' => [
        // Assets
        L::make('10', 'Cash and bank', 'asset', 'Cash & Equivalents'),
        L::make('1000', 'Cash on hand', 'asset', 'Cash & Equivalents', '10', control: 'cash', description: 'Petty cash and cash floats held on the premises.'),
        L::make('1010', 'Main bank account', 'asset', 'Bank Account', '10', control: 'bank', description: 'Primary operating bank account. Add one account per further bank account and currency.'),
        L::make('1090', 'Cash in transit (clearing)', 'asset', 'Cash & Equivalents', '10', control: 'cash', currency: 'any', description: 'Receipts and transfers recorded but not yet banked.'),

        L::make('12', 'Receivables and prepayments', 'asset', 'Current Assets'),
        L::make('1200', 'Accounts receivable (AR control)', 'asset', 'Current Assets', '12', control: 'ar', currency: 'any', description: 'Control account for customer balances. Posted by sales documents and receipts, not by manual journals.'),
        L::make('1210', 'Allowance for doubtful accounts', 'asset', 'Contra Asset', '12', normal: 'credit', description: 'Estimated uncollectible receivables. Carries a credit balance.'),
        L::make('1220', 'Prepayments and deposits', 'asset', 'Prepayments', '12', currency: 'any'),
        L::make('1250', 'Input tax recoverable (VAT/GST)', 'asset', 'Tax Receivable', '12', control: 'tax', currency: 'any', description: 'Tax paid on purchases that can be recovered from the tax authority.'),

        L::make('13', 'Inventories', 'asset', 'Inventory'),
        L::make('1300', 'Inventory', 'asset', 'Inventory', '13', currency: 'any', description: 'Goods held for sale.'),
        L::make('1310', 'Raw materials and supplies', 'asset', 'Inventory', '13', currency: 'any'),

        L::make('15', 'Non-current assets', 'asset', 'Non-current Assets'),
        L::make('1500', 'Fixed assets (at cost)', 'asset', 'Property, Plant & Equipment', '15', control: 'fixed_asset', currency: 'any', description: 'Property, plant and equipment at cost.'),
        L::make('1510', 'Accumulated depreciation', 'asset', 'Contra Asset', '15', control: 'accum_depr', normal: 'credit', description: 'Depreciation charged to date on fixed assets. Carries a credit balance.'),
        L::make('1600', 'Intangible assets', 'asset', 'Intangible Assets', '15'),

        // Liabilities
        L::make('20', 'Payables and accruals', 'liability', 'Current Liabilities'),
        L::make('2000', 'Accounts payable (AP control)', 'liability', 'Current Liabilities', '20', control: 'ap', currency: 'any', description: 'Control account for supplier balances. Posted by purchase documents and payments, not by manual journals.'),
        L::make('2010', 'Accrued expenses', 'liability', 'Current Liabilities', '20'),
        L::make('2020', 'Deferred income', 'liability', 'Deferred Income', '20', currency: 'any', description: 'Customer deposits and amounts billed before the goods or services are delivered.'),
        L::make('2030', 'Payroll liabilities', 'liability', 'Payroll Liabilities', '20', description: 'Wages, social security and payroll taxes owed to employees and authorities.'),

        L::make('21', 'Tax liabilities', 'liability', 'Tax Payable'),
        L::make('2100', 'Output tax payable (VAT/GST)', 'liability', 'Tax Payable', '21', control: 'tax', currency: 'any', description: 'Sales tax collected from customers and owed to the tax authority.'),
        L::make('2120', 'Withholding tax payable', 'liability', 'Tax Payable', '21', control: 'tax', currency: 'any', description: 'Tax withheld from supplier payments and owed to the tax authority.'),
        L::make('2130', 'Income tax payable', 'liability', 'Tax Payable', '21'),

        L::make('22', 'Borrowings and provisions', 'liability', 'Non-current Liabilities'),
        L::make('2200', 'Short-term borrowings', 'liability', 'Current Liabilities', '22'),
        L::make('2210', 'Long-term loans', 'liability', 'Non-current Liabilities', '22'),
        L::make('2230', 'Provisions', 'liability', 'Non-current Liabilities', '22'),

        L::make('9999', 'Suspense account', 'liability', 'Clearing', control: 'suspense', description: 'Holds unidentified items until they are investigated and reclassified. Should be zero at period end.'),

        // Equity
        L::make('30', 'Equity', 'equity', 'Contributed Capital'),
        L::make('3000', 'Share capital', 'equity', 'Contributed Capital', '30'),
        L::make('3010', 'Share premium', 'equity', 'Contributed Capital', '30'),
        L::make('3900', 'Retained earnings', 'equity', 'Retained Earnings', '30', control: 'retained_earnings', description: 'Accumulated profits and losses. The year-end close posts the result of the year here.'),

        // Income
        L::make('40', 'Revenue', 'income', 'Operating Revenue'),
        L::make('4000', 'Sales revenue', 'income', 'Operating Revenue', '40', currency: 'any'),
        L::make('4100', 'Service revenue', 'income', 'Operating Revenue', '40', currency: 'any'),
        L::make('4200', 'Sales returns and discounts', 'income', 'Operating Revenue', '40', currency: 'any', normal: 'debit', description: 'Returns, allowances and discounts given. Carries a debit balance.'),

        L::make('48', 'Other income', 'income', 'Other Income'),
        L::make('4800', 'Unrealised FX gain', 'income', 'Other Income', '48', description: 'Gains from revaluing open foreign-currency balances at period end.'),
        L::make('4810', 'Interest income', 'income', 'Other Income', '48', currency: 'any'),
        L::make('4900', 'Realised FX gain', 'income', 'Other Income', '48', description: 'Gains from settling foreign-currency invoices and bills.'),

        // Costs and expenses
        L::make('50', 'Direct costs', 'expense', 'Direct Costs'),
        L::make('5000', 'Cost of sales', 'expense', 'Direct Costs', '50', currency: 'any'),
        L::make('5100', 'Direct labour and subcontractors', 'expense', 'Direct Costs', '50', currency: 'any'),
        L::make('5200', 'Freight and import duties', 'expense', 'Direct Costs', '50', currency: 'any'),
        L::make('5900', 'Inventory write-downs', 'expense', 'Direct Costs', '50'),

        L::make('60', 'Operating expenses', 'expense', 'Operating Expense'),
        L::make('6000', 'Salaries & wages', 'expense', 'Operating Expense', '60'),
        L::make('6010', 'Employer payroll costs', 'expense', 'Operating Expense', '60', description: 'Employer taxes, social security and benefits.'),
        L::make('6100', 'Rent expense', 'expense', 'Operating Expense', '60', currency: 'any'),
        L::make('6200', 'Utilities & communication', 'expense', 'Operating Expense', '60', currency: 'any'),
        L::make('6210', 'Insurance', 'expense', 'Operating Expense', '60', currency: 'any'),
        L::make('6300', 'Bank charges & fees', 'expense', 'Operating Expense', '60', currency: 'any'),
        L::make('6400', 'Office supplies & stationery', 'expense', 'Operating Expense', '60', currency: 'any'),
        L::make('6410', 'Professional fees', 'expense', 'Operating Expense', '60', currency: 'any', description: 'Accounting, audit and legal fees.'),
        L::make('6420', 'Advertising & marketing', 'expense', 'Operating Expense', '60', currency: 'any'),
        L::make('6430', 'Travel & entertainment', 'expense', 'Operating Expense', '60', currency: 'any'),
        L::make('6440', 'Repairs & maintenance', 'expense', 'Operating Expense', '60', currency: 'any'),
        L::make('6460', 'Bad debt expense', 'expense', 'Operating Expense', '60'),
        L::make('6500', 'Depreciation expense', 'expense', 'Operating Expense', '60'),

        L::make('68', 'Other expenses', 'expense', 'Other Expense'),
        L::make('6800', 'Unrealised FX loss', 'expense', 'Other Expense', '68', description: 'Losses from revaluing open foreign-currency balances at period end.'),
        L::make('6810', 'Interest expense', 'expense', 'Other Expense', '68', currency: 'any'),
        L::make('6830', 'Income tax expense', 'expense', 'Other Expense', '68'),
        L::make('6890', 'Rounding differences', 'expense', 'Other Expense', '68', description: 'Receives the rounding residue that foreign-currency documents leave.'),
        L::make('6900', 'Realised FX loss', 'expense', 'Other Expense', '68', description: 'Losses from settling foreign-currency invoices and bills.'),
    ],
];
