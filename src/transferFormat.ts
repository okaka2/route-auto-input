/**
 * 引き継ぎファイルの目印と、その見分け方だけを置く小さなモジュール。
 * 暗号化・復号(crypto.ts)は使うときだけ import() で読み込む別チャンクにしたいので、
 * 「読み込む」で普通のバックアップと見分けるためのこの部分は、crypto.ts から切り離してある
 * (backupFlow.ts がここを直接読み込んでも、crypto.ts が本体に入らないように)。
 */

export const TRANSFER_FORMAT = 'houmon-transfer';

/** 文字列が、引き継ぎファイルの形(JSONでformatが一致)かどうかを調べる。 */
export function isEncryptedFileText(text: string): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return false;
  }
  return (
    typeof parsed === 'object' && parsed !== null && (parsed as { format?: unknown }).format === TRANSFER_FORMAT
  );
}
