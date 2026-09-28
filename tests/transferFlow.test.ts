import 'fake-indexeddb/auto';
import { deleteDB } from 'idb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppContext } from '../src/appContext';
import { MIN_PASSWORD_LENGTH } from '../src/config';
import { decryptText, encryptText } from '../src/crypto';
import * as db from '../src/db';
import { closeDbForTest, getMeta, setMeta } from '../src/db';
import * as fileIo from '../src/fileIo';
import { createPatient } from '../src/patient';
import * as photoCodec from '../src/photoCodec';
import { DEFAULT_ROUTE_ENDS } from '../src/routePlan';
import { createInitialState } from '../src/state';
import { createTransferFlow } from '../src/transferFlow';
import { parsePayload, serializePayload } from '../src/transfer';
import type { AppState, Patient, Spot, TransferReceiveDialog, TransferSendDialog } from '../src/types';

beforeEach(async () => {
  await closeDbForTest();
  await deleteDB('route-auto-input');
});

afterEach(() => {
  // vi.spyOn(fileIo, 'shareFile') 等をテストごとに積み重ねない。積み重なると、
  // 次のテストの shareSpy.mock.calls[0] が前のテストの呼び出しを指してしまう。
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** マイクロタスクの連なりが片付くまで待つ(shareSendFile/saveSendFileは戻り値のPromiseを返さないため)。 */
async function flushAsync(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

type SettingsInfoLike = ReturnType<AppContext['getSettingsInfo']>;

/** 偽のAppContext。backupFlow.test.tsと同じやり方だが、dialog/settingsInfo/spotsを実際に保持し、
 * ダイアログを開く→入力する→送る、という一連の呼び出しをまたいで状態が保たれるようにする。 */
function createFakeContext(
  options: { patients?: Patient[]; spots?: Spot[]; hasSharedSecret?: boolean; sharedSecretShort?: boolean } = {},
) {
  let state: AppState = createInitialState(options.patients ?? []);
  let spots: Spot[] = options.spots ?? [];
  let settingsInfo: SettingsInfoLike = {
    lastBackupAt: null,
    persisted: null,
    theme: 'auto',
    office: null,
    photoBytes: 0,
    includePhotos: true,
    hasSharedSecret: options.hasSharedSecret ?? false,
    sharedSecretShort: options.sharedSecretShort ?? false,
    sharedSecretDraft: '',
    sharedSecretEditing: false,
  };
  const ctx: AppContext = {
    getState: vi.fn(() => state),
    setState: vi.fn((next) => {
      state = next;
    }),
    showMessage: vi.fn((message) => {
      state = { ...state, message };
    }),
    getSpots: vi.fn(() => spots),
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
  return { ctx, getState: () => state, getDialog: () => state.dialog as TransferSendDialog | null };
}

describe('createTransferFlow: openSend', () => {
  it('1人の訪問先を送るとき、既定値のダイアログを開く', async () => {
    const patient = createPatient('山田 太郎', '東京都千代田区1-1');
    const { ctx, getDialog } = createFakeContext({ patients: [patient] });
    const flow = createTransferFlow(ctx);

    await flow.openSend([patient.id]);

    expect(getDialog()).toEqual({
      kind: 'transferSend',
      patientIds: [patient.id],
      includePhotos: true,
      includeSpots: false,
      useSharedSecret: false,
      password: '',
      passwordConfirm: '',
      saveAsShared: false,
      phase: 'form',
      error: null,
      canShare: false,
      shared: false,
    });
  });

  it('patientIdsが空なら、お役立ち地点だけを送る扱い(includeSpots既定true)になる', async () => {
    const { ctx, getDialog } = createFakeContext();
    const flow = createTransferFlow(ctx);

    await flow.openSend([]);

    expect(getDialog()?.patientIds).toEqual([]);
    expect(getDialog()?.includeSpots).toBe(true);
  });

  it('spotsOnly指定でも、patientIdsは空にする', async () => {
    const patient = createPatient('山田 太郎', '東京都千代田区1-1');
    const { ctx, getDialog } = createFakeContext({ patients: [patient] });
    const flow = createTransferFlow(ctx);

    await flow.openSend([patient.id], { spotsOnly: true });

    expect(getDialog()?.patientIds).toEqual([]);
    expect(getDialog()?.includeSpots).toBe(true);
  });

  it('事業所の合言葉が保存されていれば、useSharedSecretを既定オンにする', async () => {
    const patient = createPatient('山田 太郎', '東京都千代田区1-1');
    const { ctx, getDialog } = createFakeContext({ patients: [patient], hasSharedSecret: true });
    const flow = createTransferFlow(ctx);

    await flow.openSend([patient.id]);

    expect(getDialog()?.useSharedSecret).toBe(true);
  });

  it('保存済みの合言葉が短ければ、useSharedSecretをオフにして短い旨のエラーで開く', async () => {
    const patient = createPatient('山田 太郎', '東京都千代田区1-1');
    const { ctx, getDialog } = createFakeContext({
      patients: [patient],
      hasSharedSecret: true,
      sharedSecretShort: true,
    });
    const flow = createTransferFlow(ctx);

    await flow.openSend([patient.id]);

    expect(getDialog()?.useSharedSecret).toBe(false);
    expect(getDialog()?.error).toBe('事業所の合言葉が短いので、10文字以上に変えてください。');
  });
});

describe('createTransferFlow: updateSendDraft', () => {
  it('draftの変更は再描画しない({ render: false }付きでsetStateする)', async () => {
    const patient = createPatient('山田 太郎', '東京都千代田区1-1');
    const { ctx, getDialog } = createFakeContext({ patients: [patient] });
    const flow = createTransferFlow(ctx);
    await flow.openSend([patient.id]);
    vi.mocked(ctx.setState).mockClear();

    flow.updateSendDraft({ password: 'abcdef' });

    expect(getDialog()?.password).toBe('abcdef');
    expect(ctx.setState).toHaveBeenCalledTimes(1);
    expect(ctx.setState).toHaveBeenCalledWith(expect.anything(), { render: false });
  });

  it('useSharedSecretの変更は、パスワード欄の出し引っ込めが変わるので普通に再描画する', async () => {
    const patient = createPatient('山田 太郎', '東京都千代田区1-1');
    const { ctx, getDialog } = createFakeContext({ patients: [patient], hasSharedSecret: true });
    const flow = createTransferFlow(ctx);
    await flow.openSend([patient.id]);
    vi.mocked(ctx.setState).mockClear();

    flow.updateSendDraft({ useSharedSecret: false });

    expect(getDialog()?.useSharedSecret).toBe(false);
    expect(ctx.setState).toHaveBeenCalledTimes(1);
    expect(ctx.setState).toHaveBeenCalledWith(expect.anything(), undefined);
  });

  it('入力のたび、前のエラー表示は消す', async () => {
    const patient = createPatient('山田 太郎', '東京都千代田区1-1');
    const { ctx, getDialog } = createFakeContext({ patients: [patient] });
    const flow = createTransferFlow(ctx);
    await flow.openSend([patient.id]);
    ctx.setState({ ...ctx.getState(), dialog: { ...getDialog()!, error: 'なにかのエラー' } });

    flow.updateSendDraft({ password: 'x' });

    expect(getDialog()?.error).toBeNull();
  });

  it('ダイアログが送るダイアログでなければ、何もしない', () => {
    const { ctx } = createFakeContext();
    const flow = createTransferFlow(ctx);
    vi.mocked(ctx.setState).mockClear();

    flow.updateSendDraft({ password: 'x' });

    expect(ctx.setState).not.toHaveBeenCalled();
  });
});

describe('createTransferFlow: submitSend(ファイルを作る。readyまで進む。window.confirmは挟まない)', () => {
  it('送るものがない(訪問先なし・地点も含めない)ときはエラーにする', async () => {
    const { ctx, getDialog } = createFakeContext();
    const flow = createTransferFlow(ctx);
    await flow.openSend([]);
    flow.updateSendDraft({ includeSpots: false });

    await flow.submitSend();

    expect(getDialog()?.error).toBe('送るものがありません。');
    expect(getDialog()?.phase).toBe('form');
  });

  it('パスワードが10文字未満ならエラー', async () => {
    const patient = createPatient('山田 太郎', '東京都千代田区1-1');
    const { ctx, getDialog } = createFakeContext({ patients: [patient] });
    const flow = createTransferFlow(ctx);
    await flow.openSend([patient.id]);
    flow.updateSendDraft({ password: 'abc', passwordConfirm: 'abc' });

    await flow.submitSend();

    expect(getDialog()?.error).toBe(`パスワードは${MIN_PASSWORD_LENGTH}文字以上にしてください。`);
    expect(getDialog()?.phase).toBe('form');
  });

  it('長さの数え方は設定の合言葉と同じ(前後の空白も数える): 9文字はエラー、空白で始まる10文字は通る(readyまで進む)', async () => {
    const patient = createPatient('山田 太郎', '東京都千代田区1-1');
    const { ctx, getDialog } = createFakeContext({ patients: [patient] });
    const flow = createTransferFlow(ctx);
    await flow.openSend([patient.id]);

    flow.updateSendDraft({ password: 'abcdefghi', passwordConfirm: 'abcdefghi' });
    await flow.submitSend();
    expect(getDialog()?.error).toBe(`パスワードは${MIN_PASSWORD_LENGTH}文字以上にしてください。`);
    expect(getDialog()?.phase).toBe('form');

    flow.updateSendDraft({ password: ' abcdefghi', passwordConfirm: ' abcdefghi' });
    await flow.submitSend();
    expect(getDialog()?.error).toBeNull();
    // 長さの確認を通り、readyまで進んだ。
    expect(getDialog()?.phase).toBe('ready');
  }, 10_000);

  it('確認用パスワードが一致しなければエラー', async () => {
    const patient = createPatient('山田 太郎', '東京都千代田区1-1');
    const { ctx, getDialog } = createFakeContext({ patients: [patient] });
    const flow = createTransferFlow(ctx);
    await flow.openSend([patient.id]);
    flow.updateSendDraft({ password: 'abcdefghij', passwordConfirm: 'abcdefghik' });

    await flow.submitSend();

    expect(getDialog()?.error).toBe('確認のパスワードが一致しません。');
    expect(getDialog()?.phase).toBe('form');
  });

  it('合言葉を使う設定だが、まだ保存されていなければ、チェックを外してエラーにする', async () => {
    const patient = createPatient('山田 太郎', '東京都千代田区1-1');
    const { ctx, getDialog } = createFakeContext({ patients: [patient], hasSharedSecret: false });
    const flow = createTransferFlow(ctx);
    await flow.openSend([patient.id]);
    flow.updateSendDraft({ useSharedSecret: true });

    await flow.submitSend();

    expect(getDialog()?.error).toBe('事業所の合言葉が見つかりません。パスワードを入力してください。');
    expect(getDialog()?.useSharedSecret).toBe(false);
    expect(ctx.setSettingsInfo).toHaveBeenCalledWith(expect.objectContaining({ hasSharedSecret: false }));
  });

  it('合言葉を使う設定で開いた後、保存済みの合言葉が短いものに変わっていれば、チェックを外してエラーにする', async () => {
    await setMeta('sharedSecret', 'jimusho-no-aikotoba');
    const patient = createPatient('山田 太郎', '東京都千代田区1-1');
    const { ctx, getDialog } = createFakeContext({ patients: [patient], hasSharedSecret: true });
    const flow = createTransferFlow(ctx);
    await flow.openSend([patient.id]);
    expect(getDialog()?.useSharedSecret).toBe(true);
    // 開いた後に(他の端末/タブで)短い合言葉に変わった場合。
    await setMeta('sharedSecret', 'short-123');

    await flow.submitSend();

    expect(getDialog()?.error).toBe('事業所の合言葉が短いので、10文字以上に変えてください。');
    expect(getDialog()?.useSharedSecret).toBe(false);
    expect(ctx.setSettingsInfo).toHaveBeenCalledWith(expect.objectContaining({ sharedSecretShort: true }));
  });

  it('ctx.confirmは呼ばない(readyになるまで、共有できて送り終わるまで、一度も挟まない)', async () => {
    const patient = createPatient('山田 太郎', '東京都千代田区1-1');
    const { ctx, getDialog } = createFakeContext({ patients: [patient] });
    vi.spyOn(fileIo, 'canShareFile').mockReturnValue(true);
    vi.spyOn(fileIo, 'shareFile').mockResolvedValue('shared');
    const flow = createTransferFlow(ctx);
    await flow.openSend([patient.id]);
    flow.updateSendDraft({ password: 'abcdefghij', passwordConfirm: 'abcdefghij' });

    await flow.submitSend();
    expect(getDialog()?.phase).toBe('ready');
    flow.shareSendFile();
    await flushAsync();

    expect(getDialog()?.phase).toBe('done');
    expect(ctx.confirm).not.toHaveBeenCalled();
  }, 10_000);

  it('成功(共有できた)なら、暗号化したFileをreadyで持ち、canShareFile(file)でcanShareを決める', async () => {
    const patient = { ...createPatient('山田 太郎', '東京都千代田区1-1'), note: '駐車場は裏手' };
    const { ctx, getDialog } = createFakeContext({ patients: [patient] });
    vi.spyOn(fileIo, 'canShareFile').mockReturnValue(true);
    const flow = createTransferFlow(ctx);
    await flow.openSend([patient.id]);
    flow.updateSendDraft({ password: 'abcdefghij', passwordConfirm: 'abcdefghij' });

    await flow.submitSend();

    expect(getDialog()?.phase).toBe('ready');
    expect(getDialog()?.canShare).toBe(true);
    expect(getDialog()?.error).toBeNull();
  }, 10_000);

  it('共有できない端末では、readyのcanShareがfalseになる', async () => {
    const patient = createPatient('山田 太郎', '東京都千代田区1-1');
    const { ctx, getDialog } = createFakeContext({ patients: [patient] });
    vi.spyOn(fileIo, 'canShareFile').mockReturnValue(false);
    const flow = createTransferFlow(ctx);
    await flow.openSend([patient.id]);
    flow.updateSendDraft({ password: 'abcdefghij', passwordConfirm: 'abcdefghij' });

    await flow.submitSend();

    expect(getDialog()?.phase).toBe('ready');
    expect(getDialog()?.canShare).toBe(false);
  }, 10_000);

  it('写真のBlobをdata URLに変換できなければ、汎用のエラー文を出し、readyにならない', async () => {
    const patient = createPatient('山田 太郎', '東京都千代田区1-1');
    vi.spyOn(db, 'listPhotos').mockResolvedValue([
      { id: 'photo-1', patientId: patient.id, blob: new Blob(['x'], { type: 'image/jpeg' }), createdAt: 't1' },
    ]);
    vi.spyOn(photoCodec, 'blobToDataUrl').mockRejectedValue(new Error('写真を読み込めませんでした。'));
    const { ctx, getDialog } = createFakeContext({ patients: [patient] });
    const flow = createTransferFlow(ctx);
    await flow.openSend([patient.id]);
    flow.updateSendDraft({ password: 'abcdefghij', passwordConfirm: 'abcdefghij' });

    await flow.submitSend();

    expect(getDialog()?.phase).toBe('form');
    expect(getDialog()?.error).toBe('送るファイルを作れませんでした。');
  }, 10_000);

  it('ファイルを作る途中で失敗したら、汎用のエラー文を出し、formへ戻す', async () => {
    const patient = createPatient('山田 太郎', '東京都千代田区1-1');
    const { ctx, getDialog } = createFakeContext({ patients: [patient] });
    const flow = createTransferFlow(ctx);
    await flow.openSend([patient.id]);
    flow.updateSendDraft({ password: 'abcdefghij', passwordConfirm: 'abcdefghij' });

    vi.doMock('../src/crypto', () => {
      throw new Error('読み込みに失敗(通信が切れたなど)');
    });
    try {
      await flow.submitSend();
    } finally {
      vi.doUnmock('../src/crypto');
    }

    expect(getDialog()?.phase).toBe('form');
    expect(getDialog()?.error).toBe('送るファイルを作れませんでした。');
  }, 10_000);

  it('連打しても、二重にファイルを作らない', async () => {
    const patient = createPatient('山田 太郎', '東京都千代田区1-1');
    const { ctx, getDialog } = createFakeContext({ patients: [patient] });
    const canShareSpy = vi.spyOn(fileIo, 'canShareFile').mockReturnValue(true);
    const flow = createTransferFlow(ctx);
    await flow.openSend([patient.id]);
    flow.updateSendDraft({ password: 'abcdefghij', passwordConfirm: 'abcdefghij' });

    await Promise.all([flow.submitSend(), flow.submitSend()]);

    // canShareFile(file)は、ファイルができてreadyにするたびに1回だけ呼ぶ。
    expect(canShareSpy).toHaveBeenCalledTimes(1);
    expect(getDialog()?.phase).toBe('ready');
  }, 10_000);
});

describe('createTransferFlow: readyの中身(暗号化されたFile)', () => {
  /** readyまで進めたうえで、共有(shareFile)に渡ったFileを返す。 */
  async function buildReadyFile(
    flow: ReturnType<typeof createTransferFlow>,
    patientIds: string[],
    password = 'abcdefghij',
  ): Promise<File> {
    flow.updateSendDraft({ password, passwordConfirm: password });
    await flow.submitSend();
    const shareSpy = vi.spyOn(fileIo, 'shareFile').mockResolvedValue('shared');
    flow.shareSendFile();
    await flushAsync();
    return shareSpy.mock.calls[0]![0];
  }

  it('成功(共有できた)なら、暗号化したFileを渡し、doneにする(パスワードは画面に残さない)', async () => {
    const patient = { ...createPatient('山田 太郎', '東京都千代田区1-1'), note: '駐車場は裏手' };
    const { ctx, getDialog } = createFakeContext({ patients: [patient] });
    const flow = createTransferFlow(ctx);
    await flow.openSend([patient.id]);

    const file = await buildReadyFile(flow, [patient.id]);

    expect(getDialog()?.phase).toBe('done');
    expect(getDialog()?.shared).toBe(true);
    expect(getDialog()?.password).toBe('');
    expect(getDialog()?.passwordConfirm).toBe('');
    expect(file.name).toMatch(/^訪問先の引き継ぎ_\d{4}-\d{2}-\d{2}\.txt$/);
    expect(file.type).toBe('text/plain');
    const decrypted = await decryptText(await file.text(), 'abcdefghij');
    const payload = parsePayload(decrypted);
    expect(payload.patients).toHaveLength(1);
    expect(payload.patients[0]!.name).toBe('山田 太郎');
    expect(payload.patients[0]!.note).toBe('駐車場は裏手');
  }, 10_000);

  it('合言葉を使うときは、保存済みの合言葉で暗号化する(入力欄のpasswordは使わない)', async () => {
    await setMeta('sharedSecret', 'jimusho-no-aikotoba');
    const patient = createPatient('山田 太郎', '東京都千代田区1-1');
    const { ctx, getDialog } = createFakeContext({ patients: [patient], hasSharedSecret: true });
    const flow = createTransferFlow(ctx);
    await flow.openSend([patient.id]);
    expect(getDialog()?.useSharedSecret).toBe(true);

    await flow.submitSend();
    const shareSpy = vi.spyOn(fileIo, 'shareFile').mockResolvedValue('shared');
    flow.shareSendFile();
    await flushAsync();

    const file = shareSpy.mock.calls[0]![0];
    await expect(decryptText(await file.text(), 'jimusho-no-aikotoba')).resolves.toEqual(expect.any(String));
  }, 10_000);

  it('写真も含めるときは、対象の写真をdataUrlにして含める', async () => {
    const patient = createPatient('山田 太郎', '東京都千代田区1-1');
    // fake-indexeddb はBlobをstructuredCloneすると中身が失われることがあるため、
    // 本物のBlobを持つ写真をlistPhotosの戻りとして直接与える(backupFlow.test.tsと同じやり方)。
    vi.spyOn(db, 'listPhotos').mockResolvedValue([
      { id: 'photo-1', patientId: patient.id, blob: new Blob(['x'], { type: 'image/jpeg' }), createdAt: 't1' },
    ]);
    const { ctx, getDialog } = createFakeContext({ patients: [patient] });
    const flow = createTransferFlow(ctx);
    await flow.openSend([patient.id]);
    expect(getDialog()?.includePhotos).toBe(true);

    const file = await buildReadyFile(flow, [patient.id]);

    const payload = parsePayload(await decryptText(await file.text(), 'abcdefghij'));
    expect(payload.photos).toHaveLength(1);
    expect(payload.photos![0]!.patientId).toBe(patient.id);
  }, 10_000);

  it('2人のうち1人だけ送るときは、送る相手の写真だけを含める(相手ではない人の写真は問い合わせもしない)', async () => {
    const sent = createPatient('山田 太郎', '東京都千代田区1-1');
    const other = createPatient('鈴木 花子', '東京都千代田区2-2');
    const listPhotosSpy = vi.spyOn(db, 'listPhotos').mockImplementation(async (patientId: string) => {
      if (patientId === sent.id) {
        return [{ id: 'photo-1', patientId: sent.id, blob: new Blob(['x'], { type: 'image/jpeg' }), createdAt: 't1' }];
      }
      if (patientId === other.id) {
        return [{ id: 'photo-2', patientId: other.id, blob: new Blob(['y'], { type: 'image/jpeg' }), createdAt: 't2' }];
      }
      return [];
    });
    const { ctx } = createFakeContext({ patients: [sent, other] });
    const flow = createTransferFlow(ctx);
    await flow.openSend([sent.id]);

    const file = await buildReadyFile(flow, [sent.id]);

    expect(listPhotosSpy).toHaveBeenCalledTimes(1);
    expect(listPhotosSpy).toHaveBeenCalledWith(sent.id);
    const payload = parsePayload(await decryptText(await file.text(), 'abcdefghij'));
    expect(payload.patients).toHaveLength(1);
    expect(payload.photos).toHaveLength(1);
    expect(payload.photos![0]!.patientId).toBe(sent.id);
  }, 10_000);

  it('「写真も含める」を外すと、写真は問い合わせず、payloadのphotosはnullになる', async () => {
    const patient = createPatient('山田 太郎', '東京都千代田区1-1');
    const listPhotosSpy = vi.spyOn(db, 'listPhotos');
    const { ctx } = createFakeContext({ patients: [patient] });
    const flow = createTransferFlow(ctx);
    await flow.openSend([patient.id]);
    flow.updateSendDraft({ includePhotos: false });

    const file = await buildReadyFile(flow, [patient.id]);

    expect(listPhotosSpy).not.toHaveBeenCalled();
    const payload = parsePayload(await decryptText(await file.text(), 'abcdefghij'));
    expect(payload.photos).toBeNull();
  }, 10_000);

  it('地点だけを送るときは、patients は空でspotsが入る', async () => {
    const spot: Spot = {
      id: 'spot-1',
      kind: 'toilet',
      note: 'きれいなトイレ',
      location: { lat: 35, lng: 139, accuracy: 10, recordedAt: '2026-09-22T00:00:00.000Z', source: 'gps' },
      createdAt: '2026-09-22T00:00:00.000Z',
    };
    const { ctx, getDialog } = createFakeContext({ spots: [spot] });
    const flow = createTransferFlow(ctx);
    await flow.openSend([]);
    expect(getDialog()?.includeSpots).toBe(true);

    const file = await buildReadyFile(flow, []);

    const payload = parsePayload(await decryptText(await file.text(), 'abcdefghij'));
    expect(payload.patients).toHaveLength(0);
    expect(payload.spots).toHaveLength(1);
    expect(payload.spots[0]!.note).toBe('きれいなトイレ');
  }, 10_000);
});

describe('createTransferFlow: shareSendFile/saveSendFile(readyの2段階目)', () => {
  it('readyでshareSendFileを呼ぶと、同じ同期区間でnavigator.shareが呼ばれる', async () => {
    const patient = createPatient('山田 太郎', '東京都千代田区1-1');
    const { ctx, getDialog } = createFakeContext({ patients: [patient] });
    const share = vi.fn(() => new Promise<void>(() => {}));
    vi.stubGlobal('navigator', { ...window.navigator, share, canShare: () => true });
    const flow = createTransferFlow(ctx);
    await flow.openSend([patient.id]);
    flow.updateSendDraft({ password: 'abcdefghij', passwordConfirm: 'abcdefghij' });
    await flow.submitSend();
    expect(getDialog()?.phase).toBe('ready');

    flow.shareSendFile();

    expect(share).toHaveBeenCalledTimes(1);
  }, 10_000);

  it('共有メニューを閉じて取りやめたら、readyのまま(もう一度押せる)', async () => {
    const patient = createPatient('山田 太郎', '東京都千代田区1-1');
    const { ctx, getDialog } = createFakeContext({ patients: [patient] });
    vi.spyOn(fileIo, 'canShareFile').mockReturnValue(true);
    vi.spyOn(fileIo, 'shareFile').mockResolvedValue('cancelled');
    const flow = createTransferFlow(ctx);
    await flow.openSend([patient.id]);
    flow.updateSendDraft({ password: 'abcdefghij', passwordConfirm: 'abcdefghij' });
    await flow.submitSend();

    flow.shareSendFile();
    await flushAsync();

    expect(getDialog()?.phase).toBe('ready');
    expect(getDialog()?.error).toBeNull();
  }, 10_000);

  it('共有に失敗したら、ダウンロードにフォールバックしてdoneにする(sharedはfalse)', async () => {
    const patient = createPatient('山田 太郎', '東京都千代田区1-1');
    const { ctx, getDialog } = createFakeContext({ patients: [patient] });
    vi.spyOn(fileIo, 'canShareFile').mockReturnValue(true);
    vi.spyOn(fileIo, 'shareFile').mockResolvedValue('failed');
    const downloadSpy = vi.spyOn(fileIo, 'downloadFile').mockImplementation(() => {});
    const flow = createTransferFlow(ctx);
    await flow.openSend([patient.id]);
    flow.updateSendDraft({ password: 'abcdefghij', passwordConfirm: 'abcdefghij' });
    await flow.submitSend();

    flow.shareSendFile();
    await flushAsync();

    expect(downloadSpy).toHaveBeenCalledTimes(1);
    expect(getDialog()?.phase).toBe('done');
    expect(getDialog()?.shared).toBe(false);
  }, 10_000);

  it('saveSendFileでdoneにする(sharedはfalse)', async () => {
    const patient = createPatient('山田 太郎', '東京都千代田区1-1');
    const { ctx, getDialog } = createFakeContext({ patients: [patient] });
    vi.spyOn(fileIo, 'canShareFile').mockReturnValue(false);
    const downloadSpy = vi.spyOn(fileIo, 'downloadFile').mockImplementation(() => {});
    const flow = createTransferFlow(ctx);
    await flow.openSend([patient.id]);
    flow.updateSendDraft({ password: 'abcdefghij', passwordConfirm: 'abcdefghij' });
    await flow.submitSend();
    expect(getDialog()?.canShare).toBe(false);

    flow.saveSendFile();
    await flushAsync();

    expect(downloadSpy).toHaveBeenCalledTimes(1);
    expect(getDialog()?.phase).toBe('done');
    expect(getDialog()?.shared).toBe(false);
  }, 10_000);

  it('saveAsSharedがオンなら、共有できた後に合言葉として保存し、hasSharedSecretも立てる', async () => {
    const patient = createPatient('山田 太郎', '東京都千代田区1-1');
    const { ctx } = createFakeContext({ patients: [patient] });
    vi.spyOn(fileIo, 'canShareFile').mockReturnValue(true);
    vi.spyOn(fileIo, 'shareFile').mockResolvedValue('shared');
    const flow = createTransferFlow(ctx);
    await flow.openSend([patient.id]);
    flow.updateSendDraft({ password: 'abcdefghij', passwordConfirm: 'abcdefghij', saveAsShared: true });
    await flow.submitSend();

    flow.shareSendFile();
    await flushAsync();

    expect(await getMeta('sharedSecret')).toBe('abcdefghij');
    expect(ctx.setSettingsInfo).toHaveBeenCalledWith(expect.objectContaining({ hasSharedSecret: true }));
    expect(ctx.getSettingsInfo().hasSharedSecret).toBe(true);
  }, 10_000);

  it('小窓を閉じたあと(discardSendFile)のshareSendFileは何もしない', async () => {
    const patient = createPatient('山田 太郎', '東京都千代田区1-1');
    const { ctx, getDialog } = createFakeContext({ patients: [patient] });
    vi.spyOn(fileIo, 'canShareFile').mockReturnValue(true);
    const shareSpy = vi.spyOn(fileIo, 'shareFile');
    const flow = createTransferFlow(ctx);
    await flow.openSend([patient.id]);
    flow.updateSendDraft({ password: 'abcdefghij', passwordConfirm: 'abcdefghij' });
    await flow.submitSend();
    expect(getDialog()?.phase).toBe('ready');

    // main.ts の setState と同じく、閉じたら discardSendFile を呼ぶ。
    ctx.setState({ ...ctx.getState(), dialog: null });
    flow.discardSendFile();

    flow.shareSendFile();

    expect(shareSpy).not.toHaveBeenCalled();
  }, 10_000);
});

// ===== 受け取り =====

const SPOT: Spot = {
  id: 'spot-1',
  kind: 'toilet',
  note: 'きれいなトイレ',
  location: { lat: 35, lng: 139, accuracy: null, recordedAt: '2026-09-01T00:00:00.000Z', source: 'gps' },
  createdAt: '2026-09-01T00:00:00.000Z',
};

/** テスト用の引き継ぎファイル(回数を少なくして速くする)。 */
async function makeTransferFile(
  password: string,
  content: { patients?: Patient[]; photos?: { id: string; patientId: string; dataUrl: string; createdAt: string }[] | null; spots?: Spot[] },
): Promise<string> {
  const plain = serializePayload({
    sentAt: '2026-09-27T00:00:00.000Z',
    patients: content.patients ?? [],
    photos: content.photos ?? null,
    spots: content.spots ?? [],
  });
  return encryptText(plain, password, 1000);
}

const receiveDialogOf = (state: AppState): TransferReceiveDialog | null =>
  state.dialog?.kind === 'transferReceive' ? state.dialog : null;

describe('createTransferFlow: 受け取り(パスワード)', () => {
  it('合言葉が無ければ、パスワードの画面で開く', async () => {
    const { ctx, getState } = createFakeContext();
    const flow = createTransferFlow(ctx);
    const text = await makeTransferFile('abcdef', { patients: [createPatient('山田 太郎', '東京都千代田区1-1')] });

    await flow.openReceive(text);

    expect(receiveDialogOf(getState())).toMatchObject({ phase: 'password', error: null, password: '', fileText: text });
  });

  it('パスワード違いならエラーを出してやり直せる。合えば確認へ進み、打ったパスワードは残さない', async () => {
    const patient = { ...createPatient('山田 太郎', '東京都千代田区1-1'), note: '裏口から' };
    const { ctx, getState } = createFakeContext();
    const flow = createTransferFlow(ctx);
    await flow.openReceive(await makeTransferFile('abcdef', { patients: [patient], spots: [SPOT] }));

    flow.updateReceivePassword('wrong-one');
    expect(ctx.setState).toHaveBeenLastCalledWith(expect.anything(), { render: false });
    await flow.submitReceivePassword();
    expect(receiveDialogOf(getState())).toMatchObject({
      phase: 'password',
      password: '',
      error: 'パスワードが違うか、ファイルが壊れています。何度でもやり直せます。',
    });

    flow.updateReceivePassword('abcdef');
    await flow.submitReceivePassword();
    const dialog = receiveDialogOf(getState())!;
    expect(dialog).toMatchObject({ phase: 'confirm', password: '', error: null });
    expect(dialog.summary).toBe('山田 太郎様・お役立ち地点1件');
    // 復号した中身(メモなど)は state に入れない。
    expect(JSON.stringify(getState())).not.toContain('裏口から');
  });

  it('空のパスワードでは開かず、案内を出す', async () => {
    const { ctx, getState } = createFakeContext();
    const flow = createTransferFlow(ctx);
    await flow.openReceive(await makeTransferFile('abcdef', { spots: [SPOT] }));

    await flow.submitReceivePassword();

    expect(receiveDialogOf(getState())).toMatchObject({ phase: 'password', error: 'パスワードを入れてください。' });
  });

  it('合言葉が保存されていて、それで開ければ、パスワードの画面を飛ばして確認へ進む', async () => {
    await setMeta('sharedSecret', 'jimusho-aikotoba');
    const { ctx, getState } = createFakeContext({ hasSharedSecret: true });
    const flow = createTransferFlow(ctx);

    await flow.openReceive(await makeTransferFile('jimusho-aikotoba', { spots: [SPOT] }));

    expect(receiveDialogOf(getState())).toMatchObject({ phase: 'confirm', summary: 'お役立ち地点1件' });
    // 途中で「少しお待ちください」(working)を出していた。
    const phases = vi
      .mocked(ctx.setState)
      .mock.calls.map(([next]) => (next.dialog?.kind === 'transferReceive' ? next.dialog.phase : null));
    expect(phases).toContain('working');
  });

  it('保存済みの合言葉が短くても、受け取りは今までどおり自動で試す(変えない)', async () => {
    await setMeta('sharedSecret', 'short-123');
    const { ctx, getState } = createFakeContext({ hasSharedSecret: true, sharedSecretShort: true });
    const flow = createTransferFlow(ctx);

    await flow.openReceive(await makeTransferFile('short-123', { spots: [SPOT] }));

    expect(receiveDialogOf(getState())).toMatchObject({ phase: 'confirm', summary: 'お役立ち地点1件' });
  });

  it('合言葉が違えば、エラーを出さずにパスワードの画面にする', async () => {
    await setMeta('sharedSecret', 'jimusho-aikotoba');
    const { ctx, getState } = createFakeContext({ hasSharedSecret: true });
    const flow = createTransferFlow(ctx);

    await flow.openReceive(await makeTransferFile('betsu-no-password', { spots: [SPOT] }));

    expect(receiveDialogOf(getState())).toMatchObject({ phase: 'password', error: null });
  });

  it('追加するものが無いファイルは、その旨を出す', async () => {
    const { ctx, getState } = createFakeContext();
    const flow = createTransferFlow(ctx);
    await flow.openReceive(await makeTransferFile('abcdef', {}));
    flow.updateReceivePassword('abcdef');

    await flow.submitReceivePassword();

    expect(receiveDialogOf(getState())).toMatchObject({
      phase: 'password',
      error: 'このファイルには追加するものがありません。',
    });
  });

  it('写真が壊れていれば、その旨を出し、何も書き込まない', async () => {
    const patient = createPatient('山田 太郎', '東京都千代田区1-1');
    const { ctx, getState } = createFakeContext();
    const flow = createTransferFlow(ctx);
    await flow.openReceive(
      await makeTransferFile('abcdef', {
        patients: [patient],
        photos: [{ id: 'ph1', patientId: patient.id, dataUrl: 'data:image/jpeg;base64,@@@@', createdAt: 't' }],
      }),
    );
    const applyImportSpy = vi.spyOn(db, 'applyImport');
    flow.updateReceivePassword('abcdef');

    await flow.submitReceivePassword();

    expect(receiveDialogOf(getState())).toMatchObject({ phase: 'password', error: '引き継ぎのファイルの写真が壊れています。' });
    await flow.confirmReceive();
    expect(applyImportSpy).not.toHaveBeenCalled();
  });

  it('復号の途中でダイアログが閉じられたら、あとから状態を書き換えない', async () => {
    const { ctx, getState } = createFakeContext();
    const flow = createTransferFlow(ctx);
    await flow.openReceive(await makeTransferFile('abcdef', { spots: [SPOT] }));
    flow.updateReceivePassword('abcdef');

    const pending = flow.submitReceivePassword();
    // main.ts の setState と同じく、閉じたら discardReceive を呼ぶ。
    ctx.setState({ ...getState(), dialog: null });
    flow.discardReceive();
    await pending;

    expect(getState().dialog).toBeNull();
  });

  it('「少しお待ちください」(working)のダイアログは、受け取りのコードを読み込む前に、その場で出る', async () => {
    const { ctx, getState } = createFakeContext();
    const flow = createTransferFlow(ctx);
    const text = await makeTransferFile('abcdef', { spots: [SPOT] });

    const pending = flow.openReceive(text);
    // まだ1つも await が進んでいない(同期のうち)に、もう出ている。
    expect(receiveDialogOf(getState())).toEqual({
      kind: 'transferReceive',
      fileText: text,
      phase: 'working',
      password: '',
      error: null,
      summary: '',
      conflictIndex: 0,
      conflicts: [],
      result: null,
    });
    await pending;

    expect(receiveDialogOf(getState())).toMatchObject({ phase: 'password', fileText: text });
  });

  it('2回目以降(受け取りのコードを読み込み済み)でも、working のダイアログはその場で出る', async () => {
    const { ctx, getState } = createFakeContext();
    const flow = createTransferFlow(ctx);
    await flow.openReceive(await makeTransferFile('abcdef', { spots: [SPOT] }));
    ctx.setState({ ...getState(), dialog: null });
    flow.discardReceive();

    const text = await makeTransferFile('abcdef', { spots: [SPOT] });
    const pending = flow.openReceive(text);
    expect(receiveDialogOf(getState())).toMatchObject({ phase: 'working', fileText: text });
    await pending;
    expect(receiveDialogOf(getState())).toMatchObject({ phase: 'password', fileText: text });
  });

  it('合言葉を読み出している間も working のまま。その間に閉じられたら、あとから開き直さない', async () => {
    await setMeta('sharedSecret', 'jimusho-aikotoba');
    const { ctx, getState } = createFakeContext({ hasSharedSecret: true });
    const flow = createTransferFlow(ctx);
    // 1回目で受け取りのコードを読み込んでおく(2回目は、合言葉の読み出しの前に working になる)。
    await flow.openReceive(await makeTransferFile('jimusho-aikotoba', { spots: [SPOT] }));
    ctx.setState({ ...getState(), dialog: null });
    flow.discardReceive();

    let releaseMeta!: () => void;
    const metaGate = new Promise<void>((resolve) => {
      releaseMeta = resolve;
    });
    const realGetMeta = db.getMeta;
    vi.spyOn(db, 'getMeta').mockImplementation(async (key) => {
      await metaGate;
      return realGetMeta(key);
    });

    const pending = flow.openReceive(await makeTransferFile('jimusho-aikotoba', { spots: [SPOT] }));
    await vi.waitFor(() => expect(db.getMeta).toHaveBeenCalledWith('sharedSecret'), { timeout: 2000, interval: 5 });
    expect(receiveDialogOf(getState())).toMatchObject({ phase: 'working' });

    // main.ts の setState と同じく、閉じたら discardReceive を呼ぶ。
    ctx.setState({ ...getState(), dialog: null });
    flow.discardReceive();
    releaseMeta();
    await pending;

    expect(getState().dialog).toBeNull();
  });

  it('受け取りのコードを読み込めなければ、working のダイアログを閉じて「開けませんでした」を出す。選び直せば、もう一度読み込む', async () => {
    vi.doMock('../src/transferReceive', () => {
      throw new Error('読み込みに失敗(通信が切れたなど)');
    });
    try {
      const { ctx, getState } = createFakeContext();
      const flow = createTransferFlow(ctx);
      const text = await makeTransferFile('abcdef', { spots: [SPOT] });

      const pending = flow.openReceive(text);
      expect(receiveDialogOf(getState())).toMatchObject({ phase: 'working' });
      await pending;

      expect(getState().dialog).toBeNull();
      expect(getState().message).toEqual({ kind: 'error', text: '引き継ぎのファイルを開けませんでした。' });

      vi.doUnmock('../src/transferReceive');
      await flow.openReceive(text);
      expect(receiveDialogOf(getState())).toMatchObject({ phase: 'password', fileText: text });
    } finally {
      vi.doUnmock('../src/transferReceive');
    }
  });
});

describe('createTransferFlow: 受け取り(パスワードと関係のない失敗の文)', () => {
  const NOT_TRANSFER = '引き継ぎのファイルではないか、新しい版のアプリで作られています。';
  const LOAD_FAILED = '引き継ぎのファイルを開けませんでした。';

  /** 版(v)だけを変えた、新しい版のアプリで作られたかのようなファイル。 */
  async function newerVersionFile(password: string): Promise<string> {
    const parsed = JSON.parse(await makeTransferFile(password, { spots: [SPOT] })) as Record<string, unknown>;
    parsed.v = 2;
    return JSON.stringify(parsed);
  }

  it('形が読めない(新しい版など)ファイルは、パスワード違いではなく、その旨を出す', async () => {
    const { ctx, getState } = createFakeContext();
    const flow = createTransferFlow(ctx);
    await flow.openReceive(await newerVersionFile('abcdef'));
    flow.updateReceivePassword('abcdef');

    await flow.submitReceivePassword();

    expect(receiveDialogOf(getState())).toMatchObject({ phase: 'password', error: NOT_TRANSFER });
  });

  it('合言葉で先に試したときも、形が読めなければ黙ってパスワードの画面にせず、その旨を出す', async () => {
    await setMeta('sharedSecret', 'jimusho-aikotoba');
    const { ctx, getState } = createFakeContext({ hasSharedSecret: true });
    const flow = createTransferFlow(ctx);

    await flow.openReceive(await newerVersionFile('jimusho-aikotoba'));

    expect(receiveDialogOf(getState())).toMatchObject({ phase: 'password', error: NOT_TRANSFER });
  });

  it('復号のコードを読み込めなければ、パスワード違いではなく「開けませんでした」を出す', async () => {
    const { ctx, getState } = createFakeContext();
    const flow = createTransferFlow(ctx);
    const text = await makeTransferFile('abcdef', { spots: [SPOT] });
    await flow.openReceive(text);
    flow.updateReceivePassword('abcdef');

    vi.doMock('../src/crypto', () => {
      throw new Error('読み込みに失敗(通信が切れたなど)');
    });
    try {
      await flow.submitReceivePassword();
    } finally {
      vi.doUnmock('../src/crypto');
    }

    expect(receiveDialogOf(getState())).toMatchObject({ phase: 'password', error: LOAD_FAILED });
  });

  it('合言葉で先に試したときも、復号のコードを読み込めなければ「開けませんでした」を出す', async () => {
    await setMeta('sharedSecret', 'jimusho-aikotoba');
    const { ctx, getState } = createFakeContext({ hasSharedSecret: true });
    const flow = createTransferFlow(ctx);
    const text = await makeTransferFile('jimusho-aikotoba', { spots: [SPOT] });

    vi.doMock('../src/crypto', () => {
      throw new Error('読み込みに失敗(通信が切れたなど)');
    });
    try {
      await flow.openReceive(text);
    } finally {
      vi.doUnmock('../src/crypto');
    }

    expect(receiveDialogOf(getState())).toMatchObject({ phase: 'password', error: LOAD_FAILED });
  });

  it('パスワード違い(復号の失敗)だけが「パスワードが違うか…」になる', async () => {
    const { ctx, getState } = createFakeContext();
    const flow = createTransferFlow(ctx);
    await flow.openReceive(await makeTransferFile('abcdef', { spots: [SPOT] }));
    flow.updateReceivePassword('abcdeg');

    await flow.submitReceivePassword();

    expect(receiveDialogOf(getState())).toMatchObject({
      phase: 'password',
      error: 'パスワードが違うか、ファイルが壊れています。何度でもやり直せます。',
    });
  });
});

describe('createTransferFlow: 受け取り(確認・同じ人・取り込み)', () => {
  async function openAndUnlock(
    flow: ReturnType<typeof createTransferFlow>,
    content: Parameters<typeof makeTransferFile>[1],
  ): Promise<void> {
    await flow.openReceive(await makeTransferFile('abcdef', content));
    flow.updateReceivePassword('abcdef');
    await flow.submitReceivePassword();
  }

  it('同じ人がいなければ、新しい id で追加し、写真・位置・メモも入る', async () => {
    const incoming = {
      ...createPatient('山田 太郎', '東京都千代田区1-1'),
      note: '裏口から',
      location: { lat: 35.1, lng: 139.1, accuracy: 5, recordedAt: '2026-09-01T00:00:00.000Z', source: 'gps' as const },
    };
    const { ctx, getState } = createFakeContext();
    const flow = createTransferFlow(ctx);
    await openAndUnlock(flow, {
      patients: [incoming],
      photos: [{ id: 'ph1', patientId: incoming.id, dataUrl: 'data:image/jpeg;base64,eA==', createdAt: 't1' }],
    });

    await flow.confirmReceive();

    expect(receiveDialogOf(getState())).toMatchObject({ phase: 'done', result: '1人を追加しました。', error: null });
    const saved = await db.listPatients();
    expect(saved).toHaveLength(1);
    expect(saved[0]!.id).not.toBe(incoming.id);
    expect(saved[0]!.note).toBe('裏口から');
    expect(saved[0]!.location?.lat).toBe(35.1);
    const photos = await db.listPhotos(saved[0]!.id);
    expect(photos).toHaveLength(1);
    expect(photos[0]!.id).not.toBe('ph1');
    expect(ctx.loadSpots).toHaveBeenCalled();
    expect(ctx.loadPhotoCounts).toHaveBeenCalled();
    expect(ctx.loadPhotoBytes).toHaveBeenCalled();
    expect(ctx.reloadPatients).toHaveBeenCalled();
  });

  it('お役立ち地点だけのファイルも取り込める', async () => {
    const { ctx, getState } = createFakeContext();
    const flow = createTransferFlow(ctx);
    await openAndUnlock(flow, { spots: [SPOT] });

    await flow.confirmReceive();

    expect(receiveDialogOf(getState())).toMatchObject({ phase: 'done', result: 'お役立ち地点1件を追加しました。' });
    expect(await db.listSpots()).toHaveLength(1);
  });

  it('同じ人が2人いれば1人ずつ聞き、「上書き」と「この人は追加しない」に従う(地点と新しい人も入る)', async () => {
    const first = createPatient('山田 太郎', '東京都千代田区1-1');
    const second = createPatient('鈴木 花子', '大阪府大阪市2-2');
    await db.savePatient(first);
    await db.savePatient(second);
    const incomingFirst = { ...createPatient('山田 太郎', '東京都千代田区1-1'), note: '新しいメモ' };
    const incomingSecond = { ...createPatient('鈴木 花子', '大阪府大阪市2-2'), note: '入らないメモ' };
    const fresh = createPatient('佐藤 次郎', '京都府京都市3-3');
    const { ctx, getState } = createFakeContext({ patients: [first, second] });
    const flow = createTransferFlow(ctx);
    await openAndUnlock(flow, { patients: [incomingFirst, incomingSecond, fresh], spots: [SPOT] });
    expect(receiveDialogOf(getState())?.summary).toBe('山田 太郎様ほか2人・お役立ち地点1件');

    await flow.confirmReceive();
    expect(receiveDialogOf(getState())).toMatchObject({ phase: 'conflict', conflictIndex: 0 });
    expect(receiveDialogOf(getState())?.conflicts).toEqual([
      {
        incomingName: '山田 太郎',
        incomingAddress: '東京都千代田区1-1',
        existingName: '山田 太郎',
        existingAddress: '東京都千代田区1-1',
      },
      {
        incomingName: '鈴木 花子',
        incomingAddress: '大阪府大阪市2-2',
        existingName: '鈴木 花子',
        existingAddress: '大阪府大阪市2-2',
      },
    ]);

    await flow.chooseConflict('overwrite');
    expect(receiveDialogOf(getState())).toMatchObject({ phase: 'conflict', conflictIndex: 1 });
    await flow.chooseConflict('skip');

    expect(receiveDialogOf(getState())).toMatchObject({
      phase: 'done',
      result: '1人とお役立ち地点1件を追加し、1人を上書きしました。',
    });
    const saved = await db.listPatients();
    expect(saved).toHaveLength(3);
    expect(saved.find((p) => p.id === first.id)?.note).toBe('新しいメモ');
    expect(saved.find((p) => p.id === second.id)?.note).toBeUndefined();
    expect(saved.some((p) => p.name === '佐藤 次郎' && p.id !== fresh.id)).toBe(true);
    expect(ctx.clearOpenedRoutes).toHaveBeenCalled();
  });

  it('全員「この人は追加しない」で地点も無ければ「追加したものはありません。」', async () => {
    const existing = createPatient('山田 太郎', '東京都千代田区1-1');
    await db.savePatient(existing);
    const { ctx, getState } = createFakeContext({ patients: [existing] });
    const flow = createTransferFlow(ctx);
    await openAndUnlock(flow, { patients: [createPatient('山田 太郎', '東京都千代田区1-1')] });

    await flow.confirmReceive();
    await flow.chooseConflict('skip');

    expect(receiveDialogOf(getState())).toMatchObject({ phase: 'done', result: '追加したものはありません。' });
    expect(await db.listPatients()).toHaveLength(1);
  });

  it('「別に追加」は新しい id で足す', async () => {
    const existing = createPatient('山田 太郎', '東京都千代田区1-1');
    await db.savePatient(existing);
    const { ctx, getState } = createFakeContext({ patients: [existing] });
    const flow = createTransferFlow(ctx);
    await openAndUnlock(flow, { patients: [createPatient('山田 太郎', '東京都千代田区1-1')] });

    await flow.confirmReceive();
    await flow.chooseConflict('addNew');

    expect(receiveDialogOf(getState())).toMatchObject({ phase: 'done', result: '1人を追加しました。' });
    expect(await db.listPatients()).toHaveLength(2);
  });

  it('写真を含まないファイルで上書きしても、手元の写真は残る', async () => {
    const existing = createPatient('山田 太郎', '東京都千代田区1-1');
    await db.savePatient(existing);
    await db.addPhoto({ id: 'mine', patientId: existing.id, blob: new Blob(['x'], { type: 'image/jpeg' }), createdAt: 't' });
    const { ctx } = createFakeContext({ patients: [existing] });
    const flow = createTransferFlow(ctx);
    await openAndUnlock(flow, { patients: [createPatient('山田 太郎', '東京都千代田区1-1')], photos: null });

    await flow.confirmReceive();
    await flow.chooseConflict('overwrite');

    const photos = await db.listPhotos(existing.id);
    expect(photos.map((photo) => photo.id)).toEqual(['mine']);
  });

  it('書き込みの途中で失敗したら「取り込めませんでした。」とし、画面を読み直す', async () => {
    const { ctx, getState } = createFakeContext();
    const flow = createTransferFlow(ctx);
    await openAndUnlock(flow, { patients: [createPatient('山田 太郎', '東京都千代田区1-1')] });
    vi.spyOn(db, 'applyImport').mockRejectedValue(new Error('boom'));

    await flow.confirmReceive();

    expect(receiveDialogOf(getState())).toMatchObject({ phase: 'done', error: '取り込めませんでした。', result: null });
    expect(ctx.reloadPatients).toHaveBeenCalled();
    expect(ctx.loadSpots).toHaveBeenCalled();
  });

  it('閉じたあと(discardReceive)は、確認の「追加する」が来ても何もしない', async () => {
    const { ctx } = createFakeContext();
    const flow = createTransferFlow(ctx);
    await openAndUnlock(flow, { spots: [SPOT] });
    const applyImportSpy = vi.spyOn(db, 'applyImport');

    flow.discardReceive();
    await flow.confirmReceive();

    expect(applyImportSpy).not.toHaveBeenCalled();
    expect(await db.listSpots()).toHaveLength(0);
  });

  it('「追加する」を連打しても、二重に取り込まない', async () => {
    const { ctx } = createFakeContext();
    const flow = createTransferFlow(ctx);
    await openAndUnlock(flow, { patients: [createPatient('山田 太郎', '東京都千代田区1-1')] });
    const applyImportSpy = vi.spyOn(db, 'applyImport');

    await Promise.all([flow.confirmReceive(), flow.confirmReceive()]);

    expect(applyImportSpy).toHaveBeenCalledTimes(1);
    expect(await db.listPatients()).toHaveLength(1);
  });
});
