import { APP_NAME, APP_VERSION } from '../appInfo';
import { formatLastBackup } from '../backupReminder';
import type { ThemeSetting } from '../theme';
import type { AppState } from '../types';
import { renderMessage, renderScreenHeader } from './common';

export type SettingsInfo = {
  /** 最後にバックアップを書き出した日時(ISO 8601)。無ければ null。 */
  lastBackupAt: string | null;
  /** ブラウザがデータの保護を約束しているか。まだ確かめていなければ null。 */
  persisted: boolean | null;
  theme: ThemeSetting;
};

export type SettingsHandlers = {
  onExport(): void;
  onImport(file: File, mode: 'replace' | 'merge'): void;
  onThemeChange(setting: ThemeSetting): void;
  onBack(): void;
};

/** 設定画面。バックアップ → データの保存状態 → 表示 → このアプリについて の順。 */
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
    renderBackup(info, handlers, now),
    renderProtection(info),
    renderTheme(info, handlers),
    renderAbout(),
  );
  return container;
}

function renderBackup(info: SettingsInfo, handlers: SettingsHandlers, now: Date): HTMLElement {
  const card = section('バックアップ');
  const last = document.createElement('p');
  last.className = 'hint';
  last.dataset.testid = 'last-backup';
  last.textContent = `最後のバックアップ: ${info.lastBackupAt ? formatLastBackup(info.lastBackupAt, now) : 'まだありません'}`;

  const note = document.createElement('p');
  note.textContent = '訪問先のデータをバックアップのファイルとして保存します。';
  const exportButton = button('export-button', '書き出す', 'primary block', () => handlers.onExport());

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
  card.append(last, note, exportButton, fileInput, modes, importButton);
  return card;
}

function renderProtection(info: SettingsInfo): HTMLElement {
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
  card.append(status, note);
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
