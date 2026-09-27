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
 * 接続が切れ、UnknownError・InvalidStateErrorで失敗することがある(接続の取得
 * そのものが失敗することもあれば、取得はできてもoperationの中で失敗することもある)。
 * そのときは接続を捨てて作り直し、1回だけやり直す(やり直しても失敗したら、そのまま投げる)。
 *
 * 接続を捨てるのは、今も自分が取り出したのと同じ接続を覚えているとき(`connection === opening`)
 * だけにする。並行して呼ばれた別のwithDbが先にやり直して新しい接続を作っていたら、
 * それを誤って捨てない(捨てると、せっかく作り直した接続をもう1つ余計に作ってしまう)。
 */
export async function withDb<T>(operation: (db: Db) => Promise<T>): Promise<T> {
  const opening = getDb();
  try {
    return await operation(await opening);
  } catch (error) {
    if (!isRetryableDbError(error)) throw error;
    if (connection === opening) connection = null;
    return operation(await getDb());
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

/** 訪問先とその写真を、1つのトランザクションで消す。 */
export async function deletePatient(id: string): Promise<void> {
  await deletePatients([id]);
}

/** 複数件まとめて、その写真もあわせて、1つのトランザクションで消す。 */
export async function deletePatients(ids: readonly string[]): Promise<void> {
  await withDb(async (db) => {
    const tx = db.transaction([STORE, PHOTOS_STORE], 'readwrite');
    const patientsStore = tx.objectStore(STORE);
    const photoIndex = tx.objectStore(PHOTOS_STORE).index('patientId');
    for (const id of ids) {
      await patientsStore.delete(id);
      for (const key of await photoIndex.getAllKeys(id)) {
        await tx.objectStore(PHOTOS_STORE).delete(key);
      }
    }
    await tx.done;
  });
}

/** 既存データを残したまま、同じidは上書きして取り込む。(Task 4でmergeを足したらplanBackupMerge経由でも使う。) */
export async function mergePatients(patients: readonly Patient[]): Promise<void> {
  await withDb(async (db) => {
    const tx = db.transaction(STORE, 'readwrite');
    for (const patient of patients) {
      await tx.store.put(patient);
    }
    await tx.done;
  });
}

/** バックアップの読み込み・引き継ぎの受け取りを1回で書くための計画。 */
export type DbImportPlan = {
  /** true なら訪問先を全部消してから patients を入れる(バックアップの入れ替え)。持ち主のいなくなった写真も同じ中で消す。 */
  replaceAll: boolean;
  /** 保存する訪問先(同じ id は上書き)。 */
  patients: readonly Patient[];
  /** 手元の写真を先に全部消す訪問先の id(入れ替え・受け取りの上書き)。 */
  replacePhotosOf: readonly string[];
  /** 入れる写真(Blob は書き込みの前に全部作っておく)。 */
  photos: readonly Photo[];
  spots: readonly Spot[];
  meta: { office?: Office; routeEnds?: RouteEnds };
};

/**
 * patients・photos・spots・meta を1つの readwrite トランザクションで書く。途中で失敗したら
 * (put が keyPath の無い値などで例外を投げるなど)そこで tx.abort() し、何も変わらないまま
 * reject する。put の例外はIDBの request の失敗ではなく同期の例外なので、abort を呼ばない限り
 * それまでに済ませた書き込みがそのままコミットされてしまう(捨てないためにここで abort する)。
 * 順番: (replaceAllなら)訪問先を clear → patients を put → replacePhotosOf の写真を消す →
 * photos を put → (replaceAllなら)名簿に無い写真を消す → spots を put → meta を put。
 */
export async function applyImport(plan: DbImportPlan): Promise<void> {
  await withDb(async (db) => {
    const tx = db.transaction([STORE, PHOTOS_STORE, SPOTS_STORE, META_STORE], 'readwrite');
    // 下のtryが失敗してtx.abort()した場合、tx.doneはAbortErrorで拒否される。そちらは使わず
    // 元の例外を投げ直すので、ここで受け止めて「誰も処理しなかった拒否」にはしない。
    const aborted = tx.done.catch(() => undefined);
    try {
      const patientsStore = tx.objectStore(STORE);
      const photosStore = tx.objectStore(PHOTOS_STORE);
      const spotsStore = tx.objectStore(SPOTS_STORE);
      const metaStore = tx.objectStore(META_STORE);

      if (plan.replaceAll) {
        await patientsStore.clear();
      }
      for (const patient of plan.patients) {
        await patientsStore.put(patient);
      }

      const photoIndex = photosStore.index('patientId');
      for (const patientId of new Set(plan.replacePhotosOf)) {
        for (const key of await photoIndex.getAllKeys(patientId)) {
          await photosStore.delete(key);
        }
      }
      for (const photo of plan.photos) {
        await photosStore.put(photo);
      }

      if (plan.replaceAll) {
        const validPatientIds = new Set(plan.patients.map((patient) => patient.id));
        let cursor = await photosStore.openCursor();
        while (cursor) {
          if (!validPatientIds.has(cursor.value.patientId)) {
            await cursor.delete();
          }
          cursor = await cursor.continue();
        }
      }

      for (const spot of plan.spots) {
        await spotsStore.put(spot);
      }
      if (plan.meta.office !== undefined) {
        await metaStore.put(plan.meta.office, 'office');
      }
      if (plan.meta.routeEnds !== undefined) {
        await metaStore.put(plan.meta.routeEnds, 'routeEnds');
      }
    } catch (error) {
      try {
        tx.abort();
      } catch {
        // すでに終わっている(コミット・中断済み)なら、これ以上できることはない。
      }
      await aborted;
      throw error;
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

/** バックアップの書き出し用。 */
export async function listAllPhotos(): Promise<Photo[]> {
  return withDb((db) => db.getAll(PHOTOS_STORE));
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

/**
 * 名簿に無い訪問先を指す、孤立した写真を消す(起動時の片付けなど)。名簿も同じ
 * トランザクションの中で読むので、この最中に他の書き込みが割り込んで矛盾することはない。
 * 消した件数を返す。
 */
export async function deleteOrphanPhotos(): Promise<number> {
  return withDb(async (db) => {
    const tx = db.transaction([STORE, PHOTOS_STORE], 'readwrite');
    const validPatientIds = new Set(await tx.objectStore(STORE).getAllKeys());
    const photosStore = tx.objectStore(PHOTOS_STORE);
    let cursor = await photosStore.openCursor();
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
