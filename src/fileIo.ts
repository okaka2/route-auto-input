/** テキストをファイルとしてダウンロードさせる。 */
export function downloadTextFile(filename: string, text: string): void {
  downloadFile(new File([text], filename, { type: 'application/json' }));
}

/** 与えたFileを、<a download>でダウンロードさせる(object URLの後片付けも行う)。 */
function downloadFile(file: File): void {
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
