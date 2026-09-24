import 'fake-indexeddb/auto';
import { deleteDB } from 'idb';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearHistory,
  closeDbForTest,
  deleteHistoryBefore,
  deleteMeta,
  deletePatient,
  deletePatients,
  getHistory,
  getMeta,
  listHistory,
  listPatients,
  mergePatients,
  putHistory,
  replaceAllPatients,
  savePatient,
  setMeta,
  updateHistory,
  type HistoryEntry,
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

describe('meta(設定値の保存)', () => {
  it('保存していないキーは undefined', async () => {
    expect(await getMeta('lastBackupAt')).toBeUndefined();
  });
  it('保存した値を読み戻せ、同じキーは上書きされる', async () => {
    await setMeta('lastBackupAt', '2026-09-20T00:00:00.000Z');
    await setMeta('lastBackupAt', '2026-09-21T00:00:00.000Z');
    expect(await getMeta('lastBackupAt')).toBe('2026-09-21T00:00:00.000Z');
  });
});

describe('meta: 事業所と出発・帰着', () => {
  it('事業所を保存・削除できる', async () => {
    await setMeta('office', { name: '本店', address: '東京都中央区1-1' });
    expect(await getMeta('office')).toEqual({ name: '本店', address: '東京都中央区1-1' });
    await deleteMeta('office');
    expect(await getMeta('office')).toBeUndefined();
  });
  it('出発・帰着の選び方を保存できる', async () => {
    await setMeta('routeEnds', { start: 'office', end: 'last' });
    expect(await getMeta('routeEnds')).toEqual({ start: 'office', end: 'last' });
  });
});

const h = (date: string): HistoryEntry => ({ date, ids: ['a'], routeEnds: { start: 'first', end: 'last' }, visited: {} });

describe('history', () => {
  it('日付をキーに保存・上書きし、新しい順に一覧できる', async () => {
    await putHistory(h('2026-09-20'));
    await putHistory(h('2026-09-22'));
    await putHistory({ ...h('2026-09-22'), ids: ['b'] });
    expect((await listHistory()).map((e) => e.date)).toEqual(['2026-09-22', '2026-09-20']);
    expect((await getHistory('2026-09-22'))?.ids).toEqual(['b']);
  });
  it('指定の日付より前を消し、件数を返す', async () => {
    await putHistory(h('2026-07-01'));
    await putHistory(h('2026-08-15'));
    await putHistory(h('2026-09-22'));
    expect(await deleteHistoryBefore('2026-07-31')).toBe(1);
    expect((await listHistory()).map((e) => e.date)).toEqual(['2026-09-22', '2026-08-15']);
    await clearHistory();
    expect(await listHistory()).toEqual([]);
  });
  it('updateHistoryは読み取りと書き込みの間に他の書き込みを割り込ませない(同時実行しても両方残る)', async () => {
    await putHistory(h('2026-09-22'));
    await Promise.all([
      updateHistory('2026-09-22', (current) => ({ ...current!, visited: { ...current!.visited, x: '10:00' } })),
      updateHistory('2026-09-22', (current) => ({ ...current!, visited: { ...current!.visited, y: '10:01' } })),
    ]);
    const stored = await getHistory('2026-09-22');
    expect(stored?.visited).toEqual({ x: '10:00', y: '10:01' });
  });
});
