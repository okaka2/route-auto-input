import type { InstallPlatform } from './platform';

/** navigator.canShare が使えて、このFileを共有できるか。 */
export function canShareFile(file: File): boolean {
  return typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] });
}

/**
 * 共有メニューでFileを共有する。押した処理(クリックのイベントハンドラ)の中から、
 * 最初のawaitより前に直接呼ぶこと(iOSなどでは、ユーザー操作から間を置かずに
 * navigator.share を呼ばないと使えないため)。取りやめ(AbortError)は 'cancelled'、
 * それ以外の失敗は 'failed'(呼び出し側でダウンロードにフォールバックする)。
 */
export async function shareFile(file: File): Promise<'shared' | 'cancelled' | 'failed'> {
  try {
    await navigator.share({ files: [file] });
    return 'shared';
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return 'cancelled';
    }
    return 'failed';
  }
}

/** 与えたFileを、<a download>でダウンロードさせる(object URLの後片付けも行う)。 */
export function downloadFile(file: File): void {
  const url = URL.createObjectURL(file);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = file.name;
  document.body.append(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    // iOS Safari では click と同じタックで revoke するとダウンロードを
    // 取りこぼすことがあるため、次のタックまで遅らせる。
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

export function readTextFile(file: File): Promise<string> {
  return file.text();
}

/** 共有メニュー(files)が使えれば共有し、使えなければダウンロードする。取りやめたら 'cancelled'。 */
export async function shareOrDownloadFile(file: File): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const canShareFiles =
    typeof navigator.canShare === 'function' &&
    typeof navigator.share === 'function' &&
    navigator.canShare({ files: [file] });
  if (canShareFiles) {
    try {
      await navigator.share({ files: [file] });
      return 'shared';
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return 'cancelled';
      }
      // 共有に失敗した(端末側のそのほかの理由)ときは、ダウンロードにフォールバックする。
    }
  }
  downloadFile(file);
  return 'downloaded';
}

/** ダウンロードしたファイルの保存先を伝える案内(共有できない端末で、送る/バックアップの小窓に出す)。 */
export function downloadLocationHint(platform: InstallPlatform): string {
  switch (platform) {
    case 'ios':
      return 'ファイルは「ファイル」アプリの「ダウンロード」に入ります。';
    case 'android':
      return 'ファイルは「ダウンロード」に入ります。';
    default:
      return 'ファイルはダウンロードのフォルダに入ります。';
  }
}
