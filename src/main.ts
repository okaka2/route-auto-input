import './styles.css';
import { parseBackup, serializeBackup } from './backup';
import { MAX_STOPS_PER_ROUTE } from './config';
import { deletePatient, listPatients, mergePatients, replaceAllPatients, savePatient } from './db';
import { downloadTextFile, readTextFile } from './fileIo';
import { DEFAULT_MAP_PROVIDER } from './mapProviders';
import { openUrl } from './openRoute';
import { createPatient, updatePatientFields } from './patient';
import { splitIntoRoutes } from './routeSplitter';
import { clearSession, loadSession, saveSession } from './session';
import {
  createInitialState,
  moveSelected,
  selectedPatients,
  setSearchQuery,
  toggleSelection,
  withMessage,
  withPatients,
  withScreen,
} from './state';
import type { AppState, Message, Patient } from './types';
import { validatePatientInput, validateSelection } from './validation';
import { renderPatientForm, type PatientFormDraft } from './views/patientFormView';
import { renderPatientList } from './views/patientListView';
import { renderRouteOrder } from './views/routeOrderView';
import { renderRouteMap } from './views/routeMapView';
import { renderSettings } from './views/settingsView';

const root = document.querySelector<HTMLDivElement>('#app');
if (!root) {
  throw new Error('#app が見つかりません。');
}

// Googleマップへ遷移して戻ってきたときのために、選択・訪問順・開いたルートを
// localStorageから復元する(Ruling 7)。復元できた場合は訪問順の画面から始める。
const restoredSession = loadSession();
let state: AppState = restoredSession
  ? {
      ...createInitialState([]),
      selectedIds: restoredSession.selectedIds,
      // 開いたルートがあれば、地図アプリから戻ってきた状況。次に開くルートがすぐ分かるよう、
      // 地図の画面から始める。なければ、これまでどおり訪問順の画面から始める。
      screen: { name: restoredSession.opened.length > 0 ? 'map' : 'order' },
    }
  : createInitialState([]);
// 開いたルートの番号と、開いた日時(ISO 8601。日時が分からない古い記録から復元したものは '')。
const openedRoutes = new Map<number, string>(
  (restoredSession?.opened ?? []).map((route) => [route.index, route.at] as const),
);

// 保存に失敗した直後の入力値。入力内容を画面に残すため(spec §8)、
// openedRouteIndexesと同様にAppStateの外で保持する。
let formDraft: PatientFormDraft | null = null;

// 保存/削除の二重実行防止(ボタンを連打してもDBへ二重に書き込まない)。
let savingPatient = false;
const deletingPatientIds = new Set<string>();

function setState(next: AppState): void {
  state = next;
  render();
}

function syncSession(): void {
  if (state.selectedIds.length === 0) {
    clearSession();
    return;
  }
  saveSession({
    selectedIds: state.selectedIds,
    opened: [...openedRoutes].map(([index, at]) => ({ index, at })),
    timestamp: new Date().toISOString(),
  });
}

/**
 * DBから患者を読み直す。message を渡したときだけ、表示中のメッセージを差し替える。
 * 省略したとき(起動直後の読み込みなど)は今のメッセージを保つ。保たないと、読み込みが
 * 終わった瞬間に、操作の結果として出たばかりのエラーや案内を消してしまう。
 */
async function reloadPatients(message?: Message): Promise<void> {
  try {
    const patients = await listPatients();
    setState({
      ...withPatients(state, patients),
      ...(message === undefined ? {} : { message }),
    });
  } catch {
    setState(withMessage(state, { kind: 'error', text: 'データを読み込めませんでした。' }));
  }
}

function currentEditingPatient(): Patient | null {
  const screen = state.screen;
  if (screen.name !== 'form' || screen.patientId === null) {
    return null;
  }
  const id = screen.patientId;
  return state.patients.find((patient) => patient.id === id) ?? null;
}

async function handleSave(name: string, address: string): Promise<void> {
  if (savingPatient) {
    // 保存中の二重タップ。何もしない(2件目のUUIDが発行されるのを防ぐ)。
    return;
  }
  const validation = validatePatientInput(name, address);
  if (!validation.ok) {
    formDraft = { name, address };
    setState(withMessage(state, { kind: 'error', text: validation.message }));
    return;
  }
  savingPatient = true;
  try {
    const existing = currentEditingPatient();
    const patient =
      existing === null ? createPatient(name, address) : updatePatientFields(existing, name, address);
    await savePatient(patient);
    formDraft = null;
    setState(withScreen(state, { name: 'list' }));
    await reloadPatients({ kind: 'info', text: '保存しました。' });
  } catch {
    formDraft = { name, address };
    setState(withMessage(state, { kind: 'error', text: 'データを保存できませんでした。' }));
  } finally {
    savingPatient = false;
  }
}

async function handleDelete(id: string): Promise<void> {
  if (deletingPatientIds.has(id)) {
    // 削除中の二重タップ。何もしない。
    return;
  }
  const patient = state.patients.find((item) => item.id === id);
  if (!patient) {
    return;
  }
  if (!window.confirm(`${patient.name} を削除します。よろしいですか?`)) {
    return;
  }
  deletingPatientIds.add(id);
  try {
    await deletePatient(id);
    await reloadPatients({ kind: 'info', text: '削除しました。' });
  } catch {
    setState(withMessage(state, { kind: 'error', text: 'データを削除できませんでした。' }));
  } finally {
    deletingPatientIds.delete(id);
  }
}

function handleOpenRoute(routeIndex: number): void {
  const routes = splitIntoRoutes(selectedPatients(state), MAX_STOPS_PER_ROUTE);
  const route = routes[routeIndex];
  if (!route) {
    return;
  }
  try {
    const url = DEFAULT_MAP_PROVIDER.buildUrl(route.map((patient) => patient.address));
    openedRoutes.set(routeIndex, new Date().toISOString());
    render();
    openUrl(url);
  } catch (error) {
    const message = error instanceof Error ? error.message : '地図を開けませんでした。';
    setState(withMessage(state, { kind: 'error', text: message }));
  }
}

function handleExport(): void {
  try {
    const date = new Date().toISOString().slice(0, 10);
    downloadTextFile(`route-auto-input-${date}.json`, serializeBackup(state.patients));
    setState(withMessage(state, { kind: 'info', text: 'バックアップを書き出しました。' }));
  } catch {
    setState(withMessage(state, { kind: 'error', text: 'バックアップを書き出せませんでした。' }));
  }
}

async function handleImport(file: File, mode: 'replace' | 'merge'): Promise<void> {
  try {
    const patients = parseBackup(await readTextFile(file));
    const question =
      mode === 'replace'
        ? `今のデータ${state.patients.length}件を消して、${patients.length}件を取り込みます。よろしいですか?`
        : `${patients.length}件を今のデータに追加します。よろしいですか?`;
    if (!window.confirm(question)) {
      return;
    }
    if (mode === 'replace') {
      await replaceAllPatients(patients);
    } else {
      await mergePatients(patients);
    }
    await reloadPatients({ kind: 'info', text: `${patients.length}件を取り込みました。` });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'データを取り込めませんでした。';
    setState(withMessage(state, { kind: 'error', text: message }));
  }
}

function renderScreen(): HTMLElement {
  switch (state.screen.name) {
    case 'list':
      return renderPatientList(state, {
        onSearch: (query) => setState(setSearchQuery(state, query)),
        onToggleSelect: (id) => {
          const next = toggleSelection(state, id);
          // 選択が実際に変わったときだけ、開いたルートの印を消す(上限で選べなかったときは変えない)。
          if (next.selectedIds !== state.selectedIds) {
            openedRoutes.clear();
          }
          setState(next);
        },
        onNew: () => {
          formDraft = null;
          setState(withScreen(state, { name: 'form', patientId: null }));
        },
        onEdit: (id) => {
          formDraft = null;
          setState(withScreen(state, { name: 'form', patientId: id }));
        },
        onDelete: (id) => {
          void handleDelete(id);
        },
        onNext: () => {
          const validation = validateSelection(state.selectedIds.length);
          if (!validation.ok) {
            setState(withMessage(state, { kind: 'error', text: validation.message }));
            return;
          }
          setState(withScreen(state, { name: 'order' }));
        },
        onOpenSettings: () => setState(withScreen(state, { name: 'settings' })),
      });
    case 'form':
      return renderPatientForm(currentEditingPatient(), formDraft, state.message, {
        onSave: (name, address) => {
          void handleSave(name, address);
        },
        onCancel: () => {
          formDraft = null;
          setState(withScreen(state, { name: 'list' }));
        },
      });
    case 'order':
      return renderRouteOrder(state, {
        onMove: (id, direction) => {
          const next = moveSelected(state, id, direction);
          // 順番が実際に変わったときだけ、開いたルートの印を消す(端の▲▼は何も変えない)。
          if (next.selectedIds !== state.selectedIds) {
            openedRoutes.clear();
          }
          setState(next);
        },
        onAddStops: () => setState(withScreen(state, { name: 'list' })),
        onOpenMap: () => setState(withScreen(state, { name: 'map' })),
        onBack: () => setState(withScreen(state, { name: 'list' })),
      });
    case 'map':
      return renderRouteMap(state, new Map(openedRoutes), DEFAULT_MAP_PROVIDER, {
        onOpenRoute: handleOpenRoute,
        onBack: () => setState(withScreen(state, { name: 'order' })),
        onChooseStops: () => setState(withScreen(state, { name: 'list' })),
      });
    case 'settings':
      return renderSettings(state, {
        onExport: handleExport,
        onImport: (file, mode) => {
          void handleImport(file, mode);
        },
        onBack: () => setState(withScreen(state, { name: 'list' })),
      });
  }
}

/**
 * 画面全体を作り直すため、そのままでは検索欄に1文字打つたびに
 * フォーカスが外れる。描画の前後でフォーカス位置を引き継ぐ。
 */
function render(): void {
  const active = document.activeElement;
  const testid = active instanceof HTMLElement ? active.dataset.testid : undefined;
  const rowId = active instanceof HTMLElement ? active.dataset.id : undefined;
  const caret = active instanceof HTMLInputElement ? active.selectionStart : null;

  root!.replaceChildren(renderScreen());
  syncSession();

  if (testid === undefined) {
    return;
  }
  const selector =
    rowId === undefined
      ? `[data-testid="${testid}"]`
      : `[data-testid="${testid}"][data-id="${rowId}"]`;
  const restored = root!.querySelector<HTMLElement>(selector);
  if (!restored) {
    return;
  }
  restored.focus();
  if (restored instanceof HTMLInputElement && restored.type === 'text' && caret !== null) {
    restored.setSelectionRange(caret, caret);
  }
}

render();
void reloadPatients();
