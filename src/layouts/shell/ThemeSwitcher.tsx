import React from 'react';
import { Sun, Moon, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { UIRowDensity } from '@/mock/store';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';

/**
 * Preview palettes. Intentional exception to "tokens only": each swatch must show ITS theme's colours
 * regardless of which theme is currently active, so the values are mirrored from index.css.
 */
const PREVIEWS: { id: string; label: string; canvas: string; surface: string; sidebar: string; border: string; text: string; muted: string; accent: string }[] = [
  { id: 'light', label: 'Light', canvas: '#F7F8FA', surface: '#FFFFFF', sidebar: '#FBFBFC', border: '#E6E8EC', text: '#111827', muted: '#D5D9E0', accent: '#2F5BEA' },
  { id: 'dark', label: 'Dark', canvas: '#0B0F17', surface: '#111827', sidebar: '#0E131C', border: '#1F2937', text: '#F3F4F6', muted: '#2B3647', accent: '#6D8CF5' },
  { id: 'midnight', label: 'Midnight', canvas: '#070D1E', surface: '#0E172E', sidebar: '#091124', border: '#1E2E50', text: '#F0F4FC', muted: '#2A3E6D', accent: '#3B82F6' },
  { id: 'forest', label: 'Forest', canvas: '#07130C', surface: '#0E2015', sidebar: '#09170E', border: '#1F4530', text: '#F0FDF4', muted: '#2A5C41', accent: '#10B981' },
  { id: 'sepia', label: 'Sepia', canvas: '#F8F5EE', surface: '#FFFFFF', sidebar: '#F4EFE6', border: '#E2D7C5', text: '#292218', muted: '#CEBEA7', accent: '#B45309' },
];

const DENSITIES: [UIRowDensity, string][] = [['compact', 'Compact'], ['default', 'Default'], ['comfortable', 'Comfortable']];

interface Props {
  currentTheme: string;
  isDark: boolean;
  applyTheme: (t: string) => void;
  uiDensity: UIRowDensity;
  setUiDensity: (d: UIRowDensity) => void;
}

export const ThemeSwitcher: React.FC<Props> = ({ currentTheme, isDark, applyTheme, uiDensity, setUiDensity }) => (
  <Popover>
    <Tooltip>
      <TooltipTrigger asChild>
        <PopoverTrigger asChild>
          <button type="button" aria-label="Theme and density" className="size-9 grid place-items-center rounded-lg text-text-secondary hover:text-text-primary hover:bg-surface-neutral transition outline-none focus-visible:ring-2 focus-visible:ring-accent/50 cursor-pointer">
            {isDark ? <Moon className="size-4" /> : <Sun className="size-4" />}
          </button>
        </PopoverTrigger>
      </TooltipTrigger>
      <TooltipContent shortcut="Ctrl+Shift+D">Theme</TooltipContent>
    </Tooltip>
    <PopoverContent align="end" sideOffset={8} className="w-[328px] p-3 rounded-xl shadow-lg">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-text-muted mb-2">Appearance</div>
      <div className="grid grid-cols-3 gap-2">
        {PREVIEWS.map((t) => {
          const active = currentTheme === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => applyTheme(t.id)}
              aria-pressed={active}
              className={cn(
                'group relative rounded-lg border p-1 text-left transition outline-none focus-visible:ring-2 focus-visible:ring-accent/50 cursor-pointer',
                active ? 'border-accent ring-1 ring-accent' : 'border-border hover:border-border-strong'
              )}
            >
              <div className="h-12 rounded-md overflow-hidden flex border" style={{ background: t.canvas, borderColor: t.border }}>
                <div className="w-3.5 h-full" style={{ background: t.sidebar, borderRight: `1px solid ${t.border}` }} />
                <div className="flex-1 p-1 flex flex-col gap-0.5">
                  <div className="h-1 w-6 rounded-full" style={{ background: t.accent }} />
                  <div className="flex-1 rounded-sm border p-0.5 flex flex-col gap-0.5" style={{ background: t.surface, borderColor: t.border }}>
                    <div className="h-0.5 w-8 rounded-full" style={{ background: t.text }} />
                    <div className="h-0.5 w-5 rounded-full" style={{ background: t.muted }} />
                  </div>
                </div>
              </div>
              <div className="flex items-center justify-between px-1 pt-1 pb-0.5">
                <span className="text-[11px] font-medium text-text-primary">{t.label}</span>
                {active && <Check className="size-3 text-accent" />}
              </div>
            </button>
          );
        })}
      </div>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-text-muted mt-3 mb-2">Table density</div>
      <div role="radiogroup" aria-label="Table density" className="grid grid-cols-3 p-0.5 rounded-lg bg-surface-neutral border border-border">
        {DENSITIES.map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={uiDensity === id}
            onClick={() => setUiDensity(id)}
            className={cn(
              'h-7 rounded-md text-xs font-medium transition cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-accent/50',
              uiDensity === id ? 'bg-surface-elevated text-text-primary shadow-sm' : 'text-text-muted hover:text-text-primary'
            )}
          >
            {label}
          </button>
        ))}
      </div>
    </PopoverContent>
  </Popover>
);
