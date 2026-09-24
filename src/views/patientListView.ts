import { APP_NAME } from '../appInfo';
import { MAX_SELECTION } from '../config';
import { visiblePatients } from '../state';
import type { AppState, Patient, SortOrder } from '../types';
import { renderMessage } from './common';
import { renderNotice, type Notice } from './notice';

export type PatientListHandlers = {
  onSearch(query: string): void;
  /** 検索欄のクリアボタン。検索語を空にし、検索欄へフォーカスを戻すのは呼び出し側。 */
  onClearSearch(): void;
  onToggleSelect(id: string): void;
  onSortChange(order: SortOrder): void;
  /** 全選択/全解除ボタン。今どちらの動作をするかは、呼び出し側が状態を見て決める。 */
  onToggleSelectAll(): void;
  onNew(): void;
  /** 行の「⋯」。編集・複製・削除は、開いたメニューの中にある。 */
  onOpenMenu(id: string): void;
  onOpenSettings(): void;
};

/**
 * 「訪問先を選ぶ」画面。名前・住所で検索し、行全体をタップして選ぶ。
 * 編集・複製・削除は、行の右端の「⋯」から開くメニューに置き、通常の操作では誤って触れないようにする。
 * 選択件数と「訪問順を決める →」は、下部の選択バー(main.ts が重ねる)が担当する。
 */
export function renderPatientList(
  state: AppState,
  handlers: PatientListHandlers,
  notice: Notice | null = null,
): HTMLElement {
  const container = document.createElement('div');
  container.className = 'screen';

  // 見出しと検索欄は、一覧をスクロールしても上部に残す(sticky)。
  const head = document.createElement('div');
  head.className = 'list-head';
  head.append(renderTitleRow(handlers), renderSearch(state, handlers), renderListControls(state, handlers));
  container.append(head);

  if (notice) {
    container.append(renderNotice(notice));
  }

  if (state.message) {
    container.append(renderMessage(state.message));
  }

  const newButton = document.createElement('button');
  newButton.type = 'button';
  newButton.className = 'primary block';
  newButton.dataset.testid = 'new-button';
  newButton.textContent = '＋ 訪問先を登録';
  newButton.addEventListener('click', () => handlers.onNew());
  container.append(newButton);

  const patients = visiblePatients(state);
  if (patients.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'hint empty-text';
    empty.dataset.testid = 'empty-text';
    empty.textContent =
      state.patients.length === 0
        ? 'まだ訪問先が登録されていません。「＋ 訪問先を登録」から追加してください。'
        : '該当する訪問先がありません';
    container.append(empty);
  } else {
    const list = document.createElement('ul');
    list.className = 'place-list';
    for (const patient of patients) {
      list.append(renderRow(patient, state, handlers));
    }
    container.append(list);
  }

  if (state.selectedIds.length >= MAX_SELECTION) {
    const hint = document.createElement('p');
    hint.className = 'hint';
    hint.dataset.testid = 'limit-hint';
    hint.textContent = `一度に選べるのは${MAX_SELECTION}件までです。選び直すには、どれかの選択を外してください。`;
    container.append(hint);
  }

  return container;
}

function renderTitleRow(handlers: PatientListHandlers): HTMLElement {
  const row = document.createElement('div');
  row.className = 'list-title-row';

  const title = document.createElement('h1');
  title.className = 'list-title';
  title.textContent = APP_NAME;

  const settings = document.createElement('button');
  settings.type = 'button';
  settings.className = 'icon-button';
  settings.dataset.testid = 'settings-button';
  settings.setAttribute('aria-label', '設定');
  // U+FE0E は、絵文字ではなく文字の見た目で出すための指定。
  settings.textContent = '⚙︎';
  settings.addEventListener('click', () => handlers.onOpenSettings());

  row.append(title, settings);
  return row;
}

function renderSearch(state: AppState, handlers: PatientListHandlers): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'search';

  const search = document.createElement('input');
  search.type = 'text';
  search.value = state.searchQuery;
  search.placeholder = '名前・住所で検索';
  search.setAttribute('aria-label', '名前・住所で検索');
  search.dataset.testid = 'search-input';
  search.autocomplete = 'off';
  search.spellcheck = false;
  search.enterKeyHint = 'search';
  search.setAttribute('autocapitalize', 'none');

  // IME変換中に画面全体を再描画すると入力欄が作り直され、変換セッションが
  // 壊れる(Safariは変換中もinputを発火するため)。変換が終わるまでは
  // onSearchを呼ばず、compositionendで確定した文字列を渡す。
  let isComposing = false;
  search.addEventListener('compositionstart', () => {
    isComposing = true;
  });
  search.addEventListener('compositionend', () => {
    isComposing = false;
    handlers.onSearch(search.value);
  });
  search.addEventListener('input', () => {
    if (isComposing) {
      return;
    }
    handlers.onSearch(search.value);
  });
  wrapper.append(search);

  // 文字があるときだけ、消すためのボタンを出す。
  if (state.searchQuery !== '') {
    const clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'search-clear';
    clear.dataset.testid = 'search-clear';
    clear.setAttribute('aria-label', '検索をクリア');
    clear.textContent = '×';
    clear.addEventListener('click', () => handlers.onClearSearch());
    wrapper.append(clear);
  }
  return wrapper;
}

const SORT_OPTIONS: { value: SortOrder; label: string }[] = [
  { value: 'registered', label: '登録順' },
  { value: 'name', label: '名前順(あいうえお順)' },
  { value: 'address', label: '住所順(あいうえお順)' },
];

/** 並び替えのプルダウンと、全選択/全解除ボタン。 */
function renderListControls(state: AppState, handlers: PatientListHandlers): HTMLElement {
  const row = document.createElement('div');
  row.className = 'list-controls';

  // 見た目のラベルは付けない(隣の全選択ボタンなどで並び替え欄だと分かるため)。
  // aria-labelだけでスクリーンリーダー向けの名前を付ける。ラベル要素で囲むと、
  // visually-hiddenで隠すときに中の<select>まで一緒に見えなくなってしまうため、
  // visually-hiddenなラベルでは囲まない(合言葉の入力欄で起きたのと同じ不具合)。
  const sort = document.createElement('select');
  sort.dataset.testid = 'sort-select';
  sort.setAttribute('aria-label', '並び替え');
  for (const option of SORT_OPTIONS) {
    const opt = document.createElement('option');
    opt.value = option.value;
    opt.textContent = option.label;
    sort.append(opt);
  }
  sort.value = state.sortOrder;
  sort.addEventListener('change', () => handlers.onSortChange(sort.value as SortOrder));

  const visible = visiblePatients(state);
  const allSelected = visible.length > 0 && visible.every((patient) => state.selectedIds.includes(patient.id));

  const selectAll = document.createElement('button');
  selectAll.type = 'button';
  selectAll.className = 'select-all';
  selectAll.dataset.testid = 'select-all-button';
  selectAll.textContent = allSelected ? '全解除' : '全選択';
  selectAll.addEventListener('click', () => handlers.onToggleSelectAll());

  row.append(sort, selectAll);
  return row;
}

function renderRow(patient: Patient, state: AppState, handlers: PatientListHandlers): HTMLElement {
  const selected = state.selectedIds.includes(patient.id);
  // 上限に達しているとき、未選択の行は選べない。
  const atLimit = !selected && state.selectedIds.length >= MAX_SELECTION;

  const row = document.createElement('li');
  row.className = `place-row${selected ? ' selected' : ''}${atLimit ? ' disabled' : ''}`;
  row.dataset.testid = 'patient-row';

  // 行全体をラベルにして、どこをタップしても選択・解除できるようにする。
  // 本物のチェックボックスを画面の外へ隠して持たせ、キーボードとスクリーンリーダーの操作を保つ。
  const main = document.createElement('label');
  main.className = 'place-main';

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.className = 'visually-hidden';
  checkbox.dataset.testid = 'patient-checkbox';
  checkbox.dataset.id = patient.id;
  checkbox.checked = selected;
  checkbox.disabled = atLimit;
  checkbox.setAttribute('aria-label', `${patient.name}を選択`);
  checkbox.addEventListener('change', () => handlers.onToggleSelect(patient.id));

  // 見た目のチェック。色だけに頼らないよう、選択時は ✓ を出す(CSS)。
  const check = document.createElement('span');
  check.className = 'check';
  check.setAttribute('aria-hidden', 'true');

  const text = document.createElement('span');
  text.className = 'place-text';
  const name = document.createElement('span');
  name.className = 'place-name';
  name.textContent = patient.name;
  const address = document.createElement('span');
  address.className = 'place-address';
  address.textContent = patient.address;
  text.append(name, address);

  main.append(checkbox, check, text);

  // 「⋯」は、行の選択(ラベル)の外に置く。押しても選択は変わらない。
  const more = document.createElement('button');
  more.type = 'button';
  more.className = 'more';
  more.dataset.testid = 'row-menu';
  more.dataset.id = patient.id;
  more.setAttribute('aria-label', `${patient.name}のメニューを開く`);
  more.setAttribute('aria-haspopup', 'dialog');
  more.textContent = '⋯';
  more.addEventListener('click', () => handlers.onOpenMenu(patient.id));

  row.append(main, more);
  return row;
}
