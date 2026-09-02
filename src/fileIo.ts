/** テキストをファイルとしてダウンロードさせる。 */
export function downloadTextFile(filename: string, text: string): void {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
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
