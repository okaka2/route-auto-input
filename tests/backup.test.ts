import { describe, expect, it } from 'vitest';
import { MAX_PHOTOS_PER_PATIENT } from '../src/config';
import {
  BACKUP_VERSION,
  mergeConfirmText,
  mergeDoneText,
  mergeNothingText,
  parseBackup,
  planBackupMerge,
  planBackupReplace,
  serializeBackup,
  type BackupContent,
  type BackupPhoto,
  type LocalSnapshot,
} from '../src/backup';
import { createPatient } from '../src/patient';
import type { GeoLocation, Photo, Spot } from '../src/types';

const samplePatients = () => [
  createPatient('山田 太郎', '東京都千代田区1-1'),
  createPatient('鈴木 花子', '大阪市北区2-2'),
];

const emptyContent = (patients = samplePatients()): BackupContent => ({
  patients,
  photos: null,
  spots: [],
  meta: {},
});

const sampleLocation: GeoLocation = { lat: 35.68, lng: 139.76, accuracy: 12, recordedAt: '2026-09-01T00:00:00.000Z', source: 'gps' };

describe('serializeBackup', () => {
  it('バージョンと書き出し日時と患者一覧を含む', () => {
    const patients = samplePatients();
    const json = JSON.parse(serializeBackup(emptyContent(patients), new Date('2026-09-02T09:00:00.000Z')));
    expect(json.version).toBe(BACKUP_VERSION);
    expect(json.exportedAt).toBe('2026-09-02T09:00:00.000Z');
    expect(json.patients).toHaveLength(2);
  });
});

describe('parseBackup', () => {
  it('書き出したものを読み込むと同じ患者一覧に戻る', () => {
    const patients = samplePatients();
    expect(parseBackup(serializeBackup(emptyContent(patients))).patients).toEqual(patients);
  });

  it('JSONとして壊れていれば例外を投げる', () => {
    expect(() => parseBackup('{ not json')).toThrow();
  });

  it('patientsが配列でなければ例外を投げる', () => {
    const text = JSON.stringify({ version: BACKUP_VERSION, exportedAt: '', patients: {} });
    expect(() => parseBackup(text)).toThrow();
  });

  it('必須項目が欠けていれば例外を投げる', () => {
    const text = JSON.stringify({
      version: BACKUP_VERSION,
      exportedAt: '',
      patients: [{ id: 'a', name: '山田' }],
    });
    expect(() => parseBackup(text)).toThrow();
  });

  it('例外メッセージに氏名や住所を含めない', () => {
    const text = JSON.stringify({
      version: BACKUP_VERSION,
      exportedAt: '',
      patients: [{ id: 'a', name: '山田太郎', address: '東京都千代田区1-1' }],
    });
    try {
      parseBackup(text);
      expect.unreachable('例外が投げられるはず');
    } catch (error) {
      const message = (error as Error).message;
      expect(message).not.toContain('山田太郎');
      expect(message).not.toContain('千代田');
    }
  });

  it('患者0件のファイルは空配列として読み込める', () => {
    expect(parseBackup(serializeBackup(emptyContent([]))).patients).toEqual([]);
  });

  it('電話番号つきの訪問先も、往復して phone が残る', () => {
    const patients = [createPatient('山田 太郎', '東京都千代田区1-1', new Date(), '03-1234-5678')];
    expect(parseBackup(serializeBackup(emptyContent(patients))).patients).toEqual(patients);
  });

  it('駐車情報とメモも、version 1 の実ファイルから読み込める(旧ステージのバックアップ)', () => {
    const patients = [
      { ...createPatient('山田 太郎', '東京都千代田区1-1'), parking: { type: 'coin' as const }, note: '北側の月極' },
      {
        ...createPatient('鈴木 花子', '大阪市北区2-2'),
        parking: { type: 'street_permit' as const, permitExpires: '2027-03-31' },
      },
    ];
    const text = JSON.stringify({ version: 1, exportedAt: '2026-01-01T00:00:00.000Z', patients });
    expect(parseBackup(text).patients).toEqual(patients);
  });

  it('parking.type が選択肢にない/壊れていれば parking を無視する', () => {
    const text = JSON.stringify({
      version: BACKUP_VERSION,
      exportedAt: '',
      patients: [
        {
          id: 'a',
          name: '山田太郎',
          address: '東京都千代田区1-1',
          createdAt: 't1',
          updatedAt: 't2',
          parking: { type: 'その他' },
        },
        {
          id: 'b',
          name: '鈴木花子',
          address: '大阪市北区2-2',
          createdAt: 't1',
          updatedAt: 't2',
          parking: 'coin',
        },
      ],
    });
    const { patients } = parseBackup(text);
    expect('parking' in patients[0]!).toBe(false);
    expect('parking' in patients[1]!).toBe(false);
  });

  it('permitExpires が YYYY-MM-DD でなければ無視する(parking自体は残す)', () => {
    const text = JSON.stringify({
      version: BACKUP_VERSION,
      exportedAt: '',
      patients: [
        {
          id: 'a',
          name: '山田太郎',
          address: '東京都千代田区1-1',
          createdAt: 't1',
          updatedAt: 't2',
          parking: { type: 'street_permit', permitExpires: '2027/03/31' },
        },
      ],
    });
    const { patients } = parseBackup(text);
    expect(patients[0]!.parking).toEqual({ type: 'street_permit' });
  });

  it('note が空文字や不正な型なら持たない', () => {
    const text = JSON.stringify({
      version: BACKUP_VERSION,
      exportedAt: '',
      patients: [
        { id: 'a', name: '山田太郎', address: '東京都千代田区1-1', createdAt: 't1', updatedAt: 't2', note: '' },
        { id: 'b', name: '鈴木花子', address: '大阪市北区2-2', createdAt: 't1', updatedAt: 't2', note: 123 },
      ],
    });
    const { patients } = parseBackup(text);
    expect('note' in patients[0]!).toBe(false);
    expect('note' in patients[1]!).toBe(false);
  });

  it('phone が無い古いデータも読み込める', () => {
    const text = JSON.stringify({
      version: BACKUP_VERSION,
      exportedAt: '',
      patients: [
        { id: 'a', name: '山田太郎', address: '東京都千代田区1-1', createdAt: 't1', updatedAt: 't2' },
      ],
    });
    const { patients } = parseBackup(text);
    expect('phone' in patients[0]!).toBe(false);
  });

  it('位置つきの訪問先も、往復して location が残る', () => {
    const patients = [{ ...createPatient('山田 太郎', '東京都千代田区1-1'), location: sampleLocation }];
    expect(parseBackup(serializeBackup(emptyContent(patients))).patients).toEqual(patients);
  });

  it('壊れた location は外して読む(訪問先自体は読む)', () => {
    const text = JSON.stringify({
      version: BACKUP_VERSION,
      exportedAt: '',
      patients: [
        {
          id: 'a',
          name: '山田太郎',
          address: '東京都千代田区1-1',
          createdAt: 't1',
          updatedAt: 't2',
          location: { lat: 200, lng: 139.76, accuracy: null, recordedAt: 't1', source: 'gps' },
        },
        {
          id: 'b',
          name: '鈴木花子',
          address: '大阪市北区2-2',
          createdAt: 't1',
          updatedAt: 't2',
          location: { lat: 35, lng: 139, accuracy: null, recordedAt: 't1', source: 'unknown' },
        },
      ],
    });
    const { patients } = parseBackup(text);
    expect('location' in patients[0]!).toBe(false);
    expect('location' in patients[1]!).toBe(false);
  });

  it('v2の往復: 写真・お役立ち地点・meta(事業所・出発帰着)も残る', () => {
    const patients = samplePatients();
    const photos: BackupPhoto[] = [
      { id: 'p1', patientId: patients[0]!.id, dataUrl: 'data:image/jpeg;base64,AAA=', createdAt: 't1' },
    ];
    const spots: Spot[] = [
      { id: 's1', kind: 'toilet', note: 'コンビニのトイレ', location: sampleLocation, createdAt: 't1' },
    ];
    const content: BackupContent = {
      patients,
      photos,
      spots,
      meta: { office: { name: '本店', address: '東京都中央区1-2-3' }, routeEnds: { start: 'office', end: 'last' } },
    };
    const result = parseBackup(serializeBackup(content));
    expect(result.patients).toEqual(patients);
    expect(result.photos).toEqual(photos);
    expect(result.spots).toEqual(spots);
    expect(result.meta).toEqual(content.meta);
  });

  it('写真を含めずに書き出すと、読み込んだ photos は null', () => {
    const result = parseBackup(serializeBackup(emptyContent()));
    expect(result.photos).toBeNull();
  });

  it('旧形式(version 1)のファイルも読める(photosはnull、spotsは空、metaは空)', () => {
    const patients = samplePatients();
    const text = JSON.stringify({ version: 1, exportedAt: '2026-01-01T00:00:00.000Z', patients });
    const result = parseBackup(text);
    expect(result.patients).toEqual(patients);
    expect(result.photos).toBeNull();
    expect(result.spots).toEqual([]);
    expect(result.meta).toEqual({});
  });

  it('壊れた写真だけ捨てて、ほかは読み込む', () => {
    const good: BackupPhoto = { id: 'p1', patientId: 'a', dataUrl: 'data:image/jpeg;base64,AAA=', createdAt: 't1' };
    const text = JSON.stringify({
      version: BACKUP_VERSION,
      exportedAt: '',
      patients: [],
      photos: [good, { id: 'p2' /* patientIdが無い */ }, 'not an object'],
      spots: [],
      meta: {},
    });
    const result = parseBackup(text);
    expect(result.photos).toEqual([good]);
  });

  it('dataUrlの形(data:<type>;base64,...)をしていない写真は捨てる', () => {
    const good: BackupPhoto = { id: 'p1', patientId: 'a', dataUrl: 'data:image/jpeg;base64,AAA=', createdAt: 't1' };
    const bad: BackupPhoto = { id: 'p2', patientId: 'a', dataUrl: 'not a data url', createdAt: 't1' };
    const text = JSON.stringify({
      version: BACKUP_VERSION,
      exportedAt: '',
      patients: [],
      photos: [good, bad],
      spots: [],
      meta: {},
    });
    const result = parseBackup(text);
    expect(result.photos).toEqual([good]);
  });

  it('壊れたお役立ち地点だけ捨てて、ほかは読み込む', () => {
    const good: Spot = { id: 's1', kind: 'toilet', note: '', location: sampleLocation, createdAt: 't1' };
    const text = JSON.stringify({
      version: BACKUP_VERSION,
      exportedAt: '',
      patients: [],
      photos: null,
      spots: [good, { id: 's2', kind: 'unknown-kind', note: '', location: sampleLocation, createdAt: 't1' }],
      meta: {},
    });
    const result = parseBackup(text);
    expect(result.spots).toEqual([good]);
  });

  it('形の合わない meta(事業所・出発帰着)は無視する', () => {
    const text = JSON.stringify({
      version: BACKUP_VERSION,
      exportedAt: '',
      patients: [],
      photos: null,
      spots: [],
      meta: { office: { name: '' }, routeEnds: { start: 'space', end: 'last' } },
    });
    const result = parseBackup(text);
    expect(result.meta).toEqual({});
  });

  it('バージョン3のファイルは「対応していないバージョンのバックアップファイルです。」で拒否する', () => {
    const text = JSON.stringify({ version: 3, exportedAt: '', patients: [], photos: null, spots: [], meta: {} });
    expect(() => parseBackup(text)).toThrow('対応していないバージョンのバックアップファイルです。');
  });
});

const localOf = (overrides: Partial<LocalSnapshot> = {}): LocalSnapshot => ({
  patientIds: new Set(),
  spotIds: new Set(),
  hasOffice: false,
  hasRouteEnds: false,
  ...overrides,
});

const mergePhoto = (patientId: string, id: string, createdAt: string): Photo => ({
  id,
  patientId,
  blob: new Blob(['x'], { type: 'image/jpeg' }),
  createdAt,
});

describe('planBackupReplace', () => {
  it('写真は入れ替えでも、ファイルの順で1人MAX_PHOTOS_PER_PATIENT枚まで(5枚あっても4枚目以降は入らない)', () => {
    const patient = createPatient('山田 太郎', '東京都千代田区1-1');
    const decodedPhotos: Photo[] = [
      mergePhoto(patient.id, 'p1', 't1'),
      mergePhoto(patient.id, 'p2', 't2'),
      mergePhoto(patient.id, 'p3', 't3'),
      mergePhoto(patient.id, 'p4', 't4'),
      mergePhoto(patient.id, 'p5', 't5'),
    ];
    const plan = planBackupReplace({ patients: [patient], photos: null, spots: [], meta: {} }, decodedPhotos);
    expect(MAX_PHOTOS_PER_PATIENT).toBe(3);
    expect(plan.photos.map((p) => p.id)).toEqual(['p1', 'p2', 'p3']);
    expect(plan.replaceAll).toBe(true);
    expect(plan.replacePhotosOf).toEqual([patient.id]);
  });

  it('写真の枚数が上限以下ならそのまま全部入る', () => {
    const patient = createPatient('山田 太郎', '東京都千代田区1-1');
    const decodedPhotos: Photo[] = [mergePhoto(patient.id, 'p1', 't1'), mergePhoto(patient.id, 'p2', 't2')];
    const plan = planBackupReplace({ patients: [patient], photos: null, spots: [], meta: {} }, decodedPhotos);
    expect(plan.photos.map((p) => p.id)).toEqual(['p1', 'p2']);
  });

  it('decodedPhotosがnullなら、写真には触れない(replacePhotosOfも空)', () => {
    const patient = createPatient('山田 太郎', '東京都千代田区1-1');
    const plan = planBackupReplace({ patients: [patient], photos: null, spots: [], meta: {} }, null);
    expect(plan.photos).toEqual([]);
    expect(plan.replacePhotosOf).toEqual([]);
  });
});

describe('planBackupMerge', () => {
  it('手元にいる人は write.patients に入らず、新しい人だけ入る(added・keptの数も返す)', () => {
    const existing = createPatient('既存', '東京都千代田区1-1');
    const fresh = createPatient('新規', '大阪市北区2-2');
    const plan = planBackupMerge(
      { patients: [existing, fresh], photos: null, spots: [], meta: {} },
      null,
      localOf({ patientIds: new Set([existing.id]) }),
    );
    expect(plan.write.patients).toEqual([fresh]);
    expect(plan.write.replaceAll).toBe(false);
    expect(plan.write.replacePhotosOf).toEqual([]);
    expect(plan.added).toBe(1);
    expect(plan.kept).toBe(1);
  });

  it('写真は新しい人の分だけ、ファイルの順で1人MAX_PHOTOS_PER_PATIENT枚まで(4枚目は入らない)', () => {
    const existing = createPatient('既存', '東京都千代田区1-1');
    const fresh = createPatient('新規', '大阪市北区2-2');
    const decodedPhotos: Photo[] = [
      mergePhoto(existing.id, 'existing-photo', 't0'),
      mergePhoto(fresh.id, 'p1', 't1'),
      mergePhoto(fresh.id, 'p2', 't2'),
      mergePhoto(fresh.id, 'p3', 't3'),
      mergePhoto(fresh.id, 'p4', 't4'),
    ];
    const plan = planBackupMerge(
      { patients: [existing, fresh], photos: null, spots: [], meta: {} },
      decodedPhotos,
      localOf({ patientIds: new Set([existing.id]) }),
    );
    expect(MAX_PHOTOS_PER_PATIENT).toBe(3);
    expect(plan.write.photos.map((p) => p.id)).toEqual(['p1', 'p2', 'p3']);
  });

  it('地点は無いidだけ足す(重複idは除く)', () => {
    const existingSpot: Spot = {
      id: 'existing-spot',
      kind: 'toilet',
      note: '',
      location: { lat: 35, lng: 139, accuracy: null, recordedAt: 't', source: 'gps' },
      createdAt: 't',
    };
    const newSpot: Spot = { ...existingSpot, id: 'new-spot' };
    const plan = planBackupMerge(
      { patients: [], photos: null, spots: [existingSpot, newSpot], meta: {} },
      null,
      localOf({ spotIds: new Set([existingSpot.id]) }),
    );
    expect(plan.write.spots).toEqual([newSpot]);
    expect(plan.spotsAdded).toBe(1);
  });

  it('office・routeEndsは手元にまだ無いときだけ書く', () => {
    const office = { name: '本店', address: '東京都中央区1-1' };
    const routeEnds = { start: 'office' as const, end: 'last' as const };
    const withNeither = planBackupMerge({ patients: [], photos: null, spots: [], meta: { office, routeEnds } }, null, localOf());
    expect(withNeither.write.meta).toEqual({ office, routeEnds });

    const withBoth = planBackupMerge(
      { patients: [], photos: null, spots: [], meta: { office, routeEnds } },
      null,
      localOf({ hasOffice: true, hasRouteEnds: true }),
    );
    expect(withBoth.write.meta).toEqual({});
  });
});

describe('mergeConfirmText・mergeNothingText・mergeDoneText', () => {
  it('mergeConfirmText: 手元にいる人がいれば括弧を付け、いなければ付けない', () => {
    expect(mergeConfirmText(2, 1)).toBe('2人を追加します(手元にいる1人はそのまま)。よろしいですか?');
    expect(mergeConfirmText(2, 0)).toBe('2人を追加します。よろしいですか?');
  });

  it('mergeNothingText: 手元にいる人がいれば括弧を付け、いなければ付けない(M=0)', () => {
    expect(mergeNothingText(1)).toBe('追加する訪問先はありませんでした(手元にいる1人はそのまま)。');
    expect(mergeNothingText(0)).toBe('追加する訪問先はありませんでした。');
  });

  it('mergeDoneText: 地点を足していれば件数を添える', () => {
    expect(mergeDoneText(2, 0)).toBe('2人を追加しました。');
    expect(mergeDoneText(2, 3)).toBe('2人・お役立ち地点3件を追加しました。');
  });
});
