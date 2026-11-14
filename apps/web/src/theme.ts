/** Light, dark or follow the system. "auto" leaves <html> without data-theme so the CSS media query decides. */
export type Theme = 'auto' | 'light' | 'dark';
export const THEMES: readonly Theme[] = ['auto', 'light', 'dark'];
export const isTheme = (value: unknown): value is Theme => value === 'auto' || value === 'light' || value === 'dark';
export function applyTheme(theme: Theme, root: HTMLElement = document.documentElement): void {
  if (theme === 'auto') delete root.dataset.theme; else root.dataset.theme = theme;
}
