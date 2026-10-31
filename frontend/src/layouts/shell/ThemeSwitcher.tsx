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
  { id: 'light', label: 'Light', canvas: '#F6F5F1', surface: '#FFFFFF', sidebar: '#F1EFEA', border: '#E2DFD7', text: '#1C1B18', muted: '#CBC7BC', accent: '#2350B8' },
  { id: 'dark', label: 'Dark', canvas: '#161614', surface: '#1D1D1A', sidebar: '#191917', border: '#33322E', text: '#ECEAE4', muted: '#46453F', accent: '#86A3E6' },
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
    <PopoverContent align="end" sideOffset={8} className="w-[260px] p-3 shadow-lg">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-text-muted mb-2">Appearance</div>
      <div className="grid grid-cols-2 gap-2">
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
