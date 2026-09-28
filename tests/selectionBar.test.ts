import { describe, expect, it, vi } from 'vitest';
import { renderSelectionBar, type SelectionBarHandlers } from '../src/views/selectionBar';

const handlers = (): SelectionBarHandlers => ({
  onNext: vi.fn(),
  onShowSelected: vi.fn(),
  onOpenMenu: vi.fn(),
});

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

  it('「N件選択中」を押すと onShowSelected が呼ばれる', () => {
    const onShowSelected = vi.fn();
    const bar = renderSelectionBar(2, { onNext: vi.fn(), onShowSelected, onOpenMenu: vi.fn() })!;
    bar.querySelector<HTMLButtonElement>('[data-testid="selection-count"]')!.click();
    expect(onShowSelected).toHaveBeenCalled();
  });

  it('「⋯」のボタンを出し、押すと onOpenMenu が呼ばれる(送る・削除はこの小窓に入る)', () => {
    const spies = handlers();
    const element = renderSelectionBar(2, spies)!;
    const button = element.querySelector<HTMLButtonElement>('[data-testid="selection-menu-button"]')!;
    expect(button.textContent).toBe('⋯');
    expect(button.getAttribute('aria-label')).toBe('選択中の訪問先の操作');
    expect(button.getAttribute('aria-haspopup')).toBe('dialog');
    button.click();
    expect(spies.onOpenMenu).toHaveBeenCalledTimes(1);
  });

  it('選択件数・「⋯」・「訪問順を決める →」の1段だけを、この順に出す', () => {
    const element = renderSelectionBar(2, handlers())!;
    const testids = [...element.querySelectorAll<HTMLButtonElement>('button')].map((b) => b.dataset.testid);
    expect(testids).toEqual(['selection-count', 'selection-menu-button', 'next-button']);
  });
});
