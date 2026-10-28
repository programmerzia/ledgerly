/**
 * Document Tab Strip slice: IDE-style multi-document tabs per 03_UI_Spec §10 and 08_Mock_Refactor_Prompt.md Block B.
 */

import { StateCreator } from 'zustand';
import { DocumentTab } from '@/types';

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

export const createTabsSlice: StateCreator<any, [], [], TabsSlice> = (set, get) => ({
  tabs: defaultTabs,
  activeTabId: 'tab-dashboard',

  openTab: (tab) => {
    const { tabs } = get();
    const existing = tabs.find((t: DocumentTab) => t.id === tab.id || t.url === tab.url);
    if (existing) {
      set({ activeTabId: existing.id });
      return;
    }
    set({
      tabs: [...tabs, tab],
      activeTabId: tab.id,
    });
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
  },

  setActiveTab: (tabId) => {
    set({ activeTabId: tabId });
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
