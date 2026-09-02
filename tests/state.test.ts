import { describe, expect, it } from 'vitest';
import { MAX_SELECTION } from '../src/config';
import { createPatient } from '../src/patient';
import {
  createInitialState,
  moveSelected,
  selectedPatients,
  setSearchQuery,
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
