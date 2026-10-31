import { useCallback, useState } from 'react';

export type ThemeId = 'light' | 'dark' | 'midnight' | 'forest' | 'sepia';

const DARK_THEMES: string[] = ['dark', 'midnight', 'forest'];

export function useTheme() {
  const [currentTheme, setCurrentTheme] = useState<string>(
    () => document.documentElement.getAttribute('data-theme') || localStorage.getItem('ledgerly_theme') || 'light'
  );

  const applyTheme = useCallback((themeName: string) => {
    setCurrentTheme(themeName);
    document.documentElement.setAttribute('data-theme', themeName);
    localStorage.setItem('ledgerly_theme', themeName);
  }, []);

  const toggleTheme = useCallback(() => {
    const cur = document.documentElement.getAttribute('data-theme') || 'light';
    applyTheme(DARK_THEMES.includes(cur) ? 'light' : 'dark');
  }, [applyTheme]);

  return { currentTheme, applyTheme, toggleTheme, isDark: DARK_THEMES.includes(currentTheme) };
}
