import 'fake-indexeddb/auto';
import { deleteDB, openDB } from 'idb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addPhoto,
  applyImport,
  clearHistory,
  closeDbForTest,
  countPhotosByPatient,
  deleteHistoryBefore,
  deleteMeta,
  deleteOrphanPhotos,
  deletePatient,
  deletePatients,
  deletePhoto,
  deleteSpot,
  getHistory,
  getMeta,
  listAllPhotos,
  listHistory,
  listPatients,
  listPhotos,
  listSpots,
  MAX_PHOTOS_PER_PATIENT,
  putHistory,
  putSpot,
  savePatient,
  setDbBlockingHandler,
  setMeta,
  updateHistory,
  withDb,
  type DbImportPlan,
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

const photo = (patientId: string, createdAt: string, id = `photo-${patientId}-${createdAt}`): Photo => ({
  id,
  patientId,
  blob: new Blob(['x'], { type: 'image/jpeg' }),
  createdAt,
});

const spot = (kind: Spot['kind'], id = `spot-${kind}`): Spot => ({
  id,
  kind,
  note: 'メモ',
  location: { lat: 35, lng: 139, accuracy: 10, recordedAt: '2026-09-20T00:00:00.000Z', source: 'gps' },
  createdAt: '2026-09-20T00:00:00.000Z',
});

/** applyImportに渡す最小限の計画。テストごとに変えたいところだけ上書きする。 */
const importPlan = (overrides: Partial<DbImportPlan> = {}): DbImportPlan => ({
  replaceAll: false,
  patients: [],
  replacePhotosOf: [],
  photos: [],
  spots: [],
  meta: {},
  ...overrides,
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

  it('削除できる(写真も同じトランザクションで消える)', async () => {
    const patient = createPatient('山田', '東京都');
    await savePatient(patient);
    await addPhoto(photo(patient.id, '2026-09-20T00:00:00.000Z', 'a'));
    await deletePatient(patient.id);
    expect(await listPatients()).toEqual([]);
    expect(await listPhotos(patient.id)).toEqual([]);
  });

  it('複数件まとめて削除できる(それぞれの写真も消える。対象外の写真は残る)', async () => {
    const a = createPatient('山田', '東京都');
    const b = createPatient('鈴木', '大阪府');
    const c = createPatient('田中', '京都府');
    await savePatient(a);
    await savePatient(b);
    await savePatient(c);
    await addPhoto(photo(a.id, '2026-09-20T00:00:00.000Z', 'photo-a'));
    await addPhoto(photo(c.id, '2026-09-20T00:00:00.000Z', 'photo-c'));
    await addPhoto(photo(b.id, '2026-09-20T00:00:00.000Z', 'photo-b'));
    await deletePatients([a.id, c.id]);
    expect((await listPatients()).map((p) => p.name)).toEqual(['鈴木']);
    expect(await listPhotos(a.id)).toEqual([]);
    expect(await listPhotos(c.id)).toEqual([]);
    expect(await listPhotos(b.id)).toHaveLength(1);
  });
});

describe('applyImport(入れ替え・追加を1つのトランザクションで書く)', () => {
  it('入れ替え(replaceAll)は、前の訪問先を消してファイルの訪問先だけにする', async () => {
    await savePatient(createPatient('既存', '東京都'));
    const imported = [createPatient('取込1', '大阪府'), createPatient('取込2', '京都府')];
    await applyImport(importPlan({ replaceAll: true, patients: imported }));
    const stored = await listPatients();
    expect(stored).toHaveLength(2);
    expect(stored.map((p) => p.name).sort()).toEqual(['取込1', '取込2']);
  });

  it('入れ替えで写真がnullのとき(replacePhotosOf/photosが空)は、残る人の手元の写真に触れない', async () => {
    const kept = createPatient('残る人', '東京都');
    await savePatient(kept);
    await addPhoto(photo(kept.id, '2026-09-20T00:00:00.000Z', 'mine'));
    await applyImport(importPlan({ replaceAll: true, patients: [kept] }));
    expect((await listPhotos(kept.id)).map((p) => p.id)).toEqual(['mine']);
  });

  it('入れ替えで写真があるときは、持ち主のいなくなった写真も含めて消し、ファイルの写真だけが入る', async () => {
    const gone = createPatient('消える人', '東京都');
    const kept = createPatient('残る人', '大阪府');
    await savePatient(gone);
    await savePatient(kept);
    await addPhoto(photo(gone.id, '2026-09-20T00:00:00.000Z', 'old-gone'));
    await addPhoto(photo(kept.id, '2026-09-20T00:00:00.000Z', 'old-kept'));

    await applyImport(
      importPlan({
        replaceAll: true,
        patients: [kept],
        replacePhotosOf: [kept.id],
        photos: [photo(kept.id, '2026-09-21T00:00:00.000Z', 'new-kept')],
      }),
    );

    expect(await listPhotos(gone.id)).toEqual([]);
    expect((await listPhotos(kept.id)).map((p) => p.id)).toEqual(['new-kept']);
  });

  it('追加(replaceAll:false)は、同じidを上書きし、replacePhotosOfの人だけ写真が入れ替わる', async () => {
    const existing = createPatient('既存', '東京都');
    await savePatient(existing);
    await addPhoto(photo(existing.id, '2026-09-20T00:00:00.000Z', 'old'));
    const untouched = createPatient('触れない人', '京都府');
    await savePatient(untouched);
    await addPhoto(photo(untouched.id, '2026-09-20T00:00:00.000Z', 'untouched'));

    await applyImport(
      importPlan({
        replaceAll: false,
        patients: [updatePatientFields(existing, '更新後', '大阪府')],
        replacePhotosOf: [existing.id],
        photos: [photo(existing.id, '2026-09-21T00:00:00.000Z', 'new')],
      }),
    );

    const stored = await listPatients();
    expect(stored).toHaveLength(2);
    expect(stored.find((p) => p.id === existing.id)?.name).toBe('更新後');
    expect((await listPhotos(existing.id)).map((p) => p.id)).toEqual(['new']);
    expect((await listPhotos(untouched.id)).map((p) => p.id)).toEqual(['untouched']);
  });

  it('spots・metaも同じ呼び出しで書ける', async () => {
    await applyImport(
      importPlan({
        spots: [spot('toilet', 'a')],
        meta: { office: { name: '本店', address: '東京都中央区1-1' }, routeEnds: { start: 'office', end: 'last' } },
      }),
    );
    expect(await listSpots()).toHaveLength(1);
    expect(await getMeta('office')).toEqual({ name: '本店', address: '東京都中央区1-1' });
    expect(await getMeta('routeEnds')).toEqual({ start: 'office', end: 'last' });
  });

  it('途中で失敗させたら(keyPathの無い値でputが失敗)、何も変わらずapplyImportはreject', async () => {
    const existing = createPatient('既存', '東京都');
    await savePatient(existing);
    await addPhoto(photo(existing.id, '2026-09-20T00:00:00.000Z', 'existing-photo'));
    await putSpot(spot('toilet', 'existing-spot'));
    await setMeta('office', { name: '本店', address: '東京都中央区1-1' });

    const badPlan = importPlan({
      replaceAll: true,
      // 最後の要素がkeyPath(id)を持たないため、そこでputが失敗しトランザクションごと中断される。
      patients: [createPatient('取込1', '大阪府'), {} as unknown as ReturnType<typeof createPatient>],
      spots: [spot('rest', 'new-spot')],
      meta: { office: { name: '新事業所', address: '大阪府大阪市1-1' } },
    });

    await expect(applyImport(badPlan)).rejects.toThrow();

    expect(await listPatients()).toEqual([existing]);
    expect((await listPhotos(existing.id)).map((p) => p.id)).toEqual(['existing-photo']);
    expect((await listSpots()).map((s) => s.id)).toEqual(['existing-spot']);
    expect(await getMeta('office')).toEqual({ name: '本店', address: '東京都中央区1-1' });
  });

  it('複数のstoreにまたがる書き込みの途中で失敗させても(spotsの最後でput失敗)、patients・photos・spots・metaのどれも変わらない', async () => {
    const existing = createPatient('既存', '東京都');
    await savePatient(existing);
    await addPhoto(photo(existing.id, '2026-09-20T00:00:00.000Z', 'existing-photo'));
    // 名簿に無い訪問先を指す、孤立した写真(replaceAllの片付けで消える対象になり得るもの)。
    await addPhoto(photo('orphan-patient', '2026-09-19T00:00:00.000Z', 'orphan-photo'));
    await putSpot(spot('toilet', 'existing-spot'));
    await setMeta('office', { name: '本店', address: '東京都中央区1-1' });
    await setMeta('routeEnds', { start: 'office', end: 'last' });

    const badPlan = importPlan({
      replaceAll: true,
      patients: [createPatient('取込1', '大阪府')],
      replacePhotosOf: [existing.id],
      photos: [photo(existing.id, '2026-09-21T00:00:00.000Z', 'new-photo')],
      // 最後の要素がkeyPath(id)を持たないため、そこでputが失敗しトランザクションごと中断される。
      spots: [spot('rest', 'new-spot'), {} as unknown as Spot],
      meta: { office: { name: '新事業所', address: '大阪府大阪市1-1' }, routeEnds: { start: 'current', end: 'office' } },
    });

    await expect(applyImport(badPlan)).rejects.toThrow();

    expect(await listPatients()).toEqual([existing]);
    expect((await listPhotos(existing.id)).map((p) => p.id)).toEqual(['existing-photo']);
    expect((await listAllPhotos()).map((p) => p.id).sort()).toEqual(['existing-photo', 'orphan-photo']);
    expect((await listSpots()).map((s) => s.id)).toEqual(['existing-spot']);
    expect(await getMeta('office')).toEqual({ name: '本店', address: '東京都中央区1-1' });
    expect(await getMeta('routeEnds')).toEqual({ start: 'office', end: 'last' });
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

  it('listAllPhotosは全件を返す(バックアップの書き出し用)', async () => {
    await addPhoto(photo('p1', '2026-09-20T00:00:00.000Z', 'a'));
    await addPhoto(photo('p2', '2026-09-20T00:00:00.000Z', 'b'));
    expect(await listAllPhotos()).toHaveLength(2);
  });

  it('deleteOrphanPhotosで、名簿に無い訪問先の写真だけ消し、消した件数を返す(名簿も同じトランザクションの中で読む)', async () => {
    const kept = createPatient('残る人', '東京都');
    await savePatient(kept);
    await addPhoto(photo(kept.id, '2026-09-20T00:00:00.000Z', 'a'));
    await addPhoto(photo('gone', '2026-09-20T00:00:00.000Z', 'b'));
    const removed = await deleteOrphanPhotos();
    expect(removed).toBe(1);
    const remaining = await listAllPhotos();
    expect(remaining.map((p) => p.id)).toEqual(['a']);
    expect(remaining[0]?.patientId).toBe(kept.id);
  });
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

describe('接続が切れても作り直す(iOSがバックグラウンドで切ることがある)', () => {
  afterEach(() => {
    // 既定(再読み込み)に戻す。他のテストで誤って呼ばれても、jsdomで
    // window.location.reload()が走って壊れないようにする。
    setDbBlockingHandler(() => {});
  });

  it('UnknownError/InvalidStateErrorなら、接続を作り直して1回だけやり直す', async () => {
    const seenDbs: unknown[] = [];
    let calls = 0;
    const result = await withDb(async (db) => {
      calls += 1;
      seenDbs.push(db);
      if (calls === 1) {
        throw new DOMException('closed', 'InvalidStateError');
      }
      return 'ok';
    });
    expect(result).toBe('ok');
    expect(calls).toBe(2);
    // やり直した2回目は、1回目とは別の接続で呼ばれる。
    expect(seenDbs[1]).not.toBe(seenDbs[0]);
  });

  it('並行するwithDbが両方とも1回目に失敗しても、片方が作り直した接続をもう片方が捨てず、1つの新しい接続を共有する', async () => {
    await listPatients(); // 先に接続を1つ確立しておく(両方のwithDbが同じ接続から始まるように)。

    const dbsSeenByCall: unknown[][] = [[], []];
    const makeOperation = (index: number) => {
      let calls = 0;
      return async (db: unknown) => {
        calls += 1;
        dbsSeenByCall[index]!.push(db);
        if (calls === 1) {
          throw new DOMException('closed', 'InvalidStateError');
        }
        return 'ok';
      };
    };

    const [result0, result1] = await Promise.all([
      withDb(makeOperation(0)),
      withDb(makeOperation(1)),
    ]);
    expect(result0).toBe('ok');
    expect(result1).toBe('ok');

    // 両方とも1回目は同じ(最初に確立した)接続で失敗する。
    expect(dbsSeenByCall[0]![0]).toBe(dbsSeenByCall[1]![0]);
    // やり直し(2回目)は、どちらの呼び出しも同じ新しい接続を使う
    // (片方が作り直した接続を、もう片方が誤って捨てて別の接続をもう1つ作ってしまわない)。
    expect(dbsSeenByCall[0]![1]).toBe(dbsSeenByCall[1]![1]);
    // やり直しの接続は、最初の(失敗した)接続とは別のもの。
    expect(dbsSeenByCall[0]![1]).not.toBe(dbsSeenByCall[0]![0]);
  });

  it('接続の取得(getDb)自体がUnknownError/InvalidStateErrorで失敗しても、1回だけやり直す', async () => {
    vi.resetModules();
    const idbActual = await vi.importActual<typeof import('idb')>('idb');
    let openCalls = 0;
    vi.doMock('idb', () => ({
      ...idbActual,
      openDB: (...args: Parameters<typeof idbActual.openDB>) => {
        openCalls += 1;
        if (openCalls === 1) {
          return Promise.reject(new DOMException('closed', 'InvalidStateError'));
        }
        return idbActual.openDB(...args);
      },
    }));

    const dbModule = await import('../src/db');
    try {
      const result = await dbModule.withDb(async () => 'ok');
      expect(result).toBe('ok');
      // 1回目(失敗)+やり直しの1回=合計2回。operationを1度も呼んでいないので、
      // これは接続の取得(getDb)そのものの失敗からやり直したことを示す。
      expect(openCalls).toBe(2);
    } finally {
      // このテストだけモックしたidbを使う、別のモジュールインスタンスの接続を閉じておく
      // (閉じないと、以降のテストのbeforeEachのdeleteDBがブロックされる)。
      await dbModule.closeDbForTest();
      vi.doUnmock('idb');
      vi.resetModules();
    }
  });

  it('やり直しても失敗したら、そのまま投げる(3回目は呼ばない)', async () => {
    let calls = 0;
    await expect(
      withDb(async () => {
        calls += 1;
        throw new DOMException('closed', 'InvalidStateError');
      }),
    ).rejects.toThrow();
    expect(calls).toBe(2);
  });

  it('UnknownError/InvalidStateError以外(TypeErrorなど)はやり直さない', async () => {
    let calls = 0;
    await expect(
      withDb(async () => {
        calls += 1;
        throw new TypeError('bad');
      }),
    ).rejects.toBeInstanceOf(TypeError);
    expect(calls).toBe(1);
  });

  it('他で高い版が先に開かれていると失敗するが、その接続は覚えず、deleteDB後は使える', async () => {
    const higher = await openDB('route-auto-input', 5);
    await expect(listPatients()).rejects.toThrow();
    higher.close();
    await deleteDB('route-auto-input');
    // 失敗した接続を覚えていれば、ここも同じ理由で失敗し続けるはず。
    await expect(listPatients()).resolves.toEqual([]);
  });

  it('新しい版(高い版)が開こうとすると、setDbBlockingHandlerで差し替えたハンドラが呼ばれ、こちらが接続を閉じて道を譲る', async () => {
    await listPatients(); // 先にv4の接続を開いておく。
    const handler = vi.fn();
    setDbBlockingHandler(handler);

    const higher = await openDB('route-auto-input', 5);
    expect(handler).toHaveBeenCalledTimes(1);
    higher.close();
  });
});
