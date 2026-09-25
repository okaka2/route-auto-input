import { accuracyLevel, pointOf } from '../geoPoint';
import { buildGoogleMapsUrl } from '../googleMapsUrl';
import type { GeoLocation, LocationDialog, Patient } from '../types';

export type LocationDialogHandlers = {
  onStartMeasuring(): void;
  onSaveMeasured(): void;
  onPasteChange(text: string): void;
  onSavePasted(): void;
  /** 登録済みのとき「位置を消す」。 */
  onRemove(): void;
  /** saved のとき「元に戻す」。 */
  onUndo(): void;
  onClose(): void;
};

/** 日時(ISO 8601)を「月/日」の形にする(端末のローカル時刻)。読めなければ空文字。 */
function formatDateOnly(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

/** 「誤差 ±Nm」。精度が分からない(貼り付けなど)ときは空文字。 */
function accuracyPhrase(accuracy: number | null): string {
  return accuracy === null ? '' : `誤差 ±${Math.round(accuracy)}m`;
}

/** good/poor のときだけ .location-status に付ける修飾クラス。 */
function statusClass(accuracy: number | null): string {
  if (accuracy === null) {
    return 'location-status';
  }
  const level = accuracyLevel(accuracy);
  return level === 'good' ? 'location-status good' : level === 'poor' ? 'location-status poor' : 'location-status';
}

/** 精度に応じた案内(good: 登録できます / poor: 屋外での再測定を促す / fair: なし)。 */
function levelMessage(accuracy: number): string {
  const level = accuracyLevel(accuracy);
  if (level === 'good') {
    return '登録できます';
  }
  if (level === 'poor') {
    return '車の外や屋外で、もう一度試してください。';
  }
  return '';
}

/**
 * 位置の登録ダイアログの中身(見出し・登録済みの状態・phaseごとの操作・貼り付け欄・消す/閉じる)。
 * ダイアログの外枠(overlay/sheet)は views/dialogs.ts が担う。
 */
export function renderLocationDialog(
  patient: Patient,
  dialog: LocationDialog,
  handlers: LocationDialogHandlers,
): HTMLElement[] {
  const elements: HTMLElement[] = [];

  const title = document.createElement('h2');
  title.id = 'dialog-title';
  title.className = 'sheet-title';
  title.textContent = `${patient.name}の位置`;
  elements.push(title);

  if (patient.location && dialog.phase !== 'saved') {
    elements.push(renderRegisteredStatus(patient.location), renderCheckLink(patient));
  }

  if (dialog.phase === 'idle') {
    elements.push(...renderIdlePhase(handlers));
  } else if (dialog.phase === 'measuring' || dialog.phase === 'measured') {
    elements.push(...renderMeasuringPhase(dialog, handlers));
  } else if (dialog.phase === 'error') {
    elements.push(...renderErrorPhase(dialog, handlers));
  } else {
    elements.push(...renderSavedPhase(patient, handlers));
  }

  if (dialog.phase !== 'saved') {
    elements.push(renderPasteSection(dialog, handlers));
  }

  if (patient.location && dialog.phase !== 'saved') {
    elements.push(renderRemoveButton(handlers));
  }

  const buttons = document.createElement('div');
  buttons.className = 'sheet-buttons';
  buttons.append(actionButton('閉じる', 'dialog-cancel', () => handlers.onClose()));
  elements.push(buttons);

  return elements;
}

function renderRegisteredStatus(location: GeoLocation): HTMLElement {
  const p = document.createElement('p');
  p.className = 'sheet-text';
  const acc = accuracyPhrase(location.accuracy);
  const date = formatDateOnly(location.recordedAt);
  p.textContent = acc ? `登録済み: ${acc}(${date} 登録)` : `登録済み(${date} 登録)`;
  return p;
}

function renderCheckLink(patient: Patient): HTMLAnchorElement {
  const link = document.createElement('a');
  link.className = 'map-check';
  link.dataset.testid = 'location-check-link';
  link.href = buildGoogleMapsUrl([pointOf(patient)]);
  link.target = '_blank';
  link.rel = 'noreferrer';
  link.textContent = '地図で確かめる';
  return link;
}

function renderIdlePhase(handlers: LocationDialogHandlers): HTMLElement[] {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'primary block';
  button.dataset.testid = 'location-measure-button';
  button.textContent = '今いる場所で登録';
  button.addEventListener('click', () => handlers.onStartMeasuring());

  const note = document.createElement('p');
  note.className = 'hint';
  note.textContent = '停車してから押してください。車の外や屋外のほうが正確です。';

  return [button, note];
}

function renderMeasuringPhase(dialog: LocationDialog, handlers: LocationDialogHandlers): HTMLElement[] {
  const best = dialog.best;
  const status = document.createElement('p');
  status.className = statusClass(best?.accuracy ?? null);
  const parts = [best ? `位置を取得しています… ${accuracyPhrase(best.accuracy)}` : '位置を取得しています…'];
  if (best) {
    const message = levelMessage(best.accuracy);
    if (message) {
      parts.push(message);
    }
  }
  status.textContent = parts.join(' ');

  const saveButton = document.createElement('button');
  saveButton.type = 'button';
  saveButton.className = 'primary block';
  saveButton.dataset.testid = 'location-save-button';
  saveButton.textContent = 'この位置で登録';
  saveButton.disabled = best === null;
  saveButton.addEventListener('click', () => handlers.onSaveMeasured());

  const elements = [status, saveButton];

  if (dialog.phase === 'measured') {
    const remeasure = document.createElement('button');
    remeasure.type = 'button';
    remeasure.className = 'block';
    remeasure.dataset.testid = 'location-measure-button';
    remeasure.textContent = 'もう一度測る';
    remeasure.addEventListener('click', () => handlers.onStartMeasuring());
    elements.push(remeasure);
  }

  return elements;
}

function renderErrorPhase(dialog: LocationDialog, handlers: LocationDialogHandlers): HTMLElement[] {
  const message = document.createElement('p');
  message.className = 'location-status poor';
  message.textContent = dialog.error ?? '';

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'primary block';
  button.dataset.testid = 'location-measure-button';
  button.textContent = 'もう一度測る';
  button.addEventListener('click', () => handlers.onStartMeasuring());

  return [message, button];
}

function renderSavedPhase(patient: Patient, handlers: LocationDialogHandlers): HTMLElement[] {
  const acc = patient.location ? accuracyPhrase(patient.location.accuracy) : '';
  const message = document.createElement('p');
  message.className = 'location-status good';
  message.textContent = acc ? `登録しました(${acc})` : '登録しました。';

  const undo = document.createElement('button');
  undo.type = 'button';
  undo.className = 'block';
  undo.dataset.testid = 'location-undo-button';
  undo.textContent = '元に戻す';
  undo.addEventListener('click', () => handlers.onUndo());

  return [message, renderCheckLink(patient), undo];
}

function renderPasteSection(dialog: LocationDialog, handlers: LocationDialogHandlers): HTMLElement {
  const details = document.createElement('details');
  details.className = 'location-paste';

  const summary = document.createElement('summary');
  summary.textContent = '座標やURLを貼り付けて登録';
  details.append(summary);

  const input = document.createElement('input');
  input.type = 'text';
  input.dataset.testid = 'location-paste-input';
  input.value = dialog.pasteText;
  input.addEventListener('input', () => handlers.onPasteChange(input.value));
  details.append(input);

  const saveButton = document.createElement('button');
  saveButton.type = 'button';
  saveButton.className = 'block';
  saveButton.dataset.testid = 'location-paste-save';
  saveButton.textContent = '貼り付けた位置で登録';
  saveButton.addEventListener('click', () => handlers.onSavePasted());
  details.append(saveButton);

  if (dialog.pasteError) {
    const error = document.createElement('p');
    error.className = 'location-status poor';
    error.textContent = dialog.pasteError;
    details.append(error);
  }

  return details;
}

function renderRemoveButton(handlers: LocationDialogHandlers): HTMLElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'danger block';
  button.dataset.testid = 'location-remove-button';
  button.textContent = '位置を消す';
  button.addEventListener('click', () => handlers.onRemove());
  return button;
}

function actionButton(label: string, testid: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.dataset.testid = testid;
  button.addEventListener('click', onClick);
  return button;
}
