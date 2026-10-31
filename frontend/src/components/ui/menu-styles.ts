// Shared class recipes for all floating menus (dropdown, context, select, command).
export const menuSurface =
  'ui-pop ui-menu-surface z-50 min-w-[11rem] overflow-hidden rounded-lg border border-border bg-surface-elevated p-1 text-text-primary';

export const menuItemBase =
  'relative flex h-8 cursor-pointer select-none items-center gap-2 rounded-md px-2 text-[13px] text-text-secondary outline-none transition-colors ' +
  'focus:bg-surface-neutral focus:text-text-primary data-[highlighted]:bg-surface-neutral data-[highlighted]:text-text-primary ' +
  'data-[disabled]:pointer-events-none data-[disabled]:opacity-45 ' +
  '[&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-text-muted data-[highlighted]:[&>svg]:text-text-primary';

export const menuItemDestructive =
  'text-danger focus:bg-danger-soft focus:text-danger data-[highlighted]:bg-danger-soft data-[highlighted]:text-danger [&>svg]:text-danger data-[highlighted]:[&>svg]:text-danger';

export const menuIndicatorItem = 'pl-8';

export const menuLabel =
  'px-2 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-muted';

export const menuSeparator = '-mx-1 my-1 h-px bg-border';

export const menuShortcut =
  'ml-auto pl-4 inline-flex items-center gap-0.5 text-[11px] font-medium tracking-normal text-text-muted';
