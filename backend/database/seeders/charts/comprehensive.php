<?php

declare(strict_types=1);

use Database\Seeders\ChartLine as L;

/**
 * Comprehensive (IFRS) chart, plan 3c.0 (D15.8). Original work for a general trading and services company:
 * the numbering scheme and every name were written for this product and nothing is taken from another
 * system's chart.
 *
 * Code scheme, 8 digits: group (2 digits: the class digit, then 1 to 9) + account (2 digits) + 4 digits left free
 * for the client's own sub-accounts (one bank account per currency, one account per branch). Classes: 1 assets,
 * 2 liabilities, 3 equity, 4 revenue, 5 cost of sales, 6 operating expenses, 7 other income and expense,
 * 8 tax and consolidation. A group header is the group number followed by six zeros.
 *
 * Specialist accounts start hidden (`h`): they are still ordinary accounts that post and report, the chart screen
 * just does not list them until "Show hidden" is on.
 *
 * `e` is the IFRS Accounting Taxonomy 2025-03-27 element (ifrs-full namespace), set only where the element's
 * meaning is the account's meaning and the name was checked against the Foundation's published schema.
 *
 * Row format: [account, name, options]. Options: c control type, cur 'any'|'base_only' (group default applies),
 * n normal balance when it is not the type's usual side (contra accounts), s subtype when it is not the group's,
 * e IFRS element, h hidden (overrides the group), d description.
 */
$pad = static fn (string $c): string => str_pad($c, 8, '0');

/** @var list<array{0: string, 1: string, 2: 'asset'|'liability'|'equity'|'income'|'expense', 3: string, 4: array{cur?: 'base_only'|'any', h?: int}, 5: list<array{0: string, 1: string, c?: 'none'|'ar'|'ap'|'bank'|'cash'|'tax'|'retained_earnings'|'suspense'|'fixed_asset'|'accum_depr', cur?: 'base_only'|'any', n?: 'debit'|'credit', s?: string, e?: string, h?: int, d?: string}>}> $groups [group, name, type, subtype, defaults, rows] */
$groups = [
    // ---------------------------------------------------------------- 1 assets
    ['11', 'Cash and bank', 'asset', 'Cash & Equivalents', ['cur' => 'any'], [
        ['1101', 'Cash on hand', 'c' => 'cash', 'e' => 'CashOnHand', 'd' => 'Notes and coins held on the premises.'],
        ['1102', 'Petty cash', 'c' => 'cash', 'e' => 'CashOnHand'],
        ['1105', 'Main bank account', 'c' => 'bank', 's' => 'Bank Account', 'e' => 'BalancesWithBanks', 'd' => 'Primary operating account. Add one sub-account per further bank account and currency.'],
        ['1106', 'Savings bank account', 'c' => 'bank', 's' => 'Bank Account', 'e' => 'BalancesWithBanks'],
        ['1107', 'Foreign-currency bank account', 'c' => 'bank', 's' => 'Bank Account', 'e' => 'BalancesWithBanks'],
        ['1108', 'Payroll bank account', 'c' => 'bank', 's' => 'Bank Account', 'e' => 'BalancesWithBanks', 'h' => 1],
        ['1110', 'Mobile money wallet', 'c' => 'bank', 's' => 'Bank Account', 'e' => 'BalancesWithBanks'],
        ['1111', 'Short-term deposits (3 months or less)', 'c' => 'bank', 's' => 'Bank Account', 'e' => 'ShorttermDepositsClassifiedAsCashEquivalents', 'h' => 1, 'd' => 'Deposits that mature within three months of placing them (IAS 7.7).'],
        ['1112', 'Restricted cash', 'c' => 'bank', 's' => 'Bank Account', 'e' => 'RestrictedCashAndCashEquivalents', 'h' => 1, 'd' => 'Cash that cannot be used freely, for example escrow or a guarantee margin.'],
        ['1115', 'Bank clearing (receipts not yet banked)', 'c' => 'cash', 'd' => 'Receipts and cheques recorded but not yet paid in.'],
        ['1116', 'Funds in transit between accounts', 'c' => 'cash', 'd' => 'Both legs of a transfer between bank accounts pass here; any rate difference left is realised exchange gain or loss.'],
        ['1117', 'Payments in transit', 'c' => 'cash', 'h' => 1, 'd' => 'Payments sent or cheques issued that have not yet left the bank.'],
        ['1118', 'Card and gateway settlement clearing', 'c' => 'cash', 'd' => 'Card and online sales held by a payment processor until it pays out.'],
    ]],
    ['12', 'Receivables', 'asset', 'Current Assets', ['cur' => 'any'], [
        ['1201', 'Trade receivables (AR control)', 'c' => 'ar', 'e' => 'TradeReceivables', 'd' => 'Control account for customer balances. Posted by sales documents and receipts, not by manual journals.'],
        ['1202', 'Allowance for credit losses', 's' => 'Contra Asset', 'n' => 'credit', 'cur' => 'base_only', 'e' => 'AllowanceAccountForCreditLossesOfFinancialAssets', 'd' => 'Expected credit losses on receivables (IFRS 9). Carries a credit balance.'],
        ['1203', 'Contract assets (unbilled revenue)', 'e' => 'ContractAssets', 'h' => 1, 'd' => 'Revenue earned that the customer has not yet been invoiced for.'],
        ['1204', 'Accrued income', 'e' => 'CurrentAccruedIncomeOtherThanCurrentContractAssets'],
        ['1206', 'Staff advances and loans', 'e' => 'OtherCurrentReceivables'],
        ['1207', 'Deposits paid (refundable)', 'e' => 'OtherCurrentReceivables'],
        ['1208', 'Other receivables', 'e' => 'OtherCurrentReceivables'],
        ['1210', 'Allowance for credit losses on other receivables', 's' => 'Contra Asset', 'n' => 'credit', 'cur' => 'base_only', 'h' => 1],
        ['1211', 'Intercompany receivable', 'e' => 'TradeAndOtherCurrentReceivablesDueFromRelatedParties', 'h' => 1, 'd' => 'Amounts due from other companies of the group. Eliminated on consolidation.'],
    ]],
    ['13', 'Tax assets', 'asset', 'Tax Receivable', ['cur' => 'any'], [
        ['1301', 'Input VAT recoverable', 'c' => 'tax', 'e' => 'CurrentValueAddedTaxReceivables', 'd' => 'Tax paid on purchases that can be recovered from the tax authority.'],
        ['1302', 'Reverse-charge input VAT', 'c' => 'tax', 'h' => 1, 'd' => 'Input tax self-assessed on purchases under the reverse charge; offsets the reverse-charge output.'],
        ['1303', 'Import VAT recoverable', 'c' => 'tax', 'e' => 'CurrentValueAddedTaxReceivables', 'h' => 1],
        ['1305', 'Withholding VAT receivable', 'c' => 'tax', 'h' => 1, 'd' => 'VAT withheld by customers at source, to be credited against output VAT.'],
        ['1306', 'Withholding tax receivable', 'c' => 'tax', 'e' => 'CurrentTaxAssetsCurrent', 'd' => 'Income tax withheld from our receipts by customers, creditable against income tax.'],
        ['1307', 'Income tax receivable', 'e' => 'CurrentTaxAssetsCurrent'],
        ['1308', 'Provisional and instalment tax paid', 'e' => 'CurrentTaxAssetsCurrent'],
        ['1310', 'Deferred tax asset', 'e' => 'DeferredTaxAssets', 'cur' => 'base_only', 'h' => 1],
    ]],
    ['14', 'Prepayments', 'asset', 'Prepayments', ['cur' => 'any'], [
        ['1401', 'Prepaid insurance', 'e' => 'CurrentPrepayments'],
        ['1402', 'Prepaid rent', 'e' => 'CurrentPrepayments'],
        ['1403', 'Prepaid software and subscriptions', 'e' => 'CurrentPrepayments'],
        ['1404', 'Advances to suppliers', 'e' => 'CurrentAdvancesToSuppliers'],
        ['1409', 'Other prepaid expenses', 'e' => 'CurrentPrepayments'],
    ]],
    ['15', 'Inventories', 'asset', 'Inventory', ['cur' => 'any'], [
        ['1501', 'Merchandise (goods for resale)', 'e' => 'Merchandise', 'd' => 'Goods held for sale, kept as one balance. Stock quantities are not tracked here.'],
        ['1502', 'Raw materials', 'e' => 'RawMaterials', 'h' => 1],
        ['1503', 'Work in progress', 'e' => 'WorkInProgress', 'h' => 1],
        ['1504', 'Finished goods', 'e' => 'FinishedGoods', 'h' => 1],
        ['1505', 'Consumables and supplies', 'e' => 'CurrentMaterialsAndSuppliesToBeConsumedInProductionProcessOrRenderingServices'],
        ['1507', 'Spare parts', 'e' => 'SpareParts', 'h' => 1],
        ['1508', 'Goods in transit', 'e' => 'CurrentInventoriesInTransit', 'd' => 'Goods bought and owned but not yet received.'],
        ['1510', 'Inventory write-down allowance', 's' => 'Inventory', 'n' => 'credit', 'cur' => 'base_only', 'h' => 1, 'd' => 'Write-down to net realisable value. Carries a credit balance.'],
    ]],
    ['16', 'Property, plant and equipment', 'asset', 'Property, Plant & Equipment', ['cur' => 'any'], [
        ['1601', 'Land', 'c' => 'fixed_asset', 'e' => 'Land', 'd' => 'Not depreciated.'],
        ['1602', 'Buildings', 'c' => 'fixed_asset', 'e' => 'Buildings'],
        ['1603', 'Plant and machinery', 'c' => 'fixed_asset', 'e' => 'Machinery'],
        ['1604', 'Motor vehicles', 'c' => 'fixed_asset', 'e' => 'MotorVehicles'],
        ['1605', 'Computers and IT equipment', 'c' => 'fixed_asset'],
        ['1606', 'Furniture and fittings', 'c' => 'fixed_asset', 'e' => 'FixturesAndFittings'],
        ['1607', 'Office equipment', 'c' => 'fixed_asset', 'e' => 'OfficeEquipment'],
        ['1609', 'Leasehold improvements', 'c' => 'fixed_asset'],
        ['1610', 'Right-of-use assets: buildings', 'c' => 'fixed_asset', 'e' => 'RightofuseAssets', 'h' => 1],
        ['1611', 'Right-of-use assets: vehicles', 'c' => 'fixed_asset', 'e' => 'RightofuseAssets', 'h' => 1],
        ['1612', 'Right-of-use assets: equipment', 'c' => 'fixed_asset', 'e' => 'RightofuseAssets', 'h' => 1],
        ['1613', 'Assets under construction', 'c' => 'fixed_asset', 'e' => 'ConstructionInProgress', 'd' => 'Not depreciated until available for use.'],
        ['1614', 'Investment property', 'c' => 'fixed_asset', 'e' => 'InvestmentProperty', 'h' => 1, 'd' => 'Property held to earn rent or for capital gain (IAS 40).'],
        ['1621', 'Accumulated depreciation: buildings', 'c' => 'accum_depr', 's' => 'Contra Asset', 'n' => 'credit', 'cur' => 'base_only'],
        ['1622', 'Accumulated depreciation: plant and machinery', 'c' => 'accum_depr', 's' => 'Contra Asset', 'n' => 'credit', 'cur' => 'base_only'],
        ['1623', 'Accumulated depreciation: motor vehicles', 'c' => 'accum_depr', 's' => 'Contra Asset', 'n' => 'credit', 'cur' => 'base_only'],
        ['1624', 'Accumulated depreciation: computers and IT equipment', 'c' => 'accum_depr', 's' => 'Contra Asset', 'n' => 'credit', 'cur' => 'base_only'],
        ['1625', 'Accumulated depreciation: furniture and fittings', 'c' => 'accum_depr', 's' => 'Contra Asset', 'n' => 'credit', 'cur' => 'base_only'],
        ['1626', 'Accumulated depreciation: office equipment', 'c' => 'accum_depr', 's' => 'Contra Asset', 'n' => 'credit', 'cur' => 'base_only'],
        ['1628', 'Accumulated depreciation: leasehold improvements', 'c' => 'accum_depr', 's' => 'Contra Asset', 'n' => 'credit', 'cur' => 'base_only'],
        ['1629', 'Accumulated depreciation: right-of-use buildings', 'c' => 'accum_depr', 's' => 'Contra Asset', 'n' => 'credit', 'cur' => 'base_only', 'h' => 1],
        ['1630', 'Accumulated depreciation: right-of-use vehicles', 'c' => 'accum_depr', 's' => 'Contra Asset', 'n' => 'credit', 'cur' => 'base_only', 'h' => 1],
        ['1631', 'Accumulated depreciation: right-of-use equipment', 'c' => 'accum_depr', 's' => 'Contra Asset', 'n' => 'credit', 'cur' => 'base_only', 'h' => 1],
        ['1641', 'Accumulated impairment: land and buildings', 'c' => 'accum_depr', 's' => 'Contra Asset', 'n' => 'credit', 'cur' => 'base_only', 'h' => 1],
        ['1642', 'Accumulated impairment: plant, vehicles and equipment', 'c' => 'accum_depr', 's' => 'Contra Asset', 'n' => 'credit', 'cur' => 'base_only', 'h' => 1],
        ['1643', 'Accumulated impairment: right-of-use assets', 'c' => 'accum_depr', 's' => 'Contra Asset', 'n' => 'credit', 'cur' => 'base_only', 'h' => 1],
    ]],
    ['17', 'Intangible assets', 'asset', 'Intangible Assets', ['cur' => 'base_only', 'h' => 1], [
        ['1701', 'Goodwill', 'e' => 'Goodwill', 'd' => 'Arises on acquiring a business. Not amortised; tested for impairment at least yearly.'],
        ['1702', 'Computer software', 'e' => 'ComputerSoftware', 'h' => 0],
        ['1703', 'Licences and franchises', 'e' => 'LicencesAndFranchises'],
        ['1704', 'Patents and trademarks'],
        ['1705', 'Customer relationships and lists'],
        ['1706', 'Capitalised development costs'],
        ['1708', 'Intangible assets under development', 'e' => 'IntangibleAssetsUnderDevelopment'],
        ['1709', 'Other intangible assets'],
        ['1721', 'Accumulated amortisation: computer software', 'c' => 'accum_depr', 's' => 'Contra Asset', 'n' => 'credit', 'h' => 0],
        ['1722', 'Accumulated amortisation: licences and franchises', 'c' => 'accum_depr', 's' => 'Contra Asset', 'n' => 'credit'],
        ['1723', 'Accumulated amortisation: patents and trademarks', 'c' => 'accum_depr', 's' => 'Contra Asset', 'n' => 'credit'],
        ['1724', 'Accumulated amortisation: customer relationships', 'c' => 'accum_depr', 's' => 'Contra Asset', 'n' => 'credit'],
        ['1725', 'Accumulated amortisation: development costs', 'c' => 'accum_depr', 's' => 'Contra Asset', 'n' => 'credit'],
        ['1727', 'Accumulated amortisation: other intangibles', 'c' => 'accum_depr', 's' => 'Contra Asset', 'n' => 'credit'],
        ['1741', 'Accumulated impairment: goodwill', 'c' => 'accum_depr', 's' => 'Contra Asset', 'n' => 'credit', 'd' => 'Never reversed (IAS 36.124).'],
        ['1742', 'Accumulated impairment: other intangibles', 'c' => 'accum_depr', 's' => 'Contra Asset', 'n' => 'credit'],
    ]],
    ['18', 'Investments and other non-current assets', 'asset', 'Investments', ['cur' => 'base_only', 'h' => 1], [
        ['1801', 'Investments in subsidiaries', 'e' => 'InvestmentsInSubsidiaries'],
        ['1802', 'Investments in associates', 'e' => 'InvestmentsInAssociates'],
        ['1803', 'Investments in joint ventures', 'e' => 'InvestmentsInJointVentures'],
        ['1804', 'Equity investments at fair value through OCI', 'e' => 'NoncurrentFinancialAssetsMeasuredAtFairValueThroughOtherComprehensiveIncome'],
        ['1805', 'Investments at fair value through profit or loss', 'e' => 'NoncurrentFinancialAssetsAtFairValueThroughProfitOrLoss'],
        ['1806', 'Debt investments at amortised cost', 'e' => 'NoncurrentFinancialAssetsAtAmortisedCost'],
        ['1807', 'Term deposits (over 3 months)', 'cur' => 'any'],
        ['1808', 'Long-term loans receivable', 's' => 'Non-current Assets', 'e' => 'NoncurrentLoansAndReceivables'],
        ['1809', 'Long-term deposits and prepayments', 's' => 'Non-current Assets', 'e' => 'NoncurrentPrepayments'],
        ['1811', 'Allowance for impairment of investments', 's' => 'Contra Asset', 'n' => 'credit'],
    ]],
    ['19', 'Other assets', 'asset', 'Current Assets', ['cur' => 'any', 'h' => 1], [
        ['1901', 'Assets held for sale', 'e' => 'NoncurrentAssetsOrDisposalGroupsClassifiedAsHeldForSaleOrAsHeldForDistributionToOwners', 'cur' => 'base_only', 'd' => 'Carried here while a sale is committed (IFRS 5). Not depreciated.'],
        ['1902', 'Other current assets', 'e' => 'OtherCurrentAssets', 'h' => 0],
    ]],

    // ---------------------------------------------------------------- 2 liabilities
    ['21', 'Payables and accruals', 'liability', 'Current Liabilities', ['cur' => 'any'], [
        ['2101', 'Trade payables (AP control)', 'c' => 'ap', 'e' => 'TradeAndOtherCurrentPayablesToTradeSuppliers', 'd' => 'Control account for supplier balances. Posted by purchase documents and payments, not by manual journals.'],
        ['2102', 'Goods received not invoiced', 'e' => 'AccrualsClassifiedAsCurrent', 'd' => 'Goods and services received for which the supplier bill has not arrived.'],
        ['2103', 'Accrued expenses', 'e' => 'AccrualsClassifiedAsCurrent'],
        ['2104', 'Accrued interest', 'e' => 'CurrentInterestPayable'],
        ['2105', 'Accrued utilities', 'e' => 'AccrualsClassifiedAsCurrent'],
        ['2106', 'Accrued professional fees', 'e' => 'AccrualsClassifiedAsCurrent'],
        ['2108', 'Customer deposits received', 'e' => 'CurrentDepositsFromCustomers'],
        ['2110', 'Dividends payable', 'e' => 'CurrentDividendPayables', 'h' => 1],
        ['2111', 'Other payables', 'e' => 'OtherCurrentPayables'],
        ['2112', 'Intercompany payable', 'e' => 'TradeAndOtherCurrentPayablesToRelatedParties', 'h' => 1, 'd' => 'Amounts due to other companies of the group. Eliminated on consolidation.'],
        ['2115', 'Staff claims and reimbursements payable'],
        ['2116', 'Credit card payable'],
    ]],
    ['22', 'Contract liabilities and deferred income', 'liability', 'Deferred Income', ['cur' => 'any'], [
        ['2201', 'Contract liabilities (customer advances)', 'e' => 'CurrentContractLiabilities', 'h' => 1, 'd' => 'Payment received before the goods or services are delivered (IFRS 15).'],
        ['2202', 'Deferred revenue', 'e' => 'CurrentDeferredIncomeIncludingCurrentContractLiabilities'],
        ['2203', 'Deferred grant income', 'e' => 'CurrentGovernmentGrants', 'h' => 1],
        ['2205', 'Refund liabilities (expected returns)', 'h' => 1],
    ]],
    ['23', 'Tax liabilities', 'liability', 'Tax Payable', ['cur' => 'any'], [
        ['2301', 'Output VAT payable', 'c' => 'tax', 'e' => 'CurrentValueAddedTaxPayables', 'd' => 'Sales tax collected from customers and owed to the tax authority.'],
        ['2302', 'Reverse-charge output VAT', 'c' => 'tax', 'h' => 1, 'd' => 'Output tax self-assessed on purchases under the reverse charge.'],
        ['2303', 'VAT clearing', 'c' => 'tax', 'h' => 1, 'd' => 'Nets input and output VAT at period end before the return is paid.'],
        ['2304', 'VAT payable to the tax authority', 'c' => 'tax', 'e' => 'CurrentValueAddedTaxPayables'],
        ['2305', 'Withholding tax payable', 'c' => 'tax', 'd' => 'Tax withheld from supplier payments and owed to the tax authority.'],
        ['2306', 'Income tax payable', 'cur' => 'base_only'],
        ['2307', 'Other taxes and levies payable', 'cur' => 'base_only', 'd' => 'Excise, stamp duty and similar taxes.'],
        ['2309', 'Deferred tax liability', 'e' => 'DeferredTaxLiabilities', 'cur' => 'base_only', 'h' => 1],
    ]],
    ['24', 'Payroll liabilities', 'liability', 'Payroll Liabilities', ['cur' => 'base_only'], [
        ['2401', 'Net salaries and wages payable'],
        ['2402', 'Income tax withheld from employees'],
        ['2403', 'Social security payable: employee share'],
        ['2404', 'Social security payable: employer share'],
        ['2405', 'Pension contributions payable'],
        ['2406', 'Health insurance contributions payable'],
        ['2407', 'Other statutory levies payable'],
        ['2408', 'Accrued bonuses', 'h' => 1],
        ['2409', 'Accrued leave pay'],
        ['2412', 'Payroll clearing', 'h' => 1],
    ]],
    ['25', 'Provisions', 'liability', 'Provisions', ['cur' => 'base_only', 'h' => 1], [
        ['2501', 'Warranty provision', 'e' => 'WarrantyProvision'],
        ['2502', 'Restructuring provision', 'e' => 'RestructuringProvision'],
        ['2503', 'Legal claims provision', 'e' => 'LegalProceedingsProvision'],
        ['2504', 'Onerous contracts provision', 'e' => 'OnerousContractsProvision'],
        ['2505', 'Decommissioning and restoration provision', 'e' => 'ProvisionForDecommissioningRestorationAndRehabilitationCosts'],
        ['2506', 'Employee benefits: end of service', 'e' => 'NoncurrentProvisionsForEmployeeBenefits'],
        ['2507', 'Other provisions', 'e' => 'OtherProvisions'],
    ]],
    ['26', 'Lease liabilities', 'liability', 'Borrowings', ['cur' => 'any', 'h' => 1], [
        ['2601', 'Lease liabilities: current', 'e' => 'CurrentLeaseLiabilities'],
        ['2602', 'Lease liabilities: non-current', 'e' => 'NoncurrentLeaseLiabilities'],
    ]],
    ['27', 'Borrowings', 'liability', 'Borrowings', ['cur' => 'any'], [
        ['2701', 'Bank overdraft', 'd' => 'Overdrafts repayable on demand that form part of cash management may be shown as cash (IAS 7.8); here they stay a borrowing.'],
        ['2702', 'Short-term bank loans'],
        ['2703', 'Current portion of long-term loans'],
        ['2704', 'Long-term bank loans', 's' => 'Non-current Liabilities'],
        ['2705', 'Shareholder and director loans', 's' => 'Non-current Liabilities', 'h' => 1],
        ['2706', 'Intercompany loans payable', 's' => 'Non-current Liabilities', 'h' => 1],
    ]],
    ['29', 'Clearing and suspense', 'liability', 'Clearing', ['cur' => 'any'], [
        ['2901', 'Suspense account', 'c' => 'suspense', 'cur' => 'base_only', 'd' => 'Holds unidentified items until they are investigated and reclassified. Should be zero at period end.'],
    ]],

    // ---------------------------------------------------------------- 3 equity
    ['31', 'Share capital', 'equity', 'Contributed Capital', ['cur' => 'base_only'], [
        ['3101', 'Ordinary share capital', 'e' => 'IssuedCapitalOrdinaryShares'],
        ['3102', 'Preference share capital', 'e' => 'IssuedCapitalPreferenceShares', 'h' => 1],
        ['3103', 'Share premium', 'e' => 'SharePremium'],
        ['3104', 'Treasury shares', 'n' => 'debit', 'e' => 'TreasuryShares', 'h' => 1, 'd' => 'Own shares bought back and held. Carries a debit balance.'],
        ['3107', 'Owner contributions', 'd' => 'Capital put in by the owner of an unincorporated business.'],
        ['3108', 'Owner drawings', 'n' => 'debit', 'd' => 'Withdrawals by the owner. Carries a debit balance.'],
    ]],
    ['32', 'Retained earnings', 'equity', 'Retained Earnings', ['cur' => 'base_only'], [
        ['3201', 'Retained earnings', 'c' => 'retained_earnings', 'e' => 'RetainedEarnings', 'd' => 'Accumulated profits and losses. The year-end close posts the result of the year here.'],
        ['3202', 'Current year result', 'h' => 1, 'd' => 'Reserved for consolidation and closing work. Reports compute the result of the open year themselves.'],
        ['3203', 'Dividends declared', 'n' => 'debit', 'h' => 0, 'd' => 'Dividends charged to equity until the year-end close. Carries a debit balance.'],
    ]],
    ['33', 'Reserves', 'equity', 'Reserves', ['cur' => 'base_only', 'h' => 1], [
        ['3301', 'Revaluation reserve', 'e' => 'RevaluationSurplus', 'd' => 'Revaluation increases on a class of assets, less decreases to the extent of earlier increases (IAS 16.39).'],
        ['3302', 'Foreign currency translation reserve', 'e' => 'ReserveOfExchangeDifferencesOnTranslation'],
        ['3303', 'Fair value reserve (equity investments)', 'e' => 'ReserveOfGainsAndLossesFromInvestmentsInEquityInstruments'],
        ['3304', 'Cash flow hedge reserve', 'e' => 'ReserveOfCashFlowHedges'],
        ['3305', 'Share-based payment reserve', 'e' => 'ReserveOfSharebasedPayments'],
        ['3306', 'Statutory reserve'],
        ['3308', 'Remeasurement of defined benefit plans', 'e' => 'ReserveOfRemeasurementsOfDefinedBenefitPlans'],
        ['3310', 'Other reserves', 'e' => 'OtherReserves'],
    ]],
    ['34', 'Non-controlling interests', 'equity', 'Non-controlling Interests', ['cur' => 'base_only', 'h' => 1], [
        ['3401', 'Non-controlling interests: share of net assets', 'e' => 'NoncontrollingInterests'],
        ['3402', 'Non-controlling interests: share of current result'],
    ]],

    // ---------------------------------------------------------------- 4 revenue
    ['41', 'Sales of goods', 'income', 'Operating Revenue', ['cur' => 'any'], [
        ['4101', 'Sales of goods: domestic', 'e' => 'RevenueFromSaleOfGoods'],
        ['4102', 'Sales of goods: export', 'e' => 'RevenueFromSaleOfGoods'],
        ['4103', 'Sales of goods: online', 'e' => 'RevenueFromSaleOfGoods'],
    ]],
    ['42', 'Services and other operating revenue', 'income', 'Operating Revenue', ['cur' => 'any'], [
        ['4201', 'Consulting revenue', 'e' => 'RevenueFromRenderingOfServices'],
        ['4202', 'Professional services revenue', 'e' => 'RevenueFromRenderingOfServices'],
        ['4203', 'Installation and maintenance revenue', 'e' => 'RevenueFromRenderingOfServices'],
        ['4205', 'Subscription and recurring revenue', 'e' => 'RevenueFromRenderingOfServices'],
        ['4206', 'Commission revenue', 'h' => 1],
        ['4207', 'Rental revenue (operating)', 'h' => 1],
        ['4208', 'Delivery and freight recharged', 'h' => 1],
        ['4209', 'Project and contract revenue', 'e' => 'RevenueFromRenderingOfServices', 'h' => 1],
    ]],
    ['43', 'Sales deductions', 'income', 'Operating Revenue', ['cur' => 'any'], [
        ['4301', 'Sales returns', 'n' => 'debit', 'd' => 'Goods returned by customers. Carries a debit balance.'],
        ['4302', 'Trade discounts', 'n' => 'debit', 'd' => 'Carries a debit balance.'],
        ['4303', 'Settlement discounts allowed', 'n' => 'debit', 'd' => 'Early-payment discounts given. Carries a debit balance.'],
    ]],

    // ---------------------------------------------------------------- 5 cost of sales
    ['51', 'Cost of goods sold', 'expense', 'Direct Costs', ['cur' => 'any'], [
        ['5101', 'Cost of merchandise sold', 'e' => 'CostOfMerchandiseSold'],
        ['5103', 'Raw materials consumed', 'e' => 'RawMaterialsAndConsumablesUsed', 'h' => 1],
        ['5107', 'Freight in and handling'],
        ['5108', 'Import duties and customs charges'],
        ['5109', 'Packaging costs'],
        ['5110', 'Inventory write-downs', 'cur' => 'base_only'],
        ['5111', 'Inventory count differences', 'cur' => 'base_only'],
    ]],
    ['52', 'Cost of services', 'expense', 'Direct Costs', ['cur' => 'any'], [
        ['5201', 'Direct labour'],
        ['5202', 'Subcontractors'],
        ['5203', 'Direct project expenses'],
        ['5205', 'Delivery and freight out'],
        ['5207', 'Payment processing fees', 'd' => 'Card and gateway fees on sales.'],
    ]],
    ['53', 'Production costs', 'expense', 'Direct Costs', ['cur' => 'any', 'h' => 1], [
        ['5301', 'Production wages'],
        ['5302', 'Factory rent and utilities'],
        ['5303', 'Manufacturing consumables'],
    ]],

    // ---------------------------------------------------------------- 6 operating expenses
    ['61', 'Employee costs', 'expense', 'Operating Expense', ['cur' => 'any'], [
        ['6101', 'Salaries and wages', 'e' => 'WagesAndSalaries', 'cur' => 'base_only'],
        ['6102', 'Overtime', 'cur' => 'base_only'],
        ['6103', 'Bonuses and commissions', 'cur' => 'base_only'],
        ['6104', 'Employer social security', 'e' => 'SocialSecurityContributions', 'cur' => 'base_only'],
        ['6105', 'Employer pension contributions', 'cur' => 'base_only'],
        ['6106', 'Health and medical benefits', 'cur' => 'base_only'],
        ['6107', 'Staff training'],
        ['6108', 'Staff welfare and meals'],
        ['6109', 'Recruitment costs'],
        ['6110', 'Leave pay', 'cur' => 'base_only'],
        ['6111', 'End-of-service and severance', 'e' => 'TerminationBenefitsExpense', 'cur' => 'base_only', 'h' => 1],
        ['6112', 'Directors remuneration', 'cur' => 'base_only', 'h' => 1],
        ['6113', 'Share-based payment expense', 'cur' => 'base_only', 'h' => 1],
        ['6114', 'Payroll levies', 'cur' => 'base_only'],
    ]],
    ['62', 'Premises costs', 'expense', 'Operating Expense', ['cur' => 'any'], [
        ['6201', 'Rent'],
        ['6202', 'Short-term and low-value lease expense', 'h' => 1, 'd' => 'Leases kept off the balance sheet under the IFRS 16 exemptions.'],
        ['6204', 'Electricity'],
        ['6205', 'Water'],
        ['6206', 'Cleaning'],
        ['6207', 'Security'],
        ['6209', 'Building repairs and maintenance'],
    ]],
    ['63', 'Administration costs', 'expense', 'Operating Expense', ['cur' => 'any'], [
        ['6301', 'Office supplies and stationery'],
        ['6302', 'Printing and photocopying'],
        ['6303', 'Postage and courier'],
        ['6304', 'Telephone and internet'],
        ['6305', 'Software and subscriptions'],
        ['6306', 'IT support and maintenance'],
        ['6307', 'Accounting fees'],
        ['6308', 'Audit fees'],
        ['6309', 'Legal fees'],
        ['6310', 'Consulting fees'],
        ['6311', 'Insurance'],
        ['6312', 'Bank charges and fees'],
        ['6313', 'Licences and permits'],
        ['6314', 'Memberships and subscriptions'],
        ['6315', 'Donations', 'h' => 1],
        ['6318', 'Research and development expense', 'h' => 1],
    ]],
    ['64', 'Selling and marketing costs', 'expense', 'Operating Expense', ['cur' => 'any'], [
        ['6401', 'Advertising'],
        ['6402', 'Promotions and samples'],
        ['6405', 'Digital marketing'],
        ['6406', 'Customer entertainment'],
        ['6407', 'Delivery and distribution'],
    ]],
    ['65', 'Travel and vehicle costs', 'expense', 'Operating Expense', ['cur' => 'any'], [
        ['6501', 'Local travel'],
        ['6502', 'International travel'],
        ['6503', 'Accommodation'],
        ['6504', 'Meals while travelling'],
        ['6505', 'Fuel'],
        ['6506', 'Vehicle repairs and servicing'],
        ['6507', 'Parking and tolls'],
    ]],
    ['66', 'Repairs and maintenance', 'expense', 'Operating Expense', ['cur' => 'any'], [
        ['6601', 'Repairs: plant and machinery'],
        ['6602', 'Repairs: computers and IT equipment'],
        ['6603', 'Repairs: furniture and fittings'],
        ['6604', 'General maintenance'],
    ]],
    ['67', 'Depreciation, amortisation and impairment', 'expense', 'Operating Expense', ['cur' => 'base_only'], [
        ['6701', 'Depreciation: buildings'],
        ['6702', 'Depreciation: plant and machinery'],
        ['6703', 'Depreciation: motor vehicles'],
        ['6704', 'Depreciation: computers and IT equipment'],
        ['6705', 'Depreciation: furniture and fittings'],
        ['6706', 'Depreciation: office equipment'],
        ['6708', 'Depreciation: leasehold improvements'],
        ['6709', 'Depreciation: right-of-use buildings', 'h' => 1],
        ['6710', 'Depreciation: right-of-use vehicles', 'h' => 1],
        ['6711', 'Depreciation: right-of-use equipment', 'h' => 1],
        ['6721', 'Amortisation: computer software'],
        ['6722', 'Amortisation: licences and franchises', 'h' => 1],
        ['6723', 'Amortisation: patents and trademarks', 'h' => 1],
        ['6724', 'Amortisation: customer relationships', 'h' => 1],
        ['6725', 'Amortisation: development costs', 'h' => 1],
        ['6727', 'Amortisation: other intangibles', 'h' => 1],
    ]],
    ['68', 'Credit losses and other operating costs', 'expense', 'Operating Expense', ['cur' => 'base_only'], [
        ['6801', 'Bad debt expense', 'd' => 'Credit loss charge on receivables and write-offs beyond the allowance (IFRS 9).'],
        ['6802', 'Credit loss charge on other receivables', 'h' => 1],
        ['6803', 'Cash over and short'],
        ['6804', 'Penalties and fines'],
        ['6805', 'Irrecoverable VAT', 'cur' => 'any', 'd' => 'Input tax that cannot be recovered and is charged to cost.'],
        ['6809', 'Miscellaneous expenses', 'cur' => 'any'],
    ]],

    // ---------------------------------------------------------------- 7 other income and expense
    ['71', 'Other income', 'income', 'Other Income', ['cur' => 'base_only'], [
        ['7101', 'Gain on disposal of property, plant and equipment', 'e' => 'GainsLossesOnDisposalsOfPropertyPlantAndEquipment'],
        ['7102', 'Gain on disposal of intangible assets', 'h' => 1],
        ['7104', 'Reversal of impairment loss', 'h' => 1, 'd' => 'Not used for goodwill, whose impairment is never reversed (IAS 36.124).'],
        ['7105', 'Bad debts recovered', 'd' => 'Amounts received on receivables already written off.'],
        ['7106', 'Government grants income', 'h' => 1],
        ['7107', 'Insurance claim income', 'h' => 1],
        ['7108', 'Rental income (non-operating)', 'cur' => 'any', 'h' => 1],
        ['7109', 'Gain on revaluation through profit or loss', 'h' => 1],
        ['7110', 'Write-back of provisions', 'h' => 1],
        ['7119', 'Sundry income', 'cur' => 'any'],
    ]],
    ['72', 'Foreign exchange gains', 'income', 'Other Income', ['cur' => 'base_only'], [
        ['7201', 'Realised foreign exchange gain', 'd' => 'Gains from settling foreign-currency invoices and bills.'],
        ['7202', 'Unrealised foreign exchange gain', 'd' => 'Gains from revaluing open foreign-currency balances at period end.'],
    ]],
    ['73', 'Finance income', 'income', 'Other Income', ['cur' => 'any'], [
        ['7301', 'Interest income: bank'],
        ['7302', 'Interest income: loans receivable', 'h' => 1],
        ['7303', 'Interest income: deposits', 'h' => 1],
        ['7305', 'Dividend income', 'h' => 1],
        ['7306', 'Unwinding of discount on receivables', 'cur' => 'base_only', 'h' => 1],
    ]],
    ['75', 'Other expenses', 'expense', 'Other Expense', ['cur' => 'base_only'], [
        ['7501', 'Rounding differences', 'd' => 'Receives the rounding residue that foreign-currency documents leave.'],
        ['7502', 'Loss on disposal of property, plant and equipment', 'e' => 'GainsLossesOnDisposalsOfPropertyPlantAndEquipment'],
        ['7503', 'Loss on disposal of intangible assets', 'h' => 1],
        ['7505', 'Impairment loss: property, plant and equipment', 'e' => 'ImpairmentLossRecognisedInProfitOrLossPropertyPlantAndEquipment', 'h' => 1, 'd' => 'Also used for the decrease on a revalued asset once its reserve is used.'],
        ['7506', 'Impairment loss: intangible assets', 'e' => 'ImpairmentLossRecognisedInProfitOrLossIntangibleAssetsOtherThanGoodwill', 'h' => 1],
        ['7507', 'Impairment loss: goodwill', 'e' => 'ImpairmentLossRecognisedInProfitOrLossGoodwill', 'h' => 1],
        ['7508', 'Impairment loss: investments', 'h' => 1],
        ['7512', 'Restructuring costs', 'h' => 1],
        ['7519', 'Sundry expenses', 'cur' => 'any'],
    ]],
    ['76', 'Foreign exchange losses', 'expense', 'Other Expense', ['cur' => 'base_only'], [
        ['7601', 'Realised foreign exchange loss', 'd' => 'Losses from settling foreign-currency invoices and bills.'],
        ['7602', 'Unrealised foreign exchange loss', 'd' => 'Losses from revaluing open foreign-currency balances at period end.'],
    ]],
    ['77', 'Finance costs', 'expense', 'Other Expense', ['cur' => 'any'], [
        ['7701', 'Interest expense: bank loans', 'e' => 'InterestExpenseOnBankLoansAndOverdrafts'],
        ['7702', 'Interest expense: overdraft', 'e' => 'InterestExpenseOnBankLoansAndOverdrafts'],
        ['7703', 'Interest expense: lease liabilities', 'e' => 'InterestExpenseOnLeaseLiabilities', 'h' => 1],
        ['7704', 'Interest expense: shareholder and intercompany loans', 'h' => 1],
        ['7705', 'Interest on late payment to suppliers'],
        ['7706', 'Unwinding of discount on provisions', 'cur' => 'base_only', 'h' => 1],
        ['7707', 'Loan arrangement fees and facility charges'],
    ]],

    // ---------------------------------------------------------------- 8 tax and consolidation
    ['81', 'Income tax expense', 'expense', 'Other Expense', ['cur' => 'base_only'], [
        ['8101', 'Current income tax expense', 'e' => 'CurrentTaxExpenseIncome'],
        ['8102', 'Deferred tax expense', 'e' => 'DeferredTaxExpenseIncome', 'h' => 1],
        ['8104', 'Irrecoverable withholding tax', 'h' => 1],
    ]],
    ['82', 'Consolidation: income eliminations', 'income', 'Operating Revenue', ['cur' => 'base_only', 'h' => 1], [
        ['8201', 'Intercompany revenue elimination', 'n' => 'debit', 'd' => 'Carries a debit balance.'],
    ]],
    ['83', 'Consolidation: expense eliminations', 'expense', 'Other Expense', ['cur' => 'base_only', 'h' => 1], [
        ['8301', 'Intercompany cost elimination', 'n' => 'credit', 'd' => 'Carries a credit balance.'],
        ['8303', 'Unrealised profit in inventory elimination'],
    ]],
    ['84', 'Consolidation: equity adjustments', 'equity', 'Reserves', ['cur' => 'base_only', 'h' => 1], [
        ['8401', 'Investment in subsidiaries elimination', 'n' => 'debit', 'd' => 'Carries a debit balance.'],
        ['8402', 'Pre-acquisition reserves elimination'],
        ['8403', 'Consolidation translation differences'],
    ]],
    ['85', 'Consolidation: balance sheet adjustments', 'asset', 'Current Assets', ['cur' => 'base_only', 'h' => 1], [
        ['8501', 'Fair value adjustments on acquisition'],
        ['8502', 'Intercompany balances elimination: receivables'],
    ]],
    ['86', 'Consolidation: balance sheet clearing', 'liability', 'Clearing', ['cur' => 'base_only', 'h' => 1], [
        ['8601', 'Intercompany balances elimination: payables'],
    ]],
];

$lines = [];
foreach ($groups as [$group, $groupName, $type, $subtype, $defaults, $rows]) {
    $lines[] = L::make($pad($group), $groupName, $type, $subtype);
    foreach ($rows as $row) {
        $lines[] = L::make(
            $pad($row[0]),
            $row[1],
            $type,
            $row['s'] ?? $subtype,
            $pad($group),
            control: $row['c'] ?? 'none',
            currency: $row['cur'] ?? $defaults['cur'] ?? 'base_only',
            normal: $row['n'] ?? null,
            description: $row['d'] ?? null,
            ifrsElement: $row['e'] ?? null,
            hidden: (bool) ($row['h'] ?? $defaults['h'] ?? false),
        );
    }
}

return [
    'code' => 'comprehensive',
    // posting key → the line that plays that role, set on the company when the template is applied.
    'posting_accounts' => [
        'ar_control' => '12010000', 'ap_control' => '21010000', 'tax_output' => '23010000', 'tax_input' => '13010000',
        'wht_payable' => '23050000', 'retained_earnings' => '32010000', 'fx_realised' => '72010000',
        'fx_realised_loss' => '76010000', 'fx_unrealised' => '72020000', 'fx_unrealised_loss' => '76020000',
        'rounding' => '75010000', 'suspense' => '29010000', 'bank_clearing' => '11150000',
        'bank_in_transit' => '11160000', 'bad_debt_expense' => '68010000', 'bad_debt_recovery' => '71050000',
        'credit_loss_allowance' => '12020000', 'asset_disposal_gain' => '71010000', 'asset_disposal_loss' => '75020000',
        'impairment_loss' => '75050000', 'impairment_reversal' => '71040000', 'revaluation_reserve' => '33010000',
        'translation_reserve' => '33020000', 'goodwill' => '17010000', 'non_controlling_interests' => '34010000',
        'reverse_charge_output' => '23020000', 'reverse_charge_input' => '13020000', 'withholding_vat_receivable' => '13050000',
    ],
    'name' => 'Comprehensive (IFRS)',
    'country' => null,
    'standard' => 'IFRS',
    'recommended' => true,
    'lines' => $lines,
];
