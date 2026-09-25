import { describe, expect, it } from 'vitest';
import { createPatient } from '../src/patient';
import type { ParkingType } from '../src/types';
import { NOTE_HEADINGS, PARKING_OPTIONS, noteSummary, parkingBadge, permitsExpiringSoon } from '../src/visitInfo';

describe('PARKING_OPTIONS', () => {
  it('未設定を含む6つの選択肢を持つ', () => {
    expect(PARKING_OPTIONS).toHaveLength(6);
    expect(PARKING_OPTIONS[0]).toEqual({ value: '', label: '未設定' });
  });
});

describe('NOTE_HEADINGS', () => {
  it('駐車場・入口・インターホン・鍵・注意の5つ', () => {
    expect(NOTE_HEADINGS).toEqual(['駐車場', '入口', 'インターホン', '鍵', '注意']);
  });
});

it('parkingBadge', () => {
  expect(parkingBadge({ type: 'coin' })).toEqual({ icon: 'P', text: 'コインP' });
  expect(parkingBadge({ type: 'street_permit', permitExpires: '2027-03-31' })).toEqual({
    icon: '許',
    text: '路上・許可証',
  });
  expect(parkingBadge({ type: 'onsite' })).toEqual({ icon: 'P', text: '敷地内OK' });
  expect(parkingBadge({ type: 'management_ok' })).toEqual({ icon: 'P', text: '管理会社OK' });
  expect(parkingBadge({ type: 'unknown' })).toBeNull();
  expect(parkingBadge(undefined)).toBeNull();
});

it('noteSummary は駐車場・入口の行を優先', () => {
  expect(noteSummary('インターホン: 2回\n入口: B棟の裏口\n駐車場: 北側')).toBe('駐車場: 北側');
  expect(noteSummary('インターホン: 2回\n入口: B棟の裏口')).toBe('入口: B棟の裏口');
  expect(noteSummary('\n  鍵: ポスト  \n')).toBe('鍵: ポスト');
  expect(noteSummary(undefined)).toBe('');
  expect(noteSummary('')).toBe('');
});

it('permitsExpiringSoon は30日以内と期限切れを数える', () => {
  const now = new Date(2026, 8, 25);
  const p = (permitExpires?: string, type: ParkingType = 'street_permit') => ({
    ...createPatient('a', 'b'),
    parking: { type, ...(permitExpires ? { permitExpires } : {}) },
  });
  expect(
    permitsExpiringSoon(
      [p('2026-10-25'), p('2026-10-26'), p('2026-09-01'), p(undefined), p('2026-10-01', 'coin')],
      now,
    ),
  ).toBe(2);
  expect(permitsExpiringSoon([], now)).toBe(0);
});
