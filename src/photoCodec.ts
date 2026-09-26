/** 写真のBlobを、バックアップのJSONに書けるdata URLの文字列に変換する。 */
export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error('写真を読み込めませんでした。'));
    reader.readAsDataURL(blob);
  });
}

const DATA_URL_PATTERN = /^data:([^;,]*);base64,(.*)$/s;

/** data URL(`data:<type>;base64,...`)を写真のBlobに戻す。形が違えば例外を投げる。 */
export function dataUrlToBlob(dataUrl: string): Blob {
  const match = DATA_URL_PATTERN.exec(dataUrl);
  if (!match) {
    throw new Error('写真のデータが壊れています。');
  }
  const [, type, base64] = match;
  let binary: string;
  try {
    binary = atob(base64 ?? '');
  } catch {
    throw new Error('写真のデータが壊れています。');
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type });
}
