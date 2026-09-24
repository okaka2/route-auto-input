import { describe, expect, it, vi } from 'vitest';
import { APP_NAME } from '../src/appInfo';
import { MAX_SELECTION } from '../src/config';
import { createPatient } from '../src/patient';
import { createInitialState, setListFilter, setSearchQuery, toggleSelection } from '../src/state';
import { renderPatientList, type PatientListHandlers } from '../src/views/patientListView';
import type { Patient } from '../src/types';

const makePatients = (count: number): Patient[] =>
  Array.from({ length: count }, (_, i) => createPatient(`場所${i + 1}`, `東京都${i + 1}-1`));

const noopHandlers = (): PatientListHandlers => ({
  onSearch: vi.fn(),
  onClearSearch: vi.fn(),
  onToggleSelect: vi.fn(),
  onSortChange: vi.fn(),
  onToggleSelectAll: vi.fn(),
  onNew: vi.fn(),
  onOpenMenu: vi.fn(),
  onOpenSettings: vi.fn(),
  onFilterChange: vi.fn(),
  onSearchAll: vi.fn(),
});

const q = <T extends HTMLElement = HTMLElement>(element: HTMLElement, testid: string): T =>
  element.querySelector<T>(`[data-testid="${testid}"]`)!;
const rows = (element: HTMLElement) =>
  [...element.querySelectorAll<HTMLElement>('[data-testid="patient-row"]')];
const checkboxFor = (element: HTMLElement, id: string) =>
  element.querySelector<HTMLInputElement>(`input[data-id="${id}"]`)!;

/** change イベントは要素が document に接続されていないと発火しないため、一時的に接続して実行する。 */
function withAttached(element: HTMLElement, run: () => void): void {
  document.body.append(element);
  try {
    run();
  } finally {
    element.remove();
  }
}

describe('renderPatientList: 一覧の内容', () => {
  it('見出しにアプリ名を出す', () => {
    const element = renderPatientList(createInitialState([]), noopHandlers());
    expect(element.querySelector('h1')?.textContent).toBe(APP_NAME);
  });

  it('訪問先の行を件数ぶん描画する', () => {
    const element = renderPatientList(createInitialState(makePatients(3)), noopHandlers());
    expect(rows(element)).toHaveLength(3);
  });

  it('名前と住所を表示する', () => {
    const element = renderPatientList(createInitialState(makePatients(1)), noopHandlers());
    expect(element.textContent).toContain('場所1');
    expect(element.textContent).toContain('東京都1-1');
  });

  it('登録が0件なら、登録を促す案内を表示する', () => {
    const element = renderPatientList(createInitialState([]), noopHandlers());
    expect(q(element, 'empty-text').textContent).toContain('まだ訪問先が登録されていません');
  });

  it('検索で絞り込まれた結果だけを描画する', () => {
    const state = setSearchQuery(createInitialState(makePatients(3)), '場所2');
    const element = renderPatientList(state, noopHandlers());
    expect(rows(element)).toHaveLength(1);
  });

  it('検索の結果が0件なら「該当する訪問先がありません」と表示する', () => {
    const state = setSearchQuery(createInitialState(makePatients(3)), 'どこにもない');
    const element = renderPatientList(state, noopHandlers());
    expect(rows(element)).toHaveLength(0);
    expect(q(element, 'empty-text').textContent).toBe('該当する訪問先がありません');
  });

  it('「＋ 訪問先を登録」ボタンを出し、押すと onNew が呼ばれる', () => {
    const handlers = noopHandlers();
    const button = q<HTMLButtonElement>(renderPatientList(createInitialState([]), handlers), 'new-button');
    expect(button.textContent).toBe('＋ 訪問先を登録');
    expect(button.classList.contains('primary')).toBe(true);
    button.click();
    expect(handlers.onNew).toHaveBeenCalledTimes(1);
  });

  it('設定ボタンには「設定」という名前(aria-label)を付け、押すと onOpenSettings が呼ばれる', () => {
    const handlers = noopHandlers();
    const button = q<HTMLButtonElement>(
      renderPatientList(createInitialState([]), handlers),
      'settings-button',
    );
    expect(button.getAttribute('aria-label')).toBe('設定');
    button.click();
    expect(handlers.onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it('メッセージがあれば表示し、VoiceOver に読み上げられるよう role=status を持つ', () => {
    const state = { ...createInitialState([]), message: { kind: 'error' as const, text: '保存できませんでした。' } };
    const element = renderPatientList(state, noopHandlers());
    expect(element.querySelector('.message')?.textContent).toBe('保存できませんでした。');
    expect(element.querySelector('.message')?.getAttribute('role')).toBe('status');
  });

  it('選択件数や「次へ」のボタンは、この画面には出さない(下部の選択バーが担当)', () => {
    const patients = makePatients(2);
    const state = toggleSelection(createInitialState(patients), patients[0]!.id);
    const element = renderPatientList(state, noopHandlers());
    expect(element.querySelector('[data-testid="next-button"]')).toBeNull();
    expect(element.textContent).not.toContain('1件選択中');
  });
});

describe('renderPatientList: 選択', () => {
  it('選択済みの訪問先のチェックボックスがオンになる', () => {
    const patients = makePatients(2);
    const state = toggleSelection(createInitialState(patients), patients[0]!.id);
    const element = renderPatientList(state, noopHandlers());
    expect(checkboxFor(element, patients[0]!.id).checked).toBe(true);
    expect(checkboxFor(element, patients[1]!.id).checked).toBe(false);
  });

  it('選択した行だけに selected のクラスが付く(色以外の印はチェックマークが担う)', () => {
    const patients = makePatients(2);
    const state = toggleSelection(createInitialState(patients), patients[0]!.id);
    const element = renderPatientList(state, noopHandlers());
    expect(rows(element)[0]!.classList.contains('selected')).toBe(true);
    expect(rows(element)[1]!.classList.contains('selected')).toBe(false);
  });

  it('チェックボックスを押すと onToggleSelect が id つきで呼ばれる', () => {
    const patients = makePatients(1);
    const handlers = noopHandlers();
    const element = renderPatientList(createInitialState(patients), handlers);
    withAttached(element, () => {
      checkboxFor(element, patients[0]!.id).click();
      expect(handlers.onToggleSelect).toHaveBeenCalledWith(patients[0]!.id);
    });
  });

  it('行全体(名前や住所の部分)を押しても選択できる', () => {
    const patients = makePatients(1);
    const handlers = noopHandlers();
    const element = renderPatientList(createInitialState(patients), handlers);
    withAttached(element, () => {
      element.querySelector<HTMLElement>('.place-name')!.click();
      expect(handlers.onToggleSelect).toHaveBeenCalledTimes(1);
      expect(handlers.onToggleSelect).toHaveBeenCalledWith(patients[0]!.id);
    });
  });

  it('チェックボックスは本物の input[type=checkbox] で、キーボードの操作対象から外れていない', () => {
    const patients = makePatients(1);
    const element = renderPatientList(createInitialState(patients), noopHandlers());
    const checkbox = checkboxFor(element, patients[0]!.id);
    expect(checkbox.type).toBe('checkbox');
    expect(checkbox.getAttribute('tabindex')).not.toBe('-1');
    expect(checkbox.hidden).toBe(false);
  });

  it('上限まで選ぶと、未選択のチェックボックスが押せなくなり、その行は disabled の表示になる', () => {
    const patients = makePatients(MAX_SELECTION + 1);
    let state = createInitialState(patients);
    for (const patient of patients.slice(0, MAX_SELECTION)) {
      state = toggleSelection(state, patient.id);
    }
    const element = renderPatientList(state, noopHandlers());
    const unselected = patients[MAX_SELECTION]!;
    expect(checkboxFor(element, unselected.id).disabled).toBe(true);
    expect(checkboxFor(element, unselected.id).closest('li')!.classList.contains('disabled')).toBe(true);
    // 選択済みの行は、解除できるよう押せるまま。
    expect(checkboxFor(element, patients[0]!.id).disabled).toBe(false);
  });

  it('上限まで選ぶと、これ以上選べない理由を「N件」で表示する', () => {
    const patients = makePatients(MAX_SELECTION + 1);
    let state = createInitialState(patients);
    for (const patient of patients.slice(0, MAX_SELECTION)) {
      state = toggleSelection(state, patient.id);
    }
    const element = renderPatientList(state, noopHandlers());
    expect(q(element, 'limit-hint').textContent).toContain(`${MAX_SELECTION}件`);
  });

  it('上限に達していなければ理由は表示しない', () => {
    const element = renderPatientList(createInitialState(makePatients(2)), noopHandlers());
    expect(element.querySelector('[data-testid="limit-hint"]')).toBeNull();
  });

  it('チェックボックスは data-testid と data-id の両方を持つ(フォーカス復元用)', () => {
    const patients = makePatients(1);
    const element = renderPatientList(createInitialState(patients), noopHandlers());
    expect(checkboxFor(element, patients[0]!.id).dataset.testid).toBe('patient-checkbox');
  });

  it('チェックボックスに、どの訪問先か分かる名前(aria-label)を付ける', () => {
    const patients = makePatients(1);
    const element = renderPatientList(createInitialState(patients), noopHandlers());
    expect(checkboxFor(element, patients[0]!.id).getAttribute('aria-label')).toBe('場所1を選択');
  });
});

describe('renderPatientList: 「⋯」メニュー', () => {
  it('各行の右に「⋯」ボタンを出し、どの訪問先のメニューか分かる名前を付ける', () => {
    const patients = makePatients(2);
    const element = renderPatientList(createInitialState(patients), noopHandlers());
    const buttons = element.querySelectorAll<HTMLButtonElement>('[data-testid="row-menu"]');
    expect(buttons).toHaveLength(2);
    expect(buttons[0]!.textContent).toBe('⋯');
    expect(buttons[0]!.dataset.id).toBe(patients[0]!.id);
    expect(buttons[0]!.getAttribute('aria-label')).toBe('場所1のメニューを開く');
  });

  it('押すと onOpenMenu が id つきで呼ばれる。選択は変わらない', () => {
    const patients = makePatients(1);
    const handlers = noopHandlers();
    const element = renderPatientList(createInitialState(patients), handlers);
    withAttached(element, () => {
      q<HTMLButtonElement>(element, 'row-menu').click();
      expect(handlers.onOpenMenu).toHaveBeenCalledWith(patients[0]!.id);
      expect(handlers.onToggleSelect).not.toHaveBeenCalled();
    });
  });

  it('「⋯」は、行全体の選択(ラベル)の外にある', () => {
    const element = renderPatientList(createInitialState(makePatients(1)), noopHandlers());
    const label = element.querySelector('label')!;
    expect(label.contains(q(element, 'row-menu'))).toBe(false);
  });

  it('「編集」「削除」のボタンを、行に常時は表示しない', () => {
    const element = renderPatientList(createInitialState(makePatients(2)), noopHandlers());
    expect(element.querySelector('[data-testid="edit"]')).toBeNull();
    expect(element.querySelector('[data-testid="delete"]')).toBeNull();
  });
});

describe('renderPatientList: 検索', () => {
  it('検索欄に「名前・住所で検索」のプレースホルダーと名前を付ける', () => {
    const search = q<HTMLInputElement>(renderPatientList(createInitialState([]), noopHandlers()), 'search-input');
    expect(search.placeholder).toBe('名前・住所で検索');
    expect(search.getAttribute('aria-label')).toBe('名前・住所で検索');
  });

  it('検索欄には、今の検索語が入る', () => {
    const state = setSearchQuery(createInitialState([]), '世田谷');
    expect(q<HTMLInputElement>(renderPatientList(state, noopHandlers()), 'search-input').value).toBe('世田谷');
  });

  it('IME変換中は onSearch を呼ばない', () => {
    const handlers = noopHandlers();
    const search = q<HTMLInputElement>(renderPatientList(createInitialState([]), handlers), 'search-input');
    search.dispatchEvent(new Event('compositionstart'));
    search.value = 'やま';
    search.dispatchEvent(new Event('input'));
    expect(handlers.onSearch).not.toHaveBeenCalled();
  });

  it('IME変換が確定(compositionend)すると、確定した文字列で onSearch が呼ばれる', () => {
    const handlers = noopHandlers();
    const search = q<HTMLInputElement>(renderPatientList(createInitialState([]), handlers), 'search-input');
    search.dispatchEvent(new Event('compositionstart'));
    search.value = 'やまだ';
    search.dispatchEvent(new Event('input'));
    search.dispatchEvent(new Event('compositionend'));
    expect(handlers.onSearch).toHaveBeenCalledWith('やまだ');
    expect(handlers.onSearch).toHaveBeenCalledTimes(1);
  });

  it('IME変換を伴わない入力では、input のたびに onSearch が呼ばれる', () => {
    const handlers = noopHandlers();
    const search = q<HTMLInputElement>(renderPatientList(createInitialState([]), handlers), 'search-input');
    search.value = 'a';
    search.dispatchEvent(new Event('input'));
    expect(handlers.onSearch).toHaveBeenCalledWith('a');
  });

  it('検索語が空のときは、クリアボタンを出さない', () => {
    const element = renderPatientList(createInitialState(makePatients(1)), noopHandlers());
    expect(element.querySelector('[data-testid="search-clear"]')).toBeNull();
  });

  it('検索語があるときは、クリアボタンを出し、押すと onClearSearch が呼ばれる', () => {
    const handlers = noopHandlers();
    const state = setSearchQuery(createInitialState(makePatients(1)), '場所');
    const clear = q<HTMLButtonElement>(renderPatientList(state, handlers), 'search-clear');
    expect(clear.getAttribute('aria-label')).toBe('検索をクリア');
    clear.click();
    expect(handlers.onClearSearch).toHaveBeenCalledTimes(1);
  });
});

describe('renderPatientList: 並び替え', () => {
  it('「並び替え」の名前(aria-label)を持つプルダウンを出し、今の並び順が選ばれている', () => {
    const state = { ...createInitialState(makePatients(2)), sortOrder: 'name' as const };
    const select = q<HTMLSelectElement>(renderPatientList(state, noopHandlers()), 'sort-select');
    expect(select.getAttribute('aria-label')).toBe('並び替え');
    expect(select.value).toBe('name');
  });

  it('選ぶと onSortChange が呼ばれる', () => {
    const handlers = noopHandlers();
    const element = renderPatientList(createInitialState(makePatients(2)), handlers);
    const select = q<HTMLSelectElement>(element, 'sort-select');
    withAttached(element, () => {
      select.value = 'address';
      select.dispatchEvent(new Event('change'));
    });
    expect(handlers.onSortChange).toHaveBeenCalledWith('address');
  });

  it('プルダウンは、visually-hiddenなラベルなどで隠されていない(見えなくなるバグの再発防止)', () => {
    const element = renderPatientList(createInitialState(makePatients(2)), noopHandlers());
    const select = q<HTMLSelectElement>(element, 'sort-select');
    for (let ancestor: HTMLElement | null = select; ancestor !== null; ancestor = ancestor.parentElement) {
      expect(ancestor.classList.contains('visually-hidden')).toBe(false);
    }
  });
});

describe('renderPatientList: 全選択', () => {
  it('1件も選んでいなければ「全選択」と表示する', () => {
    const element = renderPatientList(createInitialState(makePatients(2)), noopHandlers());
    expect(q<HTMLButtonElement>(element, 'select-all-button').textContent).toBe('全選択');
  });

  it('表示中がすべて選択済みなら「全解除」と表示する', () => {
    const patients = makePatients(2);
    let state = createInitialState(patients);
    state = toggleSelection(state, patients[0]!.id);
    state = toggleSelection(state, patients[1]!.id);
    const element = renderPatientList(state, noopHandlers());
    expect(q<HTMLButtonElement>(element, 'select-all-button').textContent).toBe('全解除');
  });

  it('一部だけ選択済みなら「全選択」のまま', () => {
    const patients = makePatients(2);
    const state = toggleSelection(createInitialState(patients), patients[0]!.id);
    const element = renderPatientList(state, noopHandlers());
    expect(q<HTMLButtonElement>(element, 'select-all-button').textContent).toBe('全選択');
  });

  it('検索で絞り込んだ表示分だけが選択済みなら「全解除」になる(全体では未選択が残っていても)', () => {
    const patients = makePatients(3);
    let state = createInitialState(patients);
    state = toggleSelection(state, patients[1]!.id);
    state = setSearchQuery(state, '場所2');
    const element = renderPatientList(state, noopHandlers());
    expect(q<HTMLButtonElement>(element, 'select-all-button').textContent).toBe('全解除');
  });

  it('押すと onToggleSelectAll が呼ばれる', () => {
    const handlers = noopHandlers();
    const element = renderPatientList(createInitialState(makePatients(2)), handlers);
    q<HTMLButtonElement>(element, 'select-all-button').click();
    expect(handlers.onToggleSelectAll).toHaveBeenCalledTimes(1);
  });
});

describe('すべて/選択中の切り替え', () => {
  it('件数つきの2つの切り替えを出し、押すと onFilterChange が呼ばれる', () => {
    const patients = makePatients(3);
    const state = toggleSelection(createInitialState(patients), patients[0]!.id);
    const spies = noopHandlers();
    const element = renderPatientList(state, spies);
    expect(q(element, 'filter-all').textContent).toBe('すべて 3');
    expect(q(element, 'filter-selected').textContent).toBe('選択中 1');
    expect(q(element, 'filter-all').getAttribute('aria-pressed')).toBe('true');
    q<HTMLButtonElement>(element, 'filter-selected').click();
    expect(spies.onFilterChange).toHaveBeenCalledWith('selected');
  });
  it('誰も選んでいなければ「選択中」は押せない', () => {
    const element = renderPatientList(createInitialState(makePatients(2)), noopHandlers());
    expect(q<HTMLButtonElement>(element, 'filter-selected').disabled).toBe(true);
  });
  it('選択中の表示では帯を出し、「すべてに戻る」で onFilterChange("all")', () => {
    const patients = makePatients(2);
    let state = toggleSelection(createInitialState(patients), patients[0]!.id);
    state = setListFilter(state, 'selected');
    const spies = noopHandlers();
    const element = renderPatientList(state, spies);
    expect(q(element, 'filter-band').textContent).toContain('選択中の1人を表示しています');
    q<HTMLButtonElement>(element, 'filter-band-all').click();
    expect(spies.onFilterChange).toHaveBeenCalledWith('all');
  });
  it('薄く残す行には dimmed クラスが付く', () => {
    const patients = makePatients(1);
    let state = toggleSelection(createInitialState(patients), patients[0]!.id);
    state = setListFilter(state, 'selected');
    state = toggleSelection(state, patients[0]!.id);
    const row = renderPatientList(state, noopHandlers()).querySelector('[data-testid="patient-row"]')!;
    expect(row.className).toContain('dimmed');
  });
  it('選択中の表示で検索に当たらなければ「すべてから探す」を出す', () => {
    const patients = makePatients(2);
    let state = toggleSelection(createInitialState(patients), patients[0]!.id);
    state = setListFilter(state, 'selected');
    state = setSearchQuery(state, '場所2');
    const spies = noopHandlers();
    const element = renderPatientList(state, spies);
    expect(element.textContent).toContain('選択中には見つかりません');
    q<HTMLButtonElement>(element, 'search-all-button').click();
    expect(spies.onSearchAll).toHaveBeenCalled();
  });
});

describe('一覧の上部の並び', () => {
  it('上部は 見出し → 登録ボタン → 検索+全選択 → 並び替え+すべて/選択中 の順', () => {
    const element = renderPatientList(createInitialState(makePatients(1)), noopHandlers());
    const head = element.querySelector('.list-head')!;
    const rows = [...head.children].map((c) => c.className);
    expect(rows).toEqual(['list-title-row', 'list-new-row', 'list-search-row', 'list-controls']);
    expect(head.querySelector('[data-testid="new-button"]')).not.toBeNull();
    expect(head.querySelector('.list-search-row [data-testid="select-all-button"]')).not.toBeNull();
    expect(head.querySelector('.list-controls [data-testid="filter-all"]')).not.toBeNull();
  });
});

describe('renderPatientList: 電話番号', () => {
  it('電話番号がある行には、tel: リンクがある', () => {
    const patient = createPatient('山田 太郎', '東京都千代田区1-1', new Date(), '03-1234-5678');
    const element = renderPatientList(createInitialState([patient]), noopHandlers());
    const link = q<HTMLAnchorElement>(element, 'phone-link');
    expect(link.getAttribute('href')).toBe('tel:0312345678');
  });

  it('電話番号が無い行には、tel: リンクが無い', () => {
    const patient = createPatient('山田 太郎', '東京都千代田区1-1');
    const element = renderPatientList(createInitialState([patient]), noopHandlers());
    expect(element.querySelector('[data-testid="phone-link"]')).toBeNull();
  });
});
