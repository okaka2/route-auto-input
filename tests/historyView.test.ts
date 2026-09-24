import { describe, expect, it, vi } from 'vitest';
import type { HistoryEntry } from '../src/db';
import { createPatient } from '../src/patient';
import { createInitialState } from '../src/state';
import { renderHistory, type HistoryHandlers } from '../src/views/historyView';

const handlers = (): HistoryHandlers => ({ onOpenEntry: vi.fn(), onFilterWeekday: vi.fn(), onPick: vi.fn(), onCopyVisits: vi.fn(), onBack: vi.fn() });
const q = <T extends HTMLElement = HTMLElement>(e: HTMLElement, t: string) => e.querySelector<T>(`[data-testid="${t}"]`)!;
const a = createPatient('山田 太郎', 'x'); const b = createPatient('佐藤 花子', 'y'); const c = createPatient('鈴木', 'z'); const d = createPatient('高橋', 'w');
const entry = (date: string, ids: string[]): HistoryEntry => ({ date, ids, routeEnds: { start: 'first', end: 'last' }, visited: {} });
const screen = (openDate: string | null = null, weekday: number | null = null) => ({ ...createInitialState([a, b, c, d]), screen: { name: 'history' as const, openDate, weekday } });

describe('renderHistory', () => {
  it('日付・曜日・人数・先頭3人を行に出す', () => {
    const element = renderHistory(screen(), [entry('2026-09-22', [a.id, b.id, c.id, d.id])], handlers());
    const row = q(element, 'history-row');
    expect(row.textContent).toContain('9/22(火)');
    expect(row.textContent).toContain('4人');
    expect(row.textContent).toContain('山田 太郎・佐藤 花子・鈴木…');
  });
  it('記録が無ければ案内', () => {
    expect(renderHistory(screen(), [], handlers()).textContent).toContain('まだ記録がありません');
  });
  it('曜日で絞り込める(押すと onFilterWeekday、選択中は aria-pressed)', () => {
    const spies = handlers();
    const element = renderHistory(screen(null, 2), [entry('2026-09-22', [a.id]), entry('2026-09-23', [b.id])], spies);
    expect(element.querySelectorAll('[data-testid="history-row"]')).toHaveLength(1);
    const tue = element.querySelector<HTMLButtonElement>('[data-testid="weekday-2"]')!;
    expect(tue.getAttribute('aria-pressed')).toBe('true');
    tue.click();
    expect(spies.onFilterWeekday).toHaveBeenCalledWith(null);
  });
  it('行を押すと onOpenEntry(date)、開いた行には全員と「この人たちを選ぶ」', () => {
    const spies = handlers();
    const closed = renderHistory(screen(), [entry('2026-09-22', [a.id, b.id])], spies);
    q<HTMLButtonElement>(closed, 'history-row').click();
    expect(spies.onOpenEntry).toHaveBeenCalledWith('2026-09-22');
    const open = renderHistory(screen('2026-09-22'), [entry('2026-09-22', [a.id, b.id])], spies);
    expect(q(open, 'history-detail').textContent).toContain('1. 山田 太郎');
    expect(q(open, 'history-detail').textContent).toContain('2. 佐藤 花子');
    q<HTMLButtonElement>(open, 'history-pick').click();
    expect(spies.onPick).toHaveBeenCalledWith('2026-09-22');
  });
  it('名簿にない人は「(名簿にありません)」と出す', () => {
    const open = renderHistory(screen('2026-09-22'), [entry('2026-09-22', [a.id, 'gone'])], handlers());
    expect(q(open, 'history-detail').textContent).toContain('(名簿にありません)');
  });
});
