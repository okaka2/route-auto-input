export type NoticeAction = { label: string; testid: string; onClick(): void; primary?: boolean };
export type Notice = { testid: string; text: string; actions: NoticeAction[] };

/** 一覧の上に出す1つのお知らせ(ホーム画面への追加・バックアップなど)。同時に1つだけ出す。 */
export function renderNotice(notice: Notice): HTMLElement {
  const box = document.createElement('div');
  box.className = 'notice';
  box.dataset.testid = notice.testid;
  box.setAttribute('role', 'status');
  const text = document.createElement('p');
  text.className = 'notice-text';
  text.textContent = notice.text;
  const actions = document.createElement('div');
  actions.className = 'notice-actions';
  for (const action of notice.actions) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = action.primary ? 'primary' : '';
    button.dataset.testid = action.testid;
    button.textContent = action.label;
    button.addEventListener('click', () => action.onClick());
    actions.append(button);
  }
  box.append(text, actions);
  return box;
}
