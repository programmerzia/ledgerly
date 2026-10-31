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
  tableSelection: { count: number; sum: number; currency: string } | null;
  focusedElementShortcuts: string[] | null;

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
  setTableSelection: (selection: { count: number; sum: number; currency: string } | null) => void;
  setFocusedElementShortcuts: (shortcuts: string[] | null) => void;
}

import { db } from '@/mock/db';

const getInitialAuth = (): boolean => {
  if (typeof window !== 'undefined') {
    return localStorage.getItem('ledgerly_tenant_auth') === 'true';
  }
  return false;
};

const getInitialUser = (): User => {
  if (typeof window !== 'undefined') {
    const savedId = localStorage.getItem('ledgerly_current_user_id');
    if (savedId) {
      const u = mockUsers.find((user) => user.id === savedId);
      if (u) return u;
    }
  }
  return mockUsers[0]; // Default: Rahim Ahmed (Maker)
};

const getInitialCompany = (): Company => {
  if (typeof window !== 'undefined') {
    const savedId = localStorage.getItem('ledgerly_current_company_id');
    if (savedId) {
      const c = mockCompanies.find((comp) => comp.id === savedId);
      if (c) return c;
    }
  }
  return mockCompanies[0];
};

const getInitialDensity = (): UIRowDensity => {
  if (typeof window !== 'undefined') {
    const saved = localStorage.getItem('ledgerly_density') as UIRowDensity;
    if (saved === 'compact' || saved === 'default' || saved === 'comfortable') return saved;
  }
  return 'default';
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
  currentUser: getInitialUser(),
  users: [...mockUsers],
  currentCompany: getInitialCompany(),
  currentPeriod: mockFiscalYear2026.periods[9], // Oct 2026 (Open period)
  uiDensity: getInitialDensity(),
  isOffline: false,
  theme: getInitialTheme(),
  activeSignature: null,
  pendingConflict: null,
  isAuthenticated: getInitialAuth(),
  tableSelection: null,
  focusedElementShortcuts: null,

  loginUser: (userOrId) => {
    let targetUser: User | undefined;
    if (userOrId) {
      if (typeof userOrId === 'string') {
        targetUser = mockUsers.find((user) => user.id === userOrId);
      } else {
        targetUser = userOrId;
      }
    }
    if (targetUser) {
      set({ currentUser: targetUser, activeSignature: null });
      if (typeof window !== 'undefined') {
        localStorage.setItem('ledgerly_current_user_id', targetUser.id);
      }
      try {
        db.session?.put({ key: 'currentUser', value: targetUser }).catch(() => {});
      } catch {}
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
      if (typeof window !== 'undefined') {
        localStorage.setItem('ledgerly_current_user_id', user.id);
      }
      try {
        db.session?.put({ key: 'currentUser', value: user }).catch(() => {});
      } catch {}
    }
  },

  setCurrentUser: (userOrId) => {
    const u = typeof userOrId === 'string' ? mockUsers.find((user) => user.id === userOrId) : userOrId;
    if (u) {
      set({ currentUser: u, activeSignature: null });
      if (typeof window !== 'undefined') {
        localStorage.setItem('ledgerly_current_user_id', u.id);
      }
      try {
        db.session?.put({ key: 'currentUser', value: u }).catch(() => {});
      } catch {}
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
      if (typeof window !== 'undefined') {
        localStorage.setItem('ledgerly_current_company_id', company.id);
      }
      try {
        db.session?.put({ key: 'currentCompany', value: company }).catch(() => {});
      } catch {}
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
    if (typeof window !== 'undefined') {
      localStorage.setItem('ledgerly_density', density);
    }
    try {
      db.session?.put({ key: 'uiDensity', value: density }).catch(() => {});
    } catch {}
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

  setTableSelection: (selection) => {
    set({ tableSelection: selection });
  },

  setFocusedElementShortcuts: (shortcuts) => {
    set({ focusedElementShortcuts: shortcuts });
  },
});
