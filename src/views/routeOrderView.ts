import { MAX_STOPS_PER_ROUTE } from '../config';
import { splitIntoRoutes } from '../routeSplitter';
import { selectedPatients } from '../state';
import { findDuplicateAddresses } from '../validation';
import type { AppState, Patient } from '../types';

export type RouteOrderHandlers = {
  onMove(id: string, direction: -1 | 1): void;
  onOpenRoute(routeIndex: number): void;
  onBack(): void;
};

export function renderRouteOrder(
  state: AppState,
  openedRouteIndexes: ReadonlySet<number>,
  handlers: RouteOrderHandlers,
): HTMLElement {
  const container = document.createElement('div');
  const stops = selectedPatients(state);

  const title = document.createElement('h1');
  title.textContent = '訪問順を決める';
  container.append(title);

  if (state.message) {
    const message = document.createElement('p');
    message.className = `message ${state.message.kind}`;
    message.textContent = state.message.text;
    container.append(message);
  }

  const duplicates = findDuplicateAddresses(stops);
  if (duplicates.length > 0) {
    const warning = document.createElement('p');
    warning.className = 'message error';
    warning.dataset.testid = 'duplicate-warning';
    warning.textContent = '同じ住所の患者が複数含まれています。このまま開くこともできます。';
    container.append(warning);
  }

  const list = document.createElement('ol');
  list.className = 'stop-list';
  stops.forEach((patient, index) => {
    list.append(renderStopRow(patient, index, stops.length, handlers));
  });
  container.append(list);

  const routes = splitIntoRoutes(stops, MAX_STOPS_PER_ROUTE);
  if (routes.length > 1) {
    const note = document.createElement('p');
    note.textContent = `1本のルートに入れられるのは${MAX_STOPS_PER_ROUTE}地点までのため、${routes.length}本に分けます。上から順に開いてください。`;
    container.append(note);
  }

  const routeActions = document.createElement('div');
  routeActions.className = 'route-actions';
  routes.forEach((route, index) => {
    routeActions.append(renderOpenButton(route, index, routes.length, openedRouteIndexes, handlers));
  });
  container.append(routeActions);

  const backButton = document.createElement('button');
  backButton.type = 'button';
  backButton.textContent = '一覧へ戻る';
  backButton.dataset.testid = 'back-button';
  backButton.addEventListener('click', () => handlers.onBack());
  container.append(backButton);

  return container;
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

  const role = document.createElement('span');
  role.className = 'stop-role';
  role.textContent = index === 0 ? '出発地' : index === total - 1 ? '到着地' : '経由地';

  const body = document.createElement('div');
  body.className = 'patient-body';
  const name = document.createElement('div');
  name.className = 'patient-name';
  name.textContent = patient.name;
  const address = document.createElement('div');
  address.className = 'patient-address';
  address.textContent = patient.address;
  body.append(name, address);

  const up = document.createElement('button');
  up.type = 'button';
  up.textContent = '↑';
  up.dataset.testid = 'move-up';
  up.dataset.id = patient.id;
  up.disabled = index === 0;
  up.setAttribute('aria-label', `${patient.name} を上へ`);
  up.addEventListener('click', () => handlers.onMove(patient.id, -1));

  const down = document.createElement('button');
  down.type = 'button';
  down.textContent = '↓';
  down.dataset.testid = 'move-down';
  down.dataset.id = patient.id;
  down.disabled = index === total - 1;
  down.setAttribute('aria-label', `${patient.name} を下へ`);
  down.addEventListener('click', () => handlers.onMove(patient.id, 1));

  row.append(role, body, up, down);
  return row;
}

function renderOpenButton(
  route: readonly Patient[],
  index: number,
  routeCount: number,
  openedRouteIndexes: ReadonlySet<number>,
  handlers: RouteOrderHandlers,
): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'primary open-route';
  button.dataset.testid = 'open-route';
  button.dataset.id = String(index);

  const opened = openedRouteIndexes.has(index) ? '✓ ' : '';
  const names = route.map((patient) => patient.name).join(' → ');
  button.textContent =
    routeCount === 1 ? `${opened}Googleマップで開く` : `${opened}ルート${index + 1}を開く(${names})`;

  button.addEventListener('click', () => handlers.onOpenRoute(index));
  return button;
}
