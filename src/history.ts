import type { HistoryEntry } from './db';
import type { Patient } from './types';

export const HISTORY_KEEP_DAYS = 56;
export const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'] as const;

const pad = (n: number) => String(n).padStart(2, '0');

export function dateKey(now: Date): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function parseKey(date: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y!, m! - 1, d!);
}

export function weekdayOf(date: string): number {
  return parseKey(date).getDay();
}

export function formatHistoryDate(date: string): string {
  const d = parseKey(date);
  return `${d.getMonth() + 1}/${d.getDate()}(${WEEKDAY_LABELS[d.getDay()]})`;
}

export function keepFromDate(now: Date): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - HISTORY_KEEP_DAYS);
  return dateKey(d);
}

export function lastWeekSameWeekday(entries: readonly HistoryEntry[], now: Date): HistoryEntry | null {
  const target = dateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7));
  return entries.find((entry) => entry.date === target) ?? null;
}

export function restoreSelection(entry: HistoryEntry, patients: readonly Patient[]): { ids: string[]; missing: number } {
  const existing = new Set(patients.map((p) => p.id));
  const ids = entry.ids.filter((id) => existing.has(id));
  return { ids, missing: entry.ids.length - ids.length };
}

export function formatVisits(entry: HistoryEntry, patients: readonly Patient[]): string {
  const byId = new Map(patients.map((p) => [p.id, p]));
  return Object.entries(entry.visited)
    .map(([id, at]) => ({ name: byId.get(id)?.name, at: new Date(at) }))
    .filter((v): v is { name: string; at: Date } => v.name !== undefined && !Number.isNaN(v.at.getTime()))
    .sort((a, b) => a.at.getTime() - b.at.getTime())
    .map((v) => `${v.at.getHours()}:${pad(v.at.getMinutes())} ${v.name}`)
    .join(' → ');
}
