import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLedgerStore } from '@/mock/store';
import { formatMoney } from '@/lib/format';
import {
  Settings,
  Building,
  Layers,
  Hash,
  CheckSquare,
  Users,
  ShieldCheck,
  Save,
  CheckCircle2,
  Lock,
} from 'lucide-react';

export const CompanySettings: React.FC = () => {
  const navigate = useNavigate();
  const {
    currentCompany,
    currentUser,
    users,
    accounts,
    companySettings,
    updatePostingAccounts,
    updateNumbering,
    updateApprovalWorkflows,
  } = useLedgerStore();

  const [activeTab, setActiveTab] = useState<'profile' | 'posting' | 'numbering' | 'workflows' | 'users'>('profile');
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Profile fields
  const [legalName, setLegalName] = useState(currentCompany.legal_name);
  const [taxId, setTaxId] = useState(currentCompany.tax_id);

  // Posting accounts
  const [posting, setPosting] = useState(companySettings.posting_accounts);

  // Numbering
  const [numbering, setNumbering] = useState(companySettings.numbering);

  // Workflows
  const [workflows, setWorkflows] = useState(companySettings.approval_workflows);

  const handleSave = () => {
    updatePostingAccounts(posting);
    updateNumbering(numbering);
    updateApprovalWorkflows(workflows);

    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 2500);
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-y-auto bg-surface-canvas p-6">
      <div className="max-w-4xl mx-auto w-full flex flex-col gap-6">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-line-border">
          <div className="flex items-center gap-3">
            <Settings className="w-5 h-5 text-brand-teal" />
            <div>
              <h1 className="text-base font-bold text-ink-900">Company & Ledger Controls Settings</h1>
              <p className="text-xs text-ink-muted">
                System Rules, Mandatory Posting Accounts, Numbering & Segregation of Duties
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleSave}
            className="h-8 px-4 bg-brand-teal hover:bg-brand-teal-hover text-white rounded-sm font-semibold text-xs shadow-2xs transition flex items-center gap-1.5"
          >
            <Save className="w-3.5 h-3.5" />
            <span>Save Settings</span>
          </button>
        </div>

        {saveSuccess && (
          <div className="p-3 bg-success/10 border border-success/30 rounded-md text-success text-xs flex items-center gap-2 animate-in fade-in duration-100">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>Settings saved and applied to all ledger posting rules.</span>
          </div>
        )}

        {/* Tab Strip */}
        <div className="flex items-center gap-1 bg-surface-subtle p-1 rounded-sm border border-line-border text-xs">
          {[
            { id: 'profile', label: 'Company Profile', icon: Building },
            { id: 'posting', label: 'Posting Accounts', icon: Layers },
            { id: 'numbering', label: 'Numbering Rules', icon: Hash },
            { id: 'workflows', label: 'Approval Thresholds', icon: CheckSquare },
            { id: 'users', label: 'Users & Permissions', icon: Users },
          ].map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id as any)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded font-medium transition ${
                  activeTab === tab.id
                    ? 'bg-surface-elevated text-ink-900 font-semibold shadow-2xs'
                    : 'text-ink-muted hover:text-ink-900'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* TAB 1: Profile */}
        {activeTab === 'profile' && (
          <div className="p-5 bg-surface-elevated border border-line-border rounded-md shadow-2xs flex flex-col gap-4 text-xs animate-in fade-in duration-150">
            <span className="font-bold text-ink-900 uppercase tracking-wider text-[11px]">
              Organization Details
            </span>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-semibold text-ink-muted uppercase">Company Legal Name</label>
                <input
                  type="text"
                  value={legalName}
                  onChange={(e) => setLegalName(e.target.value)}
                  className="h-8 px-2.5 rounded-sm border border-line-border bg-surface-subtle text-ink-900 font-medium"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-semibold text-ink-muted uppercase">Tax Identification (TIN)</label>
                <input
                  type="text"
                  value={taxId}
                  onChange={(e) => setTaxId(e.target.value)}
                  className="h-8 px-2.5 font-mono rounded-sm border border-line-border bg-surface-subtle text-ink-900 font-medium"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-semibold text-ink-muted uppercase">Base Currency</label>
                <div className="h-8 px-2.5 flex items-center rounded-sm border border-line-border bg-surface-neutral font-mono font-medium text-ink-900">
                  {currentCompany.base_currency} (USD - United States Dollar)
                </div>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-semibold text-ink-muted uppercase">Jurisdiction & Country</label>
                <div className="h-8 px-2.5 flex items-center rounded-sm border border-line-border bg-surface-neutral font-medium text-ink-900">
                  {currentCompany.country} (Federal Republic of Somalia)
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: Posting Accounts */}
        {activeTab === 'posting' && (
          <div className="p-5 bg-surface-elevated border border-line-border rounded-md shadow-2xs flex flex-col gap-4 text-xs animate-in fade-in duration-150">
            <div>
              <span className="font-bold text-ink-900 uppercase tracking-wider text-[11px] block">
                Automatic Posting Accounts Mapping
              </span>
              <p className="text-[11px] text-ink-muted">
                System-controlled General Ledger accounts required for automated double-entry postings.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-semibold text-ink-muted uppercase">Accounts Receivable (AR Control)</label>
                <select
                  value={posting.ar_control}
                  onChange={(e) => setPosting({ ...posting, ar_control: e.target.value })}
                  className="h-8 px-2 rounded-sm border border-line-border bg-surface-subtle font-mono text-xs"
                >
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.code} - {a.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-semibold text-ink-muted uppercase">Accounts Payable (AP Control)</label>
                <select
                  value={posting.ap_control}
                  onChange={(e) => setPosting({ ...posting, ap_control: e.target.value })}
                  className="h-8 px-2 rounded-sm border border-line-border bg-surface-subtle font-mono text-xs"
                >
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.code} - {a.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-semibold text-ink-muted uppercase">Sales Tax Output (VAT Payable)</label>
                <select
                  value={posting.tax_output}
                  onChange={(e) => setPosting({ ...posting, tax_output: e.target.value })}
                  className="h-8 px-2 rounded-sm border border-line-border bg-surface-subtle font-mono text-xs"
                >
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.code} - {a.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-semibold text-ink-muted uppercase">Purchase Tax Input (VAT Recoverable)</label>
                <select
                  value={posting.tax_input}
                  onChange={(e) => setPosting({ ...posting, tax_input: e.target.value })}
                  className="h-8 px-2 rounded-sm border border-line-border bg-surface-subtle font-mono text-xs"
                >
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.code} - {a.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-semibold text-ink-muted uppercase">Withholding Tax (WHT) Payable</label>
                <select
                  value={posting.wht_payable}
                  onChange={(e) => setPosting({ ...posting, wht_payable: e.target.value })}
                  className="h-8 px-2 rounded-sm border border-line-border bg-surface-subtle font-mono text-xs"
                >
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.code} - {a.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-semibold text-ink-muted uppercase">Realised FX Gain / Loss</label>
                <select
                  value={posting.fx_realised}
                  onChange={(e) => setPosting({ ...posting, fx_realised: e.target.value })}
                  className="h-8 px-2 rounded-sm border border-line-border bg-surface-subtle font-mono text-xs"
                >
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.code} - {a.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-semibold text-ink-muted uppercase">Retained Earnings (Equity)</label>
                <select
                  value={posting.retained_earnings}
                  onChange={(e) => setPosting({ ...posting, retained_earnings: e.target.value })}
                  className="h-8 px-2 rounded-sm border border-line-border bg-surface-subtle font-mono text-xs"
                >
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.code} - {a.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-semibold text-ink-muted uppercase">Rounding Discrepancy Plug</label>
                <select
                  value={posting.rounding}
                  onChange={(e) => setPosting({ ...posting, rounding: e.target.value })}
                  className="h-8 px-2 rounded-sm border border-line-border bg-surface-subtle font-mono text-xs"
                >
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.code} - {a.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: Numbering Sequences */}
        {activeTab === 'numbering' && (
          <div className="p-5 bg-surface-elevated border border-line-border rounded-md shadow-2xs flex flex-col gap-4 text-xs animate-in fade-in duration-150">
            <div>
              <span className="font-bold text-ink-900 uppercase tracking-wider text-[11px] block">
                Gapless Sequential Numbering Rules
              </span>
              <p className="text-[11px] text-ink-muted">
                Document identifiers assigned sequentially upon posting. Gaps are prevented by controls-grade sequence locks.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-semibold text-ink-muted uppercase">Sales Invoice Prefix</label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={numbering.invoice_prefix}
                    onChange={(e) => setNumbering({ ...numbering, invoice_prefix: e.target.value })}
                    className="h-8 px-2 font-mono rounded-sm border border-line-border bg-surface-subtle w-32"
                  />
                  <span className="text-[11px] font-mono text-ink-muted">
                    Preview: {numbering.invoice_prefix}2026-0043
                  </span>
                </div>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-semibold text-ink-muted uppercase">Supplier Bill Prefix</label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={numbering.bill_prefix}
                    onChange={(e) => setNumbering({ ...numbering, bill_prefix: e.target.value })}
                    className="h-8 px-2 font-mono rounded-sm border border-line-border bg-surface-subtle w-32"
                  />
                  <span className="text-[11px] font-mono text-ink-muted">
                    Preview: {numbering.bill_prefix}2026-0016
                  </span>
                </div>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-semibold text-ink-muted uppercase">Journal Prefix</label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={numbering.journal_prefix}
                    onChange={(e) => setNumbering({ ...numbering, journal_prefix: e.target.value })}
                    className="h-8 px-2 font-mono rounded-sm border border-line-border bg-surface-subtle w-32"
                  />
                  <span className="text-[11px] font-mono text-ink-muted">
                    Preview: {numbering.journal_prefix}2026-0103
                  </span>
                </div>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-semibold text-ink-muted uppercase">Payment Prefix</label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={numbering.payment_prefix}
                    onChange={(e) => setNumbering({ ...numbering, payment_prefix: e.target.value })}
                    className="h-8 px-2 font-mono rounded-sm border border-line-border bg-surface-subtle w-32"
                  />
                  <span className="text-[11px] font-mono text-ink-muted">
                    Preview: {numbering.payment_prefix}2026-0012
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 4: Approval Workflows */}
        {activeTab === 'workflows' && (
          <div className="p-5 bg-surface-elevated border border-line-border rounded-md shadow-2xs flex flex-col gap-4 text-xs animate-in fade-in duration-150">
            <div>
              <span className="font-bold text-ink-900 uppercase tracking-wider text-[11px] block">
                Segregation of Duties & Approval Thresholds
              </span>
              <p className="text-[11px] text-ink-muted">
                Maker ≠ Checker is strictly enforced. Documents created by a Maker must be approved by a Finance Manager or CFO.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-semibold text-ink-muted uppercase">Invoice Approval Threshold ($)</label>
                <input
                  type="number"
                  value={workflows.invoice_threshold / 100}
                  onChange={(e) =>
                    setWorkflows({
                      ...workflows,
                      invoice_threshold: Math.round((parseFloat(e.target.value) || 0) * 100),
                    })
                  }
                  className="h-8 px-2.5 font-mono text-right rounded-sm border border-line-border bg-surface-subtle"
                />
                <span className="text-[10px] text-ink-muted">Invoices above this amount require Checker review</span>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-semibold text-ink-muted uppercase">Bill Approval Threshold ($)</label>
                <input
                  type="number"
                  value={workflows.bill_threshold / 100}
                  onChange={(e) =>
                    setWorkflows({
                      ...workflows,
                      bill_threshold: Math.round((parseFloat(e.target.value) || 0) * 100),
                    })
                  }
                  className="h-8 px-2.5 font-mono text-right rounded-sm border border-line-border bg-surface-subtle"
                />
                <span className="text-[10px] text-ink-muted">Bills above this amount require Checker review</span>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-semibold text-ink-muted uppercase">Journal Approval Threshold ($)</label>
                <input
                  type="number"
                  value={workflows.journal_threshold / 100}
                  onChange={(e) =>
                    setWorkflows({
                      ...workflows,
                      journal_threshold: Math.round((parseFloat(e.target.value) || 0) * 100),
                    })
                  }
                  className="h-8 px-2.5 font-mono text-right rounded-sm border border-line-border bg-surface-subtle"
                />
                <span className="text-[10px] text-ink-muted">Manual journals above this amount require Checker review</span>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-semibold text-ink-muted uppercase">Dual Approval Threshold ($)</label>
                <input
                  type="number"
                  value={workflows.require_dual_approval_over / 100}
                  onChange={(e) =>
                    setWorkflows({
                      ...workflows,
                      require_dual_approval_over: Math.round((parseFloat(e.target.value) || 0) * 100),
                    })
                  }
                  className="h-8 px-2.5 font-mono text-right rounded-sm border border-line-border bg-surface-subtle"
                />
                <span className="text-[10px] text-ink-muted">Requires 2 distinct signatories (Finance Manager + CFO)</span>
              </div>
            </div>
          </div>
        )}

        {/* TAB 5: Users & Permissions */}
        {activeTab === 'users' && (
          <div className="p-5 bg-surface-elevated border border-line-border rounded-md shadow-2xs flex flex-col gap-4 text-xs animate-in fade-in duration-150">
            <span className="font-bold text-ink-900 uppercase tracking-wider text-[11px]">
              Users & Role Permissions Matrix
            </span>

            <div className="border border-line-border rounded-sm overflow-hidden">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="h-8 bg-surface-neutral border-b border-line-border text-[11px] font-semibold text-ink-muted uppercase">
                    <th className="px-3">Name</th>
                    <th className="px-3">Email</th>
                    <th className="px-3">Role & Title</th>
                    <th className="px-3">Signing PIN</th>
                    <th className="px-3 text-center">2FA Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line-border">
                  {users.map((u) => (
                    <tr key={u.id} className="h-9 hover:bg-surface-neutral transition">
                      <td className="px-3 font-medium text-ink-900">{u.name}</td>
                      <td className="px-3 font-mono text-ink-muted">{u.email}</td>
                      <td className="px-3 text-ink-900">{u.roleTitle}</td>
                      <td className="px-3 font-mono text-ink-muted">••••••</td>
                      <td className="px-3 text-center">
                        <span className="text-[10px] font-medium text-success bg-success/10 px-1.5 py-0.5 rounded">
                          Enforced
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
