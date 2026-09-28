import { MIN_PASSWORD_LENGTH } from '../config';
import { describeRecipients } from '../recipients';
import type { ConflictChoice } from '../transfer';
import type { Patient, TransferReceiveDialog, TransferSendDialog } from '../types';
import { renderMessage } from './common';

export type TransferSendDialogHandlers = {
  /** 入力欄・チェックボックスの変更。 */
  onSendDraft(
    patch: Partial<
      Pick<
        TransferSendDialog,
        'includePhotos' | 'includeSpots' | 'useSharedSecret' | 'password' | 'passwordConfirm' | 'saveAsShared'
      >
    >,
  ): void;
  /** 「送る」を押した。 */
  onSubmit(): void;
  onClose(): void;
};

/**
 * 送るダイアログの中身。ダイアログの外枠(overlay/sheet)は views/dialogs.ts が担う
 * (renderMenu などと同じ)。
 *
 * - patients: dialog.patientIds に対応する訪問先(消えたものは除く)。0件ならお役立ち地点だけ送る。
 * - hasPhotoCandidates: 対象に写真のある人が1人でもいるか(「写真も含める」を出すかどうか)。
 * - spotCount: 登録済みのお役立ち地点の件数(「お役立ち地点も含める」を出すかどうか)。
 * - hasSharedSecret: 事業所の合言葉が保存されているか(「事業所の合言葉を使う」を出すかどうか)。
 */
export function renderTransferSendDialog(
  dialog: TransferSendDialog,
  patients: readonly Patient[],
  hasPhotoCandidates: boolean,
  spotCount: number,
  hasSharedSecret: boolean,
  handlers: TransferSendDialogHandlers,
): HTMLElement[] {
  const elements: HTMLElement[] = [];
  const working = dialog.phase === 'working';

  const title = document.createElement('h2');
  title.id = 'dialog-title';
  title.className = 'sheet-title';
  title.textContent = patients.length === 0 ? 'お役立ち地点を送る' : `${describeRecipients(patients)}を送る`;
  elements.push(title);

  const warning = document.createElement('p');
  warning.className = 'transfer-warning';
  warning.textContent = '名前・住所・電話・位置・駐車・メモ(と、含めれば写真)が相手に渡ります。';
  elements.push(warning);

  if (dialog.phase === 'done') {
    const done = document.createElement('p');
    done.className = 'sheet-text';
    done.dataset.testid = 'transfer-done-text';
    done.textContent = dialog.shared ? '送りました。' : 'ファイルを保存しました。LINE などで送ってください。';
    elements.push(done);

    const doneButtons = document.createElement('div');
    doneButtons.className = 'sheet-buttons';
    doneButtons.append(actionButton('閉じる', 'dialog-cancel', () => handlers.onClose()));
    elements.push(doneButtons);
    return elements;
  }

  if (dialog.error) {
    elements.push(renderMessage({ kind: 'error', text: dialog.error }));
  }

  const options = document.createElement('div');
  options.className = 'transfer-options';

  if (hasPhotoCandidates) {
    options.append(
      checkboxLabel('transfer-include-photos', '写真も含める', dialog.includePhotos, working, (checked) =>
        handlers.onSendDraft({ includePhotos: checked }),
      ),
    );
  }
  if (patients.length > 0 && spotCount > 0) {
    options.append(
      checkboxLabel(
        'transfer-include-spots',
        `お役立ち地点も含める(${spotCount}件)`,
        dialog.includeSpots,
        working,
        (checked) => handlers.onSendDraft({ includeSpots: checked }),
      ),
    );
  }
  if (hasSharedSecret) {
    options.append(
      checkboxLabel('transfer-use-shared', '事業所の合言葉を使う', dialog.useSharedSecret, working, (checked) =>
        handlers.onSendDraft({ useSharedSecret: checked }),
      ),
    );
  }
  if (options.childElementCount > 0) {
    elements.push(options);
  }

  const showPasswordFields = !hasSharedSecret || !dialog.useSharedSecret;
  if (showPasswordFields) {
    const passwordInput = document.createElement('input');
    passwordInput.type = 'password';
    passwordInput.autocomplete = 'new-password';
    passwordInput.value = dialog.password;
    passwordInput.dataset.testid = 'transfer-password';
    passwordInput.disabled = working;
    passwordInput.addEventListener('input', () => handlers.onSendDraft({ password: passwordInput.value }));

    const confirmInput = document.createElement('input');
    confirmInput.type = 'password';
    confirmInput.autocomplete = 'new-password';
    confirmInput.value = dialog.passwordConfirm;
    confirmInput.dataset.testid = 'transfer-password-confirm';
    confirmInput.disabled = working;
    confirmInput.addEventListener('input', () => handlers.onSendDraft({ passwordConfirm: confirmInput.value }));

    elements.push(labelled('パスワード', passwordInput), labelled('確認のパスワード', confirmInput));
    const passwordHint = document.createElement('p');
    passwordHint.className = 'hint';
    passwordHint.dataset.testid = 'transfer-password-hint';
    passwordHint.textContent = `${MIN_PASSWORD_LENGTH}文字以上。言葉をつなげると覚えやすくなります(例: さくら訪問2026秋)。`;
    elements.push(passwordHint);
    // すでに合言葉がある(が、このダイアログではオフにして別のパスワードを入力している)ときは、
    // 「保存する」ではなく「変える」という文言にする(何が起きるかを正しく伝えるため)。
    const saveAsSharedLabel = hasSharedSecret
      ? '事業所の合言葉を、このパスワードに変える'
      : 'この合言葉を事業所の合言葉として保存する';
    elements.push(
      checkboxLabel('transfer-save-shared', saveAsSharedLabel, dialog.saveAsShared, working, (checked) =>
        handlers.onSendDraft({ saveAsShared: checked }),
      ),
    );
  }

  const guide = document.createElement('p');
  guide.className = 'hint';
  guide.textContent =
    'パスワードは、LINE とは別の方法(口頭・電話など)で伝えてください。パスワードを忘れると、だれにも開けません。';
  elements.push(guide);

  const buttons = document.createElement('div');
  buttons.className = 'sheet-buttons';
  const cancelButton = actionButton('やめる', 'dialog-cancel', () => handlers.onClose());
  cancelButton.disabled = working;
  const submitButton = actionButton('送る', 'transfer-send-button', () => handlers.onSubmit(), 'primary');
  submitButton.disabled = working;
  buttons.append(cancelButton, submitButton);
  elements.push(buttons);

  return elements;
}

export type TransferReceiveDialogHandlers = {
  /** パスワード欄の入力。 */
  onReceivePassword(password: string): void;
  /** パスワードの画面で「開く」(またはEnterキー)。 */
  onReceiveSubmit(): void;
  /** 確認の画面で「追加する」。 */
  onReceiveConfirm(): void;
  /** 同じ人の画面で、その人をどうするか選んだ。 */
  onReceiveConflict(choice: ConflictChoice): void;
  onClose(): void;
};

/**
 * 受け取りのダイアログの中身(引き継ぎのファイルを読み込んだとき)。外枠は views/dialogs.ts が担う。
 * phase ごとに、パスワード → 確認 → 同じ人(1人ずつ) → 完了、と進む。working は復号・取り込みの最中。
 */
export function renderTransferReceiveDialog(
  dialog: TransferReceiveDialog,
  handlers: TransferReceiveDialogHandlers,
): HTMLElement[] {
  const elements: HTMLElement[] = [];

  const title = document.createElement('h2');
  title.id = 'dialog-title';
  title.className = 'sheet-title';
  title.textContent =
    dialog.phase === 'conflict'
      ? `同じ訪問先がすでにあります(${dialog.conflictIndex + 1}/${dialog.conflicts.length})`
      : '引き継ぎのファイルを読み込む';
  elements.push(title);

  if (dialog.error) {
    elements.push(renderMessage({ kind: 'error', text: dialog.error }));
  }

  if (dialog.phase === 'working') {
    const text = document.createElement('p');
    text.className = 'sheet-text';
    text.dataset.testid = 'receive-working-text';
    text.textContent = '少しお待ちください。';
    elements.push(text);
    return elements;
  }

  if (dialog.phase === 'password') {
    const prompt = document.createElement('p');
    prompt.className = 'sheet-text';
    prompt.textContent = 'パスワードを入れてください。';
    elements.push(prompt);

    const input = document.createElement('input');
    input.type = 'password';
    input.autocomplete = 'off';
    input.value = dialog.password;
    input.dataset.testid = 'receive-password';
    input.dataset.autofocus = '';
    input.addEventListener('input', () => handlers.onReceivePassword(input.value));
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.isComposing) {
        event.preventDefault();
        handlers.onReceiveSubmit();
      }
    });
    elements.push(labelled('パスワード', input));

    const guide = document.createElement('p');
    guide.className = 'hint';
    guide.textContent = 'パスワードを忘れると開けません。送った人に確かめてください。';
    elements.push(guide);

    const buttons = document.createElement('div');
    buttons.className = 'sheet-buttons';
    buttons.append(
      actionButton('やめる', 'dialog-cancel', () => handlers.onClose()),
      actionButton('開く', 'receive-password-submit', () => handlers.onReceiveSubmit(), 'primary'),
    );
    elements.push(buttons);
    return elements;
  }

  if (dialog.phase === 'confirm') {
    const question = document.createElement('p');
    question.className = 'sheet-text';
    question.dataset.testid = 'receive-summary';
    question.textContent = `${dialog.summary}を名簿に追加しますか?`;
    elements.push(question);

    const buttons = document.createElement('div');
    buttons.className = 'sheet-buttons';
    const confirmButton = actionButton('追加する', 'receive-confirm', () => handlers.onReceiveConfirm(), 'primary');
    confirmButton.dataset.autofocus = '';
    buttons.append(actionButton('やめる', 'dialog-cancel', () => handlers.onClose()), confirmButton);
    elements.push(buttons);
    return elements;
  }

  if (dialog.phase === 'conflict') {
    const conflict = dialog.conflicts[dialog.conflictIndex];
    if (conflict !== undefined) {
      const list = document.createElement('ul');
      list.className = 'sheet-list';
      const existing = document.createElement('li');
      existing.dataset.testid = 'conflict-existing';
      existing.textContent = `手元: ${conflict.existingName}(${conflict.existingAddress})`;
      const incoming = document.createElement('li');
      incoming.dataset.testid = 'conflict-incoming';
      incoming.textContent = `受け取った: ${conflict.incomingName}(${conflict.incomingAddress})`;
      list.append(existing, incoming);
      elements.push(list);
    }

    const actions = document.createElement('ul');
    actions.className = 'sheet-actions';
    // 最初のフォーカスは「この人は追加しない」にする(Enterを続けて押しても、手元の人を
    // うっかり上書きしないように。上書きは、選んで押したときだけ)。
    const skip = actionButton('この人は追加しない', 'conflict-skip', () => handlers.onReceiveConflict('skip'));
    skip.dataset.autofocus = '';
    const entries = [
      actionButton('上書き', 'conflict-overwrite', () => handlers.onReceiveConflict('overwrite')),
      actionButton('別に追加', 'conflict-add', () => handlers.onReceiveConflict('addNew')),
      skip,
      actionButton('やめる', 'dialog-cancel', () => handlers.onClose()),
    ];
    for (const button of entries) {
      const item = document.createElement('li');
      item.append(button);
      actions.append(item);
    }
    elements.push(actions);
    return elements;
  }

  // done(取り込み終わった。失敗したときは上の error だけを出す)
  if (dialog.result !== null) {
    const done = document.createElement('p');
    done.className = 'sheet-text';
    done.dataset.testid = 'receive-done-text';
    done.textContent = dialog.result;
    elements.push(done);
  }
  const buttons = document.createElement('div');
  buttons.className = 'sheet-buttons';
  const closeButton = actionButton('閉じる', 'dialog-cancel', () => handlers.onClose());
  closeButton.dataset.autofocus = '';
  buttons.append(closeButton);
  elements.push(buttons);
  return elements;
}

function checkboxLabel(
  testid: string,
  text: string,
  checked: boolean,
  disabled: boolean,
  onChange: (checked: boolean) => void,
): HTMLLabelElement {
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = checked;
  checkbox.disabled = disabled;
  checkbox.dataset.testid = testid;
  checkbox.addEventListener('change', () => onChange(checkbox.checked));
  const label = document.createElement('label');
  // .transfer-options の中と外、どちらの場所でも同じ見た目(タップ領域44px以上)にする。
  label.className = 'transfer-check';
  label.append(checkbox, document.createTextNode(` ${text}`));
  return label;
}

function labelled(text: string, input: HTMLInputElement): HTMLLabelElement {
  const label = document.createElement('label');
  label.className = 'field';
  const caption = document.createElement('span');
  caption.className = 'field-label';
  caption.textContent = text;
  label.append(caption, input);
  return label;
}

function actionButton(label: string, testid: string, onClick: () => void, className?: string): HTMLButtonElement {
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
