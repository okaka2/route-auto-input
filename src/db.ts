import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { MAX_PHOTOS_PER_PATIENT } from './config';
import type { Office, RouteEnds } from './routePlan';
import type { Patient, Photo, Spot } from './types';

const DB_NAME = 'route-auto-input';
const DB_VERSION = 4;
const STORE = 'patients';
const META_STORE = 'meta';
const HISTORY_STORE = 'history';
const PHOTOS_STORE = 'photos';
const SPOTS_STORE = 'spots';

export { MAX_PHOTOS_PER_PATIENT };

/** 設定値のキーと型。 */
export type MetaValues = {
  lastBackupAt: string;
  office: Office;
  routeEnds: RouteEnds;
  /** 引き継ぎファイルの暗号化・復号に自動で使う、事業所内で共有するパスワード。 */
  sharedSecret: string;
};

/** 訪問の履歴。日付ごとに、選んだ人の順番と訪問済み時刻を保存する。 */
export type HistoryEntry = {
  date: string /* YYYY-MM-DD */;
  ids: string[];
  routeEnds: RouteEnds;
  visited: Record<string, string /* ISO */>;
};

interface RouteAutoInputDB extends DBSchema {
  patients: {
    key: string;
    value: Patient;
    indexes: { createdAt: string };
  };
  meta: { key: string; value: unknown };
  history: { key: string; value: HistoryEntry };
  photos: {
    key: string;
    value: Photo;
    indexes: { patientId: string };
  };
  spots: { key: string; value: Spot };
}

type Db = IDBPDatabase<RouteAutoInputDB>;

let connection: Promise<Db> | null = null;

/** 新しい版がこのDBの更新を待っている(blocking)ときに呼ぶ。既定はページの再読み込み。 */
let blockingHandler: () => void = () => window.location.reload();

/** blocking時のハンドラを差し替える(例: すぐ再読み込みせず、確認してから読み込むゲートに差し替える)。 */
export function setDbBlockingHandler(handler: () => void): void {
  blockingHandler = handler;
}

function getDb(): Promise<Db> {
  if (connection === null) {
    const opening: Promise<Db> = openDB<RouteAutoInputDB>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          const store = db.createObjectStore(STORE, { keyPath: 'id' });
          store.createIndex('createdAt', 'createdAt');
        }
        if (oldVersion < 2) {
          db.createObjectStore(META_STORE);
        }
        if (oldVersion < 3) {
          db.createObjectStore(HISTORY_STORE, { keyPath: 'date' });
        }
        if (oldVersion < 4) {
          const photoStore = db.createObjectStore(PHOTOS_STORE, { keyPath: 'id' });
          photoStore.createIndex('patientId', 'patientId');
          db.createObjectStore(SPOTS_STORE, { keyPath: 'id' });
        }
      },
      // 新しい版(別のタブ・次の起動など)がこのDBを開こうとして、この接続が邪魔しているとき。
      // 閉じて手放し、呼び出し側に知らせる(既定は再読み込み)。blockedは渡さない
      // (何もしない=相手[この接続]が閉じるのを待つ、で十分なため)。
      blocking() {
        if (connection === opening) connection = null;
        void opening.then((db) => db.close()).catch(() => {});
        blockingHandler();
      },
      // iOSがバックグラウンドに回したタブの接続を切ることがある。覚えている接続を捨てて、
      // 次に使うときに作り直す。
      terminated() {
        if (connection === opening) connection = null;
      },
    });
    opening.catch(() => {
      // 開くのに失敗した(例: 他のタブがより新しい版を開いている)。捨てないと、
      // 直った後(相手が閉じた後など)も失敗したままの接続を使い続けてしまう。
      // 捨てるのは、その間に別の接続へ置き換わっていない(同じPromiseの)ときだけ。
      if (connection === opening) connection = null;
    });
    connection = opening;
  }
  return connection;
}

const RETRYABLE_ERROR_NAMES = new Set(['UnknownError', 'InvalidStateError']);

function isRetryableDbError(error: unknown): boolean {
  const name = (error as { name?: unknown } | null | undefined)?.name;
  return typeof name === 'string' && RETRYABLE_ERROR_NAMES.has(name);
}

/**
 * 接続を取り出してoperationを行う。iOSがアプリをバックグラウンドに回したときなどに
 * 接続が切れ、UnknownError・InvalidStateErrorで失敗することがある。そのときは
 * 接続を捨てて作り直し、1回だけやり直す(やり直しても失敗したら、そのまま投げる)。
 */
export async function withDb<T>(operation: (db: Db) => Promise<T>): Promise<T> {
  const db = await getDb();
  try {
    return await operation(db);
  } catch (error) {
    if (!isRetryableDbError(error)) throw error;
    connection = null;
    const retryDb = await getDb();
    return operation(retryDb);
  }
}

export async function getMeta<K extends keyof MetaValues>(key: K): Promise<MetaValues[K] | undefined> {
  return withDb(async (db) => (await db.get(META_STORE, key)) as MetaValues[K] | undefined);
}

export async function setMeta<K extends keyof MetaValues>(key: K, value: MetaValues[K]): Promise<void> {
  await withDb((db) => db.put(META_STORE, value, key));
}

export async function deleteMeta(key: keyof MetaValues): Promise<void> {
  await withDb((db) => db.delete(META_STORE, key));
}

/**
 * テストでデータベースを作り直すために接続を閉じる。
 * 接続を開いたままにすると deleteDB がブロックされるため、必ず close する。
 */
export async function closeDbForTest(): Promise<void> {
  if (connection === null) {
    return;
  }
  const db = await connection;
  db.close();
  connection = null;
}

/** 登録が新しい順に返す。 */
export async function listPatients(): Promise<Patient[]> {
  return withDb(async (db) => {
    const ascending = await db.getAllFromIndex(STORE, 'createdAt');
    return ascending.reverse();
  });
}

export async function savePatient(patient: Patient): Promise<void> {
  await withDb((db) => db.put(STORE, patient));
}

export async function deletePatient(id: string): Promise<void> {
  await withDb((db) => db.delete(STORE, id));
}

/** 複数件まとめて削除する。 */
export async function deletePatients(ids: readonly string[]): Promise<void> {
  await withDb(async (db) => {
    const tx = db.transaction(STORE, 'readwrite');
    for (const id of ids) {
      await tx.store.delete(id);
    }
    await tx.done;
  });
}

/** 既存データを全消去してから入れ替える。 */
export async function replaceAllPatients(patients: readonly Patient[]): Promise<void> {
  await withDb(async (db) => {
    const tx = db.transaction(STORE, 'readwrite');
    await tx.store.clear();
    for (const patient of patients) {
      await tx.store.put(patient);
    }
    await tx.done;
  });
}

/** 既存データを残したまま、同じidは上書きして取り込む。 */
export async function mergePatients(patients: readonly Patient[]): Promise<void> {
  await withDb(async (db) => {
    const tx = db.transaction(STORE, 'readwrite');
    for (const patient of patients) {
      await tx.store.put(patient);
    }
    await tx.done;
  });
}

export async function getHistory(date: string): Promise<HistoryEntry | undefined> {
  return withDb((db) => db.get(HISTORY_STORE, date));
}

export async function putHistory(entry: HistoryEntry): Promise<void> {
  await withDb((db) => db.put(HISTORY_STORE, entry));
}

/** その日の記録を、1つの読み書きトランザクションの中で読んで書き換える(読み取りと書き込みの間に他の書き込みが割り込まない)。 */
export async function updateHistory(
  date: string,
  update: (current: HistoryEntry | undefined) => HistoryEntry,
): Promise<HistoryEntry> {
  return withDb(async (db) => {
    const tx = db.transaction(HISTORY_STORE, 'readwrite');
    const next = update(await tx.store.get(date));
    await tx.store.put(next);
    await tx.done;
    return next;
  });
}

/** 新しい日付が先に来る。 */
export async function listHistory(): Promise<HistoryEntry[]> {
  return withDb(async (db) => (await db.getAll(HISTORY_STORE)).reverse());
}

/** 指定の日付より前を消し、消した件数を返す。 */
export async function deleteHistoryBefore(date: string): Promise<number> {
  return withDb(async (db) => {
    const keys = await db.getAllKeys(HISTORY_STORE, IDBKeyRange.upperBound(date, true));
    const tx = db.transaction(HISTORY_STORE, 'readwrite');
    for (const key of keys) {
      await tx.store.delete(key);
    }
    await tx.done;
    return keys.length;
  });
}

export async function clearHistory(): Promise<void> {
  await withDb((db) => db.clear(HISTORY_STORE));
}

/**
 * その訪問先の写真を、登録した順(古い順)で返す。
 * getAllFromIndexはindexの値(patientId)→主キー(id、ランダムなUUID)の順で並ぶだけなので、
 * ここでcreatedAtで並べ直す(同じcreatedAtならidで安定させる)。
 */
export async function listPhotos(patientId: string): Promise<Photo[]> {
  return withDb(async (db) => {
    const photos = await db.getAllFromIndex(PHOTOS_STORE, 'patientId', patientId);
    return photos.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  });
}

/** 訪問先ごとの写真の枚数(1枚も無い訪問先は含まれない)。 */
export async function countPhotosByPatient(): Promise<Map<string, number>> {
  return withDb(async (db) => {
    const counts = new Map<string, number>();
    for (const photo of await db.getAll(PHOTOS_STORE)) {
      counts.set(photo.patientId, (counts.get(photo.patientId) ?? 0) + 1);
    }
    return counts;
  });
}

/** 写真を追加する。すでに上限(MAX_PHOTOS_PER_PATIENT)まであれば、書き込まずにエラーにする。 */
export async function addPhoto(photo: Photo): Promise<void> {
  await withDb(async (db) => {
    const tx = db.transaction(PHOTOS_STORE, 'readwrite');
    const count = await tx.store.index('patientId').count(photo.patientId);
    if (count >= MAX_PHOTOS_PER_PATIENT) {
      throw new Error('写真は1件につき3枚までです。');
    }
    await tx.store.put(photo);
    await tx.done;
  });
}

export async function deletePhoto(id: string): Promise<void> {
  await withDb((db) => db.delete(PHOTOS_STORE, id));
}

/** 訪問先を削除するときにあわせて呼ぶ。指定した訪問先ぶんの写真をすべて消す。 */
export async function deletePhotosOf(patientIds: readonly string[]): Promise<void> {
  await withDb(async (db) => {
    const tx = db.transaction(PHOTOS_STORE, 'readwrite');
    const index = tx.store.index('patientId');
    for (const patientId of patientIds) {
      for (const key of await index.getAllKeys(patientId)) {
        await tx.store.delete(key);
      }
    }
    await tx.done;
  });
}

/** バックアップの書き出し用。 */
export async function listAllPhotos(): Promise<Photo[]> {
  return withDb((db) => db.getAll(PHOTOS_STORE));
}

/** バックアップの読み込み用(同じidは上書き)。 */
export async function putPhotos(photos: readonly Photo[]): Promise<void> {
  await withDb(async (db) => {
    const tx = db.transaction(PHOTOS_STORE, 'readwrite');
    for (const photo of photos) {
      await tx.store.put(photo);
    }
    await tx.done;
  });
}

/**
 * バックアップの「入れ替える」読み込み用。指定した訪問先ぶんの写真を、1つの読み書き
 * トランザクションの中で、すべて消してから新しい写真を入れる(putPhotosは同じidだけ
 * 上書きするので、ファイルの写真のidが既存と違えば、上限(MAX_PHOTOS_PER_PATIENT)を
 * 超えて残ってしまう。先に全部消すことでそれを防ぐ)。対象に含まれない訪問先の写真には触れない。
 */
export async function replacePhotosFor(patientIds: readonly string[], photos: readonly Photo[]): Promise<void> {
  await withDb(async (db) => {
    const tx = db.transaction(PHOTOS_STORE, 'readwrite');
    const index = tx.store.index('patientId');
    for (const patientId of new Set(patientIds)) {
      for (const key of await index.getAllKeys(patientId)) {
        await tx.store.delete(key);
      }
    }
    for (const photo of photos) {
      await tx.store.put(photo);
    }
    await tx.done;
  });
}

/**
 * バックアップの「追加する」読み込み用。既存の写真は残したまま、訪問先ごとの上限
 * (MAX_PHOTOS_PER_PATIENT)を超えないぶんだけファイルの写真を追加する。同じidの写真は
 * 上限に数えず上書きし、上限を超えるぶんの新しい写真は書き込まずスキップする。
 */
export async function mergePhotosCapped(photos: readonly Photo[]): Promise<void> {
  await withDb(async (db) => {
    const tx = db.transaction(PHOTOS_STORE, 'readwrite');
    const index = tx.store.index('patientId');
    const countByPatient = new Map<string, number>();
    for (const photo of photos) {
      if (!countByPatient.has(photo.patientId)) {
        countByPatient.set(photo.patientId, await index.count(photo.patientId));
      }
      const existingKey = await tx.store.getKey(photo.id);
      if (existingKey !== undefined) {
        // 同じidは上書き(件数には数えない)。
        await tx.store.put(photo);
        continue;
      }
      const count = countByPatient.get(photo.patientId) ?? 0;
      if (count >= MAX_PHOTOS_PER_PATIENT) {
        continue;
      }
      await tx.store.put(photo);
      countByPatient.set(photo.patientId, count + 1);
    }
    await tx.done;
  });
}

/** 名簿に無い訪問先を指す、孤立した写真を消す(バックアップの読み込み後の片付けなど)。消した件数を返す。 */
export async function deleteOrphanPhotos(validPatientIds: ReadonlySet<string>): Promise<number> {
  return withDb(async (db) => {
    const tx = db.transaction(PHOTOS_STORE, 'readwrite');
    let cursor = await tx.store.openCursor();
    let removed = 0;
    while (cursor) {
      if (!validPatientIds.has(cursor.value.patientId)) {
        await cursor.delete();
        removed += 1;
      }
      cursor = await cursor.continue();
    }
    await tx.done;
    return removed;
  });
}

export async function listSpots(): Promise<Spot[]> {
  return withDb((db) => db.getAll(SPOTS_STORE));
}

export async function putSpot(spot: Spot): Promise<void> {
  await withDb((db) => db.put(SPOTS_STORE, spot));
}

export async function deleteSpot(id: string): Promise<void> {
  await withDb((db) => db.delete(SPOTS_STORE, id));
}

/** バックアップの読み込み用(同じidは上書き)。 */
export async function putSpots(spots: readonly Spot[]): Promise<void> {
  await withDb(async (db) => {
    const tx = db.transaction(SPOTS_STORE, 'readwrite');
    for (const spot of spots) {
      await tx.store.put(spot);
    }
    await tx.done;
  });
}
