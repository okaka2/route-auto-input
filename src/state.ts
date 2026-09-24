import { MAX_SELECTION } from './config';
import type { AppState, Message, Patient, Screen, SortOrder } from './types';

/** 日本語のあいうえお順で比較する。 */
const jaCollator = new Intl.Collator('ja');

export function createInitialState(patients: Patient[]): AppState {
  return {
    screen: { name: 'list' },
    patients,
    selectedIds: [],
    searchQuery: '',
    sortOrder: 'registered',
    message: null,
    dialog: null,
    listFilter: 'all',
    dimmedIds: [],
  };
}

/** DBを読み直したときに使う。存在しなくなった訪問先の選択と、その訪問先のダイアログは外す。 */
export function withPatients(state: AppState, patients: Patient[]): AppState {
  const existingIds = new Set(patients.map((patient) => patient.id));
  const selectedIds = state.selectedIds.filter((id) => existingIds.has(id));
  const dimmedIds = state.dimmedIds.filter((id) => existingIds.has(id));
  return {
    ...state,
    patients,
    selectedIds,
    dimmedIds,
    dialog: keepDialog(state.dialog, existingIds, selectedIds),
  };
}

/** 対象の訪問先(1件向け)、または選択(複数選択向け)がまだ残っていれば、ダイアログを開いたままにする。 */
function keepDialog(
  dialog: AppState['dialog'],
  existingIds: ReadonlySet<string>,
  selectedIds: readonly string[],
): AppState['dialog'] {
  if (dialog === null) {
    return null;
  }
  if (dialog.kind === 'installSteps') {
    return dialog;
  }
  if (dialog.kind === 'confirmDeleteSelected') {
    return selectedIds.length > 0 ? dialog : null;
  }
  return existingIds.has(dialog.id) ? dialog : null;
}

export function withScreen(state: AppState, screen: Screen): AppState {
  return { ...state, screen, message: null, dialog: null, listFilter: 'all', dimmedIds: [] };
}

/** 一覧に出す範囲を切り替える。誰も選んでいなければ「選択中」には切り替わらない。 */
export function setListFilter(state: AppState, listFilter: 'all' | 'selected'): AppState {
  if (listFilter === 'selected' && state.selectedIds.length === 0) {
    return state;
  }
  return { ...state, listFilter, dimmedIds: [] };
}

export function withMessage(state: AppState, message: Message | null): AppState {
  return { ...state, message };
}

export function setSearchQuery(state: AppState, query: string): AppState {
  return { ...state, searchQuery: query };
}

export function setSortOrder(state: AppState, sortOrder: SortOrder): AppState {
  return { ...state, sortOrder };
}

export function toggleSelection(state: AppState, id: string): AppState {
  if (state.selectedIds.includes(id)) {
    return {
      ...state,
      selectedIds: state.selectedIds.filter((selectedId) => selectedId !== id),
      dimmedIds: state.listFilter === 'selected' ? [...state.dimmedIds, id] : state.dimmedIds,
      message: null,
    };
  }
  if (state.selectedIds.length >= MAX_SELECTION) {
    return {
      ...state,
      message: { kind: 'error', text: `一度に選べるのは${MAX_SELECTION}件までです。` },
    };
  }
  return {
    ...state,
    selectedIds: [...state.selectedIds, id],
    dimmedIds: state.dimmedIds.filter((d) => d !== id),
    message: null,
  };
}

/**
 * 表示中(検索で絞り込んでいればその分だけ)の訪問先を、すべて選択する。
 * 「訪問順を決める」の上限(MAX_SELECTION)は、一括削除のためにここでは適用しない。
 * 上限は「訪問順を決める →」を押した時に、validateSelectionで案内する。
 */
export function selectAllVisible(state: AppState): AppState {
  return { ...state, selectedIds: visiblePatients(state).map((patient) => patient.id), message: null };
}

export function clearSelection(state: AppState): AppState {
  return { ...state, selectedIds: [], dimmedIds: [], listFilter: 'all', message: null };
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

/** 訪問順の「⋯」から、先頭または最後へ動かす。すでに端ならそのまま。 */
export function moveSelectedToEdge(state: AppState, id: string, edge: 'top' | 'bottom'): AppState {
  const index = state.selectedIds.indexOf(id);
  if (index === -1) {
    return state;
  }
  if ((edge === 'top' && index === 0) || (edge === 'bottom' && index === state.selectedIds.length - 1)) {
    return state;
  }
  const rest = state.selectedIds.filter((s) => s !== id);
  return { ...state, selectedIds: edge === 'top' ? [id, ...rest] : [...rest, id], dialog: null };
}

export function visiblePatients(state: AppState): Patient[] {
  const query = state.searchQuery.trim();
  const scope =
    state.listFilter === 'selected'
      ? state.patients.filter(
          (patient) => state.selectedIds.includes(patient.id) || state.dimmedIds.includes(patient.id),
        )
      : state.patients;
  const matched =
    query.length === 0
      ? scope
      : scope.filter((patient) => patient.name.includes(query) || patient.address.includes(query));
  if (state.sortOrder === 'registered') {
    return matched;
  }
  const key = state.sortOrder === 'name' ? 'name' : 'address';
  return [...matched].sort((a, b) => jaCollator.compare(a[key], b[key]));
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

/** 訪問順の「⋯」メニューを開く。 */
export function openStopMenu(state: AppState, id: string): AppState {
  return { ...state, dialog: { kind: 'stopMenu', id } };
}

export function openDeleteSelectedConfirm(state: AppState): AppState {
  return { ...state, dialog: { kind: 'confirmDeleteSelected' } };
}

/** ダイアログを閉じる。開いていなければ、同じ状態をそのまま返す。 */
export function closeDialog(state: AppState): AppState {
  return state.dialog === null ? state : { ...state, dialog: null };
}

/** 訪問先を1件以上選んでいるか。 */
export function hasSelection(state: AppState): boolean {
  return state.selectedIds.length > 0;
}
