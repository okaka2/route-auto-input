import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Office, RouteEnds } from './routePlan';
import type { Patient } from './types';

const DB_NAME = 'route-auto-input';
const DB_VERSION = 3;
const STORE = 'patients';
const META_STORE = 'meta';
const HISTORY_STORE = 'history';

/** 設定値のキーと型。 */
export type MetaValues = {
  lastBackupAt: string;
  office: Office;
  routeEnds: RouteEnds;
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
}

let connection: Promise<IDBPDatabase<RouteAutoInputDB>> | null = null;

function getDb(): Promise<IDBPDatabase<RouteAutoInputDB>> {
  connection ??= openDB<RouteAutoInputDB>(DB_NAME, DB_VERSION, {
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
    },
  });
  return connection;
}

export async function getMeta<K extends keyof MetaValues>(key: K): Promise<MetaValues[K] | undefined> {
  const db = await getDb();
  return (await db.get(META_STORE, key)) as MetaValues[K] | undefined;
}

export async function setMeta<K extends keyof MetaValues>(key: K, value: MetaValues[K]): Promise<void> {
  const db = await getDb();
  await db.put(META_STORE, value, key);
}

export async function deleteMeta(key: keyof MetaValues): Promise<void> {
  const db = await getDb();
  await db.delete(META_STORE, key);
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
  const db = await getDb();
  const ascending = await db.getAllFromIndex(STORE, 'createdAt');
  return ascending.reverse();
}

export async function savePatient(patient: Patient): Promise<void> {
  const db = await getDb();
  await db.put(STORE, patient);
}

export async function deletePatient(id: string): Promise<void> {
  const db = await getDb();
  await db.delete(STORE, id);
}

/** 複数件まとめて削除する。 */
export async function deletePatients(ids: readonly string[]): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(STORE, 'readwrite');
  for (const id of ids) {
    await tx.store.delete(id);
  }
  await tx.done;
}

/** 既存データを全消去してから入れ替える。 */
export async function replaceAllPatients(patients: readonly Patient[]): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(STORE, 'readwrite');
  await tx.store.clear();
  for (const patient of patients) {
    await tx.store.put(patient);
  }
  await tx.done;
}

/** 既存データを残したまま、同じidは上書きして取り込む。 */
export async function mergePatients(patients: readonly Patient[]): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(STORE, 'readwrite');
  for (const patient of patients) {
    await tx.store.put(patient);
  }
  await tx.done;
}

export async function getHistory(date: string): Promise<HistoryEntry | undefined> {
  const db = await getDb();
  return db.get(HISTORY_STORE, date);
}

export async function putHistory(entry: HistoryEntry): Promise<void> {
  const db = await getDb();
  await db.put(HISTORY_STORE, entry);
}

/** その日の記録を、1つの読み書きトランザクションの中で読んで書き換える(読み取りと書き込みの間に他の書き込みが割り込まない)。 */
export async function updateHistory(
  date: string,
  update: (current: HistoryEntry | undefined) => HistoryEntry,
): Promise<HistoryEntry> {
  const db = await getDb();
  const tx = db.transaction(HISTORY_STORE, 'readwrite');
  const next = update(await tx.store.get(date));
  await tx.store.put(next);
  await tx.done;
  return next;
}

/** 新しい日付が先に来る。 */
export async function listHistory(): Promise<HistoryEntry[]> {
  const db = await getDb();
  return (await db.getAll(HISTORY_STORE)).reverse();
}

/** 指定の日付より前を消し、消した件数を返す。 */
export async function deleteHistoryBefore(date: string): Promise<number> {
  const db = await getDb();
  const keys = await db.getAllKeys(HISTORY_STORE, IDBKeyRange.upperBound(date, true));
  const tx = db.transaction(HISTORY_STORE, 'readwrite');
  for (const key of keys) {
    await tx.store.delete(key);
  }
  await tx.done;
  return keys.length;
}

export async function clearHistory(): Promise<void> {
  const db = await getDb();
  await db.clear(HISTORY_STORE);
}
