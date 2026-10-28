/**
 * Global Keyboard Shortcut Registry per 03_UI_Spec §10 and 08_Mock_Refactor_Prompt.md Block C.
 * Supports scopes (global, page, grid, dialog), two-key chords ('g d', 'g i', etc.),
 * and modal shortcut help overlay triggered by '?'.
 */

export type ShortcutScope = 'global' | 'page' | 'grid' | 'dialog';

export interface ShortcutDefinition {
  id: string;
  key: string; // e.g. 'ctrl+k', 'g d', 'n', 'alt+a', 'esc', '?'
  description: string;
  scope: ShortcutScope;
  action: (e?: KeyboardEvent) => void;
  preventInInput?: boolean;
}

class ShortcutRegistry {
  private shortcuts: Map<string, ShortcutDefinition> = new Map();
  private pendingChord: { prefix: string; timeout: number } | null = null;
  private listenersAttached = false;
  private onOverlayToggle?: (show: boolean) => void;
  private overlayVisible = false;

  constructor() {
    this.initGlobalListener();
  }

  public register(shortcut: ShortcutDefinition): () => void {
    this.shortcuts.set(shortcut.id, shortcut);
    return () => this.shortcuts.delete(shortcut.id);
  }

  public registerBatch(shortcuts: ShortcutDefinition[]): () => void {
    const unsubs = shortcuts.map((s) => this.register(s));
    return () => unsubs.forEach((u) => u());
  }

  public setOverlayHandler(handler: (show: boolean) => void) {
    this.onOverlayToggle = handler;
  }

  public toggleOverlay() {
    this.overlayVisible = !this.overlayVisible;
    this.onOverlayToggle?.(this.overlayVisible);
  }

  public closeOverlay() {
    this.overlayVisible = false;
    this.onOverlayToggle?.(false);
  }

  public isOverlayOpen(): boolean {
    return this.overlayVisible;
  }

  public getAllShortcuts(): ShortcutDefinition[] {
    return Array.from(this.shortcuts.values());
  }

  private initGlobalListener() {
    if (typeof window === 'undefined' || this.listenersAttached) return;
    this.listenersAttached = true;

    window.addEventListener('keydown', (e: KeyboardEvent) => {
      const activeElement = document.activeElement;
      const isInput =
        activeElement &&
        (activeElement.tagName === 'INPUT' ||
          activeElement.tagName === 'TEXTAREA' ||
          activeElement.getAttribute('contenteditable') === 'true');

      // '?' triggers shortcuts overlay if not in an input field
      if (e.key === '?' && !isInput && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        this.toggleOverlay();
        return;
      }

      // Esc closes shortcut overlay if open
      if (e.key === 'Escape' && this.overlayVisible) {
        e.preventDefault();
        this.closeOverlay();
        return;
      }

      // Format current key event
      const ctrl = e.ctrlKey || e.metaKey;
      const alt = e.altKey;
      const shift = e.shiftKey;
      const key = e.key.toLowerCase();

      let chord = '';
      if (ctrl) chord += 'ctrl+';
      if (alt) chord += 'alt+';
      if (shift && key !== 'shift') chord += 'shift+';
      chord += key;

      // Handle two-key chord sequences (e.g., 'g' then 'd')
      if (this.pendingChord) {
        const fullChord = `${this.pendingChord.prefix} ${key}`;
        window.clearTimeout(this.pendingChord.timeout);
        this.pendingChord = null;

        for (const s of this.shortcuts.values()) {
          if (s.key === fullChord) {
            if (isInput && s.preventInInput !== false) continue;
            e.preventDefault();
            s.action(e);
            return;
          }
        }
      }

      // Check for starting prefix chord 'g'
      if (!isInput && key === 'g' && !ctrl && !alt) {
        this.pendingChord = {
          prefix: 'g',
          timeout: window.setTimeout(() => {
            this.pendingChord = null;
          }, 1000),
        };
        return;
      }

      // Match single or modifier chords
      for (const s of this.shortcuts.values()) {
        if (s.key === chord) {
          if (isInput && s.preventInInput !== false) continue;
          e.preventDefault();
          s.action(e);
          return;
        }
      }
    });
  }
}

export const shortcutRegistry = new ShortcutRegistry();
