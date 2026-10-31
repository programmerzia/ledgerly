import React from 'react';
import { ShieldCheck, BookCheck, Zap } from 'lucide-react';

const BULLETS = [
  { icon: ShieldCheck, title: 'Every change is approved', text: 'A second person reviews important entries before they count.' },
  { icon: BookCheck, title: 'Books that always balance', text: 'Numbers are checked as you type, so reports can be trusted.' },
  { icon: Zap, title: 'Close the month faster', text: 'Bank matching and reminders take care of the busywork.' },
];

/** Split layout: brand panel on the left, form card on the right. */
export const AuthLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="min-h-screen bg-surface-canvas lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
    <aside className="relative hidden overflow-hidden bg-brand p-12 text-white lg:flex lg:flex-col lg:justify-between">
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.12]"
        style={{
          backgroundImage: 'radial-gradient(circle at 1px 1px, white 1px, transparent 0)',
          backgroundSize: '22px 22px',
        }}
      />
      <div aria-hidden className="absolute -bottom-32 -right-24 size-96 rounded-full bg-white/10 blur-3xl" />
      <div aria-hidden className="absolute -top-24 -left-16 size-72 rounded-full bg-white/10 blur-3xl" />

      <div className="relative flex items-center gap-2.5">
        <span className="flex size-9 items-center justify-center rounded-xl bg-white/20 text-sm font-bold ring-1 ring-inset ring-white/30 backdrop-blur">L</span>
        <span className="text-lg font-semibold tracking-tight">Ledgerly</span>
      </div>

      <div className="relative flex max-w-md flex-col gap-8">
        <h2 className="text-4xl font-semibold leading-[1.1] tracking-tight">
          Accounting you can trust, without the spreadsheet stress.
        </h2>
        <ul className="flex flex-col gap-5">
          {BULLETS.map((b) => (
            <li key={b.title} className="flex gap-3.5">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-white/15 ring-1 ring-inset ring-white/25">
                <b.icon className="size-4" />
              </span>
              <div>
                <div className="text-sm font-semibold">{b.title}</div>
                <div className="text-[13px] text-white/75">{b.text}</div>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <p className="relative text-xs text-white/60">Demo environment · all data is sample data</p>
    </aside>

    <main className="flex min-h-screen items-center justify-center p-5 sm:p-8 lg:min-h-0">
      <div className="ui-rise-in w-full max-w-md">
        <div className="mb-6 flex items-center gap-2.5 lg:hidden">
          <span className="flex size-9 items-center justify-center rounded-xl bg-brand text-sm font-bold text-white">L</span>
          <span className="text-lg font-semibold tracking-tight text-text-primary">Ledgerly</span>
        </div>
        {children}
      </div>
    </main>
  </div>
);
