import type { AppContext } from './appContext';
import { parseBackup, serializeBackup } from './backup';
import {
  deleteOrphanPhotos,
  listAllPhotos,
  listPatients,
  mergePatients,
  mergePhotosCapped,
  putSpots,
  replaceAllPatients,
  replacePhotosFor,
  setMeta,
} from './db';
import { downloadTextFile, readTextFile } from './fileIo';
import { blobToDataUrl, dataUrlToBlob } from './photoCodec';
import type { Photo } from './types';

/** インポートの確認に出す「(写真M枚・お役立ち地点K件)」。0件の部分は書かず、両方0なら空文字。 */
function backupExtrasLabel(photoCount: number, spotCount: number): string {
  const parts: string[] = [];
  if (photoCount > 0) {
    parts.push(`写真${photoCount}枚`);
  }
  if (spotCount > 0) {
    parts.push(`お役立ち地点${spotCount}件`);
  }
  return parts.length > 0 ? `(${parts.join('・')})` : '';
}

/**
 * バックアップの書き出し・読み込みの流れ。main.ts が持つ状態は AppContext 経由でしか触らない
 * (main.ts側で1つだけ作って渡す)。hooks.onTransferFile は今は使わない(Task 6が使う)。
 */
export function createBackupFlow(
  ctx: AppContext,
  hooks: { onTransferFile?(text: string): void } = {},
): {
  handleExport(includePhotos?: boolean): Promise<void>;
  handleImport(file: File, mode: 'replace' | 'merge'): Promise<void>;
} {
  async function handleExport(includePhotos = true): Promise<void> {
    try {
      const photos = includePhotos
        ? await Promise.all(
            (await listAllPhotos()).map(async (photo) => ({
              id: photo.id,
              patientId: photo.patientId,
              dataUrl: await blobToDataUrl(photo.blob),
              createdAt: photo.createdAt,
            })),
          )
        : null;
      const date = new Date().toISOString().slice(0, 10);
      const routeContext = ctx.getRouteContext();
      downloadTextFile(
        `route-auto-input-${date}.json`,
        serializeBackup({
          patients: ctx.getState().patients,
          photos,
          spots: [...ctx.getSpots()],
          meta: { office: routeContext.office ?? undefined, routeEnds: routeContext.ends },
        }),
      );
    } catch {
      ctx.showMessage({ kind: 'error', text: 'バックアップを書き出せませんでした。' });
      return;
    }
    // 最後にバックアップした日時の記録は付随的なもの。ここが失敗しても、
    // ファイルの書き出し自体は成功しているので、成功として扱う(lastBackupAtは更新しない)。
    try {
      const lastBackupAt = new Date().toISOString();
      await setMeta('lastBackupAt', lastBackupAt);
      ctx.setSettingsInfo({ ...ctx.getSettingsInfo(), lastBackupAt });
    } catch {
      // 記録できなかっただけ。書き出し自体は成功しているので、下のメッセージは変えない。
    }
    ctx.showMessage({ kind: 'info', text: 'バックアップを書き出しました。' });
  }

  async function handleImport(file: File, mode: 'replace' | 'merge'): Promise<void> {
    let writeStarted = false;
    try {
      const content = parseBackup(await readTextFile(file));

      // 書き込みを始める前に、写真を1枚ずつ全部デコードしておく(dataUrlToBlobは形が
      // 正しくてもbase64の中身が壊れていれば例外を投げる)。ここで1枚でも壊れていれば、
      // 訪問先の入れ替え・追加より前に中断して、何も変えない。
      let decodedPhotos: Photo[] | null;
      try {
        decodedPhotos =
          content.photos === null
            ? null
            : content.photos.map((photo) => ({
                id: photo.id,
                patientId: photo.patientId,
                blob: dataUrlToBlob(photo.dataUrl),
                createdAt: photo.createdAt,
              }));
      } catch {
        ctx.showMessage({ kind: 'error', text: 'バックアップのファイルの写真が壊れています。' });
        return;
      }

      // 確認の件数は、実際に取り込まれる訪問先に属する写真だけを数える
      // (入れ替えならファイルの訪問先だけ、追加ならファイル+今の訪問先)。
      const currentPatients = ctx.getState().patients;
      const fileIds = new Set(content.patients.map((patient) => patient.id));
      const countedIds =
        mode === 'replace' ? fileIds : new Set([...fileIds, ...currentPatients.map((patient) => patient.id)]);
      const photoCount = decodedPhotos?.filter((photo) => countedIds.has(photo.patientId)).length ?? 0;
      const extras = backupExtrasLabel(photoCount, content.spots.length);
      const question =
        mode === 'replace'
          ? `今のデータ${currentPatients.length}件を消して、${content.patients.length}件${extras}を取り込みます。よろしいですか?`
          : `${content.patients.length}件${extras}を今のデータに追加します。よろしいですか?`;
      if (!ctx.confirm(question)) {
        return;
      }

      writeStarted = true;
      if (mode === 'replace') {
        await replaceAllPatients(content.patients);
      } else {
        await mergePatients(content.patients);
      }
      // 写真がnullのとき(書き出す側で外した、または旧version 1のバックアップ)は、
      // 既存の写真に一切触れない(消さない)。
      if (decodedPhotos !== null) {
        if (mode === 'replace') {
          // putPhotosは同じidだけ上書きするので、ファイルの写真のidが既存と違うと
          // 上限(MAX_PHOTOS_PER_PATIENT)を超えて残ってしまう。入れ替えでは、
          // ファイルに含まれる訪問先ぶんの写真をいったんすべて消してから入れる。
          await replacePhotosFor([...fileIds], decodedPhotos);
        } else {
          // 追加では、既存の写真を残したまま、訪問先ごとの上限を超えないぶんだけ足す。
          await mergePhotosCapped(decodedPhotos);
        }
      }
      await putSpots(content.spots);
      if (content.meta.office !== undefined) {
        const office = content.meta.office;
        await setMeta('office', office);
        ctx.setRouteContext({ ...ctx.getRouteContext(), office });
        ctx.setSettingsInfo({ ...ctx.getSettingsInfo(), office });
      }
      if (content.meta.routeEnds !== undefined) {
        const routeEnds = content.meta.routeEnds;
        await setMeta('routeEnds', routeEnds);
        ctx.setRouteContext({ ...ctx.getRouteContext(), ends: routeEnds });
      }
      ctx.clearOpenedRoutes();
      const importedPatients = await listPatients();
      await deleteOrphanPhotos(new Set(importedPatients.map((patient) => patient.id)));
      await ctx.loadSpots();
      await ctx.loadPhotoCounts();
      await ctx.loadPhotoBytes();
      await ctx.reloadPatients({ kind: 'info', text: `${content.patients.length}件を取り込みました。` });
    } catch (error) {
      if (writeStarted) {
        // 訪問先の入れ替え・追加が始まったあとに失敗した場合、DBには一部だけ書き込まれている
        // ことがあるので、画面をその実際の状態に合わせ直す(訪問先・地点・写真の件数/サイズ)。
        // このerrorはDBやブラウザAPIの技術的な例外であることがあり、そのまま出すと
        // 利用者に見せてよくない内容(英語のエラーメッセージなど)を出しかねないので、
        // 汎用の案内文にする(Minor 9)。
        await ctx.loadSpots();
        await ctx.loadPhotoCounts();
        await ctx.loadPhotoBytes();
        await ctx.reloadPatients({ kind: 'error', text: '取り込みの途中で失敗しました。画面を最新の内容に合わせました。' });
      } else {
        const message = error instanceof Error ? error.message : 'データを取り込めませんでした。';
        ctx.showMessage({ kind: 'error', text: message });
      }
    }
  }

  // hooksは今は使わない(Task 6が暗号化された引き継ぎファイルをここへ回す)。
  void hooks;

  return { handleExport, handleImport };
}
