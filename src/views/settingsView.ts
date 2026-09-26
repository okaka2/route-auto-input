import { APP_NAME, APP_VERSION } from '../appInfo';
import { formatLastBackup } from '../backupReminder';
import { formatDateOnly } from '../format';
import type { Office } from '../routePlan';
import { spotLabel } from '../spots';
import type { ThemeSetting } from '../theme';
import type { AppState, Spot } from '../types';
import { renderMessage, renderScreenHeader } from './common';

export type SettingsInfo = {
  /** 最後にバックアップを書き出した日時(ISO 8601)。無ければ null。 */
  lastBackupAt: string | null;
  /** ブラウザがデータの保護を約束しているか。まだ確かめていなければ null。 */
  persisted: boolean | null;
  theme: ThemeSetting;
  office: Office | null;
  /** 登録済みのお役立ち地点(トイレ・休憩など)。 */
  spots: Spot[];
  /** 登録済みの写真の合計バイト数(0なら「写真も含める」を出さない)。 */
  photoBytes: number;
};

export type SettingsHandlers = {
  onExport(includePhotos: boolean): void;
  onImport(file: File, mode: 'replace' | 'merge'): void;
  onThemeChange(setting: ThemeSetting): void;
  onBack(): void;
  onSaveOffice(name: string, address: string): void;
  onClearOffice(): void;
  onClearHistory(): void;
  /** お役立ち地点の一覧の「削除」。確認してから消す。 */
  onDeleteSpot(id: string): void;
};

/** 設定画面。出発地・帰着地 → バックアップ → データの保存状態 → 表示 → このアプリについて の順。 */
export function renderSettings(
  state: AppState,
  info: SettingsInfo,
  handlers: SettingsHandlers,
  now: Date = new Date(),
): HTMLElement {
  const container = document.createElement('div');
  container.className = 'screen';
  container.append(renderScreenHeader('設定', { onBack: handlers.onBack }));
  if (state.message) {
    container.append(renderMessage(state.message));
  }
  const count = document.createElement('p');
  count.className = 'hint';
  count.textContent = `登録されている訪問先: ${state.patients.length}件`;
  container.append(
    count,
    renderOffice(info, handlers),
    renderBackup(info, handlers, now),
    renderSpots(info, handlers),
    renderProtection(info, handlers),
    renderTheme(info, handlers),
    renderAbout(),
  );
  return container;
}

/** 「お役立ち地点」: 種類・メモ・登録日の一覧と、各行の削除。 */
function renderSpots(info: SettingsInfo, handlers: SettingsHandlers): HTMLElement {
  const card = section('お役立ち地点');
  if (info.spots.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'hint';
    empty.textContent = 'まだありません。地図を開く画面の下から登録できます。';
    card.append(empty);
    return card;
  }
  const list = document.createElement('ul');
  list.className = 'spot-list';
  for (const spot of info.spots) {
    const item = document.createElement('li');
    item.className = 'spot-row';
    const label = spot.note === '' ? spotLabel(spot.kind) : `${spotLabel(spot.kind)}・${spot.note}`;
    const text = document.createElement('span');
    text.textContent = `${label}(${formatDateOnly(spot.createdAt)} 登録)`;
    item.append(text, button('spot-delete', '削除', 'danger', () => handlers.onDeleteSpot(spot.id)));
    list.append(item);
  }
  card.append(list);
  return card;
}

function renderOffice(info: SettingsInfo, handlers: SettingsHandlers): HTMLElement {
  const card = section('出発地・帰着地');
  const note = document.createElement('p');
  note.textContent = '事業所を登録すると、訪問順の画面で「事業所から出発」「事業所へ戻る」を選べます。';
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.value = info.office?.name ?? '';
  nameInput.placeholder = '例) 本店';
  nameInput.dataset.testid = 'office-name-input';
  nameInput.setAttribute('aria-label', '事業所の名前');
  const addressInput = document.createElement('input');
  addressInput.type = 'text';
  addressInput.value = info.office?.address ?? '';
  addressInput.placeholder = '例) 東京都中央区1-2-3';
  addressInput.dataset.testid = 'office-address-input';
  addressInput.setAttribute('aria-label', '事業所の住所');
  const fields = document.createElement('div');
  fields.className = 'office-fields';
  fields.append(labelled('名前', nameInput), labelled('住所', addressInput));
  const buttons = document.createElement('div');
  buttons.className = 'office-buttons';
  buttons.append(button('office-save-button', '保存', 'primary', () => handlers.onSaveOffice(nameInput.value, addressInput.value)));
  if (info.office) {
    buttons.append(button('office-clear-button', '消す', '', () => handlers.onClearOffice()));
  }
  card.append(note, fields, buttons);
  return card;
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

function renderBackup(info: SettingsInfo, handlers: SettingsHandlers, now: Date): HTMLElement {
  const card = section('バックアップ');
  const last = document.createElement('p');
  last.className = 'hint';
  last.dataset.testid = 'last-backup';
  last.textContent = `最後のバックアップ: ${info.lastBackupAt ? formatLastBackup(info.lastBackupAt, now) : 'まだありません'}`;

  const note = document.createElement('p');
  note.textContent = '訪問先のデータをバックアップのファイルとして保存します。';

  let includePhotosInput: HTMLInputElement | null = null;
  let includePhotosLabel: HTMLLabelElement | null = null;
  if (info.photoBytes > 0) {
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = true;
    checkbox.dataset.testid = 'include-photos';
    includePhotosInput = checkbox;
    const label = document.createElement('label');
    label.className = 'backup-photos-field';
    label.append(checkbox, document.createTextNode(` 写真も含める(${formatPhotoBytes(info.photoBytes)})`));
    includePhotosLabel = label;
  }
  const exportButton = button('export-button', '書き出す', 'primary block', () =>
    handlers.onExport(includePhotosInput ? includePhotosInput.checked : true),
  );

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'application/json,.json';
  fileInput.dataset.testid = 'import-input';
  fileInput.setAttribute('aria-label', 'バックアップのファイルを選ぶ');
  const replaceRadio = radio('import-mode', 'replace', 'mode-replace', ' 今のデータを消して入れ替える');
  replaceRadio.input.checked = true;
  const mergeRadio = radio('import-mode', 'merge', 'mode-merge', ' 今のデータに追加する');
  const modes = document.createElement('fieldset');
  modes.className = 'modes';
  const legend = document.createElement('legend');
  legend.className = 'visually-hidden';
  legend.textContent = '読み込み方法';
  modes.append(legend, replaceRadio.label, mergeRadio.label);
  const importButton = button('import-button', '読み込む', 'block', () => {
    const file = fileInput.files?.[0];
    if (file) {
      handlers.onImport(file, mergeRadio.input.checked ? 'merge' : 'replace');
    }
  });
  card.append(last, note, ...(includePhotosLabel ? [includePhotosLabel] : []), exportButton, fileInput, modes, importButton);
  return card;
}

/** バックアップに含める写真の合計サイズの表示。data URL化(base64)で元のバイト数の約4/3になる分を見込む。 */
function formatPhotoBytes(bytes: number): string {
  const mb = (bytes * 4) / 3 / 1024 / 1024;
  if (mb < 0.1) {
    return '約0.1MB未満';
  }
  return `約${mb.toFixed(1)}MB`;
}

function renderProtection(info: SettingsInfo, handlers: SettingsHandlers): HTMLElement {
  const card = section('データの保存状態');
  const status = document.createElement('p');
  const label = document.createElement('span');
  label.textContent = 'データの保存: ';
  const value = document.createElement('strong');
  value.dataset.testid = 'persist-status';
  value.textContent = info.persisted === null ? '確認中' : info.persisted ? '保護されています' : '通常';
  status.append(label, value);
  const note = document.createElement('p');
  note.className = 'hint';
  note.textContent =
    '「保護されています」なら、空き容量が少なくなってもデータが自動で消されにくくなります。' +
    'どちらの場合も、機種変更やアプリの削除に備えて、定期的にバックアップを書き出してください。';
  const historyHint = document.createElement('p');
  historyHint.className = 'hint';
  historyHint.textContent = '訪問の履歴(誰をどの順で回ったか・訪問した時刻)は8週間で自動的に消えます。';
  card.append(status, note, historyHint, button('clear-history-button', '履歴をすべて消す', 'danger', () => handlers.onClearHistory()));
  return card;
}

const THEME_OPTIONS: { value: ThemeSetting; label: string }[] = [
  { value: 'auto', label: ' 自動(端末の設定に合わせる)' },
  { value: 'light', label: ' 明るい' },
  { value: 'dark', label: ' 暗い' },
];

function renderTheme(info: SettingsInfo, handlers: SettingsHandlers): HTMLElement {
  const card = section('表示');
  const modes = document.createElement('fieldset');
  modes.className = 'modes';
  const legend = document.createElement('legend');
  legend.className = 'visually-hidden';
  legend.textContent = '表示の切り替え';
  modes.append(legend);
  for (const option of THEME_OPTIONS) {
    const item = radio('theme', option.value, `theme-${option.value}`, option.label);
    item.input.checked = option.value === info.theme;
    item.input.addEventListener('change', () => handlers.onThemeChange(option.value));
    modes.append(item.label);
  }
  card.append(modes);
  return card;
}

function renderAbout(): HTMLElement {
  const card = section('このアプリについて');
  const version = document.createElement('p');
  version.className = 'hint';
  version.textContent = `${APP_NAME} 版: ${APP_VERSION}`;
  card.append(version);
  return card;
}

function section(title: string): HTMLElement {
  const card = document.createElement('section');
  card.className = 'card';
  const heading = document.createElement('h2');
  heading.textContent = title;
  card.append(heading);
  return card;
}

function button(testid: string, text: string, className: string, onClick: () => void): HTMLButtonElement {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = className;
  element.dataset.testid = testid;
  element.textContent = text;
  element.addEventListener('click', onClick);
  return element;
}

function radio(name: string, value: string, testid: string, text: string) {
  const input = document.createElement('input');
  input.type = 'radio';
  input.name = name;
  input.value = value;
  input.dataset.testid = testid;
  const label = document.createElement('label');
  label.append(input, document.createTextNode(text));
  return { input, label };
}
