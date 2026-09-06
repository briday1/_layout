import { describe, expect, it } from 'vitest';
import { applyTheme, builtinThemes, extendTheme } from '../packages/layout/src/themes.js';

describe('shared themes', () => {
  it('provides all eight publisher palette families with complete tokens', () => {
    expect(builtinThemes.map(theme => theme.id)).toEqual([
      'light', 'dark', 'solarized-light', 'solarized-dark', 'espresso', 'dracula', 'tokyo-night', 'synth-wave',
    ]);
    for (const theme of builtinThemes) expect(Object.keys(theme.tokens)).toEqual(Object.keys(builtinThemes[0].tokens));
  });

  it('inherits tokens without modifying the parent theme', () => {
    const base = builtinThemes[1];
    const derived = extendTheme(base, { id: 'custom', label: 'Custom', tokens: { accent: '#ff0000' } });
    expect(derived.tokens.font).toBe(base.tokens.font);
    expect(derived.tokens.accent).toBe('#ff0000');
    expect(base.tokens.accent).toBe('#75a8ed');
    expect(Object.isFrozen(derived.tokens)).toBe(true);
  });

  it('scopes application to the requested workbench', () => {
    const first = document.createElement('div');
    const second = document.createElement('div');
    applyTheme(first, builtinThemes[0]);
    applyTheme(second, builtinThemes[1]);
    expect(first.style.getPropertyValue('--lw-preview-text')).toBe('#101010');
    expect(second.style.getPropertyValue('--lw-preview-text')).toBe('#f1f1ef');
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });
});
