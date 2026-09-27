import { installSteps } from '../installHint';
import { installPlatform } from '../platform';
import type { AppState, Dialog, Patient, SpotKind } from '../types';
import { renderLocationDialog, renderSpotDialog } from './locationDialog';

export type DialogHandlers = {
  onEdit(id: string): void;
  onDuplicate(id: string): void;
  /** 「削除」を押した。まだ削除しない(確認のダイアログへ進む)。 */
  onRequestDelete(id: string): void;
  /** 確認のダイアログで「削除」を押した。ここで初めて削除を実行する。 */
  onConfirmDelete(id: string): void;
  /** 複数選択の一括削除の確認で「削除」を押した。対象はstate.selectedIds。 */
  onConfirmDeleteSelected(): void;
  /** 訪問順の「⋯」: 先頭へ。 */
  onMoveToTop(id: string): void;
  /** 訪問順の「⋯」: 最後へ。 */
  onMoveToBottom(id: string): void;
  /** 同じ人の知らせ: そのまま登録する。 */
  onSaveAnyway(): void;
  /** 同じ人の知らせ: 登録済みの訪問先を開く。 */
  onOpenExisting(id: string): void;
  /** 一覧の「⋯」: 位置の登録・確認ダイアログを開く。 */
  onOpenLocation(id: string): void;
  /** 位置の登録: 今いる場所の測定を始める/やり直す。 */
  onStartMeasuring(): void;
  /** 位置の登録: 測った位置で登録する。 */
  onSaveMeasured(): void;
  /** 位置の登録: 貼り付け欄の入力。 */
  onPasteChange(text: string): void;
  /** 位置の登録: 貼り付け欄(details)の開閉。 */
  onPasteToggle(open: boolean): void;
  /** 位置の登録: 貼り付けた位置で登録する。 */
  onSavePasted(): void;
  /** 位置の登録: 登録済みの位置を消す。 */
  onRemove(): void;
  /** 位置の登録: 保存した直後に元へ戻す。 */
  onUndo(): void;
  /** お役立ち地点の登録: 種類・メモの入力のたび、入力中の内容をstateに保つ。 */
  onSpotDraft(draft: { spotKind: SpotKind; note: string }): void;
  /** 位置の貼り付け欄・地点のメモ欄がIME変換中かどうか(compositionstart/compositionendのたび)。 */
  onComposingChange(composing: boolean): void;
  /** お役立ち地点の登録: 測った位置とそのときのspotKind・noteで登録する。 */
  onSaveSpot(): void;
  /** 写真のダイアログ: 前/次へ切り替える(表示中のindexを変える)。 */
  onPhotoIndex(index: number): void;
  onClose(): void;
};

/**
 * 開いているダイアログを描画する。なければ(または1件向けのダイアログで対象の訪問先が
 * 見つからなければ)null。
 *
 * - 「⋯」メニュー: 編集 / 複製して登録 / 削除(赤) / キャンセル
 * - 削除の確認: 「この訪問先を削除しますか?」 [キャンセル] [削除(赤)]
 * - 複数選択の一括削除の確認: 「選択した◯件を削除しますか?」 [キャンセル] [削除(赤)]
 *
 * フォーカスの移動(開いたら最初のボタン、閉じたら「⋯」へ戻す)と、Escキーで閉じる処理は、
 * 画面全体を描き直す main.ts の側で行う。ここではTabキーの巡回だけを面倒みる。
 */
export function renderDialog(state: AppState, handlers: DialogHandlers): HTMLElement | null {
  const dialog = state.dialog;
  if (dialog === null) {
    return null;
  }

  let content: HTMLElement[];
  if (dialog.kind === 'installSteps') {
    content = renderInstallSteps(handlers);
  } else if (dialog.kind === 'confirmDeleteSelected') {
    content = renderConfirmDeleteSelected(state.selectedIds.length, handlers);
  } else if (dialog.kind === 'similar') {
    content = renderSimilar(state, dialog, handlers);
  } else if (dialog.kind === 'photos') {
    content = renderPhotos(dialog, handlers);
  } else if (dialog.kind === 'spot') {
    content = renderSpotDialog(dialog, handlers);
  } else {
    const patient = state.patients.find((item) => item.id === dialog.id);
    if (patient === undefined) {
      return null;
    }
    if (dialog.kind === 'rowMenu') {
      content = renderMenu(patient, handlers);
    } else if (dialog.kind === 'stopMenu') {
      content = renderStopMenu(patient, handlers);
    } else if (dialog.kind === 'location') {
      content = renderLocationDialog(patient, dialog, handlers);
    } else {
      content = renderConfirmDelete(patient, handlers);
    }
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
  sheet.append(...content);

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
      testid: 'dialog-location',
      label: patient.location ? '位置を確かめる・やり直す' : '位置を登録',
      onClick: () => handlers.onOpenLocation(patient.id),
    },
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

function renderStopMenu(patient: Patient, handlers: DialogHandlers): HTMLElement[] {
  const title = document.createElement('h2');
  title.id = 'dialog-title';
  title.className = 'sheet-title';
  title.textContent = patient.name;

  const list = document.createElement('ul');
  list.className = 'sheet-actions';
  const actions: { testid: string; label: string; onClick: () => void }[] = [
    { testid: 'dialog-move-top', label: '先頭へ', onClick: () => handlers.onMoveToTop(patient.id) },
    { testid: 'dialog-move-bottom', label: '最後へ', onClick: () => handlers.onMoveToBottom(patient.id) },
    { testid: 'dialog-cancel', label: 'キャンセル', onClick: () => handlers.onClose() },
  ];
  for (const action of actions) {
    const item = document.createElement('li');
    item.append(actionButton(action.label, action.testid, action.onClick));
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

function renderInstallSteps(handlers: DialogHandlers): HTMLElement[] {
  const title = document.createElement('h2');
  title.id = 'dialog-title';
  title.className = 'sheet-title';
  title.textContent = 'ホーム画面に追加する';
  const list = document.createElement('ol');
  list.className = 'sheet-steps';
  for (const step of installSteps(installPlatform())) {
    const item = document.createElement('li');
    item.textContent = step;
    list.append(item);
  }
  const buttons = document.createElement('div');
  buttons.className = 'sheet-buttons';
  buttons.append(actionButton('閉じる', 'dialog-cancel', () => handlers.onClose()));
  return [title, list, buttons];
}

function renderSimilar(
  state: AppState,
  dialog: Extract<Dialog, { kind: 'similar' }>,
  handlers: DialogHandlers,
): HTMLElement[] {
  const title = document.createElement('h2');
  title.id = 'dialog-title';
  title.className = 'sheet-title';
  title.textContent = '同じ名前か住所の訪問先があります';
  const list = document.createElement('ul');
  list.className = 'sheet-list';
  const matches = dialog.matchIds
    .map((id) => state.patients.find((p) => p.id === id))
    .filter((p): p is Patient => p !== undefined);
  for (const match of matches) {
    const item = document.createElement('li');
    item.textContent = `${match.name}(${match.address})`;
    list.append(item);
  }
  const actions = document.createElement('ul');
  actions.className = 'sheet-actions';
  const first = matches[0];
  const entries = [
    { testid: 'dialog-save-anyway', label: 'そのまま登録', onClick: () => handlers.onSaveAnyway() },
    ...(first
      ? [{ testid: 'dialog-open-existing', label: '登録済みを開く', onClick: () => handlers.onOpenExisting(first.id) }]
      : []),
    { testid: 'dialog-cancel', label: '戻って直す', onClick: () => handlers.onClose() },
  ];
  for (const entry of entries) {
    const item = document.createElement('li');
    item.append(actionButton(entry.label, entry.testid, entry.onClick));
    actions.append(item);
  }
  return [title, list, actions];
}

/** 写真のダイアログ: 1枚を大きく表示し、前/次で切り替える。 */
function renderPhotos(dialog: Extract<Dialog, { kind: 'photos' }>, handlers: DialogHandlers): HTMLElement[] {
  const title = document.createElement('h2');
  title.id = 'dialog-title';
  title.className = 'sheet-title';
  title.textContent = '写真';

  const view = document.createElement('div');
  view.className = 'photo-view';
  const img = document.createElement('img');
  img.src = dialog.urls[dialog.index] ?? '';
  img.alt = `写真${dialog.index + 1}`;
  img.dataset.testid = 'photo-view';
  view.append(img);

  const nav = document.createElement('div');
  nav.className = 'photo-nav';

  const prev = document.createElement('button');
  prev.type = 'button';
  prev.dataset.testid = 'photo-prev';
  prev.textContent = '‹ 前';
  prev.disabled = dialog.index <= 0;
  prev.addEventListener('click', () => handlers.onPhotoIndex(dialog.index - 1));

  const count = document.createElement('span');
  count.className = 'photo-count-label';
  count.dataset.testid = 'photo-count-label';
  count.textContent = `${dialog.index + 1} / ${dialog.urls.length}`;

  const next = document.createElement('button');
  next.type = 'button';
  next.dataset.testid = 'photo-next';
  next.textContent = '次 ›';
  next.disabled = dialog.index >= dialog.urls.length - 1;
  next.addEventListener('click', () => handlers.onPhotoIndex(dialog.index + 1));

  nav.append(prev, count, next);

  const buttons = document.createElement('div');
  buttons.className = 'sheet-buttons';
  buttons.append(actionButton('閉じる', 'dialog-cancel', () => handlers.onClose()));

  return [title, view, nav, buttons];
}

function renderConfirmDeleteSelected(count: number, handlers: DialogHandlers): HTMLElement[] {
  const title = document.createElement('h2');
  title.id = 'dialog-title';
  title.className = 'sheet-title';
  title.textContent = `選択した${count}件を削除しますか?`;

  const buttons = document.createElement('div');
  buttons.className = 'sheet-buttons';
  buttons.append(
    actionButton('キャンセル', 'dialog-cancel', () => handlers.onClose()),
    actionButton(
      '削除',
      'dialog-confirm-delete-selected',
      () => handlers.onConfirmDeleteSelected(),
      'danger-fill',
    ),
  );
  return [title, buttons];
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
