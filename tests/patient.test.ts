import { describe, expect, it } from 'vitest';
import { createPatient, updatePatientFields, withLocation, withVisitInfo } from '../src/patient';
import type { GeoLocation } from '../src/types';

describe('createPatient', () => {
  it('氏名と住所の前後の空白を取り除く', () => {
    const patient = createPatient('  山田 太郎 ', ' 東京都千代田区1-1 ');
    expect(patient.name).toBe('山田 太郎');
    expect(patient.address).toBe('東京都千代田区1-1');
  });

  it('idを付与し、作成日時と更新日時を同じISO文字列にする', () => {
    const now = new Date('2026-09-02T09:00:00.000Z');
    const patient = createPatient('山田', '東京都', now);
    expect(patient.id).not.toBe('');
    expect(patient.createdAt).toBe('2026-09-02T09:00:00.000Z');
    expect(patient.updatedAt).toBe('2026-09-02T09:00:00.000Z');
  });

  it('別々に作った患者のidは重複しない', () => {
    const a = createPatient('山田', '東京都');
    const b = createPatient('鈴木', '大阪府');
    expect(a.id).not.toBe(b.id);
  });
});

describe('updatePatientFields', () => {
  it('idと作成日時を保ったまま、氏名・住所・更新日時を書き換える', () => {
    const original = createPatient('山田', '東京都', new Date('2026-09-01T00:00:00.000Z'));
    const updated = updatePatientFields(original, '山田 花子', '大阪府', new Date('2026-09-02T00:00:00.000Z'));
    expect(updated.id).toBe(original.id);
    expect(updated.createdAt).toBe('2026-09-01T00:00:00.000Z');
    expect(updated.name).toBe('山田 花子');
    expect(updated.address).toBe('大阪府');
    expect(updated.updatedAt).toBe('2026-09-02T00:00:00.000Z');
  });
});

describe('withLocation', () => {
  const location: GeoLocation = { lat: 35, lng: 139, accuracy: 12, recordedAt: '2026-09-22T01:00:00.000Z', source: 'gps' };

  it('位置を付けられる', () => {
    const patient = createPatient('山田', '東京都');
    const updated = withLocation(patient, location, new Date('2026-09-23T00:00:00.000Z'));
    expect(updated.location).toEqual(location);
  });

  it('nullを渡すと位置が外れる', () => {
    const patient = { ...createPatient('山田', '東京都'), location };
    const updated = withLocation(patient, null, new Date('2026-09-23T00:00:00.000Z'));
    expect('location' in updated).toBe(false);
  });

  it('updatedAtが進む', () => {
    const patient = createPatient('山田', '東京都', new Date('2026-09-01T00:00:00.000Z'));
    const updated = withLocation(patient, location, new Date('2026-09-23T00:00:00.000Z'));
    expect(updated.updatedAt).toBe('2026-09-23T00:00:00.000Z');
  });

  it('他の項目(電話番号など)は変わらない', () => {
    const patient = createPatient('山田', '東京都', new Date(), '090-1234-5678');
    const updated = withLocation(patient, location, new Date('2026-09-23T00:00:00.000Z'));
    expect(updated.phone).toBe('090-1234-5678');
    expect(updated.name).toBe('山田');
    expect(updated.address).toBe('東京都');
    expect(updated.id).toBe(patient.id);
    expect(updated.createdAt).toBe(patient.createdAt);
  });
});

describe('withVisitInfo', () => {
  it('駐車の種類とメモを付けられる', () => {
    const patient = createPatient('山田', '東京都');
    const updated = withVisitInfo(patient, { parkingType: 'coin', permitExpires: '', note: '北側の月極' });
    expect(updated.parking).toEqual({ type: 'coin' });
    expect(updated.note).toBe('北側の月極');
  });

  it('parkingType が空なら parking を外す', () => {
    const patient = { ...createPatient('山田', '東京都'), parking: { type: 'coin' as const } };
    const updated = withVisitInfo(patient, { parkingType: '', permitExpires: '', note: '' });
    expect('parking' in updated).toBe(false);
  });

  it('street_permit 以外は permitExpires を持たない', () => {
    const patient = createPatient('山田', '東京都');
    const updated = withVisitInfo(patient, { parkingType: 'coin', permitExpires: '2027-01-01', note: '' });
    expect(updated.parking).toEqual({ type: 'coin' });
    expect('permitExpires' in (updated.parking ?? {})).toBe(false);
  });

  it('street_permit は permitExpires を持つ(trimする)', () => {
    const patient = createPatient('山田', '東京都');
    const updated = withVisitInfo(patient, { parkingType: 'street_permit', permitExpires: ' 2027-01-01 ', note: '' });
    expect(updated.parking).toEqual({ type: 'street_permit', permitExpires: '2027-01-01' });
  });

  it('street_permit でも、YYYY-MM-DD の形でなければ permitExpires を持たない', () => {
    const patient = createPatient('山田', '東京都');
    const updated = withVisitInfo(patient, { parkingType: 'street_permit', permitExpires: '2027/01/01', note: '' });
    expect(updated.parking).toEqual({ type: 'street_permit' });
  });

  it('note は trim して、空白だけなら外す', () => {
    const patient = { ...createPatient('山田', '東京都'), note: '前のメモ' };
    const updated = withVisitInfo(patient, { parkingType: '', permitExpires: '', note: '  ' });
    expect('note' in updated).toBe(false);
  });

  it('note を trim して持つ', () => {
    const patient = createPatient('山田', '東京都');
    const updated = withVisitInfo(patient, { parkingType: '', permitExpires: '', note: '  駐車場: 北側  ' });
    expect(updated.note).toBe('駐車場: 北側');
  });

  it('他の項目(電話番号・更新日時など)は変わらない', () => {
    const now = new Date('2026-09-01T00:00:00.000Z');
    const patient = createPatient('山田', '東京都', now, '090-1234-5678');
    const updated = withVisitInfo(patient, { parkingType: 'onsite', permitExpires: '', note: '' });
    expect(updated.phone).toBe('090-1234-5678');
    expect(updated.updatedAt).toBe(now.toISOString());
    expect(updated.id).toBe(patient.id);
  });
});

describe('電話番号', () => {
  it('電話番号は、あれば trim して持ち、空なら持たない', () => {
    expect(createPatient('a', 'b', new Date(), ' 03-1234-5678 ').phone).toBe('03-1234-5678');
    expect('phone' in createPatient('a', 'b')).toBe(false);
    const updated = updatePatientFields(createPatient('a', 'b', new Date(), '090'), 'a', 'b', new Date(), '');
    expect('phone' in updated).toBe(false);
  });
});
