import type { AppState, Patient } from '../types';

export type DialogHandlers = {
  onEdit(id: string): void;
  onDuplicate(id: string): void;
  /** 「削除」を押した。まだ削除しない(確認のダイアログへ進む)。 */
  onRequestDelete(id: string): void;
  /** 確認のダイアログで「削除」を押した。ここで初めて削除を実行する。 */
  onConfirmDelete(id: string): void;
  onClose(): void;
};

/**
 * 開いているダイアログを描画する。なければ(または対象の訪問先が見つからなければ)null。
 *
 * - 「⋯」メニュー: 編集 / 複製して登録 / 削除(赤) / キャンセル
 * - 削除の確認: 「この訪問先を削除しますか?」 [キャンセル] [削除(赤)]
 *
 * フォーカスの移動(開いたら最初のボタン、閉じたら「⋯」へ戻す)と、Escキーで閉じる処理は、
 * 画面全体を描き直す main.ts の側で行う。ここではTabキーの巡回だけを面倒みる。
 */
export function renderDialog(state: AppState, handlers: DialogHandlers): HTMLElement | null {
  const dialog = state.dialog;
  if (dialog === null) {
    return null;
  }
  const patient = state.patients.find((item) => item.id === dialog.id);
  if (patient === undefined) {
    return null;
  }

  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.dataset.testid = 'dialog-overlay';
  // 背景(ダイアログの外側)を押したら閉じる。内側の押下では閉じない。
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) {
      handlers.onClose();
    }
  });

  const sheet = document.createElement('div');
  sheet.className = 'sheet';
  sheet.dataset.testid = 'dialog';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  sheet.setAttribute('aria-labelledby', 'dialog-title');
  sheet.addEventListener('keydown', trapFocus);

  if (dialog.kind === 'rowMenu') {
    sheet.append(...renderMenu(patient, handlers));
  } else {
    sheet.append(...renderConfirmDelete(patient, handlers));
  }

  overlay.append(sheet);
  return overlay;
}

function renderMenu(patient: Patient, handlers: DialogHandlers): HTMLElement[] {
  const title = document.createElement('h2');
  title.id = 'dialog-title';
  title.className = 'sheet-title';
  title.textContent = patient.name;

  const list = document.createElement('ul');
  list.className = 'sheet-actions';
  const actions: { testid: string; label: string; className?: string; onClick: () => void }[] = [
    { testid: 'dialog-edit', label: '編集', onClick: () => handlers.onEdit(patient.id) },
    { testid: 'dialog-duplicate', label: '複製して登録', onClick: () => handlers.onDuplicate(patient.id) },
    {
      testid: 'dialog-delete',
      label: '削除',
      className: 'danger',
      onClick: () => handlers.onRequestDelete(patient.id),
    },
    { testid: 'dialog-cancel', label: 'キャンセル', onClick: () => handlers.onClose() },
  ];
  for (const action of actions) {
    const item = document.createElement('li');
    item.append(actionButton(action.label, action.testid, action.onClick, action.className));
    list.append(item);
  }
  return [title, list];
}

function renderConfirmDelete(patient: Patient, handlers: DialogHandlers): HTMLElement[] {
  const title = document.createElement('h2');
  title.id = 'dialog-title';
  title.className = 'sheet-title';
  title.textContent = 'この訪問先を削除しますか?';

  const target = document.createElement('p');
  target.className = 'sheet-text';
  target.dataset.testid = 'dialog-target';
  target.textContent = patient.name;

  const buttons = document.createElement('div');
  buttons.className = 'sheet-buttons';
  buttons.append(
    actionButton('キャンセル', 'dialog-cancel', () => handlers.onClose()),
    actionButton('削除', 'dialog-confirm-delete', () => handlers.onConfirmDelete(patient.id), 'danger-fill'),
  );
  return [title, target, buttons];
}

function actionButton(
  label: string,
  testid: string,
  onClick: () => void,
  className?: string,
): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.dataset.testid = testid;
  if (className) {
    button.className = className;
  }
  button.addEventListener('click', onClick);
  return button;
}

/** Tabキーでフォーカスがダイアログの外へ出ないよう、最後の次は最初へ、最初の前は最後へ回す。 */
function trapFocus(event: KeyboardEvent): void {
  if (event.key !== 'Tab') {
    return;
  }
  const sheet = event.currentTarget as HTMLElement;
  const buttons = [...sheet.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
  const first = buttons[0];
  const last = buttons[buttons.length - 1];
  if (first === undefined || last === undefined) {
    return;
  }
  const active = document.activeElement;
  if (event.shiftKey && active === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}
