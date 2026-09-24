import { describe, expect, it } from 'vitest';
import { formatDateTime, formatPhoneHref, formatTime } from '../src/format';

// 端末のタイムゾーンに左右されないよう、ローカル時刻の成分から日時を作る。
const local = (month: number, day: number, hour: number, minute: number): string =>
  new Date(2026, month - 1, day, hour, minute).toISOString();

describe('formatDateTime', () => {
  it('月/日 時:分の形にする', () => {
    expect(formatDateTime(local(9, 21, 14, 32))).toBe('9/21 14:32');
  });

  it('分は2桁にそろえ、月・日・時は0を付けない', () => {
    expect(formatDateTime(local(1, 5, 9, 5))).toBe('1/5 9:05');
  });

  it('空文字なら空文字を返す', () => {
    expect(formatDateTime('')).toBe('');
  });

  it('読めない日時なら空文字を返し、例外を投げない', () => {
    expect(formatDateTime('いつか')).toBe('');
  });
});

describe('formatTime', () => {
  it('時:分の形にする(時は0を付けない、分は2桁)', () => {
    expect(formatTime(local(9, 22, 9, 12))).toBe('9:12');
  });

  it('空文字や読めない日時なら空文字を返す', () => {
    expect(formatTime('')).toBe('');
    expect(formatTime('いつか')).toBe('');
  });
});

describe('formatPhoneHref', () => {
  it('数字と+だけを残した tel: リンクにする', () => {
    expect(formatPhoneHref('03-1234-5678')).toBe('tel:0312345678');
    expect(formatPhoneHref('+81 90 1234 5678')).toBe('tel:+819012345678');
  });
});
