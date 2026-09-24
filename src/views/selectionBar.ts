export type SelectionBarHandlers = {
  onNext(): void;
  /** 選択した件数をまとめて削除する。実際の削除は、確認ダイアログでの確定を経てから。 */
  onDeleteSelected(): void;
  /** 「N件選択中」を押したとき。一覧を「選択中」の表示に切り替える。 */
  onShowSelected(): void;
};

/**
 * 訪問先を1件以上選んでいるときに、下部に固定して出す選択バー。
 * 件数と「訪問順を決める →」、まとめて削除する「削除」。1件も選んでいなければ null(何も出さない)。
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

  const deleteButton = document.createElement('button');
  deleteButton.type = 'button';
  deleteButton.className = 'danger';
  deleteButton.dataset.testid = 'delete-selected-button';
  deleteButton.textContent = '削除';
  deleteButton.addEventListener('click', () => handlers.onDeleteSelected());

  const next = document.createElement('button');
  next.type = 'button';
  next.className = 'primary';
  next.dataset.testid = 'next-button';
  next.textContent = '訪問順を決める →';
  next.addEventListener('click', () => handlers.onNext());

  const actions = document.createElement('div');
  actions.className = 'selection-actions';
  actions.append(deleteButton, next);

  bar.append(label, actions);
  return bar;
}
