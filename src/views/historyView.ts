import type { HistoryEntry } from '../db';
import { formatHistoryDate, formatVisits, WEEKDAY_LABELS, weekdayOf } from '../history';
import type { AppState } from '../types';
import { renderMessage, renderScreenHeader } from './common';

export type HistoryHandlers = {
  onOpenEntry(date: string | null): void;
  onFilterWeekday(weekday: number | null): void;
  onPick(date: string): void;
  onCopyVisits(date: string): void;
  onBack(): void;
};

/** 履歴の画面。日付ごとの記録を新しい順に並べ、曜日で絞り込み、開いた記録から同じ人を選び直せる。 */
export function renderHistory(state: AppState, entries: readonly HistoryEntry[], handlers: HistoryHandlers): HTMLElement {
  const screen = state.screen.name === 'history' ? state.screen : { openDate: null, weekday: null };
  const container = document.createElement('div');
  container.className = 'screen';
  container.append(renderScreenHeader('履歴から選ぶ', { onBack: handlers.onBack }));
  if (state.message) container.append(renderMessage(state.message));
  container.append(renderWeekdayFilter(screen.weekday, handlers));

  const shown = screen.weekday === null ? entries : entries.filter((e) => weekdayOf(e.date) === screen.weekday);
  if (shown.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'hint';
    empty.textContent = entries.length === 0 ? 'まだ記録がありません。地図を開くと、その日の訪問先が記録されます。' : 'この曜日の記録はありません。';
    container.append(empty);
    return container;
  }
  const list = document.createElement('ul');
  list.className = 'history-list';
  for (const entry of shown) {
    list.append(renderEntry(entry, entry.date === screen.openDate, state, handlers));
  }
  container.append(list);
  return container;
}

function renderWeekdayFilter(current: number | null, handlers: HistoryHandlers): HTMLElement {
  const row = document.createElement('div');
  row.className = 'weekday-filter';
  row.setAttribute('role', 'group');
  row.setAttribute('aria-label', '曜日で絞り込む');
  WEEKDAY_LABELS.forEach((label, weekday) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `segment${current === weekday ? ' pressed' : ''}`;
    button.dataset.testid = `weekday-${weekday}`;
    button.setAttribute('aria-pressed', String(current === weekday));
    button.textContent = label;
    button.addEventListener('click', () => handlers.onFilterWeekday(current === weekday ? null : weekday));
    row.append(button);
  });
  return row;
}

function renderEntry(entry: HistoryEntry, open: boolean, state: AppState, handlers: HistoryHandlers): HTMLElement {
  const byId = new Map(state.patients.map((p) => [p.id, p]));
  const names = entry.ids.map((id) => byId.get(id)?.name ?? null);
  const item = document.createElement('li');
  item.className = `history-item${open ? ' open' : ''}`;

  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'history-row';
  row.dataset.testid = 'history-row';
  row.setAttribute('aria-expanded', String(open));
  const head = document.createElement('span');
  head.className = 'history-head';
  head.textContent = `${formatHistoryDate(entry.date)}  ${entry.ids.length}人`;
  const preview = document.createElement('span');
  preview.className = 'history-preview';
  const shown = names.filter((n): n is string => n !== null).slice(0, 3);
  preview.textContent = shown.join('・') + (names.length > 3 ? '…' : '');
  row.append(head, preview);
  row.addEventListener('click', () => handlers.onOpenEntry(open ? null : entry.date));
  item.append(row);

  if (open) {
    const detail = document.createElement('div');
    detail.className = 'history-detail';
    detail.dataset.testid = 'history-detail';
    const ol = document.createElement('ol');
    ol.className = 'history-names';
    names.forEach((name, index) => {
      const li = document.createElement('li');
      li.textContent = `${index + 1}. ${name ?? '(名簿にありません)'}`;
      ol.append(li);
    });
    detail.append(ol);
    const visits = formatVisits(entry, state.patients);
    if (visits !== '') {
      const p = document.createElement('p');
      p.className = 'history-visits';
      p.dataset.testid = 'history-visits';
      p.textContent = `訪問: ${visits}`;
      const copy = document.createElement('button');
      copy.type = 'button';
      copy.dataset.testid = 'history-copy';
      copy.textContent = 'コピー';
      copy.addEventListener('click', () => handlers.onCopyVisits(entry.date));
      detail.append(p, copy);
    }
    const pick = document.createElement('button');
    pick.type = 'button';
    pick.className = 'primary block';
    pick.dataset.testid = 'history-pick';
    pick.textContent = 'この人たちを選ぶ';
    pick.addEventListener('click', () => handlers.onPick(entry.date));
    detail.append(pick);
    item.append(detail);
  }
  return item;
}
