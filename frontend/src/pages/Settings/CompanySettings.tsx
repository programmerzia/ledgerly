import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLedgerStore } from '@/mock/store';
import { formatMoney } from '@/lib/format';
import { FieldHelp } from '@/components/domain/FieldHelp';
import { PageHeader } from '@/components/domain/PageHeader';
import { Avatar } from '@/components/ui/avatar';
import { Switch } from '@/components/ui/switch';
import { Palette, CreditCard, Tags, Undo2, Info, Building, Layers, Hash, Users, Percent, ShieldCheck, Save } from 'lucide-react';
import { toast } from 'sonner';
import { SettingsCard, Field, FieldGrid, inputCls } from './settings-ui';

type SettingsTab =
  | 'general'
  | 'branding'
  | 'numbering'
  | 'tax'
  | 'posting'
  | 'dimensions'
  | 'users'
  | 'security'
  | 'billing';

export const CompanySettings: React.FC = () => {
  const navigate = useNavigate();
  const {
    currentCompany,
    currentUser,
    users,
    accounts,
    taxCodes,
    companySettings,
    updatePostingAccounts,
    updateNumbering,
    updateApprovalWorkflows,
  } = useLedgerStore();

  const [activeTab, setActiveTab] = useState<SettingsTab>('general');

  // Profile fields
  const [legalName, setLegalName] = useState(currentCompany.legal_name);
  const [taxId, setTaxId] = useState(currentCompany.tax_id);

  // Posting accounts
  const [posting, setPosting] = useState(companySettings.posting_accounts);

  // Numbering
  const [numbering, setNumbering] = useState(companySettings.numbering);

  // Workflows
  const [workflows, setWorkflows] = useState(companySettings.approval_workflows);

  // Security policy
  const [pinLockoutAttempts, setPinLockoutAttempts] = useState(3);
  const [pinLockoutDurationSeconds, setPinLockoutDurationSeconds] = useState(30);
  const [cachedSignatureDurationMinutes, setCachedSignatureDurationMinutes] = useState(2);

  // Tax Rounding (0.2, D2)
  const [taxRounding, setTaxRounding] = useState<'document_per_code' | 'line'>(
    companySettings.tax_rounding || 'document_per_code'
  );

  const snapshot = () =>
    JSON.stringify({ legalName, taxId, posting, numbering, workflows, taxRounding, pinLockoutAttempts, pinLockoutDurationSeconds, cachedSignatureDurationMinutes });
  const [baseline, setBaseline] = useState(() => snapshot());
  const dirty = snapshot() !== baseline;

  const handleDiscard = () => {
    const b = JSON.parse(baseline);
    setLegalName(b.legalName);
    setTaxId(b.taxId);
    setPosting(b.posting);
    setNumbering(b.numbering);
    setWorkflows(b.workflows);
    setTaxRounding(b.taxRounding);
    setPinLockoutAttempts(b.pinLockoutAttempts);
    setPinLockoutDurationSeconds(b.pinLockoutDurationSeconds);
    setCachedSignatureDurationMinutes(b.cachedSignatureDurationMinutes);
  };

  const handleSave = () => {
    updatePostingAccounts(posting);
    updateNumbering(numbering);
    updateApprovalWorkflows(workflows);

    useLedgerStore.setState((s: any) => ({
      companySettings: {
        ...s.companySettings,
        tax_rounding: taxRounding,
      },
    }));

    setBaseline(snapshot());
    toast.success('Company settings saved successfully');
  };

  const navItems: { id: SettingsTab; label: string; icon: React.ElementType; hint: string }[] = [
    { id: 'general', label: 'General', icon: Building, hint: 'Company details' },
    { id: 'branding', label: 'Branding', icon: Palette, hint: 'Logo and look' },
    { id: 'numbering', label: 'Numbering', icon: Hash, hint: 'Document numbers' },
    { id: 'tax', label: 'Tax', icon: Percent, hint: 'Rates and rounding' },
    { id: 'posting', label: 'Posting accounts', icon: Layers, hint: 'Automatic entries' },
    { id: 'dimensions', label: 'Dimensions', icon: Tags, hint: 'Tracking categories' },
    { id: 'users', label: 'Users & roles', icon: Users, hint: 'Who can do what' },
    { id: 'security', label: 'Security', icon: ShieldCheck, hint: 'PIN and approvals' },
    { id: 'billing', label: 'Billing', icon: CreditCard, hint: 'Plan and invoices' },
  ];

  const postingFields: { key: keyof typeof posting; label: string; help: string; example: string }[] = [
    { key: 'ar_control', label: 'Money customers owe you', help: 'Where customer invoices are recorded until they are paid.', example: '1200 Accounts Receivable' },
    { key: 'ap_control', label: 'Money you owe suppliers', help: 'Where supplier bills are recorded until you pay them.', example: '2000 Accounts Payable' },
    { key: 'tax_output', label: 'Sales tax collected', help: 'Tax charged on sales that you will pass on to the tax authority.', example: '2110 VAT Output' },
    { key: 'tax_input', label: 'Purchase tax paid', help: 'Tax paid on purchases that you can claim back.', example: '1310 VAT Input' },
    { key: 'wht_payable', label: 'Tax withheld from suppliers', help: 'Tax you hold back from supplier payments and owe to the tax authority.', example: '2120 WHT Payable' },
    { key: 'fx_realised', label: 'Exchange gain or loss', help: 'Difference booked when a foreign-currency invoice is settled at a different rate.', example: '4900 Realised FX Gain' },
    { key: 'retained_earnings', label: 'Retained earnings', help: 'Where the year’s profit is moved when you close the financial year.', example: '3000 Retained Earnings' },
    { key: 'rounding', label: 'Rounding differences', help: 'Catches tiny cent differences from currency conversion.', example: '6990 Rounding Discrepancy' },
  ];

  const prefixFields: { key: 'invoice_prefix' | 'bill_prefix' | 'journal_prefix' | 'payment_prefix'; label: string; help: string; example: string; sample: string }[] = [
    { key: 'invoice_prefix', label: 'Sales invoices', help: 'Text placed before each invoice number.', example: 'INV-', sample: '2026-0043' },
    { key: 'bill_prefix', label: 'Supplier bills', help: 'Text placed before each bill number.', example: 'BILL-', sample: '2026-0016' },
    { key: 'journal_prefix', label: 'Journals', help: 'Text placed before each manual journal number.', example: 'JRN-', sample: '2026-0103' },
    { key: 'payment_prefix', label: 'Payments', help: 'Text placed before each payment or receipt number.', example: 'PAY-', sample: '2026-0012' },
  ];

  const thresholdFields: { key: 'invoice_threshold' | 'bill_threshold' | 'journal_threshold' | 'require_dual_approval_over'; label: string; help: string; hint: string }[] = [
    { key: 'invoice_threshold', label: 'Invoices needing review above', help: 'Invoices above this amount need a second person to approve.', hint: 'A reviewer checks invoices over this amount' },
    { key: 'bill_threshold', label: 'Bills needing review above', help: 'Bills above this amount need a second person to approve.', hint: 'A reviewer checks bills over this amount' },
    { key: 'journal_threshold', label: 'Journals needing review above', help: 'Manual journals above this amount need a second person to approve.', hint: 'A reviewer checks journals over this amount' },
    { key: 'require_dual_approval_over', label: 'Two approvers needed above', help: 'Above this amount two different people must sign.', hint: 'Finance manager and CFO both sign' },
  ];

  const active = navItems.find((n) => n.id === activeTab)!;
  const th = (c = '') => `px-4 text-[11px] font-semibold uppercase tracking-wide text-text-muted ${c}`;

  return (
    <div className="flex h-full flex-1 flex-col overflow-hidden bg-surface-canvas">
      <div className="shrink-0 border-b border-border bg-surface px-6 py-4">
        <PageHeader
          breadcrumb={[{ label: 'Settings' }, { label: active.label }]}
          title="Company settings"
          subtitle={`${currentCompany.name} · how your books are set up and protected`}
          actions={
            <button
              type="button"
              onClick={() => navigate(`/${currentCompany.slug}/import`)}
              className="h-8 rounded-md border border-border bg-surface px-3 text-[13px] font-medium text-text-primary transition hover:bg-surface-neutral"
            >
              Import data
            </button>
          }
        />
      </div>

      <div className="flex flex-1 flex-col overflow-hidden md:flex-row">
        <aside className="shrink-0 overflow-x-auto border-b border-border bg-surface p-3 md:w-60 md:overflow-y-auto md:border-b-0 md:border-r">
          <nav aria-label="Settings sections" className="flex gap-1 md:flex-col">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveTab(item.id)}
                  aria-current={isActive ? 'page' : undefined}
                  className={`group relative flex shrink-0 items-center gap-2.5 rounded-md px-3 py-2 text-left text-[13px] font-medium transition-colors ${
                    isActive ? 'bg-surface-neutral text-text-primary' : 'text-text-secondary hover:bg-surface-neutral hover:text-text-primary'
                  }`}
                >
                                    <Icon className="size-4 shrink-0 text-text-muted" />
                  <span className="whitespace-nowrap">{item.label}</span>
                </button>
              );
            })}
          </nav>
        </aside>

        <main className="flex flex-1 flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto p-6">
            <div key={activeTab} className="mx-auto flex max-w-3xl flex-col gap-5">
              <div>
                <h2 className="text-base font-semibold text-text-primary">{active.label}</h2>
                <p className="text-[13px] text-text-muted">{active.hint}</p>
              </div>

              {activeTab === 'general' && (
                <>
                  <SettingsCard title="Company details" description="Shown on invoices and reports.">
                    <FieldGrid>
                      <Field label="Legal name">
                        <input type="text" value={legalName} onChange={(e) => setLegalName(e.target.value)} className={inputCls} />
                      </Field>
                      <Field label="Tax ID" hint="Printed on invoices you issue.">
                        <input type="text" value={taxId} onChange={(e) => setTaxId(e.target.value)} className={`${inputCls} font-mono`} />
                      </Field>
                    </FieldGrid>
                  </SettingsCard>
                  <SettingsCard title="Currency and country" description="Set when the company was created.">
                    <FieldGrid>
                      <Field label="Main currency" hint="All reports are shown in this currency.">
                        <div className={`${inputCls} flex items-center bg-surface-neutral font-mono`}>{currentCompany.base_currency}</div>
                      </Field>
                      <Field label="Country">
                        <div className={`${inputCls} flex items-center bg-surface-neutral`}>{currentCompany.country}</div>
                      </Field>
                    </FieldGrid>
                  </SettingsCard>
                </>
              )}

              {activeTab === 'branding' && (
                <SettingsCard title="Logo and document look" description="How your company appears to customers.">
                  <div className="flex flex-col gap-5">
                    <div className="flex items-center gap-4">
                      <Avatar name={currentCompany.name} size="lg" square className="size-14 text-lg" />
                      <div className="flex flex-col gap-1.5">
                        <span className="text-[13px] font-medium text-text-primary">{currentCompany.name}</span>
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-4 border-t border-border pt-4">
                      <div>
                        <div className="text-[13px] font-medium text-text-primary">Show logo on invoices</div>
                        <div className="text-xs text-text-muted">Your logo appears at the top of every PDF.</div>
                      </div>
                      <Switch defaultChecked aria-label="Show logo on invoices" />
                    </div>
                  </div>
                </SettingsCard>
              )}

              {activeTab === 'numbering' && (
                <SettingsCard title="Document numbers" description="Numbers run in order with no gaps, so every document can be traced.">
                  <FieldGrid>
                    {prefixFields.map((f) => (
                      <Field key={f.key} label={f.label} help={f.help} example={f.example}>
                        <div className="flex items-center gap-3">
                          <input
                            type="text"
                            value={numbering[f.key]}
                            onChange={(e) => setNumbering({ ...numbering, [f.key]: e.target.value })}
                            className={`${inputCls} w-28 font-mono`}
                          />
                          <span className="rounded-md bg-surface-neutral px-2 py-1 font-mono text-xs text-text-muted">
                            {numbering[f.key]}{f.sample}
                          </span>
                        </div>
                      </Field>
                    ))}
                  </FieldGrid>
                </SettingsCard>
              )}

              {activeTab === 'tax' && (
                <>
                  <SettingsCard title="Tax rounding" description="Choose how tax is rounded on invoices and bills.">
                    <div className="max-w-md">
                      <Field
                        label="Rounding method"
                        help="Default adds up tax for each tax code and rounds once. 'Per line' rounds every line on its own."
                        example="Per document, per tax code"
                        hint={
                          taxRounding === 'document_per_code'
                            ? 'Tax is added up for each tax code, then rounded once.'
                            : 'Tax is rounded on every invoice and bill line separately.'
                        }
                      >
                        <select
                          value={taxRounding}
                          onChange={(e) => setTaxRounding(e.target.value as 'document_per_code' | 'line')}
                          className={inputCls}
                        >
                          <option value="document_per_code">Per document, per tax code (recommended)</option>
                          <option value="line">Per line</option>
                        </select>
                      </Field>
                    </div>
                  </SettingsCard>
                  <section className="overflow-hidden rounded-lg border border-border bg-surface">
                    <table className="w-full border-collapse text-left text-[13px]">
                      <thead>
                        <tr className="h-9 border-b border-border bg-surface-neutral">
                          <th className={th()}>Code</th>
                          <th className={th()}>Name</th>
                          <th className={th('text-right')}>Rate</th>
                          <th className={th()}>Since</th>
                          <th className={th()}>Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {taxCodes.map((tc) => (
                          <tr key={tc.id} className="h-11 transition hover:bg-canvas">
                            <td className="px-4 font-mono font-medium text-text-primary">{tc.code}</td>
                            <td className="px-4 font-medium text-text-primary">{tc.name}</td>
                            <td className="px-4 text-right font-mono tabular-nums text-text-primary">{(tc.rate * 100).toFixed(1)}%</td>
                            <td className="px-4 text-text-muted">1 Jan 2026</td>
                            <td className="px-4">
                              <span className="inline-flex items-center gap-1.5 rounded-[3px] bg-success-soft px-2 py-0.5 text-xs font-medium text-success">
                                <span className="size-1.5 rounded-full bg-success" />Active
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </section>
                </>
              )}

              {activeTab === 'posting' && (
                <SettingsCard title="Automatic posting accounts"
                  description="Ledgerly uses these accounts when it records invoices, bills and payments for you."
                >
                  <FieldGrid>
                    {postingFields.map((f) => (
                      <Field key={f.key} label={f.label} help={f.help} example={f.example}>
                        <select
                          value={posting[f.key]}
                          onChange={(e) => setPosting({ ...posting, [f.key]: e.target.value })}
                          className={`${inputCls} font-mono`}
                        >
                          {accounts.map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.code} - {a.name}
                            </option>
                          ))}
                        </select>
                      </Field>
                    ))}
                  </FieldGrid>
                </SettingsCard>
              )}

              {activeTab === 'dimensions' && (
                <SettingsCard title="Tracking categories" description="Tag transactions by department, project or location to see profit for each.">
                  <div className="flex flex-col items-center gap-3 py-4 text-center">
                    <div>
                      <div className="text-[13px] font-medium text-text-primary">Tags are added while you enter a transaction</div>
                      <p className="mx-auto mt-1 max-w-sm text-xs text-text-muted">
                        Pick a department or project on any invoice, bill or journal line and reports can then be split by it.
                      </p>
                    </div>
                  </div>
                </SettingsCard>
              )}

              {activeTab === 'users' && (
                <section className="overflow-hidden rounded-lg border border-border bg-surface">
                  <table className="w-full border-collapse text-left text-[13px]">
                    <thead>
                      <tr className="h-9 border-b border-border bg-surface-neutral">
                        <th className={th()}>Person</th>
                        <th className={th()}>Role</th>
                        <th className={th()}>Signing PIN</th>
                        <th className={th('text-center')}>2-step sign-in</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {users.map((u) => (
                        <tr key={u.id} className="h-14 transition hover:bg-canvas">
                          <td className="px-4">
                            <div className="flex items-center gap-3">
                              <Avatar name={u.name} />
                              <div className="min-w-0">
                                <div className="font-medium text-text-primary">{u.name}</div>
                                <div className="truncate text-xs text-text-muted">{u.email}</div>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 text-text-primary">{u.roleTitle}</td>
                          <td className="px-4 font-mono text-text-muted">{'••••••'}</td>
                          <td className="px-4 text-center">
                            <span className="inline-flex items-center gap-1.5 rounded-[3px] bg-success-soft px-2 py-0.5 text-xs font-medium text-success">
                              <span className="size-1.5 rounded-full bg-success" />On
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
              )}

              {activeTab === 'security' && (
                <>
                  <SettingsCard title="Signing PIN rules" description="Approvals are signed with a personal PIN. These rules protect it.">
                    <FieldGrid>
                      <Field label="Wrong PIN attempts allowed" help="Number of failed PIN entries before signing is paused." example="3" hint="Signing pauses after this many mistakes.">
                        <input type="number" value={pinLockoutAttempts} onChange={(e) => setPinLockoutAttempts(parseInt(e.target.value, 10) || 3)} className={`${inputCls} font-mono`} />
                      </Field>
                      <Field label="Pause length (seconds)" help="How long signing stays paused after too many mistakes." example="30" hint="Default: 30 seconds.">
                        <input type="number" value={pinLockoutDurationSeconds} onChange={(e) => setPinLockoutDurationSeconds(parseInt(e.target.value, 10) || 30)} className={`${inputCls} font-mono`} />
                      </Field>
                      <Field label="Remember my PIN for (minutes)" help="After a successful signature, further approvals need only one click within this window." example="2" hint="Default: 2 minutes.">
                        <input type="number" value={cachedSignatureDurationMinutes} onChange={(e) => setCachedSignatureDurationMinutes(parseInt(e.target.value, 10) || 2)} className={`${inputCls} font-mono`} />
                      </Field>
                    </FieldGrid>
                  </SettingsCard>
                  <SettingsCard title="Approval limits"
                    description="The person who creates a document can never approve it. Set when a second person must review."
                  >
                    <FieldGrid>
                      {thresholdFields.map((f) => (
                        <Field key={f.key} label={f.label} help={f.help} hint={f.hint}>
                          <div className="relative">
                            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[13px] text-text-muted">$</span>
                            <input
                              type="number"
                              value={workflows[f.key] / 100}
                              onChange={(e) => setWorkflows({ ...workflows, [f.key]: Math.round((parseFloat(e.target.value) || 0) * 100) })}
                              className={`${inputCls} w-full pl-6 text-right font-mono tabular-nums`}
                            />
                          </div>
                        </Field>
                      ))}
                    </FieldGrid>
                  </SettingsCard>
                </>
              )}

              {activeTab === 'billing' && (
                <SettingsCard title="Your plan" description="Billing is managed by the account owner.">
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <div>
                        <div className="text-[13px] font-semibold text-text-primary">Business plan</div>
                        <div className="text-xs text-text-muted">All features included · {users.length} seats in use</div>
                      </div>
                    </div>
                  </div>
                </SettingsCard>
              )}
            </div>
          </div>

          {dirty && (
            <div role="region" aria-label="Unsaved changes" className="shrink-0 border-t border-border bg-surface px-6 py-3">
              <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
                <span className="flex items-center gap-2 text-[13px] text-text-secondary">
                  <Info className="size-4 text-warning" />
                  You have unsaved changes
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleDiscard}
                    className="flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[13px] font-medium text-text-primary transition hover:bg-surface-neutral"
                  >
                    <Undo2 className="size-3.5" />Discard
                  </button>
                  <button
                    type="button"
                    onClick={handleSave}
                    className="flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-[13px] font-medium text-white transition hover:bg-accent-hover"
                  >
                    <Save className="size-3.5" />Save changes
                  </button>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
};
