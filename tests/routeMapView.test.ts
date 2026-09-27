import { describe, expect, it, vi } from 'vitest';
import { MAX_STOPS_PER_ROUTE } from '../src/config';
import { googleMapsProvider, type MapProvider } from '../src/mapProviders';
import { createPatient } from '../src/patient';
import { DEFAULT_ROUTE_ENDS, type Office, type RouteContext } from '../src/routePlan';
import { splitIntoRoutes } from '../src/routeSplitter';
import { createInitialState } from '../src/state';
import type { AppState, Patient, Spot } from '../src/types';
import { renderRouteMap, type RouteMapHandlers } from '../src/views/routeMapView';

const handlers = (): RouteMapHandlers => ({
  onOpenRoute: vi.fn(),
  onBack: vi.fn(),
  onChooseStops: vi.fn(),
  onShare: vi.fn(),
  onCopyLink: vi.fn(),
  onToggleVisited: vi.fn(),
  onOpenLocation: vi.fn(),
  onOpenPhotos: vi.fn(),
  onAddSpot: vi.fn(),
});

const ctx = (): RouteContext => defaultContext;

const office: Office = { name: '本店', address: '東京都中央区1-1' };
const defaultContext: RouteContext = { ends: DEFAULT_ROUTE_ENDS, office: null };

function makeStops(count: number): Patient[] {
  return Array.from({ length: count }, (_, i) => createPatient(`場所${i + 1}`, `東京都${i + 1}-1`));
}

/**
 * ルート分割の挙動を見るテスト用に、選択件数の上限(MAX_SELECTION)にかかわらず
 * 好きな件数を選択済みにした状態を、直接組み立てる。
 */
function stateWithSelection(count: number): AppState {
  const patients = makeStops(count);
  return { ...createInitialState(patients), selectedIds: patients.map((p) => p.id) };
}

const selectedState = stateWithSelection;

const render = (
  state: AppState,
  opened: ReadonlyMap<number, string> = new Map(),
  spies: RouteMapHandlers = handlers(),
  provider: MapProvider = googleMapsProvider,
  context: RouteContext = defaultContext,
  visited: ReadonlyMap<string, string> = new Map(),
  photoCounts: ReadonlyMap<string, number> = new Map(),
  spots: readonly Spot[] = [],
) => renderRouteMap(state, opened, provider, context, visited, photoCounts, spots, spies);

const cards = (element: HTMLElement) =>
  [...element.querySelectorAll<HTMLElement>('[data-testid="route-card"]')];
const openButtons = (element: HTMLElement) =>
  element.querySelectorAll<HTMLButtonElement>('[data-testid="open-route"]');

// 上限の2倍なら、必ず2本以上に分かれる。
const SPLIT_COUNT = MAX_STOPS_PER_ROUTE * 2;
const routeCountFor = (count: number) => splitIntoRoutes(makeStops(count), MAX_STOPS_PER_ROUTE).length;

const OPENED_AT = new Date(2026, 8, 21, 14, 32).toISOString();

describe('renderRouteMap: 全体', () => {
  it('見出しは「地図を開く」', () => {
    expect(render(stateWithSelection(2)).querySelector('h1')?.textContent).toBe('地図を開く');
  });

  it('戻るボタンで onBack が呼ばれる', () => {
    const spies = handlers();
    render(stateWithSelection(2), new Map(), spies)
      .querySelector<HTMLButtonElement>('[data-testid="back-button"]')!
      .click();
    expect(spies.onBack).toHaveBeenCalledTimes(1);
  });

  it('メッセージ領域は VoiceOver に読み上げられるよう role=status を持つ', () => {
    const state = { ...stateWithSelection(2), message: { kind: 'error' as const, text: 'エラー' } };
    expect(render(state).querySelector('.message')?.getAttribute('role')).toBe('status');
  });

  it('選択件数を「N件の訪問先が選択されています。」で出す', () => {
    const element = render(stateWithSelection(3));
    expect(element.querySelector('[data-testid="map-summary"]')?.textContent).toContain(
      '3件の訪問先が選択されています。',
    );
  });
});

describe('renderRouteMap: ルートの分割', () => {
  it('上限ちょうどなら、カードは1枚で、分割の説明は出ない', () => {
    const element = render(stateWithSelection(MAX_STOPS_PER_ROUTE));
    expect(cards(element)).toHaveLength(1);
    expect(element.textContent).not.toContain('に分割します');
  });

  it('上限を超えると、ルートの本数ぶんのカードが並び、分割の説明に本数と上限が入る', () => {
    const expectedCount = routeCountFor(SPLIT_COUNT);
    expect(expectedCount).toBeGreaterThan(1);
    const element = render(stateWithSelection(SPLIT_COUNT));
    expect(cards(element)).toHaveLength(expectedCount);
    const summary = element.querySelector('[data-testid="map-summary"]')?.textContent ?? '';
    expect(summary).toContain(`${expectedCount}つのルートに分割します。`);
    expect(summary).toContain(`1つのルートは最大${MAX_STOPS_PER_ROUTE}地点までです。`);
    expect(summary).toContain('上から順に開いてください。');
  });

  it('カードに、ルート番号・地点数・名前の並びを出す', () => {
    const stops = makeStops(SPLIT_COUNT);
    const state = { ...createInitialState(stops), selectedIds: stops.map((p) => p.id) };
    const routes = splitIntoRoutes(stops, MAX_STOPS_PER_ROUTE);
    const element = render(state);
    routes.forEach((route, index) => {
      const card = cards(element)[index]!;
      expect(card.querySelector('.route-title')?.textContent).toBe(`ルート${index + 1}`);
      expect(card.querySelector('.route-count')?.textContent).toBe(`${route.length}地点`);
      const stopNames = [...card.querySelectorAll('.route-stop-name')].map((el) => el.textContent);
      expect(stopNames).toEqual(route.map((patient) => patient.name));
    });
  });

  it('境目の訪問先は、前後どちらのルートにも含まれる', () => {
    const stops = makeStops(MAX_STOPS_PER_ROUTE + 1);
    const state = { ...createInitialState(stops), selectedIds: stops.map((p) => p.id) };
    const routes = splitIntoRoutes(stops, MAX_STOPS_PER_ROUTE);
    expect(routes).toHaveLength(2);
    const element = render(state);
    const boundary = routes[0]![routes[0]!.length - 1]!.name;
    expect(cards(element)[0]!.textContent).toContain(boundary);
    expect(cards(element)[1]!.textContent).toContain(boundary);
  });
});

describe('renderRouteMap: 開いたルートの状態', () => {
  it('何も開いていなければ、最初のルートが「次に開く」で、残りは後回しの表示', () => {
    const element = render(stateWithSelection(SPLIT_COUNT));
    const states = cards(element).map((card) => card.dataset.state);
    expect(states[0]).toBe('next');
    for (const state of states.slice(1)) {
      expect(state).toBe('later');
    }
  });

  it('「次に開く」のカードだけに、そのラベルが付く', () => {
    const element = render(stateWithSelection(SPLIT_COUNT));
    const labelled = cards(element).filter((card) => card.querySelector('.route-next-label') !== null);
    expect(labelled).toHaveLength(1);
    expect(labelled[0]).toBe(cards(element)[0]);
    expect(labelled[0]!.querySelector('.route-next-label')?.textContent).toBe('次に開く');
  });

  it('開いたルートは、「✓ Googleマップで開きました」と開いた日時を表示する', () => {
    const element = render(stateWithSelection(SPLIT_COUNT), new Map([[0, OPENED_AT]]));
    const card = cards(element)[0]!;
    expect(card.dataset.state).toBe('done');
    const status = card.querySelector('[data-testid="route-status"]')?.textContent ?? '';
    expect(status).toContain('✓ Googleマップで開きました');
    expect(status).toContain('9/21 14:32');
  });

  it('開いたルートのボタンは「もう一度開く」', () => {
    const element = render(stateWithSelection(SPLIT_COUNT), new Map([[0, OPENED_AT]]));
    expect(openButtons(element)[0]?.textContent).toBe('もう一度開く');
  });

  it('最初のルートを開いたら、2番目が「次に開く」になる', () => {
    const element = render(stateWithSelection(SPLIT_COUNT), new Map([[0, OPENED_AT]]));
    const states = cards(element).map((card) => card.dataset.state);
    expect(states[0]).toBe('done');
    expect(states[1]).toBe('next');
  });

  it('すべて開いたら、「次に開く」は無く、すべて「開きました」になる', () => {
    const count = routeCountFor(SPLIT_COUNT);
    const opened = new Map(Array.from({ length: count }, (_, i) => [i, OPENED_AT] as const));
    const element = render(stateWithSelection(SPLIT_COUNT), opened);
    expect(cards(element).every((card) => card.dataset.state === 'done')).toBe(true);
    expect(element.querySelector('.route-next-label')).toBeNull();
  });

  it('日時が空(古い記録)なら、開いたことは出すが日時は出さない', () => {
    const element = render(stateWithSelection(SPLIT_COUNT), new Map([[0, '']]));
    const card = cards(element)[0]!;
    expect(card.dataset.state).toBe('done');
    expect(card.querySelector('[data-testid="route-status"]')?.textContent).toContain('開きました');
    expect(card.querySelector('.route-time')).toBeNull();
  });

  it('途中のルートだけ開いていても、最初の未開封が「次に開く」', () => {
    const element = render(stateWithSelection(SPLIT_COUNT), new Map([[1, OPENED_AT]]));
    const states = cards(element).map((card) => card.dataset.state);
    expect(states[0]).toBe('next');
    expect(states[1]).toBe('done');
  });
});

describe('renderRouteMap: ボタン', () => {
  it('ボタンを押すと、ルート番号つきで onOpenRoute が呼ばれる', () => {
    const spies = handlers();
    const element = render(stateWithSelection(SPLIT_COUNT), new Map(), spies);
    openButtons(element)[1]?.click();
    expect(spies.onOpenRoute).toHaveBeenCalledWith(1);
  });

  it('ボタンはルート番号を data-id に持つ(フォーカス復元用)', () => {
    const element = render(stateWithSelection(SPLIT_COUNT));
    openButtons(element).forEach((button, index) => {
      expect(button.dataset.id).toBe(String(index));
    });
  });

  it('ボタンの文言は、地図サービスの名前から作る', () => {
    const provider: MapProvider = { ...googleMapsProvider, label: 'テスト地図' };
    const element = render(stateWithSelection(2), new Map(), handlers(), provider);
    expect(openButtons(element)[0]?.textContent).toBe('テスト地図で開く');
  });

  it('ボタンには、どのルートを開くのかが分かる名前(aria-label)を付ける', () => {
    const element = render(stateWithSelection(SPLIT_COUNT), new Map([[0, OPENED_AT]]));
    expect(openButtons(element)[0]?.getAttribute('aria-label')).toBe('ルート1をもう一度開く');
    expect(openButtons(element)[1]?.getAttribute('aria-label')).toBe('ルート2をGoogleマップで開く');
  });

  it('「次に開く」のボタンは青(primary)で目立たせる', () => {
    const element = render(stateWithSelection(SPLIT_COUNT));
    expect(openButtons(element)[0]?.classList.contains('primary')).toBe(true);
    expect(openButtons(element)[1]?.classList.contains('primary')).toBe(false);
  });
});

describe('renderRouteMap: 訪問先が選ばれていないとき', () => {
  it('案内と「訪問先を選ぶ」ボタンを出し、ルートのカードは出さない', () => {
    const spies = handlers();
    const element = render(createInitialState([]), new Map(), spies);
    expect(element.textContent).toContain('訪問先が選ばれていません');
    expect(cards(element)).toHaveLength(0);
    element.querySelector<HTMLButtonElement>('[data-testid="choose-stops-button"]')!.click();
    expect(spies.onChooseStops).toHaveBeenCalledTimes(1);
  });

  it('共有ボタンは出さない', () => {
    const element = render(createInitialState([]));
    expect(element.querySelector('[data-testid="share-routes"]')).toBeNull();
  });
});

describe('renderRouteMap: ルートの共有', () => {
  it('「ルートを共有」ボタンを出し、押すと onShare が呼ばれる', () => {
    const spies = handlers();
    const element = render(stateWithSelection(3), new Map(), spies);
    const button = element.querySelector<HTMLButtonElement>('[data-testid="share-routes"]')!;
    expect(button.textContent).toContain('ルートを共有');
    button.click();
    expect(spies.onShare).toHaveBeenCalledTimes(1);
  });

  it('「リンクをコピー」ボタンも出し、押すと onCopyLink が呼ばれる', () => {
    const spies = handlers();
    const element = render(stateWithSelection(3), new Map(), spies);
    const button = element.querySelector<HTMLButtonElement>('[data-testid="copy-route-link"]')!;
    expect(button.textContent).toContain('リンクをコピー');
    button.click();
    expect(spies.onCopyLink).toHaveBeenCalledTimes(1);
    expect(spies.onShare).not.toHaveBeenCalled();
  });

  it('共有すると、開いた人の現在地から始まることを添えて案内する', () => {
    const element = render(stateWithSelection(3));
    expect(element.textContent).toContain('現在地から');
  });
});

describe('renderRouteMap: 電話番号', () => {
  it('電話番号を持つ訪問先がいるカードには、tel: リンクがある', () => {
    const withPhone = createPatient('山田 太郎', '東京都1-1', new Date(), '03-1234-5678');
    const noPhone = createPatient('鈴木 花子', '東京都2-2');
    const state = { ...createInitialState([withPhone, noPhone]), selectedIds: [withPhone.id, noPhone.id] };
    const element = render(state);
    const links = element.querySelectorAll<HTMLAnchorElement>('[data-testid="phone-link"]');
    expect(links).toHaveLength(1);
    expect(links[0]!.getAttribute('href')).toBe('tel:0312345678');
  });

  it('誰も電話番号を持たないカードには、電話リンクが出ない', () => {
    const element = render(stateWithSelection(2));
    expect(element.querySelector('[data-testid="phone-link"]')).toBeNull();
  });
});

describe('renderRouteMap: 位置の未登録', () => {
  it('位置が無い訪問先だけに location-pin を出し、押すと onOpenLocation(id)', () => {
    const withLoc = createPatient('場所1', '東京都1-1');
    withLoc.location = { lat: 35, lng: 139, accuracy: 12, recordedAt: '2026-09-22T00:00:00.000Z', source: 'gps' };
    const withoutLoc = createPatient('場所2', '東京都2-2');
    const state = { ...createInitialState([withLoc, withoutLoc]), selectedIds: [withLoc.id, withoutLoc.id] };
    const spies = handlers();
    const element = render(state, new Map(), spies);
    const pins = element.querySelectorAll<HTMLButtonElement>('[data-testid="location-pin"]');
    expect(pins).toHaveLength(1);
    expect(pins[0]!.dataset.id).toBe(withoutLoc.id);
    expect(pins[0]!.getAttribute('aria-label')).toBe('場所2の位置を登録');
    pins[0]!.click();
    expect(spies.onOpenLocation).toHaveBeenCalledWith(withoutLoc.id);
  });

  it('位置が無い人がいれば route-missing-location に件数を出す', () => {
    const withoutLoc1 = createPatient('場所1', '東京都1-1');
    const withoutLoc2 = createPatient('場所2', '東京都2-2');
    const state = { ...createInitialState([withoutLoc1, withoutLoc2]), selectedIds: [withoutLoc1.id, withoutLoc2.id] };
    const element = render(state);
    expect(cards(element)[0]!.querySelector('[data-testid="route-missing-location"]')?.textContent).toBe(
      '位置が未登録: 2件',
    );
  });

  it('全員に位置があれば route-missing-location は出ない', () => {
    const withLoc = createPatient('場所1', '東京都1-1');
    withLoc.location = { lat: 35, lng: 139, accuracy: 12, recordedAt: '2026-09-22T00:00:00.000Z', source: 'gps' };
    const state = { ...createInitialState([withLoc]), selectedIds: [withLoc.id] };
    const element = render(state);
    expect(cards(element)[0]!.querySelector('[data-testid="route-missing-location"]')).toBeNull();
  });
});

describe('renderRouteMap: 訪問済み', () => {
  it('各訪問先に「済」ボタンがあり、済なら時刻を出す。押すと onToggleVisited(id)', () => {
    const state = selectedState(2);
    const [a, b] = state.patients;
    const visited = new Map([[a!.id, new Date(2026, 8, 22, 9, 12).toISOString()]]);
    const spies = handlers();
    const element = renderRouteMap(state, new Map(), googleMapsProvider, ctx(), visited, new Map(), [], spies);
    const buttons = [...element.querySelectorAll<HTMLButtonElement>('[data-testid="visited-toggle"]')];
    expect(buttons).toHaveLength(2);
    expect(buttons[0]!.textContent).toBe('済 9:12');
    expect(buttons[0]!.getAttribute('aria-pressed')).toBe('true');
    expect(buttons[1]!.textContent).toBe('済');
    buttons[1]!.click();
    expect(spies.onToggleVisited).toHaveBeenCalledWith(b!.id);
  });
});

describe('renderRouteMap: 写真', () => {
  it('写真がある訪問先だけに photo-count「写真 N」を出し、押すと onOpenPhotos(id)', () => {
    const withPhotos = createPatient('場所1', '東京都1-1');
    const withoutPhotos = createPatient('場所2', '東京都2-2');
    const state = { ...createInitialState([withPhotos, withoutPhotos]), selectedIds: [withPhotos.id, withoutPhotos.id] };
    const spies = handlers();
    const element = render(state, new Map(), spies, googleMapsProvider, defaultContext, new Map(), new Map([[withPhotos.id, 2]]));
    const buttons = [...element.querySelectorAll<HTMLButtonElement>('[data-testid="photo-count"]')];
    expect(buttons).toHaveLength(1);
    expect(buttons[0]!.dataset.id).toBe(withPhotos.id);
    expect(buttons[0]!.textContent).toBe('写真 2');
    buttons[0]!.click();
    expect(spies.onOpenPhotos).toHaveBeenCalledWith(withPhotos.id);
  });

  it('件数が0なら photo-count は出ない', () => {
    const patient = createPatient('場所1', '東京都1-1');
    const state = { ...createInitialState([patient]), selectedIds: [patient.id] };
    const element = render(state, new Map(), handlers(), googleMapsProvider, defaultContext, new Map(), new Map([[patient.id, 0]]));
    expect(element.querySelector('[data-testid="photo-count"]')).toBeNull();
  });
});

describe('renderRouteMap: 駐車情報とメモ', () => {
  it('駐車情報があれば route-stop-info にバッジを出す', () => {
    const withParking = { ...createPatient('場所1', '東京都1-1'), parking: { type: 'coin' as const } };
    const state = { ...createInitialState([withParking]), selectedIds: [withParking.id] };
    const element = render(state);
    const info = element.querySelector<HTMLElement>('[data-testid="route-stop-info"]')!;
    expect(info).not.toBeNull();
    const badge = info.querySelector<HTMLElement>('[data-testid="parking-badge"]')!;
    expect(badge.textContent).toBe('P');
    expect(badge.classList.contains('parking-badge')).toBe(true);
    expect(info.textContent).toBe('P コインP');
  });

  it('メモがあれば要約を「 / 」に続けて出す', () => {
    const withNote = {
      ...createPatient('場所1', '東京都1-1'),
      parking: { type: 'coin' as const },
      note: '駐車場: 北側',
    };
    const state = { ...createInitialState([withNote]), selectedIds: [withNote.id] };
    const element = render(state);
    const info = element.querySelector('[data-testid="route-stop-info"]')!;
    expect(info.textContent).toBe('P コインP / 駐車場: 北側');
  });

  it('メモだけあれば、バッジなしで要約だけ出す', () => {
    const withNote = { ...createPatient('場所1', '東京都1-1'), note: '駐車場: 北側' };
    const state = { ...createInitialState([withNote]), selectedIds: [withNote.id] };
    const element = render(state);
    const info = element.querySelector('[data-testid="route-stop-info"]')!;
    expect(info.querySelector('[data-testid="parking-badge"]')).toBeNull();
    expect(info.textContent).toBe('駐車場: 北側');
  });

  it('メモが長ければ40文字で切って「…」を付ける', () => {
    const longNote = 'あ'.repeat(50);
    const withNote = { ...createPatient('場所1', '東京都1-1'), note: longNote };
    const state = { ...createInitialState([withNote]), selectedIds: [withNote.id] };
    const element = render(state);
    const info = element.querySelector('[data-testid="route-stop-info"]')!;
    expect(info.textContent).toBe(`${'あ'.repeat(40)}…`);
  });

  it('駐車情報が不明・未登録なら、駐車のバッジは出ない(unknown はバッジ自体が無い)', () => {
    const unknown = { ...createPatient('場所1', '東京都1-1'), parking: { type: 'unknown' as const } };
    const none = createPatient('場所2', '東京都2-1');
    const state = { ...createInitialState([unknown, none]), selectedIds: [unknown.id, none.id] };
    const element = render(state);
    expect(element.querySelectorAll('[data-testid="route-stop-info"]')).toHaveLength(0);
  });
});

describe('renderRouteMap: 出発・帰着', () => {
  it('出発・帰着の指定を、1本目と最後のカードに出す', () => {
    const state = selectedState(12);
    const element = renderRouteMap(
      state,
      new Map(),
      googleMapsProvider,
      { ends: { start: 'office', end: 'office' }, office },
      new Map(),
      new Map(),
      [],
      handlers(),
    );
    const cards = [...element.querySelectorAll('[data-testid="route-card"]')];
    expect(cards).toHaveLength(2);
    expect(cards[0]!.querySelector('[data-testid="route-ends"]')?.textContent).toBe('事業所から');
    expect(cards[1]!.querySelector('[data-testid="route-ends"]')?.textContent).toBe('事業所へ戻る');
  });
  it('指定が無ければ出発・帰着の行は出ない', () => {
    const element = renderRouteMap(
      selectedState(3),
      new Map(),
      googleMapsProvider,
      { ends: DEFAULT_ROUTE_ENDS, office: null },
      new Map(),
      new Map(),
      [],
      handlers(),
    );
    expect(element.querySelector('[data-testid="route-ends"]')).toBeNull();
  });
  it('分割は事業所ぶんを引いた件数で行う', () => {
    const element = renderRouteMap(
      selectedState(9),
      new Map(),
      googleMapsProvider,
      { ends: { start: 'office', end: 'office' }, office },
      new Map(),
      new Map(),
      [],
      handlers(),
    );
    expect(element.querySelectorAll('[data-testid="route-card"]')).toHaveLength(2);
    expect(element.querySelector('[data-testid="map-summary"]')?.textContent).toContain('最大8地点');
  });
  it('現在地から出発すると、10件選んでも1本9件までで2本に分かれる', () => {
    const element = renderRouteMap(
      selectedState(10),
      new Map(),
      googleMapsProvider,
      { ends: { start: 'current', end: 'last' }, office: null },
      new Map(),
      new Map(),
      [],
      handlers(),
    );
    expect(element.querySelectorAll('[data-testid="route-card"]')).toHaveLength(2);
    expect(element.querySelector('[data-testid="map-summary"]')?.textContent).toContain('最大9地点');
  });
});
