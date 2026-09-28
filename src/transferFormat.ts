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

/**
 * 見分けに使う先頭だけの長さ。encryptText(crypto.ts)が出す引き継ぎファイルは
 * `{"format":"houmon-transfer",...` で必ず始まる(formatが先頭のキー)ので、
 * 全体を読まなくても先頭のこれだけ見れば十分。
 */
const HEAD_SCAN_LENGTH = 200;

/**
 * 先頭が `{`(BOM・空白はあってもよい)で始まり、"format" キーの値が
 * "houmon-transfer" であることを表す形。encryptText がそのまま JSON.stringify した
 * 出力(キーの間に空白なし)にも、整形して書き出した場合(キーの間に改行・空白あり)にも合う。
 */
const TRANSFER_HEAD_PATTERN = /^\uFEFF?\s*\{\s*"format"\s*:\s*"houmon-transfer"/;

/**
 * 文字列が、引き継ぎファイルの形(JSONでformatが一致)かどうかを調べる。
 * バックアップ(通常は数十MB以上になりうる)を毎回 JSON.parse せずに見分けられるよう、
 * 先頭の数百文字だけを正規表現で見る(JSON.parseは一切呼ばない)。
 * 実際に中身を検証して復号するのは crypto.ts の decryptText(parseEncryptedFile)の役目。
 */
export function isEncryptedFileText(text: string): boolean {
  return TRANSFER_HEAD_PATTERN.test(text.slice(0, HEAD_SCAN_LENGTH));
}
