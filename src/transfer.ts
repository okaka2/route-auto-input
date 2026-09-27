/**
 * 引き継ぎで送る中身の組み立て・読み取りと、受け取ったときの同じ人の突き合わせ。
 * バックアップ(backup.ts)とは別に、送る訪問先を選んで別の端末に渡すための形。
 */
import { toBackupPhoto, toPatient, toSpot, type BackupPhoto } from './backup';
import { MAX_PHOTOS_PER_PATIENT } from './config';
import { normalizeAddress, normalizeName } from './normalize';
import type { Patient, Photo, Spot } from './types';

export type TransferPayload = {
  kind: 'houmon-transfer-payload';
  v: 1;
  sentAt: string;
  /** 送る訪問先(id は送った側のもの)。 */
  patients: Patient[];
  /** 含めないなら null。 */
  photos: BackupPhoto[] | null;
  /** 含めないなら []。 */
  spots: Spot[];
};

const PARSE_ERROR_MESSAGE = '引き継ぎのファイルの中身を読めませんでした。';

/**
 * 送る側で項目を絞ってから書き出す。呼び出し元のオブジェクトに実行時だけ紛れ込んだ
 * 余計なプロパティ(意図しない参照など)がそのままファイルに入らないよう、
 * backup.ts の変換関数(toPatient・toBackupPhoto・toSpot)を通して、知っている項目だけを拾い直す。
 */
export function serializePayload(payload: Omit<TransferPayload, 'kind' | 'v'>): string {
  const patients = payload.patients.map((patient, index) => toPatient(patient, index));
  const photos =
    payload.photos === null
      ? null
      : payload.photos.map((photo) => toBackupPhoto(photo)).filter((photo): photo is BackupPhoto => photo !== null);
  const spots = payload.spots.map((spot) => toSpot(spot)).filter((spot): spot is Spot => spot !== null);
  const data: TransferPayload = {
    kind: 'houmon-transfer-payload',
    v: 1,
    sentAt: payload.sentAt,
    patients,
    photos,
    spots,
  };
  return JSON.stringify(data, null, 2);
}

/** 形が違えば PARSE_ERROR_MESSAGE を投げる。壊れた写真・地点は1件ずつ捨てる(backup.ts と同じ決まり)。 */
export function parsePayload(text: string): TransferPayload {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(PARSE_ERROR_MESSAGE);
  }

  if (typeof data !== 'object' || data === null) {
    throw new Error(PARSE_ERROR_MESSAGE);
  }

  const record = data as Record<string, unknown>;
  if (record.kind !== 'houmon-transfer-payload' || record.v !== 1) {
    throw new Error(PARSE_ERROR_MESSAGE);
  }
  if (typeof record.sentAt !== 'string' || record.sentAt === '') {
    throw new Error(PARSE_ERROR_MESSAGE);
  }
  if (!Array.isArray(record.patients)) {
    throw new Error(PARSE_ERROR_MESSAGE);
  }

  let patients: Patient[];
  try {
    patients = record.patients.map((item, index) => toPatient(item, index));
  } catch {
    throw new Error(PARSE_ERROR_MESSAGE);
  }

  const seenIds = new Set<string>();
  for (const patient of patients) {
    if (seenIds.has(patient.id)) {
      throw new Error(PARSE_ERROR_MESSAGE);
    }
    seenIds.add(patient.id);
  }

  const photos = Array.isArray(record.photos)
    ? record.photos.map((item) => toBackupPhoto(item)).filter((item): item is BackupPhoto => item !== null)
    : null;
  const spots = Array.isArray(record.spots)
    ? record.spots.map((item) => toSpot(item)).filter((item): item is Spot => item !== null)
    : [];

  return { kind: 'houmon-transfer-payload', v: 1, sentAt: record.sentAt, patients, photos, spots };
}

// 「山田 太郎様ほか2人」の説明は recipients.ts にある(画面の表示だけに要るので、
// このファイルを import() で後から読み込めるよう分けた)。今までどおりここからも使える。
export { describeRecipients } from './recipients';

export type Conflict = { incoming: Patient; existing: Patient };

/**
 * 正規化した名前「と」住所が両方一致する人を、同じ人とみなす(normalize.ts)。
 * 1件の送られてきた人が、手元の複数の人と一致することがあるが、その場合は
 * existing に並んでいる先頭の人と組にする。
 */
export function findConflicts(
  incoming: readonly Patient[],
  existing: readonly Patient[],
): { conflicts: Conflict[]; fresh: Patient[] } {
  const conflicts: Conflict[] = [];
  const fresh: Patient[] = [];
  for (const candidate of incoming) {
    const name = normalizeName(candidate.name);
    const address = normalizeAddress(candidate.address);
    const match = existing.find(
      (person) => normalizeName(person.name) === name && normalizeAddress(person.address) === address,
    );
    if (match) {
      conflicts.push({ incoming: candidate, existing: match });
    } else {
      fresh.push(candidate);
    }
  }
  return { conflicts, fresh };
}

export type ConflictChoice = 'overwrite' | 'addNew' | 'skip';

export type ImportPlan = {
  /** 保存する訪問先(上書きは手元の id、新規は新しい id)。 */
  put: Patient[];
  /**
   * 保存先の id → 写真(新しい id を振った Photo)。
   * 写真を含めないファイル(photos: null)なら、常に空。
   * 写真を含めていても、その人に送られてきた写真が0枚(壊れていて捨てられた場合を含む)なら
   * エントリを作らない(送る側の「写真無し」は削除の指示ではないため、手元の写真をそのまま残す。
   * 上書き・新規のどちらでも同じ)。1枚以上あるときだけ、最大 MAX_PHOTOS_PER_PATIENT 枚を入れる。
   */
  photosByPatient: Map<string, Photo[]>;
  /** 手元に同じ id が無いものだけ。 */
  spots: Spot[];
};

/** 手元の人の項目を、送られてきた側で置き換える(送られてきた側に無い任意項目は外す)。 */
function overwritePatient(existing: Patient, incoming: Patient, now: string): Patient {
  return {
    id: existing.id,
    createdAt: existing.createdAt,
    name: incoming.name,
    address: incoming.address,
    updatedAt: now,
    ...(incoming.phone !== undefined ? { phone: incoming.phone } : {}),
    ...(incoming.location !== undefined ? { location: incoming.location } : {}),
    ...(incoming.parking !== undefined ? { parking: incoming.parking } : {}),
    ...(incoming.note !== undefined ? { note: incoming.note } : {}),
  };
}

/** 新規に登録する人(別に追加・衝突なし共通)を、新しい id・作成日時で作る。 */
function addAsNew(incoming: Patient, id: string, now: string): Patient {
  return { ...incoming, id, createdAt: now, updatedAt: now };
}

/**
 * 送られてきた内容から、実際に保存する形(ImportPlan)を組み立てる。
 * 衝突(findConflicts)ごとに choices の選択(無ければ'skip')にしたがい、
 * 手元の同じ人を複数回上書きしないよう、2件目以降のoverwriteは'addNew'として扱う。
 */
export function planImport(
  payload: TransferPayload,
  decodedPhotos: Photo[] | null,
  existing: readonly Patient[],
  existingSpotIds: ReadonlySet<string>,
  choices: ReadonlyMap<string, ConflictChoice>,
  newId: () => string,
  now: Date,
): ImportPlan {
  const nowIso = now.toISOString();
  const { conflicts, fresh } = findConflicts(payload.patients, existing);
  const put: Patient[] = [];
  const photosByPatient = new Map<string, Photo[]>();
  // 同じ手元の人を、複数の送られてきた人でそれぞれ上書きしてしまうと、
  // 後から処理した方だけが残って前の内容が消えてしまう。2件目以降は「別に追加」として扱う。
  const overwrittenExistingIds = new Set<string>();

  const assignPhotos = (targetId: string, incomingId: string): void => {
    if (decodedPhotos === null) {
      return;
    }
    const photos = decodedPhotos
      .filter((photo) => photo.patientId === incomingId)
      .slice(0, MAX_PHOTOS_PER_PATIENT)
      .map((photo) => ({ ...photo, id: newId(), patientId: targetId }));
    // 送られてきた写真が0枚(壊れて捨てられた場合を含む)なら、手元の写真に触れない。
    if (photos.length === 0) {
      return;
    }
    photosByPatient.set(targetId, photos);
  };

  for (const conflict of conflicts) {
    const rawChoice = choices.get(conflict.incoming.id) ?? 'skip';
    if (rawChoice === 'skip') {
      continue;
    }
    const choice: ConflictChoice =
      rawChoice === 'overwrite' && overwrittenExistingIds.has(conflict.existing.id) ? 'addNew' : rawChoice;
    if (choice === 'overwrite') {
      overwrittenExistingIds.add(conflict.existing.id);
      put.push(overwritePatient(conflict.existing, conflict.incoming, nowIso));
      assignPhotos(conflict.existing.id, conflict.incoming.id);
    } else {
      const id = newId();
      put.push(addAsNew(conflict.incoming, id, nowIso));
      assignPhotos(id, conflict.incoming.id);
    }
  }

  for (const patient of fresh) {
    const id = newId();
    put.push(addAsNew(patient, id, nowIso));
    assignPhotos(id, patient.id);
  }

  const spots = payload.spots.filter((spot) => !existingSpotIds.has(spot.id));

  return { put, photosByPatient, spots };
}
