import type { AppContext } from './appContext';
import { MIN_PASSWORD_LENGTH } from './config';
import { getMeta, listPhotos, setMeta } from './db';
import { shareOrDownloadFile } from './fileIo';
import { dateKey } from './history';
import { blobToDataUrl } from './photoCodec';
import { serializePayload } from './transfer';
import type { Patient, TransferSendDialog } from './types';

type SendDraftPatch = Partial<
  Pick<
    TransferSendDialog,
    'includePhotos' | 'includeSpots' | 'useSharedSecret' | 'password' | 'passwordConfirm' | 'saveAsShared'
  >
>;

const CONFIRM_MESSAGE = '名前・住所・写真などが相手に渡ります。送りますか?';
const NOTHING_TO_SEND_MESSAGE = '送るものがありません。';
const BUILD_FAILED_MESSAGE = '送るファイルを作れませんでした。';
const PASSWORD_TOO_SHORT_MESSAGE = `パスワードは${MIN_PASSWORD_LENGTH}文字以上にしてください。`;
const PASSWORD_MISMATCH_MESSAGE = '確認のパスワードが一致しません。';

/**
 * 「送る」の入口(一覧の「⋯」・選択バー・設定のお役立ち地点)からダイアログを開き、
 * パスワードで暗号化したファイルを共有/ダウンロードするまでの流れ。main.ts が持つ状態は
 * AppContext 経由でしか触らない(backupFlow.ts と同じやり方。main.ts側で1つだけ作って渡す)。
 */
export function createTransferFlow(ctx: AppContext): {
  openSend(patientIds: string[], options?: { spotsOnly?: boolean }): Promise<void>;
  updateSendDraft(patch: SendDraftPatch): void;
  submitSend(): Promise<void>;
} {
  // 二重押し防止(送信中に「送る」を連打しても、ファイルを二重に作らない)。
  let sending = false;

  function setDialog(next: TransferSendDialog, options?: { render?: boolean }): void {
    ctx.setState({ ...ctx.getState(), dialog: next }, options);
  }

  /** 一覧の「⋯」(1人)・選択バー(選択中の全員)・設定のお役立ち地点(0人)、共通の入口。 */
  async function openSend(patientIds: string[], options: { spotsOnly?: boolean } = {}): Promise<void> {
    const spotsOnly = options.spotsOnly === true || patientIds.length === 0;
    const hasSharedSecret = ctx.getSettingsInfo().hasSharedSecret;
    setDialog({
      kind: 'transferSend',
      patientIds: spotsOnly ? [] : patientIds,
      includePhotos: true,
      includeSpots: spotsOnly,
      useSharedSecret: hasSharedSecret,
      password: '',
      passwordConfirm: '',
      saveAsShared: false,
      phase: 'form',
      error: null,
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
        setDialog({ ...dialog, error: BUILD_FAILED_MESSAGE });
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

      if (!ctx.confirm(CONFIRM_MESSAGE)) {
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
      const text = serializePayload({ sentAt: new Date().toISOString(), patients, photos, spots });
      // 暗号化(Web Crypto)はここでだけ使うので、送るときまで読み込みを遅らせて
      // ビルドの本体を軽くする(受け取る側だけを使う人にも読み込ませずに済む)。
      const { encryptText } = await import('./crypto');
      const encrypted = await encryptText(text, password);
      const filename = `訪問先の引き継ぎ_${dateKey(new Date())}.txt`;
      const file = new File([encrypted], filename, { type: 'text/plain' });
      const result = await shareOrDownloadFile(file);

      const current = ctx.getState().dialog;
      if (current?.kind !== 'transferSend') {
        // 送っている間にダイアログが閉じられた(通常は起きないが、念のため)。
        return;
      }
      if (result === 'cancelled') {
        setDialog({ ...current, phase: 'form' });
        return;
      }
      if (dialog.saveAsShared) {
        try {
          await setMeta('sharedSecret', password);
        } catch {
          // 保存できなくても、送信自体は成功しているので、下の成功表示は変えない。
        }
      }
      setDialog({ ...current, phase: 'done', shared: result === 'shared', error: null });
    } catch {
      const current = ctx.getState().dialog;
      if (current?.kind === 'transferSend') {
        setDialog({ ...current, phase: 'form', error: BUILD_FAILED_MESSAGE });
      }
    } finally {
      sending = false;
    }
  }

  return { openSend, updateSendDraft, submitSend };
}
