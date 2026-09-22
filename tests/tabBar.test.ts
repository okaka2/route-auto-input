import { describe, expect, it, vi } from 'vitest';
import { renderTabBar, type TabBarHandlers } from '../src/views/tabBar';

const handlers = (): TabBarHandlers => ({ onSelect: vi.fn() });
const tab = (element: HTMLElement, step: string) =>
  element.querySelector<HTMLButtonElement>(`[data-testid="tab-${step}"]`)!;

describe('renderTabBar', () => {
  it('3つのステップを、番号つきで順番に表示する', () => {
    const element = renderTabBar('list', true, handlers());
    const labels = [...element.querySelectorAll('button')].map((button) => button.textContent);
    expect(labels).toEqual(['①訪問先を選ぶ', '②訪問順', '③地図を開く']);
  });

  it('ナビゲーションには、ステップだと分かる名前が付く', () => {
    const element = renderTabBar('list', true, handlers());
    expect(element.tagName).toBe('NAV');
    expect(element.getAttribute('aria-label')).toBe('ステップ');
  });

  it('今のステップだけに aria-current=step と current のクラスが付く', () => {
    const element = renderTabBar('order', true, handlers());
    expect(tab(element, 'order').getAttribute('aria-current')).toBe('step');
    expect(tab(element, 'order').classList.contains('current')).toBe(true);
    for (const other of ['list', 'map']) {
      expect(tab(element, other).hasAttribute('aria-current')).toBe(false);
      expect(tab(element, other).classList.contains('current')).toBe(false);
    }
  });

  it('訪問先を1件も選んでいないあいだは、訪問順と地図のタブを押せない', () => {
    const element = renderTabBar('list', false, handlers());
    expect(tab(element, 'list').disabled).toBe(false);
    expect(tab(element, 'order').disabled).toBe(true);
    expect(tab(element, 'map').disabled).toBe(true);
  });

  it('1件以上選んでいれば、すべてのタブを押せる', () => {
    const element = renderTabBar('list', true, handlers());
    for (const step of ['list', 'order', 'map']) {
      expect(tab(element, step).disabled).toBe(false);
    }
  });

  it('タブを押すと、そのステップで onSelect が呼ばれる', () => {
    const spies = handlers();
    const element = renderTabBar('list', true, spies);
    tab(element, 'map').click();
    expect(spies.onSelect).toHaveBeenCalledWith('map');
  });

  it('押せないタブを押しても、onSelect は呼ばれない', () => {
    const spies = handlers();
    const element = renderTabBar('list', false, spies);
    tab(element, 'order').click();
    expect(spies.onSelect).not.toHaveBeenCalled();
  });
});
