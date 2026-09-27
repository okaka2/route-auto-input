import { describe, expect, it } from 'vitest';
import { decryptText, encryptText, isEncryptedFileText, PBKDF2_ITERATIONS } from '../src/crypto';

describe('encryptText / decryptText / isEncryptedFileText', () => {
  it('暗号化して同じパスワードで戻せる(日本語・大きな中身も)', async () => {
    const plain = JSON.stringify({ x: 'あいう'.repeat(50_000) });
    const file = await encryptText(plain, 'secret-123', 1000);
    expect(isEncryptedFileText(file)).toBe(true);
    expect(file).not.toContain('あいう');
    expect(await decryptText(file, 'secret-123')).toBe(plain);
  });

  it('パスワードが違えば、決まった文で失敗する', async () => {
    const file = await encryptText('x', 'secret-123', 1000);
    await expect(decryptText(file, 'secret-124')).rejects.toThrow(
      'パスワードが違うか、ファイルが壊れています。',
    );
  });

  it('中身を1文字変えると失敗する(改ざんの検出)', async () => {
    const file = await encryptText('x', 'secret-123', 1000);
    const parsed = JSON.parse(file) as { data: string };
    const originalData = parsed.data;
    const lastChar = originalData.at(-1);
    const replacement = lastChar === 'A' ? 'B' : 'A';
    parsed.data = originalData.slice(0, -1) + replacement;
    const tampered = JSON.stringify(parsed);
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
  });

  it('既定の回数は 200,000 回で、ファイルに iter として残る', async () => {
    const plain = 'y';
    const file = await encryptText(plain, 'secret-123');
    const parsed = JSON.parse(file) as { iter: number };
    expect(parsed.iter).toBe(PBKDF2_ITERATIONS);
    expect(await decryptText(file, 'secret-123')).toBe(plain);
  }, 20_000);
});
