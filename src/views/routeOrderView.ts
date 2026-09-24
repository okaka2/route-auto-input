import { MAX_STOPS_PER_ROUTE } from '../config';
import { selectedPatients } from '../state';
import type { AppState, Patient } from '../types';
import { findDuplicateAddresses } from '../validation';
import { renderMessage, renderScreenHeader } from './common';

export type RouteOrderHandlers = {
  onMove(id: string, direction: -1 | 1): void;
  /** 「＋ 訪問先を追加」。訪問先を選ぶ画面へ戻る。 */
  onAddStops(): void;
  /** 「この順番で地図を開く →」。地図を開く画面へ進む。 */
  onOpenMap(): void;
  onBack(): void;
};

/**
 * 訪問順の画面。START から GOAL までを、番号つきの縦の並びで示し、▲▼で並べ替える。
 * 訪問順の自動最適化はしない。ユーザーが決めた順番のまま、地図の画面へ渡す。
 */
export function renderRouteOrder(state: AppState, handlers: RouteOrderHandlers): HTMLElement {
  const container = document.createElement('div');
  container.className = 'screen';
  container.append(renderScreenHeader('訪問順を決める', { onBack: handlers.onBack }));

  if (state.message) {
    container.append(renderMessage(state.message));
  }

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

  const list = document.createElement('ol');
  list.className = 'stop-timeline';
  stops.forEach((patient, index) => {
    if (index > 0 && index % MAX_STOPS_PER_ROUTE === 0) {
      const divider = document.createElement('li');
      divider.className = 'route-divider';
      divider.dataset.testid = 'route-divider';
      divider.setAttribute('aria-label', `ここからルート${index / MAX_STOPS_PER_ROUTE + 1}`);
      divider.textContent = `── ここからルート${index / MAX_STOPS_PER_ROUTE + 1} ──`;
      list.append(divider);
    }
    list.append(renderStopRow(patient, index, stops.length, handlers));
  });
  container.append(list);

  const hint = document.createElement('p');
  hint.className = 'order-hint';
  hint.dataset.testid = 'order-hint';
  hint.textContent = '▲▼ボタンで、順番を入れ替えられます。';
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
  move.append(up, down);

  row.append(rail, body, move);
  return row;
}
