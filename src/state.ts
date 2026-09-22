import { MAX_SELECTION } from './config';
import type { AppState, Message, Patient, Screen } from './types';

export function createInitialState(patients: Patient[]): AppState {
  return {
    screen: { name: 'list' },
    patients,
    selectedIds: [],
    searchQuery: '',
    message: null,
    dialog: null,
  };
}

/** DBを読み直したときに使う。存在しなくなった訪問先の選択と、その訪問先のダイアログは外す。 */
export function withPatients(state: AppState, patients: Patient[]): AppState {
  const existingIds = new Set(patients.map((patient) => patient.id));
  return {
    ...state,
    patients,
    selectedIds: state.selectedIds.filter((id) => existingIds.has(id)),
    dialog: state.dialog !== null && existingIds.has(state.dialog.id) ? state.dialog : null,
  };
}

export function withScreen(state: AppState, screen: Screen): AppState {
  return { ...state, screen, message: null, dialog: null };
}

export function withMessage(state: AppState, message: Message | null): AppState {
  return { ...state, message };
}

export function setSearchQuery(state: AppState, query: string): AppState {
  return { ...state, searchQuery: query };
}

export function toggleSelection(state: AppState, id: string): AppState {
  if (state.selectedIds.includes(id)) {
    return {
      ...state,
      selectedIds: state.selectedIds.filter((selectedId) => selectedId !== id),
      message: null,
    };
  }
  if (state.selectedIds.length >= MAX_SELECTION) {
    return {
      ...state,
      message: { kind: 'error', text: `一度に選べるのは${MAX_SELECTION}件までです。` },
    };
  }
  return { ...state, selectedIds: [...state.selectedIds, id], message: null };
}

export function moveSelected(state: AppState, id: string, direction: -1 | 1): AppState {
  const index = state.selectedIds.indexOf(id);
  const target = index + direction;
  if (index === -1 || target < 0 || target >= state.selectedIds.length) {
    return state;
  }
  const selectedIds = [...state.selectedIds];
  selectedIds[index] = state.selectedIds[target]!;
  selectedIds[target] = state.selectedIds[index]!;
  return { ...state, selectedIds };
}

export function visiblePatients(state: AppState): Patient[] {
  const query = state.searchQuery.trim();
  if (query.length === 0) {
    return state.patients;
  }
  return state.patients.filter(
    (patient) => patient.name.includes(query) || patient.address.includes(query),
  );
}

/** 訪問順に並んだ、選択中の患者。 */
export function selectedPatients(state: AppState): Patient[] {
  const byId = new Map(state.patients.map((patient) => [patient.id, patient]));
  return state.selectedIds
    .map((id) => byId.get(id))
    .filter((patient): patient is Patient => patient !== undefined);
}

export function openRowMenu(state: AppState, id: string): AppState {
  return { ...state, dialog: { kind: 'rowMenu', id } };
}

export function openDeleteConfirm(state: AppState, id: string): AppState {
  return { ...state, dialog: { kind: 'confirmDelete', id } };
}

/** ダイアログを閉じる。開いていなければ、同じ状態をそのまま返す。 */
export function closeDialog(state: AppState): AppState {
  return state.dialog === null ? state : { ...state, dialog: null };
}

/** 訪問先を1件以上選んでいるか。 */
export function hasSelection(state: AppState): boolean {
  return state.selectedIds.length > 0;
}
