import { describe, expect, it } from 'vitest';
import { BACKUP_VERSION, parseBackup, serializeBackup } from '../src/backup';
import { createPatient } from '../src/patient';

const samplePatients = () => [
  createPatient('山田 太郎', '東京都千代田区1-1'),
  createPatient('鈴木 花子', '大阪市北区2-2'),
];

describe('serializeBackup', () => {
  it('バージョンと書き出し日時と患者一覧を含む', () => {
    const patients = samplePatients();
    const json = JSON.parse(serializeBackup(patients, new Date('2026-09-02T09:00:00.000Z')));
    expect(json.version).toBe(BACKUP_VERSION);
    expect(json.exportedAt).toBe('2026-09-02T09:00:00.000Z');
    expect(json.patients).toHaveLength(2);
  });
});

describe('parseBackup', () => {
  it('書き出したものを読み込むと同じ患者一覧に戻る', () => {
    const patients = samplePatients();
    expect(parseBackup(serializeBackup(patients))).toEqual(patients);
  });

  it('JSONとして壊れていれば例外を投げる', () => {
    expect(() => parseBackup('{ not json')).toThrow();
  });

  it('バージョンが違えば例外を投げる', () => {
    const text = JSON.stringify({ version: 999, exportedAt: '', patients: [] });
    expect(() => parseBackup(text)).toThrow();
  });

  it('patientsが配列でなければ例外を投げる', () => {
    const text = JSON.stringify({ version: BACKUP_VERSION, exportedAt: '', patients: {} });
    expect(() => parseBackup(text)).toThrow();
  });

  it('必須項目が欠けていれば例外を投げる', () => {
    const text = JSON.stringify({
      version: BACKUP_VERSION,
      exportedAt: '',
      patients: [{ id: 'a', name: '山田' }],
    });
    expect(() => parseBackup(text)).toThrow();
  });

  it('例外メッセージに氏名や住所を含めない', () => {
    const text = JSON.stringify({
      version: BACKUP_VERSION,
      exportedAt: '',
      patients: [{ id: 'a', name: '山田太郎', address: '東京都千代田区1-1' }],
    });
    try {
      parseBackup(text);
      expect.unreachable('例外が投げられるはず');
    } catch (error) {
      const message = (error as Error).message;
      expect(message).not.toContain('山田太郎');
      expect(message).not.toContain('千代田');
    }
  });

  it('患者0件のファイルは空配列として読み込める', () => {
    expect(parseBackup(serializeBackup([]))).toEqual([]);
  });

  it('電話番号つきの訪問先も、往復して phone が残る', () => {
    const patients = [createPatient('山田 太郎', '東京都千代田区1-1', new Date(), '03-1234-5678')];
    expect(parseBackup(serializeBackup(patients))).toEqual(patients);
  });

  it('phone が無い古いデータも読み込める', () => {
    const text = JSON.stringify({
      version: BACKUP_VERSION,
      exportedAt: '',
      patients: [
        { id: 'a', name: '山田太郎', address: '東京都千代田区1-1', createdAt: 't1', updatedAt: 't2' },
      ],
    });
    const result = parseBackup(text);
    expect('phone' in result[0]!).toBe(false);
  });
});
