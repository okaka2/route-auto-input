import 'fake-indexeddb/auto';
import { deleteDB } from 'idb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppContext } from '../src/appContext';
import { MIN_PASSWORD_LENGTH } from '../src/config';
import { decryptText } from '../src/crypto';
import * as db from '../src/db';
import { closeDbForTest, getMeta, setMeta } from '../src/db';
import * as fileIo from '../src/fileIo';
import { createPatient } from '../src/patient';
import { DEFAULT_ROUTE_ENDS } from '../src/routePlan';
import { createInitialState } from '../src/state';
import { createTransferFlow } from '../src/transferFlow';
import { parsePayload } from '../src/transfer';
import type { AppState, Patient, Spot, TransferSendDialog } from '../src/types';

beforeEach(async () => {
  await closeDbForTest();
  await deleteDB('route-auto-input');
});

afterEach(() => {
  // vi.spyOn(fileIo, 'shareOrDownloadFile') 等をテストごとに積み重ねない。積み重なると、
  // 次のテストの shareSpy.mock.calls[0] が前のテストの呼び出しを指してしまう。
  vi.restoreAllMocks();
});

type SettingsInfoLike = ReturnType<AppContext['getSettingsInfo']>;

/** 偽のAppContext。backupFlow.test.tsと同じやり方だが、dialog/settingsInfo/spotsを実際に保持し、
 * ダイアログを開く→入力する→送る、という一連の呼び出しをまたいで状態が保たれるようにする。 */
function createFakeContext(options: { patients?: Patient[]; spots?: Spot[]; hasSharedSecret?: boolean } = {}) {
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

describe('createTransferFlow: submitSend', () => {
  it('送るものがない(訪問先なし・地点も含めない)ときは、確認を挟まずエラーにする', async () => {
    const { ctx, getDialog } = createFakeContext();
    const flow = createTransferFlow(ctx);
    await flow.openSend([]);
    flow.updateSendDraft({ includeSpots: false });

    await flow.submitSend();

    expect(getDialog()?.error).toBe('送るものがありません。');
    expect(getDialog()?.phase).toBe('form');
    expect(ctx.confirm).not.toHaveBeenCalled();
  });

  it('パスワードが6文字未満ならエラー', async () => {
    const patient = createPatient('山田 太郎', '東京都千代田区1-1');
    const { ctx, getDialog } = createFakeContext({ patients: [patient] });
    const flow = createTransferFlow(ctx);
    await flow.openSend([patient.id]);
    flow.updateSendDraft({ password: 'abc', passwordConfirm: 'abc' });

    await flow.submitSend();

    expect(getDialog()?.error).toBe(`パスワードは${MIN_PASSWORD_LENGTH}文字以上にしてください。`);
    expect(ctx.confirm).not.toHaveBeenCalled();
  });

  it('確認用パスワードが一致しなければエラー', async () => {
    const patient = createPatient('山田 太郎', '東京都千代田区1-1');
    const { ctx, getDialog } = createFakeContext({ patients: [patient] });
    const flow = createTransferFlow(ctx);
    await flow.openSend([patient.id]);
    flow.updateSendDraft({ password: 'abcdef', passwordConfirm: 'abcdeg' });

    await flow.submitSend();

    expect(getDialog()?.error).toBe('確認のパスワードが一致しません。');
    expect(ctx.confirm).not.toHaveBeenCalled();
  });

  it('合言葉を使う設定だが、まだ保存されていなければエラーにする', async () => {
    const patient = createPatient('山田 太郎', '東京都千代田区1-1');
    const { ctx, getDialog } = createFakeContext({ patients: [patient], hasSharedSecret: false });
    const flow = createTransferFlow(ctx);
    await flow.openSend([patient.id]);
    flow.updateSendDraft({ useSharedSecret: true });

    await flow.submitSend();

    expect(getDialog()?.error).toBe('送るファイルを作れませんでした。');
    expect(ctx.confirm).not.toHaveBeenCalled();
  });

  it('確認で「キャンセル」なら、何も作らずformのまま', async () => {
    const patient = createPatient('山田 太郎', '東京都千代田区1-1');
    const { ctx, getDialog } = createFakeContext({ patients: [patient] });
    const shareSpy = vi.spyOn(fileIo, 'shareOrDownloadFile');
    const flow = createTransferFlow(ctx);
    await flow.openSend([patient.id]);
    flow.updateSendDraft({ password: 'abcdef', passwordConfirm: 'abcdef' });
    vi.mocked(ctx.confirm).mockReturnValue(false);

    await flow.submitSend();

    expect(getDialog()?.phase).toBe('form');
    expect(getDialog()?.error).toBeNull();
    expect(shareSpy).not.toHaveBeenCalled();
  });

  it('成功(共有できた)なら、暗号化したFileを渡し、doneにする', async () => {
    const patient = { ...createPatient('山田 太郎', '東京都千代田区1-1'), note: '駐車場は裏手' };
    const { ctx, getDialog } = createFakeContext({ patients: [patient] });
    const shareSpy = vi.spyOn(fileIo, 'shareOrDownloadFile').mockResolvedValue('shared');
    const flow = createTransferFlow(ctx);
    await flow.openSend([patient.id]);
    flow.updateSendDraft({ password: 'abcdef', passwordConfirm: 'abcdef' });

    await flow.submitSend();

    expect(getDialog()?.phase).toBe('done');
    expect(getDialog()?.shared).toBe(true);
    expect(shareSpy).toHaveBeenCalledTimes(1);
    const file = shareSpy.mock.calls[0]![0];
    expect(file.name).toMatch(/^訪問先の引き継ぎ_\d{4}-\d{2}-\d{2}\.txt$/);
    expect(file.type).toBe('text/plain');
    const decrypted = await decryptText(await file.text(), 'abcdef');
    const payload = parsePayload(decrypted);
    expect(payload.patients).toHaveLength(1);
    expect(payload.patients[0]!.name).toBe('山田 太郎');
    expect(payload.patients[0]!.note).toBe('駐車場は裏手');
  }, 10_000);

  it('成功したが共有メニューが無く保存した場合は、sharedをfalseにする', async () => {
    const patient = createPatient('山田 太郎', '東京都千代田区1-1');
    const { ctx, getDialog } = createFakeContext({ patients: [patient] });
    vi.spyOn(fileIo, 'shareOrDownloadFile').mockResolvedValue('downloaded');
    const flow = createTransferFlow(ctx);
    await flow.openSend([patient.id]);
    flow.updateSendDraft({ password: 'abcdef', passwordConfirm: 'abcdef' });

    await flow.submitSend();

    expect(getDialog()?.phase).toBe('done');
    expect(getDialog()?.shared).toBe(false);
  }, 10_000);

  it('共有メニューを閉じて取りやめたら、formへ戻す(エラーは出さない)', async () => {
    const patient = createPatient('山田 太郎', '東京都千代田区1-1');
    const { ctx, getDialog } = createFakeContext({ patients: [patient] });
    vi.spyOn(fileIo, 'shareOrDownloadFile').mockResolvedValue('cancelled');
    const flow = createTransferFlow(ctx);
    await flow.openSend([patient.id]);
    flow.updateSendDraft({ password: 'abcdef', passwordConfirm: 'abcdef' });

    await flow.submitSend();

    expect(getDialog()?.phase).toBe('form');
    expect(getDialog()?.error).toBeNull();
  }, 10_000);

  it('saveAsSharedがオンなら、成功後に合言葉として保存する', async () => {
    const patient = createPatient('山田 太郎', '東京都千代田区1-1');
    const { ctx } = createFakeContext({ patients: [patient] });
    vi.spyOn(fileIo, 'shareOrDownloadFile').mockResolvedValue('shared');
    const flow = createTransferFlow(ctx);
    await flow.openSend([patient.id]);
    flow.updateSendDraft({ password: 'abcdef', passwordConfirm: 'abcdef', saveAsShared: true });

    await flow.submitSend();

    expect(await getMeta('sharedSecret')).toBe('abcdef');
  }, 10_000);

  it('合言葉を使うときは、保存済みの合言葉で暗号化する(入力欄のpasswordは使わない)', async () => {
    await setMeta('sharedSecret', 'jimusho-no-aikotoba');
    const patient = createPatient('山田 太郎', '東京都千代田区1-1');
    const { ctx, getDialog } = createFakeContext({ patients: [patient], hasSharedSecret: true });
    const shareSpy = vi.spyOn(fileIo, 'shareOrDownloadFile').mockResolvedValue('shared');
    const flow = createTransferFlow(ctx);
    await flow.openSend([patient.id]);
    expect(getDialog()?.useSharedSecret).toBe(true);

    await flow.submitSend();

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
    const shareSpy = vi.spyOn(fileIo, 'shareOrDownloadFile').mockResolvedValue('shared');
    const flow = createTransferFlow(ctx);
    await flow.openSend([patient.id]);
    expect(getDialog()?.includePhotos).toBe(true);
    flow.updateSendDraft({ password: 'abcdef', passwordConfirm: 'abcdef' });

    await flow.submitSend();

    const file = shareSpy.mock.calls[0]![0];
    const payload = parsePayload(await decryptText(await file.text(), 'abcdef'));
    expect(payload.photos).toHaveLength(1);
    expect(payload.photos![0]!.patientId).toBe(patient.id);
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
    const shareSpy = vi.spyOn(fileIo, 'shareOrDownloadFile').mockResolvedValue('shared');
    const flow = createTransferFlow(ctx);
    await flow.openSend([]);
    expect(getDialog()?.includeSpots).toBe(true);
    flow.updateSendDraft({ password: 'abcdef', passwordConfirm: 'abcdef' });

    await flow.submitSend();

    const file = shareSpy.mock.calls[0]![0];
    const payload = parsePayload(await decryptText(await file.text(), 'abcdef'));
    expect(payload.patients).toHaveLength(0);
    expect(payload.spots).toHaveLength(1);
    expect(payload.spots[0]!.note).toBe('きれいなトイレ');
  }, 10_000);

  it('連打しても、二重に共有/保存しない', async () => {
    const patient = createPatient('山田 太郎', '東京都千代田区1-1');
    const { ctx } = createFakeContext({ patients: [patient] });
    const shareSpy = vi.spyOn(fileIo, 'shareOrDownloadFile').mockResolvedValue('shared');
    const flow = createTransferFlow(ctx);
    await flow.openSend([patient.id]);
    flow.updateSendDraft({ password: 'abcdef', passwordConfirm: 'abcdef' });

    await Promise.all([flow.submitSend(), flow.submitSend()]);

    expect(shareSpy).toHaveBeenCalledTimes(1);
  }, 10_000);

  it('失敗したら、汎用のエラー文を出し、formへ戻す', async () => {
    const patient = createPatient('山田 太郎', '東京都千代田区1-1');
    const { ctx, getDialog } = createFakeContext({ patients: [patient] });
    vi.spyOn(fileIo, 'shareOrDownloadFile').mockRejectedValue(new Error('boom'));
    const flow = createTransferFlow(ctx);
    await flow.openSend([patient.id]);
    flow.updateSendDraft({ password: 'abcdef', passwordConfirm: 'abcdef' });

    await flow.submitSend();

    expect(getDialog()?.phase).toBe('form');
    expect(getDialog()?.error).toBe('送るファイルを作れませんでした。');
  }, 10_000);
});
