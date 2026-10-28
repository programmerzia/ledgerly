/**
 * Session slice: handles authenticated user, active company, active period, UI density,
 * offline simulation mode, and checker signature cache.
 */

import { StateCreator } from 'zustand';
import { User, Company, FiscalPeriod, UIRowDensity } from '@/types';
import { mockUsers, mockCompanies, mockFiscalYear2026 } from '@/mock/data';

export interface ActiveSignature {
  userId: string;
  pin: string;
  signedAt: string;
  expiresAt: number; // timestamp in ms (cached for 2 min per mock spec)
}

export interface SessionSlice {
  currentUser: User;
  users: User[];
  currentCompany: Company;
  currentPeriod: FiscalPeriod;
  uiDensity: UIRowDensity;
  isOffline: boolean;
  theme: 'light' | 'dark';
  activeSignature: ActiveSignature | null;
  pendingConflict: {
    documentId: string;
    serverVersion: any;
    localVersion: any;
  } | null;

  isAuthenticated: boolean;

  // Actions
  loginUser: (userOrId?: User | string) => void;
  logoutUser: () => void;
  switchUser: (userId: string) => void;
  setCurrentUser: (userOrId: User | string) => void;
  switchCompany: (companyId: string) => void;
  switchPeriod: (periodId: string) => void;
  setUiDensity: (density: UIRowDensity) => void;
  toggleOffline: (force?: boolean) => void;
  toggleTheme: () => void;
  setTheme: (theme: 'light' | 'dark') => void;
  setActiveSignature: (sig: ActiveSignature | null) => void;
  clearSignature: () => void;
  setPendingConflict: (conflict: SessionSlice['pendingConflict']) => void;
  recordFailedPin: (userId: string) => void;
  resetFailedPin: (userId: string) => void;
}

const getInitialAuth = (): boolean => {
  if (typeof window !== 'undefined') {
    return localStorage.getItem('ledgerly_tenant_auth') === 'true';
  }
  return false;
};

const getInitialTheme = (): 'light' | 'dark' => {
  if (typeof window !== 'undefined') {
    const saved = localStorage.getItem('ledgerly_theme') as 'light' | 'dark';
    if (saved === 'light' || saved === 'dark') return saved;
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      return 'dark';
    }
  }
  return 'light';
};

export const createSessionSlice: StateCreator<SessionSlice, [], [], SessionSlice> = (set, get) => ({
  currentUser: mockUsers[0], // Default: Rahim Ahmed (Maker)
  users: [...mockUsers],
  currentCompany: mockCompanies[0], // Default: Acme Trading Ltd (USD)
  currentPeriod: mockFiscalYear2026.periods[9], // Oct 2026 (Open period)
  uiDensity: 'default',
  isOffline: false,
  theme: getInitialTheme(),
  activeSignature: null,
  pendingConflict: null,
  isAuthenticated: getInitialAuth(),

  loginUser: (userOrId) => {
    if (userOrId) {
      if (typeof userOrId === 'string') {
        const u = mockUsers.find((user) => user.id === userOrId);
        if (u) set({ currentUser: u, activeSignature: null });
      } else {
        set({ currentUser: userOrId, activeSignature: null });
      }
    }
    set({ isAuthenticated: true });
    if (typeof window !== 'undefined') {
      localStorage.setItem('ledgerly_tenant_auth', 'true');
    }
  },

  logoutUser: () => {
    set({ isAuthenticated: false, activeSignature: null });
    if (typeof window !== 'undefined') {
      localStorage.removeItem('ledgerly_tenant_auth');
    }
  },

  switchUser: (userId) => {
    const user = mockUsers.find((u) => u.id === userId);
    if (user) {
      set({ currentUser: user, activeSignature: null });
    }
  },

  setCurrentUser: (userOrId) => {
    if (typeof userOrId === 'string') {
      const u = mockUsers.find((user) => user.id === userOrId);
      if (u) set({ currentUser: u, activeSignature: null });
    } else {
      set({ currentUser: userOrId, activeSignature: null });
    }
  },

  toggleTheme: () => {
    const nextTheme = get().theme === 'light' ? 'dark' : 'light';
    set({ theme: nextTheme });
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-theme', nextTheme);
      localStorage.setItem('ledgerly_theme', nextTheme);
    }
  },

  setTheme: (theme) => {
    set({ theme });
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-theme', theme);
      localStorage.setItem('ledgerly_theme', theme);
    }
  },

  switchCompany: (companyId) => {
    const company = mockCompanies.find((c) => c.id === companyId);
    if (company) {
      set({ currentCompany: company });
    }
  },

  switchPeriod: (periodId) => {
    const period = mockFiscalYear2026.periods.find((p) => p.id === periodId);
    if (period) {
      set({ currentPeriod: period });
    }
  },

  setUiDensity: (density) => {
    set({ uiDensity: density });
    localStorage.setItem('ledgerly_density', density);
  },

  toggleOffline: (force) => {
    const next = force !== undefined ? force : !get().isOffline;
    set({ isOffline: next });
  },

  setActiveSignature: (sig) => {
    set({ activeSignature: sig });
  },

  clearSignature: () => {
    set({ activeSignature: null });
  },

  setPendingConflict: (conflict) => {
    set({ pendingConflict: conflict });
  },

  recordFailedPin: (userId) => {
    const user = mockUsers.find((u) => u.id === userId);
    if (user) {
      user.failedPinAttempts += 1;
      if (user.failedPinAttempts >= 3) {
        user.signingLockoutUntil = new Date(Date.now() + 30000).toISOString(); // 30s lockout for mock
      }
      set({ currentUser: { ...user } });
    }
  },

  resetFailedPin: (userId) => {
    const user = mockUsers.find((u) => u.id === userId);
    if (user) {
      user.failedPinAttempts = 0;
      user.signingLockoutUntil = undefined;
      set({ currentUser: { ...user } });
    }
  },
});
