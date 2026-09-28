import type { AppContext } from './appContext';
import { MIN_PASSWORD_LENGTH } from './config';
import { getMeta, listPhotos, setMeta } from './db';
import { canShareFile, downloadFile, shareFile } from './fileIo';
import { dateKey } from './history';
import { blobToDataUrl } from './photoCodec';
import { RECEIVE_LOAD_FAILED_MESSAGE } from './transferFormat';
// transfer.ts(中身の組み立て)と transferReceive.ts(受け取りの流れ)は、送る/受け取るときだけ
// import() で読み込む(アプリを開いただけでは使わないので、本体を軽くする)。ここでは型だけを使う。
import type { ConflictChoice } from './transfer';
import type { ReceiveSteps } from './transferReceive';
import type { Patient, TransferReceiveDialog, TransferSendDialog } from './types';

type SendDraftPatch = Partial<
  Pick<
    TransferSendDialog,
    'includePhotos' | 'includeSpots' | 'useSharedSecret' | 'password' | 'passwordConfirm' | 'saveAsShared'
  >
>;

const NOTHING_TO_SEND_MESSAGE = '送るものがありません。';
const BUILD_FAILED_MESSAGE = '送るファイルを作れませんでした。';
const PASSWORD_TOO_SHORT_MESSAGE = `パスワードは${MIN_PASSWORD_LENGTH}文字以上にしてください。`;
const PASSWORD_MISMATCH_MESSAGE = '確認のパスワードが一致しません。';
const SHARED_SECRET_MISSING_MESSAGE = '事業所の合言葉が見つかりません。パスワードを入力してください。';
const SHARED_SECRET_SHORT_MESSAGE = `事業所の合言葉が短いので、${MIN_PASSWORD_LENGTH}文字以上に変えてください。`;

/**
 * 「送る」の入口(一覧の「⋯」・選択バー・設定のお役立ち地点)からダイアログを開き、
 * パスワードで暗号化したファイルを共有/ダウンロードするまでの流れと、
 * 設定の「読み込む」で引き継ぎのファイルを選んだときの、受け取り(パスワード → 確認 →
 * 同じ人ごとの選択 → 取り込み)の流れ。main.ts が持つ状態は AppContext 経由でしか触らない
 * (backupFlow.ts と同じやり方。main.ts側で1つだけ作って渡す)。
 */
export function createTransferFlow(ctx: AppContext): {
  openSend(patientIds: string[], options?: { spotsOnly?: boolean }): Promise<void>;
  updateSendDraft(patch: SendDraftPatch): void;
  submitSend(): Promise<void>;
  shareSendFile(): void;
  saveSendFile(): void;
  discardSendFile(): void;
  openReceive(fileText: string): Promise<void>;
  updateReceivePassword(password: string): void;
  submitReceivePassword(): Promise<void>;
  confirmReceive(): Promise<void>;
  chooseConflict(choice: ConflictChoice): Promise<void>;
  discardReceive(): void;
} {
  // 二重押し防止(「ファイルを作る」を連打しても、ファイルを二重に作らない)。
  let sending = false;

  // readyになったときにできたファイル。小窓(transferSend)を出している間だけ持ち、stateには
  // 入れない(backupFlow.ts の pendingFile と同じやり方)。「LINEなどで送る」「ファイルを保存」で使う。
  let readyFile: File | null = null;
  // saveAsSharedのとき、送り終えてから合言葉として保存するために持っておくパスワード。
  let readyPassword: string | null = null;

  // 受け取りの流れ(transferReceive.ts)。初めて受け取るときに読み込み、以後は同じものを使う
  // (復号した中身や世代は、その中に持つ)。
  let receiveSteps: Promise<ReceiveSteps> | null = null;
  let loadedReceiveSteps: ReceiveSteps | null = null;

  function setDialog(next: TransferSendDialog, options?: { render?: boolean }): void {
    ctx.setState({ ...ctx.getState(), dialog: next }, options);
  }

  function loadReceiveSteps(): Promise<ReceiveSteps> {
    receiveSteps ??= import('./transferReceive').then(({ createReceiveSteps }) => {
      loadedReceiveSteps = createReceiveSteps(ctx);
      return loadedReceiveSteps;
    });
    return receiveSteps;
  }

  /**
   * 読み込むで引き継ぎのファイルを選んだときの入口(合言葉があれば先に試す。transferReceive.ts)。
   * 受け取りのコードを読み込む(初回は少し時間がかかる)より前に、この場で「少しお待ちください」の
   * ダイアログを出す。出すのが読み込みの後だと、その間はファイルを選んだのに何も起きないように見え、
   * 画面を触れてしまう。working のダイアログは閉じられないので、読み込みの間に他のものに
   * 置き換わることもない。
   */
  async function openReceive(fileText: string): Promise<void> {
    const waiting: TransferReceiveDialog = {
      kind: 'transferReceive',
      fileText,
      phase: 'working',
      password: '',
      error: null,
      summary: '',
      conflictIndex: 0,
      conflicts: [],
      result: null,
    };
    ctx.setState({ ...ctx.getState(), dialog: waiting });
    let steps: ReceiveSteps;
    try {
      steps = await loadReceiveSteps();
    } catch {
      // 読み込めなかった(通信が切れた直後の更新など)。次に選び直したときに、もう一度読み込む。
      receiveSteps = null;
      if (ctx.getState().dialog === waiting) {
        ctx.setState({ ...ctx.getState(), dialog: null });
      }
      ctx.showMessage({ kind: 'error', text: RECEIVE_LOAD_FAILED_MESSAGE });
      return;
    }
    if (ctx.getState().dialog !== waiting) {
      // 読み込みの間に、出しておいたダイアログが別のものになった(通常は起きない)。続けない。
      return;
    }
    await steps.openReceive(fileText);
  }

  /** パスワード欄の入力。描き直さない(描き直すと入力中のフォーカスが失われる)。 */
  function updateReceivePassword(password: string): void {
    const dialog = ctx.getState().dialog;
    if (dialog?.kind !== 'transferReceive' || dialog.phase !== 'password') {
      return;
    }
    ctx.setState({ ...ctx.getState(), dialog: { ...dialog, password, error: null } }, { render: false });
  }

  async function submitReceivePassword(): Promise<void> {
    await (await loadReceiveSteps()).submitReceivePassword();
  }

  async function confirmReceive(): Promise<void> {
    await (await loadReceiveSteps()).confirmReceive();
  }

  async function chooseConflict(choice: ConflictChoice): Promise<void> {
    await (await loadReceiveSteps()).chooseConflict(choice);
  }

  /**
   * 受け取りのダイアログが閉じた(main.ts の setState から呼ぶ)。復号した中身を捨てる。
   * まだ読み込んでいなければ、捨てるものも無い。
   */
  function discardReceive(): void {
    loadedReceiveSteps?.discardReceive();
  }

  /** 一覧の「⋯」(1人)・選択バー(選択中の全員)・設定のお役立ち地点(0人)、共通の入口。 */
  async function openSend(patientIds: string[], options: { spotsOnly?: boolean } = {}): Promise<void> {
    const spotsOnly = options.spotsOnly === true || patientIds.length === 0;
    const info = ctx.getSettingsInfo();
    const hasSharedSecret = info.hasSharedSecret;
    // 保存済みの合言葉が短ければ、そのまま自動で使わせず、入力を促す(パスワードの強さのため)。
    const sharedSecretShort = hasSharedSecret && info.sharedSecretShort;
    setDialog({
      kind: 'transferSend',
      patientIds: spotsOnly ? [] : patientIds,
      includePhotos: true,
      includeSpots: spotsOnly,
      useSharedSecret: hasSharedSecret && !sharedSecretShort,
      password: '',
      passwordConfirm: '',
      saveAsShared: false,
      phase: 'form',
      error: sharedSecretShort ? SHARED_SECRET_SHORT_MESSAGE : null,
      canShare: false,
      shared: false,
    });
  }

  /**
   * ダイアログの入力欄・チェックボックスの変更。基本は再描画しない(描き直すと、入力中の
   * パスワードのフォーカスが失われる)。ただし「事業所の合言葉を使う」の切り替えは、
   * パスワード欄を出す/引っ込めるという見た目の変化を伴うので、これだけは普通に再描画する。
   */
  function updateSendDraft(patch: SendDraftPatch): void {
    const dialog = ctx.getState().dialog;
    if (dialog?.kind !== 'transferSend') {
      return;
    }
    const next: TransferSendDialog = { ...dialog, ...patch, error: null };
    const mustRerender = Object.prototype.hasOwnProperty.call(patch, 'useSharedSecret');
    setDialog(next, mustRerender ? undefined : { render: false });
  }

  /** パスワードを決める(合言葉/入力のどちらか)。決められなければ、エラーを出してnullを返す。 */
  async function resolvePassword(dialog: TransferSendDialog): Promise<string | null> {
    if (dialog.useSharedSecret) {
      let shared: string | undefined;
      try {
        shared = await getMeta('sharedSecret');
      } catch {
        shared = undefined;
      }
      if (shared === undefined) {
        // 設定を開いた後に他の端末/タブで合言葉が消えた場合など、useSharedSecretは
        // 立っているのに実体が無いことがある。チェックを外し、画面をその実態に合わせたうえで、
        // 入力で送り直せるように促す(hasSharedSecretもfalseにして、設定画面などの表示も揃える)。
        ctx.setSettingsInfo({ ...ctx.getSettingsInfo(), hasSharedSecret: false });
        setDialog({ ...dialog, useSharedSecret: false, error: SHARED_SECRET_MISSING_MESSAGE });
        return null;
      }
      if (shared.length < MIN_PASSWORD_LENGTH) {
        // ダイアログを開いた後に(他の端末/タブで)短い合言葉に変わった場合など。
        // openSendと同じく、自動で使わせずチェックを外して入力を促す。
        ctx.setSettingsInfo({ ...ctx.getSettingsInfo(), sharedSecretShort: true });
        setDialog({ ...dialog, useSharedSecret: false, error: SHARED_SECRET_SHORT_MESSAGE });
        return null;
      }
      return shared;
    }
    if (dialog.password.length < MIN_PASSWORD_LENGTH) {
      setDialog({ ...dialog, error: PASSWORD_TOO_SHORT_MESSAGE });
      return null;
    }
    if (dialog.password !== dialog.passwordConfirm) {
      setDialog({ ...dialog, error: PASSWORD_MISMATCH_MESSAGE });
      return null;
    }
    return dialog.password;
  }

  async function submitSend(): Promise<void> {
    const dialog = ctx.getState().dialog;
    if (dialog?.kind !== 'transferSend' || dialog.phase !== 'form' || sending) {
      return;
    }
    // ここから最初のawait(resolvePasswordの合言葉読み込みなど)より前でも、連打の
    // 2回目がこのガードをすり抜けないよう、sendingは他のawaitを挟む前に立てる
    // (立てるのを後回しにすると、1回目がまだ最初のawaitに達する前に2回目の呼び出しが
    // 同じ同期区間でこのガードを通ってしまうことがある)。
    sending = true;
    try {
      const patients = dialog.patientIds
        .map((id) => ctx.getState().patients.find((patient) => patient.id === id))
        .filter((patient): patient is Patient => patient !== undefined);
      const spots = dialog.includeSpots ? [...ctx.getSpots()] : [];
      if (patients.length === 0 && spots.length === 0) {
        setDialog({ ...dialog, error: NOTHING_TO_SEND_MESSAGE });
        return;
      }

      const password = await resolvePassword(dialog);
      if (password === null) {
        return;
      }

      setDialog({ ...dialog, phase: 'working', error: null });
      let photos: { id: string; patientId: string; dataUrl: string; createdAt: string }[] | null = null;
      if (dialog.includePhotos) {
        const lists = await Promise.all(patients.map((patient) => listPhotos(patient.id)));
        photos = await Promise.all(
          lists.flat().map(async (photo) => ({
            id: photo.id,
            patientId: photo.patientId,
            dataUrl: await blobToDataUrl(photo.blob),
            createdAt: photo.createdAt,
          })),
        );
      }
      const { serializePayload } = await import('./transfer');
      const text = serializePayload({ sentAt: new Date().toISOString(), patients, photos, spots });
      // 暗号化(Web Crypto)はここでだけ使うので、送るときまで読み込みを遅らせて
      // ビルドの本体を軽くする(受け取る側だけを使う人にも読み込ませずに済む)。
      const { encryptText } = await import('./crypto');
      const encrypted = await encryptText(text, password);
      const filename = `訪問先の引き継ぎ_${dateKey(new Date())}.txt`;
      const file = new File([encrypted], filename, { type: 'text/plain' });

      const current = ctx.getState().dialog;
      if (current?.kind !== 'transferSend') {
        // 作っている間にダイアログが閉じられた(通常は起きないが、念のため)。
        return;
      }
      // 「LINEなどで送る」「ファイルを保存」(shareSendFile/saveSendFile)で使う。ここではまだ
      // 共有もダウンロードもしない(window.confirmはしないので、readyの画面で押させて初めて行う)。
      readyFile = file;
      readyPassword = password;
      setDialog({ ...current, phase: 'ready', canShare: canShareFile(file), error: null });
    } catch {
      const current = ctx.getState().dialog;
      if (current?.kind === 'transferSend') {
        setDialog({ ...current, phase: 'form', error: BUILD_FAILED_MESSAGE });
      }
    } finally {
      sending = false;
    }
  }

  /**
   * readyから共有/保存できた(取りやめではない)。saveAsSharedなら、合言葉として保存してから
   * doneにする(保存に失敗しても、送信自体は成功しているので下の成功表示は変えない)。
   */
  async function finishSend(result: 'shared' | 'downloaded'): Promise<void> {
    const dialog = ctx.getState().dialog;
    if (dialog?.kind !== 'transferSend') {
      return;
    }
    if (dialog.saveAsShared && readyPassword !== null) {
      try {
        await setMeta('sharedSecret', readyPassword);
        // 設定画面などが「合言葉が保存されている」を正しく反映できるよう、この場で伝える
        // (settingsInfoを読み直すまで待つと、次に送るダイアログを開いたときに
        // 「事業所の合言葉を使う」がまだ出ない、という食い違いが起きる)。
        // ここで保存するpasswordは、上のresolvePasswordでMIN_PASSWORD_LENGTH以上と
        // 確かめ済みなので、sharedSecretShortは常にfalseにしてよい。
        ctx.setSettingsInfo({ ...ctx.getSettingsInfo(), hasSharedSecret: true, sharedSecretShort: false });
      } catch {
        // 保存できなくても、送信自体は成功しているので、下の成功表示は変えない。
      }
    }
    const latest = ctx.getState().dialog;
    if (latest?.kind !== 'transferSend') {
      // 合言葉を保存している間にダイアログが閉じられた(通常は起きないが、念のため)。
      return;
    }
    // パスワードは送り終えたら画面に残さない(doneの後にもう一度送る場合は入力し直す)。
    setDialog({ ...latest, phase: 'done', shared: result === 'shared', error: null, password: '', passwordConfirm: '' });
  }

  /**
   * readyの「LINEなどで送る」。押した処理(クリックのイベントハンドラ)の中から、最初のawaitより
   * 前に直接呼ぶこと(shareFileが、そのまた最初のawaitより前にnavigator.shareを呼ぶ必要があるため)。
   * 取りやめ('cancelled')は ready のまま(もう一度押せる)。
   */
  function shareSendFile(): void {
    const dialog = ctx.getState().dialog;
    const file = readyFile;
    if (dialog?.kind !== 'transferSend' || dialog.phase !== 'ready' || file === null) {
      return;
    }
    void (async () => {
      const result = await shareFile(file);
      if (result === 'cancelled') {
        return;
      }
      if (result === 'failed') {
        downloadFile(file);
      }
      await finishSend(result === 'shared' ? 'shared' : 'downloaded');
    })();
  }

  /** readyの「ファイルを保存」(共有できない端末向け)。 */
  function saveSendFile(): void {
    const dialog = ctx.getState().dialog;
    const file = readyFile;
    if (dialog?.kind !== 'transferSend' || dialog.phase !== 'ready' || file === null) {
      return;
    }
    downloadFile(file);
    void finishSend('downloaded');
  }

  /** 送るダイアログが transferSend でなくなった(main.ts の setState から呼ぶ)。作ったファイルを捨てる。 */
  function discardSendFile(): void {
    readyFile = null;
    readyPassword = null;
  }

  return {
    openSend,
    updateSendDraft,
    submitSend,
    shareSendFile,
    saveSendFile,
    discardSendFile,
    openReceive,
    updateReceivePassword,
    submitReceivePassword,
    confirmReceive,
    chooseConflict,
    discardReceive,
  };
}
