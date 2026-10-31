import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLedgerStore } from '@/mock/store';
import {
  Building2,
  DollarSign,
  BookOpen,
  Landmark,
  Layers,
  Scale,
  CheckCircle2,
  ChevronRight,
  ChevronLeft,
  ArrowRight,
  ShieldCheck,
  AlertCircle,
  Sparkles,
} from 'lucide-react';
import { toast } from 'sonner';
import { WizardStepper, StepIllustration } from './WizardStepper';

interface StepItem {
  id: number;
  title: string;
  subtitle: string;
  icon: React.ComponentType<{ className?: string }>;
}

const STEPS: StepItem[] = [
  { id: 1, title: 'Your company', subtitle: 'Who you are and where you operate', icon: Building2 },
  { id: 2, title: 'Currency and year', subtitle: 'What you report in and when your year starts', icon: DollarSign },
  { id: 3, title: 'Account list', subtitle: 'Start from a ready-made list of accounts', icon: BookOpen },
  { id: 4, title: 'Main bank account', subtitle: 'The account you use day to day', icon: Landmark },
  { id: 5, title: 'Tracking tags', subtitle: 'Optional branches and departments', icon: Layers },
  { id: 6, title: 'Opening balances', subtitle: 'Check your starting numbers', icon: Scale },
];

export const OnboardingWizard: React.FC = () => {
  const navigate = useNavigate();
  const { currentCompany } = useLedgerStore();
  const coSlug = currentCompany.slug;

  const [currentStep, setCurrentStep] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Form states
  // Step 1
  const [legalName, setLegalName] = useState(currentCompany.legal_name || 'Acme Trading Limited');
  const [tradingName, setTradingName] = useState(currentCompany.name || 'Acme Trading');
  const [country, setCountry] = useState('SO');
  const [taxId, setTaxId] = useState('SO-TAX-982143-A');
  const [timezone, setTimezone] = useState('Africa/Mogadishu');

  // Step 2
  const [baseCurrency, setBaseCurrency] = useState('USD');
  const [fiscalYearStart, setFiscalYearStart] = useState('January');

  // Step 3
  const [selectedTemplate, setSelectedTemplate] = useState('ifrs_standard');

  // Step 4
  const [bankName, setBankName] = useState('Premier Bank Somalia');
  const [accountNumber, setAccountNumber] = useState('1004829103');
  const [bankCurrency, setBankCurrency] = useState('USD');
  const [openingBankBalance, setOpeningBankBalance] = useState('25000.00');

  // Step 5
  const [branchCodes, setBranchCodes] = useState(['MG - Mogadishu (HQ)', 'HG - Hargeisa', 'NB - Nairobi']);
  const [costCentres, setCostCentres] = useState(['SALES - Sales & Marketing', 'OPS - Operations', 'ADMIN - Administration']);

  // Step 6
  const [openingCapital, setOpeningCapital] = useState('25000.00');
  const [openingAR, setOpeningAR] = useState('0.00');
  const [openingAP, setOpeningAP] = useState('0.00');

  const handleNext = () => {
    if (currentStep < 6) {
      setCurrentStep(currentStep + 1);
    } else {
      handleComplete();
    }
  };

  const handleBack = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleComplete = () => {
    setIsSubmitting(true);
    setTimeout(() => {
      setIsSubmitting(false);
      toast.success('Your company is ready. Opening balances match.');
      navigate(`/${coSlug}/dashboard`);
    }, 600);
  };

  const stepTone = (['accent', 'violet', 'accent', 'success', 'violet', 'success'] as const)[currentStep - 1];
  return (
    <div className="min-h-screen bg-surface-canvas flex flex-col py-6 px-4 sm:px-6">
      <div className="max-w-3xl mx-auto w-full mb-8">
        <div className="flex items-center justify-between pb-5">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-xl bg-brand text-sm font-bold text-white shadow-card">L</div>
            <div>
              <h1 className="text-[15px] font-semibold tracking-tight text-text-primary">Set up your company</h1>
              <p className="text-xs text-text-muted">About 3 minutes · you can change everything later</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => navigate(`/${coSlug}/dashboard`)}
            className="h-8 rounded-lg px-3 text-[13px] font-medium text-text-muted transition hover:bg-surface-neutral hover:text-text-primary cursor-pointer"
          >
            Skip for now
          </button>
        </div>
        <WizardStepper steps={STEPS} current={currentStep} onSelect={setCurrentStep} />
      </div>

      <div className="max-w-2xl mx-auto w-full rounded-2xl border border-border bg-surface p-7 shadow-card flex flex-col gap-6 ui-rise-in" key={currentStep}>
        <div>
          <div className="flex items-center gap-4 mb-6">
            <StepIllustration icon={STEPS[currentStep - 1].icon} tone={stepTone} />
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">Step {currentStep} of {STEPS.length}</div>
              <h2 className="text-xl font-semibold tracking-tight text-text-primary">{STEPS[currentStep - 1].title}</h2>
              <p className="text-[13px] text-text-muted">{STEPS[currentStep - 1].subtitle}</p>
            </div>
          </div>

          {/* STEP 1: ORGANIZATION PROFILE */}
          {currentStep === 1 && (
            <div className="flex flex-col gap-5 text-[13px]">
              <div className="flex flex-col gap-1">
                <label className="font-medium text-text-primary">Legal company name</label>
                <input
                  type="text"
                  value={legalName}
                  onChange={(e) => setLegalName(e.target.value)}
                  className="h-9 px-3 rounded-lg border border-border bg-surface text-[13px] text-text-primary transition focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="font-medium text-text-primary">Trading name</label>
                <input
                  type="text"
                  value={tradingName}
                  onChange={(e) => setTradingName(e.target.value)}
                  className="h-9 px-3 rounded-lg border border-border bg-surface text-[13px] text-text-primary transition focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-1">
                  <label className="font-medium text-text-primary">Country</label>
                  <select
                    value={country}
                    onChange={(e) => setCountry(e.target.value)}
                    className="h-9 px-3 rounded-lg border border-border bg-surface text-[13px] text-text-primary transition focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
                  >
                    <option value="SO">Somalia (SO)</option>
                    <option value="KE">Kenya (KE)</option>
                    <option value="DJ">Djibouti (DJ)</option>
                    <option value="ET">Ethiopia (ET)</option>
                    <option value="UG">Uganda (UG)</option>
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="font-medium text-text-primary">Tax ID</label>
                  <input
                    type="text"
                    value={taxId}
                    onChange={(e) => setTaxId(e.target.value)}
                    className="h-9 px-3 rounded-lg border border-border bg-surface text-[13px] text-text-primary transition focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 font-mono"
                  />
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <label className="font-medium text-text-primary">Time zone</label>
                <select
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                  className="h-9 px-3 rounded-lg border border-border bg-surface text-[13px] text-text-primary transition focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
                >
                  <option value="Africa/Mogadishu">Africa/Mogadishu (UTC+3)</option>
                  <option value="Africa/Nairobi">Africa/Nairobi (UTC+3)</option>
                  <option value="Africa/Djibouti">Africa/Djibouti (UTC+3)</option>
                  <option value="UTC">UTC / GMT</option>
                </select>
              </div>
            </div>
          )}

          {/* STEP 2: BASE CURRENCY & FISCAL YEAR */}
          {currentStep === 2 && (
            <div className="flex flex-col gap-5 text-[13px]">
              <div className="p-3 bg-surface-neutral border border-border rounded text-text-secondary leading-relaxed">
                <strong className="text-text-primary">Heads up:</strong> your main currency cannot be changed once you start recording transactions. Reports are always shown in this currency.
              </div>
              <div className="flex flex-col gap-1">
                <label className="font-medium text-text-primary">Main currency</label>
                <select
                  value={baseCurrency}
                  onChange={(e) => setBaseCurrency(e.target.value)}
                  className="h-9 px-3 rounded-lg border border-border bg-surface text-[13px] text-text-primary transition focus:outline-none focus:border-accent font-mono focus:ring-2 focus:ring-accent/20"
                >
                  <option value="USD">USD - United States Dollar (Dual-currency standard)</option>
                  <option value="KES">KES - Kenyan Shilling</option>
                  <option value="SOS">SOS - Somali Shilling</option>
                  <option value="EUR">EUR - Euro</option>
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="font-medium text-text-primary">Financial year</label>
                <select
                  value={fiscalYearStart}
                  onChange={(e) => setFiscalYearStart(e.target.value)}
                  className="h-9 px-3 rounded-lg border border-border bg-surface text-[13px] text-text-primary transition focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
                >
                  <option value="January">January 1 – December 31 (Calendar Year)</option>
                  <option value="July">July 1 – June 30 (East Africa Public Fiscal Year)</option>
                  <option value="April">April 1 – March 31 (UK / Commonwealth Standard)</option>
                </select>
              </div>
            </div>
          )}

          {/* STEP 3: CHART TEMPLATE PICKER */}
          {currentStep === 3 && (
            <div className="flex flex-col gap-3 text-[13px]">
              <div className="text-text-secondary mb-1">
                Pick the account list that best fits your business. You can add or rename accounts later.
              </div>

              <div
                onClick={() => setSelectedTemplate('ifrs_standard')}
                className={`p-4 rounded-xl border cursor-pointer transition flex items-start gap-3 ${
                  selectedTemplate === 'ifrs_standard'
                    ? 'border-accent bg-accent-soft text-text-primary'
                    : 'border-border bg-surface hover:bg-surface-neutral'
                }`}
              >
                <input
                  type="radio"
                  name="template"
                  checked={selectedTemplate === 'ifrs_standard'}
                  onChange={() => setSelectedTemplate('ifrs_standard')}
                  className="mt-0.5 text-accent"
                />
                <div className="flex-1">
                  <div className="font-semibold text-text-primary flex items-center justify-between">
                    <span>Standard business (recommended)</span>
                    <span className="text-[10px] font-mono bg-accent/10 text-accent px-1.5 py-0.5 rounded">38 Accounts</span>
                  </div>
                  <p className="text-[11px] text-text-muted mt-1 leading-normal">
                    Preconfigured with 1000 Cash, 1200 AR Control, 2000 AP Control, 2100 VAT, 3000 Equity, 4000 Sales, 5000 COGS, and 6000 Operating Expenses.
                  </p>
                </div>
              </div>

              <div
                onClick={() => setSelectedTemplate('telecom_isp')}
                className={`p-4 rounded-xl border cursor-pointer transition flex items-start gap-3 ${
                  selectedTemplate === 'telecom_isp'
                    ? 'border-accent bg-accent-soft text-text-primary'
                    : 'border-border bg-surface hover:bg-surface-neutral'
                }`}
              >
                <input
                  type="radio"
                  name="template"
                  checked={selectedTemplate === 'telecom_isp'}
                  onChange={() => setSelectedTemplate('telecom_isp')}
                  className="mt-0.5 text-accent"
                />
                <div className="flex-1">
                  <div className="font-semibold text-text-primary flex items-center justify-between">
                    <span>Telecom and tech services</span>
                    <span className="text-[10px] font-mono bg-surface-neutral text-text-muted px-1.5 py-0.5 rounded">46 Accounts</span>
                  </div>
                  <p className="text-[11px] text-text-muted mt-1 leading-normal">
                    Includes dedicated accounts for fiber infrastructure amortization, IP transit costs, bandwidth sales, and equipment depreciation.
                  </p>
                </div>
              </div>

              <div
                onClick={() => setSelectedTemplate('ngo_grant')}
                className={`p-4 rounded-xl border cursor-pointer transition flex items-start gap-3 ${
                  selectedTemplate === 'ngo_grant'
                    ? 'border-accent bg-accent-soft text-text-primary'
                    : 'border-border bg-surface hover:bg-surface-neutral'
                }`}
              >
                <input
                  type="radio"
                  name="template"
                  checked={selectedTemplate === 'ngo_grant'}
                  onChange={() => setSelectedTemplate('ngo_grant')}
                  className="mt-0.5 text-accent"
                />
                <div className="flex-1">
                  <div className="font-semibold text-text-primary flex items-center justify-between">
                    <span>Non-profit with donor funds</span>
                    <span className="text-[10px] font-mono bg-surface-neutral text-text-muted px-1.5 py-0.5 rounded">42 Accounts</span>
                  </div>
                  <p className="text-[11px] text-text-muted mt-1 leading-normal">
                    Configured for restricted grant funds, USAID/UN fund tracking, program expense classification, and project dimensions.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* STEP 4: PRIMARY BANK ACCOUNT */}
          {currentStep === 4 && (
            <div className="flex flex-col gap-5 text-[13px]">
              <div className="flex flex-col gap-1">
                <label className="font-medium text-text-primary">Bank name</label>
                <input
                  type="text"
                  value={bankName}
                  onChange={(e) => setBankName(e.target.value)}
                  className="h-9 px-3 rounded-lg border border-border bg-surface text-[13px] text-text-primary transition focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-1">
                  <label className="font-medium text-text-primary">Account number</label>
                  <input
                    type="text"
                    value={accountNumber}
                    onChange={(e) => setAccountNumber(e.target.value)}
                    className="h-9 px-3 rounded-lg border border-border bg-surface text-[13px] text-text-primary transition focus:outline-none focus:border-accent font-mono focus:ring-2 focus:ring-accent/20"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="font-medium text-text-primary">Account currency</label>
                  <select
                    value={bankCurrency}
                    onChange={(e) => setBankCurrency(e.target.value)}
                    className="h-9 px-3 rounded-lg border border-border bg-surface text-[13px] text-text-primary transition focus:outline-none focus:border-accent font-mono focus:ring-2 focus:ring-accent/20"
                  >
                    <option value="USD">USD ($)</option>
                    <option value="SOS">SOS (Sh.So)</option>
                    <option value="KES">KES (KSh)</option>
                  </select>
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <label className="font-medium text-text-primary">Current balance ($)</label>
                <input
                  type="text"
                  value={openingBankBalance}
                  onChange={(e) => setOpeningBankBalance(e.target.value)}
                  className="h-9 px-3 rounded-lg border border-border bg-surface text-[13px] text-text-primary transition focus:outline-none focus:border-accent font-mono focus:ring-2 focus:ring-accent/20"
                />
                <span className="text-[11px] text-text-muted">
                  Recorded in account 1010 (Bank account).
                </span>
              </div>
            </div>
          )}

          {/* STEP 5: OPERATIONAL DIMENSIONS */}
          {currentStep === 5 && (
            <div className="flex flex-col gap-5 text-[13px]">
              <div>
                <label className="font-semibold text-text-primary block mb-1">
                  Branches
                </label>
                <div className="flex flex-wrap gap-2">
                  {branchCodes.map((b, idx) => (
                    <span
                      key={idx}
                      className="px-2 py-1 rounded bg-surface-neutral border border-border font-mono text-[11px] text-text-primary"
                    >
                      {b}
                    </span>
                  ))}
                </div>
              </div>

              <div className="pt-2 border-t border-border">
                <label className="font-semibold text-text-primary block mb-1">
                  Departments
                </label>
                <div className="flex flex-wrap gap-2">
                  {costCentres.map((c, idx) => (
                    <span
                      key={idx}
                      className="px-2 py-1 rounded bg-surface-neutral border border-border font-mono text-[11px] text-text-primary"
                    >
                      {c}
                    </span>
                  ))}
                </div>
              </div>

              <div className="p-3 bg-surface-neutral rounded border border-border text-[11px] text-text-muted">
                Tags let you see profit by branch or department without adding extra accounts.
              </div>
            </div>
          )}

          {/* STEP 6: OPENING BALANCES & TRIAL BALANCE INVARIANT SEAL */}
          {currentStep === 6 && (
            <div className="flex flex-col gap-5 text-[13px]">
              <div className="p-3 bg-surface-neutral border border-border rounded text-[11px] text-text-secondary">
                This is your starting balance sheet entry. The two sides must match exactly.
              </div>

              <div className="border border-border rounded overflow-hidden">
                <table className="w-full text-[11px]">
                  <thead className="bg-surface-neutral border-b border-border text-text-muted font-medium">
                    <tr>
                      <th className="px-3 py-2 text-left">Account</th>
                      <th className="px-3 py-1.5 text-right">In ($)</th>
                      <th className="px-3 py-1.5 text-right">Out ($)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    <tr>
                      <td className="px-3 py-1.5 font-mono text-text-primary">1010 Operating Bank (USD)</td>
                      <td className="px-3 py-1.5 text-right font-mono font-medium text-text-primary">{openingBankBalance}</td>
                      <td className="px-3 py-1.5 text-right font-mono text-text-muted">0.00</td>
                    </tr>
                    <tr>
                      <td className="px-3 py-1.5 font-mono text-text-primary">3000 Share Capital / Equity</td>
                      <td className="px-3 py-1.5 text-right font-mono text-text-muted">0.00</td>
                      <td className="px-3 py-1.5 text-right font-mono font-medium text-text-primary">{openingBankBalance}</td>
                    </tr>
                  </tbody>
                  <tfoot className="bg-surface font-semibold border-t border-border">
                    <tr>
                      <td className="px-3 py-1.5 text-text-primary">Total</td>
                      <td className="px-3 py-1.5 text-right font-mono text-text-primary">${openingBankBalance}</td>
                      <td className="px-3 py-1.5 text-right font-mono text-text-primary">${openingBankBalance}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              <div className="p-3 bg-success-soft border border-success/30 rounded flex items-center gap-2 text-success font-medium text-xs">
                <ShieldCheck className="w-4 h-4 shrink-0" />
                <span>Both sides match. You are ready to finish.</span>
              </div>
            </div>
          )}
        </div>

        <div className="pt-5 border-t border-border flex items-center justify-between">
          <button
            type="button"
            onClick={handleBack}
            disabled={currentStep === 1}
            className="flex items-center gap-1.5 h-9 px-3.5 rounded-lg border border-border bg-surface hover:bg-surface-neutral text-[13px] font-medium text-text-primary transition disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
          >
            <ChevronLeft className="w-4 h-4" />
            <span>Back</span>
          </button>

          <button
            type="button"
            disabled={isSubmitting}
            onClick={handleNext}
            className="flex items-center gap-1.5 h-9 px-5 rounded-lg bg-accent hover:bg-accent-hover text-white text-[13px] font-semibold shadow-sm transition cursor-pointer disabled:opacity-60"
          >
            <span>{currentStep === 6 ? (isSubmitting ? 'Finishing…' : 'Finish setup') : 'Continue'}</span>
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="max-w-3xl mx-auto w-full text-center text-[11px] text-text-muted mt-6">
        Your data stays private to your company
      </div>
    </div>
  );
};
