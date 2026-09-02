import type { AppState } from '../types';

export type SettingsHandlers = {
  onExport(): void;
  onImport(file: File, mode: 'replace' | 'merge'): void;
  onBack(): void;
};

export function renderSettings(state: AppState, handlers: SettingsHandlers): HTMLElement {
  const container = document.createElement('div');

  const title = document.createElement('h1');
  title.textContent = '設定';
  container.append(title);

  if (state.message) {
    const message = document.createElement('p');
    message.className = `message ${state.message.kind}`;
    message.setAttribute('role', 'status');
    message.textContent = state.message.text;
    container.append(message);
  }

  const count = document.createElement('p');
  count.textContent = `登録されている患者: ${state.patients.length}件`;
  container.append(count);

  const exportHeading = document.createElement('h2');
  exportHeading.textContent = 'バックアップの書き出し';
  const exportNote = document.createElement('p');
  exportNote.textContent = '患者データをJSONファイルとして保存します。';
  const exportButton = document.createElement('button');
  exportButton.type = 'button';
  exportButton.className = 'primary';
  exportButton.textContent = 'エクスポート';
  exportButton.dataset.testid = 'export-button';
  exportButton.addEventListener('click', () => handlers.onExport());
  container.append(exportHeading, exportNote, exportButton);

  const importHeading = document.createElement('h2');
  importHeading.textContent = 'バックアップの読み込み';
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'application/json,.json';
  fileInput.dataset.testid = 'import-input';
  fileInput.setAttribute('aria-label', 'バックアップファイルを選ぶ');

  const replaceRadio = document.createElement('input');
  replaceRadio.type = 'radio';
  replaceRadio.name = 'import-mode';
  replaceRadio.value = 'replace';
  replaceRadio.checked = true;
  replaceRadio.dataset.testid = 'mode-replace';
  const replaceLabel = document.createElement('label');
  replaceLabel.append(replaceRadio, document.createTextNode(' 今のデータを消して入れ替える'));

  const mergeRadio = document.createElement('input');
  mergeRadio.type = 'radio';
  mergeRadio.name = 'import-mode';
  mergeRadio.value = 'merge';
  mergeRadio.dataset.testid = 'mode-merge';
  const mergeLabel = document.createElement('label');
  mergeLabel.append(mergeRadio, document.createTextNode(' 今のデータに追加する'));

  const importButton = document.createElement('button');
  importButton.type = 'button';
  importButton.textContent = 'インポート';
  importButton.dataset.testid = 'import-button';
  importButton.addEventListener('click', () => {
    const file = fileInput.files?.[0];
    if (!file) {
      return;
    }
    handlers.onImport(file, mergeRadio.checked ? 'merge' : 'replace');
  });

  const modes = document.createElement('div');
  modes.className = 'modes';
  modes.append(replaceLabel, mergeLabel);

  container.append(importHeading, fileInput, modes, importButton);

  const backButton = document.createElement('button');
  backButton.type = 'button';
  backButton.textContent = '一覧へ戻る';
  backButton.dataset.testid = 'back-button';
  backButton.addEventListener('click', () => handlers.onBack());
  container.append(backButton);

  return container;
}
