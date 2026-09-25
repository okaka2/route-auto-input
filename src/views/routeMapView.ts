import { MAX_STOPS_PER_ROUTE } from '../config';
import { formatDateTime, formatPhoneHref, formatTime } from '../format';
import { pointOf } from '../geoPoint';
import { buildGoogleMapsUrl } from '../googleMapsUrl';
import type { MapProvider } from '../mapProviders';
import { buildRoutePlans, stopsPerRoute, type RoutePlan, type RouteContext } from '../routePlan';
import { nearbySpots, spotLabel } from '../spots';
import { selectedPatients } from '../state';
import type { AppState, Patient, Spot } from '../types';
import { noteSummary, parkingBadge } from '../visitInfo';
import { renderMessage, renderScreenHeader } from './common';

const NOTE_SUMMARY_MAX_LENGTH = 40;

export type RouteMapHandlers = {
  onOpenRoute(routeIndex: number): void;
  onBack(): void;
  onChooseStops(): void;
  /** 「ルートを共有」。確認と共有(LINEなど)は呼び出し側が行う。 */
  onShare(): void;
  /** 「リンクをコピー」。共有メニューを使わず、URLをコピーする(PC向け)。 */
  onCopyLink(): void;
  /** 訪問先の「済」ボタン。押すたびに訪問済み/未訪問を切り替える。 */
  onToggleVisited(id: string): void;
  /** 位置が未登録の訪問先の行の「位置」ボタン。位置の登録ダイアログを開く。 */
  onOpenLocation(id: string): void;
  /** 写真がある訪問先の行の「写真 N」ボタン。写真のダイアログを開く。 */
  onOpenPhotos(id: string): void;
  /** 「今いる場所をお役立ち地点に登録」。お役立ち地点の登録ダイアログを開く。 */
  onAddSpot(): void;
};

/** done: 開いた / next: 次に開く(最初の未開封) / later: それ以降 */
type CardState = 'done' | 'next' | 'later';

/**
 * 「地図を開く」画面。選んだ訪問先を、ルートごとのカードで表示する。
 * 上限を超えるときは、既存のルート分割で複数のカードになる。
 * 次に開くルートを最も目立たせ、開いたルートは「✓ 開きました」と日時で示す。
 *
 * @param opened 開いたルートの番号 → 開いた日時(ISO 8601。不明なら '')
 * @param visited 訪問先の id → 訪問済みにした日時(ISO 8601)
 * @param photoCounts 訪問先の id → 登録した写真の枚数(0枚、または未登録なら出さない)
 * @param spots 登録済みのお役立ち地点(トイレ・休憩など)。近くの分だけカードの下に出す。
 */
export function renderRouteMap(
  state: AppState,
  opened: ReadonlyMap<number, string>,
  provider: MapProvider,
  context: RouteContext,
  visited: ReadonlyMap<string, string>,
  photoCounts: ReadonlyMap<string, number>,
  spots: readonly Spot[],
  handlers: RouteMapHandlers,
): HTMLElement {
  const container = document.createElement('div');
  container.className = 'screen';
  container.append(renderScreenHeader('地図を開く', { onBack: handlers.onBack }));

  if (state.message) {
    container.append(renderMessage(state.message));
  }

  const stops = selectedPatients(state);
  if (stops.length === 0) {
    container.append(renderEmpty(handlers));
    return container;
  }

  const plans = buildRoutePlans(stops, context.ends, context.office, MAX_STOPS_PER_ROUTE);
  const perRoute = stopsPerRoute(context.ends, context.office, MAX_STOPS_PER_ROUTE);
  container.append(renderSummary(stops.length, plans.length, perRoute));

  // 最初の未開封が「次に開く」。すべて開いていれば -1(「次に開く」は無い)。
  const nextIndex = plans.findIndex((_, index) => !opened.has(index));
  const cards = document.createElement('div');
  cards.className = 'route-cards';
  plans.forEach((plan, index) => {
    const cardState: CardState = opened.has(index) ? 'done' : index === nextIndex ? 'next' : 'later';
    cards.append(
      renderRouteCard(plan, index, cardState, opened.get(index) ?? '', provider, visited, photoCounts, handlers),
    );
  });
  container.append(cards);

  const nearby = renderNearbySpots(stops, spots, handlers);
  if (nearby) {
    container.append(nearby);
  }

  container.append(renderShare(handlers));
  return container;
}

/**
 * カードの下、共有の上に出す「近くのお役立ち地点」。500m以内が1件も無く、かつ地点が
 * 1件も登録されていなければ節ごと出さない。地点が1件でも登録されていれば
 * (近くに無くても)見出しを「お役立ち地点」にして、登録ボタンだけは出す。
 */
function renderNearbySpots(
  stops: readonly Patient[],
  spots: readonly Spot[],
  handlers: RouteMapHandlers,
): HTMLElement | null {
  const nearby = nearbySpots(spots, stops);
  if (nearby.length === 0 && spots.length > 0) {
    return null;
  }

  const card = document.createElement('section');
  card.className = 'card nearby-spots';
  card.dataset.testid = 'nearby-spots';

  const heading = document.createElement('h2');
  heading.textContent = nearby.length > 0 ? '近くのお役立ち地点' : 'お役立ち地点';
  card.append(heading);

  if (nearby.length > 0) {
    const list = document.createElement('ul');
    for (const { spot, meters } of nearby) {
      const item = document.createElement('li');
      const link = document.createElement('a');
      link.target = '_blank';
      link.rel = 'noreferrer';
      link.href = buildGoogleMapsUrl([pointOf({ address: '', location: spot.location })]);
      const rounded = Math.round(meters / 10) * 10;
      link.textContent =
        spot.note === '' ? `${spotLabel(spot.kind)}(約${rounded}m)` : `${spotLabel(spot.kind)}(約${rounded}m) ${spot.note}`;
      item.append(link);
      list.append(item);
    }
    card.append(list);
  }

  const addButton = document.createElement('button');
  addButton.type = 'button';
  addButton.className = 'block';
  addButton.dataset.testid = 'spot-add-button';
  addButton.textContent = '今いる場所をお役立ち地点に登録';
  addButton.addEventListener('click', () => handlers.onAddSpot());
  card.append(addButton);

  return card;
}

/** 別の人に送るための共有ボタン。受け取った人はURLを開くだけで、同じルートの地図を使える。 */
function renderShare(handlers: RouteMapHandlers): HTMLElement {
  const card = document.createElement('section');
  card.className = 'card share-card';

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'block';
  button.dataset.testid = 'share-routes';
  button.textContent = 'ルートを共有(LINEなど)';
  button.addEventListener('click', () => handlers.onShare());

  const copy = document.createElement('button');
  copy.type = 'button';
  copy.className = 'block';
  copy.dataset.testid = 'copy-route-link';
  copy.textContent = 'リンクをコピー';
  copy.addEventListener('click', () => handlers.onCopyLink());

  const buttons = document.createElement('div');
  buttons.className = 'share-buttons';
  buttons.append(button, copy);

  const note = document.createElement('p');
  note.className = 'hint';
  note.textContent = '受け取った人は、URLを開くだけで同じルートの地図を使えます。案内は開いた人の現在地から始まります。';

  card.append(buttons, note);
  return card;
}

function renderEmpty(handlers: RouteMapHandlers): HTMLElement {
  const card = document.createElement('section');
  card.className = 'card empty-card';

  const text = document.createElement('p');
  text.textContent = '訪問先が選ばれていません。';

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'primary block';
  button.dataset.testid = 'choose-stops-button';
  button.textContent = '訪問先を選ぶ';
  button.addEventListener('click', () => handlers.onChooseStops());

  card.append(text, button);
  return card;
}

function renderSummary(stopCount: number, routeCount: number, perRoute: number): HTMLElement {
  const card = document.createElement('section');
  card.className = 'card summary-card';
  card.dataset.testid = 'map-summary';

  const count = document.createElement('p');
  count.className = 'summary-count';
  count.textContent = `${stopCount}件の訪問先が選択されています。`;
  card.append(count);

  if (routeCount > 1) {
    const split = document.createElement('p');
    split.className = 'summary-split';
    split.textContent = `${routeCount}つのルートに分割します。1つのルートは最大${perRoute}地点までです。上から順に開いてください。`;
    card.append(split);
  }
  return card;
}

function renderRouteCard(
  plan: RoutePlan<Patient>,
  index: number,
  cardState: CardState,
  openedAt: string,
  provider: MapProvider,
  visited: ReadonlyMap<string, string>,
  photoCounts: ReadonlyMap<string, number>,
  handlers: RouteMapHandlers,
): HTMLElement {
  const route = plan.stops;
  const card = document.createElement('section');
  card.className = `route-card ${cardState}`;
  card.dataset.testid = 'route-card';
  card.dataset.state = cardState;
  card.dataset.id = String(index);

  const head = document.createElement('div');
  head.className = 'route-card-head';
  const title = document.createElement('h2');
  title.className = 'route-title';
  title.textContent = `ルート${index + 1}`;
  const count = document.createElement('span');
  count.className = 'route-count';
  count.textContent = `${route.length}地点`;
  head.append(title, count);
  if (cardState === 'next') {
    const label = document.createElement('span');
    label.className = 'route-next-label';
    label.textContent = '次に開く';
    head.append(label);
  }
  card.append(head);

  if (plan.startLabel || plan.endLabel) {
    const ends = document.createElement('p');
    ends.className = 'route-ends';
    ends.dataset.testid = 'route-ends';
    ends.textContent = [plan.startLabel, plan.endLabel].filter((label) => label !== '').join(' → ');
    card.append(ends);
  }

  card.append(renderStops(route, visited, photoCounts, handlers));

  const missingLocationCount = route.filter((patient) => !patient.location).length;
  if (missingLocationCount > 0) {
    const missing = document.createElement('p');
    missing.className = 'hint';
    missing.dataset.testid = 'route-missing-location';
    missing.textContent = `位置が未登録: ${missingLocationCount}件`;
    card.append(missing);
  }

  if (cardState === 'done') {
    const status = document.createElement('p');
    status.className = 'route-status';
    status.dataset.testid = 'route-status';
    const text = document.createElement('span');
    text.textContent = `✓ ${provider.label}で開きました`;
    status.append(text);
    const time = formatDateTime(openedAt);
    if (time !== '') {
      const timeElement = document.createElement('span');
      timeElement.className = 'route-time';
      timeElement.textContent = time;
      status.append(timeElement);
    }
    card.append(status);
  }

  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.testid = 'open-route';
  button.dataset.id = String(index);
  if (cardState === 'done') {
    button.textContent = 'もう一度開く';
    button.setAttribute('aria-label', `ルート${index + 1}をもう一度開く`);
  } else {
    button.className = cardState === 'next' ? 'primary block' : 'block';
    button.textContent = `${provider.label}で開く`;
    button.setAttribute('aria-label', `ルート${index + 1}を${provider.label}で開く`);
  }
  button.addEventListener('click', () => handlers.onOpenRoute(index));
  card.append(button);

  return card;
}

/** 訪問先ごとの行(名前・電話リンク・写真・「済」ボタン)。 */
function renderStops(
  route: readonly Patient[],
  visited: ReadonlyMap<string, string>,
  photoCounts: ReadonlyMap<string, number>,
  handlers: RouteMapHandlers,
): HTMLElement {
  const list = document.createElement('ul');
  list.className = 'route-stops';
  list.dataset.testid = 'route-stops';
  for (const patient of route) {
    const item = document.createElement('li');
    const main = document.createElement('div');
    main.className = 'route-stop-main';
    const name = document.createElement('span');
    name.className = 'route-stop-name';
    name.textContent = patient.name;
    main.append(name);
    const info = renderStopInfo(patient);
    if (info) {
      main.append(info);
    }
    item.append(main);
    if (patient.phone) {
      const phone = document.createElement('a');
      phone.className = 'phone-link';
      phone.dataset.testid = 'phone-link';
      phone.href = formatPhoneHref(patient.phone);
      phone.setAttribute('aria-label', `${patient.name}に電話`);
      phone.textContent = '☎';
      item.append(phone);
    }
    const photoCount = photoCounts.get(patient.id) ?? 0;
    if (photoCount > 0) {
      const photos = document.createElement('button');
      photos.type = 'button';
      photos.className = 'photo-count';
      photos.dataset.testid = 'photo-count';
      photos.dataset.id = patient.id;
      photos.textContent = `写真 ${photoCount}`;
      photos.setAttribute('aria-label', `${patient.name}の写真(${photoCount}枚)`);
      photos.addEventListener('click', () => handlers.onOpenPhotos(patient.id));
      item.append(photos);
    }
    if (!patient.location) {
      const pin = document.createElement('button');
      pin.type = 'button';
      pin.className = 'location-pin';
      pin.dataset.testid = 'location-pin';
      pin.dataset.id = patient.id;
      pin.setAttribute('aria-label', `${patient.name}の位置を登録`);
      pin.textContent = '位置';
      pin.addEventListener('click', () => handlers.onOpenLocation(patient.id));
      item.append(pin);
    }
    const at = visited.get(patient.id);
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = `visited-toggle${at ? ' done' : ''}`;
    toggle.dataset.testid = 'visited-toggle';
    toggle.dataset.id = patient.id;
    toggle.setAttribute('aria-pressed', String(at !== undefined));
    toggle.setAttribute('aria-label', `${patient.name}を訪問済みにする`);
    toggle.textContent = at ? `済 ${formatTime(at)}` : '済';
    toggle.addEventListener('click', () => handlers.onToggleVisited(patient.id));
    item.append(toggle);
    list.append(item);
  }
  return list;
}

/** 名前の下に出す、駐車のバッジとメモの要約。どちらも無ければ null。 */
function renderStopInfo(patient: Patient): HTMLElement | null {
  const badge = parkingBadge(patient.parking);
  const summary = noteSummary(patient.note);
  if (!badge && summary === '') {
    return null;
  }
  const info = document.createElement('p');
  info.className = 'route-stop-info';
  info.dataset.testid = 'route-stop-info';
  if (badge) {
    const badgeElement = document.createElement('span');
    badgeElement.className = 'parking-badge';
    badgeElement.dataset.testid = 'parking-badge';
    badgeElement.textContent = badge.icon;
    info.append(badgeElement, document.createTextNode(` ${badge.text}`));
  }
  if (summary !== '') {
    const truncated =
      summary.length > NOTE_SUMMARY_MAX_LENGTH ? `${summary.slice(0, NOTE_SUMMARY_MAX_LENGTH)}…` : summary;
    info.append(document.createTextNode(badge ? ` / ${truncated}` : truncated));
  }
  return info;
}
