/**
 * 受け取り(設定の「読み込む」で引き継ぎのファイルを選んだとき)の、パスワード → 確認 →
 * 同じ人ごとの選択 → 取り込み、の流れ。アプリを開いただけでは使わないので、
 * transferFlow.ts から import() で使うときだけ読み込む(本体を軽くするため)。
 * main.ts が持つ状態は AppContext 経由でしか触らない。
 */
import type { AppContext } from './appContext';
import { getMeta, mergePatients, putSpots, replacePhotosFor } from './db';
import { dataUrlToBlob } from './photoCodec';
import { describeRecipients } from './recipients';
import {
  findConflicts,
  parsePayload,
  planImport,
  type Conflict,
  type ConflictChoice,
  type TransferPayload,
} from './transfer';
import type { Patient, Photo, TransferReceiveDialog } from './types';

const RECEIVE_PASSWORD_EMPTY_MESSAGE = 'パスワードを入れてください。';
const RECEIVE_WRONG_PASSWORD_MESSAGE = 'パスワードが違うか、ファイルが壊れています。何度でもやり直せます。';
const RECEIVE_BROKEN_PHOTO_MESSAGE = '引き継ぎのファイルの写真が壊れています。';
const RECEIVE_NOTHING_MESSAGE = 'このファイルには追加するものがありません。';
const RECEIVE_PARSE_FAILED_MESSAGE = '引き継ぎのファイルの中身を読めませんでした。';
const RECEIVE_IMPORT_FAILED_MESSAGE = '取り込めませんでした。';
const RECEIVE_NOTHING_ADDED_MESSAGE = '追加したものはありません。';

/**
 * 復号して読み取った受け取りの中身。state には置かず、createReceiveSteps の中だけに持つ
 * (受け取りのダイアログが閉じたら discardReceive で捨てる)。
 */
type ReceivedData = {
  payload: TransferPayload;
  /** 写真を含めないファイルなら null。含めていれば、全部 Blob にしたもの。 */
  photos: Photo[] | null;
  /** 確認で「追加する」を押したときの手元の訪問先(同じ人の突き合わせと取り込みで、同じものを使う)。 */
  existing: Patient[];
  conflicts: Conflict[];
  /** 送られてきた人の id → 同じ人の画面で選んだこと。 */
  choices: Map<string, ConflictChoice>;
};

/** 復号して読み取った直後の中身(まだ同じ人を突き合わせていない)。 */
type DecodedReceive = Pick<ReceivedData, 'payload' | 'photos'>;

/** 確認の文「山田 太郎様ほか2人・お役立ち地点1件」。 */
function receiveSummary(payload: TransferPayload): string {
  const parts: string[] = [];
  if (payload.patients.length > 0) {
    parts.push(describeRecipients(payload.patients));
  }
  if (payload.spots.length > 0) {
    parts.push(`お役立ち地点${payload.spots.length}件`);
  }
  return parts.join('・');
}

/** 取り込み後の文「2人とお役立ち地点1件を追加し、1人を上書きしました。」(0の部分は書かない)。 */
function receiveResult(added: number, overwritten: number, spots: number): string {
  const addedParts: string[] = [];
  if (added > 0) {
    addedParts.push(`${added}人`);
  }
  if (spots > 0) {
    addedParts.push(`お役立ち地点${spots}件`);
  }
  const clauses: string[] = [];
  if (addedParts.length > 0) {
    clauses.push(`${addedParts.join('と')}を追加`);
  }
  if (overwritten > 0) {
    clauses.push(`${overwritten}人を上書き`);
  }
  return clauses.length === 0 ? RECEIVE_NOTHING_ADDED_MESSAGE : `${clauses.join('し、')}しました。`;
}

/**
 * 復号した文字列を読み取り、写真を全部 Blob にする。書き込みを始める前に、ここで
 * 1枚でも壊れていれば中断する(backupFlow.ts と同じ決まり)。問題があれば、出す文を返す。
 */
function readReceived(plain: string): { data: DecodedReceive } | { error: string } {
  let payload: TransferPayload;
  try {
    payload = parsePayload(plain);
  } catch {
    return { error: RECEIVE_PARSE_FAILED_MESSAGE };
  }
  if (payload.patients.length === 0 && payload.spots.length === 0) {
    return { error: RECEIVE_NOTHING_MESSAGE };
  }
  let photos: Photo[] | null;
  try {
    photos =
      payload.photos === null
        ? null
        : payload.photos.map((photo) => ({
            id: photo.id,
            patientId: photo.patientId,
            blob: dataUrlToBlob(photo.dataUrl),
            createdAt: photo.createdAt,
          }));
  } catch {
    return { error: RECEIVE_BROKEN_PHOTO_MESSAGE };
  }
  return { data: { payload, photos } };
}

export type ReceiveSteps = {
  openReceive(fileText: string): Promise<void>;
  submitReceivePassword(): Promise<void>;
  confirmReceive(): Promise<void>;
  chooseConflict(choice: ConflictChoice): Promise<void>;
  discardReceive(): void;
};

/** 受け取りの流れを作る。transferFlow.ts が1つの flow につき1回だけ作る(中身と世代をここに持つ)。 */
export function createReceiveSteps(ctx: AppContext): ReceiveSteps {
  // 受け取りの中身(復号・読み取り済み)。受け取りのダイアログが閉じたら捨てる。
  let received: ReceivedData | null = null;
  // 受け取りを開き直す/閉じるたびに増やす。復号(時間がかかる)などの await の間に
  // ダイアログが閉じられたり、別のファイルで開き直されたりしたら、古い続きは何もしない。
  let receiveGeneration = 0;

  function setDialog(next: TransferReceiveDialog): void {
    ctx.setState({ ...ctx.getState(), dialog: next });
  }

  /** 今開いている受け取りのダイアログ。generation が違う(閉じた・開き直した)なら null。 */
  function currentReceive(generation: number): TransferReceiveDialog | null {
    const dialog = ctx.getState().dialog;
    if (generation !== receiveGeneration || dialog?.kind !== 'transferReceive') {
      return null;
    }
    return dialog;
  }

  /** パスワードで復号して読み取る。パスワード違いなら 'wrong'、中身に問題があればその文。 */
  async function decryptAndRead(
    fileText: string,
    password: string,
  ): Promise<{ data: DecodedReceive } | { error: string } | 'wrong'> {
    // 復号(Web Crypto)は、送る側と同じく別に分けたものを、ここで初めて読み込む。
    const { decryptText } = await import('./crypto');
    let plain: string;
    try {
      plain = await decryptText(fileText, password);
    } catch {
      return 'wrong';
    }
    return readReceived(plain);
  }

  /** 復号・読み取りに成功したので、中身を持って確認の画面へ進む。 */
  function showConfirm(dialog: TransferReceiveDialog, data: DecodedReceive): void {
    received = { ...data, existing: [], conflicts: [], choices: new Map() };
    setDialog({ ...dialog, phase: 'confirm', password: '', error: null, summary: receiveSummary(data.payload) });
  }

  /**
   * 読み込むで引き継ぎのファイルを選んだときの入口。事業所の合言葉が保存されていれば
   * 先にそれで開いてみて、開ければパスワードの画面を飛ばして確認へ進む。開けなければ
   * (別の合言葉で作られたファイルなど)、エラーは出さずにパスワードの画面にする。
   */
  async function openReceive(fileText: string): Promise<void> {
    receiveGeneration += 1;
    const generation = receiveGeneration;
    received = null;
    const base: TransferReceiveDialog = {
      kind: 'transferReceive',
      fileText,
      phase: 'password',
      password: '',
      error: null,
      summary: '',
      conflictIndex: 0,
      conflicts: [],
      result: null,
    };

    let shared: string | undefined;
    try {
      shared = await getMeta('sharedSecret');
    } catch {
      shared = undefined;
    }
    if (generation !== receiveGeneration) {
      return;
    }
    if (shared === undefined) {
      setDialog(base);
      return;
    }

    // 復号(PBKDF2)には少し時間がかかるので、その間は「少しお待ちください」を出す。
    setDialog({ ...base, phase: 'working' });
    let outcome: Awaited<ReturnType<typeof decryptAndRead>>;
    try {
      outcome = await decryptAndRead(fileText, shared);
    } catch {
      outcome = 'wrong';
    }
    const current = currentReceive(generation);
    if (current === null) {
      return;
    }
    if (outcome === 'wrong') {
      setDialog({ ...current, phase: 'password', error: null });
      return;
    }
    if ('error' in outcome) {
      setDialog({ ...current, phase: 'password', error: outcome.error });
      return;
    }
    showConfirm(current, outcome.data);
  }

  async function submitReceivePassword(): Promise<void> {
    const dialog = ctx.getState().dialog;
    if (dialog?.kind !== 'transferReceive' || dialog.phase !== 'password') {
      return;
    }
    const password = dialog.password;
    if (password === '') {
      setDialog({ ...dialog, error: RECEIVE_PASSWORD_EMPTY_MESSAGE });
      return;
    }
    const generation = receiveGeneration;
    // パスワードの画面を離れるので、打ったパスワードは state から消す(違っていたら入れ直してもらう)。
    setDialog({ ...dialog, phase: 'working', password: '', error: null });
    let outcome: Awaited<ReturnType<typeof decryptAndRead>>;
    try {
      outcome = await decryptAndRead(dialog.fileText, password);
    } catch {
      outcome = 'wrong';
    }
    const current = currentReceive(generation);
    if (current === null) {
      return;
    }
    if (outcome === 'wrong') {
      setDialog({ ...current, phase: 'password', error: RECEIVE_WRONG_PASSWORD_MESSAGE });
      return;
    }
    if ('error' in outcome) {
      setDialog({ ...current, phase: 'password', error: outcome.error });
      return;
    }
    showConfirm(current, outcome.data);
  }

  /** 確認で「追加する」。同じ人がいれば1人ずつ聞き、いなければそのまま取り込む。 */
  async function confirmReceive(): Promise<void> {
    const dialog = ctx.getState().dialog;
    if (dialog?.kind !== 'transferReceive' || dialog.phase !== 'confirm' || received === null) {
      return;
    }
    const existing = [...ctx.getState().patients];
    const { conflicts } = findConflicts(received.payload.patients, existing);
    received = { ...received, existing, conflicts, choices: new Map() };
    if (conflicts.length === 0) {
      await runImport(dialog);
      return;
    }
    setDialog({
      ...dialog,
      phase: 'conflict',
      error: null,
      conflictIndex: 0,
      conflicts: conflicts.map((conflict) => ({
        incomingName: conflict.incoming.name,
        incomingAddress: conflict.incoming.address,
        existingName: conflict.existing.name,
        existingAddress: conflict.existing.address,
      })),
    });
  }

  /** 同じ人の画面で1人ぶん選んだ。最後の人のあとで取り込む。 */
  async function chooseConflict(choice: ConflictChoice): Promise<void> {
    const dialog = ctx.getState().dialog;
    if (dialog?.kind !== 'transferReceive' || dialog.phase !== 'conflict' || received === null) {
      return;
    }
    const conflict = received.conflicts[dialog.conflictIndex];
    if (conflict === undefined) {
      return;
    }
    received.choices.set(conflict.incoming.id, choice);
    const nextIndex = dialog.conflictIndex + 1;
    if (nextIndex < received.conflicts.length) {
      setDialog({ ...dialog, conflictIndex: nextIndex });
      return;
    }
    await runImport(dialog);
  }

  /**
   * 取り込み: planImport → 訪問先 → 写真(含むファイルで、送られてきた写真がある人だけ)→
   * お役立ち地点 → 画面の読み直し。書き始めてから失敗したら、画面をDBの実際の状態に合わせ直す。
   */
  async function runImport(dialog: TransferReceiveDialog): Promise<void> {
    const data = received;
    if (data === null) {
      return;
    }
    const generation = receiveGeneration;
    // 連打で二重に取り込まないよう、最初の await より前に working にする。
    setDialog({ ...dialog, phase: 'working', error: null });
    let writeStarted = false;
    try {
      const plan = planImport(
        data.payload,
        data.photos,
        data.existing,
        new Set(ctx.getSpots().map((spot) => spot.id)),
        data.choices,
        () => crypto.randomUUID(),
        new Date(),
      );
      const existingIds = new Set(data.existing.map((patient) => patient.id));
      const overwritten = plan.put.filter((patient) => existingIds.has(patient.id)).length;
      const added = plan.put.length - overwritten;

      writeStarted = true;
      await mergePatients(plan.put);
      for (const [patientId, photos] of plan.photosByPatient) {
        await replacePhotosFor([patientId], photos);
      }
      await putSpots(plan.spots);
      if (overwritten > 0) {
        // 上書きで住所などが変わると、開いたルートの印は古くなる(backupFlow.ts と同じ扱い)。
        ctx.clearOpenedRoutes();
      }
      // 取り込み終わったら、復号した中身はもう要らない。
      received = null;
      await ctx.loadSpots();
      await ctx.loadPhotoCounts();
      await ctx.loadPhotoBytes();
      await ctx.reloadPatients();
      const current = currentReceive(generation);
      if (current !== null) {
        setDialog({ ...current, phase: 'done', error: null, result: receiveResult(added, overwritten, plan.spots.length) });
      }
    } catch {
      if (writeStarted) {
        // DBには一部だけ書き込まれていることがあるので、画面をその実際の状態に合わせ直す。
        try {
          await ctx.loadSpots();
          await ctx.loadPhotoCounts();
          await ctx.loadPhotoBytes();
          await ctx.reloadPatients();
        } catch {
          // 読み直しにも失敗した。下の案内だけは出す。
        }
      }
      received = null;
      const current = currentReceive(generation);
      if (current !== null) {
        setDialog({ ...current, phase: 'done', error: RECEIVE_IMPORT_FAILED_MESSAGE, result: null });
      }
    }
  }

  /** 受け取りのダイアログが閉じた(main.ts の setState から呼ぶ)。復号した中身を捨てる。 */
  function discardReceive(): void {
    receiveGeneration += 1;
    received = null;
  }

  return { openReceive, submitReceivePassword, confirmReceive, chooseConflict, discardReceive };
}
