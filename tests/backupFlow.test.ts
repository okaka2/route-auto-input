import 'fake-indexeddb/auto';
import { deleteDB } from 'idb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
});
