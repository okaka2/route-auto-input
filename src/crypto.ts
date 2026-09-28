/**
 * 引き継ぎファイルの暗号化・復号。
 * Web Crypto(`crypto.subtle`・`crypto.getRandomValues`)だけを使い、
 * パスワードから PBKDF2 で鍵を作り、AES-GCM で暗号化する。
 */

import { isEncryptedFileText, TRANSFER_FORMAT } from './transferFormat';

// 見分け方(isEncryptedFileText)と目印(TRANSFER_FORMAT)は transferFormat.ts にある
// (このファイルを別チャンクに保ったまま、読み込みの見分けに使えるようにするため)。
// 今までどおりここからも使えるよう、そのまま出し直す。
export { isEncryptedFileText, TRANSFER_FORMAT };

export const PBKDF2_ITERATIONS = 600_000;
// パスワードの最短の長さ(MIN_PASSWORD_LENGTH)は config.ts にある(このファイルが
// 別チャンクに分かれるようにするため。config.ts のコメントを参照)。

/**
 * 異常なファイル(回数がとても大きい)で、古いスマホが長く固まらないように、回数の上限を決めておく。
 * 既定(PBKDF2_ITERATIONS)を上げたあとも、この値自体は変えていない
 * (古い版(200,000回)で作ったファイルもこの上限の中に収まる)。暗号化と復号の両方で、この上限を使う。
 */
export const MAX_ITERATIONS = 2_000_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;
/** `String.fromCharCode(...大きな配列)` はスタックを溢れさせるので、区切って変換する。 */
const BASE64_CHUNK_SIZE = 0x8000;

const WRONG_PASSWORD_MESSAGE = 'パスワードが違うか、ファイルが壊れています。';
const NOT_TRANSFER_FILE_MESSAGE = '引き継ぎのファイルではありません。';

/**
 * ファイルの形が引き継ぎのファイルとして読めない(JSONでない・目印や版が違う・回数が上限を超える など)
 * ときに decryptText が投げる例外。パスワード違い(復号の失敗)と見分けられるよう、別の型にする。
 */
export class NotTransferFileError extends Error {
  constructor() {
    super(NOT_TRANSFER_FILE_MESSAGE);
    this.name = 'NotTransferFileError';
  }
}

export type EncryptedFile = {
  format: typeof TRANSFER_FORMAT;
  v: 1;
  iter: number;
  salt: string;
  iv: string;
  data: string;
};

/** バイト列を、大きなデータでもスタックを溢れさせずにbase64文字列へ変換する。 */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += BASE64_CHUNK_SIZE) {
    const chunk = bytes.subarray(i, i + BASE64_CHUNK_SIZE);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

/** base64文字列をバイト列に戻す。文字列が壊れていれば例外を投げる。 */
function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/** 回数(iter)が、そのまま使ってよい正の整数か(上限 MAX_ITERATIONS 以下か)。 */
function isValidIterationCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= MAX_ITERATIONS;
}

/**
 * パスワードと salt・回数から、AES-GCM用の鍵を作る。
 * パスワードは NFC に正規化してから使う。同じ見た目でも合成済み・未合成のUnicodeで
 * 打ち方が違うと別のパスワード扱いになってしまうのを防ぐため。
 */
async function deriveKey(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password.normalize('NFC')),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** JSON文字列を、形を確かめたうえでEncryptedFileに変換する。形が違えば NotTransferFileError を投げる。 */
function parseEncryptedFile(text: string): EncryptedFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new NotTransferFileError();
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new NotTransferFileError();
  }
  const obj = parsed as Record<string, unknown>;
  if (
    obj.format !== TRANSFER_FORMAT ||
    obj.v !== 1 ||
    !isValidIterationCount(obj.iter) ||
    typeof obj.salt !== 'string' ||
    typeof obj.iv !== 'string' ||
    typeof obj.data !== 'string'
  ) {
    throw new NotTransferFileError();
  }
  return { format: TRANSFER_FORMAT, v: 1, iter: obj.iter, salt: obj.salt, iv: obj.iv, data: obj.data };
}

/** 平文をパスワードで暗号化し、引き継ぎファイルのJSON文字列にする。iterationsが不正なら RangeError を投げる。 */
export async function encryptText(
  plain: string,
  password: string,
  iterations: number = PBKDF2_ITERATIONS,
): Promise<string> {
  if (!isValidIterationCount(iterations)) {
    throw new RangeError(`PBKDF2の回数(iterations)は、1以上${MAX_ITERATIONS.toLocaleString('en-US')}以下の整数にしてください。`);
  }
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKey(password, salt, iterations);
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plain));
  const file: EncryptedFile = {
    format: TRANSFER_FORMAT,
    v: 1,
    iter: iterations,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    data: bytesToBase64(new Uint8Array(cipher)),
  };
  return JSON.stringify(file);
}

/**
 * 引き継ぎファイルのJSON文字列をパスワードで復号する。
 * 形が違えば NotTransferFileError(「引き継ぎのファイルではありません。」)、
 * パスワード違いや改ざんなど復号に失敗した場合は「パスワードが違うか、ファイルが壊れています。」を投げる。
 */
export async function decryptText(fileText: string, password: string): Promise<string> {
  const file = parseEncryptedFile(fileText);
  try {
    const salt = base64ToBytes(file.salt);
    const iv = base64ToBytes(file.iv);
    const data = base64ToBytes(file.data);
    const key = await deriveKey(password, salt, file.iter);
    const plainBuffer = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
    return new TextDecoder().decode(plainBuffer);
  } catch {
    throw new Error(WRONG_PASSWORD_MESSAGE);
  }
}
