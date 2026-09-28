import { describe, expect, it } from 'vitest';
import { MAX_SELECTION } from '../src/config';
import { mergeConfirmText, mergeDoneText, mergeNothingText } from '../src/backup';
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
import type {
  AppState,
  BackupSaveDialog,
  LocationDialog,
  Patient,
  Spot,
  SpotDialog,
  TransferReceiveDialog,
  TransferSendDialog,
} from '../src/types';
import { validatePatientInput, validateSelection } from '../src/validation';
import { googleMapsProvider } from '../src/mapProviders';
import type { HistoryEntry } from '../src/db';
import { renderDialog } from '../src/views/dialogs';
import { renderHistory } from '../src/views/historyView';
import { renderNotice } from '../src/views/notice';
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
  onSendSelected: noop,
  onRequestDeleteSelected: noop,
  onMoveToTop: noop,
  onMoveToBottom: noop,
  onSaveAnyway: noop,
  onOpenExisting: noop,
  onOpenLocation: noop,
  onOpenSend: noop,
  onStartMeasuring: noop,
  onSaveMeasured: noop,
  onPasteChange: noop,
  onPasteToggle: noop,
  onSavePasted: noop,
  onRemove: noop,
  onUndo: noop,
  onSpotDraft: noop,
  onComposingChange: noop,
  onSaveSpot: noop,
  onPhotoIndex: noop,
  onSendDraft: noop,
  onSubmit: noop,
  onSendShare: noop,
  onSendSave: noop,
  onReceivePassword: noop,
  onReceiveSubmit: noop,
  onReceiveConfirm: noop,
  onReceiveConflict: noop,
  onSaveExport: noop,
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
      createInitialState([
        {
          ...places(1)[0]!,
          location: { lat: 35, lng: 139, accuracy: 12, recordedAt: '2026-09-22T00:00:00.000Z', source: 'gps' as const },
        },
      ]),
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
            input: {
              name: patients[0]!.name,
              address: patients[0]!.address,
              phone: '',
              parkingType: '' as const,
              permitExpires: '',
              note: '',
            },
            matchIds: [patients[0]!.id],
            continueAfter: false,
          },
        },
        dialogHandlers,
      )!.outerHTML,
    );
  });

  it('登録・編集フォーム: 新規・編集・下書き・メッセージ', () => {
    const handlers = { onSave: noop, onSaveAndContinue: noop, onCancel: noop, onAddPhoto: noop, onDeletePhoto: noop };
    const patient = createPatient('場所1', '東京都1-1');
    expectClean('新規', renderPatientForm(null, null, null, handlers).outerHTML);
    expectClean('編集', renderPatientForm(patient, null, null, handlers).outerHTML);
    expectClean('編集(写真あり)', renderPatientForm(patient, null, null, handlers, [{ id: 'p1', url: 'blob:x' }]).outerHTML);
    expectClean(
      '下書き',
      renderPatientForm(
        null,
        { name: 'a', address: 'b', phone: '', parkingType: '', permitExpires: '', note: '' },
        null,
        handlers,
      ).outerHTML,
    );
    expectClean(
      'メッセージ',
      renderPatientForm(null, null, { kind: 'error', text: 'x' }, handlers).outerHTML,
    );
    expectClean(
      '駐車情報とメモを入れた状態',
      renderPatientForm(
        null,
        {
          name: 'a',
          address: 'b',
          phone: '',
          parkingType: 'street_permit',
          permitExpires: '2027-03-31',
          note: '駐車場: 北側\n入口: 裏口',
        },
        null,
        handlers,
      ).outerHTML,
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
    const handlers = {
      onOpenRoute: noop,
      onBack: noop,
      onChooseStops: noop,
      onShare: noop,
      onCopyLink: noop,
      onToggleVisited: noop,
      onOpenLocation: noop,
      onOpenPhotos: noop,
      onAddSpot: noop,
    };
    const at = new Date(2026, 8, 21, 14, 32).toISOString();
    const withLocation = {
      ...places(1)[0]!,
      location: { lat: 35, lng: 139, accuracy: 12, recordedAt: '2026-09-22T00:00:00.000Z', source: 'gps' as const },
    };
    // 「位置あり」のすぐ近くに置く、近くのお役立ち地点(節の文言もここで調べる)。
    const spots: Spot[] = [
      {
        id: 'spot-1',
        kind: 'toilet',
        note: 'きれいなトイレ',
        location: { lat: 35, lng: 139.001, accuracy: 10, recordedAt: '2026-09-22T00:00:00.000Z', source: 'gps' },
        createdAt: '2026-09-22T00:00:00.000Z',
      },
    ];
    for (const [label, state, opened] of [
      ['0件', createInitialState([]), new Map<number, string>()],
      ['1本', selected(places(3)), new Map<number, string>()],
      ['分割', selected(places(12)), new Map<number, string>()],
      ['開いた後', selected(places(12)), new Map<number, string>([[0, at]])],
      ['位置あり', selected([withLocation]), new Map<number, string>()],
      [
        '駐車情報とメモあり',
        selected([{ ...places(1)[0]!, parking: { type: 'street_permit' as const, permitExpires: '2027-03-31' }, note: '駐車場: 北側\n入口: 裏口' }]),
        new Map<number, string>(),
      ],
    ] as const) {
      for (const [ctxLabel, context] of [
        ['事業所なし', noOfficeContext],
        ['事業所あり', officeContext],
      ] as const) {
        expectClean(
          `地図(${label}・${ctxLabel})`,
          renderRouteMap(state, opened, googleMapsProvider, context, new Map(), new Map(), spots, handlers).outerHTML,
        );
        // お役立ち地点が1件も無い(spots: [])ときの文言も調べる(見出しが「お役立ち地点」になる)。
        expectClean(
          `地図(${label}・${ctxLabel}・地点なし)`,
          renderRouteMap(state, opened, googleMapsProvider, context, new Map(), new Map(), [], handlers).outerHTML,
        );
      }
    }
  });

  it('設定・タブ・選択バー', () => {
    const spot: Spot = {
      id: 'spot-1',
      kind: 'toilet',
      note: 'きれいなトイレ',
      location: { lat: 35, lng: 139, accuracy: 10, recordedAt: '2026-09-22T00:00:00.000Z', source: 'gps' },
      createdAt: '2026-09-22T00:00:00.000Z',
    };
    const settingsHandlers = {
      onExport: noop,
      onIncludePhotosChange: noop,
      onImport: noop,
      onThemeChange: noop,
      onBack: noop,
      onSaveOffice: noop,
      onClearOffice: noop,
      onClearHistory: noop,
      onDeleteSpot: noop,
      onSendSpots: noop,
      onSharedSecretDraftChange: noop,
      onSharedSecretSave: noop,
      onSharedSecretChange: noop,
      onSharedSecretClear: noop,
      onSharedSecretCancel: noop,
    };
    expectClean(
      '設定(地点あり)',
      renderSettings(
        createInitialState(places(2)),
        {
          lastBackupAt: null,
          persisted: null,
          theme: 'auto',
          office: null,
          spots: [spot],
          photoBytes: 0,
          includePhotos: true,
          hasSharedSecret: false,
          sharedSecretShort: false,
          sharedSecretDraft: '',
          sharedSecretEditing: false,
        },
        settingsHandlers,
      ).outerHTML,
    );
    expectClean(
      '設定(地点なし)',
      renderSettings(
        createInitialState(places(2)),
        {
          lastBackupAt: null,
          persisted: null,
          theme: 'auto',
          office: null,
          spots: [],
          photoBytes: 0,
          includePhotos: true,
          hasSharedSecret: false,
          sharedSecretShort: false,
          sharedSecretDraft: '',
          sharedSecretEditing: false,
        },
        settingsHandlers,
      ).outerHTML,
    );
    // 事業所の合言葉: 未設定・設定済み(表示のみ)・設定済み(短い)・設定済み(「変える」で編集中)の4状態。
    expectClean(
      '設定(合言葉: 設定済み)',
      renderSettings(
        createInitialState([]),
        {
          lastBackupAt: null,
          persisted: null,
          theme: 'auto',
          office: null,
          spots: [],
          photoBytes: 0,
          includePhotos: true,
          hasSharedSecret: true,
          sharedSecretShort: false,
          sharedSecretDraft: '',
          sharedSecretEditing: false,
        },
        settingsHandlers,
      ).outerHTML,
    );
    expectClean(
      '設定(合言葉: 短い)',
      renderSettings(
        createInitialState([]),
        {
          lastBackupAt: null,
          persisted: null,
          theme: 'auto',
          office: null,
          spots: [],
          photoBytes: 0,
          includePhotos: true,
          hasSharedSecret: true,
          sharedSecretShort: true,
          sharedSecretDraft: '',
          sharedSecretEditing: false,
        },
        settingsHandlers,
      ).outerHTML,
    );
    expectClean(
      '設定(合言葉: 編集中)',
      renderSettings(
        createInitialState([]),
        {
          lastBackupAt: null,
          persisted: null,
          theme: 'auto',
          office: null,
          spots: [],
          photoBytes: 0,
          includePhotos: true,
          hasSharedSecret: true,
          sharedSecretShort: false,
          sharedSecretDraft: 'ひみつ',
          sharedSecretEditing: true,
        },
        settingsHandlers,
      ).outerHTML,
    );
    expectClean('タブ', renderTabBar('list', true, { onSelect: noop }).outerHTML);
    expectClean(
      '選択バー',
      renderSelectionBar(3, { onNext: noop, onShowSelected: noop, onOpenMenu: noop })!.outerHTML,
    );
    const selectionMenuState = selected(places(3));
    expectClean(
      '選択バーの「⋯」の小窓',
      renderDialog({ ...selectionMenuState, dialog: { kind: 'selectionMenu' } }, dialogHandlers)!.outerHTML,
    );
  });

  it('許可証の期限のお知らせ', () => {
    expectClean(
      '許可証の期限のお知らせ',
      renderNotice({
        testid: 'permit-notice',
        text: '許可証の期限が近い訪問先: 2件。期限を確かめてください。',
        actions: [{ label: '閉じる', testid: 'notice-permit-dismiss', onClick: noop }],
      }).outerHTML,
    );
  });

  it('Safariのデータをホーム画面のアプリへ読み込む案内', () => {
    expectClean(
      'Safariのデータをホーム画面のアプリへ読み込む案内',
      renderNotice({
        testid: 'moved-data-notice',
        text: 'Safari で使っていた場合は、書き出したバックアップのファイルを読み込むと、今までの訪問先が入ります。',
        actions: [
          { label: '読み込む画面へ', testid: 'notice-moved-import', primary: true, onClick: noop },
          { label: '閉じる', testid: 'notice-moved-dismiss', onClick: noop },
        ],
      }).outerHTML,
    );
  });

  it('選択の「元に戻す」の知らせ(全解除・先週と同じ・履歴から選ぶ)', () => {
    expectClean(
      '選択の元に戻す(全解除)',
      renderNotice({
        testid: 'undo-notice',
        text: '選択を外しました',
        actions: [{ label: '元に戻す', testid: 'undo-button', primary: true, onClick: noop }],
      }).outerHTML,
    );
    expectClean(
      '選択の元に戻す(置き換え)',
      renderNotice({
        testid: 'undo-notice',
        text: '選択を置き換えました',
        actions: [{ label: '元に戻す', testid: 'undo-button', primary: true, onClick: noop }],
      }).outerHTML,
    );
    const handlers = { onMove: noop, onOpenStopMenu: noop, onAddStops: noop, onOpenMap: noop, onBack: noop, onEndsChange: noop };
    expectClean(
      '訪問順(元に戻すの知らせつき)',
      renderRouteOrder(selected(places(2)), noOfficeContext, handlers, {
        testid: 'undo-notice',
        text: '選択を置き換えました',
        actions: [{ label: '元に戻す', testid: 'undo-button', primary: true, onClick: noop }],
      }).outerHTML,
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

  it('位置の登録ダイアログ: 全phase、未登録/登録済み', () => {
    const unregistered = places(1)[0]!;
    const registered = {
      ...places(1)[0]!,
      location: { lat: 35, lng: 139, accuracy: 12, recordedAt: '2026-09-22T00:00:00.000Z', source: 'gps' as const },
    };
    const base = (phase: LocationDialog): AppState => ({
      ...createInitialState([unregistered, registered]),
      dialog: phase,
    });
    const withoutPasteOpen: Omit<LocationDialog, 'pasteOpen'>[] = [
      { kind: 'location', id: unregistered.id, phase: 'idle', best: null, error: null, pasteText: '', pasteError: null, previous: null },
      { kind: 'location', id: registered.id, phase: 'idle', best: null, error: null, pasteText: '', pasteError: null, previous: null },
      {
        kind: 'location',
        id: unregistered.id,
        phase: 'measuring',
        best: { lat: 35, lng: 139, accuracy: 12 },
        error: null,
        pasteText: '',
        pasteError: null,
        previous: null,
      },
      {
        kind: 'location',
        id: unregistered.id,
        phase: 'measuring',
        best: { lat: 35, lng: 139, accuracy: 60 },
        error: null,
        pasteText: '',
        pasteError: null,
        previous: null,
      },
      {
        kind: 'location',
        id: registered.id,
        phase: 'measured',
        best: { lat: 35, lng: 139, accuracy: 12 },
        error: null,
        pasteText: '',
        pasteError: null,
        previous: null,
      },
      {
        kind: 'location',
        id: unregistered.id,
        phase: 'error',
        best: null,
        error: '位置を取得できませんでした。車の外や屋外で、もう一度試してください。',
        pasteText: '',
        pasteError: '座標またはGoogleマップのURLを読み取れませんでした。',
        previous: null,
      },
      {
        kind: 'location',
        id: registered.id,
        phase: 'saved',
        best: null,
        error: null,
        pasteText: '',
        pasteError: null,
        previous: null,
      },
    ];
    const phases: LocationDialog[] = withoutPasteOpen.map((p) => ({ ...p, pasteOpen: false }));
    phases.forEach((phase, index) => {
      expectClean(`位置の登録#${index}`, renderDialog(base(phase), dialogHandlers)!.outerHTML);
    });
  });

  it('お役立ち地点の登録ダイアログ: 全phase', () => {
    const withState = (dialog: SpotDialog): AppState => ({ ...createInitialState([]), dialog });
    const spotPhases: SpotDialog[] = [
      { kind: 'spot', phase: 'idle', best: null, error: null, spotKind: 'toilet', note: '' },
      { kind: 'spot', phase: 'measuring', best: { lat: 35, lng: 139, accuracy: 12 }, error: null, spotKind: 'rest', note: '24時間開いている' },
      { kind: 'spot', phase: 'measured', best: { lat: 35, lng: 139, accuracy: 12 }, error: null, spotKind: 'store', note: '' },
      {
        kind: 'spot',
        phase: 'error',
        best: null,
        error: '位置を取得できませんでした。車の外や屋外で、もう一度試してください。',
        spotKind: 'parking',
        note: '',
      },
      { kind: 'spot', phase: 'saved', best: null, error: null, spotKind: 'other', note: '' },
    ];
    spotPhases.forEach((phase, index) => {
      expectClean(`お役立ち地点の登録#${index}`, renderDialog(withState(phase), dialogHandlers)!.outerHTML);
    });
  });

  it('送るダイアログ: 全phase・地点だけ/訪問先あり・写真候補あり/なし・合言葉あり/なし', () => {
    const patients = places(2);
    const withDialog = (dialog: TransferSendDialog): AppState => ({ ...createInitialState(patients), dialog });
    const base = (overrides: Partial<TransferSendDialog> = {}): TransferSendDialog => ({
      kind: 'transferSend',
      patientIds: [patients[0]!.id],
      includePhotos: true,
      includeSpots: false,
      useSharedSecret: false,
      password: '',
      passwordConfirm: '',
      saveAsShared: false,
      phase: 'form',
      error: null,
      canShare: false,
      shared: false,
      ...overrides,
    });
    const cases: [
      string,
      TransferSendDialog,
      { photoCounts?: Map<string, number>; spotCount?: number; hasSharedSecret?: boolean },
    ][] = [
      ['通常', base(), {}],
      ['写真候補あり', base(), { photoCounts: new Map([[patients[0]!.id, 1]]) }],
      ['地点あり(訪問先を送る)', base(), { spotCount: 2 }],
      ['合言葉あり(オン)', base({ useSharedSecret: true }), { hasSharedSecret: true }],
      ['合言葉ありだがオフ', base({ useSharedSecret: false }), { hasSharedSecret: true }],
      ['地点だけを送る', base({ patientIds: [], includeSpots: true }), {}],
      ['送信中', base({ phase: 'working' }), {}],
      ['ファイルができた(共有できる)', base({ phase: 'ready', canShare: true }), {}],
      ['ファイルができた(共有できない)', base({ phase: 'ready', canShare: false }), {}],
      ['完了(共有できた)', base({ phase: 'done', shared: true }), {}],
      ['完了(保存した)', base({ phase: 'done', shared: false }), {}],
      ['エラーあり', base({ error: 'パスワードは10文字以上にしてください。' }), {}],
      ['合言葉が短い', base({ error: '事業所の合言葉が短いので、10文字以上に変えてください。' }), { hasSharedSecret: true }],
    ];
    for (const [label, dialog, extra] of cases) {
      expectClean(`送るダイアログ(${label})`, renderDialog(withDialog(dialog), dialogHandlers, extra)!.outerHTML);
    }
  });

  it('受け取りのダイアログ: 全phase・エラーの文・結果の文', () => {
    const patients = places(2);
    const base = (overrides: Partial<TransferReceiveDialog> = {}): TransferReceiveDialog => ({
      kind: 'transferReceive',
      fileText: '{}',
      phase: 'password',
      password: '',
      error: null,
      summary: '',
      conflictIndex: 0,
      conflicts: [],
      result: null,
      ...overrides,
    });
    const conflicts = [
      { incomingName: '場所1', incomingAddress: '東京都1-1', existingName: '場所1', existingAddress: '東京都1-1' },
      { incomingName: '場所2', incomingAddress: '東京都2-1', existingName: '場所2', existingAddress: '東京都2-1' },
    ];
    const cases: [string, TransferReceiveDialog][] = [
      ['パスワード', base()],
      ['パスワード(空)', base({ error: 'パスワードを入れてください。' })],
      ['パスワード違い', base({ error: 'パスワードが違うか、ファイルが壊れています。何度でもやり直せます。' })],
      ['中身を読めない', base({ error: '引き継ぎのファイルの中身を読めませんでした。' })],
      ['形が読めない(新しい版など)', base({ error: '引き継ぎのファイルではないか、新しい版のアプリで作られています。' })],
      ['受け取りのコードを読み込めない', base({ error: '引き継ぎのファイルを開けませんでした。' })],
      ['写真が壊れている', base({ error: '引き継ぎのファイルの写真が壊れています。' })],
      ['追加するものがない', base({ error: 'このファイルには追加するものがありません。' })],
      ['確認', base({ phase: 'confirm', summary: '場所1様ほか1人・お役立ち地点1件' })],
      ['同じ人(1/2)', base({ phase: 'conflict', conflicts, conflictIndex: 0 })],
      ['同じ人(2/2)', base({ phase: 'conflict', conflicts, conflictIndex: 1 })],
      ['処理中', base({ phase: 'working' })],
      ['完了', base({ phase: 'done', result: '1人とお役立ち地点1件を追加し、1人を上書きしました。' })],
      ['完了(何もなし)', base({ phase: 'done', result: '追加したものはありません。' })],
      ['完了(失敗)', base({ phase: 'done', error: '取り込めませんでした。' })],
    ];
    for (const [label, dialog] of cases) {
      expectClean(
        `受け取りのダイアログ(${label})`,
        renderDialog({ ...createInitialState(patients), dialog }, dialogHandlers)!.outerHTML,
      );
    }
  });

  it('バックアップの保存ダイアログ: ready(共有できる/できない)・done(共有した/ダウンロードした)', () => {
    const base = (overrides: Partial<BackupSaveDialog> = {}): BackupSaveDialog => ({
      kind: 'backupSave',
      phase: 'ready',
      fileName: 'route-auto-input-2026-09-28.json',
      canShare: true,
      result: null,
      ...overrides,
    });
    const cases: [string, BackupSaveDialog][] = [
      ['ready・共有できる', base()],
      ['ready・共有できない', base({ canShare: false })],
      ['done・共有した', base({ phase: 'done', result: 'shared' })],
      ['done・ダウンロードした', base({ phase: 'done', result: 'downloaded' })],
    ];
    for (const [label, dialog] of cases) {
      expectClean(
        `バックアップの保存ダイアログ(${label})`,
        renderDialog({ ...createInitialState([]), dialog }, dialogHandlers)!.outerHTML,
      );
    }
  });

  it('バックアップの処理を読み込めなかったときの文言', () => {
    expectClean('バックアップの処理の読み込み失敗', 'バックアップの処理を読み込めませんでした。');
  });

  it('送受信の処理を読み込めなかったときの文言', () => {
    expectClean('送受信の処理の読み込み失敗', '送受信の処理を読み込めませんでした。');
  });

  it('バックアップの「今のデータに追加する」の文言', () => {
    expectClean('追加の確認(手元にいる人あり)', mergeConfirmText(2, 1));
    expectClean('追加の確認(手元にいる人なし)', mergeConfirmText(2, 0));
    expectClean('追加なしの知らせ(手元にいる人あり)', mergeNothingText(1));
    expectClean('追加なしの知らせ(手元にいる人なし)', mergeNothingText(0));
    expectClean('追加の完了', mergeDoneText(2, 0));
    expectClean('追加の完了(地点あり)', mergeDoneText(2, 3));
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
