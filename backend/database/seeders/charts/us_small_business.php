<?php

declare(strict_types=1);

use Database\Seeders\ChartLine as L;

/**
 * US small business starter chart (plan 2.1): US GAAP vocabulary, sales tax payable, payroll
 * liabilities, owner's equity or common stock, and expense lines that follow the usual tax-return
 * categories (meals, auto and travel, taxes and licenses kept apart).
 * Two-digit lines are group headers; see Database\Seeders\ChartLine for the line format.
 */
return [
    'code' => 'us_small_business',
    'name' => 'US small business',
    'country' => 'US',
    'standard' => 'US GAAP',
    'lines' => [
        // Assets
        L::make('10', 'Cash and bank', 'asset', 'Cash & Equivalents'),
        L::make('1000', 'Petty cash', 'asset', 'Cash & Equivalents', '10', control: 'cash', description: 'Cash held on the premises.'),
        L::make('1010', 'Main bank account (checking)', 'asset', 'Bank Account', '10', control: 'bank', description: 'Primary operating bank account. Add one account per further bank account and currency.'),
        L::make('1090', 'Undeposited funds', 'asset', 'Cash & Equivalents', '10', control: 'cash', currency: 'any', description: 'Payments received but not yet deposited to the bank.'),

        L::make('12', 'Receivables and other current assets', 'asset', 'Current Assets'),
        L::make('1200', 'Accounts receivable (AR control)', 'asset', 'Current Assets', '12', control: 'ar', currency: 'any', description: 'Control account for customer balances. Posted by sales documents and receipts, not by manual journals.'),
        L::make('1210', 'Allowance for doubtful accounts', 'asset', 'Contra Asset', '12', normal: 'credit', description: 'Estimated uncollectible receivables. Carries a credit balance.'),
        L::make('1220', 'Prepaid expenses', 'asset', 'Current Assets', '12', currency: 'any'),
        L::make('1300', 'Inventory', 'asset', 'Inventory', '12', currency: 'any', description: 'Goods held for sale.'),

        L::make('15', 'Property and equipment', 'asset', 'Property, Plant & Equipment'),
        L::make('1500', 'Furniture and equipment', 'asset', 'Property, Plant & Equipment', '15', control: 'fixed_asset', currency: 'any', description: 'Furniture, computers and machinery at cost.'),
        L::make('1510', 'Vehicles', 'asset', 'Property, Plant & Equipment', '15', control: 'fixed_asset', currency: 'any', description: 'Vehicles at cost.'),
        L::make('1520', 'Leasehold improvements', 'asset', 'Property, Plant & Equipment', '15', control: 'fixed_asset', currency: 'any', description: 'Improvements to leased premises at cost.'),
        L::make('1590', 'Accumulated depreciation', 'asset', 'Contra Asset', '15', control: 'accum_depr', normal: 'credit', description: 'Depreciation charged to date on property and equipment. Carries a credit balance.'),

        // Liabilities
        L::make('20', 'Payables and accruals', 'liability', 'Current Liabilities'),
        L::make('2000', 'Accounts payable (AP control)', 'liability', 'Current Liabilities', '20', control: 'ap', currency: 'any', description: 'Control account for supplier balances. Posted by purchase documents and payments, not by manual journals.'),
        L::make('2010', 'Credit card payable', 'liability', 'Current Liabilities', '20'),
        L::make('2020', 'Accrued expenses', 'liability', 'Current Liabilities', '20'),
        L::make('2030', 'Customer deposits', 'liability', 'Current Liabilities', '20', currency: 'any', description: 'Deposits and payments received before the goods or services are delivered.'),
        L::make('2040', 'Wages payable', 'liability', 'Payroll Liabilities', '20'),
        L::make('2050', 'Payroll taxes payable', 'liability', 'Payroll Liabilities', '20', description: 'Federal and state income tax withheld, FICA and unemployment taxes.'),

        L::make('21', 'Taxes payable', 'liability', 'Tax Payable'),
        L::make('2100', 'Sales tax payable', 'liability', 'Tax Payable', '21', control: 'tax', currency: 'any', description: 'Sales tax collected from customers and owed to state and local authorities.'),
        L::make('2110', 'Income taxes payable', 'liability', 'Tax Payable', '21'),

        L::make('25', 'Loans', 'liability', 'Non-current Liabilities'),
        L::make('2500', 'Line of credit', 'liability', 'Current Liabilities', '25'),
        L::make('2510', 'Notes payable', 'liability', 'Non-current Liabilities', '25', description: 'Bank and equipment loans, and loans from owners.'),

        L::make('9999', 'Suspense account', 'liability', 'Clearing', control: 'suspense', description: 'Holds unidentified items until they are investigated and reclassified. Should be zero at period end.'),

        // Equity
        L::make('30', 'Equity', 'equity', 'Contributed Capital'),
        L::make('3000', "Owner's capital / common stock", 'equity', 'Contributed Capital', '30'),
        L::make('3100', "Owner's draws / distributions", 'equity', 'Distributions', '30', normal: 'debit', description: 'Amounts taken out by owners or shareholders. Carries a debit balance.'),
        L::make('3900', 'Retained earnings', 'equity', 'Retained Earnings', '30', control: 'retained_earnings', description: 'Accumulated profits and losses. The year-end close posts the result of the year here.'),

        // Income
        L::make('40', 'Revenue', 'income', 'Operating Revenue'),
        L::make('4000', 'Product sales', 'income', 'Operating Revenue', '40', currency: 'any'),
        L::make('4100', 'Service revenue', 'income', 'Operating Revenue', '40', currency: 'any'),
        L::make('4200', 'Sales returns and discounts', 'income', 'Operating Revenue', '40', currency: 'any', normal: 'debit', description: 'Returns, allowances and discounts given. Carries a debit balance.'),

        L::make('48', 'Other income', 'income', 'Other Income'),
        L::make('4800', 'Unrealised FX gain', 'income', 'Other Income', '48', description: 'Gains from revaluing open foreign-currency balances at period end.'),
        L::make('4810', 'Interest income', 'income', 'Other Income', '48', currency: 'any'),
        L::make('4900', 'Realised FX gain', 'income', 'Other Income', '48', description: 'Gains from settling foreign-currency invoices and bills.'),

        // Costs and expenses
        L::make('50', 'Direct costs', 'expense', 'Direct Costs'),
        L::make('5000', 'Cost of goods sold', 'expense', 'Direct Costs', '50', currency: 'any'),
        L::make('5100', 'Direct labor and contractors', 'expense', 'Direct Costs', '50', currency: 'any'),
        L::make('5200', 'Freight-in', 'expense', 'Direct Costs', '50', currency: 'any'),
        L::make('5900', 'Inventory adjustments', 'expense', 'Direct Costs', '50'),

        L::make('60', 'Operating expenses', 'expense', 'Operating Expense'),
        L::make('6000', 'Salaries & wages', 'expense', 'Operating Expense', '60'),
        L::make('6010', 'Payroll taxes & benefits', 'expense', 'Operating Expense', '60', description: 'Employer payroll taxes, retirement contributions and insurance.'),
        L::make('6100', 'Rent or lease', 'expense', 'Operating Expense', '60', currency: 'any'),
        L::make('6200', 'Utilities & telephone', 'expense', 'Operating Expense', '60', currency: 'any'),
        L::make('6300', 'Advertising & marketing', 'expense', 'Operating Expense', '60', currency: 'any'),
        L::make('6310', 'Auto & travel', 'expense', 'Operating Expense', '60', currency: 'any'),
        L::make('6320', 'Meals & entertainment', 'expense', 'Operating Expense', '60', currency: 'any', description: 'Tracked on its own line because tax rules treat meals differently.'),
        L::make('6400', 'Bank & merchant fees', 'expense', 'Operating Expense', '60', currency: 'any'),
        L::make('6500', 'Depreciation expense', 'expense', 'Operating Expense', '60'),
        L::make('6600', 'Insurance', 'expense', 'Operating Expense', '60', currency: 'any'),
        L::make('6610', 'Legal & professional fees', 'expense', 'Operating Expense', '60', currency: 'any'),
        L::make('6620', 'Taxes & licenses', 'expense', 'Operating Expense', '60', currency: 'any', description: 'Business licenses, permits and property or franchise taxes.'),
        L::make('6630', 'Office supplies & software', 'expense', 'Operating Expense', '60', currency: 'any'),
        L::make('6640', 'Repairs & maintenance', 'expense', 'Operating Expense', '60', currency: 'any'),
        L::make('6700', 'Bad debt expense', 'expense', 'Operating Expense', '60'),

        L::make('68', 'Other expenses', 'expense', 'Other Expense'),
        L::make('6800', 'Interest expense', 'expense', 'Other Expense', '68', currency: 'any'),
        L::make('6810', 'Income tax expense', 'expense', 'Other Expense', '68'),
        L::make('6850', 'Unrealised FX loss', 'expense', 'Other Expense', '68', description: 'Losses from revaluing open foreign-currency balances at period end.'),
        L::make('6890', 'Rounding differences', 'expense', 'Other Expense', '68', description: 'Receives the rounding residue that foreign-currency documents leave.'),
        L::make('6900', 'Realised FX loss', 'expense', 'Other Expense', '68', description: 'Losses from settling foreign-currency invoices and bills.'),
    ],
];
