import { describe, expect, it } from 'vitest';
import { MAX_SELECTION } from '../src/config';
import { createPatient } from '../src/patient';
import { DEFAULT_ROUTE_ENDS, type RouteContext } from '../src/routePlan';
import {
  createInitialState,
  openDeleteConfirm,
  openDeleteSelectedConfirm,
  openRowMenu,
  setSearchQuery,
  toggleSelection,
} from '../src/state';
import type { AppState, Patient } from '../src/types';
import { validatePatientInput, validateSelection } from '../src/validation';
import { googleMapsProvider } from '../src/mapProviders';
import type { HistoryEntry } from '../src/db';
import { renderDialog } from '../src/views/dialogs';
import { renderHistory } from '../src/views/historyView';
import { renderPatientForm } from '../src/views/patientFormView';
import { renderPatientList } from '../src/views/patientListView';
import { renderRouteMap } from '../src/views/routeMapView';
import { renderRouteOrder } from '../src/views/routeOrderView';
import { renderSelectionBar } from '../src/views/selectionBar';
import { renderSettings } from '../src/views/settingsView';
import { renderTabBar } from '../src/views/tabBar';

// 画面に出してはいけない、業種特有の表現と、以前のアプリ名。
const FORBIDDEN = ['患者', '薬局', '在宅', '医療', '利用者', 'ルート自動入力'];

function expectClean(label: string, text: string): void {
  for (const word of FORBIDDEN) {
    expect(text, `${label} に「${word}」が含まれている`).not.toContain(word);
  }
}

const noop = () => undefined;
const listHandlers = {
  onSearch: noop,
  onClearSearch: noop,
  onToggleSelect: noop,
  onSortChange: noop,
  onToggleSelectAll: noop,
  onNew: noop,
  onOpenMenu: noop,
  onOpenSettings: noop,
  onFilterChange: noop,
  onSearchAll: noop,
  onOpenHistory: noop,
  onPickLastWeek: noop,
};
const dialogHandlers = {
  onEdit: noop,
  onDuplicate: noop,
  onRequestDelete: noop,
  onConfirmDelete: noop,
  onConfirmDeleteSelected: noop,
  onMoveToTop: noop,
  onMoveToBottom: noop,
  onSaveAnyway: noop,
  onOpenExisting: noop,
  onClose: noop,
};

function places(count: number): Patient[] {
  return Array.from({ length: count }, (_, i) => createPatient(`場所${i + 1}`, `東京都${i + 1}-1`));
}

function selected(patients: Patient[]): AppState {
  return { ...createInitialState(patients), selectedIds: patients.map((p) => p.id) };
}

describe('画面の文言(禁止語が出ない)', () => {
  it('一覧: 空・通常・選択・検索なし・上限・メッセージ・検索語あり', () => {
    const many = places(MAX_SELECTION + 1);
    let atLimit = createInitialState(many);
    for (const place of many.slice(0, MAX_SELECTION)) {
      atLimit = toggleSelection(atLimit, place.id);
    }
    const states: AppState[] = [
      createInitialState([]),
      createInitialState(places(3)),
      toggleSelection(createInitialState(places(3)), places(3)[0]!.id),
      setSearchQuery(createInitialState(places(3)), 'どこにもない'),
      setSearchQuery(createInitialState(places(3)), '場所'),
      atLimit,
      { ...createInitialState(places(1)), message: { kind: 'error', text: 'x' } },
    ];
    states.forEach((state, index) => {
      expectClean(`一覧#${index}`, renderPatientList(state, listHandlers).outerHTML);
    });
  });

  it('ダイアログ: 「⋯」メニュー・削除の確認・一括削除の確認', () => {
    const patients = places(2);
    const base = createInitialState(patients);
    expectClean('メニュー', renderDialog(openRowMenu(base, patients[0]!.id), dialogHandlers)!.outerHTML);
    expectClean('削除の確認', renderDialog(openDeleteConfirm(base, patients[0]!.id), dialogHandlers)!.outerHTML);
    const twoSelected = { ...base, selectedIds: patients.map((p) => p.id) };
    expectClean(
      '一括削除の確認',
      renderDialog(openDeleteSelectedConfirm(twoSelected), dialogHandlers)!.outerHTML,
    );
    expectClean(
      'ホーム画面への追加の手順',
      renderDialog({ ...base, dialog: { kind: 'installSteps' } }, dialogHandlers)!.outerHTML,
    );
    expectClean(
      '訪問順の「⋯」',
      renderDialog(
        { ...base, dialog: { kind: 'stopMenu', id: patients[0]!.id } },
        dialogHandlers,
      )!.outerHTML,
    );
    expectClean(
      '同じ人の知らせ',
      renderDialog(
        {
          ...base,
          dialog: {
            kind: 'similar',
            input: { name: patients[0]!.name, address: patients[0]!.address, phone: '' },
            matchIds: [patients[0]!.id],
            continueAfter: false,
          },
        },
        dialogHandlers,
      )!.outerHTML,
    );
  });

  it('登録・編集フォーム: 新規・編集・下書き・メッセージ', () => {
    const handlers = { onSave: noop, onSaveAndContinue: noop, onCancel: noop };
    const patient = createPatient('場所1', '東京都1-1');
    expectClean('新規', renderPatientForm(null, null, null, handlers).outerHTML);
    expectClean('編集', renderPatientForm(patient, null, null, handlers).outerHTML);
    expectClean(
      '下書き',
      renderPatientForm(null, { name: 'a', address: 'b', phone: '' }, null, handlers).outerHTML,
    );
    expectClean(
      'メッセージ',
      renderPatientForm(null, null, { kind: 'error', text: 'x' }, handlers).outerHTML,
    );
  });

  const noOfficeContext: RouteContext = { ends: DEFAULT_ROUTE_ENDS, office: null };
  const officeContext: RouteContext = {
    ends: { start: 'office', end: 'office' },
    office: { name: '本店', address: '東京都1' },
  };

  it('訪問順: 0件・1件・複数件・同じ住所(事業所あり/なし)', () => {
    const handlers = { onMove: noop, onOpenStopMenu: noop, onAddStops: noop, onOpenMap: noop, onBack: noop, onEndsChange: noop };
    const same = places(2).map((place) => ({ ...place, address: '東京都1-1' }));
    for (const [label, state] of [
      ['0件', createInitialState([])],
      ['1件', selected(places(1))],
      ['3件', selected(places(3))],
      ['同じ住所', selected(same)],
    ] as const) {
      for (const [ctxLabel, context] of [
        ['事業所なし', noOfficeContext],
        ['事業所あり', officeContext],
      ] as const) {
        expectClean(`訪問順(${label}・${ctxLabel})`, renderRouteOrder(state, context, handlers).outerHTML);
      }
    }
  });

  it('地図: 0件・1本・分割・開いた後(事業所あり/なし)', () => {
    const handlers = { onOpenRoute: noop, onBack: noop, onChooseStops: noop, onShare: noop, onCopyLink: noop };
    const at = new Date(2026, 8, 21, 14, 32).toISOString();
    for (const [label, state, opened] of [
      ['0件', createInitialState([]), new Map<number, string>()],
      ['1本', selected(places(3)), new Map<number, string>()],
      ['分割', selected(places(12)), new Map<number, string>()],
      ['開いた後', selected(places(12)), new Map<number, string>([[0, at]])],
    ] as const) {
      for (const [ctxLabel, context] of [
        ['事業所なし', noOfficeContext],
        ['事業所あり', officeContext],
      ] as const) {
        expectClean(
          `地図(${label}・${ctxLabel})`,
          renderRouteMap(state, opened, googleMapsProvider, context, handlers).outerHTML,
        );
      }
    }
  });

  it('設定・タブ・選択バー', () => {
    expectClean(
      '設定',
      renderSettings(
        createInitialState(places(2)),
        { lastBackupAt: null, persisted: null, theme: 'auto', office: null },
        { onExport: noop, onImport: noop, onThemeChange: noop, onBack: noop, onSaveOffice: noop, onClearOffice: noop },
      ).outerHTML,
    );
    expectClean('タブ', renderTabBar('list', true, { onSelect: noop }).outerHTML);
    expectClean(
      '選択バー',
      renderSelectionBar(3, { onNext: noop, onDeleteSelected: noop, onShowSelected: noop })!.outerHTML,
    );
  });

  it('履歴: 記録なし・1件閉じている・1件開いている(名簿にない人あり)', () => {
    const historyHandlers = {
      onOpenEntry: noop,
      onFilterWeekday: noop,
      onPick: noop,
      onCopyVisits: noop,
      onBack: noop,
    };
    const patient = createPatient('場所1', '東京都1-1');
    const entry: HistoryEntry = {
      date: '2026-09-22',
      ids: [patient.id, 'gone'],
      routeEnds: DEFAULT_ROUTE_ENDS,
      visited: {},
    };
    const baseState = createInitialState([patient]);
    const noneState = { ...baseState, screen: { name: 'history' as const, openDate: null, weekday: null } };
    const closedState = { ...baseState, screen: { name: 'history' as const, openDate: null, weekday: null } };
    const openState = { ...baseState, screen: { name: 'history' as const, openDate: '2026-09-22', weekday: null } };
    expectClean('履歴(記録なし)', renderHistory(noneState, [], historyHandlers).outerHTML);
    expectClean('履歴(閉じている)', renderHistory(closedState, [entry], historyHandlers).outerHTML);
    expectClean('履歴(開いている)', renderHistory(openState, [entry], historyHandlers).outerHTML);
  });

  it('検証メッセージ', () => {
    for (const result of [
      validatePatientInput('', 'x'),
      validatePatientInput('x', ''),
      validateSelection(0),
      validateSelection(MAX_SELECTION + 1),
    ]) {
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expectClean('検証メッセージ', result.message);
      }
    }
  });
});

describe('ソースコード中の文字列(禁止語が出ない)', () => {
  // src 配下の全ての .ts を、文字列として読む。コメントは除いて、文字列リテラルだけを調べる。
  const sources = import.meta.glob('../src/**/*.ts', {
    query: '?raw',
    import: 'default',
    eager: true,
  }) as Record<string, string>;

  function stringLiterals(source: string): string[] {
    const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const pattern = /'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g;
    return withoutComments.match(pattern) ?? [];
  }

  it('画面に出る文字列に、禁止語を使っていない', () => {
    const entries = Object.entries(sources);
    expect(entries.length).toBeGreaterThan(10);
    for (const [path, source] of entries) {
      for (const literal of stringLiterals(source)) {
        expectClean(`${path} の文字列 ${literal}`, literal);
      }
    }
  });
});
