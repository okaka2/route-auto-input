import './styles.css';
import { parseBackup, serializeBackup } from './backup';
import { MAX_STOPS_PER_ROUTE } from './config';
import { deletePatient, listPatients, mergePatients, replaceAllPatients, savePatient } from './db';
import { downloadTextFile, readTextFile } from './fileIo';
import { buildGoogleMapsUrl } from './googleMapsUrl';
import { openUrl } from './openRoute';
import { createPatient, updatePatientFields } from './patient';
import { splitIntoRoutes } from './routeSplitter';
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
import { renderPatientForm } from './views/patientFormView';
import { renderPatientList } from './views/patientListView';
import { renderRouteOrder } from './views/routeOrderView';
import { renderSettings } from './views/settingsView';

const root = document.querySelector<HTMLDivElement>('#app');
if (!root) {
  throw new Error('#app が見つかりません。');
}

let state: AppState = createInitialState([]);
const openedRouteIndexes = new Set<number>();

function setState(next: AppState): void {
  state = next;
  render();
}

async function reloadPatients(message: Message | null = null): Promise<void> {
  try {
    const patients = await listPatients();
    setState({ ...withPatients(state, patients), message });
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
  const validation = validatePatientInput(name, address);
  if (!validation.ok) {
    setState(withMessage(state, { kind: 'error', text: validation.message }));
    return;
  }
  try {
    const existing = currentEditingPatient();
    const patient =
      existing === null ? createPatient(name, address) : updatePatientFields(existing, name, address);
    await savePatient(patient);
    setState(withScreen(state, { name: 'list' }));
    await reloadPatients({ kind: 'info', text: '保存しました。' });
  } catch {
    setState(withMessage(state, { kind: 'error', text: 'データを保存できませんでした。' }));
  }
}

async function handleDelete(id: string): Promise<void> {
  const patient = state.patients.find((item) => item.id === id);
  if (!patient) {
    return;
  }
  if (!window.confirm(`${patient.name} を削除します。よろしいですか?`)) {
    return;
  }
  try {
    await deletePatient(id);
    await reloadPatients({ kind: 'info', text: '削除しました。' });
  } catch {
    setState(withMessage(state, { kind: 'error', text: 'データを削除できませんでした。' }));
  }
}

function handleOpenRoute(routeIndex: number): void {
  const routes = splitIntoRoutes(selectedPatients(state), MAX_STOPS_PER_ROUTE);
  const route = routes[routeIndex];
  if (!route) {
    return;
  }
  try {
    const url = buildGoogleMapsUrl(route.map((patient) => patient.address));
    openedRouteIndexes.add(routeIndex);
    render();
    openUrl(url);
  } catch (error) {
    setState(withMessage(state, { kind: 'error', text: (error as Error).message }));
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
    setState(withMessage(state, { kind: 'error', text: (error as Error).message }));
  }
}

function renderScreen(): HTMLElement {
  switch (state.screen.name) {
    case 'list':
      return renderPatientList(state, {
        onSearch: (query) => setState(setSearchQuery(state, query)),
        onToggleSelect: (id) => setState(toggleSelection(state, id)),
        onNew: () => setState(withScreen(state, { name: 'form', patientId: null })),
        onEdit: (id) => setState(withScreen(state, { name: 'form', patientId: id })),
        onDelete: (id) => {
          void handleDelete(id);
        },
        onNext: () => {
          const validation = validateSelection(state.selectedIds.length);
          if (!validation.ok) {
            setState(withMessage(state, { kind: 'error', text: validation.message }));
            return;
          }
          openedRouteIndexes.clear();
          setState(withScreen(state, { name: 'order' }));
        },
        onOpenSettings: () => setState(withScreen(state, { name: 'settings' })),
      });
    case 'form':
      return renderPatientForm(currentEditingPatient(), state.message, {
        onSave: (name, address) => {
          void handleSave(name, address);
        },
        onCancel: () => setState(withScreen(state, { name: 'list' })),
      });
    case 'order':
      return renderRouteOrder(state, openedRouteIndexes, {
        onMove: (id, direction) => setState(moveSelected(state, id, direction)),
        onOpenRoute: handleOpenRoute,
        onBack: () => setState(withScreen(state, { name: 'list' })),
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
  const caret = active instanceof HTMLInputElement ? active.selectionStart : null;

  root!.replaceChildren(renderScreen());

  if (testid === undefined) {
    return;
  }
  const restored = root!.querySelector<HTMLElement>(`[data-testid="${testid}"]`);
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
