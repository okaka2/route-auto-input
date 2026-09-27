import { describe, expect, it, vi } from 'vitest';
import { googleMapsProvider } from '../src/mapProviders';
import { createPatient } from '../src/patient';
import { DEFAULT_ROUTE_ENDS, type RouteContext } from '../src/routePlan';
import { NEARBY_METERS, SPOT_KINDS, nearbySpots, spotLabel } from '../src/spots';
import { createInitialState } from '../src/state';
import type { AppState, Patient, Spot, SpotDialog } from '../src/types';
import { renderDialog, type DialogHandlers } from '../src/views/dialogs';
import { renderRouteMap, type RouteMapHandlers } from '../src/views/routeMapView';
import { renderSettings, type SettingsHandlers, type SettingsInfo } from '../src/views/settingsView';

function spot(overrides: Partial<Spot> = {}): Spot {
  return {
    id: 'spot-1',
    kind: 'toilet',
    note: '',
    location: { lat: 35, lng: 139, accuracy: 10, recordedAt: '2026-09-25T00:00:00.000Z', source: 'gps' },
    createdAt: '2026-09-25T00:00:00.000Z',
    ...overrides,
  };
}

// geoPoint.ts の distanceMeters と同じ地球半径(ハバースイン)を使い、指定のメートルぶん
// 真北にずらした緯度を作る(経度は変えないので、distanceMetersの結果がほぼ指定どおりのメートルになる)。
const EARTH_RADIUS_M = 6_371_000;
function north(lat: number, meters: number): number {
  return lat + ((meters / EARTH_RADIUS_M) * 180) / Math.PI;
}

describe('spotLabel', () => {
  it('SPOT_KINDSのラベルを返す', () => {
    for (const entry of SPOT_KINDS) {
      expect(spotLabel(entry.value)).toBe(entry.label);
    }
  });
});

describe('nearbySpots', () => {
  it('500m以内だけを返す', () => {
    const near = spot({ id: 'near', location: { ...spot().location, lat: north(35, 100) } });
    const far = spot({ id: 'far', location: { ...spot().location, lat: north(35, 600) } });
    const stops = [{ location: { lat: 35, lng: 139 } }];
    const result = nearbySpots([near, far], stops);
    expect(result.map((r) => r.spot.id)).toEqual(['near']);
  });

  it('500mのすぐ内側は含み、すぐ外側は含まない', () => {
    const inside = spot({ id: 'inside', location: { ...spot().location, lat: north(35, NEARBY_METERS - 1) } });
    const outside = spot({ id: 'outside', location: { ...spot().location, lat: north(35, NEARBY_METERS + 1) } });
    const stops = [{ location: { lat: 35, lng: 139 } }];
    const result = nearbySpots([inside, outside], stops);
    expect(result.map((r) => r.spot.id)).toEqual(['inside']);
  });

  it('近い順に並べる', () => {
    const near = spot({ id: 'near', location: { ...spot().location, lat: north(35, 200) } });
    const nearer = spot({ id: 'nearer', location: { ...spot().location, lat: north(35, 50) } });
    const stops = [{ location: { lat: 35, lng: 139 } }];
    const result = nearbySpots([near, nearer], stops);
    expect(result.map((r) => r.spot.id)).toEqual(['nearer', 'near']);
    expect(result[0]!.meters).toBeLessThan(result[1]!.meters);
  });

  it('位置の無い訪問先は無視する', () => {
    const near = spot({ id: 'near', location: { ...spot().location, lat: north(35, 100) } });
    const stops = [{ location: undefined }, { location: { lat: 35, lng: 139 } }];
    const result = nearbySpots([near], stops);
    expect(result.map((r) => r.spot.id)).toEqual(['near']);
  });

  it('複数の訪問先のうち一番近い距離を使う', () => {
    const target = spot({ id: 'target', location: { ...spot().location, lat: north(35, 400) } });
    const stops = [{ location: { lat: north(35, 400 - 100), lng: 139 } }, { location: { lat: 35, lng: 139 } }];
    const result = nearbySpots([target], stops);
    expect(result).toHaveLength(1);
    expect(result[0]!.meters).toBeCloseTo(100, 0);
  });

  it('訪問先が無ければ空', () => {
    expect(nearbySpots([spot()], [])).toEqual([]);
  });

  it('地点が無ければ空', () => {
    expect(nearbySpots([], [{ location: { lat: 35, lng: 139 } }])).toEqual([]);
  });
});

const q = <T extends HTMLElement = HTMLElement>(element: HTMLElement, testid: string): T | null =>
  element.querySelector<T>(`[data-testid="${testid}"]`);

function spotDialog(overrides: Partial<SpotDialog> = {}): SpotDialog {
  return {
    kind: 'spot',
    phase: 'idle',
    best: null,
    error: null,
    spotKind: 'toilet',
    note: '',
    ...overrides,
  };
}

function dialogHandlers(): DialogHandlers {
  return {
    onEdit: vi.fn(),
    onDuplicate: vi.fn(),
    onRequestDelete: vi.fn(),
    onConfirmDelete: vi.fn(),
    onConfirmDeleteSelected: vi.fn(),
    onMoveToTop: vi.fn(),
    onMoveToBottom: vi.fn(),
    onSaveAnyway: vi.fn(),
    onOpenExisting: vi.fn(),
    onOpenLocation: vi.fn(),
    onStartMeasuring: vi.fn(),
    onSaveMeasured: vi.fn(),
    onPasteChange: vi.fn(),
    onPasteToggle: vi.fn(),
    onSavePasted: vi.fn(),
    onRemove: vi.fn(),
    onUndo: vi.fn(),
    onSpotDraft: vi.fn(),
    onComposingChange: vi.fn(),
    onSaveSpot: vi.fn(),
    onPhotoIndex: vi.fn(),
    onClose: vi.fn(),
  };
}

describe('お役立ち地点の登録ダイアログ', () => {
  const stateWith = (dialog: SpotDialog): AppState => ({ ...createInitialState([]), dialog });

  it('種類のselectとメモの入力欄を出し、入力のたびonSpotDraftを生のDOMの値(select/inputの今の値)で呼ぶ', () => {
    const spies = dialogHandlers();
    const el = renderDialog(stateWith(spotDialog()), spies)!;
    const select = q<HTMLSelectElement>(el, 'spot-kind-select')!;
    expect([...select.options].map((o) => o.textContent)).toEqual(SPOT_KINDS.map((k) => k.label));
    select.value = 'rest';
    select.dispatchEvent(new Event('change'));
    expect(spies.onSpotDraft).toHaveBeenCalledWith({ spotKind: 'rest', note: '' });

    // メモの入力欄は、閉じ込めたdialogではなく、選択欄の今の(生のDOMの)値を一緒に送る
    // (Important 3: GPSの読み取りなどで再描画をまたいでも、渡された値が古くならないように)。
    const note = q<HTMLInputElement>(el, 'spot-note-input')!;
    note.value = '24時間開いている';
    note.dispatchEvent(new Event('input'));
    expect(spies.onSpotDraft).toHaveBeenCalledWith({ spotKind: 'rest', note: '24時間開いている' });
  });

  it('メモの入力欄はIME変換中はonSpotDraftを呼ばず、変換の確定(compositionend)で呼ぶ', () => {
    const spies = dialogHandlers();
    const el = renderDialog(stateWith(spotDialog()), spies)!;
    const note = q<HTMLInputElement>(el, 'spot-note-input')!;

    note.dispatchEvent(new Event('compositionstart'));
    note.value = 'にゅ';
    note.dispatchEvent(new Event('input'));
    expect(spies.onSpotDraft).not.toHaveBeenCalled();

    note.value = '入力中';
    note.dispatchEvent(new Event('compositionend'));
    expect(spies.onSpotDraft).toHaveBeenCalledWith({ spotKind: 'toilet', note: '入力中' });
  });

  it('idleでは登録ボタンを出さず、「今いる場所で登録」を押すとonStartMeasuring', () => {
    const spies = dialogHandlers();
    const el = renderDialog(stateWith(spotDialog({ phase: 'idle' })), spies)!;
    expect(q(el, 'spot-save-button')).toBeNull();
    q<HTMLButtonElement>(el, 'location-measure-button')!.click();
    expect(spies.onStartMeasuring).toHaveBeenCalledTimes(1);
  });

  it('measuring/measuredでspot-save-buttonを出す。bestが無ければ押せない', () => {
    const measuring = renderDialog(
      stateWith(spotDialog({ phase: 'measuring', best: null })),
      dialogHandlers(),
    )!;
    expect(q<HTMLButtonElement>(measuring, 'spot-save-button')!.disabled).toBe(true);

    const spies = dialogHandlers();
    const measured = renderDialog(
      stateWith(spotDialog({ phase: 'measured', best: { lat: 35, lng: 139, accuracy: 12 } })),
      spies,
    )!;
    const save = q<HTMLButtonElement>(measured, 'spot-save-button')!;
    expect(save.disabled).toBe(false);
    save.click();
    expect(spies.onSaveSpot).toHaveBeenCalledTimes(1);
  });

  it('savedは「登録しました」とdialog-cancel「閉じる」だけを出す(貼り付け欄は出さない)', () => {
    const spies = dialogHandlers();
    const el = renderDialog(stateWith(spotDialog({ phase: 'saved' })), spies)!;
    expect(el.textContent).toContain('登録しました');
    expect(q(el, 'spot-kind-select')).toBeNull();
    expect(q(el, 'location-paste-input')).toBeNull();
    const close = q<HTMLButtonElement>(el, 'dialog-cancel')!;
    expect(close.textContent).toBe('閉じる');
    close.click();
    expect(spies.onClose).toHaveBeenCalledTimes(1);
  });

  it('貼り付けでの登録は地点では出さない', () => {
    const el = renderDialog(stateWith(spotDialog({ phase: 'idle' })), dialogHandlers())!;
    expect(q(el, 'location-paste-input')).toBeNull();
    expect(q(el, 'location-paste-save')).toBeNull();
  });
});

function routeMapHandlers(): RouteMapHandlers {
  return {
    onOpenRoute: vi.fn(),
    onBack: vi.fn(),
    onChooseStops: vi.fn(),
    onShare: vi.fn(),
    onCopyLink: vi.fn(),
    onToggleVisited: vi.fn(),
    onOpenLocation: vi.fn(),
    onOpenPhotos: vi.fn(),
    onAddSpot: vi.fn(),
  };
}

describe('地図を開く画面: 近くのお役立ち地点', () => {
  const context: RouteContext = { ends: DEFAULT_ROUTE_ENDS, office: null };

  function selectedState(patients: Patient[]): AppState {
    return { ...createInitialState(patients), selectedIds: patients.map((p) => p.id) };
  }

  it('近くの地点があれば「近くのお役立ち地点」の見出しと、行「トイレ(約120m) 一言メモ」のリンクを出す', () => {
    const stop = { ...createPatient('場所1', '東京都1-1'), location: { lat: 35, lng: 139, accuracy: 10, recordedAt: '2026-09-25T00:00:00.000Z', source: 'gps' as const } };
    const near: Spot = {
      id: 's1',
      kind: 'toilet',
      note: '一言メモ',
      location: { lat: north(35, 123), lng: 139, accuracy: 10, recordedAt: '2026-09-25T00:00:00.000Z', source: 'gps' },
      createdAt: '2026-09-25T00:00:00.000Z',
    };
    const spies = routeMapHandlers();
    const el = renderRouteMap(selectedState([stop]), new Map(), googleMapsProvider, context, new Map(), new Map(), [near], spies);
    const section = q(el, 'nearby-spots')!;
    expect(section.querySelector('h2')?.textContent).toBe('近くのお役立ち地点');
    const link = section.querySelector<HTMLAnchorElement>('li a')!;
    expect(link.textContent).toBe('トイレ(約120m) 一言メモ');
    expect(link.target).toBe('_blank');
    expect(link.rel).toContain('noreferrer');
    link.click();
    const addButton = q<HTMLButtonElement>(el, 'spot-add-button')!;
    expect(addButton.textContent).toBe('今いる場所をお役立ち地点に登録');
    addButton.click();
    expect(spies.onAddSpot).toHaveBeenCalledTimes(1);
  });

  it('地点が1つも無ければ、見出し「お役立ち地点」で登録ボタンだけを出す', () => {
    const stop = { ...createPatient('場所1', '東京都1-1'), location: { lat: 35, lng: 139, accuracy: 10, recordedAt: '2026-09-25T00:00:00.000Z', source: 'gps' as const } };
    const el = renderRouteMap(selectedState([stop]), new Map(), googleMapsProvider, context, new Map(), new Map(), [], routeMapHandlers());
    const section = q(el, 'nearby-spots')!;
    expect(section.querySelector('h2')?.textContent).toBe('お役立ち地点');
    expect(section.querySelector('ul')).toBeNull();
    expect(q(el, 'spot-add-button')).not.toBeNull();
  });

  it('地点はあるが近くに無ければ、見出し「お役立ち地点」で登録ボタンだけを出す(節は消さない)', () => {
    const stop = { ...createPatient('場所1', '東京都1-1'), location: { lat: 35, lng: 139, accuracy: 10, recordedAt: '2026-09-25T00:00:00.000Z', source: 'gps' as const } };
    const far: Spot = {
      id: 's1',
      kind: 'toilet',
      note: '',
      location: { lat: north(35, 5000), lng: 139, accuracy: 10, recordedAt: '2026-09-25T00:00:00.000Z', source: 'gps' },
      createdAt: '2026-09-25T00:00:00.000Z',
    };
    const el = renderRouteMap(selectedState([stop]), new Map(), googleMapsProvider, context, new Map(), new Map(), [far], routeMapHandlers());
    const section = q(el, 'nearby-spots')!;
    expect(section.querySelector('h2')?.textContent).toBe('お役立ち地点');
    expect(section.querySelector('ul')).toBeNull();
    expect(q(el, 'spot-add-button')).not.toBeNull();
  });

  it('メモが空なら「トイレ(約120m)」だけ(末尾の空白を付けない)', () => {
    const stop = { ...createPatient('場所1', '東京都1-1'), location: { lat: 35, lng: 139, accuracy: 10, recordedAt: '2026-09-25T00:00:00.000Z', source: 'gps' as const } };
    const near: Spot = {
      id: 's1',
      kind: 'toilet',
      note: '',
      location: { lat: north(35, 50), lng: 139, accuracy: 10, recordedAt: '2026-09-25T00:00:00.000Z', source: 'gps' },
      createdAt: '2026-09-25T00:00:00.000Z',
    };
    const el = renderRouteMap(selectedState([stop]), new Map(), googleMapsProvider, context, new Map(), new Map(), [near], routeMapHandlers());
    const link = q(el, 'nearby-spots')!.querySelector<HTMLAnchorElement>('li a')!;
    expect(link.textContent).toBe('トイレ(約50m)');
  });
});

describe('設定画面: お役立ち地点', () => {
  function settingsHandlers(): SettingsHandlers {
    return {
      onExport: vi.fn(),
      onIncludePhotosChange: vi.fn(),
      onImport: vi.fn(),
      onThemeChange: vi.fn(),
      onBack: vi.fn(),
      onSaveOffice: vi.fn(),
      onClearOffice: vi.fn(),
      onClearHistory: vi.fn(),
      onDeleteSpot: vi.fn(),
      onSharedSecretDraftChange: vi.fn(),
      onSharedSecretSave: vi.fn(),
      onSharedSecretChange: vi.fn(),
      onSharedSecretClear: vi.fn(),
      onSharedSecretCancel: vi.fn(),
    };
  }
  const info = (spots: Spot[]): SettingsInfo => ({
    lastBackupAt: null,
    persisted: null,
    theme: 'auto',
    office: null,
    spots,
    photoBytes: 0,
    includePhotos: true,
    hasSharedSecret: false,
    sharedSecretDraft: '',
    sharedSecretEditing: false,
  });

  it('空なら案内文を出す', () => {
    const el = renderSettings(createInitialState([]), info([]), settingsHandlers());
    expect(el.textContent).toContain('まだありません。地図を開く画面の下から登録できます。');
  });

  it('一覧: 種類・メモ・登録日「トイレ・メモ(9/25 登録)」と、各行の削除', () => {
    const spot: Spot = {
      id: 's1',
      kind: 'toilet',
      note: 'メモ',
      location: { lat: 35, lng: 139, accuracy: 10, recordedAt: '2026-09-25T00:00:00.000Z', source: 'gps' },
      createdAt: '2026-09-25T00:00:00.000Z',
    };
    const spies = settingsHandlers();
    const el = renderSettings(createInitialState([]), info([spot]), spies);
    expect(el.textContent).toContain('トイレ・メモ(9/25 登録)');
    q<HTMLButtonElement>(el, 'spot-delete')!.click();
    expect(spies.onDeleteSpot).toHaveBeenCalledWith('s1');
  });
});
