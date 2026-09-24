import { beforeEach, describe, expect, it } from 'vitest';
import { applyTheme, loadThemeSetting, resolveTheme, saveThemeSetting } from '../src/theme';

beforeEach(() => {
  window.localStorage.clear();
  delete document.documentElement.dataset.theme;
});

describe('resolveTheme', () => {
  it('自動は、OSが暗ければ dark、明るければ light', () => {
    expect(resolveTheme('auto', true)).toBe('dark');
    expect(resolveTheme('auto', false)).toBe('light');
  });
  it('明るい/暗いを選んでいれば、OSの設定に関係なくそれに従う', () => {
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });
});

describe('設定の読み書き', () => {
  it('何も保存していなければ自動', () => {
    expect(loadThemeSetting()).toBe('auto');
  });
  it('保存した設定を読み戻せる', () => {
    saveThemeSetting('dark');
    expect(loadThemeSetting()).toBe('dark');
  });
  it('壊れた値は自動として扱う', () => {
    window.localStorage.setItem('route-auto-input:theme', 'purple');
    expect(loadThemeSetting()).toBe('auto');
  });
});

describe('applyTheme', () => {
  it('<html data-theme> に light か dark を入れる', () => {
    applyTheme('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    applyTheme('light');
    expect(document.documentElement.dataset.theme).toBe('light');
  });
});
