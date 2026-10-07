import { afterEach, describe, expect, it } from 'vitest';
import { applyTheme, loadPreference, resolveTheme, savePreference } from './theme';

afterEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});

describe('resolveTheme', () => {
  it('follows the system for "system"', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
  });

  it('keeps an explicit choice whatever the system says', () => {
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });
});

describe('preference storage', () => {
  it('defaults to "system" when nothing is stored', () => {
    expect(loadPreference()).toBe('system');
  });

  it('reads back what was saved', () => {
    savePreference('dark');
    expect(loadPreference()).toBe('dark');
  });

  it('ignores an unknown stored value', () => {
    localStorage.setItem('eam.theme', 'sepia');
    expect(loadPreference()).toBe('system');
  });
});

describe('applyTheme', () => {
  it('marks the document with the resolved theme', () => {
    applyTheme('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    applyTheme('light');
    expect(document.documentElement.dataset.theme).toBe('light');
  });
});
