import { describe, expect, it } from 'vitest';
import { createPatient, updatePatientFields } from '../src/patient';

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
