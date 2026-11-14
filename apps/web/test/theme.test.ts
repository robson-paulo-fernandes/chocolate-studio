// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { applyTheme, isTheme } from '../src/theme.js';

describe('theme', () => {
  it('forces light or dark and leaves auto to the system', () => {
    const root = document.createElement('html');
    applyTheme('dark', root); expect(root.dataset.theme).toBe('dark');
    applyTheme('light', root); expect(root.dataset.theme).toBe('light');
    applyTheme('auto', root); expect(root.dataset.theme).toBeUndefined();
    expect([isTheme('auto'), isTheme('dark'), isTheme('sepia'), isTheme(undefined)]).toEqual([true, true, false, false]);
  });
});
