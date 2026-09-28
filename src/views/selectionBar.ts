export type SelectionBarHandlers = {
  onNext(): void;
  /** 「N件選択中」を押したとき。一覧を「選択中」の表示に切り替える。 */
  onShowSelected(): void;
  /** 「⋯」。送る・削除の小窓を開く。 */
  onOpenMenu(): void;
};

/**
 * 訪問先を1件以上選んでいるときに、下部に固定して出す選択バー。
 * 件数・「⋯」(送る・削除はここから開く小窓に入る)・「訪問順を決める →」の1段。
 * 1件も選んでいなければ null(何も出さない)。
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

  const label = document.createElement('button');
  label.type = 'button';
  label.className = 'selection-count';
  label.dataset.testid = 'selection-count';
  label.textContent = `${count}件選択中`;
  label.addEventListener('click', () => handlers.onShowSelected());

  const menuButton = document.createElement('button');
  menuButton.type = 'button';
  menuButton.className = 'more';
  menuButton.dataset.testid = 'selection-menu-button';
  menuButton.setAttribute('aria-label', '選択中の訪問先の操作');
  menuButton.setAttribute('aria-haspopup', 'dialog');
  menuButton.textContent = '⋯';
  menuButton.addEventListener('click', () => handlers.onOpenMenu());

  const next = document.createElement('button');
  next.type = 'button';
  next.className = 'primary';
  next.dataset.testid = 'next-button';
  next.textContent = '訪問順を決める →';
  next.addEventListener('click', () => handlers.onNext());

  const actions = document.createElement('div');
  actions.className = 'selection-actions';
  actions.append(menuButton, next);

  bar.append(label, actions);
  return bar;
}
