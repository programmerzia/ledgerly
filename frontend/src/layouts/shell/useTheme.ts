import { useCallback, useState } from 'react';

export type ThemeId = 'light' | 'dark';

/** Themes removed in the 2026-10-31 redesign map onto the two that remain. */
const LEGACY: Record<string, ThemeId> = { midnight: 'dark', forest: 'dark', sepia: 'light' };

export function normaliseTheme(value: string | null | undefined): ThemeId {
  if (value === 'dark' || value === 'light') return value;
  return (value && LEGACY[value]) || 'light';
}

export function useTheme() {
  const [currentTheme, setCurrentTheme] = useState<ThemeId>(() =>
    normaliseTheme(document.documentElement.getAttribute('data-theme') || localStorage.getItem('ledgerly_theme'))
  );

  const applyTheme = useCallback((themeName: string) => {
    const theme = normaliseTheme(themeName);
    setCurrentTheme(theme);
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('ledgerly_theme', theme);
  }, []);

  const toggleTheme = useCallback(() => {
    applyTheme(normaliseTheme(document.documentElement.getAttribute('data-theme')) === 'dark' ? 'light' : 'dark');
  }, [applyTheme]);

  return { currentTheme, applyTheme, toggleTheme, isDark: currentTheme === 'dark' };
}
