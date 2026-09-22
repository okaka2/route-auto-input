import 'fake-indexeddb/auto';
import { deleteDB } from 'idb';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  closeDbForTest,
  deletePatient,
  deletePatients,
  listPatients,
  mergePatients,
  replaceAllPatients,
  savePatient,
} from '../src/db';
import { createPatient, updatePatientFields } from '../src/patient';

// 接続を閉じてから消す。開いたままだと deleteDB がブロックされ、
// 前のテストのデータが次のテストへ漏れる。
beforeEach(async () => {
  await closeDbForTest();
  await deleteDB('route-auto-input');
});

describe('患者の保存と取得', () => {
  it('保存した患者を取得できる', async () => {
    const patient = createPatient('山田 太郎', '東京都千代田区1-1');
    await savePatient(patient);
    expect(await listPatients()).toEqual([patient]);
  });

  it('登録が新しい患者が先頭に来る', async () => {
    const older = createPatient('山田', '東京都', new Date('2026-09-01T00:00:00.000Z'));
    const newer = createPatient('鈴木', '大阪府', new Date('2026-09-02T00:00:00.000Z'));
    await savePatient(older);
    await savePatient(newer);
    expect((await listPatients()).map((p) => p.name)).toEqual(['鈴木', '山田']);
  });

  it('同じidで保存すると上書きされる', async () => {
    const patient = createPatient('山田', '東京都');
    await savePatient(patient);
    await savePatient(updatePatientFields(patient, '山田 花子', '大阪府'));
    const stored = await listPatients();
    expect(stored).toHaveLength(1);
    expect(stored[0]?.name).toBe('山田 花子');
  });

  it('削除できる', async () => {
    const patient = createPatient('山田', '東京都');
    await savePatient(patient);
    await deletePatient(patient.id);
    expect(await listPatients()).toEqual([]);
  });

  it('複数件まとめて削除できる', async () => {
    const a = createPatient('山田', '東京都');
    const b = createPatient('鈴木', '大阪府');
    const c = createPatient('田中', '京都府');
    await savePatient(a);
    await savePatient(b);
    await savePatient(c);
    await deletePatients([a.id, c.id]);
    expect((await listPatients()).map((p) => p.name)).toEqual(['鈴木']);
  });
});

describe('インポート', () => {
  it('replaceAllPatientsは既存データを消してから入れ替える', async () => {
    await savePatient(createPatient('既存', '東京都'));
    const imported = [createPatient('取込1', '大阪府'), createPatient('取込2', '京都府')];
    await replaceAllPatients(imported);
    const stored = await listPatients();
    expect(stored).toHaveLength(2);
    expect(stored.map((p) => p.name).sort()).toEqual(['取込1', '取込2']);
  });

  it('mergePatientsは既存データを残したまま追加する', async () => {
    const existing = createPatient('既存', '東京都');
    await savePatient(existing);
    await mergePatients([createPatient('追加', '大阪府')]);
    expect(await listPatients()).toHaveLength(2);
  });

  it('mergePatientsは同じidを上書きする', async () => {
    const existing = createPatient('既存', '東京都');
    await savePatient(existing);
    await mergePatients([updatePatientFields(existing, '更新後', '大阪府')]);
    const stored = await listPatients();
    expect(stored).toHaveLength(1);
    expect(stored[0]?.name).toBe('更新後');
  });
});
