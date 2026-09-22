import { describe, expect, it } from 'vitest';
import { MAX_SELECTION } from '../src/config';
import { createPatient } from '../src/patient';
import {
  clearSelection,
  closeDialog,
  createInitialState,
  hasSelection,
  moveSelected,
  openDeleteConfirm,
  openDeleteSelectedConfirm,
  openRowMenu,
  selectAllVisible,
  selectedPatients,
  setSearchQuery,
  setSortOrder,
  toggleSelection,
  visiblePatients,
  withMessage,
  withPatients,
  withScreen,
} from '../src/state';
import type { Patient } from '../src/types';

const makePatients = (count: number): Patient[] =>
  Array.from({ length: count }, (_, i) => createPatient(`患者${i + 1}`, `東京都${i + 1}-1`));

describe('createInitialState', () => {
  it('一覧画面から始まり、選択は空', () => {
    const state = createInitialState(makePatients(2));
    expect(state.screen).toEqual({ name: 'list' });
    expect(state.selectedIds).toEqual([]);
    expect(state.searchQuery).toBe('');
    expect(state.message).toBeNull();
  });

  it('並び順は登録順から始まる', () => {
    expect(createInitialState([]).sortOrder).toBe('registered');
  });
});

describe('toggleSelection', () => {
  it('未選択の患者を選ぶと末尾に追加される', () => {
    const patients = makePatients(3);
    let state = createInitialState(patients);
    state = toggleSelection(state, patients[0]!.id);
    state = toggleSelection(state, patients[2]!.id);
    expect(state.selectedIds).toEqual([patients[0]!.id, patients[2]!.id]);
  });

  it('選択済みの患者をもう一度押すと外れる', () => {
    const patients = makePatients(2);
    let state = createInitialState(patients);
    state = toggleSelection(state, patients[0]!.id);
    state = toggleSelection(state, patients[0]!.id);
    expect(state.selectedIds).toEqual([]);
  });

  it('上限を超えて選ぼうとすると選択は変わらず、エラーメッセージが出る', () => {
    const patients = makePatients(MAX_SELECTION + 1);
    let state = createInitialState(patients);
    for (const patient of patients.slice(0, MAX_SELECTION)) {
      state = toggleSelection(state, patient.id);
    }
    const overflowed = toggleSelection(state, patients[MAX_SELECTION]!.id);
    expect(overflowed.selectedIds).toHaveLength(MAX_SELECTION);
    expect(overflowed.message?.kind).toBe('error');
  });

  it('上限まで選んでいても選択済みの解除はできる', () => {
    const patients = makePatients(MAX_SELECTION);
    let state = createInitialState(patients);
    for (const patient of patients) {
      state = toggleSelection(state, patient.id);
    }
    state = toggleSelection(state, patients[0]!.id);
    expect(state.selectedIds).toHaveLength(MAX_SELECTION - 1);
  });
});

describe('moveSelected', () => {
  it('上へ動かすと順番が入れ替わる', () => {
    const patients = makePatients(3);
    let state = createInitialState(patients);
    for (const patient of patients) {
      state = toggleSelection(state, patient.id);
    }
    state = moveSelected(state, patients[1]!.id, -1);
    expect(state.selectedIds).toEqual([patients[1]!.id, patients[0]!.id, patients[2]!.id]);
  });

  it('下へ動かすと順番が入れ替わる', () => {
    const patients = makePatients(3);
    let state = createInitialState(patients);
    for (const patient of patients) {
      state = toggleSelection(state, patient.id);
    }
    state = moveSelected(state, patients[0]!.id, 1);
    expect(state.selectedIds).toEqual([patients[1]!.id, patients[0]!.id, patients[2]!.id]);
  });

  it('先頭をさらに上へ動かしても変わらない', () => {
    const patients = makePatients(2);
    let state = createInitialState(patients);
    for (const patient of patients) {
      state = toggleSelection(state, patient.id);
    }
    const moved = moveSelected(state, patients[0]!.id, -1);
    expect(moved.selectedIds).toEqual(state.selectedIds);
  });

  it('選択していない患者を動かしても変わらない', () => {
    const patients = makePatients(2);
    const state = toggleSelection(createInitialState(patients), patients[0]!.id);
    const moved = moveSelected(state, patients[1]!.id, -1);
    expect(moved.selectedIds).toEqual(state.selectedIds);
  });
});

describe('visiblePatients', () => {
  it('検索語がなければ全件返す', () => {
    const state = createInitialState(makePatients(3));
    expect(visiblePatients(state)).toHaveLength(3);
  });

  it('氏名で絞り込める', () => {
    const state = setSearchQuery(createInitialState(makePatients(3)), '患者2');
    expect(visiblePatients(state).map((p) => p.name)).toEqual(['患者2']);
  });

  it('住所で絞り込める', () => {
    const patients = [createPatient('山田', '東京都港区1-1'), createPatient('鈴木', '大阪市北区2-2')];
    const state = setSearchQuery(createInitialState(patients), '大阪');
    expect(visiblePatients(state).map((p) => p.name)).toEqual(['鈴木']);
  });

  it('前後の空白は無視される', () => {
    const state = setSearchQuery(createInitialState(makePatients(3)), '  患者3  ');
    expect(visiblePatients(state)).toHaveLength(1);
  });

  it('既定(登録順)は登録した順のまま', () => {
    const patients = [createPatient('うえだ', 'い'), createPatient('あべ', 'う')];
    const state = createInitialState(patients);
    expect(visiblePatients(state).map((p) => p.name)).toEqual(['うえだ', 'あべ']);
  });

  it('名前順にすると、あいうえお順に並ぶ', () => {
    const patients = [createPatient('うえだ', 'x'), createPatient('あべ', 'y'), createPatient('いとう', 'z')];
    const state = setSortOrder(createInitialState(patients), 'name');
    expect(visiblePatients(state).map((p) => p.name)).toEqual(['あべ', 'いとう', 'うえだ']);
  });

  it('住所順にすると、あいうえお順に並ぶ', () => {
    const patients = [createPatient('a', 'うえだ町'), createPatient('b', 'あべ町'), createPatient('c', 'いとう町')];
    const state = setSortOrder(createInitialState(patients), 'address');
    expect(visiblePatients(state).map((p) => p.address)).toEqual(['あべ町', 'いとう町', 'うえだ町']);
  });

  it('並び替えても、検索の絞り込みは効いたまま', () => {
    const patients = [createPatient('うえだ', '東京都'), createPatient('あべ', '大阪府')];
    let state = createInitialState(patients);
    state = setSortOrder(state, 'name');
    state = setSearchQuery(state, '東京');
    expect(visiblePatients(state).map((p) => p.name)).toEqual(['うえだ']);
  });
});

describe('setSortOrder', () => {
  it('並び順を変えられる', () => {
    const state = setSortOrder(createInitialState([]), 'address');
    expect(state.sortOrder).toBe('address');
  });
});

describe('選択の一括操作', () => {
  it('selectAllVisible: 表示中の訪問先をすべて選択する', () => {
    const patients = makePatients(3);
    const state = selectAllVisible(createInitialState(patients));
    expect(state.selectedIds).toEqual(patients.map((p) => p.id));
  });

  it('selectAllVisible: 検索で絞り込んでいれば、その表示分だけ選ぶ', () => {
    const patients = makePatients(3);
    let state = setSearchQuery(createInitialState(patients), '患者2');
    state = selectAllVisible(state);
    expect(state.selectedIds).toEqual([patients[1]!.id]);
  });

  it('selectAllVisible: 上限(MAX_SELECTION)を超えていても、すべて選べる', () => {
    const patients = makePatients(MAX_SELECTION + 3);
    const state = selectAllVisible(createInitialState(patients));
    expect(state.selectedIds).toHaveLength(MAX_SELECTION + 3);
  });

  it('clearSelection: 選択をすべて外す', () => {
    const patients = makePatients(2);
    let state = createInitialState(patients);
    state = toggleSelection(state, patients[0]!.id);
    state = toggleSelection(state, patients[1]!.id);
    state = clearSelection(state);
    expect(state.selectedIds).toEqual([]);
  });
});

describe('selectedPatients', () => {
  it('選択した順(訪問順)に返す', () => {
    const patients = makePatients(3);
    let state = createInitialState(patients);
    state = toggleSelection(state, patients[2]!.id);
    state = toggleSelection(state, patients[0]!.id);
    expect(selectedPatients(state).map((p) => p.name)).toEqual(['患者3', '患者1']);
  });
});

describe('withPatients', () => {
  it('一覧を差し替えると、いなくなった患者の選択は外れる', () => {
    const patients = makePatients(3);
    let state = createInitialState(patients);
    state = toggleSelection(state, patients[0]!.id);
    state = toggleSelection(state, patients[1]!.id);
    const next = withPatients(state, [patients[1]!]);
    expect(next.selectedIds).toEqual([patients[1]!.id]);
  });

  it('一括削除の確認は、選択が1件でも残っていれば開いたまま', () => {
    const patients = makePatients(3);
    let state = createInitialState(patients);
    state = toggleSelection(state, patients[0]!.id);
    state = toggleSelection(state, patients[1]!.id);
    state = openDeleteSelectedConfirm(state);
    const next = withPatients(state, [patients[0]!, patients[2]!]);
    expect(next.dialog).toEqual({ kind: 'confirmDeleteSelected' });
  });

  it('一括削除の確認は、選択が1件もなくなれば閉じる', () => {
    const patients = makePatients(2);
    let state = createInitialState(patients);
    state = toggleSelection(state, patients[0]!.id);
    state = openDeleteSelectedConfirm(state);
    const next = withPatients(state, [patients[1]!]);
    expect(next.dialog).toBeNull();
  });
});

describe('withScreen / withMessage', () => {
  it('画面を切り替えるとメッセージは消える', () => {
    const state = withMessage(createInitialState([]), { kind: 'error', text: 'エラー' });
    expect(withScreen(state, { name: 'settings' }).message).toBeNull();
  });

  it('メッセージを設定できる', () => {
    const state = withMessage(createInitialState([]), { kind: 'info', text: '保存しました。' });
    expect(state.message).toEqual({ kind: 'info', text: '保存しました。' });
  });
});

describe('ダイアログの状態', () => {
  it('最初はダイアログが開いていない', () => {
    expect(createInitialState([]).dialog).toBeNull();
  });

  it('「⋯」メニューを開くと、その訪問先のメニューになる', () => {
    const state = openRowMenu(createInitialState(makePatients(2)), 'p1');
    expect(state.dialog).toEqual({ kind: 'rowMenu', id: 'p1' });
  });

  it('削除の確認を開くと、その訪問先の確認になる', () => {
    const state = openDeleteConfirm(createInitialState(makePatients(2)), 'p1');
    expect(state.dialog).toEqual({ kind: 'confirmDelete', id: 'p1' });
  });

  it('選択した複数件の削除確認を開ける', () => {
    const state = openDeleteSelectedConfirm(createInitialState(makePatients(2)));
    expect(state.dialog).toEqual({ kind: 'confirmDeleteSelected' });
  });

  it('メニューから削除の確認へ切り替えられる', () => {
    let state = openRowMenu(createInitialState(makePatients(2)), 'p1');
    state = openDeleteConfirm(state, 'p1');
    expect(state.dialog?.kind).toBe('confirmDelete');
  });

  it('閉じると、ダイアログがなくなる', () => {
    const state = closeDialog(openRowMenu(createInitialState(makePatients(2)), 'p1'));
    expect(state.dialog).toBeNull();
  });

  it('開いていないときに閉じても、同じ状態を返す', () => {
    const state = createInitialState(makePatients(2));
    expect(closeDialog(state)).toBe(state);
  });

  it('画面を切り替えると、ダイアログも閉じる', () => {
    const state = withScreen(openRowMenu(createInitialState(makePatients(2)), 'p1'), { name: 'settings' });
    expect(state.dialog).toBeNull();
  });

  it('対象の訪問先がなくなったら、ダイアログを閉じる', () => {
    const patients = makePatients(2);
    const opened = openRowMenu(createInitialState(patients), patients[0]!.id);
    const next = withPatients(opened, [patients[1]!]);
    expect(next.dialog).toBeNull();
  });

  it('対象の訪問先が残っていれば、ダイアログは開いたまま', () => {
    const patients = makePatients(2);
    const opened = openRowMenu(createInitialState(patients), patients[0]!.id);
    const next = withPatients(opened, patients);
    expect(next.dialog).toEqual({ kind: 'rowMenu', id: patients[0]!.id });
  });

  it('入力の状態を書き換えない', () => {
    const state = createInitialState(makePatients(2));
    openRowMenu(state, 'p1');
    expect(state.dialog).toBeNull();
  });
});

describe('hasSelection', () => {
  it('1件も選んでいなければ false', () => {
    expect(hasSelection(createInitialState(makePatients(2)))).toBe(false);
  });

  it('1件以上選んでいれば true', () => {
    const patients = makePatients(2);
    const state = toggleSelection(createInitialState(patients), patients[0]!.id);
    expect(hasSelection(state)).toBe(true);
  });
});

describe('選択上限の文言', () => {
  it('上限を超えて選ぼうとしたとき、「N件まで」と案内する', () => {
    const patients = makePatients(MAX_SELECTION + 1);
    let state = createInitialState(patients);
    for (const patient of patients.slice(0, MAX_SELECTION)) {
      state = toggleSelection(state, patient.id);
    }
    const overflowed = toggleSelection(state, patients[MAX_SELECTION]!.id);
    expect(overflowed.message?.text).toBe(`一度に選べるのは${MAX_SELECTION}件までです。`);
  });
});
