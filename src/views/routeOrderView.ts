import { MAX_STOPS_PER_ROUTE } from '../config';
import { stopsPerRoute, type RouteContext, type RouteEnd, type RouteEnds, type RouteStart } from '../routePlan';
import { selectedPatients } from '../state';
import type { AppState, Patient } from '../types';
import { findDuplicateAddresses } from '../validation';
import { renderMessage, renderScreenHeader } from './common';

export type RouteOrderHandlers = {
  onMove(id: string, direction: -1 | 1): void;
  /** 「⋯」。先頭へ/最後へ動かすメニューを開く。 */
  onOpenStopMenu(id: string): void;
  /** 「＋ 訪問先を追加」。訪問先を選ぶ画面へ戻る。 */
  onAddStops(): void;
  /** 「この順番で地図を開く →」。地図を開く画面へ進む。 */
  onOpenMap(): void;
  onBack(): void;
  /** 出発・帰着の選び方を変えた。 */
  onEndsChange(ends: RouteEnds): void;
};

const START_OPTIONS: { value: RouteStart; label: string; needsOffice: boolean }[] = [
  { value: 'office', label: '事業所から出発', needsOffice: true },
  { value: 'current', label: '現在地から出発', needsOffice: false },
  { value: 'first', label: '1件目の訪問先から', needsOffice: false },
];
const END_OPTIONS: { value: RouteEnd; label: string; needsOffice: boolean }[] = [
  { value: 'office', label: '事業所に戻る', needsOffice: true },
  { value: 'last', label: '最後の訪問先で終わる', needsOffice: false },
];

/**
 * 訪問順の画面。START から GOAL までを、番号つきの縦の並びで示し、▲▼で並べ替える。
 * 訪問順の自動最適化はしない。ユーザーが決めた順番のまま、地図の画面へ渡す。
 */
export function renderRouteOrder(state: AppState, context: RouteContext, handlers: RouteOrderHandlers): HTMLElement {
  const container = document.createElement('div');
  container.className = 'screen';
  container.append(renderScreenHeader('訪問順を決める', { onBack: handlers.onBack }));

  if (state.message) {
    container.append(renderMessage(state.message));
  }

  container.append(renderEndsPanel(context, handlers));

  const stops = selectedPatients(state);

  if (findDuplicateAddresses(stops).length > 0) {
    // ブロックはしない。注意だけを出して、そのまま開けるようにする。
    const warning = renderMessage({
      kind: 'error',
      text: '⚠ 同じ住所の訪問先が複数含まれています。このまま開くこともできます。',
    });
    warning.dataset.testid = 'duplicate-warning';
    container.append(warning);
  }

  if (stops.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'hint';
    empty.textContent = '訪問先が選ばれていません。「＋ 訪問先を追加」から選んでください。';
    container.append(empty, renderAddButton(handlers));
    return container;
  }

  if (stops.length === 1) {
    const single = document.createElement('p');
    single.className = 'hint';
    single.textContent = '1件だけのときは、その場所を地図で開きます。';
    container.append(single);
  }

  const perRoute = stopsPerRoute(context.ends, context.office, MAX_STOPS_PER_ROUTE);
  const list = document.createElement('ol');
  list.className = 'stop-timeline';
  stops.forEach((patient, index) => {
    if (index > 0 && index % perRoute === 0) {
      const divider = document.createElement('li');
      divider.className = 'route-divider';
      divider.dataset.testid = 'route-divider';
      divider.setAttribute('aria-label', `ここからルート${index / perRoute + 1}`);
      divider.textContent = `── ここからルート${index / perRoute + 1} ──`;
      list.append(divider);
    }
    list.append(renderStopRow(patient, index, stops.length, handlers));
  });
  container.append(list);

  const hint = document.createElement('p');
  hint.className = 'order-hint';
  hint.dataset.testid = 'order-hint';
  hint.textContent = `▲▼ボタンで、順番を入れ替えられます。訪問先は1ルート${perRoute}件までです。`;
  container.append(hint);

  const actions = document.createElement('div');
  actions.className = 'order-actions';
  const openMap = document.createElement('button');
  openMap.type = 'button';
  openMap.className = 'primary block';
  openMap.dataset.testid = 'open-map-button';
  openMap.textContent = 'この順番で地図を開く →';
  openMap.addEventListener('click', () => handlers.onOpenMap());
  actions.append(renderAddButton(handlers), openMap);
  container.append(actions);

  return container;
}

function renderAddButton(handlers: RouteOrderHandlers): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'block';
  button.dataset.testid = 'add-stops-button';
  button.textContent = '＋ 訪問先を追加';
  button.addEventListener('click', () => handlers.onAddStops());
  return button;
}

function renderStopRow(
  patient: Patient,
  index: number,
  total: number,
  handlers: RouteOrderHandlers,
): HTMLElement {
  const row = document.createElement('li');
  row.className = 'stop-row';
  row.dataset.testid = 'stop-row';

  const rail = document.createElement('div');
  rail.className = 'stop-rail';
  const number = document.createElement('span');
  number.className = 'stop-number';
  number.setAttribute('aria-hidden', 'true');
  number.textContent = String(index + 1);
  rail.append(number);

  const body = document.createElement('div');
  body.className = 'stop-body';
  // 1件だけのときは、始点も終点もないので、バッジを出さない。
  if (total > 1 && (index === 0 || index === total - 1)) {
    const badge = document.createElement('span');
    badge.className = index === 0 ? 'stop-badge start' : 'stop-badge goal';
    badge.dataset.testid = 'stop-badge';
    badge.textContent = index === 0 ? 'START' : 'GOAL';
    body.append(badge);
  }
  const name = document.createElement('div');
  name.className = 'stop-name';
  name.textContent = patient.name;
  const address = document.createElement('div');
  address.className = 'stop-address';
  address.textContent = patient.address;
  body.append(name, address);

  const move = document.createElement('div');
  move.className = 'stop-move';
  const up = document.createElement('button');
  up.type = 'button';
  up.textContent = '▲';
  up.dataset.testid = 'move-up';
  up.dataset.id = patient.id;
  up.disabled = index === 0;
  up.setAttribute('aria-label', `${patient.name}を上へ`);
  up.addEventListener('click', () => handlers.onMove(patient.id, -1));
  const down = document.createElement('button');
  down.type = 'button';
  down.textContent = '▼';
  down.dataset.testid = 'move-down';
  down.dataset.id = patient.id;
  down.disabled = index === total - 1;
  down.setAttribute('aria-label', `${patient.name}を下へ`);
  down.addEventListener('click', () => handlers.onMove(patient.id, 1));
  const stopMenu = document.createElement('button');
  stopMenu.type = 'button';
  stopMenu.textContent = '⋯';
  stopMenu.className = 'stop-menu-button';
  stopMenu.dataset.testid = 'stop-menu';
  stopMenu.dataset.id = patient.id;
  stopMenu.setAttribute('aria-label', `${patient.name}の順番のメニュー`);
  stopMenu.addEventListener('click', () => handlers.onOpenStopMenu(patient.id));
  move.append(up, down, stopMenu);

  row.append(rail, body, move);
  return row;
}

function renderEndsPanel(context: RouteContext, handlers: RouteOrderHandlers): HTMLElement {
  const panel = document.createElement('section');
  panel.className = 'card ends-panel';
  panel.dataset.testid = 'ends-panel';
  const hasOffice = context.office !== null;
  const start = selectFor('route-start-select', '出発', START_OPTIONS, context.ends.start, hasOffice);
  const end = selectFor('route-end-select', '帰着', END_OPTIONS, context.ends.end, hasOffice);
  start.addEventListener('change', () => handlers.onEndsChange({ start: start.value as RouteStart, end: end.value as RouteEnd }));
  end.addEventListener('change', () => handlers.onEndsChange({ start: start.value as RouteStart, end: end.value as RouteEnd }));
  const row = document.createElement('div');
  row.className = 'ends-row';
  row.append(labelled('出発', start), labelled('帰着', end));
  panel.append(row);
  if (!hasOffice) {
    const hint = document.createElement('p');
    hint.className = 'hint';
    hint.textContent = '設定で事業所を登録すると、事業所から出発・事業所に戻るを選べます。';
    panel.append(hint);
  }
  return panel;
}

function selectFor<V extends string>(
  testid: string,
  label: string,
  options: { value: V; label: string; needsOffice: boolean }[],
  current: V,
  hasOffice: boolean,
): HTMLSelectElement {
  const select = document.createElement('select');
  select.dataset.testid = testid;
  select.setAttribute('aria-label', label);
  for (const option of options) {
    const element = document.createElement('option');
    element.value = option.value;
    element.textContent = option.label;
    element.disabled = option.needsOffice && !hasOffice;
    select.append(element);
  }
  select.value = current;
  return select;
}

function labelled(text: string, select: HTMLSelectElement): HTMLLabelElement {
  const label = document.createElement('label');
  label.className = 'ends-field';
  const caption = document.createElement('span');
  caption.className = 'field-label';
  caption.textContent = text;
  label.append(caption, select);
  return label;
}
