import { buildGoogleMapsUrl } from '../googleMapsUrl';
import type { Message, Patient } from '../types';

export type PatientFormDraft = { name: string; address: string };

export type PatientFormHandlers = {
  onSave(name: string, address: string): void;
  onCancel(): void;
};

/**
 * `draft` は保存に失敗した直後の入力値。渡された場合は `patient` の値より
 * 優先して表示し、入力内容を画面に残す(spec §8)。
 */
export function renderPatientForm(
  patient: Patient | null,
  draft: PatientFormDraft | null,
  message: Message | null,
  handlers: PatientFormHandlers,
): HTMLElement {
  const container = document.createElement('div');

  const title = document.createElement('h1');
  title.textContent = patient === null ? '新規登録' : '編集';
  container.append(title);

  if (message) {
    const messageElement = document.createElement('p');
    messageElement.className = `message ${message.kind}`;
    messageElement.setAttribute('role', 'status');
    messageElement.textContent = message.text;
    container.append(messageElement);
  }

  const nameField = document.createElement('label');
  nameField.className = 'field';
  nameField.textContent = '氏名';
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.value = draft?.name ?? patient?.name ?? '';
  nameInput.dataset.testid = 'name-input';
  nameField.append(nameInput);

  const addressField = document.createElement('label');
  addressField.className = 'field';
  addressField.textContent = '住所';
  const addressInput = document.createElement('input');
  addressInput.type = 'text';
  addressInput.value = draft?.address ?? patient?.address ?? '';
  addressInput.dataset.testid = 'address-input';
  addressField.append(addressInput);

  const mapLink = document.createElement('a');
  mapLink.textContent = 'この住所をGoogleマップで確認';
  mapLink.target = '_blank';
  mapLink.rel = 'noreferrer';
  mapLink.dataset.testid = 'map-check-link';
  mapLink.className = 'map-check';

  const updateMapLink = (): void => {
    const address = addressInput.value.trim();
    if (address.length === 0) {
      mapLink.removeAttribute('href');
      mapLink.classList.add('disabled');
      return;
    }
    mapLink.href = buildGoogleMapsUrl([address]);
    mapLink.classList.remove('disabled');
  };
  updateMapLink();
  addressInput.addEventListener('input', updateMapLink);

  const saveButton = document.createElement('button');
  saveButton.type = 'button';
  saveButton.className = 'primary';
  saveButton.textContent = '保存';
  saveButton.dataset.testid = 'save-button';
  saveButton.addEventListener('click', () => handlers.onSave(nameInput.value, addressInput.value));

  const cancelButton = document.createElement('button');
  cancelButton.type = 'button';
  cancelButton.textContent = 'キャンセル';
  cancelButton.dataset.testid = 'cancel-button';
  cancelButton.addEventListener('click', () => handlers.onCancel());

  const actions = document.createElement('div');
  actions.className = 'actions';
  actions.append(saveButton, cancelButton);

  container.append(nameField, addressField, mapLink, actions);
  return container;
}
