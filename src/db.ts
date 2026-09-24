import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Patient } from './types';

const DB_NAME = 'route-auto-input';
const DB_VERSION = 2;
const STORE = 'patients';
const META_STORE = 'meta';

/** 設定値のキーと型。段階2以降で office / routeEnds などを足す。 */
export type MetaValues = {
  lastBackupAt: string;
};

interface RouteAutoInputDB extends DBSchema {
  patients: {
    key: string;
    value: Patient;
    indexes: { createdAt: string };
  };
  meta: { key: string; value: unknown };
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
