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
    // 送り終えたら、パスワードは画面(state)に残さない。
    expect(getDialog()?.password).toBe('');
    expect(getDialog()?.passwordConfirm).toBe('');
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
    // 取りやめてformに戻ったときは、入力し直さずに済むようパスワードを残す。
    expect(getDialog()?.password).toBe('abcdef');
    expect(getDialog()?.passwordConfirm).toBe('abcdef');
  }, 10_000);

  it('saveAsSharedがオンなら、成功後に合言葉として保存し、hasSharedSecretも立てる', async () => {
    const patient = createPatient('山田 太郎', '東京都千代田区1-1');
    const { ctx } = createFakeContext({ patients: [patient] });
    vi.spyOn(fileIo, 'shareOrDownloadFile').mockResolvedValue('shared');
    const flow = createTransferFlow(ctx);
    await flow.openSend([patient.id]);
    flow.updateSendDraft({ password: 'abcdef', passwordConfirm: 'abcdef', saveAsShared: true });

    await flow.submitSend();

    expect(await getMeta('sharedSecret')).toBe('abcdef');
    expect(ctx.setSettingsInfo).toHaveBeenCalledWith(expect.objectContaining({ hasSharedSecret: true }));
    expect(ctx.getSettingsInfo().hasSharedSecret).toBe(true);
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
    const shareSpy = vi.spyOn(fileIo, 'shareOrDownloadFile').mockResolvedValue('shared');
    const flow = createTransferFlow(ctx);
    await flow.openSend([sent.id]);
    flow.updateSendDraft({ password: 'abcdef', passwordConfirm: 'abcdef' });

    await flow.submitSend();

    expect(listPhotosSpy).toHaveBeenCalledTimes(1);
    expect(listPhotosSpy).toHaveBeenCalledWith(sent.id);
    const file = shareSpy.mock.calls[0]![0];
    const payload = parsePayload(await decryptText(await file.text(), 'abcdef'));
    expect(payload.patients).toHaveLength(1);
    expect(payload.photos).toHaveLength(1);
    expect(payload.photos![0]!.patientId).toBe(sent.id);
  }, 10_000);

  it('写真のBlobをdata URLに変換できなければ、汎用のエラー文を出し、共有/ダウンロードはしない', async () => {
    const patient = createPatient('山田 太郎', '東京都千代田区1-1');
    vi.spyOn(db, 'listPhotos').mockResolvedValue([
      { id: 'photo-1', patientId: patient.id, blob: new Blob(['x'], { type: 'image/jpeg' }), createdAt: 't1' },
    ]);
    vi.spyOn(photoCodec, 'blobToDataUrl').mockRejectedValue(new Error('写真を読み込めませんでした。'));
    const { ctx, getDialog } = createFakeContext({ patients: [patient] });
    const shareSpy = vi.spyOn(fileIo, 'shareOrDownloadFile');
    const flow = createTransferFlow(ctx);
    await flow.openSend([patient.id]);
    flow.updateSendDraft({ password: 'abcdef', passwordConfirm: 'abcdef' });

    await flow.submitSend();

    expect(getDialog()?.phase).toBe('form');
    expect(getDialog()?.error).toBe('送るファイルを作れませんでした。');
    expect(shareSpy).not.toHaveBeenCalled();
  }, 10_000);

  it('「写真も含める」を外すと、写真は問い合わせず、payloadのphotosはnullになる', async () => {
    const patient = createPatient('山田 太郎', '東京都千代田区1-1');
    const listPhotosSpy = vi.spyOn(db, 'listPhotos');
    const { ctx } = createFakeContext({ patients: [patient] });
    const shareSpy = vi.spyOn(fileIo, 'shareOrDownloadFile').mockResolvedValue('shared');
    const flow = createTransferFlow(ctx);
    await flow.openSend([patient.id]);
    flow.updateSendDraft({ includePhotos: false, password: 'abcdef', passwordConfirm: 'abcdef' });

    await flow.submitSend();

    expect(listPhotosSpy).not.toHaveBeenCalled();
    const file = shareSpy.mock.calls[0]![0];
    const payload = parsePayload(await decryptText(await file.text(), 'abcdef'));
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
    const mergeSpy = vi.spyOn(db, 'mergePatients');
    flow.updateReceivePassword('abcdef');

    await flow.submitReceivePassword();

    expect(receiveDialogOf(getState())).toMatchObject({ phase: 'password', error: '引き継ぎのファイルの写真が壊れています。' });
    await flow.confirmReceive();
    expect(mergeSpy).not.toHaveBeenCalled();
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
    vi.spyOn(db, 'mergePatients').mockRejectedValue(new Error('boom'));

    await flow.confirmReceive();

    expect(receiveDialogOf(getState())).toMatchObject({ phase: 'done', error: '取り込めませんでした。', result: null });
    expect(ctx.reloadPatients).toHaveBeenCalled();
    expect(ctx.loadSpots).toHaveBeenCalled();
  });

  it('閉じたあと(discardReceive)は、確認の「追加する」が来ても何もしない', async () => {
    const { ctx } = createFakeContext();
    const flow = createTransferFlow(ctx);
    await openAndUnlock(flow, { spots: [SPOT] });
    const mergeSpy = vi.spyOn(db, 'mergePatients');

    flow.discardReceive();
    await flow.confirmReceive();

    expect(mergeSpy).not.toHaveBeenCalled();
    expect(await db.listSpots()).toHaveLength(0);
  });

  it('「追加する」を連打しても、二重に取り込まない', async () => {
    const { ctx } = createFakeContext();
    const flow = createTransferFlow(ctx);
    await openAndUnlock(flow, { patients: [createPatient('山田 太郎', '東京都千代田区1-1')] });
    const mergeSpy = vi.spyOn(db, 'mergePatients');

    await Promise.all([flow.confirmReceive(), flow.confirmReceive()]);

    expect(mergeSpy).toHaveBeenCalledTimes(1);
    expect(await db.listPatients()).toHaveLength(1);
  });
});
