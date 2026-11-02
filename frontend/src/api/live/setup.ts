/** Live onboarding calls (02_AppFlow §3): chart templates, accounts, tax codes. */
import { http } from '../http';
import type { components } from '../schema';

export type ApiChartTemplate = components['schemas']['ChartTemplateResource'];
export type ApiTaxCode = components['schemas']['TaxCodeResource'];
export type TaxCodeBody = components['schemas']['TaxCodeRequest'];

export async function fetchChartTemplates(companyId: string): Promise<ApiChartTemplate[]> {
  return (await http.get('/v1/companies/{company}/chart-templates', { path: { company: companyId } })).data;
}

export async function applyChartTemplate(companyId: string, templateCode: string): Promise<{ template_code: string; accounts_created: number }> {
  return (await http.post('/v1/companies/{company}/apply-chart-template', { path: { company: companyId }, body: { template_code: templateCode } })).data;
}

/** Whether the company has any account at all (one row is enough to know). */
export async function hasAccounts(companyId: string): Promise<boolean> {
  const page = await http.get('/v1/companies/{company}/accounts', { path: { company: companyId }, query: { limit: 1 } });
  return page.data.length > 0;
}

export async function fetchTaxCodes(companyId: string): Promise<ApiTaxCode[]> {
  return (await http.get('/v1/companies/{company}/tax-codes', { path: { company: companyId }, query: { limit: 100 } })).data;
}

export async function createTaxCode(companyId: string, body: TaxCodeBody): Promise<ApiTaxCode> {
  return (await http.post('/v1/companies/{company}/tax-codes', { path: { company: companyId }, body })).data;
}
