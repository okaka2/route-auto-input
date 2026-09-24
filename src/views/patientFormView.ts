import { DEFAULT_MAP_PROVIDER } from '../mapProviders';
import type { Message, Patient } from '../types';
import { renderMessage } from './common';

export type PatientFormDraft = { name: string; address: string; phone: string };

export type PatientFormHandlers = {
  onSave(name: string, address: string, phone: string): void;
  onSaveAndContinue(name: string, address: string, phone: string): void;
  onCancel(name: string, address: string, phone: string): void;
};

/**
 * 訪問先の登録・編集フォーム。入力項目は名前・住所・電話番号(任意)。
 * 住所は地図へ渡すために欠かせないので、保存できるのは、名前と住所がそろっているときだけ(検証は呼び出し側)。
 *
 * `draft` は保存に失敗した直後の入力値(または複製元の値)。渡された場合は `patient` の値より
 * 優先して表示し、入力内容を画面に残す。
 */
export function renderPatientForm(
  patient: Patient | null,
  draft: PatientFormDraft | null,
  message: Message | null,
  handlers: PatientFormHandlers,
): HTMLElement {
  const container = document.createElement('div');
  container.className = 'screen';

  const nameInput = textInput('name-input', draft?.name ?? patient?.name ?? '', '例) 山田 太郎', true);
  const addressInput = textInput(
    'address-input',
    draft?.address ?? patient?.address ?? '',
    '例) 東京都世田谷区桜丘1-2-3',
    true,
  );
  const phoneInput = textInput(
    'phone-input',
    draft?.phone ?? patient?.phone ?? '',
    '例) 03-1234-5678',
    false,
  );
  phoneInput.type = 'tel';
  phoneInput.inputMode = 'tel';

  // 見出しの行: 左に「キャンセル」、中央に見出し、右に「保存」。
  const header = document.createElement('header');
  header.className = 'form-header';

  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'header-link cancel';
  cancel.dataset.testid = 'cancel-button';
  cancel.textContent = 'キャンセル';
  cancel.addEventListener('click', () =>
    handlers.onCancel(nameInput.value, addressInput.value, phoneInput.value),
  );

  const title = document.createElement('h1');
  title.className = 'screen-title';
  title.textContent = patient === null ? '訪問先を登録' : '訪問先を編集';

  const save = document.createElement('button');
  save.type = 'button';
  save.className = 'header-link save';
  save.dataset.testid = 'save-button';
  save.textContent = '保存';
  save.addEventListener('click', () =>
    handlers.onSave(nameInput.value, addressInput.value, phoneInput.value),
  );

  header.append(cancel, title, save);
  container.append(header);

  if (message) {
    container.append(renderMessage(message));
  }

  container.append(
    field('名前', nameInput, true),
    field('住所', addressInput, true),
    field('電話番号(任意)', phoneInput, false),
    renderMapCheck(addressInput),
  );

  if (patient === null) {
    const actions = document.createElement('div');
    actions.className = 'form-actions';
    const save = button('form-save-button', '保存', 'primary', () =>
      handlers.onSave(nameInput.value, addressInput.value, phoneInput.value),
    );
    const cont = button('save-continue-button', '保存して続けて登録', '', () =>
      handlers.onSaveAndContinue(nameInput.value, addressInput.value, phoneInput.value),
    );
    actions.append(save, cont);
    container.append(actions);
  }

  return container;
}

function button(testid: string, text: string, className: string, onClick: () => void): HTMLButtonElement {
  const element = document.createElement('button');
  element.type = 'button';
  if (className) {
    element.className = className;
  }
  element.dataset.testid = testid;
  element.textContent = text;
  element.addEventListener('click', onClick);
  return element;
}

function textInput(testid: string, value: string, placeholder: string, required: boolean): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'text';
  input.value = value;
  input.placeholder = placeholder;
  input.autocomplete = 'off';
  input.dataset.testid = testid;
  if (required) {
    input.setAttribute('aria-required', 'true');
  }
  return input;
}

/** ラベル(名前と、必須なら「必須」の表示)で入力欄を包む。 */
function field(labelText: string, input: HTMLInputElement, required: boolean): HTMLLabelElement {
  const label = document.createElement('label');
  label.className = 'field';

  const caption = document.createElement('span');
  caption.className = 'field-label';
  caption.append(document.createTextNode(labelText));
  if (required) {
    const requiredMark = document.createElement('span');
    requiredMark.className = 'required';
    requiredMark.textContent = '必須';
    caption.append(requiredMark);
  }

  label.append(caption, input);
  return label;
}

/** 入力した住所を、地図サービスで確認するためのリンク。住所が空のあいだは、押せない。 */
function renderMapCheck(addressInput: HTMLInputElement): HTMLAnchorElement {
  const link = document.createElement('a');
  link.textContent = `この住所を${DEFAULT_MAP_PROVIDER.label}で確認`;
  link.target = '_blank';
  link.rel = 'noreferrer';
  link.dataset.testid = 'map-check-link';
  link.className = 'map-check';

  const update = (): void => {
    const address = addressInput.value.trim();
    if (address.length === 0) {
      link.removeAttribute('href');
      link.classList.add('disabled');
      return;
    }
    link.href = DEFAULT_MAP_PROVIDER.buildUrl([address]);
    link.classList.remove('disabled');
  };
  update();
  addressInput.addEventListener('input', update);
  return link;
}
