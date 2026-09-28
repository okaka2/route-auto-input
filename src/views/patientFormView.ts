import { addressForMaps } from '../addressForMaps';
import { MAX_PHOTOS_PER_PATIENT } from '../config';
import { DEFAULT_MAP_PROVIDER } from '../mapProviders';
import type { Message, ParkingType, Patient, PatientFormDraft } from '../types';
import { NOTE_HEADINGS, PARKING_OPTIONS } from '../visitInfo';
import { renderMessage } from './common';

export type { PatientFormDraft } from '../types';

/** 表示済みの写真。object URL(revokeは呼び出し側の役目)。 */
export type FormPhoto = { id: string; url: string };

export type PatientFormHandlers = {
  onSave(values: PatientFormDraft): void;
  onSaveAndContinue(values: PatientFormDraft): void;
  onCancel(values: PatientFormDraft): void;
  /**
   * 写真の追加。写真の読み込み・保存は非同期(DBへの書き込みを挟む)で、そのあいだにも
   * 再描画が起きうるため、フォームの今の入力値(values)もあわせて渡す。呼び出し側は、
   * この値を使って再描画してもフォームの入力が消えないようにする(Critical 1)。
   */
  onAddPhoto(file: File, values: PatientFormDraft): void;
  onDeletePhoto(id: string, values: PatientFormDraft): void;
};

/**
 * 訪問先の登録・編集フォーム。入力項目は名前・住所・電話番号(任意)・駐車情報・メモ。
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
  photos: readonly FormPhoto[] = [],
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

  const parkingType = draft?.parkingType ?? patient?.parking?.type ?? '';
  const permitExpires = draft?.permitExpires ?? patient?.parking?.permitExpires ?? '';
  const note = draft?.note ?? patient?.note ?? '';

  const parkingSelect = document.createElement('select');
  parkingSelect.dataset.testid = 'parking-select';
  parkingSelect.className = 'form-select';
  for (const option of PARKING_OPTIONS) {
    const optionElement = document.createElement('option');
    optionElement.value = option.value;
    optionElement.textContent = option.label;
    parkingSelect.append(optionElement);
  }
  parkingSelect.value = parkingType;

  const permitExpiresInput = document.createElement('input');
  permitExpiresInput.type = 'date';
  permitExpiresInput.dataset.testid = 'permit-expires-input';
  permitExpiresInput.value = permitExpires;

  const permitField = field('許可証の期限', permitExpiresInput, false);
  permitField.hidden = parkingSelect.value !== 'street_permit';
  parkingSelect.addEventListener('change', () => {
    permitField.hidden = parkingSelect.value !== 'street_permit';
  });

  const noteInput = document.createElement('textarea');
  noteInput.rows = 4;
  noteInput.dataset.testid = 'note-input';
  noteInput.placeholder = '例) 駐車場: 北側のコインパーキング';
  noteInput.value = note;

  // 見出しの行: 左に「キャンセル」、中央に見出し、右に「保存」。
  const header = document.createElement('header');
  header.className = 'form-header';

  // 入力欄はすべて container の中にあるので、読み出しは readPatientFormValues と同じにする。
  const currentValues = (): PatientFormDraft => readPatientFormValues(container)!;

  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'header-link cancel';
  cancel.dataset.testid = 'cancel-button';
  cancel.textContent = 'キャンセル';
  cancel.addEventListener('click', () => handlers.onCancel(currentValues()));

  const title = document.createElement('h1');
  title.className = 'screen-title';
  title.textContent = patient === null ? '訪問先を登録' : '訪問先を編集';

  const save = document.createElement('button');
  save.type = 'button';
  save.className = 'header-link save';
  save.dataset.testid = 'save-button';
  save.textContent = '保存';
  save.addEventListener('click', () => handlers.onSave(currentValues()));

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

  container.append(
    renderVisitInfoSection(parkingSelect, permitField, noteInput, patient, photos, handlers, currentValues),
  );

  if (patient === null) {
    const actions = document.createElement('div');
    actions.className = 'form-actions';
    const save = button('form-save-button', '保存', 'primary', () => handlers.onSave(currentValues()));
    const cont = button('save-continue-button', '保存して続けて登録', '', () =>
      handlers.onSaveAndContinue(currentValues()),
    );
    actions.append(save, cont);
    container.append(actions);
  }

  return container;
}

/**
 * 描いてある登録・編集フォームの今の入力値を読む(端末の戻るボタンで、キャンセルと同じ確認を
 * するため)。登録・編集の画面が無ければ null。
 */
export function readPatientFormValues(root: ParentNode): PatientFormDraft | null {
  const value = (testid: string): string | undefined =>
    root.querySelector<HTMLInputElement>(`[data-testid="${testid}"]`)?.value;
  const name = value('name-input');
  if (name === undefined) {
    return null;
  }
  return {
    name,
    address: value('address-input') ?? '',
    phone: value('phone-input') ?? '',
    parkingType: (value('parking-select') ?? '') as ParkingType | '',
    permitExpires: value('permit-expires-input') ?? '',
    note: value('note-input') ?? '',
  };
}

/** 「訪問のための情報」: 駐車の種類・(路上のときだけ)許可証の期限・メモ・写真。 */
function renderVisitInfoSection(
  parkingSelect: HTMLSelectElement,
  permitField: HTMLLabelElement,
  noteInput: HTMLTextAreaElement,
  patient: Patient | null,
  photos: readonly FormPhoto[],
  handlers: PatientFormHandlers,
  currentValues: () => PatientFormDraft,
): HTMLElement {
  const section = document.createElement('section');
  section.className = 'visit-info';

  const heading = document.createElement('h2');
  heading.textContent = '訪問のための情報';
  section.append(heading);

  section.append(field('駐車', parkingSelect, false));
  section.append(permitField);
  section.append(renderNoteField(noteInput));
  section.append(renderPhotosField(patient, photos, handlers, currentValues));

  return section;
}

/**
 * 「写真(3枚まで)」。編集のときだけサムネイル・削除・追加を出す
 * (新規登録では、まだ訪問先のidが無く写真を紐づけられないため、案内だけ)。
 */
function renderPhotosField(
  patient: Patient | null,
  photos: readonly FormPhoto[],
  handlers: PatientFormHandlers,
  currentValues: () => PatientFormDraft,
): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'field';

  const caption = document.createElement('span');
  caption.className = 'field-label';
  caption.textContent = '写真(3枚まで)';
  wrapper.append(caption);

  if (patient === null) {
    const note = document.createElement('p');
    note.className = 'hint';
    note.textContent = '保存したあと、編集から写真を追加できます。';
    wrapper.append(note);
    return wrapper;
  }

  const list = document.createElement('div');
  list.className = 'photo-list';
  photos.forEach((photo, index) => list.append(renderPhotoItem(photo, index, handlers, currentValues)));
  if (photos.length < MAX_PHOTOS_PER_PATIENT) {
    list.append(renderPhotoAdd(handlers, currentValues));
  }
  wrapper.append(list);

  const caution = document.createElement('p');
  caution.className = 'hint';
  caution.textContent = '表札や人が写らないようにしてください。';
  wrapper.append(caution);

  return wrapper;
}

function renderPhotoItem(
  photo: FormPhoto,
  index: number,
  handlers: PatientFormHandlers,
  currentValues: () => PatientFormDraft,
): HTMLElement {
  const item = document.createElement('div');
  item.className = 'photo-item';

  const img = document.createElement('img');
  img.src = photo.url;
  img.alt = `写真${index + 1}`;
  img.dataset.testid = 'photo-thumb';
  item.append(img);

  const deleteButton = document.createElement('button');
  deleteButton.type = 'button';
  deleteButton.dataset.testid = 'photo-delete';
  deleteButton.textContent = '削除';
  deleteButton.addEventListener('click', () => handlers.onDeletePhoto(photo.id, currentValues()));
  item.append(deleteButton);

  return item;
}

/** 見た目は「写真を追加」ボタン。中身は撮影/選択できる file input(見た目には出さない)。 */
function renderPhotoAdd(handlers: PatientFormHandlers, currentValues: () => PatientFormDraft): HTMLElement {
  const label = document.createElement('label');
  label.className = 'photo-add';
  label.append(document.createTextNode('写真を追加'));

  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.setAttribute('capture', 'environment');
  input.className = 'visually-hidden';
  input.dataset.testid = 'photo-input';
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (file) {
      handlers.onAddPhoto(file, currentValues());
    }
    input.value = '';
  });
  label.append(input);

  return label;
}

/**
 * メモの入力欄。見出しボタン(駐車場・入口・インターホン・鍵・注意)を textarea の上に出す。
 *
 * 見出しボタンを textarea と同じ <label> に入れると、ラベルの操作対象が最初の子要素
 * (見出しボタン)になってしまい、「メモ」というキャプションを押すと textarea ではなく
 * 最初のボタンが押された扱いになる(見出しが誤って足される・textareaに読み上げ名が付かない)。
 * そのため、ここでは <div class="field"> で包み、キャプションは for/id で textarea だけを指す
 * 独立した <label> にする。
 */
function renderNoteField(noteInput: HTMLTextAreaElement): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'field';

  noteInput.id = 'note-input';

  const caption = document.createElement('label');
  caption.className = 'field-label';
  caption.htmlFor = 'note-input';
  caption.textContent = 'メモ';

  const headings = document.createElement('div');
  headings.className = 'note-headings';
  for (const heading of NOTE_HEADINGS) {
    const headingButton = document.createElement('button');
    headingButton.type = 'button';
    headingButton.className = 'note-heading';
    headingButton.dataset.testid = `note-heading-${heading}`;
    headingButton.textContent = heading;
    headingButton.addEventListener('click', () => appendNoteHeading(noteInput, heading));
    headings.append(headingButton);
  }

  wrapper.append(caption, headings, noteInput);
  return wrapper;
}

/** メモの末尾に「見出し: 」を足す(空でなく改行で終わっていなければ改行を足す)。末尾へカーソルを移す。 */
function appendNoteHeading(noteInput: HTMLTextAreaElement, heading: string): void {
  const current = noteInput.value;
  const needsNewline = current !== '' && !current.endsWith('\n');
  noteInput.value = `${current}${needsNewline ? '\n' : ''}${heading}: `;
  noteInput.focus();
  const end = noteInput.value.length;
  noteInput.setSelectionRange(end, end);
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
function field(labelText: string, input: HTMLElement, required: boolean): HTMLLabelElement {
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
    link.href = DEFAULT_MAP_PROVIDER.buildUrl([addressForMaps(address)]);
    link.classList.remove('disabled');
  };
  update();
  addressInput.addEventListener('input', update);
  return link;
}
