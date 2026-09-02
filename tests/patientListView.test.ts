import { describe, expect, it, vi } from 'vitest';
import { MAX_SELECTION } from '../src/config';
import { createPatient } from '../src/patient';
import { createInitialState, setSearchQuery, toggleSelection } from '../src/state';
import { renderPatientList, type PatientListHandlers } from '../src/views/patientListView';
import type { Patient } from '../src/types';

const makePatients = (count: number): Patient[] =>
  Array.from({ length: count }, (_, i) => createPatient(`患者${i + 1}`, `東京都${i + 1}-1`));

const noopHandlers = (): PatientListHandlers => ({
  onSearch: vi.fn(),
  onToggleSelect: vi.fn(),
  onNew: vi.fn(),
  onEdit: vi.fn(),
  onDelete: vi.fn(),
  onNext: vi.fn(),
  onOpenSettings: vi.fn(),
});

describe('renderPatientList', () => {
  it('患者の行を件数ぶん描画する', () => {
    const element = renderPatientList(createInitialState(makePatients(3)), noopHandlers());
    expect(element.querySelectorAll('[data-testid="patient-row"]')).toHaveLength(3);
  });

  it('氏名と住所を表示する', () => {
    const element = renderPatientList(createInitialState(makePatients(1)), noopHandlers());
    expect(element.textContent).toContain('患者1');
    expect(element.textContent).toContain('東京都1-1');
  });

  it('登録が0件ならその旨を表示する', () => {
    const element = renderPatientList(createInitialState([]), noopHandlers());
    expect(element.textContent).toContain('まだ患者が登録されていません');
  });

  it('検索で絞り込まれた結果だけを描画する', () => {
    const state = setSearchQuery(createInitialState(makePatients(3)), '患者2');
    const element = renderPatientList(state, noopHandlers());
    expect(element.querySelectorAll('[data-testid="patient-row"]')).toHaveLength(1);
  });

  it('選択済みの患者のチェックボックスがオンになる', () => {
    const patients = makePatients(2);
    const state = toggleSelection(createInitialState(patients), patients[0]!.id);
    const element = renderPatientList(state, noopHandlers());
    const checkbox = element.querySelector<HTMLInputElement>(`input[data-id="${patients[0]!.id}"]`);
    expect(checkbox?.checked).toBe(true);
  });

  it('チェックボックスを押すとonToggleSelectがidつきで呼ばれる', () => {
    const patients = makePatients(1);
    const handlers = noopHandlers();
    const element = renderPatientList(createInitialState(patients), handlers);
    // change イベントは要素がdocumentに接続されていないと発火しないため、一時的に接続する。
    document.body.append(element);
    try {
      element.querySelector<HTMLInputElement>(`input[data-id="${patients[0]!.id}"]`)?.click();
      expect(handlers.onToggleSelect).toHaveBeenCalledWith(patients[0]!.id);
    } finally {
      element.remove();
    }
  });

  it('上限まで選ぶと、未選択のチェックボックスが押せなくなる', () => {
    const patients = makePatients(MAX_SELECTION + 1);
    let state = createInitialState(patients);
    for (const patient of patients.slice(0, MAX_SELECTION)) {
      state = toggleSelection(state, patient.id);
    }
    const element = renderPatientList(state, noopHandlers());
    const unselected = element.querySelector<HTMLInputElement>(
      `input[data-id="${patients[MAX_SELECTION]!.id}"]`,
    );
    expect(unselected?.disabled).toBe(true);
  });

  it('未選択のときは「次へ」が押せない', () => {
    const element = renderPatientList(createInitialState(makePatients(2)), noopHandlers());
    const next = element.querySelector<HTMLButtonElement>('[data-testid="next-button"]');
    expect(next?.disabled).toBe(true);
  });

  it('1人以上選ぶと「次へ」が押せる', () => {
    const patients = makePatients(2);
    const state = toggleSelection(createInitialState(patients), patients[0]!.id);
    const element = renderPatientList(state, noopHandlers());
    const next = element.querySelector<HTMLButtonElement>('[data-testid="next-button"]');
    expect(next?.disabled).toBe(false);
  });

  it('選択件数を表示する', () => {
    const patients = makePatients(3);
    const state = toggleSelection(createInitialState(patients), patients[0]!.id);
    const element = renderPatientList(state, noopHandlers());
    expect(element.textContent).toContain(`1 / ${MAX_SELECTION}`);
  });

  it('上限まで選ぶと、これ以上選べない理由を表示する', () => {
    const patients = makePatients(MAX_SELECTION + 1);
    let state = createInitialState(patients);
    for (const patient of patients.slice(0, MAX_SELECTION)) {
      state = toggleSelection(state, patient.id);
    }
    const element = renderPatientList(state, noopHandlers());
    expect(element.querySelector('[data-testid="limit-hint"]')?.textContent).toContain(
      `${MAX_SELECTION}人`,
    );
  });

  it('上限に達していなければ理由は表示しない', () => {
    const element = renderPatientList(createInitialState(makePatients(2)), noopHandlers());
    expect(element.querySelector('[data-testid="limit-hint"]')).toBeNull();
  });

  it('編集ボタンでonEditが呼ばれる', () => {
    const patients = makePatients(1);
    const handlers = noopHandlers();
    const element = renderPatientList(createInitialState(patients), handlers);
    element.querySelector<HTMLButtonElement>(`[data-testid="edit"][data-id="${patients[0]!.id}"]`)?.click();
    expect(handlers.onEdit).toHaveBeenCalledWith(patients[0]!.id);
  });

  it('削除ボタンでonDeleteが呼ばれる', () => {
    const patients = makePatients(1);
    const handlers = noopHandlers();
    const element = renderPatientList(createInitialState(patients), handlers);
    element.querySelector<HTMLButtonElement>(`[data-testid="delete"][data-id="${patients[0]!.id}"]`)?.click();
    expect(handlers.onDelete).toHaveBeenCalledWith(patients[0]!.id);
  });

  it('メッセージがあれば表示する', () => {
    const state = { ...createInitialState([]), message: { kind: 'error' as const, text: '保存できませんでした。' } };
    const element = renderPatientList(state, noopHandlers());
    expect(element.querySelector('.message')?.textContent).toBe('保存できませんでした。');
  });

  it('チェックボックスに患者名のラベルを付ける', () => {
    const patients = makePatients(1);
    const element = renderPatientList(createInitialState(patients), noopHandlers());
    const checkbox = element.querySelector<HTMLInputElement>(`input[data-id="${patients[0]!.id}"]`);
    expect(checkbox?.getAttribute('aria-label')).toBe('患者1 を選択');
  });
});
