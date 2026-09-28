import { MAX_PHOTOS_PER_PATIENT } from './config';
import type { DbImportPlan } from './db';
import type { Office, RouteEnd, RouteEnds, RouteStart } from './routePlan';
import { SPOT_KINDS } from './spots';
import type { GeoLocation, Parking, ParkingType, Patient, Photo, Spot, SpotKind } from './types';
import { isDateKey, PARKING_OPTIONS } from './visitInfo';

const PARKING_TYPES: ParkingType[] = PARKING_OPTIONS.map((option) => option.value).filter(
  (value): value is ParkingType => value !== '',
);
const SPOT_KIND_VALUES: SpotKind[] = SPOT_KINDS.map((option) => option.value);
const ROUTE_STARTS: RouteStart[] = ['office', 'current', 'first'];
const ROUTE_END_VALUES: RouteEnd[] = ['office', 'last'];

export const BACKUP_VERSION = 2;

/** 写真1枚ぶんのバックアップ表現(Blobはそのまま書き出せないため、data URLの文字列に変換して持つ)。 */
export type BackupPhoto = { id: string; patientId: string; dataUrl: string; createdAt: string };

export type BackupContent = {
  patients: Patient[];
  /** 写真を含めなかった(または旧version 1のバックアップを読んだ)なら null。 */
  photos: BackupPhoto[] | null;
  spots: Spot[];
  meta: { office?: Office; routeEnds?: RouteEnds };
};

type BackupFile = {
  version: number;
  exportedAt: string;
  patients: Patient[];
  photos: BackupPhoto[] | null;
  spots: Spot[];
  meta: { office?: Office; routeEnds?: RouteEnds };
};

const REQUIRED_KEYS = ['id', 'name', 'address', 'createdAt', 'updatedAt'] as const;

export function serializeBackup(content: BackupContent, now: Date = new Date()): string {
  const data: BackupFile = {
    version: BACKUP_VERSION,
    exportedAt: now.toISOString(),
    patients: [...content.patients],
    photos: content.photos === null ? null : [...content.photos],
    spots: [...content.spots],
    meta: content.meta,
  };
  return JSON.stringify(data, null, 2);
}

export function parseBackup(text: string): BackupContent {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('ファイルを読み取れませんでした。JSON形式ではありません。');
  }

  if (typeof data !== 'object' || data === null) {
    throw new Error('バックアップファイルの形式が正しくありません。');
  }

  const record = data as Record<string, unknown>;
  if (record.version !== 1 && record.version !== BACKUP_VERSION) {
    throw new Error('対応していないバージョンのバックアップファイルです。');
  }
  if (!Array.isArray(record.patients)) {
    throw new Error('バックアップファイルの形式が正しくありません。');
  }
  const patients = record.patients.map((item, index) => toPatient(item, index));

  if (record.version === 1) {
    return { patients, photos: null, spots: [], meta: {} };
  }

  const photos = Array.isArray(record.photos)
    ? record.photos.map((item) => toBackupPhoto(item)).filter((item): item is BackupPhoto => item !== null)
    : null;
  const spots = Array.isArray(record.spots)
    ? record.spots.map((item) => toSpot(item)).filter((item): item is Spot => item !== null)
    : [];
  const meta = toMeta(record.meta);

  return { patients, photos, spots, meta };
}

/**
 * 写真を、ファイルに出てくる順のまま1人 MAX_PHOTOS_PER_PATIENT 枚までに絞る
 * (入れ替え・追加のどちらでも使う共通のルール)。
 */
function capPhotosPerPatient(photos: Photo[]): Photo[] {
  const result: Photo[] = [];
  const countByPatient = new Map<string, number>();
  for (const photo of photos) {
    const count = countByPatient.get(photo.patientId) ?? 0;
    if (count >= MAX_PHOTOS_PER_PATIENT) {
      continue;
    }
    result.push(photo);
    countByPatient.set(photo.patientId, count + 1);
  }
  return result;
}

/**
 * バックアップを「入れ替える」ときの、applyImport への計画。写真がnull(書き出す側で
 * 外した、または旧version 1のバックアップ)なら、既存の写真には一切触れない(消さない)。
 * 写真があれば、ファイルの訪問先ぶんの手元の写真をいったん全部消してから入れる
 * (同じidだけ上書きすると、ファイルの写真のidが既存と違うとき上限を超えて残ってしまうため)。
 * 写真は、ファイルの順で1人 MAX_PHOTOS_PER_PATIENT 枚まで取り込む(それ以上はcapPhotosPerPatientで捨てる)。
 */
export function planBackupReplace(content: BackupContent, decodedPhotos: Photo[] | null): DbImportPlan {
  return {
    replaceAll: true,
    patients: content.patients,
    replacePhotosOf: decodedPhotos === null ? [] : content.patients.map((patient) => patient.id),
    photos: decodedPhotos === null ? [] : capPhotosPerPatient(decodedPhotos),
    spots: content.spots,
    meta: content.meta,
  };
}

/** バックアップの「追加する」計画を立てるために必要な、手元(DB)の様子。 */
export type LocalSnapshot = {
  patientIds: ReadonlySet<string>;
  spotIds: ReadonlySet<string>;
  hasOffice: boolean;
  hasRouteEnds: boolean;
};

export type MergePlan = { write: DbImportPlan; added: number; kept: number; spotsAdded: number };

/**
 * バックアップを「今のデータに追加する」ときの、applyImport への計画。手元に同じidの人が
 * いれば、その人は一切書き換えない(上書きしない・そのまま)。写真は新しく足す人の分だけ、
 * ファイルの順で1人 MAX_PHOTOS_PER_PATIENT 枚まで取り込む。地点は手元に無いidだけ、
 * office・routeEndsは手元にまだ無いときだけ書く。
 */
export function planBackupMerge(content: BackupContent, decodedPhotos: Photo[] | null, local: LocalSnapshot): MergePlan {
  const newPatients = content.patients.filter((patient) => !local.patientIds.has(patient.id));
  const newPatientIds = new Set(newPatients.map((patient) => patient.id));
  const kept = content.patients.length - newPatients.length;

  const photos: Photo[] =
    decodedPhotos === null
      ? []
      : capPhotosPerPatient(decodedPhotos.filter((photo) => newPatientIds.has(photo.patientId)));

  const newSpots = content.spots.filter((spot) => !local.spotIds.has(spot.id));

  const meta: { office?: Office; routeEnds?: RouteEnds } = {};
  if (!local.hasOffice && content.meta.office !== undefined) {
    meta.office = content.meta.office;
  }
  if (!local.hasRouteEnds && content.meta.routeEnds !== undefined) {
    meta.routeEnds = content.meta.routeEnds;
  }

  return {
    write: {
      replaceAll: false,
      patients: newPatients,
      replacePhotosOf: [],
      photos,
      spots: newSpots,
      meta,
    },
    added: newPatients.length,
    kept,
    spotsAdded: newSpots.length,
  };
}

/** 追加の確認。手元にいる人が1人以上いれば括弧を付け、いなければ付けない。 */
export function mergeConfirmText(added: number, kept: number): string {
  return kept > 0
    ? `${added}人を追加します(手元にいる${kept}人はそのまま)。よろしいですか?`
    : `${added}人を追加します。よろしいですか?`;
}

/** 足す人が1人もいなかったとき(N=0)に、確認の代わりに出す知らせ。 */
export function mergeNothingText(kept: number): string {
  return kept > 0
    ? `追加する訪問先はありませんでした(手元にいる${kept}人はそのまま)。`
    : `追加する訪問先はありませんでした。`;
}

/** 追加が終わったときの文。地点も足していれば件数を添える。 */
export function mergeDoneText(added: number, spotsAdded: number): string {
  return spotsAdded > 0
    ? `${added}人・お役立ち地点${spotsAdded}件を追加しました。`
    : `${added}人を追加しました。`;
}

export function toPatient(item: unknown, index: number): Patient {
  if (typeof item !== 'object' || item === null) {
    throw new Error(`${index + 1}件目のデータが壊れています。`);
  }

  const record = item as Record<string, unknown>;
  for (const key of REQUIRED_KEYS) {
    const value = record[key];
    if (typeof value !== 'string' || value.length === 0) {
      throw new Error(`${index + 1}件目のデータに不足している項目があります。`);
    }
  }

  const location = toGeoLocation(record.location);
  const parking = toParking(record.parking);
  return {
    id: record.id as string,
    name: record.name as string,
    address: record.address as string,
    createdAt: record.createdAt as string,
    updatedAt: record.updatedAt as string,
    ...(typeof record.phone === 'string' && record.phone !== '' ? { phone: record.phone } : {}),
    ...(location ? { location } : {}),
    ...(parking ? { parking } : {}),
    ...(typeof record.note === 'string' && record.note !== '' ? { note: record.note } : {}),
  };
}

/** 壊れた・分からない値は無視して undefined にする。 */
function toParking(value: unknown): Parking | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const type = record.type;
  if (typeof type !== 'string' || !PARKING_TYPES.includes(type as ParkingType)) {
    return undefined;
  }
  const permitExpires = record.permitExpires;
  if (typeof permitExpires === 'string' && isDateKey(permitExpires)) {
    return { type: type as ParkingType, permitExpires };
  }
  return { type: type as ParkingType };
}

/** 壊れた・分からない値は無視して undefined にする(lat/lngは数かつ範囲内、accuracyは数かnull、sourceは既知の値のときだけ読む)。 */
function toGeoLocation(value: unknown): GeoLocation | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const lat = record.lat;
  const lng = record.lng;
  if (typeof lat !== 'number' || !Number.isFinite(lat) || Math.abs(lat) > 90) {
    return undefined;
  }
  if (typeof lng !== 'number' || !Number.isFinite(lng) || Math.abs(lng) > 180) {
    return undefined;
  }
  const accuracy = record.accuracy;
  if (accuracy !== null && (typeof accuracy !== 'number' || !Number.isFinite(accuracy))) {
    return undefined;
  }
  if (typeof record.recordedAt !== 'string' || record.recordedAt === '') {
    return undefined;
  }
  if (record.source !== 'gps' && record.source !== 'paste') {
    return undefined;
  }
  return { lat, lng, accuracy, recordedAt: record.recordedAt, source: record.source };
}

/** data URL(`data:<type>;base64,...`)の形をしているかどうか(中身のbase64自体が正しいかは見ない)。 */
const DATA_URL_PREFIX_PATTERN = /^data:[^;,]*;base64,/;

/** 形が合わなければ丸ごと捨てる(null)。写真は1件ごとに独立しているため、この項目だけ落とせばよい。 */
export function toBackupPhoto(value: unknown): BackupPhoto | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.id !== 'string' || record.id === '') {
    return null;
  }
  if (typeof record.patientId !== 'string' || record.patientId === '') {
    return null;
  }
  if (typeof record.dataUrl !== 'string' || !DATA_URL_PREFIX_PATTERN.test(record.dataUrl)) {
    return null;
  }
  if (typeof record.createdAt !== 'string' || record.createdAt === '') {
    return null;
  }
  return { id: record.id, patientId: record.patientId, dataUrl: record.dataUrl, createdAt: record.createdAt };
}

/** 形が合わなければ丸ごと捨てる(null)。位置が読めない地点は、地点として意味を持たないため捨てる。 */
export function toSpot(value: unknown): Spot | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.id !== 'string' || record.id === '') {
    return null;
  }
  if (typeof record.kind !== 'string' || !SPOT_KIND_VALUES.includes(record.kind as SpotKind)) {
    return null;
  }
  if (typeof record.note !== 'string') {
    return null;
  }
  if (typeof record.createdAt !== 'string' || record.createdAt === '') {
    return null;
  }
  const location = toGeoLocation(record.location);
  if (!location) {
    return null;
  }
  return { id: record.id, kind: record.kind as SpotKind, note: record.note, location, createdAt: record.createdAt };
}

function toOffice(value: unknown): Office | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.name !== 'string' || record.name === '') {
    return undefined;
  }
  if (typeof record.address !== 'string' || record.address === '') {
    return undefined;
  }
  return { name: record.name, address: record.address };
}

function toRouteEnds(value: unknown): RouteEnds | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.start !== 'string' || !ROUTE_STARTS.includes(record.start as RouteStart)) {
    return undefined;
  }
  if (typeof record.end !== 'string' || !ROUTE_END_VALUES.includes(record.end as RouteEnd)) {
    return undefined;
  }
  return { start: record.start as RouteStart, end: record.end as RouteEnd };
}

function toMeta(value: unknown): { office?: Office; routeEnds?: RouteEnds } {
  if (typeof value !== 'object' || value === null) {
    return {};
  }
  const record = value as Record<string, unknown>;
  const office = toOffice(record.office);
  const routeEnds = toRouteEnds(record.routeEnds);
  return { ...(office ? { office } : {}), ...(routeEnds ? { routeEnds } : {}) };
}
