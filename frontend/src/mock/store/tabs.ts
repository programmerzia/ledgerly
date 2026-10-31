/**
 * Document Tab Strip slice: IDE-style multi-document tabs per 03_UI_Spec §10 and 08_Mock_Refactor_Prompt.md Block B.
 */

import { StateCreator } from 'zustand';
import { DocumentTab } from '@/types';
import { db } from '@/mock/db';

export interface TabsSlice {
  tabs: DocumentTab[];
  activeTabId: string;

  openTab: (tab: DocumentTab) => void;
  closeTab: (tabId: string) => void;
  setActiveTab: (tabId: string) => void;
  nextTab: () => void;
  prevTab: () => void;
}

const defaultTabs: DocumentTab[] = [
  { id: 'tab-dashboard', title: 'Dashboard', url: '/acme/dashboard', type: 'dashboard', pinned: true },
];

const getInitialTabs = (): { tabs: DocumentTab[]; activeTabId: string } => {
  if (typeof window !== 'undefined') {
    try {
      const saved = localStorage.getItem('ledgerly_open_tabs');
      const active = localStorage.getItem('ledgerly_active_tab_id');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return { tabs: parsed, activeTabId: active || parsed[0].id };
        }
      }
    } catch {}
  }
  return { tabs: defaultTabs, activeTabId: 'tab-dashboard' };
};

const saveTabs = (tabs: DocumentTab[], activeTabId: string) => {
  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem('ledgerly_open_tabs', JSON.stringify(tabs));
      localStorage.setItem('ledgerly_active_tab_id', activeTabId);
    } catch {}
  }
  try {
    db.session?.put({ key: 'openTabs', value: tabs }).catch(() => {});
    db.session?.put({ key: 'activeTabId', value: activeTabId }).catch(() => {});
  } catch {}
};

const initTabs = getInitialTabs();

export const createTabsSlice: StateCreator<any, [], [], TabsSlice> = (set, get) => ({
  tabs: initTabs.tabs,
  activeTabId: initTabs.activeTabId,

  openTab: (tab) => {
    const { tabs } = get();
    const existing = tabs.find((t: DocumentTab) => t.id === tab.id || t.url === tab.url);
    if (existing) {
      set({ activeTabId: existing.id });
      saveTabs(tabs, existing.id);
      return;
    }
    const newTabs = [...tabs, tab];
    set({
      tabs: newTabs,
      activeTabId: tab.id,
    });
    saveTabs(newTabs, tab.id);
  },

  closeTab: (tabId) => {
    const { tabs, activeTabId } = get();
    const target = tabs.find((t: DocumentTab) => t.id === tabId);
    if (target?.pinned) return; // Cannot close pinned dashboard

    const remaining = tabs.filter((t: DocumentTab) => t.id !== tabId);
    let nextActive = activeTabId;

    if (activeTabId === tabId) {
      const idx = tabs.findIndex((t: DocumentTab) => t.id === tabId);
      const nextIdx = Math.max(0, idx - 1);
      nextActive = remaining[nextIdx]?.id || 'tab-dashboard';
    }

    set({ tabs: remaining, activeTabId: nextActive });
    saveTabs(remaining, nextActive);
  },

  setActiveTab: (tabId) => {
    set({ activeTabId: tabId });
    saveTabs(get().tabs, tabId);
  },

  nextTab: () => {
    const { tabs, activeTabId } = get();
    const idx = tabs.findIndex((t: DocumentTab) => t.id === activeTabId);
    if (idx !== -1 && idx < tabs.length - 1) {
      set({ activeTabId: tabs[idx + 1].id });
    } else if (tabs.length > 0) {
      set({ activeTabId: tabs[0].id });
    }
  },

  prevTab: () => {
    const { tabs, activeTabId } = get();
    const idx = tabs.findIndex((t: DocumentTab) => t.id === activeTabId);
    if (idx > 0) {
      set({ activeTabId: tabs[idx - 1].id });
    } else if (tabs.length > 0) {
      set({ activeTabId: tabs[tabs.length - 1].id });
    }
  },
});
