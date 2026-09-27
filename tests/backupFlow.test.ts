import 'fake-indexeddb/auto';
import { deleteDB } from 'idb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppContext } from '../src/appContext';
import { createBackupFlow } from '../src/backupFlow';
import { closeDbForTest } from '../src/db';
import * as fileIo from '../src/fileIo';
import { createPatient } from '../src/patient';
import { serializeBackup } from '../src/backup';
import { DEFAULT_ROUTE_ENDS } from '../src/routePlan';
import { createInitialState } from '../src/state';
import type { AppState } from '../src/types';

// 接続を閉じてから消す(db.test.ts と同じ理由: 開いたままだとdeleteDBがブロックされる)。
beforeEach(async () => {
  await closeDbForTest();
  await deleteDB('route-auto-input');
});

// vi.spyOn したものを毎回もとに戻す(このファイルはdbモジュールを何度もspyOnするため、
// 戻さないと後のテストに前のモック実装が漏れる)。
afterEach(() => {
  vi.restoreAllMocks();
});

/** 偽のAppContext。各メソッドはvi.fn()で、DBはmockせず本物(fake-indexeddb)を使う。 */
function createFakeContext(overrides: Partial<AppContext> = {}): AppContext {
  const state: AppState = createInitialState([]);
  return {
    getState: vi.fn(() => state),
    setState: vi.fn(),
    showMessage: vi.fn(),
    getSpots: vi.fn(() => []),
    getRouteContext: vi.fn(() => ({ ends: DEFAULT_ROUTE_ENDS, office: null })),
    setRouteContext: vi.fn(),
    getSettingsInfo: vi.fn(() => ({
      lastBackupAt: null,
      persisted: null,
      theme: 'auto' as const,
      office: null,
      photoBytes: 0,
      includePhotos: true,
      hasSharedSecret: false,
      sharedSecretDraft: '',
      sharedSecretEditing: false,
    })),
    setSettingsInfo: vi.fn(),
    clearOpenedRoutes: vi.fn(),
    reloadPatients: vi.fn(async () => {}),
    loadSpots: vi.fn(async () => {}),
    loadPhotoCounts: vi.fn(async () => {}),
    loadPhotoBytes: vi.fn(async () => {}),
    confirm: vi.fn(() => true),
    ...overrides,
  };
}

describe('createBackupFlow', () => {
  it('handleExport(false) は写真を含めず、downloadTextFileにphotos:nullのJSONを渡す', async () => {
    const downloadSpy = vi.spyOn(fileIo, 'downloadTextFile').mockImplementation(() => {});
    const ctx = createFakeContext();
    const flow = createBackupFlow(ctx);

    await flow.handleExport(false);

    expect(downloadSpy).toHaveBeenCalledTimes(1);
    const written = JSON.parse(downloadSpy.mock.calls[0]![1] as string);
    expect(written.photos).toBeNull();
  });

  it('写真が壊れたv2ファイルの読み込みでは、確認を挟まずctx.showMessageで壊れている旨を伝える', async () => {
    const fromFile = createPatient('鈴木 花子', '大阪市北区2-2');
    const text = serializeBackup({
      patients: [fromFile],
      // dataUrlの形自体は正しいが、base64の中身(@@@)が壊れている。
      photos: [{ id: 'p1', patientId: fromFile.id, dataUrl: 'data:image/jpeg;base64,@@@', createdAt: 't1' }],
      spots: [],
      meta: {},
    });
    const file = new File([text], 'backup.json', { type: 'application/json' });

    const ctx = createFakeContext();
    const flow = createBackupFlow(ctx);

    await flow.handleImport(file, 'replace');

    expect(ctx.confirm).not.toHaveBeenCalled();
    expect(ctx.showMessage).toHaveBeenCalledWith({
      kind: 'error',
      text: 'バックアップのファイルの写真が壊れています。',
    });
  });

  it('入れ替え(replace)は、applyImportが1回だけ呼ばれ、ファイルの内容がそのまま渡る', async () => {
    const db = await import('../src/db');
    const applyImportSpy = vi.spyOn(db, 'applyImport');
    const fromFile = createPatient('鈴木 花子', '大阪市北区2-2');
    const text = serializeBackup({ patients: [fromFile], photos: null, spots: [], meta: {} });
    const file = new File([text], 'backup.json', { type: 'application/json' });

    const ctx = createFakeContext();
    const flow = createBackupFlow(ctx);

    await flow.handleImport(file, 'replace');

    expect(applyImportSpy).toHaveBeenCalledTimes(1);
    expect(applyImportSpy).toHaveBeenCalledWith({
      replaceAll: true,
      patients: [fromFile],
      replacePhotosOf: [],
      photos: [],
      spots: [],
      meta: {},
    });
    expect(await db.listPatients()).toEqual([fromFile]);
  });
});

describe('createBackupFlow: 追加(merge)はいない人だけ足す', () => {
  it('applyImportが1回だけ呼ばれ、手元にいる人を除いた新しい人だけが渡る', async () => {
    const db = await import('../src/db');
    const existing = createPatient('既存', '東京都千代田区1-1');
    await db.savePatient(existing);
    const applyImportSpy = vi.spyOn(db, 'applyImport');
    const fresh = createPatient('新規', '大阪市北区2-2');
    const text = serializeBackup({ patients: [existing, fresh], photos: null, spots: [], meta: {} });
    const file = new File([text], 'backup.json', { type: 'application/json' });

    const ctx = createFakeContext();
    const flow = createBackupFlow(ctx);

    await flow.handleImport(file, 'merge');

    expect(applyImportSpy).toHaveBeenCalledTimes(1);
    expect(applyImportSpy).toHaveBeenCalledWith({
      replaceAll: false,
      patients: [fresh],
      replacePhotosOf: [],
      photos: [],
      spots: [],
      meta: {},
    });
    expect((await db.listPatients()).map((p) => p.id).sort()).toEqual([existing.id, fresh.id].sort());
  });

  it('足す人が1人もいなければ、applyImportを呼ばず確認も出さない(知らせだけ)', async () => {
    const db = await import('../src/db');
    const existing = createPatient('既存', '東京都千代田区1-1');
    await db.savePatient(existing);
    const applyImportSpy = vi.spyOn(db, 'applyImport');
    const text = serializeBackup({ patients: [existing], photos: null, spots: [], meta: {} });
    const file = new File([text], 'backup.json', { type: 'application/json' });

    const ctx = createFakeContext();
    const flow = createBackupFlow(ctx);

    await flow.handleImport(file, 'merge');

    expect(applyImportSpy).not.toHaveBeenCalled();
    expect(ctx.confirm).not.toHaveBeenCalled();
    expect(ctx.showMessage).toHaveBeenCalledWith({
      kind: 'info',
      text: '追加する訪問先はありませんでした(手元にいる1人はそのまま)。',
    });
  });
});

describe('createBackupFlow: 引き継ぎのファイルの見分け', () => {
  it('引き継ぎのファイルなら、確認も書き込みもせずに hooks.onTransferFile へ渡す(入れ替えを選んでいても)', async () => {
    const db = await import('../src/db');
    const existing = createPatient('山田 太郎', '東京都千代田区1-1');
    await db.savePatient(existing);
    const text = JSON.stringify({ format: 'houmon-transfer', v: 1, iter: 1000, salt: 'AA==', iv: 'AA==', data: 'AA==' });
    const onTransferFile = vi.fn();
    const ctx = createFakeContext();
    const flow = createBackupFlow(ctx, { onTransferFile });

    await flow.handleImport(new File([text], 'transfer.txt', { type: 'text/plain' }), 'replace');

    expect(onTransferFile).toHaveBeenCalledWith(text);
    expect(ctx.confirm).not.toHaveBeenCalled();
    expect(ctx.showMessage).not.toHaveBeenCalled();
    expect(await db.listPatients()).toHaveLength(1);
  });

  it('普通のバックアップは hooks.onTransferFile へ渡さず、今までどおり確認する', async () => {
    // 追加(merge)は足す人が1人もいなければ確認を出さない(N=0の別の仕様)ため、
    // ここでは確認が出ることを確かめるために新しい人を1人含める。
    const patient = createPatient('山田 太郎', '東京都千代田区1-1');
    const text = serializeBackup({ patients: [patient], photos: null, spots: [], meta: {} });
    const onTransferFile = vi.fn();
    const ctx = createFakeContext();
    const flow = createBackupFlow(ctx, { onTransferFile });

    await flow.handleImport(new File([text], 'backup.json', { type: 'application/json' }), 'merge');

    expect(onTransferFile).not.toHaveBeenCalled();
    expect(ctx.confirm).toHaveBeenCalledTimes(1);
  });
});
