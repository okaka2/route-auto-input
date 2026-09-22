export type SelectionBarHandlers = {
  onNext(): void;
};

/**
 * 訪問先を1件以上選んでいるときに、下部に固定して出す選択バー。
 * 件数と「訪問順を決める →」。1件も選んでいなければ null(何も出さない)。
 */
export function renderSelectionBar(
  count: number,
  handlers: SelectionBarHandlers,
): HTMLElement | null {
  if (count === 0) {
    return null;
  }

  const bar = document.createElement('div');
  bar.className = 'selection-bar';
  bar.dataset.testid = 'selection-bar';
  bar.setAttribute('role', 'region');
  bar.setAttribute('aria-label', '選択中の訪問先');

  const label = document.createElement('span');
  label.className = 'selection-count';
  label.dataset.testid = 'selection-count';
  label.textContent = `${count}件選択中`;

  const next = document.createElement('button');
  next.type = 'button';
  next.className = 'primary';
  next.dataset.testid = 'next-button';
  next.textContent = '訪問順を決める →';
  next.addEventListener('click', () => handlers.onNext());

  bar.append(label, next);
  return bar;
}
