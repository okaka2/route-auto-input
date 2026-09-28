import { describe, expect, it } from 'vitest';
import {
  decryptText,
  encryptText,
  isEncryptedFileText,
  MAX_ITERATIONS,
  NotTransferFileError,
  PBKDF2_ITERATIONS,
} from '../src/crypto';

/** テスト用に、data(base64)をバイト列に戻す/バイト列をbase64に戻す。 */
function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

/** dataの中の1バイトを反転させたJSON文字列を作る(改ざんのテスト用)。 */
async function tamperByteAt(file: string, byteIndex: number): Promise<string> {
  const parsed = JSON.parse(file) as { data: string };
  const bytes = base64ToBytes(parsed.data);
  bytes[byteIndex] = bytes[byteIndex]! ^ 0xff;
  parsed.data = bytesToBase64(bytes);
  return JSON.stringify(parsed);
}

describe('encryptText / decryptText / isEncryptedFileText', () => {
  it('暗号化して同じパスワードで戻せる(日本語・大きな中身も)', async () => {
    const plain = JSON.stringify({ x: 'あいう'.repeat(50_000) });
    const file = await encryptText(plain, 'secret-123', 1000);
    expect(isEncryptedFileText(file)).toBe(true);
    expect(file).not.toContain('あいう');
    expect(await decryptText(file, 'secret-123')).toBe(plain);
  });

  it('パスワードが違えば、決まった文で失敗する(形の違いの NotTransferFileError とは別の例外)', async () => {
    const file = await encryptText('x', 'secret-123', 1000);
    await expect(decryptText(file, 'secret-124')).rejects.toThrow(
      'パスワードが違うか、ファイルが壊れています。',
    );
    await expect(decryptText(file, 'secret-124')).rejects.not.toBeInstanceOf(NotTransferFileError);
  });

  it('パスワードのNFC正規化が違っても(分解済み⇔合成済み)、同じパスワードとして戻せる', async () => {
    const decomposed = 'がぎ'; // 「がぎ」を濁点分解して書いたもの
    const composed = 'がぎ';
    expect(decomposed).not.toBe(composed);
    expect(decomposed.normalize('NFC')).toBe(composed);
    const file = await encryptText('x', decomposed, 1000);
    expect(await decryptText(file, composed)).toBe('x');
  });

  it('暗号文の途中のバイトを変えると失敗する(改ざんの検出)', async () => {
    const plain = 'x'.repeat(100);
    const file = await encryptText(plain, 'secret-123', 1000);
    const bytes = base64ToBytes((JSON.parse(file) as { data: string }).data);
    // dataは「暗号文 + 認証タグ16バイト」。平文を長くしておけば、真ん中はタグより前の
    // 暗号文部分になる(タグは末尾16バイトなので、真ん中がそこに入らないことを確認する)。
    const middleIndex = Math.floor(bytes.length / 2);
    expect(middleIndex).toBeLessThan(bytes.length - 16);
    const tampered = await tamperByteAt(file, middleIndex);
    await expect(decryptText(tampered, 'secret-123')).rejects.toThrow(
      'パスワードが違うか、ファイルが壊れています。',
    );
  });

  it('認証タグ(末尾16バイト)のバイトを変えても失敗する(改ざんの検出)', async () => {
    const plain = 'x'.repeat(100);
    const file = await encryptText(plain, 'secret-123', 1000);
    const bytes = base64ToBytes((JSON.parse(file) as { data: string }).data);
    const tagByteIndex = bytes.length - 8; // 末尾16バイト(認証タグ)の中の1バイト
    const tampered = await tamperByteAt(file, tagByteIndex);
    await expect(decryptText(tampered, 'secret-123')).rejects.toThrow(
      'パスワードが違うか、ファイルが壊れています。',
    );
  });

  it('同じ中身でも毎回ちがう暗号になる(salt と iv が毎回変わる)', async () => {
    const file1 = await encryptText('x', 'secret-123', 1000);
    const file2 = await encryptText('x', 'secret-123', 1000);
    const parsed1 = JSON.parse(file1) as { data: string; salt: string; iv: string };
    const parsed2 = JSON.parse(file2) as { data: string; salt: string; iv: string };
    expect(parsed1.data).not.toBe(parsed2.data);
    expect(parsed1.salt).not.toBe(parsed2.salt);
    expect(parsed1.iv).not.toBe(parsed2.iv);
  });

  it('ほかの JSON や壊れた文字列は、引き継ぎのファイルではない', async () => {
    expect(isEncryptedFileText('{"version":2,"patients":[]}')).toBe(false);
    await expect(decryptText('abc', 'secret-123')).rejects.toThrow(
      '引き継ぎのファイルではありません。',
    );
    // パスワード違いと見分けられるよう、形の違いは NotTransferFileError で投げる。
    await expect(decryptText('abc', 'secret-123')).rejects.toBeInstanceOf(NotTransferFileError);
  });

  it('版(v)が違うファイルも、NotTransferFileError(新しい版のアプリで作られたものなど)', async () => {
    const file = await encryptText('x', 'secret-123', 1000);
    const parsed = JSON.parse(file) as Record<string, unknown>;
    parsed.v = 2;
    await expect(decryptText(JSON.stringify(parsed), 'secret-123')).rejects.toBeInstanceOf(NotTransferFileError);
  });

  it('回数の上限は 2,000,000 回(既定を上げても変えない)', () => {
    expect(MAX_ITERATIONS).toBe(2_000_000);
    expect(MAX_ITERATIONS).toBeGreaterThan(PBKDF2_ITERATIONS);
  });

  it.each([0, -1, 1.5, '1000', MAX_ITERATIONS + 1, 10_000_000])(
    '回数(iter)が %p のように不正なファイルは、引き継ぎのファイルではない',
    async (badIter) => {
      const file = await encryptText('x', 'secret-123', 1000);
      const parsed = JSON.parse(file) as Record<string, unknown>;
      parsed.iter = badIter;
      await expect(decryptText(JSON.stringify(parsed), 'secret-123')).rejects.toThrow(
        '引き継ぎのファイルではありません。',
      );
      await expect(decryptText(JSON.stringify(parsed), 'secret-123')).rejects.toBeInstanceOf(NotTransferFileError);
    },
  );

  it('dataが不正なbase64のファイルは、パスワードが違うか壊れているとして失敗する', async () => {
    const file = await encryptText('x', 'secret-123', 1000);
    const parsed = JSON.parse(file) as Record<string, unknown>;
    parsed.data = '*';
    await expect(decryptText(JSON.stringify(parsed), 'secret-123')).rejects.toThrow(
      'パスワードが違うか、ファイルが壊れています。',
    );
  });

  it('既定の回数は 600,000 回で、ファイルに iter として残る', async () => {
    const plain = 'y';
    const file = await encryptText(plain, 'secret-123');
    const parsed = JSON.parse(file) as { iter: number };
    expect(parsed.iter).toBe(600_000);
    expect(parsed.iter).toBe(PBKDF2_ITERATIONS);
    expect(await decryptText(file, 'secret-123')).toBe(plain);
  }, 20_000);

  it('回数(iter)が 200,000 回(古い版で作ったファイル)でも開ける', async () => {
    const plain = 'old-file';
    const file = await encryptText(plain, 'secret-123', 200_000);
    const parsed = JSON.parse(file) as { iter: number };
    expect(parsed.iter).toBe(200_000);
    expect(await decryptText(file, 'secret-123')).toBe(plain);
  }, 20_000);

  it.each([0, -1, 1.5, '1000' as unknown as number, MAX_ITERATIONS + 1, 10_000_000])(
    'encryptTextに不正な回数(%p)を渡すとRangeErrorになる',
    async (badIterations) => {
      await expect(encryptText('x', 'secret-123', badIterations)).rejects.toThrow(RangeError);
    },
  );
});

describe('transferFormat(crypto.ts を読み込まずに見分けるための小さなモジュール)', () => {
  it('crypto.ts と同じ見分け方・目印を出す', async () => {
    const format = await import('../src/transferFormat');
    const cryptoModule = await import('../src/crypto');
    expect(format.isEncryptedFileText).toBe(cryptoModule.isEncryptedFileText);
    expect(format.TRANSFER_FORMAT).toBe(cryptoModule.TRANSFER_FORMAT);
    expect(format.isEncryptedFileText(await encryptText('x', 'abcdef', 1000))).toBe(true);
    expect(format.isEncryptedFileText('{"kind":"route-auto-input-backup"}')).toBe(false);
    expect(format.isEncryptedFileText('not json')).toBe(false);
  });
});
