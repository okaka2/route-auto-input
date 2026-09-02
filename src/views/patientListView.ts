import { MAX_SELECTION } from '../config';
import { visiblePatients } from '../state';
import type { AppState, Patient } from '../types';

export type PatientListHandlers = {
  onSearch(query: string): void;
  onToggleSelect(id: string): void;
  onNew(): void;
  onEdit(id: string): void;
  onDelete(id: string): void;
  onNext(): void;
  onOpenSettings(): void;
};

export function renderPatientList(state: AppState, handlers: PatientListHandlers): HTMLElement {
  const container = document.createElement('div');

  const header = document.createElement('div');
  header.className = 'row-between';
  const title = document.createElement('h1');
  title.textContent = 'ルート自動入力';
  const settingsButton = document.createElement('button');
  settingsButton.type = 'button';
  settingsButton.textContent = '設定';
  settingsButton.dataset.testid = 'settings-button';
  settingsButton.addEventListener('click', () => handlers.onOpenSettings());
  header.append(title, settingsButton);
  container.append(header);

  if (state.message) {
    const message = document.createElement('p');
    message.className = `message ${state.message.kind}`;
    message.textContent = state.message.text;
    container.append(message);
  }

  const search = document.createElement('input');
  search.type = 'text';
  search.value = state.searchQuery;
  search.placeholder = '氏名・住所で検索';
  search.setAttribute('aria-label', '氏名・住所で検索');
  search.dataset.testid = 'search-input';
  search.addEventListener('input', () => handlers.onSearch(search.value));
  container.append(search);

  const newButton = document.createElement('button');
  newButton.type = 'button';
  newButton.className = 'primary';
  newButton.textContent = '＋ 新規登録';
  newButton.dataset.testid = 'new-button';
  newButton.addEventListener('click', () => handlers.onNew());
  container.append(newButton);

  const patients = visiblePatients(state);
  if (patients.length === 0) {
    const empty = document.createElement('p');
    empty.textContent =
      state.patients.length === 0
        ? 'まだ患者が登録されていません。「＋ 新規登録」から追加してください。'
        : '検索に一致する患者がいません。';
    container.append(empty);
  } else {
    const list = document.createElement('ul');
    list.className = 'patient-list';
    for (const patient of patients) {
      list.append(renderRow(patient, state, handlers));
    }
    container.append(list);
  }

  if (state.selectedIds.length >= MAX_SELECTION) {
    const hint = document.createElement('p');
    hint.className = 'hint';
    hint.dataset.testid = 'limit-hint';
    hint.textContent = `一度に選べるのは${MAX_SELECTION}人までです。選び直すには、どれかの選択を外してください。`;
    container.append(hint);
  }

  const footer = document.createElement('div');
  footer.className = 'row-between footer';
  const count = document.createElement('span');
  count.textContent = `選択中: ${state.selectedIds.length} / ${MAX_SELECTION}`;
  const nextButton = document.createElement('button');
  nextButton.type = 'button';
  nextButton.className = 'primary';
  nextButton.textContent = '次へ(順番を決める)';
  nextButton.dataset.testid = 'next-button';
  nextButton.disabled = state.selectedIds.length === 0;
  nextButton.addEventListener('click', () => handlers.onNext());
  footer.append(count, nextButton);
  container.append(footer);

  return container;
}

function renderRow(patient: Patient, state: AppState, handlers: PatientListHandlers): HTMLElement {
  const row = document.createElement('li');
  row.className = 'patient-row';
  row.dataset.testid = 'patient-row';

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.dataset.id = patient.id;
  checkbox.checked = state.selectedIds.includes(patient.id);
  checkbox.disabled = !checkbox.checked && state.selectedIds.length >= MAX_SELECTION;
  checkbox.setAttribute('aria-label', `${patient.name} を選択`);
  checkbox.addEventListener('click', () => handlers.onToggleSelect(patient.id));

  const body = document.createElement('div');
  body.className = 'patient-body';
  const name = document.createElement('div');
  name.className = 'patient-name';
  name.textContent = patient.name;
  const address = document.createElement('div');
  address.className = 'patient-address';
  address.textContent = patient.address;
  body.append(name, address);

  const editButton = document.createElement('button');
  editButton.type = 'button';
  editButton.textContent = '編集';
  editButton.dataset.testid = 'edit';
  editButton.dataset.id = patient.id;
  editButton.setAttribute('aria-label', `${patient.name} を編集`);
  editButton.addEventListener('click', () => handlers.onEdit(patient.id));

  const deleteButton = document.createElement('button');
  deleteButton.type = 'button';
  deleteButton.className = 'danger';
  deleteButton.textContent = '削除';
  deleteButton.dataset.testid = 'delete';
  deleteButton.dataset.id = patient.id;
  deleteButton.setAttribute('aria-label', `${patient.name} を削除`);
  deleteButton.addEventListener('click', () => handlers.onDelete(patient.id));

  row.append(checkbox, body, editButton, deleteButton);
  return row;
}
