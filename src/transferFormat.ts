/**
 * 引き継ぎファイルの目印と、その見分け方(と、受け取りを読み込めなかったときの文)だけを置く小さなモジュール。
 * 暗号化・復号(crypto.ts)は使うときだけ import() で読み込む別チャンクにしたいので、
 * 「読み込む」で普通のバックアップと見分けるためのこの部分は、crypto.ts から切り離してある
 * (backupFlow.ts がここを直接読み込んでも、crypto.ts が本体に入らないように)。
 */

export const TRANSFER_FORMAT = 'houmon-transfer';

/**
 * 受け取りに使うコード(transferReceive.ts・crypto.ts。どちらも使うときだけ読み込む別チャンク)を
 * 読み込めなかったときの文。本体(transferFlow.ts)と受け取りの流れ(transferReceive.ts)の両方で
 * 使うので、どちらのチャンクにも入れずに済むここに置く。
 */
export const RECEIVE_LOAD_FAILED_MESSAGE = '引き継ぎのファイルを開けませんでした。';

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
