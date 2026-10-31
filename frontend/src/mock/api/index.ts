/**
 * Master API entry point with modular async endpoints conforming to 08_Mock_Refactor_Prompt.md Block A.
 */

export * from './client';
export * from './session';
export * from './ledger';
export * from './documents';
export * from './banking';
export * from './fx';
export * from './assets';
export * from './budgets';
export * from './settings';
export * from './audit';

import * as sessionApi from './session';
import * as ledgerApi from './ledger';
import * as documentsApi from './documents';
import * as bankingApi from './banking';
import * as fxApi from './fx';
import * as assetsApi from './assets';
import * as budgetsApi from './budgets';
import * as settingsApi from './settings';
import * as auditApi from './audit';

export const api = {
  ...sessionApi,
  ...ledgerApi,
  ...documentsApi,
  ...bankingApi,
  ...fxApi,
  ...assetsApi,
  ...budgetsApi,
  ...settingsApi,
  ...auditApi,
};
