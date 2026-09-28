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
import type { AppState, Message } from '../src/types';

// 接続を閉じてから消す(db.test.ts と同じ理由: 開いたままだとdeleteDBがブロックされる)。
beforeEach(async () => {
  await closeDbForTest();
  await deleteDB('route-auto-input');
});

// vi.spyOn したものを毎回もとに戻す(このファイルはdbモジュールを何度もspyOnするため、
// 戻さないと後のテストに前のモック実装が漏れる)。
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** マイクロタスクの連なりが片付くまで待つ(saveExportは戻り値のPromiseを返さないため)。 */
async function flushAsync(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * 偽のAppContext。DBはmockせず本物(fake-indexeddb)を使う。setState/showMessage/setSettingsInfo
 * は実際に内部の状態を書き換える(handleExportが開いた小窓を、saveExportが同じctxから
 * 読めるようにするため)。第2引数(initialState)を渡せば、DBの中身とは別に画面のstateだけ
 * 古い/違う内容にすることもできる。
 */
function createFakeContext(
  overrides: Partial<AppContext> = {},
  initialState: AppState = createInitialState([]),
): AppContext {
  let state: AppState = initialState;
  let settingsInfo = {
    lastBackupAt: null as string | null,
    persisted: null,
    theme: 'auto' as const,
    office: null,
    photoBytes: 0,
    includePhotos: true,
    hasSharedSecret: false,
    sharedSecretShort: false,
    sharedSecretDraft: '',
    sharedSecretEditing: false,
  };
  const base: AppContext = {
    getState: vi.fn(() => state),
    setState: vi.fn((next: AppState) => {
      state = next;
    }),
    showMessage: vi.fn((message: Message) => {
      state = { ...state, message };
    }),
    getSpots: vi.fn(() => []),
    getRouteContext: vi.fn(() => ({ ends: DEFAULT_ROUTE_ENDS, office: null })),
    setRouteContext: vi.fn(),
    getSettingsInfo: vi.fn(() => settingsInfo),
    setSettingsInfo: vi.fn((next) => {
      settingsInfo = next;
    }),
    clearOpenedRoutes: vi.fn(),
    reloadPatients: vi.fn(async () => {}),
    loadSpots: vi.fn(async () => {}),
    loadPhotoCounts: vi.fn(async () => {}),
    loadPhotoBytes: vi.fn(async () => {}),
    confirm: vi.fn(() => true),
  };
  return { ...base, ...overrides };
}

describe('createBackupFlow: 書き出し(handleExport → 小窓 → saveExport)', () => {
  it('DBから読んだ内容でファイルを作り、小窓(ready)を開く。写真を含めなければphotosはnull', async () => {
    const db = await import('../src/db');
    const patient = createPatient('山田 太郎', '東京都千代田区1-1');
    await db.savePatient(patient);
    const downloadSpy = vi.spyOn(fileIo, 'downloadFile').mockImplementation(() => {});
    const ctx = createFakeContext();
    const flow = createBackupFlow(ctx);

    await flow.handleExport(false);

    const dialog = ctx.getState().dialog;
    expect(dialog?.kind).toBe('backupSave');
    expect(dialog?.kind === 'backupSave' && dialog.phase).toBe('ready');

    flow.saveExport();
    await flushAsync();

    expect(downloadSpy).toHaveBeenCalledTimes(1);
    const written = downloadSpy.mock.calls[0]![0] as File;
    const content = JSON.parse(await written.text());
    expect(content.photos).toBeNull();
    expect(content.patients).toHaveLength(1);
    expect(content.patients[0].id).toBe(patient.id);
  });

  it('画面の state に訪問先がいても DB が0件なら「書き出す訪問先がありません。」で、小窓は開かない', async () => {
    const stalePatient = createPatient('画面にだけいる人', '東京都千代田区1-1');
    const ctx = createFakeContext({}, createInitialState([stalePatient]));
    const flow = createBackupFlow(ctx);

    await flow.handleExport();

    expect(ctx.showMessage).toHaveBeenCalledWith({ kind: 'error', text: '書き出す訪問先がありません。' });
    expect(ctx.getState().dialog).toBeNull();
  });

  it('listPatientsが失敗すると「データを読めなかったので書き出しませんでした。」で、lastBackupAtは変わらない', async () => {
    const db = await import('../src/db');
    vi.spyOn(db, 'listPatients').mockRejectedValue(new Error('boom'));
    const ctx = createFakeContext();
    const flow = createBackupFlow(ctx);

    await flow.handleExport();

    expect(ctx.showMessage).toHaveBeenCalledWith({
      kind: 'error',
      text: 'データを読めなかったので書き出しませんでした。',
    });
    expect(ctx.getState().dialog).toBeNull();
    expect(ctx.setSettingsInfo).not.toHaveBeenCalled();
    expect(await db.getMeta('lastBackupAt')).toBeUndefined();
  });

  it('共有を取り消すと、小窓はreadyのまま・記録しない', async () => {
    const db = await import('../src/db');
    const patient = createPatient('山田 太郎', '東京都千代田区1-1');
    await db.savePatient(patient);
    const share = vi.fn().mockRejectedValue(new DOMException('キャンセル', 'AbortError'));
    vi.stubGlobal('navigator', { ...window.navigator, share, canShare: () => true });
    const ctx = createFakeContext();
    const flow = createBackupFlow(ctx);

    await flow.handleExport();
    flow.saveExport();
    await flushAsync();

    expect(share).toHaveBeenCalledTimes(1);
    const dialog = ctx.getState().dialog;
    expect(dialog?.kind === 'backupSave' && dialog.phase).toBe('ready');
    expect(ctx.setSettingsInfo).not.toHaveBeenCalled();
    expect(await db.getMeta('lastBackupAt')).toBeUndefined();
  });

  it('共有できれば記録する(lastBackupAtが変わり、小窓はdone・shared)', async () => {
    const db = await import('../src/db');
    const patient = createPatient('山田 太郎', '東京都千代田区1-1');
    await db.savePatient(patient);
    const share = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...window.navigator, share, canShare: () => true });
    const ctx = createFakeContext();
    const flow = createBackupFlow(ctx);

    await flow.handleExport();
    flow.saveExport();
    await vi.waitFor(() => {
      const dialog = ctx.getState().dialog;
      expect(dialog?.kind === 'backupSave' && dialog.phase).toBe('done');
    });

    const dialog = ctx.getState().dialog;
    expect(dialog?.kind === 'backupSave' && dialog.result).toBe('shared');
    expect(ctx.getSettingsInfo().lastBackupAt).not.toBeNull();
    expect(await db.getMeta('lastBackupAt')).toBe(ctx.getSettingsInfo().lastBackupAt);
  });

  it('共有シートが開いている間に連打しても、navigator.shareは1回だけ・ダウンロードはしない(段階5レビュー: 2回目がInvalidStateErrorになりダウンロード+記録してしまっていた)', async () => {
    const db = await import('../src/db');
    const patient = createPatient('山田 太郎', '東京都千代田区1-1');
    await db.savePatient(patient);
    const share = vi.fn(() => new Promise<void>(() => {})); // 1回目の共有をぶら下げたままにする
    vi.stubGlobal('navigator', { ...window.navigator, share, canShare: () => true });
    const downloadSpy = vi.spyOn(fileIo, 'downloadFile').mockImplementation(() => {});
    const ctx = createFakeContext();
    const flow = createBackupFlow(ctx);

    await flow.handleExport();
    flow.saveExport();
    flow.saveExport();

    expect(share).toHaveBeenCalledTimes(1);
    expect(downloadSpy).not.toHaveBeenCalled();
  });

  it('共有できない端末ではダウンロードして記録する(小窓はdone・downloaded)', async () => {
    const db = await import('../src/db');
    const patient = createPatient('山田 太郎', '東京都千代田区1-1');
    await db.savePatient(patient);
    const downloadSpy = vi.spyOn(fileIo, 'downloadFile').mockImplementation(() => {});
    const ctx = createFakeContext();
    const flow = createBackupFlow(ctx);

    await flow.handleExport();
    flow.saveExport();
    await vi.waitFor(() => {
      const dialog = ctx.getState().dialog;
      expect(dialog?.kind === 'backupSave' && dialog.phase).toBe('done');
    });

    expect(downloadSpy).toHaveBeenCalledTimes(1);
    const dialog = ctx.getState().dialog;
    expect(dialog?.kind === 'backupSave' && dialog.result).toBe('downloaded');
    expect(ctx.getSettingsInfo().lastBackupAt).not.toBeNull();
    expect(await db.getMeta('lastBackupAt')).toBe(ctx.getSettingsInfo().lastBackupAt);
  });
});

describe('createBackupFlow: 読み込み', () => {
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

describe('createBackupFlow: isWorking', () => {
  it('取り込み(replace)の書き込み中はtrue、終われば戻る', async () => {
    const db = await import('../src/db');
    const fromFile = createPatient('鈴木 花子', '大阪市北区2-2');
    const text = serializeBackup({ patients: [fromFile], photos: null, spots: [], meta: {} });
    const file = new File([text], 'backup.json', { type: 'application/json' });

    const ctx = createFakeContext();
    const flow = createBackupFlow(ctx);
    expect(flow.isWorking()).toBe(false);

    const original = db.applyImport;
    let duringWrite: boolean | null = null;
    vi.spyOn(db, 'applyImport').mockImplementation(async (plan) => {
      duringWrite = flow.isWorking();
      return original(plan);
    });

    await flow.handleImport(file, 'replace');

    expect(duringWrite).toBe(true);
    expect(flow.isWorking()).toBe(false);
  });
});
