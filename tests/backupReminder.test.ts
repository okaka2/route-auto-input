import { describe, expect, it } from 'vitest';
import { daysBetween, formatLastBackup, shouldRemindBackup } from '../src/backupReminder';

const now = new Date('2026-09-24T09:00:00');
const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();

describe('shouldRemindBackup', () => {
  it('一度もバックアップしておらず、5件以上なら出す', () => {
    expect(shouldRemindBackup({ patientCount: 5, lastBackupAt: null, laterAt: null, now })).toBe(true);
    expect(shouldRemindBackup({ patientCount: 4, lastBackupAt: null, laterAt: null, now })).toBe(false);
  });
  it('前回から30日たてば、件数に関係なく出す', () => {
    expect(shouldRemindBackup({ patientCount: 1, lastBackupAt: daysAgo(30), laterAt: null, now })).toBe(true);
    expect(shouldRemindBackup({ patientCount: 100, lastBackupAt: daysAgo(29), laterAt: null, now })).toBe(false);
  });
  it('「あとで」を押してから7日間は出さない', () => {
    expect(shouldRemindBackup({ patientCount: 10, lastBackupAt: null, laterAt: daysAgo(6), now })).toBe(false);
    expect(shouldRemindBackup({ patientCount: 10, lastBackupAt: null, laterAt: daysAgo(7), now })).toBe(true);
  });
});

describe('formatLastBackup', () => {
  it('月日と何日前かを出す。今日なら「今日」', () => {
    expect(formatLastBackup(daysAgo(4), now)).toBe('9月20日(4日前)');
    expect(formatLastBackup(now.toISOString(), now)).toBe('9月24日(今日)');
  });
});

describe('daysBetween', () => {
  it('日付の境界で揃えた、経過日数を返す', () => {
    expect(daysBetween(daysAgo(4), now)).toBe(4);
    expect(daysBetween(now.toISOString(), now)).toBe(0);
  });
  it('同じ日のうちの時刻差は、0日として扱う', () => {
    const morning = new Date('2026-09-24T00:30:00').toISOString();
    expect(daysBetween(morning, now)).toBe(0);
  });
});
