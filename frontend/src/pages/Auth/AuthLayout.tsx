import React from 'react';
import { IS_LIVE } from '@/api/config';
import { BrandMark } from '@/layouts/shell/Sidebar';

/** Sign-in pages: one quiet column on the canvas, the way a bank's sign-in page looks. */
export const AuthLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="min-h-screen bg-canvas flex flex-col">
    <header className="px-6 sm:px-10 h-16 flex items-center gap-2">
      <BrandMark />
      <span className="text-[15px] font-semibold text-text-primary">Ledgerly</span>
    </header>
    <main className="flex-1 flex items-start justify-center px-5 pt-[8vh] pb-12">
      <div className="w-full max-w-[400px]">{children}</div>
    </main>
    <footer className="px-6 sm:px-10 py-5 text-xs text-text-muted flex flex-wrap gap-x-5 gap-y-1">
      {!IS_LIVE && <span>Demo environment, sample data only</span>}
      <a href="#" className="hover:text-text-primary">Privacy</a>
      <a href="#" className="hover:text-text-primary">Terms</a>
      <a href="#" className="hover:text-text-primary">Status</a>
    </footer>
  </div>
);
