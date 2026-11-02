/**
 * Live onboarding wizard (02_AppFlow §3), reached after the first company is created and from Settings.
 * Resumes at the first incomplete step, worked out from what the server holds for the company.
 */
import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Building2, BookOpen, Scale, Percent, Users, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { WizardStepper } from './WizardStepper';
import { STEP_TITLES, loadSkipped, resumeStep, saveSkipped, stepDone, type SetupState, type StepId } from '@/api/adapters/onboarding';
import { useSetupState } from '@/data/setup';
import { useMe } from '@/data/session';
import { useCurrentCompany } from '@/data/team';
import { LoadError, Loading, primary, secondary } from '@/components/live/form';
import { ChartStep, OpeningStep, TaxStep, TeamStep } from './LiveOnboardingSteps';

const ICONS = { 1: Building2, 2: BookOpen, 3: Scale, 4: Percent, 5: Users, 6: CheckCircle2 } as const;
const STEPS = ([1, 2, 3, 4, 5, 6] as const).map((id) => ({ title: STEP_TITLES[id], icon: ICONS[id] }));

const Panel: React.FC<{ step: StepId; sub: string; children: React.ReactNode }> = ({ step, sub, children }) => (
  <div className="mx-auto w-full max-w-2xl rounded-lg border border-border bg-surface p-7">
    <div className="text-xs text-text-muted">Step {step} of 6</div>
    <h2 className="text-xl font-semibold text-text-primary">{STEP_TITLES[step]}</h2>
    <p className="mb-6 text-[13px] text-text-muted">{sub}</p>
    {children}
  </div>
);

export const LiveOnboarding: React.FC = () => {
  const company = useCurrentCompany();
  return <OnboardingFor key={company.id} />;
};

const OnboardingFor: React.FC = () => {
  const company = useCurrentCompany();
  const me = useMe();
  const navigate = useNavigate();
  const setup = useSetupState(company.id, me.data?.id ?? '');
  const [skipped, setSkipped] = useState<StepId[]>(() => loadSkipped(company.id));
  const [step, setStep] = useState<StepId | null>(null);
  const co = `/${company.slug}`;

  useEffect(() => {
    if (setup.data && step === null) setStep(resumeStep(setup.data, skipped));
  }, [setup.data, step, skipped]);

  if (setup.isError) return <div className="mx-auto max-w-2xl p-6"><LoadError error={setup.error} onRetry={() => void setup.refetch()} /></div>;
  if (!setup.data || step === null) return <div className="mx-auto max-w-2xl p-6"><Loading what="Checking your setup" /></div>;

  const state: SetupState = setup.data;
  const go = (n: StepId) => setStep(n);
  const next = () => go(Math.min(6, step + 1) as StepId);
  const skip = () => {
    const all = [...skipped, step];
    setSkipped(all);
    saveSkipped(company.id, all);
    next();
  };
  const finish = () => {
    toast.success('Setup finished.');
    navigate(`${co}/dashboard`);
  };

  return (
    <div className="flex flex-col gap-8 py-2">
      <div className="mx-auto w-full max-w-3xl">
        <div className="flex items-center justify-between pb-5">
          <div>
            <h1 className="text-[15px] font-semibold text-text-primary">Set up {company.name}</h1>
            <p className="text-xs text-text-muted">Each step saves as you go. You can leave and come back.</p>
          </div>
          <Link to={`${co}/dashboard`} className="h-8 rounded-md px-3 text-[13px] font-medium leading-8 text-text-muted transition-colors hover:bg-surface-neutral hover:text-text-primary">Leave for now</Link>
        </div>
        <WizardStepper steps={STEPS} current={step} onSelect={(n) => go(n as StepId)} />
      </div>

      {step === 1 && (
        <Panel step={1} sub="Created. These can be changed later in company settings.">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-[13px]">
            <div><dt className="text-xs text-text-muted">Name</dt><dd className="text-text-primary">{company.name}</dd></div>
            <div><dt className="text-xs text-text-muted">Country</dt><dd className="text-text-primary">{company.country}</dd></div>
            <div><dt className="text-xs text-text-muted">Currency</dt><dd className="text-text-primary">{company.base_currency}</dd></div>
            <div><dt className="text-xs text-text-muted">Financial year starts</dt><dd className="text-text-primary">Month {company.fiscal_year_start_month}</dd></div>
          </dl>
          <div className="mt-6 flex justify-end"><button type="button" onClick={next} className={primary}>Continue</button></div>
        </Panel>
      )}
      {step === 2 && <Panel step={2} sub="Start from a ready-made list of accounts, or skip and build your own."><ChartStep company={company} done={state.hasAccounts} onNext={next} onSkip={skip} /></Panel>}
      {step === 3 && <Panel step={3} sub="Your starting numbers."><OpeningStep onNext={next} /></Panel>}
      {step === 4 && <Panel step={4} sub="The taxes you charge and pay."><TaxStep company={company} onNext={next} onSkip={skip} /></Panel>}
      {step === 5 && <Panel step={5} sub="Invite the people who will work in the books."><TeamStep company={company} onNext={next} onSkip={skip} /></Panel>}
      {step === 6 && (
        <Panel step={6} sub="Here is where things stand.">
          <ul className="flex flex-col gap-2 text-[13px]">
            {([2, 4, 5] as const).map((n) => {
              const real = stepDone(n, state, []);
              const label = real ? 'Done' : skipped.includes(n) ? 'Skipped' : 'Not done';
              return (
                <li key={n} className="flex items-center justify-between border-b border-border pb-2">
                  <span className="text-text-primary">{STEP_TITLES[n]}</span>
                  <span className={real ? 'text-success' : 'text-text-muted'}>{label}</span>
                </li>
              );
            })}
          </ul>
          <div className="mt-6 flex justify-between">
            <button type="button" onClick={() => go(2)} className={secondary}>Review steps</button>
            <button type="button" onClick={finish} className={primary}>Go to dashboard</button>
          </div>
        </Panel>
      )}
    </div>
  );
};
