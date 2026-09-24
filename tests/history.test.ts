import { describe, expect, it } from 'vitest';
import type { HistoryEntry } from '../src/db';
import { dateKey, formatHistoryDate, formatVisits, keepFromDate, lastWeekSameWeekday, restoreSelection, weekdayOf } from '../src/history';
import { createPatient } from '../src/patient';

const entry = (date: string, ids: string[], visited: Record<string, string> = {}): HistoryEntry => ({ date, ids, routeEnds: { start: 'first', end: 'last' }, visited });

describe('日付', () => {
  it('dateKey はローカル日付の YYYY-MM-DD', () => {
    expect(dateKey(new Date(2026, 8, 22, 23, 59))).toBe('2026-09-22');
    expect(dateKey(new Date(2026, 0, 5, 0, 1))).toBe('2026-01-05');
  });
  it('曜日と表示', () => {
    expect(weekdayOf('2026-09-22')).toBe(2);
    expect(formatHistoryDate('2026-09-22')).toBe('9/22(火)');
  });
  it('keepFromDate は56日前', () => {
    expect(keepFromDate(new Date(2026, 8, 25))).toBe('2026-07-31');
  });
});

describe('lastWeekSameWeekday', () => {
  it('7日前の記録があれば返す', () => {
    const entries = [entry('2026-09-22', ['a']), entry('2026-09-18', ['b'])];
    expect(lastWeekSameWeekday(entries, new Date(2026, 8, 29))?.date).toBe('2026-09-22');
    expect(lastWeekSameWeekday(entries, new Date(2026, 8, 28))).toBeNull();
  });
});

describe('restoreSelection', () => {
  it('名簿にある人だけを順番どおりに返し、無い人を数える', () => {
    const a = createPatient('a', 'x');
    const b = createPatient('b', 'y');
    const result = restoreSelection(entry('2026-09-22', [b.id, 'gone', a.id]), [a, b]);
    expect(result.ids).toEqual([b.id, a.id]);
    expect(result.missing).toBe(1);
  });
});

describe('formatVisits', () => {
  it('済の人だけを時刻順に「時:分 名前」で並べる', () => {
    const a = createPatient('山田 太郎', 'x');
    const b = createPatient('佐藤 花子', 'y');
    const c = createPatient('鈴木', 'z');
    const e = entry('2026-09-22', [a.id, b.id, c.id], {
      [b.id]: new Date(2026, 8, 22, 10, 5).toISOString(),
      [a.id]: new Date(2026, 8, 22, 9, 12).toISOString(),
    });
    expect(formatVisits(e, [a, b, c])).toBe('9:12 山田 太郎 → 10:05 佐藤 花子');
  });
  it('済が無ければ空文字', () => {
    expect(formatVisits(entry('2026-09-22', []), [])).toBe('');
  });
});
