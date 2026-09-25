import 'fake-indexeddb/auto';
import { deleteDB, openDB } from 'idb';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  addPhoto,
  clearHistory,
  closeDbForTest,
  countPhotosByPatient,
  deleteHistoryBefore,
  deleteMeta,
  deleteOrphanPhotos,
  deletePatient,
  deletePatients,
  deletePhoto,
  deletePhotosOf,
  deleteSpot,
  getHistory,
  getMeta,
  listAllPhotos,
  listHistory,
  listPatients,
  listPhotos,
  listSpots,
  MAX_PHOTOS_PER_PATIENT,
  mergePatients,
  putHistory,
  putPhotos,
  putSpot,
  putSpots,
  replaceAllPatients,
  savePatient,
  setMeta,
  updateHistory,
  type HistoryEntry,
} from '../src/db';
import { createPatient, updatePatientFields } from '../src/patient';
import type { Photo, Spot } from '../src/types';

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

const photo = (patientId: string, createdAt: string, id = `photo-${patientId}-${createdAt}`): Photo => ({
  id,
  patientId,
  blob: new Blob(['x'], { type: 'image/jpeg' }),
  createdAt,
});

describe('写真', () => {
  it('追加した写真を一覧できる(登録した順=古い順。idの並びとは無関係)', async () => {
    // idはUUIDなので、並び順がidの辞書順(z, a, m)になっていたら誤り。
    // createdAtの順(09-20→09-21→09-22)で出ることを確かめる。
    await addPhoto(photo('p1', '2026-09-20T00:00:00.000Z', 'z'));
    await addPhoto(photo('p1', '2026-09-22T00:00:00.000Z', 'a'));
    await addPhoto(photo('p1', '2026-09-21T00:00:00.000Z', 'm'));
    const listed = await listPhotos('p1');
    expect(listed.map((p) => p.id)).toEqual(['z', 'm', 'a']);
    expect(listed.map((p) => p.createdAt)).toEqual([
      '2026-09-20T00:00:00.000Z',
      '2026-09-21T00:00:00.000Z',
      '2026-09-22T00:00:00.000Z',
    ]);
  });

  it('別の訪問先の写真は含まれない', async () => {
    await addPhoto(photo('p1', '2026-09-20T00:00:00.000Z'));
    await addPhoto(photo('p2', '2026-09-20T00:00:00.000Z'));
    expect(await listPhotos('p1')).toHaveLength(1);
  });

  it(`${MAX_PHOTOS_PER_PATIENT}枚までで、超えるとエラーになり書き込まれない`, async () => {
    expect(MAX_PHOTOS_PER_PATIENT).toBe(3);
    await addPhoto(photo('p1', '2026-09-20T00:00:00.000Z', 'a'));
    await addPhoto(photo('p1', '2026-09-21T00:00:00.000Z', 'b'));
    await addPhoto(photo('p1', '2026-09-22T00:00:00.000Z', 'c'));
    await expect(addPhoto(photo('p1', '2026-09-23T00:00:00.000Z', 'd'))).rejects.toThrow(
      '写真は1件につき3枚までです。',
    );
    expect(await listPhotos('p1')).toHaveLength(3);
  });

  it('削除できる', async () => {
    await addPhoto(photo('p1', '2026-09-20T00:00:00.000Z', 'a'));
    await deletePhoto('a');
    expect(await listPhotos('p1')).toEqual([]);
  });

  it('訪問先ごとの件数をMapで返す(1枚も無い訪問先は含まれない)', async () => {
    await addPhoto(photo('p1', '2026-09-20T00:00:00.000Z', 'a'));
    await addPhoto(photo('p1', '2026-09-21T00:00:00.000Z', 'b'));
    await addPhoto(photo('p2', '2026-09-20T00:00:00.000Z', 'c'));
    const counts = await countPhotosByPatient();
    expect(counts).toEqual(new Map([['p1', 2], ['p2', 1]]));
  });

  it('deletePhotosOfで、指定した訪問先ぶんだけ削除する', async () => {
    await addPhoto(photo('p1', '2026-09-20T00:00:00.000Z', 'a'));
    await addPhoto(photo('p2', '2026-09-20T00:00:00.000Z', 'b'));
    await addPhoto(photo('p3', '2026-09-20T00:00:00.000Z', 'c'));
    await deletePhotosOf(['p1', 'p2']);
    expect(await listPhotos('p1')).toEqual([]);
    expect(await listPhotos('p2')).toEqual([]);
    expect(await listPhotos('p3')).toHaveLength(1);
  });

  it('listAllPhotosは全件、putPhotosは上書きで取り込む(バックアップ用)', async () => {
    await addPhoto(photo('p1', '2026-09-20T00:00:00.000Z', 'a'));
    expect(await listAllPhotos()).toHaveLength(1);
    const updated = { ...photo('p1', '2026-09-20T00:00:00.000Z', 'a'), createdAt: '2026-09-25T00:00:00.000Z' };
    await putPhotos([updated, photo('p2', '2026-09-20T00:00:00.000Z', 'b')]);
    const all = await listAllPhotos();
    expect(all).toHaveLength(2);
    expect(all.find((p) => p.id === 'a')?.createdAt).toBe('2026-09-25T00:00:00.000Z');
  });

  it('deleteOrphanPhotosで、名簿に無い訪問先の写真だけ消し、消した件数を返す', async () => {
    await addPhoto(photo('p1', '2026-09-20T00:00:00.000Z', 'a'));
    await addPhoto(photo('gone', '2026-09-20T00:00:00.000Z', 'b'));
    const removed = await deleteOrphanPhotos(new Set(['p1']));
    expect(removed).toBe(1);
    const remaining = await listAllPhotos();
    expect(remaining.map((p) => p.id)).toEqual(['a']);
    expect(remaining[0]?.patientId).toBe('p1');
  });
});

const spot = (kind: Spot['kind'], id = `spot-${kind}`): Spot => ({
  id,
  kind,
  note: 'メモ',
  location: { lat: 35, lng: 139, accuracy: 10, recordedAt: '2026-09-20T00:00:00.000Z', source: 'gps' },
  createdAt: '2026-09-20T00:00:00.000Z',
});

describe('地点(Spot)', () => {
  it('追加・一覧・削除・上書きができる', async () => {
    await putSpot(spot('toilet', 'a'));
    await putSpot(spot('rest', 'b'));
    expect(await listSpots()).toHaveLength(2);

    await putSpot({ ...spot('toilet', 'a'), note: '更新後' });
    const listed = await listSpots();
    expect(listed.find((s) => s.id === 'a')?.note).toBe('更新後');

    await deleteSpot('a');
    expect((await listSpots()).map((s) => s.id)).toEqual(['b']);
  });

  it('putSpotsはまとめて上書きで取り込む(バックアップ用)', async () => {
    await putSpots([spot('toilet', 'a'), spot('parking', 'c')]);
    expect(await listSpots()).toHaveLength(2);
  });
});

describe('v3→v4の移行', () => {
  it('v3で保存したpatients/metaが、v4で読み直しても残り、写真のstoreも使えるようになる', async () => {
    // v3までのstoreを、このアプリのDB定義を経由せず直接作る(v3当時の状態を模す)。
    // beforeEachで接続を閉じ、DBを消してあるので、ここから新規にv3として開ける。
    const legacyDb = await openDB('route-auto-input', 3, {
      upgrade(db) {
        const store = db.createObjectStore('patients', { keyPath: 'id' });
        store.createIndex('createdAt', 'createdAt');
        db.createObjectStore('meta');
        db.createObjectStore('history', { keyPath: 'date' });
      },
    });
    const legacyPatient = createPatient('山田', '東京都');
    await legacyDb.put('patients', legacyPatient);
    await legacyDb.put('meta', '2026-09-20T00:00:00.000Z', 'lastBackupAt');
    const legacyHistory: HistoryEntry = {
      date: '2026-09-20',
      ids: [legacyPatient.id],
      routeEnds: { start: 'first', end: 'last' },
      visited: {},
    };
    await legacyDb.put('history', legacyHistory);
    legacyDb.close();

    // ここからアプリ(v4)のdb.tsを使う。
    expect(await listPatients()).toEqual([legacyPatient]);
    expect(await getMeta('lastBackupAt')).toBe('2026-09-20T00:00:00.000Z');
    expect(await getHistory('2026-09-20')).toEqual(legacyHistory);
    expect(await listPhotos(legacyPatient.id)).toEqual([]);
    await addPhoto(photo(legacyPatient.id, '2026-09-21T00:00:00.000Z', 'new-photo'));
    expect(await listPhotos(legacyPatient.id)).toHaveLength(1);
  });
});
