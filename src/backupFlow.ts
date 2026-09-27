import type { AppContext } from './appContext';
import {
  mergeConfirmText,
  mergeDoneText,
  mergeNothingText,
  parseBackup,
  planBackupMerge,
  planBackupReplace,
  serializeBackup,
  type LocalSnapshot,
} from './backup';
import { applyImport, getMeta, listAllPhotos, listPatients, listSpots, setMeta } from './db';
import { downloadTextFile, readTextFile } from './fileIo';
import { blobToDataUrl, dataUrlToBlob } from './photoCodec';
import { isEncryptedFileText } from './transferFormat';
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
 * (main.ts側で1つだけ作って渡す)。読み込んだファイルが引き継ぎのファイル(パスワード付き)なら、
 * バックアップとしては読まずに hooks.onTransferFile へ渡す(受け取りの流れは transferFlow.ts)。
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
      const text = await readTextFile(file);
      // 引き継ぎのファイルなら、受け取りの流れに任せる。入れ替え/追加の選択は使わない
      // (引き継ぎは、いつも今のデータへの追加。「入れ替え」を選んでいても手元のデータは消さない)。
      if (isEncryptedFileText(text)) {
        hooks.onTransferFile?.(text);
        return;
      }
      const content = parseBackup(text);

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

      if (mode === 'replace') {
        // 確認の写真枚数は、入れ替え後に実際に残る(=ファイルの訪問先ぶんの)写真だけを数える。
        const fileIds = new Set(content.patients.map((patient) => patient.id));
        const photoCount = decodedPhotos?.filter((photo) => fileIds.has(photo.patientId)).length ?? 0;
        const extras = backupExtrasLabel(photoCount, content.spots.length);
        const currentPatients = ctx.getState().patients;
        const question = `今のデータ${currentPatients.length}件を消して、${content.patients.length}件${extras}を取り込みます。よろしいですか?`;
        if (!ctx.confirm(question)) {
          return;
        }

        writeStarted = true;
        // 訪問先・写真・地点・meta を1つのトランザクションで書く(applyImportが名簿に
        // 無くなった写真も同じ中で消す)。書き込みが成功してから、まとめて画面の状態に反映する。
        await applyImport(planBackupReplace(content, decodedPhotos));
        if (content.meta.office !== undefined) {
          const office = content.meta.office;
          ctx.setRouteContext({ ...ctx.getRouteContext(), office });
          ctx.setSettingsInfo({ ...ctx.getSettingsInfo(), office });
        }
        if (content.meta.routeEnds !== undefined) {
          ctx.setRouteContext({ ...ctx.getRouteContext(), ends: content.meta.routeEnds });
        }
        ctx.clearOpenedRoutes();
        await ctx.loadSpots();
        await ctx.loadPhotoCounts();
        await ctx.loadPhotoBytes();
        await ctx.reloadPatients({ kind: 'info', text: `${content.patients.length}件を取り込みました。` });
        return;
      }

      // 追加(merge): 手元の様子は画面の state ではなく、いま実際にDBにある内容から読む。
      // 手元に同じidの人・地点がいれば、その人は一切書き換えない(いない人だけ足す)。
      const local: LocalSnapshot = {
        patientIds: new Set((await listPatients()).map((patient) => patient.id)),
        spotIds: new Set((await listSpots()).map((spot) => spot.id)),
        hasOffice: (await getMeta('office')) !== undefined,
        hasRouteEnds: (await getMeta('routeEnds')) !== undefined,
      };
      const plan = planBackupMerge(content, decodedPhotos, local);

      if (plan.added === 0) {
        // 足す人が1人もいなければ、確認を出さず何も書き込まない。
        ctx.showMessage({ kind: 'info', text: mergeNothingText(plan.kept) });
        return;
      }
      if (!ctx.confirm(mergeConfirmText(plan.added, plan.kept))) {
        return;
      }

      writeStarted = true;
      // 訪問先(新しい人だけ)・写真・地点・meta を1つのトランザクションで書く。
      await applyImport(plan.write);
      if (plan.write.meta.office !== undefined) {
        const office = plan.write.meta.office;
        ctx.setRouteContext({ ...ctx.getRouteContext(), office });
        ctx.setSettingsInfo({ ...ctx.getSettingsInfo(), office });
      }
      if (plan.write.meta.routeEnds !== undefined) {
        ctx.setRouteContext({ ...ctx.getRouteContext(), ends: plan.write.meta.routeEnds });
      }
      ctx.clearOpenedRoutes();
      await ctx.loadSpots();
      await ctx.loadPhotoCounts();
      await ctx.loadPhotoBytes();
      await ctx.reloadPatients({ kind: 'info', text: mergeDoneText(plan.added, plan.spotsAdded) });
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

  return { handleExport, handleImport };
}
