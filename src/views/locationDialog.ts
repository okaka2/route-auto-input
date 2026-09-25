import { accuracyLevel, pointOf } from '../geoPoint';
import { buildGoogleMapsUrl } from '../googleMapsUrl';
import { SPOT_KINDS } from '../spots';
import type { GeoLocation, LocationDialog, Patient, SpotDialog, SpotKind } from '../types';

export type LocationDialogHandlers = {
  onStartMeasuring(): void;
  onSaveMeasured(): void;
  onPasteChange(text: string): void;
  /** 貼り付け欄(details)の開閉が変わった(toggleイベント)。 */
  onPasteToggle(open: boolean): void;
  onSavePasted(): void;
  /** 登録済みのとき「位置を消す」。 */
  onRemove(): void;
  /** saved のとき「元に戻す」。 */
  onUndo(): void;
  onClose(): void;
};

/** renderMeasure が必要とする操作だけの最小限のハンドラー(位置・地点どちらのダイアログからも渡せる)。 */
export type MeasureHandlers = {
  onStartMeasuring(): void;
};

export type SpotDialogHandlers = {
  onStartMeasuring(): void;
  /** 種類・メモの入力のたび、入力中の内容をstateに保つ。 */
  onSpotDraft(draft: { spotKind: SpotKind; note: string }): void;
  /** 測った位置と、そのときのspotKind・noteでお役立ち地点として登録する。 */
  onSaveSpot(): void;
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

  if (dialog.phase === 'saved') {
    elements.push(...renderSavedPhase(patient, handlers));
  } else {
    const measured = renderMeasure(dialog.phase, dialog.best, dialog.error, handlers);
    if (dialog.phase === 'measuring' || dialog.phase === 'measured') {
      measured.splice(1, 0, renderRegisterButton('location-save-button', dialog.best, () => handlers.onSaveMeasured()));
    }
    elements.push(...measured);
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

/**
 * 測定の共通部分(idle: 「今いる場所で登録」と注意書き / measuring・measured: 状態表示と
 * measuredなら「もう一度測る」 / error: エラーと「もう一度測る」)。位置・地点どちらの
 * ダイアログでも使う。登録ボタン(保存する内容がダイアログごとに違う)はここには含めない。
 */
export function renderMeasure(
  phase: 'idle' | 'measuring' | 'measured' | 'saved' | 'error',
  best: { lat: number; lng: number; accuracy: number } | null,
  error: string | null,
  handlers: MeasureHandlers,
): HTMLElement[] {
  if (phase === 'idle') {
    return renderIdlePhase(handlers);
  }
  if (phase === 'measuring' || phase === 'measured') {
    return renderMeasuringPhase(phase, best, handlers);
  }
  if (phase === 'error') {
    return renderErrorPhase(error, handlers);
  }
  return [];
}

function renderIdlePhase(handlers: MeasureHandlers): HTMLElement[] {
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

function renderMeasuringPhase(
  phase: 'measuring' | 'measured',
  best: { lat: number; lng: number; accuracy: number } | null,
  handlers: MeasureHandlers,
): HTMLElement[] {
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

  const elements: HTMLElement[] = [status];

  if (phase === 'measured') {
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

function renderErrorPhase(error: string | null, handlers: MeasureHandlers): HTMLElement[] {
  const message = document.createElement('p');
  message.className = 'location-status poor';
  message.textContent = error ?? '';

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'primary block';
  button.dataset.testid = 'location-measure-button';
  button.textContent = 'もう一度測る';
  button.addEventListener('click', () => handlers.onStartMeasuring());

  return [message, button];
}

/** 測った位置で登録するボタン(位置は location-save-button、地点は spot-save-button)。best が無ければ押せない。 */
function renderRegisterButton(
  testid: string,
  best: { accuracy: number } | null,
  onClick: () => void,
): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'primary block';
  button.dataset.testid = testid;
  button.textContent = 'この位置で登録';
  button.disabled = best === null;
  button.addEventListener('click', onClick);
  return button;
}

function renderSavedPhase(patient: Patient, handlers: LocationDialogHandlers): HTMLElement[] {
  const location = patient.location;
  const message = document.createElement('p');
  message.className = statusClass(location?.accuracy ?? null);
  message.textContent =
    location && location.accuracy !== null
      ? `登録しました(${accuracyPhrase(location.accuracy)})`
      : '登録しました(貼り付けた位置)';

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
  // 手で開いたまま、入力中、エラー表示中は、再描画のたびに閉じてしまわないよう開いたままにする。
  details.open = dialog.pasteOpen || dialog.pasteText !== '' || dialog.pasteError !== null;
  details.addEventListener('toggle', () => handlers.onPasteToggle(details.open));

  const summary = document.createElement('summary');
  summary.textContent = '座標やURLを貼り付けて登録';
  details.append(summary);

  const input = document.createElement('input');
  input.type = 'text';
  input.dataset.testid = 'location-paste-input';
  input.setAttribute('aria-label', '座標またはGoogleマップのURL');
  input.placeholder = '例) 35.68124, 139.76712';
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

/**
 * お役立ち地点の登録ダイアログの中身。位置の登録ダイアログと同じ測定の流れ(renderMeasure)を使い、
 * 種類の選択と一言メモを加える。貼り付けでの登録は地点では出さない。
 */
export function renderSpotDialog(dialog: SpotDialog, handlers: SpotDialogHandlers): HTMLElement[] {
  const elements: HTMLElement[] = [];

  const title = document.createElement('h2');
  title.id = 'dialog-title';
  title.className = 'sheet-title';
  title.textContent = 'お役立ち地点を登録';
  elements.push(title);

  if (dialog.phase === 'saved') {
    const message = document.createElement('p');
    message.className = 'location-status good';
    message.textContent = '登録しました';
    elements.push(message);
  } else {
    const measured = renderMeasure(dialog.phase, dialog.best, dialog.error, handlers);
    if (dialog.phase === 'measuring' || dialog.phase === 'measured') {
      measured.splice(1, 0, renderRegisterButton('spot-save-button', dialog.best, () => handlers.onSaveSpot()));
    }
    elements.push(...measured, renderSpotKindSelect(dialog, handlers), renderSpotNoteInput(dialog, handlers));
  }

  const buttons = document.createElement('div');
  buttons.className = 'sheet-buttons';
  buttons.append(actionButton('閉じる', 'dialog-cancel', () => handlers.onClose()));
  elements.push(buttons);

  return elements;
}

function renderSpotKindSelect(dialog: SpotDialog, handlers: SpotDialogHandlers): HTMLElement {
  const wrapper = document.createElement('label');
  wrapper.className = 'field';

  const caption = document.createElement('span');
  caption.className = 'field-label';
  caption.textContent = '種類';
  wrapper.append(caption);

  const select = document.createElement('select');
  select.className = 'form-select';
  select.dataset.testid = 'spot-kind-select';
  for (const option of SPOT_KINDS) {
    const optionElement = document.createElement('option');
    optionElement.value = option.value;
    optionElement.textContent = option.label;
    select.append(optionElement);
  }
  select.value = dialog.spotKind;
  select.addEventListener('change', () => {
    handlers.onSpotDraft({ spotKind: select.value as SpotKind, note: dialog.note });
  });
  wrapper.append(select);

  return wrapper;
}

function renderSpotNoteInput(dialog: SpotDialog, handlers: SpotDialogHandlers): HTMLElement {
  const wrapper = document.createElement('label');
  wrapper.className = 'field';

  const caption = document.createElement('span');
  caption.className = 'field-label';
  caption.textContent = '一言メモ';
  wrapper.append(caption);

  const input = document.createElement('input');
  input.type = 'text';
  input.dataset.testid = 'spot-note-input';
  input.placeholder = '例) 24時間開いている';
  input.value = dialog.note;
  input.addEventListener('input', () => {
    handlers.onSpotDraft({ spotKind: dialog.spotKind, note: input.value });
  });
  wrapper.append(input);

  return wrapper;
}

function actionButton(label: string, testid: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.dataset.testid = testid;
  button.addEventListener('click', onClick);
  return button;
}
