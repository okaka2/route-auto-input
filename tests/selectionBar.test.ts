import { describe, expect, it, vi } from 'vitest';
import { renderSelectionBar, type SelectionBarHandlers } from '../src/views/selectionBar';

const handlers = (): SelectionBarHandlers => ({ onNext: vi.fn(), onDeleteSelected: vi.fn() });

describe('renderSelectionBar', () => {
  it('1件も選んでいなければ、何も出さない(null)', () => {
    expect(renderSelectionBar(0, handlers())).toBeNull();
  });

  it('選択件数を「3件選択中」の形で表示する', () => {
    const element = renderSelectionBar(3, handlers())!;
    expect(element.querySelector('[data-testid="selection-count"]')?.textContent).toBe('3件選択中');
  });

  it('「訪問順を決める →」のボタンを出し、押すと onNext が呼ばれる', () => {
    const spies = handlers();
    const element = renderSelectionBar(1, spies)!;
    const button = element.querySelector<HTMLButtonElement>('[data-testid="next-button"]')!;
    expect(button.textContent).toBe('訪問順を決める →');
    button.click();
    expect(spies.onNext).toHaveBeenCalledTimes(1);
  });

  it('スクリーンリーダーに、選択中の内容であることが伝わる名前を付ける', () => {
    const element = renderSelectionBar(2, handlers())!;
    expect(element.getAttribute('role')).toBe('region');
    expect(element.getAttribute('aria-label')).toBe('選択中の訪問先');
  });

  it('件数が変わっても、その件数を表示する', () => {
    const element = renderSelectionBar(10, handlers())!;
    expect(element.textContent).toContain('10件選択中');
  });

  it('「削除」のボタンを出し、押すと onDeleteSelected が呼ばれる', () => {
    const spies = handlers();
    const element = renderSelectionBar(2, spies)!;
    const button = element.querySelector<HTMLButtonElement>('[data-testid="delete-selected-button"]')!;
    expect(button.textContent).toBe('削除');
    button.click();
    expect(spies.onDeleteSelected).toHaveBeenCalledTimes(1);
  });
});
