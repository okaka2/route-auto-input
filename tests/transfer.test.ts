import { describe, expect, it } from 'vitest';
import { MAX_PHOTOS_PER_PATIENT } from '../src/config';
import { createPatient } from '../src/patient';
import type { BackupPhoto } from '../src/backup';
import {
  describeRecipients,
  findConflicts,
  parsePayload,
  planImport,
  serializePayload,
  type Conflict,
  type ConflictChoice,
  type ImportPlan,
  type TransferPayload,
} from '../src/transfer';
import type { Patient, Photo, Spot } from '../src/types';

const yamada = () => createPatient('山田 太郎', '東京都千代田区1-1');
const suzuki = () => createPatient('鈴木 花子', '大阪市北区2-2');

const samplePatients = () => [yamada(), suzuki()];

const backupPhoto = (patientId: string, id = `photo-${patientId}`): BackupPhoto => ({
  id,
  patientId,
  dataUrl: 'data:image/jpeg;base64,eA==',
  createdAt: '2026-09-01T00:00:00.000Z',
});

const decodedPhoto = (patientId: string, id = `photo-${patientId}`): Photo => ({
  id,
  patientId,
  blob: new Blob(['x'], { type: 'image/jpeg' }),
  createdAt: '2026-09-01T00:00:00.000Z',
});

const sampleSpot = (id: string): Spot => ({
  id,
  kind: 'toilet',
  note: '',
  location: { lat: 35.68, lng: 139.76, accuracy: 10, recordedAt: '2026-09-01T00:00:00.000Z', source: 'gps' },
  createdAt: '2026-09-01T00:00:00.000Z',
});

const emptyPayload = (patients = samplePatients()): Omit<TransferPayload, 'kind' | 'v'> => ({
  sentAt: '2026-09-02T09:00:00.000Z',
  patients,
  photos: null,
  spots: [],
});

describe('serializePayload / parsePayload', () => {
  it('往復すると同じ内容に戻る', () => {
    const patients = samplePatients();
    const payload = parsePayload(serializePayload(emptyPayload(patients)));
    expect(payload.kind).toBe('houmon-transfer-payload');
    expect(payload.v).toBe(1);
    expect(payload.sentAt).toBe('2026-09-02T09:00:00.000Z');
    expect(payload.patients).toEqual(patients);
    expect(payload.photos).toBeNull();
    expect(payload.spots).toEqual([]);
  });

  it('写真・地点を含めて往復できる', () => {
    const patients = samplePatients();
    const photos = [backupPhoto(patients[0]!.id)];
    const spots = [sampleSpot('spot-1')];
    const payload = parsePayload(
      serializePayload({ sentAt: '2026-09-02T09:00:00.000Z', patients, photos, spots }),
    );
    expect(payload.photos).toEqual(photos);
    expect(payload.spots).toEqual(spots);
  });

  it('余計なプロパティは書き出しに含めない(送る側で項目を絞る)', () => {
    const basePatient = yamada();
    const patientWithExtra = { ...basePatient, secretField: 'top-secret-value' } as Patient;
    const text = serializePayload(emptyPayload([patientWithExtra]));
    expect(text).not.toContain('secretField');
    expect(text).not.toContain('top-secret-value');
    const payload = parsePayload(text);
    expect(payload.patients).toEqual([basePatient]);
  });

  it('JSONとして壊れていれば例外を投げる', () => {
    expect(() => parsePayload('{ not json')).toThrow('引き継ぎのファイルの中身を読めませんでした。');
  });

  it('kindやvが違えば例外を投げる', () => {
    const patients = samplePatients();
    const text = JSON.stringify({
      kind: 'other',
      v: 1,
      sentAt: '2026-09-02T09:00:00.000Z',
      patients,
      photos: null,
      spots: [],
    });
    expect(() => parsePayload(text)).toThrow('引き継ぎのファイルの中身を読めませんでした。');
    const text2 = JSON.stringify({
      kind: 'houmon-transfer-payload',
      v: 2,
      sentAt: '2026-09-02T09:00:00.000Z',
      patients,
      photos: null,
      spots: [],
    });
    expect(() => parsePayload(text2)).toThrow('引き継ぎのファイルの中身を読めませんでした。');
  });

  it('訪問先のidが重複していれば例外を投げる', () => {
    const patients = samplePatients();
    const duplicated = [patients[0]!, { ...patients[1]!, id: patients[0]!.id }];
    const text = JSON.stringify({
      kind: 'houmon-transfer-payload',
      v: 1,
      sentAt: '2026-09-02T09:00:00.000Z',
      patients: duplicated,
      photos: null,
      spots: [],
    });
    expect(() => parsePayload(text)).toThrow('引き継ぎのファイルの中身を読めませんでした。');
  });

  it('patientsが配列でなければ例外を投げる', () => {
    const text = JSON.stringify({
      kind: 'houmon-transfer-payload',
      v: 1,
      sentAt: '2026-09-02T09:00:00.000Z',
      patients: {},
      photos: null,
      spots: [],
    });
    expect(() => parsePayload(text)).toThrow('引き継ぎのファイルの中身を読めませんでした。');
  });

  it('必須項目が欠けている訪問先があれば例外を投げる', () => {
    const text = JSON.stringify({
      kind: 'houmon-transfer-payload',
      v: 1,
      sentAt: '2026-09-02T09:00:00.000Z',
      patients: [{ id: 'a', name: '山田' }],
      photos: null,
      spots: [],
    });
    expect(() => parsePayload(text)).toThrow('引き継ぎのファイルの中身を読めませんでした。');
  });

  it('壊れた写真は1件ずつ捨てる(他は残る)', () => {
    const patients = samplePatients();
    const goodPhoto = backupPhoto(patients[0]!.id, 'good');
    const text = JSON.stringify({
      kind: 'houmon-transfer-payload',
      v: 1,
      sentAt: '2026-09-02T09:00:00.000Z',
      patients,
      photos: [goodPhoto, { id: 'broken' }, { ...goodPhoto, dataUrl: 'not-a-data-url' }],
      spots: [],
    });
    const payload = parsePayload(text);
    expect(payload.photos).toEqual([goodPhoto]);
  });

  it('壊れた地点は1件ずつ捨てる(他は残る)', () => {
    const patients = samplePatients();
    const goodSpot = sampleSpot('good');
    const text = JSON.stringify({
      kind: 'houmon-transfer-payload',
      v: 1,
      sentAt: '2026-09-02T09:00:00.000Z',
      patients,
      photos: null,
      spots: [goodSpot, { id: 'broken' }],
    });
    const payload = parsePayload(text);
    expect(payload.spots).toEqual([goodSpot]);
  });
});

describe('describeRecipients', () => {
  it('0人なら空文字', () => {
    expect(describeRecipients([])).toBe('');
  });

  it('1人なら「(名前)様」', () => {
    expect(describeRecipients([yamada()])).toBe('山田 太郎様');
  });

  it('複数人なら「(先頭の名前)様ほか(残り)人」', () => {
    expect(describeRecipients([yamada(), suzuki(), createPatient('佐藤 次郎', '福岡県福岡市3-3')])).toBe(
      '山田 太郎様ほか2人',
    );
  });
});

describe('findConflicts', () => {
  it('名前と住所が両方一致すれば同じ人とみなす', () => {
    const existingPatient = yamada();
    const incoming: Patient = { ...yamada(), id: 'incoming-1' };
    const { conflicts, fresh } = findConflicts([incoming], [existingPatient]);
    expect(fresh).toEqual([]);
    expect(conflicts).toEqual<Conflict[]>([{ incoming, existing: existingPatient }]);
  });

  it('全角/空白/「様」の違いがあっても同じ人とみなす', () => {
    const existingPatient = createPatient('山田　太郎', '東京都千代田区1丁目1番1号');
    const incoming: Patient = { ...createPatient('山田 太郎様', '東京都千代田区1-1-1'), id: 'incoming-1' };
    const { conflicts, fresh } = findConflicts([incoming], [existingPatient]);
    expect(fresh).toEqual([]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.existing).toEqual(existingPatient);
  });

  it('住所だけ一致しても名前が違えば別人(freshに入る)', () => {
    const existingPatient = yamada();
    const incoming: Patient = { ...suzuki(), address: existingPatient.address, id: 'incoming-1' };
    const { conflicts, fresh } = findConflicts([incoming], [existingPatient]);
    expect(conflicts).toEqual([]);
    expect(fresh).toEqual([incoming]);
  });

  it('名前だけ一致しても住所が違えば別人(freshに入る)', () => {
    const existingPatient = yamada();
    const incoming: Patient = { ...yamada(), address: '別の住所', id: 'incoming-1' };
    const { conflicts, fresh } = findConflicts([incoming], [existingPatient]);
    expect(conflicts).toEqual([]);
    expect(fresh).toEqual([incoming]);
  });
});

describe('planImport', () => {
  const now = new Date('2026-09-27T10:00:00.000Z');
  let seq = 0;
  const newId = () => `new-${(seq += 1)}`;

  const makePayload = (patients: Patient[], photos: BackupPhoto[] | null = null, spots: Spot[] = []): TransferPayload => ({
    kind: 'houmon-transfer-payload',
    v: 1,
    sentAt: '2026-09-27T09:00:00.000Z',
    patients,
    photos,
    spots,
  });

  it('overwrite: 手元のidとcreatedAtを残し、名前・住所・(送り手にある項目)は送られてきたものにする(送り手に無い項目は手元を残す)', () => {
    seq = 0;
    const existingPatient: Patient = {
      ...yamada(),
      id: 'existing-1',
      createdAt: '2026-01-01T00:00:00.000Z',
      phone: '03-0000-0000',
      note: '古いメモ',
    };
    const incoming: Patient = { id: 'incoming-1', name: '山田 太郎', address: existingPatient.address, createdAt: '2000-01-01T00:00:00.000Z', updatedAt: '2000-01-01T00:00:00.000Z', note: '新しいメモ' };
    const payload = makePayload([incoming]);
    const choices: ReadonlyMap<string, ConflictChoice> = new Map([[incoming.id, 'overwrite']]);
    const plan: ImportPlan = planImport(payload, null, [existingPatient], new Set(), choices, newId, now);
    expect(plan.put).toEqual<Patient[]>([
      {
        id: 'existing-1',
        name: '山田 太郎',
        address: existingPatient.address,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: now.toISOString(),
        // 電話は送り手に無い(undefined)ので、手元の値を残す。
        phone: '03-0000-0000',
        // メモは送り手にあるので、送り手の値で置き換える。
        note: '新しいメモ',
      },
    ]);
  });

  it('overwrite: 送り手に電話・位置・駐車・メモが無ければ、手元の値をすべて残す', () => {
    seq = 0;
    const existingPatient: Patient = {
      ...yamada(),
      id: 'existing-1',
      phone: '03-0000-0000',
      location: { lat: 35, lng: 139, accuracy: 10, recordedAt: '2026-01-01T00:00:00.000Z', source: 'gps' },
      parking: { type: 'onsite' },
      note: '手元のメモ',
    };
    const incoming: Patient = {
      id: 'incoming-1',
      name: '山田 太郎',
      address: existingPatient.address,
      createdAt: '2000-01-01T00:00:00.000Z',
      updatedAt: '2000-01-01T00:00:00.000Z',
    };
    const payload = makePayload([incoming]);
    const choices: ReadonlyMap<string, ConflictChoice> = new Map([[incoming.id, 'overwrite']]);
    const plan = planImport(payload, null, [existingPatient], new Set(), choices, newId, now);
    expect(plan.put[0]!.phone).toBe('03-0000-0000');
    expect(plan.put[0]!.location).toEqual(existingPatient.location);
    expect(plan.put[0]!.parking).toEqual({ type: 'onsite' });
    expect(plan.put[0]!.note).toBe('手元のメモ');
  });

  it('overwrite: 送り手に電話・位置・駐車・メモがあれば、送り手の値で置き換える(空文字も未設定扱い)', () => {
    seq = 0;
    const existingPatient: Patient = {
      ...yamada(),
      id: 'existing-1',
      phone: '03-0000-0000',
      note: '手元のメモ',
    };
    const incoming: Patient = {
      id: 'incoming-1',
      name: '山田 太郎',
      address: existingPatient.address,
      createdAt: '2000-01-01T00:00:00.000Z',
      updatedAt: '2000-01-01T00:00:00.000Z',
      phone: '', // 空文字も未設定扱いなので、手元の電話が残る
      location: { lat: 1, lng: 2, accuracy: null, recordedAt: '2026-02-01T00:00:00.000Z', source: 'paste' },
      parking: { type: 'coin' },
      note: '送り手のメモ',
    };
    const payload = makePayload([incoming]);
    const choices: ReadonlyMap<string, ConflictChoice> = new Map([[incoming.id, 'overwrite']]);
    const plan = planImport(payload, null, [existingPatient], new Set(), choices, newId, now);
    expect(plan.put[0]!.phone).toBe('03-0000-0000');
    expect(plan.put[0]!.location).toEqual(incoming.location);
    expect(plan.put[0]!.parking).toEqual({ type: 'coin' });
    expect(plan.put[0]!.note).toBe('送り手のメモ');
  });

  it('overwrite: 送り手が路上(要許可証)で期限を書いておらず、手元も路上(要許可証)で期限を持っていれば、手元の期限を残す', () => {
    seq = 0;
    const existingPatient: Patient = {
      ...yamada(),
      id: 'existing-1',
      parking: { type: 'street_permit', permitExpires: '2026-12-31' },
    };
    const incoming: Patient = {
      id: 'incoming-1',
      name: '山田 太郎',
      address: existingPatient.address,
      createdAt: '2000-01-01T00:00:00.000Z',
      updatedAt: '2000-01-01T00:00:00.000Z',
      parking: { type: 'street_permit' },
    };
    const payload = makePayload([incoming]);
    const choices: ReadonlyMap<string, ConflictChoice> = new Map([[incoming.id, 'overwrite']]);
    const plan = planImport(payload, null, [existingPatient], new Set(), choices, newId, now);
    expect(plan.put[0]!.parking).toEqual({ type: 'street_permit', permitExpires: '2026-12-31' });
  });

  it('overwrite: 種類が路上(要許可証)以外なら、期限が無くても送り手の駐車でそのまま置き換える', () => {
    seq = 0;
    const existingPatient: Patient = {
      ...yamada(),
      id: 'existing-1',
      parking: { type: 'street_permit', permitExpires: '2026-12-31' },
    };
    const incoming: Patient = {
      id: 'incoming-1',
      name: '山田 太郎',
      address: existingPatient.address,
      createdAt: '2000-01-01T00:00:00.000Z',
      updatedAt: '2000-01-01T00:00:00.000Z',
      parking: { type: 'coin' },
    };
    const payload = makePayload([incoming]);
    const choices: ReadonlyMap<string, ConflictChoice> = new Map([[incoming.id, 'overwrite']]);
    const plan = planImport(payload, null, [existingPatient], new Set(), choices, newId, now);
    expect(plan.put[0]!.parking).toEqual({ type: 'coin' });
  });

  it('overwrite: 送り手の路上(要許可証)に期限があれば、手元の期限を残さず送り手の期限にする', () => {
    seq = 0;
    const existingPatient: Patient = {
      ...yamada(),
      id: 'existing-1',
      parking: { type: 'street_permit', permitExpires: '2026-12-31' },
    };
    const incoming: Patient = {
      id: 'incoming-1',
      name: '山田 太郎',
      address: existingPatient.address,
      createdAt: '2000-01-01T00:00:00.000Z',
      updatedAt: '2000-01-01T00:00:00.000Z',
      parking: { type: 'street_permit', permitExpires: '2027-01-15' },
    };
    const payload = makePayload([incoming]);
    const choices: ReadonlyMap<string, ConflictChoice> = new Map([[incoming.id, 'overwrite']]);
    const plan = planImport(payload, null, [existingPatient], new Set(), choices, newId, now);
    expect(plan.put[0]!.parking).toEqual({ type: 'street_permit', permitExpires: '2027-01-15' });
  });

  it('overwrite: 名前・住所は、手元と違っても常に送り手の値にする', () => {
    seq = 0;
    const existingPatient: Patient = { ...yamada(), id: 'existing-1' };
    const incoming: Patient = {
      id: 'incoming-1',
      name: '山田 太郎(新)',
      address: '東京都千代田区9-9',
      createdAt: '2000-01-01T00:00:00.000Z',
      updatedAt: '2000-01-01T00:00:00.000Z',
    };
    const payload = makePayload([incoming]);
    const choices: ReadonlyMap<string, ConflictChoice> = new Map([[incoming.id, 'overwrite']]);
    const plan = planImport(payload, null, [existingPatient], new Set(), choices, newId, now);
    expect(plan.put[0]!.name).toBe('山田 太郎(新)');
    expect(plan.put[0]!.address).toBe('東京都千代田区9-9');
  });

  it('addNew: 別に追加すると新しいidで、createdAt/updatedAtがnowになる', () => {
    seq = 0;
    const existingPatient: Patient = { ...yamada(), id: 'existing-1' };
    const incoming: Patient = { ...yamada(), id: 'incoming-1' };
    const payload = makePayload([incoming]);
    const choices: ReadonlyMap<string, ConflictChoice> = new Map([[incoming.id, 'addNew']]);
    const plan = planImport(payload, null, [existingPatient], new Set(), choices, newId, now);
    expect(plan.put).toHaveLength(1);
    expect(plan.put[0]!.id).toBe('new-1');
    expect(plan.put[0]!.createdAt).toBe(now.toISOString());
    expect(plan.put[0]!.updatedAt).toBe(now.toISOString());
    expect(plan.put[0]!.name).toBe(incoming.name);
  });

  it('skip: 何も保存しない(選ばなかった衝突もskip扱い)', () => {
    seq = 0;
    const existingPatient: Patient = { ...yamada(), id: 'existing-1' };
    const incoming: Patient = { ...yamada(), id: 'incoming-1' };
    const payload = makePayload([incoming]);
    const explicit = planImport(
      payload,
      null,
      [existingPatient],
      new Set(),
      new Map([[incoming.id, 'skip']]),
      newId,
      now,
    );
    expect(explicit.put).toEqual([]);

    const noChoice = planImport(payload, null, [existingPatient], new Set(), new Map(), newId, now);
    expect(noChoice.put).toEqual([]);
  });

  it('新規(衝突なし)の人はそのまま新しいidで追加される', () => {
    seq = 0;
    const incoming: Patient = { ...yamada(), id: 'incoming-1' };
    const payload = makePayload([incoming]);
    const plan = planImport(payload, null, [], new Set(), new Map(), newId, now);
    expect(plan.put).toHaveLength(1);
    expect(plan.put[0]!.id).toBe('new-1');
    expect(plan.put[0]!.createdAt).toBe(now.toISOString());
  });

  it('写真を含めないファイル(photos: null)なら、上書きでも写真は入らない', () => {
    seq = 0;
    const existingPatient: Patient = { ...yamada(), id: 'existing-1' };
    const incoming: Patient = { ...yamada(), id: 'incoming-1' };
    const payload = makePayload([incoming]);
    const plan = planImport(
      payload,
      null,
      [existingPatient],
      new Set(),
      new Map([[incoming.id, 'overwrite']]),
      newId,
      now,
    );
    expect(plan.photosByPatient.size).toBe(0);
  });

  it('新規は新しいidで写真のpatientIdも付け替わる', () => {
    seq = 0;
    const incoming: Patient = { ...yamada(), id: 'incoming-1' };
    const decoded = [decodedPhoto(incoming.id, 'photo-a')];
    const payload = makePayload([incoming], [backupPhoto(incoming.id, 'photo-a')]);
    const plan = planImport(payload, decoded, [], new Set(), new Map(), newId, now);
    const targetId = plan.put[0]!.id;
    expect(targetId).toBe('new-1');
    const photos = plan.photosByPatient.get(targetId);
    expect(photos).toHaveLength(1);
    expect(photos?.[0]!.patientId).toBe(targetId);
    expect(photos?.[0]!.id).not.toBe('photo-a');
    expect(photos?.[0]!.blob).toBe(decoded[0]!.blob);
  });

  it('上書きでも写真のpatientIdは手元のidに付け替わる', () => {
    seq = 0;
    const existingPatient: Patient = { ...yamada(), id: 'existing-1' };
    const incoming: Patient = { ...yamada(), id: 'incoming-1' };
    const decoded = [decodedPhoto(incoming.id, 'photo-a')];
    const payload = makePayload([incoming], [backupPhoto(incoming.id, 'photo-a')]);
    const plan = planImport(
      payload,
      decoded,
      [existingPatient],
      new Set(),
      new Map([[incoming.id, 'overwrite']]),
      newId,
      now,
    );
    const photos = plan.photosByPatient.get('existing-1');
    expect(photos).toHaveLength(1);
    expect(photos?.[0]!.patientId).toBe('existing-1');
  });

  it('写真を含むファイルでも、その人に送られてきた写真が0枚なら上書きで手元の写真を消さない', () => {
    seq = 0;
    const existingPatient: Patient = { ...yamada(), id: 'existing-1' };
    const incoming: Patient = { ...yamada(), id: 'incoming-1' };
    // decodedPhotosには写真があるが、他の人(other-1)のものだけで、incoming-1の分はない。
    const decoded = [decodedPhoto('other-1', 'photo-other')];
    const payload = makePayload([incoming], [backupPhoto('other-1', 'photo-other')]);
    const plan = planImport(
      payload,
      decoded,
      [existingPatient],
      new Set(),
      new Map([[incoming.id, 'overwrite']]),
      newId,
      now,
    );
    expect(plan.photosByPatient.has('existing-1')).toBe(false);
  });

  it('上書きで2枚送られてくれば、付け替えた2枚がphotosByPatientに入る', () => {
    seq = 0;
    const existingPatient: Patient = { ...yamada(), id: 'existing-1' };
    const incoming: Patient = { ...yamada(), id: 'incoming-1' };
    const decoded = [decodedPhoto(incoming.id, 'photo-a'), decodedPhoto(incoming.id, 'photo-b')];
    const payload = makePayload(
      [incoming],
      decoded.map((p) => backupPhoto(incoming.id, p.id)),
    );
    const plan = planImport(
      payload,
      decoded,
      [existingPatient],
      new Set(),
      new Map([[incoming.id, 'overwrite']]),
      newId,
      now,
    );
    const photos = plan.photosByPatient.get('existing-1');
    expect(photos).toHaveLength(2);
    expect(photos?.every((photo) => photo.patientId === 'existing-1')).toBe(true);
  });

  it('別に追加(衝突あり)でも、新しいidで写真のpatientIdが付け替わる', () => {
    seq = 0;
    const existingPatient: Patient = { ...yamada(), id: 'existing-1' };
    const incoming: Patient = { ...yamada(), id: 'incoming-1' };
    const decoded = [decodedPhoto(incoming.id, 'photo-a')];
    const payload = makePayload([incoming], [backupPhoto(incoming.id, 'photo-a')]);
    const plan = planImport(
      payload,
      decoded,
      [existingPatient],
      new Set(),
      new Map([[incoming.id, 'addNew']]),
      newId,
      now,
    );
    const targetId = plan.put[0]!.id;
    expect(targetId).not.toBe('existing-1');
    const photos = plan.photosByPatient.get(targetId);
    expect(photos).toHaveLength(1);
    expect(photos?.[0]!.patientId).toBe(targetId);
  });

  it('上書きでも、送られてきた写真が3枚を超えれば先頭3枚だけ入る', () => {
    seq = 0;
    const existingPatient: Patient = { ...yamada(), id: 'existing-1' };
    const incoming: Patient = { ...yamada(), id: 'incoming-1' };
    const decoded = [
      decodedPhoto(incoming.id, 'p1'),
      decodedPhoto(incoming.id, 'p2'),
      decodedPhoto(incoming.id, 'p3'),
      decodedPhoto(incoming.id, 'p4'),
    ];
    const payload = makePayload(
      [incoming],
      decoded.map((p) => backupPhoto(incoming.id, p.id)),
    );
    const plan = planImport(
      payload,
      decoded,
      [existingPatient],
      new Set(),
      new Map([[incoming.id, 'overwrite']]),
      newId,
      now,
    );
    expect(plan.photosByPatient.get('existing-1')).toHaveLength(3);
  });

  it('同じ手元の人を2人分の送られてきた人で上書きしようとすると、2件目は別に追加になる', () => {
    seq = 0;
    const existingPatient: Patient = { ...yamada(), id: 'existing-1' };
    const incomingA: Patient = { ...yamada(), id: 'incoming-a' };
    const incomingB: Patient = { ...yamada(), id: 'incoming-b' };
    const payload = makePayload([incomingA, incomingB]);
    const choices: ReadonlyMap<string, ConflictChoice> = new Map([
      [incomingA.id, 'overwrite'],
      [incomingB.id, 'overwrite'],
    ]);
    const plan = planImport(payload, null, [existingPatient], new Set(), choices, newId, now);
    expect(plan.put).toHaveLength(2);
    const overwritten = plan.put.find((patient) => patient.id === 'existing-1');
    const addedAsNew = plan.put.find((patient) => patient.id !== 'existing-1');
    expect(overwritten).toBeDefined();
    expect(addedAsNew).toBeDefined();
    expect(addedAsNew?.createdAt).toBe(now.toISOString());
  });

  it('写真は最大3枚(送られた順)しか入らない', () => {
    seq = 0;
    const incoming: Patient = { ...yamada(), id: 'incoming-1' };
    const decoded = [
      decodedPhoto(incoming.id, 'p1'),
      decodedPhoto(incoming.id, 'p2'),
      decodedPhoto(incoming.id, 'p3'),
      decodedPhoto(incoming.id, 'p4'),
    ];
    const payload = makePayload(
      [incoming],
      decoded.map((p) => backupPhoto(incoming.id, p.id)),
    );
    const plan = planImport(payload, decoded, [], new Set(), new Map(), newId, now);
    expect(MAX_PHOTOS_PER_PATIENT).toBe(3);
    const targetId = plan.put[0]!.id;
    expect(plan.photosByPatient.get(targetId)).toHaveLength(3);
  });

  it('skipした人の写真は入らない', () => {
    seq = 0;
    const existingPatient: Patient = { ...yamada(), id: 'existing-1' };
    const incoming: Patient = { ...yamada(), id: 'incoming-1' };
    const decoded = [decodedPhoto(incoming.id, 'photo-a')];
    const payload = makePayload([incoming], [backupPhoto(incoming.id, 'photo-a')]);
    const plan = planImport(
      payload,
      decoded,
      [existingPatient],
      new Set(),
      new Map([[incoming.id, 'skip']]),
      newId,
      now,
    );
    expect(plan.photosByPatient.size).toBe(0);
  });

  it('地点は重複idを除く', () => {
    seq = 0;
    const spots = [sampleSpot('dup'), sampleSpot('fresh-spot')];
    const payload = makePayload([], null, spots);
    const plan = planImport(payload, null, [], new Set(['dup']), new Map(), newId, now);
    expect(plan.spots).toEqual([spots[1]!]);
  });
});
