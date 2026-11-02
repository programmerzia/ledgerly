/** Report routes: the mock screen in mock mode, the live one in live mode (docs/15 "Done in 3.8"). */
import React from 'react';
import { selectByMode } from '@/data/select';
import { TrialBalance } from '../TrialBalance';
import { ProfitAndLoss } from '../ProfitAndLoss';
import { BalanceSheet } from '../BalanceSheet';
import { CashFlow } from '../CashFlow';
import { AgingReport } from '../AgingReport';
import { GeneralLedger } from '../GeneralLedger';
import { TaxReturn } from '../TaxReturn';
import { LiveTrialBalance } from './LiveTrialBalance';
import { LiveProfitAndLoss } from './LiveProfitAndLoss';
import { LiveBalanceSheet } from './LiveBalanceSheet';
import { LiveCashFlow } from './LiveCashFlow';
import { LiveAging } from './LiveAging';
import { LiveGeneralLedger } from './LiveGeneralLedger';
import { LiveTaxReturn } from './LiveTaxReturn';

type Screen = React.ComponentType;
export const TrialBalanceScreen: Screen = selectByMode<Screen>({ mock: TrialBalance, live: LiveTrialBalance });
export const ProfitAndLossScreen: Screen = selectByMode<Screen>({ mock: ProfitAndLoss, live: LiveProfitAndLoss });
export const BalanceSheetScreen: Screen = selectByMode<Screen>({ mock: BalanceSheet, live: LiveBalanceSheet });
export const CashFlowScreen: Screen = selectByMode<Screen>({ mock: CashFlow, live: LiveCashFlow });
export const AgingScreen: Screen = selectByMode<Screen>({ mock: AgingReport, live: LiveAging });
export const GeneralLedgerScreen: Screen = selectByMode<Screen>({ mock: GeneralLedger, live: LiveGeneralLedger });
export const TaxReturnScreen: Screen = selectByMode<Screen>({ mock: TaxReturn, live: LiveTaxReturn });
export { LiveStatement } from './LiveStatement';
