import { describe, expect, it } from 'vitest';
import { MAX_SELECTION } from '../src/config';
import { createPatient } from '../src/patient';
import { findDuplicateAddresses, validatePatientInput, validateSelection } from '../src/validation';

describe('validatePatientInput', () => {
  it('氏名と住所が入っていれば通る', () => {
    expect(validatePatientInput('山田', '東京都')).toEqual({ ok: true });
  });

  it('氏名が空なら通らない', () => {
    const result = validatePatientInput('   ', '東京都');
    expect(result.ok).toBe(false);
  });

  it('住所が空なら通らない', () => {
    const result = validatePatientInput('山田', '');
    expect(result.ok).toBe(false);
  });

  it('エラーメッセージに入力値そのものを含めない', () => {
    const result = validatePatientInput('山田太郎', '   ');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).not.toContain('山田太郎');
    }
  });
});

describe('validateSelection', () => {
  it('1人なら通る', () => {
    expect(validateSelection(1)).toEqual({ ok: true });
  });

  it('上限人数なら通る', () => {
    expect(validateSelection(MAX_SELECTION)).toEqual({ ok: true });
  });

  it('0人なら通らない', () => {
    expect(validateSelection(0).ok).toBe(false);
  });

  it('上限を超えると通らない', () => {
    expect(validateSelection(MAX_SELECTION + 1).ok).toBe(false);
  });
});

describe('findDuplicateAddresses', () => {
  it('重複がなければ空配列を返す', () => {
    const patients = [createPatient('山田', '東京都'), createPatient('鈴木', '大阪府')];
    expect(findDuplicateAddresses(patients)).toEqual([]);
  });

  it('同じ住所が複数あればその住所を返す', () => {
    const patients = [
      createPatient('山田', '東京都1-1'),
      createPatient('鈴木', '大阪府2-2'),
      createPatient('佐藤', '東京都1-1'),
    ];
    expect(findDuplicateAddresses(patients)).toEqual(['東京都1-1']);
  });

  it('3件同じでも住所は1つだけ返す', () => {
    const patients = [
      createPatient('山田', '東京都1-1'),
      createPatient('鈴木', '東京都1-1'),
      createPatient('佐藤', '東京都1-1'),
    ];
    expect(findDuplicateAddresses(patients)).toEqual(['東京都1-1']);
  });
});

describe('入力の文言(名前・住所)', () => {
  it('名前が空のとき「名前を入力してください。」', () => {
    expect(validatePatientInput('  ', '東京都')).toEqual({ ok: false, message: '名前を入力してください。' });
  });

  it('住所が空のとき「住所を入力してください。」', () => {
    expect(validatePatientInput('山田', '')).toEqual({ ok: false, message: '住所を入力してください。' });
  });
});

describe('選択の文言(訪問先・件)', () => {
  it('0件のとき「訪問先を1件以上選んでください。」', () => {
    expect(validateSelection(0)).toEqual({ ok: false, message: '訪問先を1件以上選んでください。' });
  });

  it('上限を超えたとき「一度に選べるのはN件までです。」', () => {
    expect(validateSelection(MAX_SELECTION + 1)).toEqual({
      ok: false,
      message: `一度に選べるのは${MAX_SELECTION}件までです。`,
    });
  });
});
