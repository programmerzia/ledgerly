<?php

declare(strict_types=1);

use Database\Seeders\ChartLine as L;

/**
 * Insurance / Takaful starter chart (plan 2.1): premiums and reinsurance in underwriting income,
 * claims and commissions as direct costs, technical reserves (unearned premium, outstanding claims,
 * IBNR), reinsurers' shares, premium tax, investments and statutory reserves. It is a general
 * business ledger layout, not a statement of any particular reporting standard.
 * Two-digit lines are group headers; see Database\Seeders\ChartLine for the line format.
 */
return [
    'code' => 'insurance',
    'name' => 'Insurance / Takaful',
    'country' => null,
    'standard' => 'Insurance industry practice',
    'lines' => [
        // Assets
        L::make('10', 'Cash and bank', 'asset', 'Cash & Equivalents'),
        L::make('1000', 'Cash on hand', 'asset', 'Cash & Equivalents', '10', control: 'cash', description: 'Petty cash and cash floats held on the premises.'),
        L::make('1010', 'Main bank account', 'asset', 'Bank Account', '10', control: 'bank', description: 'Primary operating bank account. Add one account per further bank account and currency.'),
        L::make('1020', 'Premium collection account', 'asset', 'Bank Account', '10', control: 'bank', description: 'Receives premiums from policyholders, agents and brokers.'),

        L::make('12', 'Premiums and other receivables', 'asset', 'Current Assets'),
        L::make('1200', 'Premiums receivable (AR control)', 'asset', 'Current Assets', '12', control: 'ar', currency: 'any', description: 'Control account for amounts due from policyholders, agents and brokers. Posted by sales documents and receipts, not by manual journals.'),
        L::make('1210', 'Allowance for doubtful premiums', 'asset', 'Contra Asset', '12', normal: 'credit', description: 'Estimated uncollectible premiums. Carries a credit balance.'),
        L::make('1220', 'Reinsurance receivables', 'asset', 'Current Assets', '12', currency: 'any', description: 'Amounts due from reinsurers for claims recoveries and commissions.'),
        L::make('1250', 'Input tax recoverable (VAT/GST)', 'asset', 'Tax Receivable', '12', control: 'tax', currency: 'any', description: 'Tax paid on purchases that can be recovered from the tax authority.'),

        L::make('13', 'Reinsurance assets', 'asset', 'Reinsurance Assets'),
        L::make('1300', "Reinsurers' share of unearned premiums", 'asset', 'Reinsurance Assets', '13'),
        L::make('1310', "Reinsurers' share of outstanding claims", 'asset', 'Reinsurance Assets', '13'),

        L::make('15', 'Investments and non-current assets', 'asset', 'Non-current Assets'),
        L::make('1500', 'Property and equipment', 'asset', 'Property, Plant & Equipment', '15', control: 'fixed_asset', currency: 'any', description: 'Property, plant and equipment at cost.'),
        L::make('1510', 'Accumulated depreciation', 'asset', 'Contra Asset', '15', control: 'accum_depr', normal: 'credit', description: 'Depreciation charged to date on property and equipment. Carries a credit balance.'),
        L::make('1600', 'Term deposits and bonds', 'asset', 'Investments', '15'),
        L::make('1610', 'Equity investments', 'asset', 'Investments', '15'),

        // Liabilities
        L::make('20', 'Payables and accruals', 'liability', 'Current Liabilities'),
        L::make('2000', 'Accounts payable (AP control)', 'liability', 'Current Liabilities', '20', control: 'ap', currency: 'any', description: 'Control account for supplier and payee balances. Posted by purchase documents and payments, not by manual journals.'),
        L::make('2010', 'Accrued expenses', 'liability', 'Current Liabilities', '20'),
        L::make('2020', 'Commissions payable', 'liability', 'Current Liabilities', '20', currency: 'any', description: 'Commissions owed to agents and brokers.'),
        L::make('2030', 'Claims payable', 'liability', 'Current Liabilities', '20', currency: 'any', description: 'Settled claims not yet paid.'),
        L::make('2040', 'Due to reinsurers', 'liability', 'Current Liabilities', '20', currency: 'any', description: 'Reinsurance premiums owed to reinsurers.'),

        L::make('21', 'Tax liabilities', 'liability', 'Tax Payable'),
        L::make('2100', 'Output tax payable (VAT/GST)', 'liability', 'Tax Payable', '21', control: 'tax', currency: 'any', description: 'Sales tax collected from customers and owed to the tax authority.'),
        L::make('2110', 'Premium tax payable', 'liability', 'Tax Payable', '21', control: 'tax', currency: 'any', description: 'Tax or levy charged on premiums and owed to the authority.'),
        L::make('2120', 'Withholding tax payable', 'liability', 'Tax Payable', '21', control: 'tax', currency: 'any', description: 'Tax withheld from supplier payments and owed to the tax authority.'),
        L::make('2130', 'Income tax payable', 'liability', 'Tax Payable', '21'),

        L::make('23', 'Technical reserves', 'liability', 'Insurance Reserves'),
        L::make('2300', 'Unearned premium reserve', 'liability', 'Insurance Reserves', '23', description: 'Premiums received for cover that has not yet run.'),
        L::make('2310', 'Outstanding claims reserve', 'liability', 'Insurance Reserves', '23', description: 'Reported claims not yet settled.'),
        L::make('2320', 'IBNR reserve', 'liability', 'Insurance Reserves', '23', description: 'Claims incurred but not yet reported.'),

        L::make('9999', 'Suspense account', 'liability', 'Clearing', control: 'suspense', description: 'Holds unidentified items until they are investigated and reclassified. Should be zero at period end.'),

        // Equity
        L::make('30', 'Equity', 'equity', 'Contributed Capital'),
        L::make('3000', 'Share capital', 'equity', 'Contributed Capital', '30'),
        L::make('3100', 'Statutory reserve', 'equity', 'Reserves', '30', description: 'Reserve the regulator requires to be set aside from profits.'),
        L::make('3900', 'Retained earnings', 'equity', 'Retained Earnings', '30', control: 'retained_earnings', description: 'Accumulated profits and losses. The year-end close posts the result of the year here.'),

        // Income
        L::make('40', 'Underwriting income', 'income', 'Operating Revenue'),
        L::make('4000', 'Gross written premiums', 'income', 'Operating Revenue', '40', currency: 'any', description: 'Premiums on policies written, before reinsurance. Takaful operators can use it for gross contributions.'),
        L::make('4010', 'Premium refunds and cancellations', 'income', 'Operating Revenue', '40', currency: 'any', normal: 'debit', description: 'Premiums returned to policyholders. Carries a debit balance.'),
        L::make('4020', 'Reinsurance premiums ceded', 'income', 'Operating Revenue', '40', currency: 'any', normal: 'debit', description: 'Premiums paid or payable to reinsurers. Carries a debit balance.'),
        L::make('4030', 'Change in unearned premium reserve', 'income', 'Operating Revenue', '40', normal: 'debit', description: 'Movement in the unearned premium reserve.'),
        L::make('4100', 'Reinsurance commission income', 'income', 'Operating Revenue', '40', currency: 'any'),

        L::make('48', 'Other income', 'income', 'Other Income'),
        L::make('4800', 'Unrealised FX gain', 'income', 'Other Income', '48', description: 'Gains from revaluing open foreign-currency balances at period end.'),
        L::make('4810', 'Investment income', 'income', 'Other Income', '48', currency: 'any', description: 'Interest, dividends and rent from investments.'),
        L::make('4900', 'Realised FX gain', 'income', 'Other Income', '48', description: 'Gains from settling foreign-currency invoices and bills.'),

        // Costs and expenses
        L::make('50', 'Claims and acquisition costs', 'expense', 'Direct Costs'),
        L::make('5000', 'Claims paid', 'expense', 'Direct Costs', '50', currency: 'any'),
        L::make('5010', 'Reinsurance recoveries on claims', 'expense', 'Direct Costs', '50', currency: 'any', normal: 'credit', description: 'Claims recovered from reinsurers. Carries a credit balance.'),
        L::make('5020', 'Change in outstanding claims reserves', 'expense', 'Direct Costs', '50', description: 'Movement in the outstanding claims and IBNR reserves.'),
        L::make('5030', "Reinsurers' share of change in claims reserves", 'expense', 'Direct Costs', '50', normal: 'credit', description: "Reinsurers' part of the movement in claims reserves. Carries a credit balance."),
        L::make('5100', 'Acquisition commissions', 'expense', 'Direct Costs', '50', currency: 'any', description: 'Commissions paid to agents and brokers for new and renewed business.'),
        L::make('5200', 'Claims handling costs', 'expense', 'Direct Costs', '50', currency: 'any', description: 'Loss adjusters, surveyors and claims legal costs.'),

        L::make('60', 'Operating expenses', 'expense', 'Operating Expense'),
        L::make('6000', 'Salaries, wages & benefits', 'expense', 'Operating Expense', '60'),
        L::make('6100', 'Rent expense', 'expense', 'Operating Expense', '60', currency: 'any'),
        L::make('6200', 'Utilities & communication', 'expense', 'Operating Expense', '60', currency: 'any'),
        L::make('6300', 'Bank charges & fees', 'expense', 'Operating Expense', '60', currency: 'any'),
        L::make('6400', 'Office supplies & stationery', 'expense', 'Operating Expense', '60', currency: 'any'),
        L::make('6410', 'Professional fees', 'expense', 'Operating Expense', '60', currency: 'any', description: 'Actuarial, audit and legal fees.'),
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
