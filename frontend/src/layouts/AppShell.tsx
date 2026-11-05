/**
 * Master application shell: top bar, sidebar, document tabs, workspace, status bar.
 * Pieces live in ./shell (TopBar, Sidebar, NotificationsMenu, ThemeSwitcher, UserMenu, TopBarWidgets).
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useLedgerStore } from '@/mock/store';
import { useAdminStore } from '@/mock/store/adminStore';
import { CommandPalette } from '@/components/domain/CommandPalette';
import { DocumentTabStrip } from '@/components/domain/DocumentTabStrip';
import { BottomStatusBar } from '@/components/domain/BottomStatusBar';
import { ShortcutsOverlay } from '@/components/domain/ShortcutsOverlay';
import { ConflictDialog } from '@/components/domain/ConflictDialog';
import { UsabilityTracker } from '@/components/domain/UsabilityTracker';
import { shortcutRegistry } from '@/lib/shortcuts';
import { toast } from 'sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { IS_LIVE } from '@/api/config';
import { TopBar } from './shell/TopBar';
import { LiveRouteGate } from './shell/LiveRouteGate';
import { useSignOut } from '@/data/session';
import { Sidebar } from './shell/Sidebar';
import { buildNavSections, navSectionsFromMenu } from './shell/nav';
import { useCompanyMenu } from '@/data/menu';
import { useTheme } from './shell/useTheme';
import { setFormatPrefs } from '@/lib/format';
import type { AppNotification } from './shell/NotificationsMenu';

export const AppShell: React.FC = () => {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isCommandOpen, setIsCommandOpen] = useState(false);

  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  const {
    currentUser, currentCompany, currentPeriod, uiDensity, setUiDensity, isOffline, toggleOffline, outbox,
    isSyncing, replayOutbox, switchUser, invoices, bills, journals, closeTab, nextTab,
    activeTabId, openTab,
  } = useLedgerStore();
  const signOut = useSignOut();

  const activeImpersonation = useAdminStore((s) => s.activeImpersonation);
  const coSlug = currentCompany.slug;
  const { currentTheme, applyTheme, toggleTheme, isDark } = useTheme();

  const toggleSidebar = useCallback(() => {
    if (window.innerWidth < 1024) setMobileMenuOpen((o) => !o);
    else setSidebarCollapsed((c) => !c);
  }, []);

  const handleToggleOffline = async () => {
    if (isOffline) {
      toggleOffline(false);
      toast.info('Reconnecting... Replaying queued operations');
      await replayOutbox();
    } else {
      toggleOffline(true);
      toast.warning('Offline simulation enabled. Writes will queue to IndexedDB outbox.');
    }
  };

  const handleSignOut = async () => {
    await signOut();
    toast.info('Signed out of session');
    navigate('/login');
  };

  // Register Global Keyboard Chords per Block C.2
  useEffect(() => {
    const unregister = shortcutRegistry.registerBatch([
      { id: 'chord-gd', key: 'g d', description: 'Go to Dashboard', scope: 'global', action: () => navigate(`/${coSlug}/dashboard`) },
      { id: 'chord-gi', key: 'g i', description: 'Go to Invoices', scope: 'global', action: () => navigate(`/${coSlug}/invoices`) },
      { id: 'chord-gb', key: 'g b', description: 'Go to Bills', scope: 'global', action: () => navigate(`/${coSlug}/bills`) },
      { id: 'chord-gj', key: 'g j', description: 'Go to Journals', scope: 'global', action: () => navigate(`/${coSlug}/journals`) },
      { id: 'chord-gr', key: 'g r', description: 'Go to Reports', scope: 'global', action: () => navigate(`/${coSlug}/reports/trial-balance`) },
      { id: 'chord-gp', key: 'g p', description: 'Go to Periods', scope: 'global', action: () => navigate(`/${coSlug}/periods`) },
      { id: 'chord-ga', key: 'g a', description: 'Go to Approvals', scope: 'global', action: () => navigate(`/${coSlug}/approvals`) },
      { id: 'shortcut-k', key: 'ctrl+k', description: 'Command Palette', scope: 'global', action: () => setIsCommandOpen((p) => !p) },
      { id: 'shortcut-w', key: 'ctrl+w', description: 'Close Tab', scope: 'global', action: () => closeTab(activeTabId) },
      { id: 'shortcut-tab', key: 'ctrl+tab', description: 'Next Tab', scope: 'global', action: () => nextTab() },
      { id: 'shortcut-n', key: 'n', description: 'New Document', scope: 'page', action: () => {
        // Against the API every list with a form gets N; the demo keeps its three.
        const targets: Array<[string, string]> = IS_LIVE
          ? [['/credit-notes', 'credit-notes'], ['/debit-notes', 'debit-notes'], ['/invoices', 'invoices'], ['/bills', 'bills'], ['/journals', 'journals'], ['/requisitions', 'requisitions'], ['/purchase-orders', 'purchase-orders'], ['/receipts', 'receipts'], ['/payments', 'payments']]
          : [['/invoices', 'invoices'], ['/bills', 'bills'], ['/journals', 'journals']];
        const hit = targets.find(([needle]) => location.pathname.includes(needle));
        if (hit) navigate(`/${coSlug}/${hit[1]}/new`);
      }},
      { id: 'shortcut-nav', key: '[', description: 'Toggle navigation', scope: 'global', action: () => toggleSidebar() },
      { id: 'shortcut-dark', key: 'ctrl+shift+d', description: 'Toggle Dark Mode', scope: 'global', action: () => toggleTheme() },
      { id: 'shortcut-settings', key: 'ctrl+,', description: 'Open Settings', scope: 'global', action: () => navigate(`/${coSlug}/settings`) },
    ]);

    return () => unregister();
  }, [coSlug, navigate, activeTabId, closeTab, nextTab, location.pathname, toggleTheme, toggleSidebar]);

  const [notifications, setNotifications] = useState<AppNotification[]>(IS_LIVE ? [] : [
    { id: 'notif-1', kind: 'approval', title: 'Invoice waiting for your approval', desc: 'Salaam Bank · $4,200.00 · submitted by Rahim', time: '12m ago', unread: true, link: `/${coSlug}/approvals` },
    { id: 'notif-2', kind: 'period', title: 'October close is almost done', desc: '5 of 6 checklist items complete. Closes on Nov 5.', time: '1h ago', unread: true, link: `/${coSlug}/periods` },
    { id: 'notif-3', kind: 'bank', title: 'New bank transactions', desc: '7 transactions from Premier Bank USD are ready to reconcile.', time: '3h ago', unread: true, link: `/${coSlug}/banking/bnk-1/reconcile` },
  ]);

  const pendingApprovalsCount =
    invoices.filter((i) => i.status === 'pending_approval').length +
    bills.filter((b) => b.status === 'pending_approval').length +
    journals.filter((j) => j.status === 'pending_approval').length;

  // Live: the server's menu for this person. While it loads nothing is offered; if it cannot be read, the full static list is the fallback
  // (the API refuses what a role may not do either way).
  const menu = useCompanyMenu();
  // The company's date and number format, in force before the screens below render (plan 3c.26b). A change remounts them.
  setFormatPrefs(IS_LIVE ? currentCompany.formats ?? null : null);
  const formatsKey = IS_LIVE && currentCompany.formats ? `${currentCompany.formats.date}/${currentCompany.formats.number}` : 'default';
  const navSections = IS_LIVE
    ? (menu.data ? navSectionsFromMenu(coSlug, menu.data.sections) : menu.isError ? buildNavSections(coSlug, 0) : [])
    : buildNavSections(coSlug, pendingApprovalsCount);

  return (
    <TooltipProvider delayDuration={200}>
      <div className="h-screen max-h-screen overflow-hidden flex flex-col antialiased bg-canvas text-text-primary select-none font-sans">
        {/* Operator Impersonation Banner */}
        {activeImpersonation && (
          <div className="h-8 bg-warning-soft border-b border-warning/30 px-3 flex items-center justify-between text-xs text-warning font-medium z-40 select-none shrink-0">
            <div className="flex items-center gap-2">
              <span className="flex h-2 w-2 rounded-full bg-warning shrink-0" />
              <span>
                <strong>OPERATOR IMPERSONATION:</strong> Viewing as staff <span className="font-mono">{activeImpersonation.adminName}</span>.
                Mode: <span className="uppercase font-semibold">{activeImpersonation.mode}-only</span>. All tenant writes are blocked.
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  useAdminStore.getState().endImpersonation();
                  navigate(`/admin/tenants/${activeImpersonation.tenantId}`);
                }}
                className="px-2 py-0.5 rounded bg-warning text-white font-medium hover:opacity-90 transition text-[11px] cursor-pointer"
              >
                Exit Impersonation
              </button>
            </div>
          </div>
        )}

        <TopBar
          coSlug={coSlug}
          company={currentCompany}
          period={currentPeriod}
          user={currentUser}
          sidebarCollapsed={sidebarCollapsed}
          mobileMenuOpen={mobileMenuOpen}
          onToggleSidebar={toggleSidebar}
          onOpenCommand={() => setIsCommandOpen(true)}
          navigate={navigate}
          theme={{ currentTheme, isDark, applyTheme, toggleTheme }}
          uiDensity={uiDensity}
          setUiDensity={setUiDensity}
          isOffline={isOffline}
          isSyncing={isSyncing}
          outboxCount={outbox.length}
          onToggleOffline={handleToggleOffline}
          notifications={notifications}
          setNotifications={setNotifications}
          switchUser={switchUser}
          onShortcuts={() => shortcutRegistry.toggleOverlay()}
          onSignOut={handleSignOut}
        />

        <DocumentTabStrip />

        <div className="flex-1 flex overflow-hidden relative">
          {mobileMenuOpen && (
            <div
              className="fixed inset-0 bg-black/40 z-40 lg:hidden transition-opacity"
              onClick={() => setMobileMenuOpen(false)}
              aria-hidden="true"
            />
          )}

          <Sidebar
            sections={navSections}
            coSlug={coSlug}
            pathname={location.pathname}
            collapsed={sidebarCollapsed}
            mobileOpen={mobileMenuOpen}
            onCloseMobile={() => setMobileMenuOpen(false)}
            navigate={navigate}
            openTab={openTab}
          />

          <main className="flex-1 overflow-y-auto bg-canvas p-3 sm:p-4 md:p-5">
            <div className="w-full h-full">
              <LiveRouteGate key={formatsKey}>
                <Outlet />
              </LiveRouteGate>
            </div>
          </main>
        </div>

        <BottomStatusBar />

        <CommandPalette isOpen={isCommandOpen} onClose={() => setIsCommandOpen(false)} />
        <ShortcutsOverlay />
        <ConflictDialog />
        <UsabilityTracker />
      </div>
    </TooltipProvider>
  );
};
